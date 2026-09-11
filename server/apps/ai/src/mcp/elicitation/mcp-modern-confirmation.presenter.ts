import {
  mcpConfirmationSelectorSchema,
  mcpModernConfirmationElicitationSchema,
} from '@en/common/mcp';
import type { McpRequestContext } from '../auth/mcp-principal';

export type McpConfirmationProjectionInput = Readonly<{
  confirmationId: string;
  selector: string;
  elicitationId: string;
  intentDigest: string;
  expiresAt: Date;
  context: McpRequestContext;
}>;

export type McpModernConfirmationRequestState = Readonly<{
  confirmationId: string;
  intentDigest: string;
  expiresAtEpochMs: number;
}>;

export type McpModernConfirmationRequestBinding = Readonly<{
  issuer: string;
  subject: string;
  clientId: string;
  requestId: string;
}>;

export type McpModernConfirmationPresenterOptions = Readonly<{
  confirmationPageOrigin: string;
  requestStateCodec: Readonly<{
    mint(
      state: McpModernConfirmationRequestState,
      binding: McpModernConfirmationRequestBinding,
    ): Promise<string>;
  }>;
}>;

export class McpModernConfirmationPresentationError extends Error {
  readonly code = 'VALIDATION_FAILED';

  constructor() {
    super('The confirmation request could not be presented.');
    this.name = 'McpModernConfirmationPresentationError';
  }
}

function approvedOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new McpModernConfirmationPresentationError();
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new McpModernConfirmationPresentationError();
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

export class McpModernConfirmationPresenter {
  private readonly confirmationPageOrigin: string;

  constructor(private readonly options: McpModernConfirmationPresenterOptions) {
    this.confirmationPageOrigin = approvedOrigin(
      options.confirmationPageOrigin,
    );
  }

  async present(input: McpConfirmationProjectionInput) {
    if (
      input.context.protocolVersion !== '2026-07-28' ||
      !validBounded(input.confirmationId, 10, 128) ||
      !mcpConfirmationSelectorSchema.safeParse(input.selector).success ||
      !/^[a-f0-9]{32,128}$/u.test(input.intentDigest) ||
      !(input.expiresAt instanceof Date) ||
      Number.isNaN(input.expiresAt.getTime()) ||
      !validBounded(input.context.principal.issuer, 1, 512) ||
      !validBounded(input.context.principal.subject, 1, 512) ||
      !validBounded(input.context.principal.clientId, 1, 512) ||
      !validBounded(input.context.requestId, 1, 128)
    ) {
      throw new McpModernConfirmationPresentationError();
    }
    const requestState = await this.options.requestStateCodec.mint(
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
    const result = mcpModernConfirmationElicitationSchema.safeParse({
      resultType: 'input_required',
      inputRequests: {
        confirm_submission: {
          method: 'elicitation/create',
          params: {
            mode: 'url',
            url: `${this.confirmationPageOrigin}/mcp/confirmations/${encodeURIComponent(
              input.selector,
            )}`,
            message:
              'Review and confirm this learning update in en-learning-plus.',
          },
        },
      },
      requestState,
    });
    if (!result.success) {
      throw new McpModernConfirmationPresentationError();
    }
    return Object.freeze(result.data);
  }
}
