import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  HttpException,
  HttpStatus,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  coachProfileSchema,
  coachRequestSchema,
  coachResultSchema,
  publicCoachResultV2Schema,
  storedCoachResultV2Schema,
  type CoachProfileUpdate,
  type CoachFeedbackInput,
  type CreateCoachRequest,
} from '@en/common/coach';
import {
  CitationProjectionService,
  LearnerProfileService,
  LearningDomainError,
  type LearnerProfileRecord,
} from '@libs/learning';
import { ResponseService, type CoachExecutionContext } from '@libs/shared';
import { nanoid } from 'nanoid';
import { CoachQueueService } from '../queue/coach.queue';
import { CoachRequestRepository } from './coach-request.repository';
import {
  CoachRequestRuleError,
  CoachRequestService,
} from './coach-request.service';
import { CoachEventStreamService } from '../streaming/coach-event-stream.service';
import { CoachCancellationService } from '../governance/coach-cancellation.service';
import { CoachRetryService } from '../governance/coach-retry.service';
import { CoachFeedbackService } from '../observability/coach-feedback.service';
import { CoachRetentionService } from '../observability/coach-retention.service';
import { CoachAdmissionService } from '../governance/coach-admission.service';

const PROFILE_MISSING_UPDATED_AT = '1970-01-01T00:00:00.000Z';
const CONVERSATION_TTL_MS = 90 * 24 * 60 * 60 * 1000;

function mapProfile(profile: LearnerProfileRecord | null) {
  return coachProfileSchema.parse({
    cefrLevel: profile?.cefrLevel ?? null,
    levelSource: profile?.levelSource ?? null,
    goalType: profile?.goalType ?? null,
    goalText: profile?.goalText ?? null,
    activeCourseId: profile?.activeCourseId ?? null,
    timezone: profile?.timezone ?? 'Asia/Shanghai',
    updatedAt: profile?.updatedAt.toISOString() ?? PROFILE_MISSING_UPDATED_AT,
  });
}

function mapConversation(conversation: {
  id: string;
  title: string | null;
  status: 'ACTIVE' | 'DELETING' | 'DELETED' | 'EXPIRED';
  lastActivityAt: Date;
  expiresAt: Date;
  createdAt: Date;
}) {
  return {
    id: conversation.id,
    title: conversation.title,
    status: conversation.status,
    lastActivityAt: conversation.lastActivityAt.toISOString(),
    expiresAt: conversation.expiresAt.toISOString(),
    createdAt: conversation.createdAt.toISOString(),
  } as const;
}

function durableConversationId(subjectId: string, key: string) {
  return `conv_${createHash('sha256')
    .update(`${subjectId}\u0000${key}`)
    .digest('base64url')
    .slice(0, 24)}`;
}

function throwPublic(error: unknown): never {
  if (error instanceof LearningDomainError) {
    if (error.statusCode === 404) {
      throw new NotFoundException('学习资源不存在或不可访问');
    }
    if (error.statusCode === 409) throw new ConflictException(error.message);
    if (error.statusCode === 400) throw new BadRequestException(error.message);
    throw new ServiceUnavailableException('学习数据暂时不可用');
  }
  if (error instanceof CoachRequestRuleError) {
    if (error.code === 'RESOURCE_NOT_FOUND') {
      throw new NotFoundException('学习资源不存在或不可访问');
    }
    if (
      error.code === 'IDEMPOTENCY_CONFLICT' ||
      error.code === 'STATE_CONFLICT'
    ) {
      throw new ConflictException(error.message);
    }
    throw new BadRequestException(error.message);
  }
  if (error && typeof error === 'object' && 'code' in error) {
    if (error.code === 'RATE_LIMITED') {
      throw new HttpException(
        '请求过于频繁，请稍后再试。',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (error.code === 'BUDGET_EXCEEDED') {
      throw new ServiceUnavailableException('Coach 请求治理暂时不可用');
    }
  }
  throw error;
}

@Injectable()
export class CoachApiService {
  constructor(
    private readonly profiles: LearnerProfileService,
    private readonly repository: CoachRequestRepository,
    private readonly requests: CoachRequestService,
    private readonly queue: CoachQueueService,
    private readonly response: ResponseService,
    private readonly stream: CoachEventStreamService,
    private readonly cancellation: CoachCancellationService,
    private readonly retry: CoachRetryService,
    private readonly feedback: CoachFeedbackService,
    private readonly retention: CoachRetentionService,
    @Optional() private readonly admission?: CoachAdmissionService,
    @Optional() private readonly citationProjection?: CitationProjectionService,
  ) {}

  private async projectStoredResult(subjectId: string, value: unknown) {
    const v1 = coachResultSchema.safeParse(value);
    if (v1.success) return v1.data;
    if (!this.citationProjection) return null;
    const storedV2 = storedCoachResultV2Schema.safeParse(value);
    if (storedV2.success) {
      return this.citationProjection.projectResult(subjectId, storedV2.data);
    }
    const legacyPublicV2 = publicCoachResultV2Schema.safeParse(value);
    if (legacyPublicV2.success) {
      return this.citationProjection.projectResult(
        subjectId,
        legacyPublicV2.data,
      );
    }
    return null;
  }

  async getProfile(context: CoachExecutionContext) {
    await this.retention.assertSubjectActive(context.subjectId);
    try {
      return this.response.success(
        mapProfile(await this.profiles.getProfile(context.subjectId)),
      );
    } catch (error) {
      throwPublic(error);
    }
  }

  async updateProfile(
    context: CoachExecutionContext,
    update: CoachProfileUpdate,
    _idempotencyKey: string,
  ) {
    await this.retention.assertSubjectActive(context.subjectId);
    try {
      return this.response.success(
        mapProfile(
          await this.profiles.updateProfile(context.subjectId, update),
        ),
      );
    } catch (error) {
      throwPublic(error);
    }
  }

  async createConversation(
    context: CoachExecutionContext,
    input: { title?: string },
    idempotencyKey: string,
  ) {
    await this.retention.assertSubjectActive(context.subjectId);
    const id = durableConversationId(context.subjectId, idempotencyKey);
    const existing = await this.repository.findOwnedConversation(
      context.subjectId,
      id,
    );
    if (existing) {
      if ((existing.title ?? undefined) !== input.title) {
        throw new ConflictException('幂等键已绑定到其他请求内容');
      }
      return this.response.success(mapConversation(existing));
    }
    const now = new Date();
    try {
      return this.response.success(
        mapConversation(
          await this.repository.createConversation({
            id,
            subjectId: context.subjectId,
            title: input.title,
            checkpointThreadId: `thread_${nanoid(32)}`,
            now,
            expiresAt: new Date(now.getTime() + CONVERSATION_TTL_MS),
          }),
        ),
      );
    } catch (error) {
      throwPublic(error);
    }
  }

  async listConversations(
    context: CoachExecutionContext,
    input: { cursor?: string; limit: number },
  ) {
    await this.retention.assertSubjectActive(context.subjectId);
    const rows = await this.repository.listOwnedConversations({
      subjectId: context.subjectId,
      ...input,
    });
    if (!rows) throw new NotFoundException('学习资源不存在或不可访问');
    const hasMore = rows.length > input.limit;
    const items = rows.slice(0, input.limit);
    return this.response.success({
      items: items.map(mapConversation),
      nextCursor: hasMore ? items.at(-1)!.id : null,
    });
  }

  async getConversation(
    context: CoachExecutionContext,
    conversationId: string,
    input: { cursor?: string; limit: number },
  ) {
    await this.retention.assertSubjectActive(context.subjectId);
    const detail = await this.repository.listOwnedMessages({
      subjectId: context.subjectId,
      conversationId,
      ...input,
    });
    if (!detail) throw new NotFoundException('学习资源不存在或不可访问');
    const hasMore = detail.messages.length > input.limit;
    const page = detail.messages.slice(0, input.limit);
    return this.response.success({
      conversation: mapConversation(detail.conversation),
      messages: await Promise.all(
        page.map(async (message) => ({
          id: message.id,
          role: message.role,
          content: message.content,
          structuredResult: await this.projectStoredResult(
            context.subjectId,
            message.structuredResult,
          ),
          createdAt: message.createdAt.toISOString(),
        })),
      ),
      nextCursor: hasMore ? page.at(-1)!.id : null,
    });
  }

  async createRequest(
    context: CoachExecutionContext,
    conversationId: string,
    body: CreateCoachRequest,
    idempotencyKey: string,
  ) {
    await this.retention.assertSubjectActive(context.subjectId);
    let acquiredConcurrencyLease = false;
    let retainConcurrencyLease = false;
    let leasedRequestId: string | null = null;
    try {
      await this.admission?.consumeSubject(context.subjectId);
      const created = await this.requests.create({
        subjectId: context.subjectId,
        conversationId,
        clientRequestKey: idempotencyKey,
        body,
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
          // The durable request remains authoritative when Redis is unavailable.
        }
      }
      if (request.status === 'QUEUED') {
        await this.admission?.acquireSubject(context.subjectId, request.id);
        acquiredConcurrencyLease = Boolean(this.admission);
        leasedRequestId = request.id;
        await this.queue.enqueue(request.id);
        retainConcurrencyLease = true;
      }
      return this.response.success({
        requestId: request.id,
        conversationId: request.conversationId,
        status: request.status === 'CREATED' ? 'CREATED' : 'QUEUED',
        streamUrl: `/ai/v1/coach/requests/${request.id}/events`,
        traceId: `trace_${request.id}`,
      } as const);
    } catch (error) {
      throwPublic(error);
    } finally {
      if (acquiredConcurrencyLease && !retainConcurrencyLease) {
        await this.admission
          ?.releaseSubject(context.subjectId, leasedRequestId!)
          .catch(() => undefined);
      }
    }
  }

  async getRequest(context: CoachExecutionContext, requestId: string) {
    await this.retention.assertSubjectActive(context.subjectId);
    const request = await this.repository.findOwnedRequest(
      context.subjectId,
      requestId,
    );
    if (!request) throw new NotFoundException('学习资源不存在或不可访问');
    const finalResult = await this.projectStoredResult(
      context.subjectId,
      request.finalResult,
    );
    return this.response.success(
      coachRequestSchema.parse({
        id: request.id,
        conversationId: request.conversationId,
        inputType: request.inputType,
        retryOfRequestId: request.retryOfRequestId,
        intent: request.intent,
        status: request.status,
        finalResult,
        error: request.errorCode
          ? {
              code: request.errorCode,
              message: 'Coach 请求未完成，请按提示重试。',
              retryable: [
                'MODEL_UNAVAILABLE',
                'TOOL_TIMEOUT',
                'REQUEST_TIMEOUT',
              ].includes(request.errorCode),
            }
          : null,
        createdAt: request.createdAt.toISOString(),
        updatedAt: request.updatedAt.toISOString(),
        traceId: `trace_${request.id}`,
        startedAt: request.startedAt?.toISOString() ?? null,
        finishedAt: request.finishedAt?.toISOString() ?? null,
      }),
    );
  }

  async getCitation(context: CoachExecutionContext, citationId: string) {
    await this.retention.assertSubjectActive(context.subjectId);
    if (!this.citationProjection) {
      throw new ServiceUnavailableException('引用解析服务暂时不可用');
    }
    return this.response.success(
      await this.citationProjection.resolve({
        subjectId: context.subjectId,
        citationId,
      }),
    );
  }

  async cancelRequest(
    context: CoachExecutionContext,
    requestId: string,
    idempotencyKey: string,
  ) {
    await this.retention.assertSubjectActive(context.subjectId);
    try {
      return this.response.success(
        await this.cancellation.cancel(context, requestId, idempotencyKey),
      );
    } catch (error) {
      throwPublic(error);
    }
  }

  async retryRequest(
    context: CoachExecutionContext,
    requestId: string,
    idempotencyKey: string,
  ) {
    await this.retention.assertSubjectActive(context.subjectId);
    let acquiredConcurrencyLease = false;
    let retainConcurrencyLease = false;
    let leasedRequestId: string | null = null;
    try {
      await this.admission?.consumeSubject(context.subjectId);
      const retried = await this.retry.retry(
        context,
        requestId,
        idempotencyKey,
      );
      if (retried.request.status === 'COMPLETED') {
        return this.getRequest(context, retried.request.id);
      }
      if (retried.request.status === 'QUEUED') {
        await this.admission?.acquireSubject(
          context.subjectId,
          retried.request.id,
        );
        acquiredConcurrencyLease = Boolean(this.admission);
        leasedRequestId = retried.request.id;
        await this.queue.enqueue(retried.request.id);
        retainConcurrencyLease = true;
      }
      return this.response.success({
        requestId: retried.request.id,
        conversationId: retried.request.conversationId,
        status: 'QUEUED' as const,
        streamUrl: `/ai/v1/coach/requests/${retried.request.id}/events`,
        traceId: `trace_${retried.request.id}`,
      });
    } catch (error) {
      throwPublic(error);
    } finally {
      if (acquiredConcurrencyLease && !retainConcurrencyLease) {
        await this.admission
          ?.releaseSubject(context.subjectId, leasedRequestId!)
          .catch(() => undefined);
      }
    }
  }

  async upsertFeedback(
    context: CoachExecutionContext,
    requestId: string,
    idempotencyKey: string,
    input: CoachFeedbackInput,
  ) {
    await this.retention.assertSubjectActive(context.subjectId);
    return this.response.success(
      await this.feedback.upsert(
        context.subjectId,
        requestId,
        idempotencyKey,
        input,
      ),
    );
  }

  async deleteConversation(
    context: CoachExecutionContext,
    conversationId: string,
    _idempotencyKey: string,
  ) {
    const result = await this.retention.requestConversationDeletion(
      context.subjectId,
      conversationId,
    );
    if (!result) throw new NotFoundException('学习资源不存在或不可访问');
    return this.response.success(result);
  }

  async deleteCoachData(
    context: CoachExecutionContext,
    _idempotencyKey: string,
  ) {
    const result = await this.retention.requestSubjectDeletion(
      context.subjectId,
    );
    return this.response.success({
      deletionId: result.tombstoneId,
      status: 'ACCEPTED' as const,
      hiddenAt: new Date().toISOString(),
      purgeDeadline: result.purgeAfter,
    });
  }
}
