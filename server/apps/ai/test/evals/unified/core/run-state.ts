import {
  executionItemSchema,
  itemResultSchema,
  ExecutionItem,
  ItemResult,
} from '../contracts/run.schema';

export function createRunState(input: readonly ExecutionItem[]) {
  const planned = input.map((item) => executionItemSchema.parse(item));
  if (
    !planned.length ||
    new Set(planned.map((i) => i.itemId)).size !== planned.length
  )
    throw Error('INVALID_PLAN');
  const results = new Map<string, ItemResult>();
  let finalized = false;
  return {
    finish(value: ItemResult) {
      if (finalized) throw Error('RUN_FINISHED');
      const result = itemResultSchema.parse(value);
      const item = planned.find((i) => i.itemId === result.itemId);
      if (!item || results.has(result.itemId))
        throw Error('UNKNOWN_OR_TERMINAL_ITEM');
      for (const key of Object.keys(item) as Array<keyof ExecutionItem>)
        if (item[key] !== result[key]) throw Error('FROZEN_PLAN_MISMATCH');
      if (
        result.terminalState === 'passed' &&
        result.allAttempts.length < item.expectedRepeatCount
      )
        throw Error('REPEATS_MISSING');
      results.set(result.itemId, structuredClone(result));
    },
    finalize(): ItemResult[] {
      finalized = true;
      return planned.map((item) =>
        structuredClone(
          results.get(item.itemId) ?? {
            ...item,
            terminalState: 'not_run',
            reasonCodes: ['REQUIRED_ITEM_MISSING'],
            allAttempts: [],
            requirements: [
              { spec: '005-unified-ai-evaluation', ids: ['FR-031'] },
            ],
            expectedRef: null,
            actualRef: null,
            evidenceRefs: [],
            steps: [],
          },
        ),
      );
    },
  };
}
