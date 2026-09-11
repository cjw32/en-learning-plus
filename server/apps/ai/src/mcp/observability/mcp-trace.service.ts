import { Injectable } from '@nestjs/common';
import { hashMcpIdentifier, redactMcpDiagnostic } from './mcp-redaction';

export type McpTraceSink = Readonly<{
  save: (trace: unknown) => Promise<void>;
}>;

const TRACE_FACT_KEYS = Object.freeze([
  'traceId',
  'requestId',
  'authorizationId',
  'authorizationVersion',
  'protocolEra',
  'protocolVersion',
  'transport',
  'protocolMethod',
  'capabilityType',
  'capabilityName',
  'capabilityVersion',
  'capabilityEffect',
  'schemaValidated',
  'terminalStatus',
  'safeErrorCode',
  'retryCount',
  'cancelled',
  'timedOut',
  'inputTokens',
  'outputTokens',
  'estimatedCostMicros',
  'outputBytes',
  'writeOutcome',
] as const);

@Injectable()
export class McpTraceService {
  constructor(
    private readonly repository: McpTraceSink,
    private readonly hmacKey: string,
  ) {}

  async record(input: Record<string, unknown>): Promise<void> {
    const trace: Record<string, unknown> = {};
    for (const key of TRACE_FACT_KEYS) {
      if (input[key] !== undefined) trace[key] = input[key];
    }
    if (typeof input.subject === 'string') {
      trace.subjectHmac = hashMcpIdentifier(input.subject, this.hmacKey);
    }
    if (typeof input.clientId === 'string') {
      trace.clientHmac = hashMcpIdentifier(input.clientId, this.hmacKey);
    }
    const diagnostics = redactMcpDiagnostic(input.diagnostic);
    if (
      diagnostics &&
      typeof diagnostics === 'object' &&
      Object.keys(diagnostics).length > 0
    ) {
      trace.diagnostic = diagnostics;
    }

    await this.repository.save(Object.freeze(trace));
  }

  async recordPromptFetch(
    input: Readonly<{
      traceId: string;
      requestId: string;
      authorizationId: string;
      authorizationVersion: number;
      subject: string;
      clientId: string;
      protocolEra: 'MODERN_2026_07_28' | 'LEGACY_2025_11_25';
      protocolVersion: string;
      promptName: string;
      promptVersion: string;
      outcome: 'COMPLETED' | 'REJECTED' | 'CANCELLED' | 'FAILED';
      durationMs: number;
      outputBytes: number;
    }>,
  ): Promise<void> {
    await this.record({
      traceId: input.traceId,
      requestId: input.requestId,
      authorizationId: input.authorizationId,
      authorizationVersion: input.authorizationVersion,
      subject: input.subject,
      clientId: input.clientId,
      protocolEra: input.protocolEra,
      protocolVersion: input.protocolVersion,
      transport: 'STREAMABLE_HTTP',
      protocolMethod: 'prompts/get',
      capabilityType: 'PROMPT',
      capabilityName: input.promptName,
      capabilityVersion: input.promptVersion,
      capabilityEffect: 'PROMPT_ONLY',
      schemaValidated: input.outcome === 'COMPLETED',
      terminalStatus: input.outcome,
      retryCount: 0,
      cancelled: input.outcome === 'CANCELLED',
      timedOut: false,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostMicros: 0,
      outputBytes: input.outputBytes,
      writeOutcome: 'none',
      diagnostic: {
        component: 'mcp-prompt-registry',
        capabilityName: input.promptName,
        version: input.promptVersion,
        status: input.outcome,
        durationMs: input.durationMs,
        outputBytes: input.outputBytes,
        inputTokens: 0,
        outputTokens: 0,
        costMicros: 0,
        writeOutcome: 'none',
      },
    });
  }
}
