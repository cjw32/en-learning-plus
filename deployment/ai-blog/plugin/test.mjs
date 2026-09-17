import assert from 'node:assert/strict';
import test from 'node:test';
import register from './index.mjs';
const tools = {};
register({registerTool(tool) {tools[tool.name] = tool;}});

test('publishing uses the fixed private service and keeps credentials out of content', async () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.PUBLISHER_TOKEN;
  process.env.PUBLISHER_TOKEN = 'test-token-12345678901234567890123456';
  let observed;
  globalThis.fetch = async (url, options) => {
    observed = {url, options};
    return {ok: true, json: async () => ({state: 'submitted', id: 'ai-' + 'a'.repeat(24)})};
  };
  try {
    const result = await tools.cjw_blog_publish.execute('test', {message_id: 'om_test', title: 'Example'});
    assert.equal(observed.url, 'http://publisher:8080/publish');
    assert.equal(observed.options.headers.Authorization, 'Bearer ' + process.env.PUBLISHER_TOKEN);
    assert.ok(!JSON.stringify(result).includes(process.env.PUBLISHER_TOKEN));
    assert.ok(!observed.options.body.includes(process.env.PUBLISHER_TOKEN));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.PUBLISHER_TOKEN;
    else process.env.PUBLISHER_TOKEN = originalToken;
  }
});

test('status rejects path injection before making a request', async () => {
  await assert.rejects(tools.cjw_blog_status.execute('test', {id: '../../secrets'}), /Invalid article ID/);
});

test('OCR refuses files outside received attachments', async () => {
  await assert.rejects(tools.cjw_blog_ocr.execute('test', {path: new URL('./package.json', import.meta.url).pathname}), /received message attachment/);
});

test('delete tools preserve user confirmation and encode search input', async () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.PUBLISHER_TOKEN;
  process.env.PUBLISHER_TOKEN = 'test-token-12345678901234567890123456';
  const observed = [];
  globalThis.fetch = async (url, options) => {
    observed.push({url, options});
    return {ok: true, json: async () => ({state: url.includes('/status/') ? 'removed' : 'submitted'})};
  };
  try {
    await tools.cjw_blog_list.execute('test', {query: '标题&query=other'});
    assert.equal(observed[0].url, 'http://publisher:8080/articles?query=' + encodeURIComponent('标题&query=other'));
    const preview = {article_id: '2026010101', message_id: 'om_delete'};
    await tools.cjw_blog_delete_preview.execute('test', preview);
    assert.equal(observed[1].url, 'http://publisher:8080/delete/prepare');
    assert.deepEqual(JSON.parse(observed[1].options.body), preview);
    const confirmation = {request_id: 'del-' + 'a'.repeat(24), confirmation_message_id: 'om_confirm', confirmation_text: '确认删除 ABCD1234'};
    const result = await tools.cjw_blog_delete_confirm.execute('test', confirmation);
    assert.equal(observed[2].url, 'http://publisher:8080/delete/confirm');
    assert.deepEqual(JSON.parse(observed[2].options.body), confirmation);
    assert.ok(!JSON.stringify(result).includes(process.env.PUBLISHER_TOKEN));
    const status = await tools.cjw_blog_status.execute('test', {id: confirmation.request_id, wait_seconds: 45});
    assert.equal(JSON.parse(status.content[0].text).state, 'removed');
    assert.equal(observed.length, 4);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.PUBLISHER_TOKEN;
    else process.env.PUBLISHER_TOKEN = originalToken;
  }
});

test('manifest declares every runtime tool and template permits them', async () => {
  const fs = await import('node:fs/promises');
  const manifest = JSON.parse(await fs.readFile(new URL('./openclaw.plugin.json', import.meta.url), 'utf8'));
  const config = JSON.parse(await fs.readFile(new URL('../openclaw.template.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.contracts.tools.toSorted(), Object.keys(tools).toSorted());
  for (const name of Object.keys(tools)) assert.ok(config.tools.allow.includes(name));
});

test('read and edit tools stage full content, then confirm only the saved draft', async () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.PUBLISHER_TOKEN;
  process.env.PUBLISHER_TOKEN = 'test-token-12345678901234567890123456';
  const observed = [];
  globalThis.fetch = async (url, options) => {
    observed.push({url, options});
    return {ok: true, json: async () => ({state: url.includes('/status/') ? 'live' : 'awaiting_confirmation'})};
  };
  try {
    await assert.rejects(tools.cjw_blog_read.execute('test', {article_id: '../secrets'}), /Invalid article ID/);
    await tools.cjw_blog_read.execute('test', {article_id: '2026010101'});
    assert.equal(observed[0].url, 'http://publisher:8080/articles/2026010101');
    const preview = {article_id: '2026010101', expected_sha256: 'a'.repeat(64), message_id: 'om_edit', title: '完整标题', summary: '摘要', category: '技术文章', index: 5, tags: ['astro', '前端'], body: '# 第一节\n原内容\n# 第二节\n修改内容'};
    await tools.cjw_blog_edit_preview.execute('test', preview);
    assert.deepEqual(JSON.parse(observed[1].options.body), preview);
    assert.equal(observed[1].url, 'http://publisher:8080/edit/preview');
    for (const key of ['category', 'tags', 'index']) {
      assert.ok(tools.cjw_blog_edit_preview.parameters.required.includes(key));
      assert.ok(!Object.hasOwn(tools.cjw_blog_edit_confirm.parameters.properties, key));
    }
    const confirmation = {draft_id: 'edt-' + 'a'.repeat(24), confirmation_message_id: 'om_upload', confirmation_text: '可以了，上传'};
    await tools.cjw_blog_edit_confirm.execute('test', confirmation);
    assert.deepEqual(JSON.parse(observed[2].options.body), confirmation);
    assert.equal(observed[2].url, 'http://publisher:8080/edit/confirm');
    assert.ok(!Object.hasOwn(tools.cjw_blog_edit_confirm.parameters.properties, 'body'));
    const result = await tools.cjw_blog_status.execute('test', {id: confirmation.draft_id, wait_seconds: 45});
    assert.equal(JSON.parse(result.content[0].text).state, 'live');
    assert.equal(observed.length, 4);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.PUBLISHER_TOKEN;
    else process.env.PUBLISHER_TOKEN = originalToken;
  }
});
