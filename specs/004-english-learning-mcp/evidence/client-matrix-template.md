# MCP client compatibility matrix

Matrix version: `mcp-client-matrix.v1`
Status: **PENDING — requires GATE-B/D/E and independent client execution**

| Client | Protocol | Redacted config | Transcript | Expected capabilities | Status |
| --- | --- | --- | --- | --- | --- |
| Codex | 2026-07-28 | `clients/codex/config.redacted.json` | `clients/codex/transcript.jsonl` | resources, tools, prompts, URL elicitation | PENDING |
| Claude Desktop | 2025-11-25 | `clients/claude-desktop/config.redacted.json` | `clients/claude-desktop/transcript.jsonl` | resources, tools, prompts, URL elicitation | PENDING |
| Visual Studio Code | 2026-07-28 | `clients/vscode/config.redacted.json` | `clients/vscode/transcript.jsonl` | resources, tools, prompts | PENDING |
| MCP Inspector | 2026-07-28 | `clients/mcp-inspector/config.redacted.json` | `clients/mcp-inspector/transcript.jsonl` | resources, tools, prompts, URL elicitation | PENDING |

Each row must be executed independently. A passing row cannot be copied, inferred, or substituted for another client. Store only redacted configuration and transcripts; record client version, date, operator, fixture/rubric version, outcome, and artifact hash.
