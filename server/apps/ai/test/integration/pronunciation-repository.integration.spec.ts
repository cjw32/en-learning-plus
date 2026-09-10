/* eslint-disable @typescript-eslint/no-unsafe-argument -- Synchronous typed test doubles preserve async ports, and Jest assertions intentionally inspect mock methods. */

import type { PrismaService } from '@libs/shared';
import {
  hashPronunciationContent,
  PronunciationIdempotencyConflictError,
  PronunciationRepository,
} from '../../src/pronunciation/application/pronunciation.repository';

type Row = {
  id: string;
  userId: string;
  clientIdempotencyKey: string;
  requestBodyHash: string;
  status: any;
  exerciseType: any;
  deadlineAt: Date;
  cancelRequestedAt: Date | null;
  hiddenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  [key: string]: unknown;
};

function fixture() {
  const rows = new Map<string, Row>();
  const key = (userId: string, idempotencyKey: string) =>
    `${userId}:${idempotencyKey}`;
  const model = {
    async findUnique(input: any) {
      const where = input.where.userId_clientIdempotencyKey;
      return rows.get(key(where.userId, where.clientIdempotencyKey)) ?? null;
    },
    async findFirst(input: any) {
      return (
        [...rows.values()].find(
          (row) =>
            row.id === input.where.id &&
            row.userId === input.where.userId &&
            row.hiddenAt === null,
        ) ?? null
      );
    },
    async create(input: any) {
      const data = input.data;
      const storageKey = key(data.userId, data.clientIdempotencyKey);
      if (rows.has(storageKey))
        throw Object.assign(new Error(), { code: 'P2002' });
      const now = new Date('2026-09-10T00:00:00.000Z');
      const row: Row = {
        ...data,
        cancelRequestedAt: null,
        hiddenAt: null,
        createdAt: now,
        updatedAt: now,
      };
      rows.set(storageKey, row);
      return row;
    },
    async updateMany(input: any) {
      const row = [...rows.values()].find(
        (candidate) =>
          candidate.id === input.where.id &&
          candidate.userId === input.where.userId &&
          (typeof input.where.status === 'string'
            ? candidate.status === input.where.status
            : input.where.status.in.includes(candidate.status)) &&
          (input.where.contentFingerprint === undefined ||
            candidate.contentFingerprint === input.where.contentFingerprint),
      );
      if (!row) return { count: 0 };
      Object.assign(row, input.data);
      return { count: 1 };
    },
  };
  const prisma = { pronunciationAssessment: model } as unknown as PrismaService;
  return { repository: new PronunciationRepository(prisma), rows };
}

const createInput = {
  id: 'assessment-1',
  subjectId: 'subject-1',
  clientIdempotencyKey: 'idempotency-key-0001',
  requestBodyHash: 'body-hash-1',
  exerciseType: 'WORD' as const,
  deadlineAt: new Date('2026-09-10T00:00:30.000Z'),
};

describe('PronunciationRepository', () => {
  it('hashes canonical content independently of object key order', () => {
    expect(hashPronunciationContent({ b: 2, a: { d: 4, c: 3 } })).toBe(
      hashPronunciationContent({ a: { c: 3, d: 4 }, b: 2 }),
    );
    expect(hashPronunciationContent({ a: 1 })).not.toBe(
      hashPronunciationContent({ a: 2 }),
    );
  });

  it('replays same-owner same-key same-hash and rejects a different hash', async () => {
    const { repository, rows } = fixture();
    await expect(
      repository.createIdempotent(createInput),
    ).resolves.toMatchObject({
      disposition: 'CREATED',
    });
    await expect(
      repository.createIdempotent(createInput),
    ).resolves.toMatchObject({
      disposition: 'REPLAYED',
    });
    await expect(
      repository.createIdempotent({
        ...createInput,
        requestBodyHash: 'different',
      }),
    ).rejects.toBeInstanceOf(PronunciationIdempotencyConflictError);
    expect(rows.size).toBe(1);
  });

  it('atomically binds upload content and rejects a changed replay', async () => {
    const { repository, rows } = fixture();
    await repository.createIdempotent(createInput);
    const row = [...rows.values()][0];
    row.contentFingerprint = null;
    row.target = { targetHash: 'target-hash' };
    const intent = {
      subjectId: createInput.subjectId,
      assessmentId: createInput.id,
      idempotencyKey: 'upload-key-000001',
      declaredMediaType: 'audio/webm',
      byteSize: 4,
      sha256: 'a'.repeat(64),
    };

    await expect(repository.bindAudioIntent(intent)).resolves.toBe('BOUND');
    expect(row.status).toBe('AUDIO_VALIDATING');
    await expect(repository.bindAudioIntent(intent)).resolves.toBe('REPLAYED');
    await expect(
      repository.bindAudioIntent({ ...intent, sha256: 'b'.repeat(64) }),
    ).rejects.toBeInstanceOf(PronunciationIdempotencyConflictError);
  });

  it('allows exactly one duplicate worker claim', async () => {
    const { repository } = fixture();
    await repository.createIdempotent(createInput);
    await repository.transitionOwned({
      subjectId: createInput.subjectId,
      assessmentId: createInput.id,
      from: ['CREATED'],
      to: 'AUDIO_VALIDATING',
    });
    await repository.transitionOwned({
      subjectId: createInput.subjectId,
      assessmentId: createInput.id,
      from: ['AUDIO_VALIDATING'],
      to: 'AUDIO_READY',
    });
    await repository.transitionOwned({
      subjectId: createInput.subjectId,
      assessmentId: createInput.id,
      from: ['AUDIO_READY'],
      to: 'QUEUED',
    });

    const claims = await Promise.all([
      repository.transitionOwned({
        subjectId: createInput.subjectId,
        assessmentId: createInput.id,
        from: ['QUEUED'],
        to: 'PROCESSING',
      }),
      repository.transitionOwned({
        subjectId: createInput.subjectId,
        assessmentId: createInput.id,
        from: ['QUEUED'],
        to: 'PROCESSING',
      }),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it('does not overwrite terminal outcomes or cross-owner rows', async () => {
    const { repository } = fixture();
    await repository.createIdempotent(createInput);
    for (const [from, to] of [
      ['CREATED', 'AUDIO_VALIDATING'],
      ['AUDIO_VALIDATING', 'AUDIO_READY'],
      ['AUDIO_READY', 'QUEUED'],
      ['QUEUED', 'PROCESSING'],
      ['PROCESSING', 'COMPLETED'],
    ] as const) {
      expect(
        await repository.transitionOwned({
          subjectId: createInput.subjectId,
          assessmentId: createInput.id,
          from: [from],
          to,
        }),
      ).toBe(true);
    }
    await expect(
      repository.transitionOwned({
        subjectId: createInput.subjectId,
        assessmentId: createInput.id,
        from: ['COMPLETED'],
        to: 'FAILED',
      }),
    ).resolves.toBe(false);
    await expect(
      repository.transitionOwned({
        subjectId: 'other-subject',
        assessmentId: createInput.id,
        from: ['COMPLETED'],
        to: 'DELETING',
      }),
    ).resolves.toBe(false);
  });
});
