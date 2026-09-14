import { z } from '@en/common/coach/zod';
import {
  idSchema,
  hashSchema,
  timeSchema,
  contentRefSchema,
  modeSchema,
} from './case.schema';
export const replaySchema = z
  .strictObject({
    schemaVersion: z.literal('ai-eval-replay.v1'),
    caseId: idSchema,
    subjectAlias: idSchema,
    inputHash: hashSchema,
    sourceVersion: idSchema,
    sourceMode: modeSchema,
    sourceRunId: idSchema,
    provenance: z.enum(['synthetic', 'authorized']),
    authorizationRef: contentRefSchema.nullable(),
    output: z.json(),
    outputHash: hashSchema,
    recordedAt: timeSchema,
  })
  .refine((v) => v.provenance !== 'authorized' || v.authorizationRef !== null);
