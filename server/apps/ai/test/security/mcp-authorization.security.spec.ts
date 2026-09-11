import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { McpPrincipal } from '../../src/mcp/auth/mcp-principal';

type SubjectRow = Readonly<{
  id: string;
  issuer: string;
  subjectHmac: string;
  hmacKeyVersion: string;
  userId: string;
  status: 'ACTIVE' | 'REVOKED' | 'DELETING';
}>;

type AuthorizationRow = Readonly<{
  id: string;
  userId: string;
  subjectMappingId: string;
  issuer: string;
  audience: string;
  clientId: string;
  scopes: readonly string[];
  authorizationVersion: number;
  status: 'ACTIVE' | 'REVOKED' | 'DELETING';
}>;

type AuthorizationService = {
  authorize(
    principal: McpPrincipal,
    requiredScopes?: readonly string[],
  ): Promise<{
    identity: {
      issuer: string;
      subjectHmac: string;
      userId: string;
      authorizationId: string;
      clientId: string;
      audience: string;
      authorizationVersion: number;
    };
    scopes: readonly string[];
  }>;
  revalidate(
    authorization: Awaited<ReturnType<AuthorizationService['authorize']>>,
    principal: McpPrincipal,
    requiredScopes?: readonly string[],
  ): Promise<Awaited<ReturnType<AuthorizationService['authorize']>>>;
};

const implementationPath = resolve(
  __dirname,
  '../../src/mcp/auth/mcp-authorization.service.ts',
);

function loadService(): new (
  subjectRepository: {
    findMappingForVerifiedSubject(key: {
      issuer: string;
      subjectHmac: string;
    }): Promise<SubjectRow | null>;
    findOwnedActive(identity: unknown): Promise<SubjectRow | null>;
  },
  authorizationRepository: {
    findActiveForPrincipal(key: unknown): Promise<AuthorizationRow | null>;
    findOwnedActive(identity: unknown): Promise<AuthorizationRow | null>;
  },
  options: { subjectHmacKey: string; hmacKeyVersion: string },
) => AuthorizationService {
  if (!existsSync(implementationPath)) {
    throw new Error('Missing MCP authorization service (T035)');
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(implementationPath).McpAuthorizationService;
}

const issuer = 'https://issuer.mcp.test';
const audience = 'https://resource.mcp.test/ai/v1/mcp';

function principal(overrides: Partial<McpPrincipal> = {}): McpPrincipal {
  return Object.freeze({
    issuer,
    subject: 'immutable-subject-a',
    audience,
    clientId: 'client-a',
    scopes: Object.freeze(['learning:read', 'quiz:create'] as const),
    authorizationVersion: 3,
    issuedAtEpochSeconds: 1_789_113_540,
    notBeforeEpochSeconds: 1_789_113_540,
    expiresAtEpochSeconds: 1_789_117_200,
    verificationMethodVersion: 'fake-local.v1',
    ...overrides,
  });
}

function fixture() {
  const mappings = new Map<string, SubjectRow>();
  const grants = new Map<string, AuthorizationRow>();
  const subjectRepository = {
    findMappingForVerifiedSubject: jest.fn(
      async ({ issuer, subjectHmac }) =>
        mappings.get(`${issuer}|${subjectHmac}`) ?? null,
    ),
    findOwnedActive: jest.fn(
      async (identity: any) =>
        [...mappings.values()].find(
          (row) =>
            row.issuer === identity.issuer &&
            row.subjectHmac === identity.subjectHmac &&
            row.userId === identity.userId &&
            row.status === 'ACTIVE',
        ) ?? null,
    ),
  };
  const authorizationRepository = {
    findActiveForPrincipal: jest.fn(
      async (key: any) =>
        [...grants.values()].find(
          (row) =>
            row.subjectMappingId === key.subjectMappingId &&
            row.userId === key.userId &&
            row.issuer === key.issuer &&
            row.audience === key.audience &&
            row.clientId === key.clientId &&
            row.authorizationVersion === key.authorizationVersion &&
            row.status === 'ACTIVE',
        ) ?? null,
    ),
    findOwnedActive: jest.fn(async (identity: any) =>
      grants.get(identity.authorizationId)?.status === 'ACTIVE'
        ? grants.get(identity.authorizationId)!
        : null,
    ),
  };
  const Service = loadService();
  const service = new Service(subjectRepository, authorizationRepository, {
    subjectHmacKey: 'subject-hmac-test-key-00000000000001',
    hmacKeyVersion: 'mcp-subject-hmac.v1',
  });
  return {
    service,
    mappings,
    grants,
    subjectRepository,
    authorizationRepository,
  };
}

async function seed(
  test: ReturnType<typeof fixture>,
  currentPrincipal: McpPrincipal,
  userId: string,
  mappingId: string,
  authorizationId: string,
) {
  // Ask once with no rows to obtain only the deterministic hash from the
  // repository key; failure must not auto-provision anything.
  await expect(test.service.authorize(currentPrincipal)).rejects.toMatchObject({
    code: 'UNAUTHENTICATED',
  });
  const lookup =
    test.subjectRepository.findMappingForVerifiedSubject.mock.calls.at(-1)?.[0];
  const mapping: SubjectRow = {
    id: mappingId,
    issuer: currentPrincipal.issuer,
    subjectHmac: lookup.subjectHmac,
    hmacKeyVersion: 'mcp-subject-hmac.v1',
    userId,
    status: 'ACTIVE',
  };
  const grant: AuthorizationRow = {
    id: authorizationId,
    userId,
    subjectMappingId: mappingId,
    issuer: currentPrincipal.issuer,
    audience: currentPrincipal.audience,
    clientId: currentPrincipal.clientId,
    scopes: ['learning:read', 'quiz:create'],
    authorizationVersion: currentPrincipal.authorizationVersion,
    status: 'ACTIVE',
  };
  test.mappings.set(`${mapping.issuer}|${mapping.subjectHmac}`, mapping);
  test.grants.set(grant.id, grant);
}

describe('MCP immutable subject mapping and authorization revalidation', () => {
  it('maps two immutable subjects to separate existing users without auto-linking', async () => {
    const test = fixture();
    const first = principal();
    const second = principal({ subject: 'immutable-subject-b' });
    await seed(test, first, 'user-a', 'mapping-a', 'authorization-a');
    await seed(test, second, 'user-b', 'mapping-b', 'authorization-b');

    const authorizedA = await test.service.authorize(first, ['learning:read']);
    const authorizedB = await test.service.authorize(second, ['learning:read']);
    expect(authorizedA.identity.userId).toBe('user-a');
    expect(authorizedB.identity.userId).toBe('user-b');
    expect(authorizedA.identity.subjectHmac).not.toBe(
      authorizedB.identity.subjectHmac,
    );
    expect(Object.isFrozen(authorizedA)).toBe(true);
    expect(Object.isFrozen(authorizedA.identity)).toBe(true);
    expect(Object.isFrozen(authorizedA.scopes)).toBe(true);
  });

  it('intersects token and local scopes and requires the complete requested set', async () => {
    const test = fixture();
    const current = principal({
      scopes: Object.freeze(['learning:read', 'answer:submit']),
    });
    await seed(test, current, 'user-a', 'mapping-a', 'authorization-a');
    test.grants.set('authorization-a', {
      ...test.grants.get('authorization-a')!,
      scopes: ['learning:read', 'quiz:create'],
    });

    await expect(test.service.authorize(current)).resolves.toMatchObject({
      scopes: ['learning:read'],
    });
    await expect(
      test.service.authorize(current, ['answer:submit']),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_SCOPE' });
  });

  it('rejects issuer, subject, audience, client, or authorization-version changes', async () => {
    const test = fixture();
    const current = principal();
    await seed(test, current, 'user-a', 'mapping-a', 'authorization-a');
    const authorized = await test.service.authorize(current);

    for (const changed of [
      { issuer: 'https://other-issuer.test' },
      { subject: 'other-subject' },
      { audience: 'https://other-resource.test/ai/v1/mcp' },
      { clientId: 'other-client' },
      { authorizationVersion: 4 },
    ]) {
      await expect(
        test.service.revalidate(authorized, principal(changed)),
      ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    }
  });

  it('re-reads mapping and grant on every direct call and denies deletion or revocation', async () => {
    const test = fixture();
    const current = principal();
    await seed(test, current, 'user-a', 'mapping-a', 'authorization-a');
    const authorized = await test.service.authorize(current);

    await test.service.revalidate(authorized, current, ['learning:read']);
    await test.service.revalidate(authorized, current, ['learning:read']);
    expect(test.subjectRepository.findOwnedActive).toHaveBeenCalledTimes(2);
    expect(test.authorizationRepository.findOwnedActive).toHaveBeenCalledTimes(
      2,
    );

    test.mappings.set(
      `${authorized.identity.issuer}|${authorized.identity.subjectHmac}`,
      { ...test.mappings.values().next().value!, status: 'DELETING' },
    );
    await expect(
      test.service.revalidate(authorized, current),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });

    test.mappings.set(
      `${authorized.identity.issuer}|${authorized.identity.subjectHmac}`,
      { ...test.mappings.values().next().value!, status: 'ACTIVE' },
    );
    test.grants.set('authorization-a', {
      ...test.grants.get('authorization-a')!,
      status: 'REVOKED',
    });
    await expect(
      test.service.revalidate(authorized, current),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});
