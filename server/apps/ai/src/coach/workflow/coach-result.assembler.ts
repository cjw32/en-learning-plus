import {
  saveAttemptOutputSchema,
  type SaveAttemptOutput,
} from '@en/common/coach';

export type AssembledLearningUpdate = Readonly<{
  status: 'saved' | 'replayed' | 'not_saved';
  attemptId: string | null;
  changes: readonly Extract<
    SaveAttemptOutput,
    { ok: true }
  >['changes'][number][];
  savedAt: string | null;
}>;

const NOT_SAVED: AssembledLearningUpdate = Object.freeze({
  status: 'not_saved',
  attemptId: null,
  changes: Object.freeze([]),
  savedAt: null,
});

/** Projects only validated transaction output into the public result. */
export function assembleLearningUpdate(raw: unknown): AssembledLearningUpdate {
  const parsed = saveAttemptOutputSchema.safeParse(raw);
  if (!parsed.success || !parsed.data.ok) return NOT_SAVED;
  return Object.freeze({
    status: parsed.data.status,
    attemptId: parsed.data.attemptId,
    changes: Object.freeze(
      parsed.data.changes.map((change) => Object.freeze(change)),
    ),
    savedAt: parsed.data.savedAt,
  });
}
