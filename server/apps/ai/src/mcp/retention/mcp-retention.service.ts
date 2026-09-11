import { Injectable } from '@nestjs/common';
import { PrismaService } from '@libs/shared';

export interface McpRetentionPort {
  expireLegacySessions(now: Date): Promise<unknown>;
  expirePendingConfirmations(now: Date, cleanupBefore: Date): Promise<unknown>;
  deleteExpiredTraces(now: Date): Promise<unknown>;
  deleteExpiredAuthorizations(now: Date): Promise<unknown>;
}

export type McpRetentionOptions = Readonly<{
  diagnosticsEnabled?: boolean;
  requestedDiagnosticsDays?: number;
}>;

const DAY_MS = 24 * 60 * 60 * 1_000;

@Injectable()
export class McpRetentionService {
  private readonly retention;
  constructor(
    private readonly repository: McpRetentionPort,
    options: McpRetentionOptions = {},
  ) {
    const enabled = options.diagnosticsEnabled === true;
    const requested = Number.isInteger(options.requestedDiagnosticsDays)
      ? Number(options.requestedDiagnosticsDays)
      : 0;
    this.retention = Object.freeze({
      diagnosticsEnabled: enabled,
      diagnosticsDays: enabled ? Math.min(7, Math.max(1, requested)) : 0,
      pendingCleanupHours: 24,
    });
  }

  policy() {
    return this.retention;
  }

  async run(now = new Date()) {
    const cleanupBefore = new Date(now.getTime() - DAY_MS);
    const results = await Promise.all([
      this.repository.expireLegacySessions(now),
      this.repository.expirePendingConfirmations(now, cleanupBefore),
      this.repository.deleteExpiredTraces(now),
      this.repository.deleteExpiredAuthorizations(now),
    ]);
    return Object.freeze({
      ranAt: now.toISOString(),
      operations: results.length,
    });
  }
}

@Injectable()
export class PrismaMcpRetentionRepository implements McpRetentionPort {
  constructor(private readonly prisma: PrismaService) {}
  // Redis sessions are individually TTL-bound; there is deliberately no broad key scan.
  expireLegacySessions(): Promise<number> {
    return Promise.resolve(0);
  }
  expirePendingConfirmations(now: Date, cleanupBefore: Date) {
    return this.prisma.mcpWriteConfirmation.updateMany({
      where: {
        state: { in: ['PENDING', 'CONFIRMED', 'CLAIMED'] },
        expiresAt: { lte: now },
        createdAt: { lte: cleanupBefore },
      },
      data: { state: 'EXPIRED' },
    });
  }
  deleteExpiredTraces(now: Date) {
    return this.prisma.mcpTrace.deleteMany({
      where: { retentionExpiresAt: { lte: now } },
    });
  }
  deleteExpiredAuthorizations(now: Date) {
    return this.prisma.mcpClientAuthorization.deleteMany({
      where: {
        status: { in: ['REVOKED', 'DELETING'] },
        retentionExpiresAt: { lte: now },
      },
    });
  }
}
