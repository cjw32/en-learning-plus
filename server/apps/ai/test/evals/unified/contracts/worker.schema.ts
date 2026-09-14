import { z } from '@en/common/coach/zod';
import { idSchema } from './case.schema';
import { itemResultSchema } from './run.schema';
import { budgetReservationSchema } from './evidence.schema';

export const callRequestSchema = budgetReservationSchema.omit({
  state: true,
  actualCostMicros: true,
  uncertainReason: true,
});
export const workerMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('result'),
    itemId: idSchema,
    result: itemResultSchema,
  }),
  z.strictObject({
    type: z.literal('reserve'),
    itemId: idSchema,
    call: callRequestSchema,
  }),
  z.strictObject({
    type: z.literal('error'),
    itemId: idSchema,
    reason: idSchema,
  }),
]);
