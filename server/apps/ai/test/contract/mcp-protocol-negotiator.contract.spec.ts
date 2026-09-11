import { McpProtocolNegotiator } from '../../src/mcp/transport/mcp-protocol-negotiator';

describe('MCP protocol-date negotiation contract', () => {
  const negotiator = new McpProtocolNegotiator();

  it.each([
    [
      'modern discovery',
      {
        method: 'server/discover',
        headerVersion: '2026-07-28',
        metadataVersion: '2026-07-28',
        hasSessionId: false,
      },
      { protocolVersion: '2026-07-28', era: 'modern' },
    ],
    [
      'modern request',
      {
        method: 'tools/list',
        headerVersion: '2026-07-28',
        metadataVersion: '2026-07-28',
        hasSessionId: false,
      },
      { protocolVersion: '2026-07-28', era: 'modern' },
    ],
    [
      'legacy initialize',
      {
        method: 'initialize',
        initializeVersion: '2025-11-25',
        hasSessionId: false,
      },
      { protocolVersion: '2025-11-25', era: 'legacy' },
    ],
    [
      'legacy session request',
      {
        method: 'tools/list',
        headerVersion: '2025-11-25',
        hasSessionId: true,
      },
      { protocolVersion: '2025-11-25', era: 'legacy' },
    ],
  ] as const)('accepts exactly %s', (_label, input, expected) => {
    expect(negotiator.negotiate(input)).toEqual(expected);
  });

  it.each([
    ['missing all version evidence', { method: 'tools/list' }],
    [
      'modern header without body metadata',
      { method: 'tools/list', headerVersion: '2026-07-28' },
    ],
    [
      'modern body metadata without header',
      { method: 'tools/list', metadataVersion: '2026-07-28' },
    ],
    [
      'mismatched modern header and body',
      {
        method: 'server/discover',
        headerVersion: '2026-07-28',
        metadataVersion: '2025-11-25',
      },
    ],
    [
      'ambiguous initialize evidence',
      {
        method: 'initialize',
        headerVersion: '2026-07-28',
        initializeVersion: '2025-11-25',
      },
    ],
    [
      'legacy date without initialize or a session',
      { method: 'tools/list', headerVersion: '2025-11-25' },
    ],
    [
      'legacy initialize with a session id',
      {
        method: 'initialize',
        initializeVersion: '2025-11-25',
        hasSessionId: true,
      },
    ],
    [
      'unknown future version',
      {
        method: 'tools/list',
        headerVersion: '2099-12-31',
        metadataVersion: '2099-12-31',
      },
    ],
    [
      'unsupported earlier version',
      {
        method: 'initialize',
        initializeVersion: '2025-06-18',
      },
    ],
  ] as const)('rejects %s without silently downgrading', (_label, input) => {
    expect(() => negotiator.negotiate(input)).toThrow(
      expect.objectContaining({ code: 'VALIDATION_FAILED' }),
    );
  });
});
