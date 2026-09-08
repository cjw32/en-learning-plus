import { Injectable } from '@nestjs/common';
import { createCoachRequestSchema } from '@en/common/coach';
import type { CoachExecutionContext } from '@libs/shared';
import { CoachRequestRepository } from '../api/coach-request.repository';
import {
  CoachRequestRuleError,
  CoachRequestService,
} from '../api/coach-request.service';
import { CoachEventStreamService } from '../streaming/coach-event-stream.service';

const retryableErrorCodes = new Set([
  'MODEL_UNAVAILABLE',
  'TOOL_TIMEOUT',
  'REQUEST_TIMEOUT',
  'INTERNAL_ERROR',
]);

@Injectable()
export class CoachRetryService {
  constructor(
    private readonly repository: CoachRequestRepository,
    private readonly requests: CoachRequestService,
    private readonly stream: CoachEventStreamService,
  ) {}

  async retry(
    context: CoachExecutionContext,
    requestId: string,
    idempotencyKey: string,
  ) {
    const source = await this.repository.findOwnedRequest(
      context.subjectId,
      requestId,
    );
    if (!source) {
      throw new CoachRequestRuleError(
        'RESOURCE_NOT_FOUND',
        '学习资源不存在或不可访问',
      );
    }
    if (source.status === 'COMPLETED') {
      return { replayed: true as const, request: source };
    }
    const retryable =
      source.status === 'CANCELLED' ||
      source.status === 'TIMED_OUT' ||
      (source.status === 'FAILED' &&
        retryableErrorCodes.has(source.errorCode ?? ''));
    if (!retryable) {
      throw new CoachRequestRuleError('STATE_CONFLICT', '该请求当前不可重试');
    }
    const payload = createCoachRequestSchema.safeParse(source.inputPayload);
    if (!payload.success) {
      throw new CoachRequestRuleError(
        'STATE_CONFLICT',
        '原请求内容无法安全重放',
      );
    }
    const created = await this.requests.create({
      subjectId: context.subjectId,
      conversationId: source.conversationId,
      clientRequestKey: idempotencyKey,
      body: payload.data,
      retryOfRequestId: source.id,
      accessTokenExpiresAtEpochSeconds:
        context.accessTokenExpiresAtEpochSeconds,
    });
    const request = created.replayed
      ? created.request
      : await this.requests.transition(created.request.id, 'QUEUED');
    if (!created.replayed) {
      try {
        await this.stream.publishConnected(request.id, 'QUEUED', null);
      } catch {
        // Durable request remains authoritative during stream outages.
      }
    }
    return { replayed: created.replayed, request };
  }
}
