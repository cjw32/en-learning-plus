import {
  MCP_LEGACY_PROTOCOL_VERSION,
  MCP_MODERN_PROTOCOL_VERSION,
  type McpSupportedProtocolVersion,
} from '@en/common/mcp';

export type McpProtocolEra = 'modern' | 'legacy';

export type McpProtocolEvidence = Readonly<{
  method: string;
  headerVersion?: unknown;
  metadataVersion?: unknown;
  initializeVersion?: unknown;
  hasSessionId?: boolean;
}>;

export type McpProtocolNegotiation = Readonly<{
  protocolVersion: McpSupportedProtocolVersion;
  era: McpProtocolEra;
}>;

export class McpProtocolNegotiationError extends Error {
  readonly code = 'VALIDATION_FAILED' as const;

  constructor() {
    super('The MCP protocol version is missing, ambiguous, or unsupported.');
    this.name = 'McpProtocolNegotiationError';
  }
}

const MODERN_NEGOTIATION: McpProtocolNegotiation = Object.freeze({
  protocolVersion: MCP_MODERN_PROTOCOL_VERSION,
  era: 'modern',
});

const LEGACY_NEGOTIATION: McpProtocolNegotiation = Object.freeze({
  protocolVersion: MCP_LEGACY_PROTOCOL_VERSION,
  era: 'legacy',
});

export class McpProtocolNegotiator {
  negotiate(input: McpProtocolEvidence): McpProtocolNegotiation {
    const hasHeader = input.headerVersion !== undefined;
    const hasMetadata = input.metadataVersion !== undefined;
    const hasInitializeVersion = input.initializeVersion !== undefined;
    const hasSessionId = input.hasSessionId === true;

    if (input.method === 'initialize') {
      if (
        hasSessionId ||
        hasMetadata ||
        !hasInitializeVersion ||
        input.initializeVersion !== MCP_LEGACY_PROTOCOL_VERSION ||
        (hasHeader && input.headerVersion !== MCP_LEGACY_PROTOCOL_VERSION)
      ) {
        throw new McpProtocolNegotiationError();
      }
      return LEGACY_NEGOTIATION;
    }

    if (hasInitializeVersion) {
      throw new McpProtocolNegotiationError();
    }

    if (hasSessionId) {
      if (input.headerVersion !== MCP_LEGACY_PROTOCOL_VERSION || hasMetadata) {
        throw new McpProtocolNegotiationError();
      }
      return LEGACY_NEGOTIATION;
    }

    if (
      input.headerVersion !== MCP_MODERN_PROTOCOL_VERSION ||
      input.metadataVersion !== MCP_MODERN_PROTOCOL_VERSION
    ) {
      throw new McpProtocolNegotiationError();
    }

    return MODERN_NEGOTIATION;
  }
}
