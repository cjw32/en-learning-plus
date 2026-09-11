import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { McpReviewsTodayResource } from '../../src/mcp/resources/reviews-today.resource';
import type { McpRequestContext } from '../../src/mcp/auth/mcp-principal';

type CursorBinding = Readonly<{
  principalKey: string;
  resource: string;
  filterHash: string;
  contentVersion: string;
}>;

type CursorPosition = Readonly<{
  sortValue: string;
  tieBreaker: string;
}>;

type CursorService = Readonly<{
  issue(binding: CursorBinding, position: CursorPosition): string;
  verify(cursor: string, binding: CursorBinding): CursorPosition;
}>;

type CursorServiceConstructor = new (
  options: Readonly<{
    hmacKey: string;
    ttlMs: number;
    now: () => Date;
  }>,
) => CursorService;

const implementationPath = resolve(
  __dirname,
  '../../src/mcp/pagination/mcp-cursor.service.ts',
);

function loadCursorService(): CursorServiceConstructor {
  if (!existsSync(implementationPath)) {
    throw new Error('Missing signed MCP cursor service (T056)');
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Service = require(implementationPath).McpCursorService as
    | CursorServiceConstructor
    | undefined;
  if (!Service) throw new Error('Missing McpCursorService export (T056)');
  return Service;
}

const initialTime = new Date('2026-09-11T08:00:00.000Z');
let currentTime = initialTime;

const bindingA: CursorBinding = Object.freeze({
  principalKey: 'subject_hmac_a',
  resource: 'en-learning://me/reviews/today',
  filterHash: 'filters_sha256_default',
  contentVersion: 'review-snapshot.v1',
});

const position: CursorPosition = Object.freeze({
  sortValue: '2026-09-11T07:30:00.000Z',
  tieBreaker: 'word_practice',
});

const requestContext: McpRequestContext = Object.freeze({
  principal: Object.freeze({
    issuer: 'https://issuer.mcp.test',
    subject: 'pagination-subject-a',
    audience: 'https://resource.mcp.test/ai/v1/mcp',
    clientId: 'pagination-client-a',
    scopes: Object.freeze(['learning:read'] as const),
    authorizationVersion: 1,
    issuedAtEpochSeconds: 1_789_117_140,
    notBeforeEpochSeconds: 1_789_117_140,
    expiresAtEpochSeconds: 1_789_120_800,
    verificationMethodVersion: 'fixture.v1',
  }),
  userId: 'learner_a',
  authorizationId: 'authorization_a',
  requestId: 'request_pagination_0001',
  traceId: 'trace_pagination_0001',
  protocolVersion: '2026-07-28',
});

function service(): CursorService {
  const Service = loadCursorService();
  return new Service({
    hmacKey: 'mcp-cursor-test-hmac-key-at-least-32-bytes',
    ttlMs: 5 * 60 * 1_000,
    now: () => new Date(currentTime),
  });
}

describe('MCP opaque Resource pagination and invalidation', () => {
  beforeEach(() => {
    currentTime = initialTime;
  });

  it('round-trips a signed opaque cursor without exposing the principal', () => {
    const cursor = service().issue(bindingA, position);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(cursor).not.toContain(bindingA.principalKey);
    expect(cursor).not.toContain('learner_a');
    expect(service().verify(cursor, bindingA)).toEqual(position);
  });

  it('rejects a one-byte-equivalent mutation', () => {
    const cursorService = service();
    const cursor = cursorService.issue(bindingA, position);
    const [payload, signature] = cursor.split('.');
    const mutated = `${payload}${payload?.endsWith('A') ? 'B' : 'A'}.${signature}`;

    expect(() => cursorService.verify(mutated, bindingA)).toThrow(
      expect.objectContaining({ code: 'CURSOR_INVALID' }),
    );
  });

  it.each([
    {
      name: 'another principal',
      overrides: { principalKey: 'subject_hmac_b' },
    },
    {
      name: 'another Resource',
      overrides: { resource: 'en-learning://me/weaknesses' },
    },
    {
      name: 'changed filters',
      overrides: { filterHash: 'filters_sha256_course_changed' },
    },
    {
      name: 'changed review/report content version',
      overrides: { contentVersion: 'review-snapshot.v2' },
    },
  ])('rejects reuse for $name', ({ overrides }) => {
    const cursorService = service();
    const cursor = cursorService.issue(bindingA, position);
    expect(() =>
      cursorService.verify(cursor, { ...bindingA, ...overrides }),
    ).toThrow(expect.objectContaining({ code: 'CURSOR_INVALID' }));
  });

  it('rejects an expired cursor at the exact TTL boundary', () => {
    const cursorService = service();
    const cursor = cursorService.issue(bindingA, position);
    currentTime = new Date(initialTime.getTime() + 5 * 60 * 1_000);

    expect(() => cursorService.verify(cursor, bindingA)).toThrow(
      expect.objectContaining({ code: 'CURSOR_INVALID' }),
    );
  });

  it('supports deterministic keyset pagination under concurrent inserts', () => {
    const cursorService = service();
    const original = [
      { dueAt: '2026-09-11T07:00:00.000Z', id: 'word_a' },
      { dueAt: '2026-09-11T07:30:00.000Z', id: 'word_b' },
      { dueAt: '2026-09-11T08:00:00.000Z', id: 'word_c' },
      { dueAt: '2026-09-11T08:00:00.000Z', id: 'word_d' },
    ];
    const firstPage = original.slice(0, 2);
    const cursor = cursorService.issue(bindingA, {
      sortValue: firstPage[1]!.dueAt,
      tieBreaker: firstPage[1]!.id,
    });
    const decoded = cursorService.verify(cursor, bindingA);
    const afterInsert = [
      { dueAt: '2026-09-11T06:30:00.000Z', id: 'word_new' },
      ...original,
    ];
    const nextPage = afterInsert
      .filter(
        (item) =>
          item.dueAt > decoded.sortValue ||
          (item.dueAt === decoded.sortValue && item.id > decoded.tieBreaker),
      )
      .slice(0, 2);

    expect(nextPage).toEqual([
      { dueAt: '2026-09-11T08:00:00.000Z', id: 'word_c' },
      { dueAt: '2026-09-11T08:00:00.000Z', id: 'word_d' },
    ]);
    expect(new Set([...firstPage, ...nextPage].map(({ id }) => id)).size).toBe(
      4,
    );
  });

  it('invalidates stale private-resource pagination after a review/report change', () => {
    const cursorService = service();
    const staleCursor = cursorService.issue(bindingA, position);
    const changedBinding = {
      ...bindingA,
      contentVersion: 'review-snapshot.after-attempt.v2',
    };

    expect(() => cursorService.verify(staleCursor, changedBinding)).toThrow(
      expect.objectContaining({ code: 'CURSOR_INVALID' }),
    );
    const freshCursor = cursorService.issue(changedBinding, position);
    expect(cursorService.verify(freshCursor, changedBinding)).toEqual(position);
  });

  it('threads a verified cursor through the private Resource handler', async () => {
    const contentVersion = 'review-snapshot.v1';
    const updatedAt = new Date('2026-09-11T08:00:00.000Z');
    const item = (wordId: string, dueAt: string) => ({
      wordId,
      word: wordId,
      reviewState: 'REVIEW' as const,
      dueAt,
      priority: 10,
      reason: 'Scheduled review is due.',
    });
    const reports = {
      getDueReviews: jest.fn(async (input: any) =>
        input.position
          ? {
              learningDate: '2026-09-11',
              timezone: 'Asia/Shanghai',
              totalDue: 3,
              items: [item('word_c', '2026-09-11T08:00:00.000Z')],
              truncated: false,
              nextPosition: null,
              contentVersion,
              updatedAt,
            }
          : {
              learningDate: '2026-09-11',
              timezone: 'Asia/Shanghai',
              totalDue: 3,
              items: [
                item('word_a', '2026-09-11T07:00:00.000Z'),
                item('word_b', '2026-09-11T07:30:00.000Z'),
              ],
              truncated: true,
              nextPosition: {
                sortValue: '2026-09-11T07:30:00.000Z',
                tieBreaker: 'word_b',
              },
              contentVersion,
              updatedAt,
            },
      ),
    };
    const handler = new McpReviewsTodayResource(reports as never, service());
    const first = (await handler.read(
      { uri: 'en-learning://me/reviews/today', limit: 2 },
      requestContext,
    )) as any;
    expect(first.meta.nextCursor).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    const second = (await handler.read(
      {
        uri: 'en-learning://me/reviews/today',
        limit: 2,
        cursor: first.meta.nextCursor,
      },
      requestContext,
    )) as any;
    expect(
      second.items.map(({ wordId }: { wordId: string }) => wordId),
    ).toEqual(['word_c']);
    expect(reports.getDueReviews).toHaveBeenLastCalledWith({
      userId: 'learner_a',
      limit: 2,
      cursor: undefined,
      position: {
        sortValue: '2026-09-11T07:30:00.000Z',
        tieBreaker: 'word_b',
      },
    });
  });
});
