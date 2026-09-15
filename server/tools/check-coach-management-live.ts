// Opt-in local persistence check. Seeds synthetic completed output, never calls a model.
import { config } from 'dotenv';
import { randomUUID, createHash } from 'node:crypto';
import { strict as assert } from 'node:assert';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../libs/shared/src/generated/prisma/client';
config({ quiet: true });
async function main() {
  assert.equal(process.env.COACH_MANAGEMENT_LIVE_CHECK, 'true');
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '15432');
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url.toString() }),
  });
  const users: any[] = [];
  async function register() {
    const r = await fetch('http://127.0.0.1:3000/api/v1/user/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Coach管理联调',
        phone: `198${Date.now().toString().slice(-8)}`,
        password: createHash('md5').update(randomUUID()).digest('hex'),
      }),
    }).then((r) => r.json());
    assert(
      r.data?.token?.accessToken,
      `Registration failed: ${r.code} ${r.message}`,
    );
    users.push(r.data);
    return r.data;
  }
  async function request(
    user: any,
    path: string,
    method = 'GET',
    body?: unknown,
  ) {
    return fetch(`http://127.0.0.1:3001/ai/v1/coach${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${user.token.accessToken}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `live-${randomUUID()}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  }
  async function api(user: any, path: string, method = 'GET', body?: unknown) {
    const r = await request(user, path, method, body);
    assert(r.ok, `${method} failed: ${r.status}`);
    return (await r.json()).data;
  }
  try {
    const owner = await register(),
      other = await register();
    const a = await api(owner, '/conversations', 'POST', {
      title: '合成历史验证',
    });
    const b = await api(owner, '/conversations', 'POST', {
      title: '合成分页验证',
    });
    const first = await api(owner, '/conversations?limit=1');
    assert.equal(first.items.length, 1);
    assert(first.nextCursor);
    const second = await api(
      owner,
      `/conversations?limit=1&cursor=${first.nextCursor}`,
    );
    assert.equal(second.items.length, 1);
    assert.notEqual(second.items[0].id, first.items[0].id);
    const requestId = `request_${randomUUID()}`,
      traceId = `trace_${randomUUID()}`;
    const result = {
      schemaVersion: 'coach.result.v1',
      responseType: 'answer',
      correction: '',
      explanation: 'Synthetic history verification.',
      examples: ['I went home.'],
      errorTypes: [],
      score: null,
      nextAction: 'continue',
      citations: [],
      nextActionReason: 'Continue practicing.',
      traceId,
    };
    await db.coachRequest.create({
      data: {
        id: requestId,
        userId: owner.id,
        conversationId: a.id,
        clientRequestKey: randomUUID(),
        requestBodyHash: 'synthetic',
        inputPayload: { type: 'MESSAGE', message: 'synthetic' },
        inputType: 'MESSAGE',
        status: 'COMPLETED',
        deadlineAt: new Date(),
        finishedAt: new Date(),
        finalResultSchemaVersion: 'coach.result.v1',
        finalResult: result,
        trace: {
          create: {
            id: traceId,
            promptVersion: 'synthetic',
            promptHash: 'synthetic',
            modelProvider: 'fixture',
            modelName: 'fixture',
            modelVersion: 'fixture',
            resultSchemaVersion: 'coach.result.v1',
            budgetVersion: 'fixture',
            currency: 'USD',
            terminalStatus: 'COMPLETED',
            resultType: 'ANSWER',
            expiresAt: new Date(Date.now() + 86400000),
          },
        },
      },
    });
    await db.coachMessage.create({
      data: {
        conversationId: a.id,
        requestId,
        role: 'COACH',
        resultSchemaVersion: 'coach.result.v1',
        structuredResult: result,
      },
    });
    const detail = await api(owner, `/conversations/${a.id}?limit=20`);
    assert.equal(detail.messages[0].requestId, requestId);
    assert.equal(detail.messages[0].feedback, null);
    const feedback = {
      rating: 'DOWN',
      category: 'TOO_HARD',
      comment: 'Synthetic feedback',
    };
    await api(owner, `/requests/${requestId}/feedback`, 'PUT', feedback);
    const reloaded = await api(owner, `/conversations/${a.id}`);
    assert.deepEqual(reloaded.messages[0].feedback, feedback);
    assert.equal((await request(other, `/conversations/${a.id}`)).status, 404);
    assert.equal(
      (await request(other, `/requests/${requestId}/feedback`, 'PUT', feedback))
        .status,
      404,
    );
    assert.equal(
      (await request(other, `/conversations/${a.id}`, 'DELETE')).status,
      404,
    );
    await api(owner, `/conversations/${a.id}`, 'DELETE');
    assert.equal((await request(owner, `/conversations/${a.id}`)).status, 404);
    await api(other, '/conversations', 'POST', { title: '合成全量删除' });
    const deletion = await api(other, '/data', 'DELETE', {
      confirmation: 'DELETE_COACH_DATA',
    });
    assert.equal(deletion.status, 'ACCEPTED');
    assert.equal(
      (await api(owner, `/conversations/${b.id}`)).conversation.id,
      b.id,
    );
    console.log(
      JSON.stringify({
        realLocalDatabase: true,
        conversationCreation: true,
        cursorPagination: true,
        historyFeedbackPersisted: true,
        crossUserAccessDenied: true,
        conversationHiddenAfterDeletion: true,
        dataDeletionAccepted: true,
        otherUserUnaffected: true,
        modelCalls: 0,
      }),
    );
  } finally {
    for (const user of users)
      await db.user.deleteMany({ where: { id: user.id } });
    await db.$disconnect();
  }
}
main().catch((error) => {
  console.error(
    'Coach management check failed:',
    error instanceof assert.AssertionError
      ? error.message
      : JSON.stringify({
          name: error.name,
          code: error.code,
          meta: error.meta,
          cause: error.cause,
        }),
  );
  process.exitCode = 1;
});
