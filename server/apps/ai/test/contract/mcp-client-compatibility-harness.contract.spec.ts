import {
  MCP_CLIENT_MATRIX,
  validateClientMatrix,
} from '../compatibility/mcp-client-matrix';

describe('MCP four-client compatibility harness', () => {
  it('defines four independent, versioned clients with transcripts and expected capabilities', () => {
    expect(validateClientMatrix(MCP_CLIENT_MATRIX)).toBe(true);
    expect(MCP_CLIENT_MATRIX.map((entry) => entry.name)).toEqual([
      'Codex',
      'Claude Desktop',
      'Visual Studio Code',
      'MCP Inspector',
    ]);
    for (const entry of MCP_CLIENT_MATRIX) {
      expect(entry).toMatchObject({ status: 'PENDING' });
      expect(entry.configArtifact).not.toEqual(entry.transcriptArtifact);
      expect(entry.expectedCapabilities.length).toBeGreaterThan(0);
    }
  });

  it('does not infer one client pass from another client', () => {
    const partial = MCP_CLIENT_MATRIX.map((entry, index) => ({
      ...entry,
      status: index === 0 ? ('PASSED' as const) : entry.status,
    }));
    expect(validateClientMatrix(partial)).toBe(false);
  });
});
