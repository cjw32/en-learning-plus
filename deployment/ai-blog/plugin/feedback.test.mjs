import test from 'node:test';
import assert from 'node:assert/strict';
import {registerFeedback} from './feedback.mjs';

test('acknowledgements are private, deduplicated, cached and fail independently', async () => {
  const oldId = process.env.FEISHU_APP_ID, oldSecret = process.env.FEISHU_APP_SECRET;
  process.env.FEISHU_APP_ID = 'test'; process.env.FEISHU_APP_SECRET = 'test';
  const calls = [], logs = [], hooks = {};
  const api = {config: {channels: {feishu: {enabled: true, dmPolicy: 'allowlist', allowFrom: ['ou_owner']}}},
    on: (name, fn) => {hooks[name] = fn;}, logger: {info: s => logs.push(s), warn: s => logs.push(s)}};
  let fail = false;
  const fetchImpl = async (url, options) => {
    calls.push({url, body: JSON.parse(options.body), signal: options.signal});
    if (fail) throw new Error('secret error body');
    return new Response(JSON.stringify(url.includes('/auth/') ? {code: 0, tenant_access_token: 'test-token', expire: 7200} : {code: 0}));
  };
  const event = {from: 'feishu:ou_owner', content: '测试消息', messageId: 'om_test', metadata: {to: 'user:ou_owner'}};
  const ctx = {channelId: 'feishu', accountId: 'main', senderId: 'ou_owner'};
  try {
    registerFeedback(api, {fetchImpl});
    const receive = hooks.message_received;
    for (const [e, c] of [[event, {...ctx, senderId: 'ou_other'}], [event, {...ctx, channelId: 'slack'}],
      [{...event, metadata: {to: 'chat:oc_group'}}, ctx], [{...event, content: '/stop'}, ctx],
      [{...event, messageId: undefined}, ctx]]) await receive(e, c);
    assert.equal(calls.length, 0);
    await Promise.all([receive(event, ctx), receive(event, ctx)]);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].body.receive_id, 'ou_owner');
    assert.ok(calls[1].body.uuid.length <= 50);
    assert.ok(calls[1].signal);
    const uuid = calls[1].body.uuid;
    await receive({...event, messageId: 'om_next'}, ctx);
    assert.equal(calls.length, 3, 'reuse tenant token');
    registerFeedback(api, {fetchImpl});
    await hooks.message_received(event, ctx);
    assert.equal(calls.at(-1).body.uuid, uuid, 'stable API idempotency after reload');
    fail = true;
    await assert.doesNotReject(hooks.message_received({...event, messageId: 'om_fail'}, ctx));
    assert.ok(logs.at(-1).includes('main reply continues'));
    assert.ok(!logs.join('').includes('secret error body'));
  } finally {
    for (const [key, value] of [['FEISHU_APP_ID', oldId], ['FEISHU_APP_SECRET', oldSecret]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
