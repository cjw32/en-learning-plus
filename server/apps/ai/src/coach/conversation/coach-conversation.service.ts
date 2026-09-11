import { Injectable } from '@nestjs/common';
import { PrismaService } from '@libs/shared';
import { Prisma } from '@libs/shared/generated/prisma/client';
import type { McpOperationEnvelope } from '../mcp/mcp-operation-envelope.factory';

export const USER_COACH_CONVERSATION_ORIGIN = 'COACH' as const;
export const MCP_OPERATION_CONVERSATION_ORIGIN = 'MCP' as const;

export function ownedCoachConversationWhere(
  subjectId: string,
  conversationId?: string,
) {
  return Object.freeze({
    ...(conversationId ? { id: conversationId } : {}),
    userId: subjectId,
    origin: USER_COACH_CONVERSATION_ORIGIN,
    status: 'ACTIVE' as const,
  });
}

@Injectable()
export class CoachConversationService {
  constructor(private readonly prisma: PrismaService) {}

  createMcpOperationEnvelope(
    input: Readonly<{
      id: string;
      userId: string;
      checkpointThreadId: string;
      now: Date;
      expiresAt: Date;
    }>,
  ) {
    return this.prisma.coachConversation.create({
      data: {
        id: input.id,
        userId: input.userId,
        title: null,
        origin: MCP_OPERATION_CONVERSATION_ORIGIN,
        checkpointThreadId: input.checkpointThreadId,
        lastActivityAt: input.now,
        expiresAt: input.expiresAt,
      },
    });
  }

  async persistMcpOperationEnvelope(
    envelope: McpOperationEnvelope,
  ): Promise<McpOperationEnvelope> {
    await this.prisma.$transaction(async (transaction) => {
      const conversation = await transaction.coachConversation.findUnique({
        where: { id: envelope.conversation.id },
        select: {
          userId: true,
          origin: true,
          checkpointThreadId: true,
        },
      });
      if (conversation) {
        if (
          conversation.userId !== envelope.conversation.userId ||
          conversation.origin !== MCP_OPERATION_CONVERSATION_ORIGIN ||
          conversation.checkpointThreadId !==
            envelope.conversation.checkpointThreadId
        ) {
          throw new Error('MCP operation conversation ownership conflict');
        }
      } else {
        await transaction.coachConversation.create({
          data: envelope.conversation,
        });
      }

      const request = await transaction.coachRequest.findUnique({
        where: { id: envelope.request.id },
        select: {
          userId: true,
          conversationId: true,
          clientRequestKey: true,
          requestBodyHash: true,
        },
      });
      if (request) {
        if (
          request.userId !== envelope.request.userId ||
          request.conversationId !== envelope.request.conversationId ||
          request.clientRequestKey !== envelope.request.clientRequestKey ||
          request.requestBodyHash !== envelope.request.requestBodyHash
        ) {
          throw new Error('MCP operation request ownership conflict');
        }
      } else {
        await transaction.coachRequest.create({
          data: {
            ...envelope.request,
            inputPayload: envelope.request
              .inputPayload as Prisma.InputJsonValue,
          },
        });
      }
    });
    return envelope;
  }
}
