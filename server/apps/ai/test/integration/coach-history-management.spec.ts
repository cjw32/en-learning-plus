import { CoachApiService } from '../../src/coach/api/coach-api.service';
import { CoachRequestRepository } from '../../src/coach/api/coach-request.repository';
import { CoachExecutionContext } from '@libs/shared';
const now = new Date('2026-09-15T00:00:00Z');
const context = new CoachExecutionContext('history-owner', 1_900_000_000);
describe('Coach history feedback projection', () => {
  it('only exposes the owning request id and public feedback fields in history', async () => {
    const repository = {
      listOwnedMessages: jest.fn().mockResolvedValue({
        conversation: {
          id: 'conversation-a',
          title: 'Practice',
          status: 'ACTIVE',
          lastActivityAt: now,
          expiresAt: now,
          createdAt: now,
        },
        messages: [
          {
            id: 'message-a',
            requestId: 'request-a',
            role: 'COACH',
            content: null,
            structuredResult: null,
            createdAt: now,
            request: {
              feedback: [
                { rating: 'DOWN', category: 'TOO_HARD', comment: 'Simplify' },
              ],
              inputPayload: 'must-not-leak',
              userId: 'private',
            },
          },
        ],
      }),
    };
    const service = new CoachApiService(
      {} as never,
      repository as never,
      {} as never,
      {} as never,
      { success: (data: unknown) => data } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { assertSubjectActive: jest.fn() } as never,
    );
    const result = await service.getConversation(context, 'conversation-a', {
      limit: 20,
    });
    expect(result.messages[0]).toEqual({
      id: 'message-a',
      requestId: 'request-a',
      role: 'COACH',
      content: null,
      structuredResult: null,
      createdAt: now.toISOString(),
      feedback: { rating: 'DOWN', category: 'TOO_HARD', comment: 'Simplify' },
    });
    expect(JSON.stringify(result)).not.toContain('must-not-leak');
    repository.listOwnedMessages.mockResolvedValueOnce(null);
    await expect(
      service.getConversation(context, 'foreign', { limit: 20 }),
    ).rejects.toThrow('不可访问');
  });
  it('scopes feedback by subject and expiry and rejects inaccessible conversation cursors', async () => {
    const prisma = {
      coachConversation: {
        findFirst: jest.fn().mockResolvedValue({ id: 'conversation-a' }),
      },
      coachMessage: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const repository = new CoachRequestRepository(prisma as never);
    await repository.listOwnedMessages({
      subjectId: 'history-owner',
      conversationId: 'conversation-a',
      limit: 20,
    });
    expect(prisma.coachMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: {
          request: {
            select: {
              feedback: {
                where: {
                  userId: 'history-owner',
                  expiresAt: { gt: expect.any(Date) },
                },
                select: { rating: true, category: true, comment: true },
                take: 1,
              },
            },
          },
        },
      }),
    );
    expect(
      await repository.listOwnedMessages({
        subjectId: 'history-owner',
        conversationId: 'conversation-a',
        limit: 20,
        cursor: 'foreign',
      }),
    ).toBeNull();
    expect(prisma.coachMessage.findMany).toHaveBeenCalledTimes(1);
  });
});
