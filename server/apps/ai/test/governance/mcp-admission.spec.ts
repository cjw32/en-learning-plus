import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

type AdmissionStore = {
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
};

type GovernanceModule = {
  McpAdmissionService: new (
    store: AdmissionStore,
    policy: {
      rateLimit: number;
      windowSeconds: number;
      concurrencyLimit: number;
      leaseTtlMs: number;
    },
  ) => {
    admit: (identity: {
      networkHmac: string;
      subjectHmac: string;
      clientHmac: string;
      capability: string;
    }) => Promise<{ release: () => Promise<void> }>;
  };
  McpExecutionBudget: new (input: {
    signal: AbortSignal;
    maxSteps: number;
    maxRecursionDepth: number;
    maxParallelCalls: number;
    maxInputBytes: number;
    maxResultBytes: number;
    maxDepth: number;
  }) => {
    assertInput: (value: unknown) => void;
    assertResult: (value: unknown) => void;
    runStep: <T>(
      input: { recursionDepth: number },
      operation: (signal: AbortSignal) => Promise<T>,
    ) => Promise<T>;
  };
  MCP_CAPABILITY_DEADLINES_MS: Readonly<Record<string, number>>;
};

const governanceRoot = resolve(__dirname, '../../src/mcp/governance');

function loadGovernance(): GovernanceModule {
  for (const file of [
    'mcp-admission.service.ts',
    'mcp-budget.ts',
    'mcp-deadline.ts',
  ]) {
    if (!existsSync(resolve(governanceRoot, file))) {
      throw new Error(`Missing MCP governance boundary: ${file} (T023)`);
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return {
    ...require(resolve(governanceRoot, 'mcp-admission.service.ts')),
    ...require(resolve(governanceRoot, 'mcp-budget.ts')),
    ...require(resolve(governanceRoot, 'mcp-deadline.ts')),
  } as GovernanceModule;
}

describe('MCP admission and execution budget', () => {
  it('isolates all rate and concurrency dimensions under mcp:* keys', async () => {
    const governance = loadGovernance();
    const consumed: string[] = [];
    const acquired: string[] = [];
    const released: string[] = [];
    const store: AdmissionStore = {
      consume: async (key) => {
        consumed.push(key);
        return { allowed: true };
      },
      acquireLease: async (key) => {
        acquired.push(key);
        return `lease-${acquired.length}`;
      },
      releaseLease: async (key) => {
        released.push(key);
      },
    };
    const service = new governance.McpAdmissionService(store, {
      rateLimit: 10,
      windowSeconds: 60,
      concurrencyLimit: 2,
      leaseTtlMs: 30_000,
    });
    const lease = await service.admit({
      networkHmac: 'network_hash_a',
      subjectHmac: 'subject_hash_a',
      clientHmac: 'client_hash_a',
      capability: 'search_words',
    });

    const expectedSuffixes = [
      'network:network_hash_a',
      'subject:subject_hash_a',
      'client:client_hash_a',
      'subject-client:subject_hash_a:client_hash_a',
      'capability:subject_hash_a:client_hash_a:search_words',
    ];
    expect(consumed).toEqual(
      expectedSuffixes.map((suffix) => `mcp:rate:${suffix}`),
    );
    expect(acquired).toEqual(
      expectedSuffixes.map((suffix) => `mcp:concurrency:${suffix}`),
    );
    expect(
      [...consumed, ...acquired].every((key) => key.startsWith('mcp:')),
    ).toBe(true);

    await lease.release();
    expect(released).toEqual(acquired);
  });

  it('pins the designed hard deadlines by capability class', () => {
    expect(loadGovernance().MCP_CAPABILITY_DEADLINES_MS).toEqual({
      discovery: 2_000,
      read: 3_000,
      rag: 5_000,
      report: 5_000,
      model: 30_000,
      write: 30_000,
    });
  });

  it('denies exhausted quota and releases partial concurrency leases', async () => {
    const governance = loadGovernance();
    const released: string[] = [];
    const store: AdmissionStore = {
      consume: async () => ({ allowed: true }),
      acquireLease: async (key) =>
        key.includes('client:client_hash_a') ? null : `lease:${key}`,
      releaseLease: async (key) => {
        released.push(key);
      },
    };
    const service = new governance.McpAdmissionService(store, {
      rateLimit: 10,
      windowSeconds: 60,
      concurrencyLimit: 2,
      leaseTtlMs: 30_000,
    });

    await expect(
      service.admit({
        networkHmac: 'network_hash_a',
        subjectHmac: 'subject_hash_a',
        clientHmac: 'client_hash_a',
        capability: 'search_words',
      }),
    ).rejects.toThrow(/concurrency|lease/i);
    expect(released).toEqual([
      'mcp:concurrency:network:network_hash_a',
      'mcp:concurrency:subject:subject_hash_a',
    ]);
  });

  it('rejects recursion, excessive depth, and oversized inputs/results', () => {
    const { McpExecutionBudget } = loadGovernance();
    const budget = new McpExecutionBudget({
      signal: new AbortController().signal,
      maxSteps: 1,
      maxRecursionDepth: 0,
      maxParallelCalls: 1,
      maxInputBytes: 128,
      maxResultBytes: 256 * 1024,
      maxDepth: 6,
    });

    expect(() =>
      budget.assertInput({
        nested: {
          one: { two: { three: { four: { five: { six: 'too deep' } } } } },
        },
      }),
    ).toThrow(/depth/i);
    expect(() => budget.assertInput({ text: 'x'.repeat(256) })).toThrow(
      /bytes|size/i,
    );
    expect(() => budget.assertResult({ text: 'x'.repeat(256 * 1024) })).toThrow(
      /bytes|size/i,
    );
  });

  it('starts no new downstream step after cancellation', async () => {
    const { McpExecutionBudget } = loadGovernance();
    const abort = new AbortController();
    const first = jest.fn(async () => 'first');
    const afterAbort = jest.fn(async () => 'should-not-run');
    const budget = new McpExecutionBudget({
      signal: abort.signal,
      maxSteps: 2,
      maxRecursionDepth: 0,
      maxParallelCalls: 1,
      maxInputBytes: 64 * 1024,
      maxResultBytes: 256 * 1024,
      maxDepth: 6,
    });

    await expect(budget.runStep({ recursionDepth: 0 }, first)).resolves.toBe(
      'first',
    );
    abort.abort();
    await expect(
      budget.runStep({ recursionDepth: 0 }, afterAbort),
    ).rejects.toThrow(/cancel|abort/i);
    expect(afterAbort).not.toHaveBeenCalled();
  });

  it('rejects recursion before executing the operation', async () => {
    const { McpExecutionBudget } = loadGovernance();
    const nested = jest.fn(async () => undefined);
    const budget = new McpExecutionBudget({
      signal: new AbortController().signal,
      maxSteps: 1,
      maxRecursionDepth: 0,
      maxParallelCalls: 1,
      maxInputBytes: 64 * 1024,
      maxResultBytes: 256 * 1024,
      maxDepth: 6,
    });

    await expect(budget.runStep({ recursionDepth: 1 }, nested)).rejects.toThrow(
      /recursion/i,
    );
    expect(nested).not.toHaveBeenCalled();
  });
});
