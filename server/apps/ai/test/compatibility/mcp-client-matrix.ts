export type McpClientMatrixEntry = Readonly<{
  name: 'Codex' | 'Claude Desktop' | 'Visual Studio Code' | 'MCP Inspector';
  matrixVersion: 'mcp-client-matrix.v1';
  protocolVersion: '2026-07-28' | '2025-11-25';
  configArtifact: string;
  transcriptArtifact: string;
  expectedCapabilities: readonly string[];
  status: 'PENDING' | 'PASSED' | 'FAILED';
}>;

export const MCP_CLIENT_MATRIX: readonly McpClientMatrixEntry[] = Object.freeze(
  [
    {
      name: 'Codex',
      matrixVersion: 'mcp-client-matrix.v1',
      protocolVersion: '2026-07-28',
      configArtifact: 'clients/codex/config.redacted.json',
      transcriptArtifact: 'clients/codex/transcript.jsonl',
      expectedCapabilities: [
        'resources',
        'tools',
        'prompts',
        'url-elicitation',
      ],
      status: 'PENDING',
    },
    {
      name: 'Claude Desktop',
      matrixVersion: 'mcp-client-matrix.v1',
      protocolVersion: '2025-11-25',
      configArtifact: 'clients/claude-desktop/config.redacted.json',
      transcriptArtifact: 'clients/claude-desktop/transcript.jsonl',
      expectedCapabilities: [
        'resources',
        'tools',
        'prompts',
        'url-elicitation',
      ],
      status: 'PENDING',
    },
    {
      name: 'Visual Studio Code',
      matrixVersion: 'mcp-client-matrix.v1',
      protocolVersion: '2026-07-28',
      configArtifact: 'clients/vscode/config.redacted.json',
      transcriptArtifact: 'clients/vscode/transcript.jsonl',
      expectedCapabilities: ['resources', 'tools', 'prompts'],
      status: 'PENDING',
    },
    {
      name: 'MCP Inspector',
      matrixVersion: 'mcp-client-matrix.v1',
      protocolVersion: '2026-07-28',
      configArtifact: 'clients/mcp-inspector/config.redacted.json',
      transcriptArtifact: 'clients/mcp-inspector/transcript.jsonl',
      expectedCapabilities: [
        'resources',
        'tools',
        'prompts',
        'url-elicitation',
      ],
      status: 'PENDING',
    },
  ],
);

export function validateClientMatrix(entries: readonly McpClientMatrixEntry[]) {
  const expected = [
    'Codex',
    'Claude Desktop',
    'Visual Studio Code',
    'MCP Inspector',
  ];
  return (
    entries.length === expected.length &&
    expected.every((name) => entries.some((item) => item.name === name)) &&
    entries.every(
      (item) =>
        item.matrixVersion === 'mcp-client-matrix.v1' &&
        item.configArtifact !== item.transcriptArtifact &&
        item.expectedCapabilities.length > 0 &&
        item.status === entries[0].status,
    )
  );
}
