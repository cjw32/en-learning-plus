import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  MCP_ACCESS_TOKEN_SCOPES,
  type McpAccessTokenScope,
} from './mcp-access-token-verifier';
import type { McpPrincipal } from './mcp-principal';
import type {
  McpAuthorizationRepository,
  McpPrincipalAuthorizationKey,
} from '../persistence/mcp-authorization.repository';
import type {
  McpPersistenceIdentity,
  McpSubjectRepository,
} from '../persistence/mcp-subject.repository';

type SubjectMappingRow = Readonly<{
  id: string;
  issuer: string;
  subjectHmac: string;
  hmacKeyVersion: string;
  userId: string;
  status: string;
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
  status: string;
}>;

type SubjectRepositoryPort = Pick<
  McpSubjectRepository,
  'findMappingForVerifiedSubject' | 'findOwnedActive'
>;

type AuthorizationRepositoryPort = Pick<
  McpAuthorizationRepository,
  'findActiveForPrincipal' | 'findOwnedActive'
>;

export type McpAuthorizationServiceOptions = Readonly<{
  subjectHmacKey: string;
  hmacKeyVersion: string;
}>;

export type McpAuthorizedIdentity = Readonly<{
  identity: McpPersistenceIdentity;
  scopes: readonly McpAccessTokenScope[];
}>;

export class McpAuthorizationError extends Error {
  readonly retryable = false;

  constructor(readonly code: 'UNAUTHENTICATED' | 'INSUFFICIENT_SCOPE') {
    super(code);
    this.name = 'McpAuthorizationError';
  }
}

function safeEqual(left: string, right: string): boolean {
  const first = Buffer.from(left, 'utf8');
  const second = Buffer.from(right, 'utf8');
  return first.length === second.length && timingSafeEqual(first, second);
}

@Injectable()
export class McpAuthorizationService {
  private readonly knownScopes = new Set<string>(MCP_ACCESS_TOKEN_SCOPES);

  constructor(
    private readonly subjects: SubjectRepositoryPort,
    private readonly authorizations: AuthorizationRepositoryPort,
    private readonly options: McpAuthorizationServiceOptions,
  ) {
    if (
      Buffer.byteLength(options.subjectHmacKey, 'utf8') < 32 ||
      !/^[A-Za-z0-9_.-]{1,64}$/.test(options.hmacKeyVersion)
    ) {
      throw new McpAuthorizationError('UNAUTHENTICATED');
    }
  }

  async authorize(
    principal: McpPrincipal,
    requiredScopes: readonly string[] = [],
  ): Promise<McpAuthorizedIdentity> {
    const subjectHmac = this.subjectHmac(principal);
    const mapping = (await this.subjects.findMappingForVerifiedSubject({
      issuer: principal.issuer,
      subjectHmac,
    })) as SubjectMappingRow | null;
    if (
      !mapping ||
      mapping.status !== 'ACTIVE' ||
      mapping.issuer !== principal.issuer ||
      mapping.subjectHmac !== subjectHmac ||
      mapping.hmacKeyVersion !== this.options.hmacKeyVersion
    ) {
      throw new McpAuthorizationError('UNAUTHENTICATED');
    }

    const lookup: McpPrincipalAuthorizationKey = {
      subjectMappingId: mapping.id,
      subjectHmac,
      userId: mapping.userId,
      issuer: principal.issuer,
      audience: principal.audience,
      clientId: principal.clientId,
      authorizationVersion: principal.authorizationVersion,
    };
    const grant = (await this.authorizations.findActiveForPrincipal(
      lookup,
    )) as AuthorizationRow | null;
    if (!this.validGrant(grant, lookup)) {
      throw new McpAuthorizationError('UNAUTHENTICATED');
    }
    return this.project(principal, mapping, grant!, requiredScopes);
  }

  async revalidate(
    current: McpAuthorizedIdentity,
    principal: McpPrincipal,
    requiredScopes: readonly string[] = [],
  ): Promise<McpAuthorizedIdentity> {
    const identity = current.identity;
    if (
      principal.issuer !== identity.issuer ||
      principal.audience !== identity.audience ||
      principal.clientId !== identity.clientId ||
      principal.authorizationVersion !== identity.authorizationVersion ||
      !safeEqual(this.subjectHmac(principal), identity.subjectHmac)
    ) {
      throw new McpAuthorizationError('UNAUTHENTICATED');
    }

    const [mapping, grant] = (await Promise.all([
      this.subjects.findOwnedActive(identity),
      this.authorizations.findOwnedActive(identity),
    ])) as [SubjectMappingRow | null, AuthorizationRow | null];
    if (
      !mapping ||
      mapping.status !== 'ACTIVE' ||
      mapping.userId !== identity.userId ||
      mapping.issuer !== identity.issuer ||
      mapping.subjectHmac !== identity.subjectHmac ||
      !this.validGrant(grant, {
        subjectMappingId: grant?.subjectMappingId ?? '',
        subjectHmac: identity.subjectHmac,
        userId: identity.userId,
        issuer: identity.issuer,
        audience: identity.audience,
        clientId: identity.clientId,
        authorizationVersion: identity.authorizationVersion,
      }) ||
      grant?.id !== identity.authorizationId ||
      grant.subjectMappingId !== mapping.id
    ) {
      throw new McpAuthorizationError('UNAUTHENTICATED');
    }
    return this.project(principal, mapping, grant, requiredScopes);
  }

  private subjectHmac(principal: McpPrincipal): string {
    return createHmac('sha256', this.options.subjectHmacKey)
      .update(
        `${this.options.hmacKeyVersion}\0${principal.issuer}\0${principal.subject}`,
      )
      .digest('hex');
  }

  private validGrant(
    grant: AuthorizationRow | null,
    expected: McpPrincipalAuthorizationKey,
  ): boolean {
    return Boolean(
      grant &&
      grant.status === 'ACTIVE' &&
      grant.subjectMappingId === expected.subjectMappingId &&
      grant.userId === expected.userId &&
      grant.issuer === expected.issuer &&
      grant.audience === expected.audience &&
      grant.clientId === expected.clientId &&
      grant.authorizationVersion === expected.authorizationVersion &&
      grant.scopes.every((scope) => this.knownScopes.has(scope)),
    );
  }

  private project(
    principal: McpPrincipal,
    mapping: SubjectMappingRow,
    grant: AuthorizationRow,
    requiredScopes: readonly string[],
  ): McpAuthorizedIdentity {
    if (
      new Set(requiredScopes).size !== requiredScopes.length ||
      requiredScopes.some((scope) => !this.knownScopes.has(scope))
    ) {
      throw new McpAuthorizationError('INSUFFICIENT_SCOPE');
    }
    const granted = new Set(grant.scopes);
    const scopes = principal.scopes.filter((scope) => granted.has(scope));
    if (
      requiredScopes.some(
        (scope) => !scopes.includes(scope as McpAccessTokenScope),
      )
    ) {
      throw new McpAuthorizationError('INSUFFICIENT_SCOPE');
    }
    return Object.freeze({
      identity: Object.freeze({
        issuer: principal.issuer,
        subjectHmac: mapping.subjectHmac,
        userId: mapping.userId,
        authorizationId: grant.id,
        clientId: principal.clientId,
        audience: principal.audience,
        authorizationVersion: principal.authorizationVersion,
      }),
      scopes: Object.freeze([...scopes]),
    });
  }
}
