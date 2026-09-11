import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Schema = Readonly<{
  safeParse(value: unknown): Readonly<{ success: boolean }>;
}>;

type ConfirmationContracts = Readonly<{
  MCP_CONFIRMATION_SCHEMA_VERSION: 'en-learning.mcp.confirmation.v1';
  mcpConfirmationDecisionInputSchema: Schema;
  mcpConfirmationViewSchema: Schema;
  mcpConfirmationDecisionResultSchema: Schema;
  mcpConfirmationSafeErrorSchema: Schema;
  renderMcpWriteConfirmationOpenApi(): string;
}>;

const implementationPath = resolve(
  __dirname,
  '../../../../../packages/common/mcp/confirmation.ts',
);
const openApiPath = resolve(
  __dirname,
  '../../../../../specs/004-english-learning-mcp/contracts/write-confirmation.openapi.yaml',
);

function contracts(): ConfirmationContracts {
  if (!existsSync(implementationPath)) {
    throw new Error('Missing shared MCP confirmation contracts');
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(implementationPath) as ConfirmationContracts;
}

const pending = Object.freeze({
  schemaVersion: 'en-learning.mcp.confirmation.v1',
  status: 'pending',
  clientDisplayName: 'Example Learning Client',
  toolName: 'submit_answer',
  exercise: Object.freeze({
    title: 'Project meeting practice',
    itemCount: 2,
    version: 'exercise.v1',
  }),
  operationSummary: Object.freeze({
    answerCount: 2,
    willSaveAttempt: true,
    willUpdateMastery: true,
    willUpdateReviewSchedule: true,
    notice: 'Your answers will be graded and saved to your learning history.',
  }),
  operationSummaryDigest: 'a'.repeat(64),
  expiresAt: '2026-09-11T08:05:00.000Z',
  retryInstruction: 'After confirming, retry the original MCP call.',
});

describe('MCP Web write-confirmation OpenAPI and shared contracts', () => {
  it('renders byte-identical checked-in OpenAPI', () => {
    const source = readFileSync(openApiPath, 'utf8');
    expect(contracts().renderMcpWriteConfirmationOpenApi()).toBe(source);
  });

  it.each(['pending', 'confirmed', 'rejected'] as const)(
    'accepts the %s confirmation view and rejects unknown/private fields',
    (status) => {
      const schema = contracts().mcpConfirmationViewSchema;
      expect(schema.safeParse({ ...pending, status }).success).toBe(true);
      expect(
        schema.safeParse({
          ...pending,
          status,
          accessToken: 'Bearer private',
        }).success,
      ).toBe(false);
      expect(
        schema.safeParse({
          ...pending,
          status,
          operationSummary: {
            ...pending.operationSummary,
            answers: ['private answer'],
          },
        }).success,
      ).toBe(false);
    },
  );

  it.each([
    ['confirm', 'confirmed', 'retry_original_mcp_call'],
    ['reject', 'rejected', 'no_action'],
  ] as const)(
    'keeps the %s request/result contract exact',
    (decision, status, nextAction) => {
      const current = contracts();
      expect(
        current.mcpConfirmationDecisionInputSchema.safeParse({
          schemaVersion: current.MCP_CONFIRMATION_SCHEMA_VERSION,
          decision,
          operationSummaryDigest: pending.operationSummaryDigest,
        }).success,
      ).toBe(true);
      expect(
        current.mcpConfirmationDecisionResultSchema.safeParse({
          schemaVersion: current.MCP_CONFIRMATION_SCHEMA_VERSION,
          status,
          writeExecuted: false,
          nextAction,
        }).success,
      ).toBe(true);
    },
  );

  it.each([
    ['UNAUTHENTICATED', 401],
    ['RESOURCE_NOT_FOUND', 404],
    ['VALIDATION_FAILED', 400],
    ['CONFIRMATION_EXPIRED', 410],
    ['CONFIRMATION_STATE_CONFLICT', 409],
  ] as const)('keeps safe %s errors representable for HTTP %i', (code) => {
    expect(
      contracts().mcpConfirmationSafeErrorSchema.safeParse({
        schemaVersion: 'en-learning.mcp.confirmation.v1',
        code,
        message: 'The confirmation request could not be completed.',
      }).success,
    ).toBe(true);
  });

  it('rejects invalid decisions, digests, answer fields, tokens, and redirect URLs', () => {
    const schema = contracts().mcpConfirmationDecisionInputSchema;
    for (const candidate of [
      { decision: 'approve' },
      { operationSummaryDigest: 'short' },
      { answers: ['private'] },
      { accessToken: 'private-token' },
      { redirectUrl: 'https://attacker.invalid' },
    ]) {
      expect(
        schema.safeParse({
          schemaVersion: 'en-learning.mcp.confirmation.v1',
          decision: 'confirm',
          operationSummaryDigest: 'a'.repeat(64),
          ...candidate,
        }).success,
      ).toBe(false);
    }
  });
});
