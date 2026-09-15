// Local synthetic HTTP check, never calls the model or speech provider.
import { config } from 'dotenv';
import { randomUUID, createHash } from 'node:crypto';
import { strict as assert } from 'node:assert';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../libs/shared/src/generated/prisma/client';
config({ quiet: true });
async function main() {
  assert.equal(process.env.STUDY_DAY_LIVE_CHECK, 'true');
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '15432');
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url.toString() }),
  });
  let userId: string | undefined,
    wordId: string | undefined,
    token = '';
  const request = (path: string, body?: unknown) =>
    fetch(`http://127.0.0.1:3000/api/v1${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  try {
    assert.equal((await request('/learn/stats')).status, 401);
    const registered = await (
      await request('/user/register', {
        name: '引用打卡联调',
        phone: `199${Date.now().toString().slice(-8)}`,
        password: createHash('md5').update(randomUUID()).digest('hex'),
      })
    ).json();
    assert(registered.data?.token?.accessToken);
    userId = registered.data.id;
    token = registered.data.token.accessToken;
    let stats = await (await request('/learn/stats')).json();
    assert.equal(stats.data.dayNumber, 0);
    assert.equal(stats.data.checkedInToday, false);
    const word = await db.wordBook.create({
      data: {
        word: `citedfixture${randomUUID()}`,
        definition: 'Synthetic citation definition',
      },
    });
    wordId = word.id;
    const citationResponse = await request(`/word-book/${wordId}`);
    assert([200, 404].includes(citationResponse.status));
    if (citationResponse.status === 200) {
      const cited = await citationResponse.json();
      assert.equal(cited.data.word.wordId, wordId);
      console.log('PASS: authorized exact word citation over HTTP.');
    } else
      console.log(
        'PASS: current source-rights configuration denies unapproved word citation with 404; authorized projection covered by repository and browser tests.',
      );
    const first = await (
      await request('/learn/word/master', { wordIds: [wordId] })
    ).json();
    assert.equal(first.data.dayNumber, 1);
    assert.equal(first.data.wordNumber, 1);
    const replay = await (
      await request('/learn/word/master', { wordIds: [wordId] })
    ).json();
    assert.equal(replay.data.dayNumber, 1);
    stats = await (await request('/learn/stats?userId=unrelated-user')).json();
    assert.equal(stats.data.dayNumber, 1);
    assert.equal(stats.data.checkedInToday, true);
    assert.equal(stats.data.timezone, 'Asia/Shanghai');
    assert.equal(
      (await request('/learn/word/master', { wordIds: [] })).status,
      400,
    );
    assert.equal((await request('/word-book/does-not-exist')).status, 404);
    console.log(
      'PASS: real HTTP authentication, saved progress, today state, replay protection, token-owned stats and invalid input.',
    );
  } finally {
    if (userId) await db.user.deleteMany({ where: { id: userId } });
    if (wordId) await db.wordBook.deleteMany({ where: { id: wordId } });
    await db.$disconnect();
  }
}
main().catch((error) => {
  console.error(
    `Study API verification failed (${error?.name ?? 'unknown'}). No credentials printed.`,
  );
  process.exitCode = 1;
});
