import { hashCoachRequestBody } from '../api/coach-request.service';

export type CoachIdempotencyBinding<TResult> = {
  subjectId: string;
  operation: string;
  idempotencyKey: string;
  logicalResource: string;
  answerVersion: string | null;
  bodyHash: string;
  status: 'PENDING' | 'COMPLETED';
  result: TResult | null;
};

export interface CoachIdempotencyStore {
  reserve<TResult>(
    binding: CoachIdempotencyBinding<TResult>,
  ): Promise<{
    binding: CoachIdempotencyBinding<TResult>;
    created: boolean;
  }>;
  complete<TResult>(
    binding: CoachIdempotencyBinding<TResult>,
    result: TResult,
  ): Promise<CoachIdempotencyBinding<TResult>>;
  release<TResult>(binding: CoachIdempotencyBinding<TResult>): Promise<void>;
}

export class CoachIdempotencyError extends Error {
  constructor(
    readonly code: 'IDEMPOTENCY_CONFLICT' | 'STATE_CONFLICT',
    message: string,
  ) {
    super(message);
    this.name = 'CoachIdempotencyError';
  }
}

function sameBinding<TResult>(
  left: CoachIdempotencyBinding<TResult>,
  right: CoachIdempotencyBinding<TResult>,
): boolean {
  return (
    left.subjectId === right.subjectId &&
    left.operation === right.operation &&
    left.idempotencyKey === right.idempotencyKey &&
    left.logicalResource === right.logicalResource &&
    left.answerVersion === right.answerVersion &&
    left.bodyHash === right.bodyHash
  );
}

export class CoachIdempotencyService {
  constructor(private readonly store: CoachIdempotencyStore) {}

  async execute<TResult>(input: {
    subjectId: string;
    operation: string;
    idempotencyKey: string;
    logicalResource: string;
    answerVersion?: string;
    body: unknown;
    operationFn: () => Promise<TResult>;
  }): Promise<{ result: TResult; replayed: boolean }> {
    const proposed: CoachIdempotencyBinding<TResult> = {
      subjectId: input.subjectId,
      operation: input.operation,
      idempotencyKey: input.idempotencyKey,
      logicalResource: input.logicalResource,
      answerVersion: input.answerVersion ?? null,
      bodyHash: hashCoachRequestBody(input.body),
      status: 'PENDING',
      result: null,
    };
    const reservation = await this.store.reserve(proposed);
    if (!reservation.created) {
      if (!sameBinding(reservation.binding, proposed)) {
        throw new CoachIdempotencyError(
          'IDEMPOTENCY_CONFLICT',
          '幂等键已绑定到其他操作内容',
        );
      }
      if (
        reservation.binding.status === 'COMPLETED' &&
        reservation.binding.result !== null
      ) {
        return { result: reservation.binding.result, replayed: true };
      }
      throw new CoachIdempotencyError(
        'STATE_CONFLICT',
        '相同操作仍在处理中',
      );
    }

    try {
      const result = await input.operationFn();
      await this.store.complete(reservation.binding, result);
      return { result, replayed: false };
    } catch (error) {
      await this.store.release(reservation.binding);
      throw error;
    }
  }
}
