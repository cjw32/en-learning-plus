import { config } from 'dotenv';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { strict as assert } from 'node:assert';
config({ quiet: true });

async function main() {
  assert.equal(process.env.PRONUNCIATION_RUN_LIVE_CHECK, 'true');
  assert.equal(process.env.AZURE_SPEECH_TIER, 'F0');
  const database = new URL(process.env.DATABASE_URL!);
  assert.equal(database.hostname, '127.0.0.1'); assert.equal(database.port, '15432');
  const base = 'http://127.0.0.1:3001/ai/v1/pronunciation';
  const password = createHash('md5').update(randomUUID()).digest('hex');
  const registered = await fetch('http://127.0.0.1:3000/api/v1/user/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '发音联调', phone: `199${Date.now().toString().slice(-8)}`, password }),
  }).then(r => r.json());
  assert(registered.data?.token?.accessToken, 'Local registration must succeed');
  const user = registered.data;
  const headers = { Authorization: `Bearer ${user.token.accessToken}` };
  async function api(path: string, method = 'GET', body?: unknown) {
    const r = await fetch(base + path, { method, headers: { ...headers, 'Idempotency-Key': randomUUID(),
      ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const json = await r.json();
    assert(r.ok && json.code < 400 && json.data, `API failed: ${method} ${path} (${json.code})`);
    return json.data;
  }
  assert.equal((await api('/capabilities')).available, true);
  const body = { locale: 'en-US', target: { sourceType: 'MANUAL', text: 'Good morning. I would like a cup of coffee.' } };
  const draft = await api('/assessments', 'POST', body);
  const form = new FormData();
  form.set('audio', new Blob([await readFile('/tmp/en-pron-live-speech.webm')], {type: 'audio/webm'}), 'synthetic.webm');
  const upload = await fetch(`${base}/assessments/${draft.assessmentId}/audio`, { method: 'PUT',
    headers: { ...headers, 'Idempotency-Key': randomUUID() }, body: form }).then(r => r.json());
  assert.equal(upload.data?.status, 'AUDIO_READY', `Upload failed: ${JSON.stringify(upload)}`);
  const start = Date.now();
  await api(`/assessments/${draft.assessmentId}/submit`, 'POST');
  let result;
  for (let i = 0; i < 70; i++) {
    result = await api(`/assessments/${draft.assessmentId}`);
    if (!['QUEUED', 'PROCESSING'].includes(result.status)) break;
    await new Promise(resolve => setTimeout(resolve, 750));
  }
  console.log(JSON.stringify({ assessmentId: draft.assessmentId, status: result.status,
    diagnostic: result.diagnostic, scores: result.result?.scores, provider: result.result?.provider,
    elapsedMs: Date.now() - start }, null, 2));
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.result.provider, 'azure');
  assert.equal(result.result.modelVersion, 'azure-speech-managed:unversioned');
  await writeFile('/tmp/en-pron-live-session.json', JSON.stringify({ user, assessmentId: draft.assessmentId }), {mode: 0o600});
  const history = await api('/assessments');
  assert(history.items.some((item: { assessmentId: string }) => item.assessmentId === draft.assessmentId));
  const audio = await fetch(`${base}/assessments/${draft.assessmentId}/audio`, { headers });
  assert.equal(audio.status, 200);
  assert.equal(Buffer.from(await audio.arrayBuffer()).subarray(0, 4).toString(), 'RIFF');
  const anonymous = await fetch(`${base}/assessments/${draft.assessmentId}/audio`);
  assert.equal(anonymous.status, 401);
  const cancelled = await api('/assessments', 'POST', body);
  const cancelledResult = await api(`/assessments/${cancelled.assessmentId}/cancel`, 'POST');
  assert.equal(cancelledResult.status, 'CANCELLED');
  await api(`/assessments/${cancelled.assessmentId}`, 'DELETE');
  await api(`/assessments/${draft.assessmentId}`, 'DELETE');
  // The browser check reuses only the local account; it records and deletes its own sample.
  console.log(JSON.stringify({ history: true, authenticatedPlayback: true, anonymousDenied: true, draftCancellation: true, syntheticSpeechOnly: true }));
}
main().catch(error => { console.error('Live check failed:', error instanceof assert.AssertionError ? error.message : error.name); process.exitCode = 1; });
