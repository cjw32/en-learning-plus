import { Injectable } from '@nestjs/common';
import { PrismaService } from '@libs/shared';
import {
  coachResultSchema,
  createCoachRequestSchema,
  publicCoachResultV2Schema,
  storedCoachResultV2Schema,
  type CoachResult,
  type PublicCoachResultV2,
  type StoredCoachResultV2,
} from '@en/common/coach';
import { Prisma } from '@libs/shared/generated/prisma/client';
import { CoachRequestStore, StoredCoachRequest } from './coach-request.service';
import type {
  CoachExecutorRepository,
  CoachRuntimeIntent,
} from '../workflow/coach-workflow.executor';
import type { CoachSseEvent } from '@en/common/coach';
import {
  ownedCoachConversationWhere,
  USER_COACH_CONVERSATION_ORIGIN,
} from '../conversation/coach-conversation.service';

export type PersistableCoachResult =
  | CoachResult
  | PublicCoachResultV2
  | StoredCoachResultV2;

export function toStoredCoachResult(
  result: PersistableCoachResult,
): CoachResult | StoredCoachResultV2 {
  if (result.schemaVersion === 'coach.result.v1') {
    return coachResultSchema.parse(result);
  }
  if ('citationIds' in result) return storedCoachResultV2Schema.parse(result);
  const parsed = publicCoachResultV2Schema.parse(result);
  const { citations, exercise, ...stable } = parsed;
  return storedCoachResultV2Schema.parse({
    ...stable,
    citationIds: citations.map((citation) => citation.citationId),
    ...(exercise
      ? {
          exercise: {
            ...exercise,
            items: exercise.items.map((item) => ({
              ...item,
              citations: [],
            })),
          },
        }
      : {}),
  });
}

function toStored(request: {
  id: string;
  userId: string;
  conversationId: string;
  clientRequestKey: string;
  requestBodyHash: string;
  inputPayload: unknown;
  retryOfRequestId: string | null;
  errorCode: string | null;
  inputType: 'MESSAGE' | 'EXERCISE_SUBMISSION' | 'RECOMMENDATION';
  status: StoredCoachRequest['status'];
  deadlineAt: Date;
  createdAt: Date;
  updatedAt: Date;
  queuedAt: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  cancelRequestedAt: Date | null;
}): StoredCoachRequest {
  return {
    id: request.id,
    subjectId: request.userId,
    conversationId: request.conversationId,
    clientRequestKey: request.clientRequestKey,
    requestBodyHash: request.requestBodyHash,
    inputPayload: createCoachRequestSchema.parse(request.inputPayload),
    retryOfRequestId: request.retryOfRequestId,
    errorCode: request.errorCode,
    inputType: request.inputType,
    status: request.status,
    deadlineAt: request.deadlineAt,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    queuedAt: request.queuedAt,
    startedAt: request.startedAt,
    finishedAt: request.finishedAt,
    cancelRequestedAt: request.cancelRequestedAt,
  };
}

@Injectable()
export class CoachRequestRepository
  implements CoachRequestStore, CoachExecutorRepository
{
  constructor(private readonly prisma: PrismaService) {}

  async isConversationOwned(subjectId: string, conversationId: string) {
    return Boolean(
      await this.prisma.coachConversation.findFirst({
        where: ownedCoachConversationWhere(subjectId, conversationId),
        select: { id: true },
      }),
    );
  }

  async findByOwnerAndKey(subjectId: string, key: string) {
    const request = await this.prisma.coachRequest.findUnique({
      where: {
        userId_clientRequestKey: { userId: subjectId, clientRequestKey: key },
      },
    });
    return request ? toStored(request) : null;
  }

  async findActiveByConversation(conversationId: string) {
    const request = await this.prisma.coachRequest.findFirst({
      where: {
        conversationId,
        status: { in: ['CREATED', 'QUEUED', 'RUNNING'] },
      },
      orderBy: { createdAt: 'asc' },
    });
    return request ? toStored(request) : null;
  }

  async findById(requestId: string) {
    const request = await this.prisma.coachRequest.findUnique({
      where: { id: requestId },
    });
    return request ? toStored(request) : null;
  }

  async create(request: StoredCoachRequest) {
    return toStored(
      await this.prisma.coachRequest.create({
        data: {
          id: request.id,
          userId: request.subjectId,
          conversationId: request.conversationId,
          clientRequestKey: request.clientRequestKey,
          requestBodyHash: request.requestBodyHash,
          inputPayload: JSON.parse(
            JSON.stringify(request.inputPayload),
          ) as Prisma.InputJsonValue,
          retryOfRequestId: request.retryOfRequestId,
          inputType: request.inputType,
          status: request.status,
          deadlineAt: request.deadlineAt,
          queuedAt: request.queuedAt,
          startedAt: request.startedAt,
          finishedAt: request.finishedAt,
        },
      }),
    );
  }

  async update(request: StoredCoachRequest) {
    return toStored(
      await this.prisma.coachRequest.update({
        where: { id: request.id },
        data: {
          status: request.status,
          queuedAt: request.queuedAt,
          startedAt: request.startedAt,
          finishedAt: request.finishedAt,
        },
      }),
    );
  }

  async claimForExecution(requestId: string) {
    const startedAt = new Date();
    const claimed = await this.prisma.coachRequest.updateMany({
      where: { id: requestId, status: 'QUEUED' },
      data: { status: 'RUNNING', startedAt },
    });
    if (claimed.count !== 1) return null;
    const request = await this.prisma.coachRequest.findUnique({
      where: { id: requestId },
    });
    return request ? toStored(request) : null;
  }

  async completeExecution(input: {
    request: StoredCoachRequest;
    intent: CoachRuntimeIntent;
    result: PersistableCoachResult;
    promptVersion: string;
    modelVersion: string;
    budgetVersion: string;
    finishedAt: Date;
  }) {
    const storedResult = toStoredCoachResult(input.result);
    return this.prisma.$transaction(async (transaction) => {
      const completed = await transaction.coachRequest.updateMany({
        where: {
          id: input.request.id,
          status: 'RUNNING',
          cancelRequestedAt: null,
          conversation: { status: 'ACTIVE' },
        },
        data: {
          status: 'COMPLETED',
          intent: input.intent,
          promptVersion: input.promptVersion,
          modelVersion: input.modelVersion,
          budgetVersion: input.budgetVersion,
          finalResultSchemaVersion: storedResult.schemaVersion,
          finalResult: storedResult as Prisma.InputJsonValue,
          errorCode: null,
          finishedAt: input.finishedAt,
        },
      });
      if (completed.count !== 1) return false;

      if (input.request.inputPayload.type === 'MESSAGE') {
        await transaction.coachMessage.create({
          data: {
            conversationId: input.request.conversationId,
            requestId: input.request.id,
            role: 'USER',
            content: input.request.inputPayload.message,
          },
        });
      }
      await transaction.coachMessage.create({
        data: {
          conversationId: input.request.conversationId,
          requestId: input.request.id,
          role: 'COACH',
          content: storedResult.explanation,
          resultSchemaVersion: storedResult.schemaVersion,
          structuredResult: storedResult as Prisma.InputJsonValue,
        },
      });
      await transaction.coachConversation.update({
        where: { id: input.request.conversationId },
        data: {
          lastActivityAt: input.finishedAt,
          expiresAt: new Date(
            input.finishedAt.getTime() + 90 * 24 * 60 * 60 * 1000,
          ),
        },
      });
      return true;
    });
  }

  async failExecution(input: {
    requestId: string;
    status: 'CANCELLED' | 'TIMED_OUT' | 'BUDGET_EXCEEDED' | 'FAILED';
    errorCode: Extract<CoachSseEvent, { type: 'error' }>['payload']['code'];
    finishedAt: Date;
  }) {
    return this.prisma.$transaction(async (transaction) => {
      const request = await transaction.coachRequest.findUnique({
        where: { id: input.requestId },
        select: {
          cancelRequestedAt: true,
          savedAttempt: { select: { id: true } },
        },
      });
      const status = request?.cancelRequestedAt ? 'CANCELLED' : input.status;
      const errorCode = request?.cancelRequestedAt
        ? ('CANCELLED' as const)
        : input.errorCode;
      const failed = await transaction.coachRequest.updateMany({
        where: { id: input.requestId, status: 'RUNNING' },
        data: {
          status,
          errorCode,
          finishedAt: input.finishedAt,
        },
      });
      return {
        updated: failed.count === 1,
        status,
        errorCode,
        saveStatus: request?.savedAttempt
          ? ('SAVED_ONCE' as const)
          : ('NOT_SAVED' as const),
      };
    });
  }

  async createConversation(input: {
    id: string;
    subjectId: string;
    title?: string;
    checkpointThreadId: string;
    now: Date;
    expiresAt: Date;
  }) {
    return this.prisma.coachConversation.create({
      data: {
        id: input.id,
        userId: input.subjectId,
        title: input.title,
        origin: USER_COACH_CONVERSATION_ORIGIN,
        checkpointThreadId: input.checkpointThreadId,
        lastActivityAt: input.now,
        expiresAt: input.expiresAt,
      },
    });
  }

  findOwnedConversation(subjectId: string, conversationId: string) {
    return this.prisma.coachConversation.findFirst({
      where: ownedCoachConversationWhere(subjectId, conversationId),
    });
  }

  async listOwnedConversations(input: {
    subjectId: string;
    cursor?: string;
    limit: number;
  }) {
    const cursor = input.cursor
      ? await this.prisma.coachConversation.findFirst({
          where: {
            ...ownedCoachConversationWhere(input.subjectId, input.cursor),
          },
          select: { id: true, lastActivityAt: true },
        })
      : null;
    if (input.cursor && !cursor) return null;
    return this.prisma.coachConversation.findMany({
      where: {
        ...ownedCoachConversationWhere(input.subjectId),
        ...(cursor
          ? {
              OR: [
                { lastActivityAt: { lt: cursor.lastActivityAt } },
                {
                  lastActivityAt: cursor.lastActivityAt,
                  id: { lt: cursor.id },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ lastActivityAt: 'desc' }, { id: 'desc' }],
      take: input.limit + 1,
    });
  }

  async listOwnedMessages(input: {
    subjectId: string;
    conversationId: string;
    cursor?: string;
    limit: number;
  }) {
    const owned = await this.findOwnedConversation(
      input.subjectId,
      input.conversationId,
    );
    if (!owned) return null;
    const cursor = input.cursor
      ? await this.prisma.coachMessage.findFirst({
          where: { id: input.cursor, conversationId: input.conversationId },
          select: { id: true, createdAt: true },
        })
      : null;
    if (input.cursor && !cursor) return null;
    const messages = await this.prisma.coachMessage.findMany({
      where: {
        conversationId: input.conversationId,
        ...(cursor
          ? {
              OR: [
                { createdAt: { gt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { gt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: input.limit + 1,
    });
    return { conversation: owned, messages };
  }

  findOwnedRequest(subjectId: string, requestId: string) {
    return this.prisma.coachRequest.findFirst({
      where: { id: requestId, userId: subjectId },
    });
  }

  async appendMessage(input: {
    id: string;
    subjectId: string;
    conversationId: string;
    requestId?: string;
    role: 'USER' | 'COACH';
    content?: string;
    resultSchemaVersion?: string;
    structuredResult?: object;
  }) {
    const conversation = await this.prisma.coachConversation.findFirst({
      where: {
        id: input.conversationId,
        userId: input.subjectId,
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    if (!conversation) return null;
    return this.prisma.coachMessage.create({
      data: {
        id: input.id,
        conversationId: input.conversationId,
        requestId: input.requestId,
        role: input.role,
        content: input.content,
        resultSchemaVersion: input.resultSchemaVersion,
        structuredResult: input.structuredResult,
      },
    });
  }
}
