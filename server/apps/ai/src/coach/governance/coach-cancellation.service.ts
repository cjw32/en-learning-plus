import { Inject, Injectable, Optional } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { CoachRequestStatus } from '@en/common/coach';
import type { CoachExecutionContext } from '@libs/shared';
import { CoachRequestRuleError } from '../api/coach-request.service';
import { PrismaService } from '@libs/shared';
import { CoachRedisConnection } from '../streaming/coach-redis.module';

export const COACH_CANCELLATION_REPOSITORY = Symbol(
  'COACH_CANCELLATION_REPOSITORY',
);
export const COACH_CANCELLATION_SIGNAL_STORE = Symbol(
  'COACH_CANCELLATION_SIGNAL_STORE',
);

export interface CoachCancellationRepository {
  findOwned(
    subjectId: string,
    requestId: string,
  ): Promise<{
    id: string;
    status: CoachRequestStatus;
    attemptSaved: boolean;
  } | null>;
  markCancellationRequested(input: {
    subjectId: string;
    requestId: string;
    idempotencyKey: string;
    requestedAt: Date;
  }): Promise<void>;
  findKnowledgeConsumptionState?(
    subjectId: string,
    requestId: string,
  ): Promise<{
    requestStatus: CoachRequestStatus;
    accountStatus: 'ACTIVE' | 'DELETING';
    accessStillAllowed: boolean;
  } | null>;
}

export interface CoachCancellationSignalStore {
  set(requestId: string): Promise<void>;
  has(requestId: string): Promise<boolean>;
}

@Injectable()
export class PrismaCoachCancellationRepository implements CoachCancellationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findOwned(subjectId: string, requestId: string) {
    const request = await this.prisma.coachRequest.findFirst({
      where: { id: requestId, userId: subjectId },
      select: {
        id: true,
        status: true,
        savedAttempt: { select: { id: true } },
      },
    });
    return request
      ? {
          id: request.id,
          status: request.status,
          attemptSaved: Boolean(request.savedAttempt),
        }
      : null;
  }

  async markCancellationRequested(input: {
    subjectId: string;
    requestId: string;
    idempotencyKey: string;
    requestedAt: Date;
  }) {
    await this.prisma.coachRequest.updateMany({
      where: {
        id: input.requestId,
        userId: input.subjectId,
        status: { in: ['CREATED', 'QUEUED', 'RUNNING'] },
      },
      data: { cancelRequestedAt: input.requestedAt },
    });
  }

  async findKnowledgeConsumptionState(subjectId: string, requestId: string) {
    const request = await this.prisma.coachRequest.findFirst({
      where: { id: requestId, userId: subjectId },
      select: {
        status: true,
        conversation: { select: { status: true } },
      },
    });
    if (!request) return null;
    const subjectHash = createHash('sha256').update(subjectId).digest('hex');
    const deleting = await this.prisma.coachDeletionTombstone.findFirst({
      where: {
        subjectHash,
        scope: 'COACH_DATA',
        status: { in: ['ACCEPTED', 'PURGING'] },
      },
      select: { id: true },
    });
    return {
      requestStatus: request.status,
      accountStatus:
        deleting || request.conversation.status === 'DELETING'
          ? ('DELETING' as const)
          : ('ACTIVE' as const),
      accessStillAllowed: request.conversation.status === 'ACTIVE',
    };
  }
}

@Injectable()
export class RedisCoachCancellationSignalStore implements CoachCancellationSignalStore {
  constructor(private readonly redis: CoachRedisConnection) {}

  async set(requestId: string) {
    await this.connect();
    await this.redis.client.set(`coach:cancel:${requestId}`, '1', 'EX', 3600);
    await this.redis.client.publish('coach:cancellations', requestId);
  }

  async has(requestId: string) {
    await this.connect();
    return (await this.redis.client.exists(`coach:cancel:${requestId}`)) === 1;
  }

  private async connect() {
    if (this.redis.client.status === 'wait') await this.redis.client.connect();
  }
}

@Injectable()
export class CoachCancellationService {
  private readonly controllers = new Map<string, AbortController>();

  constructor(
    @Inject(COACH_CANCELLATION_REPOSITORY)
    private readonly repository: CoachCancellationRepository,
    @Inject(COACH_CANCELLATION_SIGNAL_STORE)
    private readonly signals: CoachCancellationSignalStore,
    @Optional() private readonly now: () => Date = () => new Date(),
  ) {}

  abortSignalFor(requestId: string): AbortSignal {
    let controller = this.controllers.get(requestId);
    if (!controller) {
      controller = new AbortController();
      this.controllers.set(requestId, controller);
    }
    return controller.signal;
  }

  async observe(requestId: string): Promise<boolean> {
    const cancelled = await this.signals.has(requestId);
    if (cancelled) this.controllers.get(requestId)?.abort();
    return cancelled;
  }

  async assertCanConsumeKnowledgeResult(
    context: CoachExecutionContext,
    requestId: string,
    signal: AbortSignal,
  ): Promise<void> {
    const nowEpochSeconds = Math.floor(this.now().getTime() / 1_000);
    if (context.accessTokenExpiresAtEpochSeconds <= nowEpochSeconds) {
      throw Object.assign(
        new Error('Access token expired before knowledge use'),
        {
          code: 'TOKEN_INVALID' as const,
        },
      );
    }
    if (signal.aborted || (await this.observe(requestId))) {
      throw Object.assign(
        new Error('Knowledge result arrived after cancellation'),
        {
          code: 'CANCELLED' as const,
        },
      );
    }
    const state = await this.repository.findKnowledgeConsumptionState?.(
      context.subjectId,
      requestId,
    );
    if (!state) {
      throw Object.assign(new Error('Knowledge result is not owned'), {
        code: 'FORBIDDEN' as const,
      });
    }
    if (state.requestStatus === 'CANCELLED') {
      throw Object.assign(new Error('Knowledge request is cancelled'), {
        code: 'CANCELLED' as const,
      });
    }
    if (
      state.requestStatus !== 'RUNNING' ||
      state.accountStatus === 'DELETING'
    ) {
      throw Object.assign(new Error('Knowledge subject is no longer active'), {
        code: 'STATE_CONFLICT' as const,
      });
    }
    if (!state.accessStillAllowed) {
      throw Object.assign(new Error('Knowledge access was revoked'), {
        code: 'FORBIDDEN' as const,
      });
    }
  }

  async cancel(
    context: CoachExecutionContext,
    requestId: string,
    idempotencyKey: string,
  ) {
    if (idempotencyKey.length < 16) {
      throw new CoachRequestRuleError('VALIDATION_FAILED', '幂等键无效');
    }
    const request = await this.repository.findOwned(
      context.subjectId,
      requestId,
    );
    if (!request) {
      throw new CoachRequestRuleError(
        'RESOURCE_NOT_FOUND',
        '学习资源不存在或不可访问',
      );
    }
    const saveStatus = request.attemptSaved
      ? ('SAVED_ONCE' as const)
      : request.status === 'COMPLETED'
        ? ('NOT_APPLICABLE' as const)
        : ('NOT_SAVED' as const);
    if (
      ![
        'COMPLETED',
        'CANCELLED',
        'TIMED_OUT',
        'BUDGET_EXCEEDED',
        'FAILED',
      ].includes(request.status)
    ) {
      await this.repository.markCancellationRequested({
        subjectId: context.subjectId,
        requestId,
        idempotencyKey,
        requestedAt: this.now(),
      });
      await this.signals.set(requestId);
      this.controllers.get(requestId)?.abort();
    }
    return {
      status: request.status === 'COMPLETED' ? 'COMPLETED' : 'CANCELLED',
      saveStatus,
    } as const;
  }
}
