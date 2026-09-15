import { Inject, Injectable, Optional } from '@nestjs/common';
import type {
  AnyPublicCoachResult,
  CoachRequestStatus,
} from '@en/common/coach';
import type { CoachExecutionContext } from '@libs/shared';
import { CoachEventStreamService } from './coach-event-stream.service';

export type CoachSseOwnedRequest = Readonly<{
  id: string;
  status: CoachRequestStatus;
  finalResult: AnyPublicCoachResult | null;
}>;

export interface CoachSseAccessRepository {
  findOwned(
    subjectId: string,
    requestId: string,
  ): Promise<CoachSseOwnedRequest | null>;
}

export const COACH_SSE_ACCESS_REPOSITORY = Symbol(
  'COACH_SSE_ACCESS_REPOSITORY',
);

export class CoachSseSessionError extends Error {
  constructor(
    readonly status: 401 | 404 | 410,
    message: string,
  ) {
    super(message);
    this.name = 'CoachSseSessionError';
  }
}

@Injectable()
export class CoachSseSessionService {
  constructor(
    @Inject(COACH_SSE_ACCESS_REPOSITORY)
    private readonly requests: CoachSseAccessRepository,
    private readonly stream: CoachEventStreamService,
    @Optional() private readonly nowEpochSeconds: () => number = () =>
      Math.floor(Date.now() / 1000),
  ) {}

  async open(
    context: CoachExecutionContext,
    requestId: string,
    lastEventId?: string,
  ) {
    if (context.accessTokenExpiresAtEpochSeconds <= this.nowEpochSeconds()) {
      throw new CoachSseSessionError(401, '访问令牌已过期');
    }
    const request = await this.requests.findOwned(context.subjectId, requestId);
    if (!request) {
      throw new CoachSseSessionError(404, '学习资源不存在或不可访问');
    }
    try {
      const events = await this.stream.readAfter(
        requestId,
        lastEventId,
        context.subjectId,
      );
      if (events === null) {
        throw new CoachSseSessionError(410, '流式回放已过期');
      }
      return { mode: 'stream' as const, request, events };
    } catch (error) {
      if (error instanceof CoachSseSessionError) throw error;
      return { mode: 'reconcile' as const, request, events: [] };
    }
  }
}
