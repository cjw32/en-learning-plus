import { Injectable } from '@nestjs/common';

export type McpAdmissionStore = Readonly<{
  consume: (
    key: string,
    limit: number,
    windowSeconds: number,
  ) => Promise<Readonly<{ allowed: boolean; retryAfterSeconds?: number }>>;
  acquireLease: (
    key: string,
    limit: number,
    ttlMs: number,
  ) => Promise<string | null>;
  releaseLease: (key: string, leaseId: string) => Promise<void>;
}>;

export type McpAdmissionIdentity = Readonly<{
  networkHmac: string;
  subjectHmac: string;
  clientHmac: string;
  capability: string;
}>;

export type McpAdmissionPolicy = Readonly<{
  rateLimit: number;
  windowSeconds: number;
  concurrencyLimit: number;
  leaseTtlMs: number;
}>;

export class McpAdmissionError extends Error {
  constructor(
    readonly code: 'RATE_LIMITED' | 'CONCURRENCY_LIMITED',
    readonly retryAfterSeconds?: number,
  ) {
    super(
      code === 'RATE_LIMITED'
        ? 'MCP rate quota exhausted'
        : 'MCP concurrency lease unavailable',
    );
    this.name = 'McpAdmissionError';
  }
}

function safeSegment(value: string): string {
  if (!/^[A-Za-z0-9_.-]{1,128}$/.test(value)) {
    throw new McpAdmissionError('RATE_LIMITED');
  }
  return value;
}

export function buildMcpAdmissionKeySuffixes(
  identity: McpAdmissionIdentity,
): readonly string[] {
  const network = safeSegment(identity.networkHmac);
  const subject = safeSegment(identity.subjectHmac);
  const client = safeSegment(identity.clientHmac);
  const capability = safeSegment(identity.capability);
  return Object.freeze([
    `network:${network}`,
    `subject:${subject}`,
    `client:${client}`,
    `subject-client:${subject}:${client}`,
    `capability:${subject}:${client}:${capability}`,
  ]);
}

@Injectable()
export class McpAdmissionService {
  constructor(
    private readonly store: McpAdmissionStore,
    private readonly policy: McpAdmissionPolicy,
  ) {}

  async admit(
    identity: McpAdmissionIdentity,
  ): Promise<Readonly<{ release: () => Promise<void> }>> {
    const suffixes = buildMcpAdmissionKeySuffixes(identity);
    for (const suffix of suffixes) {
      const result = await this.store.consume(
        `mcp:rate:${suffix}`,
        this.policy.rateLimit,
        this.policy.windowSeconds,
      );
      if (!result.allowed) {
        throw new McpAdmissionError('RATE_LIMITED', result.retryAfterSeconds);
      }
    }

    const leases: Array<Readonly<{ key: string; id: string }>> = [];
    try {
      for (const suffix of suffixes) {
        const key = `mcp:concurrency:${suffix}`;
        const id = await this.store.acquireLease(
          key,
          this.policy.concurrencyLimit,
          this.policy.leaseTtlMs,
        );
        if (!id) throw new McpAdmissionError('CONCURRENCY_LIMITED');
        leases.push(Object.freeze({ key, id }));
      }
    } catch (error) {
      await Promise.all(
        leases.map((lease) => this.store.releaseLease(lease.key, lease.id)),
      );
      throw error;
    }

    let released = false;
    return Object.freeze({
      release: async () => {
        if (released) return;
        released = true;
        await Promise.all(
          leases.map((lease) => this.store.releaseLease(lease.key, lease.id)),
        );
      },
    });
  }
}
