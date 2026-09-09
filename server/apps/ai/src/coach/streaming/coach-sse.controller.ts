import {
  Controller,
  GoneException,
  Headers,
  MessageEvent,
  NotFoundException,
  Param,
  Req,
  ServiceUnavailableException,
  Sse,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { concat, from, interval, Observable } from 'rxjs';
import { concatMap, mergeMap, takeWhile } from 'rxjs/operators';
import { AuthGuard, CoachExecutionContext } from '@libs/shared';
import type { CoachSseEvent } from '@en/common/coach';
import {
  CoachSseSessionError,
  CoachSseSessionService,
} from './coach-sse-session.service';

type AuthenticatedRequest = Request & {
  coachContext?: CoachExecutionContext;
};

function contextFrom(request: AuthenticatedRequest) {
  if (!request.coachContext) throw new UnauthorizedException('认证上下文无效');
  return request.coachContext;
}

function message(event: CoachSseEvent): MessageEvent {
  return { id: event.eventId, type: event.type, data: event };
}

function terminal(event: CoachSseEvent) {
  return ['completed', 'cancelled', 'error'].includes(event.type);
}

@Controller({ path: 'coach', version: '1' })
@UseGuards(AuthGuard)
export class CoachSseController {
  constructor(private readonly sessions: CoachSseSessionService) {}

  @Sse('requests/:requestId/events')
  async events(
    @Req() request: AuthenticatedRequest,
    @Param('requestId') requestId: string,
    @Headers('last-event-id') lastEventId?: string,
  ): Promise<Observable<MessageEvent>> {
    const context = contextFrom(request);
    let opened: Awaited<ReturnType<CoachSseSessionService['open']>>;
    try {
      opened = await this.sessions.open(context, requestId, lastEventId);
    } catch (error) {
      this.throwHttp(error);
    }
    if (opened.mode === 'reconcile') {
      throw new ServiceUnavailableException(
        '流式服务暂时不可用，请读取请求状态完成对账',
      );
    }
    let cursor = opened.events.at(-1)?.eventId ?? lastEventId;
    const initial: Observable<MessageEvent> = from(
      opened.events.map((event): MessageEvent => message(event)),
    );
    if (opened.events.some(terminal)) return initial;
    const live: Observable<MessageEvent> = interval(750).pipe(
      concatMap(async () => {
        const next = await this.sessions.open(context, requestId, cursor);
        if (next.mode === 'reconcile') {
          throw new ServiceUnavailableException(
            '流式服务暂时不可用，请读取请求状态完成对账',
          );
        }
        if (next.events.length) cursor = next.events.at(-1)!.eventId;
        return next.events;
      }),
      mergeMap((events) =>
        from(events.map((event): MessageEvent => message(event))),
      ),
      takeWhile((value) => !terminal(value.data as CoachSseEvent), true),
    );
    return concat(initial, live);
  }

  private throwHttp(error: unknown): never {
    if (error instanceof CoachSseSessionError) {
      if (error.status === 401) throw new UnauthorizedException(error.message);
      if (error.status === 404) throw new NotFoundException(error.message);
      throw new GoneException(error.message);
    }
    throw error;
  }
}
