import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import register from './index.mjs';

test('preview omits only a verified duplicate body and keeps review metadata', async () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.PUBLISHER_TOKEN;
  process.env.PUBLISHER_TOKEN = 'test-only';
  const tools = new Map();
  register({registerTool: tool => tools.set(tool.name, tool), on() {}});
  const payload = {body: '完整正文\n```js\nconst n = 1;\n```\n'.repeat(2500)};
  const base = {draft_id: 'edt-test', state: 'awaiting_confirmation', title: '标题',
    summary: '摘要', category: '开发', tags: ['JS'], index: 1, expires_at: 42};
  async function preview(serverValue, status = 200) {
    globalThis.fetch = async (_url, options) => {
      assert.equal(JSON.parse(options.body).body, payload.body);
      return new Response(JSON.stringify(serverValue), {status});
    };
    return tools.get('cjw_blog_edit_preview').execute('test', payload);
  }
  try {
    const result = await preview({...base, body: payload.body});
    const value = JSON.parse(result.content[0].text);
    assert.equal(value.body, undefined);
    assert.equal(value.body_source, 'tool_call_arguments.body');
    assert.equal(value.body_sha256, createHash('sha256').update(payload.body).digest('hex'));
    for (const [key, field] of Object.entries(base)) assert.deepEqual(value[key], field);
    assert.ok(result.content[0].text.length < 1000);
    assert.match(value.note, /complete body/);
    assert.match(value.note, /NEW user confirmation/);
    // A normalized or changed body must stay visible; never silently trust the input.
    const changed = JSON.parse((await preview({...base, body: payload.body + '\n'})).content[0].text);
    assert.equal(changed.body, payload.body + '\n');
    assert.equal(changed.body_source, undefined);
    const error = await preview({...base, body: payload.body, error: 'conflict'}, 409);
    assert.equal(error.isError, true);
    assert.equal(JSON.parse(error.content[0].text).body, payload.body);
    const unexpected = JSON.parse((await preview({body: payload.body})).content[0].text);
    assert.equal(unexpected.body, payload.body);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.PUBLISHER_TOKEN;
    else process.env.PUBLISHER_TOKEN = originalToken;
  }
});
