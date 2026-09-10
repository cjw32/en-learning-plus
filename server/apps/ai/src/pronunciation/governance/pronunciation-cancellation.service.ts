import { Inject, Injectable } from '@nestjs/common';
import type { PronunciationAssessmentStatus } from '@en/common/pronunciation';
import { PrismaService } from '@libs/shared';
import { PronunciationRedisConnection } from './pronunciation-redis.module';

export const PRONUNCIATION_CANCELLATION_REPOSITORY = Symbol(
  'PRONUNCIATION_CANCELLATION_REPOSITORY',
);
export const PRONUNCIATION_CANCELLATION_SIGNAL_STORE = Symbol(
  'PRONUNCIATION_CANCELLATION_SIGNAL_STORE',
);

const cancellableStatuses: readonly PronunciationAssessmentStatus[] = [
  'CREATED',
  'AUDIO_VALIDATING',
  'AUDIO_READY',
  'QUEUED',
  'PROCESSING',
];

export type PronunciationCancellationState = Readonly<{
  id: string;
  status: PronunciationAssessmentStatus;
  cancelRequestedAt: Date | null;
  providerAccepted: boolean | null;
  learningSaved: boolean;
}>;

export interface PronunciationCancellationRepository {
  findOwned(
    subjectId: string,
    assessmentId: string,
  ): Promise<PronunciationCancellationState | null>;
  markCancellationRequested(
    input: Readonly<{
      subjectId: string;
      assessmentId: string;
      requestedAt: Date;
    }>,
  ): Promise<boolean>;
}

export interface PronunciationCancellationSignalStore {
  set(assessmentId: string): Promise<void>;
  has(assessmentId: string): Promise<boolean>;
}

export class PronunciationCancellationError extends Error {
  constructor(
    readonly code:
      | 'VALIDATION_FAILED'
      | 'RESOURCE_NOT_FOUND'
      | 'CANCELLED'
      | 'STATE_CONFLICT',
  ) {
    super(code);
    this.name = 'PronunciationCancellationError';
  }
}

@Injectable()
export class PrismaPronunciationCancellationRepository implements PronunciationCancellationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findOwned(subjectId: string, assessmentId: string) {
    const row = await this.prisma.pronunciationAssessment.findFirst({
      where: { id: assessmentId, userId: subjectId, hiddenAt: null },
      select: {
        id: true,
        status: true,
        cancelRequestedAt: true,
        learningAttempt: { select: { id: true } },
        providerCalls: {
          orderBy: { attemptNo: 'desc' },
          take: 1,
          select: { providerAccepted: true },
        },
      },
    });
    return row
      ? Object.freeze({
          id: row.id,
          status: row.status,
          cancelRequestedAt: row.cancelRequestedAt,
          providerAccepted: row.providerCalls[0]?.providerAccepted ?? null,
          learningSaved: Boolean(row.learningAttempt),
        })
      : null;
  }

  async markCancellationRequested(
    input: Readonly<{
      subjectId: string;
      assessmentId: string;
      requestedAt: Date;
    }>,
  ): Promise<boolean> {
    const updated = await this.prisma.pronunciationAssessment.updateMany({
      where: {
        id: input.assessmentId,
        userId: input.subjectId,
        hiddenAt: null,
        status: { in: [...cancellableStatuses] },
      },
      data: {
        cancelRequestedAt: input.requestedAt,
        status: 'CANCELLED',
        finishedAt: input.requestedAt,
        publicErrorCode: 'CANCELLED',
      },
    });
    return updated.count === 1;
  }
}

type CancellationRedisClient = {
  set(key: string, value: string, mode: 'EX', ttl: number): Promise<unknown>;
  publish(channel: string, message: string): Promise<unknown>;
  exists(key: string): Promise<number>;
};

@Injectable()
export class RedisPronunciationCancellationSignalStore implements PronunciationCancellationSignalStore {
  constructor(private readonly connection: PronunciationRedisConnection) {}

  async set(assessmentId: string): Promise<void> {
    await this.connection.assertReady();
    const redis =
      this.connection.getClient() as unknown as CancellationRedisClient;
    await redis.set(`pronunciation:cancel:${assessmentId}`, '1', 'EX', 3_600);
    await redis.publish('pronunciation:cancellations', assessmentId);
  }

  async has(assessmentId: string): Promise<boolean> {
    await this.connection.assertReady();
    const redis =
      this.connection.getClient() as unknown as CancellationRedisClient;
    return (await redis.exists(`pronunciation:cancel:${assessmentId}`)) === 1;
  }
}

export class InMemoryPronunciationCancellationSignalStore implements PronunciationCancellationSignalStore {
  private readonly cancelled = new Set<string>();
  // The in-memory port deliberately completes synchronously.
  // eslint-disable-next-line @typescript-eslint/require-await
  async set(assessmentId: string): Promise<void> {
    this.cancelled.add(assessmentId);
  }
  // eslint-disable-next-line @typescript-eslint/require-await
  async has(assessmentId: string): Promise<boolean> {
    return this.cancelled.has(assessmentId);
  }
}

@Injectable()
export class PronunciationCancellationService {
  private readonly controllers = new Map<string, AbortController>();

  constructor(
    @Inject(PRONUNCIATION_CANCELLATION_REPOSITORY)
    private readonly repository: PronunciationCancellationRepository,
    @Inject(PRONUNCIATION_CANCELLATION_SIGNAL_STORE)
    private readonly signals: PronunciationCancellationSignalStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  abortSignalFor(assessmentId: string): AbortSignal {
    let controller = this.controllers.get(assessmentId);
    if (!controller) {
      controller = new AbortController();
      this.controllers.set(assessmentId, controller);
    }
    return controller.signal;
  }

  async observe(assessmentId: string): Promise<boolean> {
    try {
      if (await this.signals.has(assessmentId)) {
        this.controllers.get(assessmentId)?.abort('CANCELLED');
        return true;
      }
    } catch {
      // PostgreSQL remains authoritative when the best-effort signal is down.
    }
    return false;
  }

  async cancel(
    input: Readonly<{
      subjectId: string;
      assessmentId: string;
      idempotencyKey: string;
    }>,
  ): Promise<
    Readonly<{
      status: PronunciationAssessmentStatus;
      mayBeBillable: boolean;
      learningSaved: boolean;
    }>
  > {
    if (input.idempotencyKey.length < 16 || input.idempotencyKey.length > 128) {
      throw new PronunciationCancellationError('VALIDATION_FAILED');
    }
    const state = await this.repository.findOwned(
      input.subjectId,
      input.assessmentId,
    );
    if (!state) throw new PronunciationCancellationError('RESOURCE_NOT_FOUND');
    if (!cancellableStatuses.includes(state.status)) {
      return Object.freeze({
        status: state.status,
        mayBeBillable: state.providerAccepted === true,
        learningSaved: state.learningSaved,
      });
    }

    const cancelled = await this.repository.markCancellationRequested({
      subjectId: input.subjectId,
      assessmentId: input.assessmentId,
      requestedAt: this.now(),
    });
    if (!cancelled) {
      const raced = await this.repository.findOwned(
        input.subjectId,
        input.assessmentId,
      );
      if (!raced)
        throw new PronunciationCancellationError('RESOURCE_NOT_FOUND');
      return Object.freeze({
        status: raced.status,
        mayBeBillable: raced.providerAccepted === true,
        learningSaved: raced.learningSaved,
      });
    }

    this.controllers.get(input.assessmentId)?.abort('CANCELLED');
    try {
      await this.signals.set(input.assessmentId);
    } catch {
      // Durable state was already changed; do not turn cancellation into failure.
    }
    return Object.freeze({
      status: 'CANCELLED',
      mayBeBillable: state.providerAccepted === true,
      learningSaved: state.learningSaved,
    });
  }

  /** Must be called inside, or immediately before, the final DB transaction. */
  async assertCanFinalize(
    subjectId: string,
    assessmentId: string,
    signal: AbortSignal,
  ): Promise<void> {
    if (signal.aborted || (await this.observe(assessmentId))) {
      throw new PronunciationCancellationError('CANCELLED');
    }
    const state = await this.repository.findOwned(subjectId, assessmentId);
    if (!state) throw new PronunciationCancellationError('RESOURCE_NOT_FOUND');
    if (state.cancelRequestedAt || state.status === 'CANCELLED') {
      throw new PronunciationCancellationError('CANCELLED');
    }
    if (state.status !== 'PROCESSING') {
      throw new PronunciationCancellationError('STATE_CONFLICT');
    }
  }

  clear(assessmentId: string): void {
    this.controllers.delete(assessmentId);
  }
}
