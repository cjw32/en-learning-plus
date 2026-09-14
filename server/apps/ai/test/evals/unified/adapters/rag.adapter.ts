import type { RagLearningMaterialSearchService } from '../../../../src/knowledge/retrieval/rag-learning-material-search.service';
import { createHash } from 'node:crypto';

// Observation-only adapter: input never includes gold/expected values. The trusted
// worker owns service composition and call admission, not a user-provided script.
export async function observe(
  input: unknown,
  context: {
    mode: 'deterministic' | 'mock' | 'replay' | 'live';
    invoke: (input: any) => Promise<unknown>;
    dependencyKind?: 'real' | 'mock' | 'replay' | 'none';
    beforeCall?: () => Promise<void>;
  },
) {
  if (
    context.mode === 'live' &&
    (context.dependencyKind !== 'real' || !context.beforeCall)
  )
    return {
      output: null,
      actualMode: 'live',
      dependencyKind: context.dependencyKind ?? 'none',
      errorCategory: 'DEPENDENCY_UNAVAILABLE',
    };
  const started = performance.now();
  if (context.beforeCall) await context.beforeCall();
  const output = await context.invoke(input);
  return {
    output,
    actualMode: context.mode,
    dependencyKind:
      context.dependencyKind ??
      (context.mode === 'mock'
        ? 'mock'
        : context.mode === 'replay'
          ? 'replay'
          : 'none'),
    durationMs: Math.max(0, performance.now() - started),
    inputHash: createHash('sha256').update(JSON.stringify(input)).digest('hex'),
    outputHash: createHash('sha256')
      .update(JSON.stringify(output))
      .digest('hex'),
    errorCategory: null,
  };
}

export async function executeBusiness(
  service: Pick<RagLearningMaterialSearchService, 'search'>,
  args: Parameters<RagLearningMaterialSearchService['search']>,
  context: Omit<Parameters<typeof observe>[1], 'invoke'>,
) {
  return observe(args, { ...context, invoke: () => service.search(...args) });
}
