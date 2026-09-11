import { CoachRequestRepository } from '../../src/coach/api/coach-request.repository';
import {
  CoachConversationService,
  ownedCoachConversationWhere,
} from '../../src/coach/conversation/coach-conversation.service';

const now = new Date('2026-09-11T08:00:00.000Z');

describe('Coach conversation origin isolation', () => {
  it('persists internal MCP operation envelopes with origin MCP', async () => {
    const create = jest.fn(async ({ data }) => data);
    const service = new CoachConversationService({
      coachConversation: { create },
    } as never);

    await service.createMcpOperationEnvelope({
      id: 'conversation_mcp_operation_0001',
      userId: 'learner_a',
      checkpointThreadId: 'thread_mcp_operation_0001',
      now,
      expiresAt: new Date('2026-09-12T08:00:00.000Z'),
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        id: 'conversation_mcp_operation_0001',
        userId: 'learner_a',
        title: null,
        origin: 'MCP',
        checkpointThreadId: 'thread_mcp_operation_0001',
        lastActivityAt: now,
        expiresAt: new Date('2026-09-12T08:00:00.000Z'),
      },
    });
  });

  it('creates ordinary Web Coach conversations explicitly as COACH', async () => {
    const create = jest.fn(async ({ data }) => data);
    const repository = new CoachRequestRepository({
      coachConversation: { create },
    } as never);

    await repository.createConversation({
      id: 'conversation_coach_0001',
      subjectId: 'learner_a',
      title: 'My coach',
      checkpointThreadId: 'thread_coach_0001',
      now,
      expiresAt: new Date('2026-12-10T08:00:00.000Z'),
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: 'conversation_coach_0001',
        userId: 'learner_a',
        origin: 'COACH',
      }),
    });
  });

  it('filters ownership, cursor lookup, and history listing to origin COACH', async () => {
    const findFirst = jest
      .fn()
      .mockResolvedValueOnce({ id: 'conversation_coach_0001' })
      .mockResolvedValueOnce({ id: 'conversation_coach_0001' })
      .mockResolvedValueOnce({
        id: 'conversation_cursor_0001',
        lastActivityAt: now,
      });
    const findMany = jest.fn(async () => []);
    const repository = new CoachRequestRepository({
      coachConversation: { findFirst, findMany },
    } as never);

    await expect(
      repository.isConversationOwned('learner_a', 'conversation_coach_0001'),
    ).resolves.toBe(true);
    await repository.findOwnedConversation(
      'learner_a',
      'conversation_coach_0001',
    );
    await repository.listOwnedConversations({
      subjectId: 'learner_a',
      cursor: 'conversation_cursor_0001',
      limit: 20,
    });

    expect(findFirst.mock.calls[0]?.[0]?.where).toEqual(
      ownedCoachConversationWhere('learner_a', 'conversation_coach_0001'),
    );
    expect(findFirst.mock.calls[1]?.[0]?.where).toEqual(
      ownedCoachConversationWhere('learner_a', 'conversation_coach_0001'),
    );
    expect(findFirst.mock.calls[2]?.[0]?.where).toEqual(
      ownedCoachConversationWhere('learner_a', 'conversation_cursor_0001'),
    );
    expect(findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        userId: 'learner_a',
        origin: 'COACH',
        status: 'ACTIVE',
      }),
      orderBy: [{ lastActivityAt: 'desc' }, { id: 'desc' }],
      take: 21,
    });
  });

  it('treats an MCP-origin conversation ID as absent from user Coach history', async () => {
    const findFirst = jest.fn(async ({ where }) =>
      where.origin === 'COACH'
        ? null
        : { id: 'conversation_mcp_operation_0001' },
    );
    const repository = new CoachRequestRepository({
      coachConversation: { findFirst },
    } as never);

    await expect(
      repository.findOwnedConversation(
        'learner_a',
        'conversation_mcp_operation_0001',
      ),
    ).resolves.toBeNull();
    await expect(
      repository.isConversationOwned(
        'learner_a',
        'conversation_mcp_operation_0001',
      ),
    ).resolves.toBe(false);
    expect(findFirst).toHaveBeenCalledTimes(2);
    for (const [query] of findFirst.mock.calls) {
      expect(query.where).toMatchObject({ origin: 'COACH' });
    }
  });
});
