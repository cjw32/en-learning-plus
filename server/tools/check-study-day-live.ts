// Opt-in local database check; only synthetic accounts/words created here are removed.
import 'reflect-metadata';
import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { strict as assert } from 'node:assert';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../libs/shared/src/generated/prisma/client';
import { recordStudyDay, studyDate } from '../libs/shared/src/study/study-day';
import { LegacyReviewInitializerService } from '../libs/learning/src/review/legacy-review-initializer.service';
config({ quiet: true });
async function main() {
  assert.equal(process.env.STUDY_DAY_LIVE_CHECK, 'true');
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '15432');
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url.toString() }),
  });
  const ids: string[] = [],
    wordIds: string[] = [];
  try {
    for (let i = 0; i < 2; i++) {
      const user = await db.user.create({
        data: {
          name: '学习打卡合成验证',
          phone: `study-${randomUUID()}`,
          password: randomUUID(),
        },
      });
      ids.push(user.id);
    }
    const today = new Date('2026-09-15T00:00:00Z'),
      tomorrow = new Date('2026-09-16T00:00:00Z');
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        db.$transaction((tx) => recordStudyDay(tx, ids[0], today), {
          timeout: 15000,
        }),
      ),
    );
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal(
      (await db.user.findUniqueOrThrow({ where: { id: ids[0] } })).dayNumber,
      1,
    );
    await db.$transaction((tx) => recordStudyDay(tx, ids[0], tomorrow));
    assert.equal(
      (await db.user.findUniqueOrThrow({ where: { id: ids[0] } })).dayNumber,
      2,
    );
    await assert.rejects(
      db.$transaction(async (tx) => {
        await recordStudyDay(tx, ids[1], today);
        throw new Error('rollback');
      }),
    );
    assert.equal(await db.userStudyDay.count({ where: { userId: ids[1] } }), 0);
    assert.equal(
      (await db.user.findUniqueOrThrow({ where: { id: ids[1] } })).dayNumber,
      0,
    );
    for (let i = 0; i < 2; i++) {
      const word = await db.wordBook.create({
        data: { word: `studyfixture${randomUUID()}` },
      });
      wordIds.push(word.id);
    }
    let clock = today;
    const legacy = new LegacyReviewInitializerService(db as never, () => clock);
    const first = await legacy.saveWordMaster(ids[1], [wordIds[0]]);
    assert.equal(first.dayNumber, 1);
    assert.equal(first.wordNumber, 1);
    clock = tomorrow;
    const replay = await legacy.saveWordMaster(ids[1], [wordIds[0]]);
    assert.equal(replay.dayNumber, 1);
    assert.equal(replay.wordNumber, 1);
    assert.equal(
      await db.userStudyDay.count({
        where: { userId: ids[1], studyDate: studyDate(tomorrow) },
      }),
      0,
    );
    const next = await legacy.saveWordMaster(ids[1], [wordIds[1]]);
    assert.equal(next.dayNumber, 2);
    assert.equal(next.wordNumber, 2);
    await assert.rejects(legacy.saveWordMaster(ids[1], []));
    await assert.rejects(legacy.saveWordMaster(ids[1], ['missing-word']));
    assert.equal(
      (await db.user.findUniqueOrThrow({ where: { id: ids[1] } })).dayNumber,
      2,
    );
    console.log(
      'PASS: 20 concurrent saves, daily deduplication, next day, rollback, account isolation, legacy replay, new learning and invalid saves.',
    );
  } finally {
    await db.user.deleteMany({ where: { id: { in: ids } } });
    await db.wordBook.deleteMany({ where: { id: { in: wordIds } } });
    await db.$disconnect();
  }
}
main().catch(() => {
  console.error('Study-day local verification failed. No credentials printed.');
  process.exitCode = 1;
});
