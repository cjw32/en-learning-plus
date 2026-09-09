import { createHash } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  coachFeedbackInputSchema,
  idempotencyKeySchema,
} from '@en/common/coach';
import { z } from '@en/common/coach/zod';
import { PrismaService } from '@libs/shared';

export type CoachFeedbackInput = z.infer<typeof coachFeedbackInputSchema>;
type FeedbackLink = Readonly<{
  traceId: string;
  resultSchemaVersion: string;
  promptVersion: string;
  modelVersion: string;
  responseType: string;
}>;

export type OwnedFeedbackRequest = FeedbackLink &
  Readonly<{
    requestId: string;
    traceSubjectId: string;
    terminal: boolean;
  }>;

export type StoredCoachFeedback = Readonly<{
  requestId: string;
  subjectId: string;
  clientIdempotencyKey: string;
  requestBodyHash: string;
  rating: 'UP' | 'DOWN';
  category:
    | 'INCORRECT'
    | 'TOO_HARD'
    | 'TOO_EASY'
    | 'IRRELEVANT'
    | 'UNSAFE'
    | 'OTHER'
    | null;
  comment: string | null;
  updatedAt: Date;
  expiresAt: Date;
  link: FeedbackLink;
}>;

export interface CoachFeedbackRepository {
  findOwnedTerminalRequest(
    subjectId: string,
    requestId: string,
  ): Promise<OwnedFeedbackRequest | null>;
  findByIdempotencyKey(
    subjectId: string,
    key: string,
  ): Promise<StoredCoachFeedback | null>;
  upsert(feedback: StoredCoachFeedback): Promise<StoredCoachFeedback>;
}

export class InMemoryCoachFeedbackRepository
  implements CoachFeedbackRepository
{
  private readonly requests = new Map<string, OwnedFeedbackRequest>();
  private readonly feedback = new Map<string, StoredCoachFeedback>();

  constructor(requests: readonly OwnedFeedbackRequest[]) {
    for (const request of requests) this.requests.set(request.requestId, request);
  }

  async findOwnedTerminalRequest(subjectId: string, requestId: string) {
    const request = this.requests.get(requestId);
    return request?.traceSubjectId === subjectId && request.terminal
      ? request
      : null;
  }

  async findByIdempotencyKey(subjectId: string, key: string) {
    return (
      [...this.feedback.values()].find(
        (item) =>
          item.subjectId === subjectId && item.clientIdempotencyKey === key,
      ) ?? null
    );
  }

  async upsert(feedback: StoredCoachFeedback) {
    this.feedback.set(`${feedback.subjectId}:${feedback.requestId}`, feedback);
    return feedback;
  }

  feedbackCount() {
    return this.feedback.size;
  }

  linkFor(requestId: string) {
    return [...this.feedback.values()].find(
      (item) => item.requestId === requestId,
    )?.link;
  }
}

@Injectable()
export class PrismaCoachFeedbackRepository implements CoachFeedbackRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findOwnedTerminalRequest(subjectId: string, requestId: string) {
    const request = await this.prisma.coachRequest.findFirst({
      where: { id: requestId, userId: subjectId, status: 'COMPLETED' },
      include: { trace: true },
    });
    if (!request?.trace || !request.finalResultSchemaVersion || !request.finalResult) {
      return null;
    }
    const result = z
      .object({ responseType: z.string() })
      .passthrough()
      .safeParse(request.finalResult);
    if (!result.success) return null;
    return {
      requestId: request.id,
      traceSubjectId: request.userId,
      terminal: true,
      traceId: request.trace.id,
      resultSchemaVersion: request.finalResultSchemaVersion,
      promptVersion: request.trace.promptVersion,
      modelVersion: request.trace.modelVersion,
      responseType: result.data.responseType,
    };
  }

  async findByIdempotencyKey(subjectId: string, key: string) {
    const found = await this.prisma.coachFeedback.findFirst({
      where: { userId: subjectId, clientIdempotencyKey: key },
      include: { request: { include: { trace: true } } },
    });
    if (!found?.request.trace || !found.request.finalResultSchemaVersion) return null;
    const responseType = z
      .object({ responseType: z.string() })
      .passthrough()
      .parse(found.request.finalResult).responseType;
    return {
      requestId: found.requestId,
      subjectId: found.userId,
      clientIdempotencyKey: found.clientIdempotencyKey,
      requestBodyHash: found.requestBodyHash,
      rating: found.rating,
      category: found.category,
      comment: found.comment,
      updatedAt: found.updatedAt,
      expiresAt: found.expiresAt,
      link: {
        traceId: found.request.trace.id,
        resultSchemaVersion: found.request.finalResultSchemaVersion,
        promptVersion: found.request.trace.promptVersion,
        modelVersion: found.request.trace.modelVersion,
        responseType,
      },
    };
  }

  async upsert(feedback: StoredCoachFeedback) {
    const stored = await this.prisma.coachFeedback.upsert({
      where: {
        userId_requestId: {
          userId: feedback.subjectId,
          requestId: feedback.requestId,
        },
      },
      create: {
        userId: feedback.subjectId,
        requestId: feedback.requestId,
        clientIdempotencyKey: feedback.clientIdempotencyKey,
        requestBodyHash: feedback.requestBodyHash,
        rating: feedback.rating,
        category: feedback.category,
        comment: feedback.comment,
        updatedAt: feedback.updatedAt,
        expiresAt: feedback.expiresAt,
      },
      update: {
        clientIdempotencyKey: feedback.clientIdempotencyKey,
        requestBodyHash: feedback.requestBodyHash,
        rating: feedback.rating,
        category: feedback.category,
        comment: feedback.comment,
        updatedAt: feedback.updatedAt,
        expiresAt: feedback.expiresAt,
      },
    });
    return { ...feedback, updatedAt: stored.updatedAt };
  }
}

@Injectable()
export class CoachFeedbackService {
  constructor(
    private readonly repository: CoachFeedbackRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async upsert(
    subjectId: string,
    requestId: string,
    untrustedKey: unknown,
    untrustedInput: unknown,
  ) {
    const key = idempotencyKeySchema.parse(untrustedKey);
    const input = coachFeedbackInputSchema.parse(untrustedInput);
    const bodyHash = createHash('sha256')
      .update(JSON.stringify(input))
      .digest('hex');
    const replay = await this.repository.findByIdempotencyKey(subjectId, key);
    if (replay) {
      if (replay.requestId !== requestId || replay.requestBodyHash !== bodyHash) {
        throw new ConflictException('幂等键已绑定到其他反馈内容');
      }
      return this.publicResult(replay);
    }
    const request = await this.repository.findOwnedTerminalRequest(
      subjectId,
      requestId,
    );
    if (!request) throw new NotFoundException('Coach 请求不存在或不可访问');
    const now = this.now();
    const stored = await this.repository.upsert({
      requestId,
      subjectId,
      clientIdempotencyKey: key,
      requestBodyHash: bodyHash,
      rating: input.rating,
      category: input.category ?? null,
      comment: input.comment ?? null,
      updatedAt: now,
      expiresAt: new Date(now.getTime() + 180 * 24 * 60 * 60 * 1_000),
      link: {
        traceId: request.traceId,
        resultSchemaVersion: request.resultSchemaVersion,
        promptVersion: request.promptVersion,
        modelVersion: request.modelVersion,
        responseType: request.responseType,
      },
    });
    return this.publicResult(stored);
  }

  private publicResult(feedback: StoredCoachFeedback) {
    return Object.freeze({
      requestId: feedback.requestId,
      rating: feedback.rating,
      category: feedback.category,
      comment: feedback.comment,
      updatedAt: feedback.updatedAt.toISOString(),
    });
  }
}
