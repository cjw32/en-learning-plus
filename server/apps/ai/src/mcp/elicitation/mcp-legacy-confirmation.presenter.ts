import {
  mcpConfirmationSelectorSchema,
  mcpLegacyConfirmationElicitationSchema,
} from '@en/common/mcp';
import type { McpConfirmationProjectionInput } from './mcp-modern-confirmation.presenter';

export type McpLegacyConfirmationPresenterOptions = Readonly<{
  confirmationPageOrigin: string;
  sessionBinding: Readonly<{
    bind(
      input: Readonly<{
        elicitationId: string;
        confirmationId: string;
        sessionId: string;
        expiresAt: Date;
      }>,
    ): Promise<void>;
  }>;
}>;

export class McpLegacyConfirmationPresentationError extends Error {
  readonly code = 'VALIDATION_FAILED';

  constructor() {
    super('The confirmation request could not be presented.');
    this.name = 'McpLegacyConfirmationPresentationError';
  }
}

function approvedOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new McpLegacyConfirmationPresentationError();
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new McpLegacyConfirmationPresentationError();
  }
  return url.origin;
}

function validBounded(
  value: unknown,
  minimum: number,
  maximum: number,
): value is string {
  return (
    typeof value === 'string' &&
    value.length >= minimum &&
    value.length <= maximum
  );
}

export class McpLegacyConfirmationPresenter {
  private readonly confirmationPageOrigin: string;

  constructor(private readonly options: McpLegacyConfirmationPresenterOptions) {
    this.confirmationPageOrigin = approvedOrigin(
      options.confirmationPageOrigin,
    );
  }

  async present(
    input: McpConfirmationProjectionInput & Readonly<{ sessionId: string }>,
  ) {
    if (
      input.context.protocolVersion !== '2025-11-25' ||
      !validBounded(input.confirmationId, 10, 128) ||
      !validBounded(input.elicitationId, 10, 128) ||
      !validBounded(input.sessionId, 10, 256) ||
      !mcpConfirmationSelectorSchema.safeParse(input.selector).success ||
      !(input.expiresAt instanceof Date) ||
      Number.isNaN(input.expiresAt.getTime())
    ) {
      throw new McpLegacyConfirmationPresentationError();
    }
    await this.options.sessionBinding.bind({
      elicitationId: input.elicitationId,
      confirmationId: input.confirmationId,
      sessionId: input.sessionId,
      expiresAt: input.expiresAt,
    });
    const result = mcpLegacyConfirmationElicitationSchema.safeParse({
      code: -32042,
      message: 'This request requires confirmation.',
      data: {
        elicitations: [
          {
            mode: 'url',
            elicitationId: input.elicitationId,
            url: `${this.confirmationPageOrigin}/mcp/confirmations/${encodeURIComponent(
              input.selector,
            )}`,
            message:
              'Review and confirm this learning update in en-learning-plus.',
          },
        ],
      },
    });
    if (!result.success) {
      throw new McpLegacyConfirmationPresentationError();
    }
    return Object.freeze(result.data);
  }
}
