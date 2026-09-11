export class McpExecutionBudgetError extends Error {
  readonly code: 'BUDGET_EXCEEDED' | 'CANCELLED';

  constructor(code: 'BUDGET_EXCEEDED' | 'CANCELLED', message: string) {
    super(message);
    this.name = 'McpExecutionBudgetError';
    this.code = code;
  }
}

export type McpExecutionBudgetOptions = Readonly<{
  signal: AbortSignal;
  maxSteps: number;
  maxRecursionDepth: number;
  maxParallelCalls: number;
  maxInputBytes: number;
  maxResultBytes: number;
  maxDepth: number;
}>;

function serializedBytes(value: unknown): number {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new McpExecutionBudgetError(
      'BUDGET_EXCEEDED',
      'MCP value cannot be serialized within the size budget',
    );
  }
  if (serialized === undefined) return 0;
  return Buffer.byteLength(serialized, 'utf8');
}

function valueDepth(value: unknown, currentDepth = 0): number {
  if (value === null || typeof value !== 'object') return currentDepth;
  const children = Array.isArray(value)
    ? value
    : Object.values(value as Record<string, unknown>);
  if (children.length === 0) return currentDepth + 1;
  return Math.max(
    ...children.map((child) => valueDepth(child, currentDepth + 1)),
  );
}

export class McpExecutionBudget {
  private stepsStarted = 0;
  private activeCalls = 0;

  constructor(private readonly options: McpExecutionBudgetOptions) {
    const numericOptions: Readonly<Record<string, number>> = {
      maxSteps: options.maxSteps,
      maxRecursionDepth: options.maxRecursionDepth,
      maxParallelCalls: options.maxParallelCalls,
      maxInputBytes: options.maxInputBytes,
      maxResultBytes: options.maxResultBytes,
      maxDepth: options.maxDepth,
    };
    for (const [name, value] of Object.entries(numericOptions)) {
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new McpExecutionBudgetError(
          'BUDGET_EXCEEDED',
          `${name} must be a non-negative integer`,
        );
      }
    }
  }

  assertInput(value: unknown): void {
    this.assertValue(value, this.options.maxInputBytes, 'input');
  }

  assertResult(value: unknown): void {
    this.assertValue(value, this.options.maxResultBytes, 'result');
  }

  async runStep<T>(
    input: Readonly<{ recursionDepth: number }>,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    this.assertNotCancelled();
    if (input.recursionDepth > this.options.maxRecursionDepth) {
      throw new McpExecutionBudgetError(
        'BUDGET_EXCEEDED',
        'MCP recursion depth exceeded',
      );
    }
    if (this.stepsStarted >= this.options.maxSteps) {
      throw new McpExecutionBudgetError(
        'BUDGET_EXCEEDED',
        'MCP step budget exceeded',
      );
    }
    if (this.activeCalls >= this.options.maxParallelCalls) {
      throw new McpExecutionBudgetError(
        'BUDGET_EXCEEDED',
        'MCP parallel call budget exceeded',
      );
    }

    this.stepsStarted += 1;
    this.activeCalls += 1;
    try {
      return await operation(this.options.signal);
    } finally {
      this.activeCalls -= 1;
    }
  }

  private assertValue(value: unknown, maxBytes: number, label: string): void {
    if (valueDepth(value) > this.options.maxDepth) {
      throw new McpExecutionBudgetError(
        'BUDGET_EXCEEDED',
        `MCP ${label} depth exceeded`,
      );
    }
    if (serializedBytes(value) > maxBytes) {
      throw new McpExecutionBudgetError(
        'BUDGET_EXCEEDED',
        `MCP ${label} byte size exceeded`,
      );
    }
  }

  private assertNotCancelled(): void {
    if (this.options.signal.aborted) {
      throw new McpExecutionBudgetError(
        'CANCELLED',
        'MCP execution was cancelled before the next step',
      );
    }
  }
}
