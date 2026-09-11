import { Injectable } from '@nestjs/common';
import { PrismaService } from '@libs/shared';

export type McpOperationalActor = Readonly<{ roles: readonly string[] }>;
export type McpQueryableTrace = Readonly<
  Record<string, unknown> & {
    traceId: string;
    requestId?: string;
    authorizationId?: string;
    capabilityName: string;
    protocolVersion: string;
    terminalStatus: string;
    inputTokens: number;
    outputTokens: number;
    estimatedCostMicros: number;
    startedAt: Date;
    finishedAt?: Date | null;
    steps: readonly Readonly<
      Record<string, unknown> & {
        sequence: number;
        stepType: string;
        component: string;
        operation: string;
        status: string;
        durationMs?: number | null;
        safeErrorCode?: string | null;
      }
    >[];
  }
>;

export interface McpTraceQueryPort {
  findByTraceId(traceId: string): Promise<McpQueryableTrace | null>;
}

export class McpTraceQueryError extends Error {
  constructor(readonly code: 'FORBIDDEN' | 'NOT_FOUND' | 'INVALID_TRACE_ID') {
    super(code === 'NOT_FOUND' ? 'Trace not found' : 'Trace query denied');
  }
}

const TRACE_ID = /^[A-Za-z0-9_-]{6,128}$/u;

@Injectable()
export class McpTraceQueryService {
  constructor(private readonly repository: McpTraceQueryPort) {}

  async get(actor: McpOperationalActor, traceId: string) {
    if (!actor.roles.includes('mcp:diagnostics:read'))
      throw new McpTraceQueryError('FORBIDDEN');
    if (!TRACE_ID.test(traceId))
      throw new McpTraceQueryError('INVALID_TRACE_ID');
    const row = await this.repository.findByTraceId(traceId);
    if (!row) throw new McpTraceQueryError('NOT_FOUND');
    const finished = row.finishedAt?.getTime();
    return Object.freeze({
      traceId: row.traceId,
      requestId: typeof row.requestId === 'string' ? row.requestId : undefined,
      authorizationId:
        typeof row.authorizationId === 'string'
          ? row.authorizationId
          : undefined,
      capabilityName: row.capabilityName,
      protocolVersion: row.protocolVersion,
      terminalStatus: row.terminalStatus,
      totalDurationMs:
        finished === undefined
          ? null
          : Math.max(0, finished - row.startedAt.getTime()),
      usage: Object.freeze({
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        estimatedCostMicros: row.estimatedCostMicros,
      }),
      stages: Object.freeze(
        row.steps.map((step) =>
          Object.freeze({
            sequence: step.sequence,
            type: step.stepType,
            component: step.component,
            operation: step.operation,
            status: step.status,
            durationMs: step.durationMs ?? null,
            safeErrorCode: step.safeErrorCode ?? null,
          }),
        ),
      ),
    });
  }
}

@Injectable()
export class PrismaMcpTraceQueryRepository implements McpTraceQueryPort {
  constructor(private readonly prisma: PrismaService) {}

  findByTraceId(traceId: string): Promise<McpQueryableTrace | null> {
    return this.prisma.mcpTrace
      .findUnique({
        where: { traceId },
        select: {
          traceId: true,
          authorizationId: true,
          capabilityName: true,
          protocolVersion: true,
          terminalStatus: true,
          inputTokens: true,
          outputTokens: true,
          estimatedCostMicros: true,
          startedAt: true,
          finishedAt: true,
          invocation: { select: { id: true } },
          steps: {
            orderBy: { sequence: 'asc' },
            select: {
              sequence: true,
              stepType: true,
              component: true,
              operation: true,
              status: true,
              durationMs: true,
              safeErrorCode: true,
            },
          },
        },
      })
      .then((row) =>
        row
          ? ({
              ...row,
              requestId: row.invocation.id,
            } as unknown as McpQueryableTrace)
          : null,
      );
  }
}
