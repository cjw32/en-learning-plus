import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { McpRequestContext } from '../../src/mcp/auth/mcp-principal';
import { McpToolRegistry } from '../../src/mcp/tools/mcp-tool.registry';

type ConfirmationProjectionInput = Readonly<{
  confirmationId: string;
  selector: string;
  elicitationId: string;
  intentDigest: string;
  expiresAt: Date;
  context: McpRequestContext;
}>;

type ModernProjection = Readonly<{
  resultType: 'input_required';
  inputRequests: Readonly<{
    confirm_submission: Readonly<{
      method: 'elicitation/create';
      params: Readonly<{
        mode: 'url';
        url: string;
        message: string;
      }>;
    }>;
  }>;
  requestState: string;
}>;

type LegacyProjection = Readonly<{
  code: -32042;
  message: string;
  data: Readonly<{
    elicitations: readonly [
      Readonly<{
        mode: 'url';
        elicitationId: string;
        url: string;
        message: string;
      }>,
    ];
  }>;
}>;

type ModernPresenterConstructor = new (options: {
  confirmationPageOrigin: string;
  requestStateCodec: Readonly<{
    mint(
      state: Readonly<{
        confirmationId: string;
        intentDigest: string;
        expiresAtEpochMs: number;
      }>,
      binding: Readonly<{
        issuer: string;
        subject: string;
        clientId: string;
        requestId: string;
      }>,
    ): Promise<string>;
  }>;
}) => {
  present(input: ConfirmationProjectionInput): Promise<ModernProjection>;
};

type LegacyPresenterConstructor = new (options: {
  confirmationPageOrigin: string;
  sessionBinding: Readonly<{
    bind(input: {
      elicitationId: string;
      confirmationId: string;
      sessionId: string;
      expiresAt: Date;
    }): Promise<void>;
  }>;
}) => {
  present(
    input: ConfirmationProjectionInput & Readonly<{ sessionId: string }>,
  ): Promise<LegacyProjection>;
};

const modernPath = resolve(
  __dirname,
  '../../src/mcp/elicitation/mcp-modern-confirmation.presenter.ts',
);
const legacyPath = resolve(
  __dirname,
  '../../src/mcp/elicitation/mcp-legacy-confirmation.presenter.ts',
);

function presenters(): Readonly<{
  Modern: ModernPresenterConstructor;
  Legacy: LegacyPresenterConstructor;
}> {
  if (!existsSync(modernPath) || !existsSync(legacyPath)) {
    throw new Error('Missing MCP confirmation elicitation presenters');
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const modern = require(modernPath) as {
    McpModernConfirmationPresenter: ModernPresenterConstructor;
  };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const legacy = require(legacyPath) as {
    McpLegacyConfirmationPresenter: LegacyPresenterConstructor;
  };
  return {
    Modern: modern.McpModernConfirmationPresenter,
    Legacy: legacy.McpLegacyConfirmationPresenter,
  };
}

function context(
  protocolVersion: '2026-07-28' | '2025-11-25',
): McpRequestContext {
  return Object.freeze({
    principal: Object.freeze({
      issuer: 'https://issuer.mcp.test',
      subject: 'submit-elicitation-subject',
      audience: 'https://resource.mcp.test/ai/v1/mcp',
      clientId: 'submit-elicitation-client',
      scopes: Object.freeze(['answer:submit'] as const),
      authorizationVersion: 1,
      issuedAtEpochSeconds: 1_789_117_140,
      notBeforeEpochSeconds: 1_789_117_140,
      expiresAtEpochSeconds: 1_789_120_800,
      verificationMethodVersion: 'fixture.v1',
    }),
    userId: 'learner_submit_elicitation',
    authorizationId: 'authorization_submit_elicitation',
    requestId: 'request_submit_elicitation_0001',
    traceId: 'trace_submit_elicitation_0001',
    protocolVersion,
  });
}

function projectionInput(
  protocolVersion: '2026-07-28' | '2025-11-25',
): ConfirmationProjectionInput {
  return Object.freeze({
    confirmationId: 'confirmation_submit_0001',
    selector: 'R4nd0m-opaque-selector-with-enough-entropy_0001',
    elicitationId: 'elicitation_submit_0001',
    intentDigest: 'a'.repeat(64),
    expiresAt: new Date('2026-09-11T08:05:00.000Z'),
    context: context(protocolVersion),
  });
}

const confirmationOrigin = 'https://learn.en-learning.test';
const expectedConfirmationUrl =
  'https://learn.en-learning.test/mcp/confirmations/R4nd0m-opaque-selector-with-enough-entropy_0001';

function assertSafeProjectUrl(value: string) {
  const url = new URL(value);
  expect(url.origin).toBe(confirmationOrigin);
  expect(url.href).toBe(expectedConfirmationUrl);
  expect(url.search).toBe('');
  expect(url.hash).toBe('');
  expect(url.username).toBe('');
  expect(url.password).toBe('');
}

describe('MCP submit_answer URL elicitation projections', () => {
  it('projects the modern input-required request with bound opaque state', async () => {
    const mint = jest.fn(async () => 'v1.signed-opaque-request-state');
    const { Modern } = presenters();
    const presenter = new Modern({
      confirmationPageOrigin: confirmationOrigin,
      requestStateCodec: { mint },
    });
    const input = projectionInput('2026-07-28');

    const result = await presenter.present(input);

    expect(result).toEqual({
      resultType: 'input_required',
      inputRequests: {
        confirm_submission: {
          method: 'elicitation/create',
          params: {
            mode: 'url',
            url: expectedConfirmationUrl,
            message:
              'Review and confirm this learning update in en-learning-plus.',
          },
        },
      },
      requestState: 'v1.signed-opaque-request-state',
    });
    expect(mint).toHaveBeenCalledWith(
      {
        confirmationId: input.confirmationId,
        intentDigest: input.intentDigest,
        expiresAtEpochMs: input.expiresAt.getTime(),
      },
      {
        issuer: input.context.principal.issuer,
        subject: input.context.principal.subject,
        clientId: input.context.principal.clientId,
        requestId: input.context.requestId,
      },
    );
    assertSafeProjectUrl(result.inputRequests.confirm_submission.params.url);
  });

  it('projects the legacy URL-required error and binds its elicitation to the initiating session', async () => {
    const bind = jest.fn(async () => undefined);
    const { Legacy } = presenters();
    const presenter = new Legacy({
      confirmationPageOrigin: confirmationOrigin,
      sessionBinding: { bind },
    });
    const input = {
      ...projectionInput('2025-11-25'),
      sessionId: 'legacy_session_submit_0001',
    };

    const result = await presenter.present(input);

    expect(result).toEqual({
      code: -32042,
      message: 'This request requires confirmation.',
      data: {
        elicitations: [
          {
            mode: 'url',
            elicitationId: input.elicitationId,
            url: expectedConfirmationUrl,
            message:
              'Review and confirm this learning update in en-learning-plus.',
          },
        ],
      },
    });
    expect(bind).toHaveBeenCalledWith({
      elicitationId: input.elicitationId,
      confirmationId: input.confirmationId,
      sessionId: input.sessionId,
      expiresAt: input.expiresAt,
    });
    assertSafeProjectUrl(result.data.elicitations[0].url);
  });

  it.each(['http://learn.en-learning.test', 'https://attacker.invalid/path'])(
    'rejects the unapproved confirmation origin %s',
    async (unapprovedOrigin) => {
      const { Modern, Legacy } = presenters();
      expect(
        () =>
          new Modern({
            confirmationPageOrigin: unapprovedOrigin,
            requestStateCodec: { mint: async () => 'unused' },
          }),
      ).toThrow();
      expect(
        () =>
          new Legacy({
            confirmationPageOrigin: unapprovedOrigin,
            sessionBinding: { bind: async () => undefined },
          }),
      ).toThrow();
    },
  );

  it.each(['2026-07-28', '2025-11-25'] as const)(
    'keeps answer, identity, token, and redirect data out of the %s client projection',
    async (protocolVersion) => {
      const privateValues = [
        'private learner answer',
        'learner_submit_elicitation',
        'submit-elicitation-subject',
        'Bearer private-token',
        'https://attacker.invalid/redirect',
      ];
      const { Modern, Legacy } = presenters();
      const value =
        protocolVersion === '2026-07-28'
          ? await new Modern({
              confirmationPageOrigin: confirmationOrigin,
              requestStateCodec: {
                mint: async () => 'v1.signed-opaque-request-state',
              },
            }).present(projectionInput(protocolVersion))
          : await new Legacy({
              confirmationPageOrigin: confirmationOrigin,
              sessionBinding: { bind: async () => undefined },
            }).present({
              ...projectionInput(protocolVersion),
              sessionId: 'legacy_session_submit_0001',
            });
      const serialized = JSON.stringify(value);

      for (const privateValue of privateValues) {
        expect(serialized).not.toContain(privateValue);
      }
    },
  );
});

describe('MCP submit_answer URL capability parity', () => {
  it.each(['2026-07-28', '2025-11-25'] as const)(
    'hides and denies submit_answer for a %s client without URL elicitation',
    async (protocolVersion) => {
      const execute = jest.fn(async () => ({ status: 'not_saved' }));
      const submitAnswer = {
        name: 'submit_answer',
        definition: {
          description: 'Submit answers after verified confirmation.',
          inputSchema: {},
          outputSchema: {},
          annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
          },
          _meta: {
            'en-learning/requiredScopes': ['answer:submit'],
            'en-learning/effect': 'write_learning_progress',
            'en-learning/confirmation': 'url_elicitation_required',
          },
        },
        execute,
      };
      const registry = new McpToolRegistry({
        handlers: { submit_answer: submitAnswer } as never,
        authorization: { assertActive: jest.fn(async () => undefined) },
        isCapabilityEnabled: (name) => name !== 'submit_answer',
      });
      const server = { registerTool: jest.fn() };
      const currentContext = context(protocolVersion);

      expect(registry.register(server as never, currentContext)).not.toContain(
        'submit_answer',
      );
      await expect(
        registry.call('submit_answer', {}, currentContext),
      ).rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' });
      expect(execute).not.toHaveBeenCalled();
    },
  );
});
