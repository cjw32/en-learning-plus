import { expect, test } from '@playwright/test';

const now = new Date().toISOString();
const draft = { assessmentId: 'browser-assessment-1', status: 'CREATED', exerciseType: 'WORD', locale: 'en-US', referenceText: 'hello', retryOfAssessmentId: null, result: null, diagnostic: null, learningWriteStatus: 'NOT_ELIGIBLE', audio: { status: 'MISSING', available: false, expiresAt: null }, createdAt: now, updatedAt: now, traceId: 'browser-assessment-1' };
const result = { schemaVersion: 'pronunciation-result.v1', assessmentId: draft.assessmentId, referenceText: 'hello', recognizedText: 'hello', scores: { overall: 90, accuracy: 90, completeness: 100, fluency: 90, prosody: null }, confidence: .95, confidenceTier: 'RELIABLE', words: [{ sequence: 0, targetPosition: 0, word: 'hello', normalizedWord: 'hello', startMs: 0, endMs: 500, score: 90, status: 'correct', feedback: null }], summary: '发音清晰。', suggestions: ['继续保持。'], nextAction: 'continue', provider: 'fake', modelVersion: 'local-fixture', learningUpdate: { status: 'NOT_ELIGIBLE', changedItems: [] }, audio: { available: false, expiresAt: null }, versions: { providerAdapter: 'v1', providerApi: 'v1', normalization: 'v1', alignment: 'v1', assessmentRule: 'v1', confidencePolicy: 'v1', learningMapping: 'v1', scheduler: 'v1', budget: 'v1', price: 'v1' }, traceId: draft.assessmentId };

test.beforeEach(async ({ page }) => {
  await page.addInitScript(now => {
    localStorage.setItem('user', JSON.stringify({ user: { id: 'pron-browser-owner', name: 'Learner', email: 'learner@example.test', createdAt: now, updatedAt: now, token: { accessToken: 'local-browser-test', refreshToken: 'local-refresh-test' } } }));
    // Chromium's network inspector omits multipart file bytes. Observe the
    // actual FormData supplied to XHR without replacing its transport.
    const send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function(body) {
      const audio = body instanceof FormData ? body.get('audio') : null;
      if (audio instanceof Blob) (window as any).__uploadedAudioBytes = audio.size;
      return send.call(this, body);
    };
    // Synthetic oscillator goes through the real browser MediaRecorder; no microphone audio leaves the browser.
    navigator.mediaDevices.getUserMedia = async () => {
      const context = new AudioContext();
      const oscillator = context.createOscillator();
      const destination = context.createMediaStreamDestination();
      oscillator.connect(destination); oscillator.start(); await context.resume();
      for (const track of destination.stream.getTracks()) {
        const stop = track.stop.bind(track);
        track.stop = () => { stop(); oscillator.stop(); void context.close(); };
      }
      return destination.stream;
    };
  }, now);
  await page.route('**/socket.io/**', route => route.abort());
  await page.route('**/api/v1/**', route => route.fulfill({ json: { code: 200, data: {} } }));
});

test('manual target, real browser recording, upload, polling, result and history expansion', async ({ page }) => {
  let submitted = false;
  let uploaded = false;
  let created = 0;
  await page.route('**/ai/v1/pronunciation/**', async route => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    let data: unknown;
    if (path.endsWith('/capabilities')) data = { available: true, reason: null, locales: ['en-US', 'en-GB'], sources: ['MANUAL', 'WORD_BOOK', 'COACH_EXERCISE'], learningWrite: false, coachSummary: false, maxDurationMs: 30000, maxBytes: 8388608, maxWords: 30, maxCharacters: 200 };
    else if (path.endsWith('/assessments') && request.method() === 'POST') { expect(request.postDataJSON()).toEqual({ locale: 'en-US', target: { sourceType: 'MANUAL', text: 'hello' } }); created++; data = draft; }
    else if (path.endsWith('/assessments')) data = { items: submitted ? [{ ...draft, status: 'COMPLETED', result }] : [], nextCursor: null };
    else if (path.endsWith('/audio')) { uploaded = true; expect(request.headers()['content-type']).toContain('multipart/form-data'); expect(request.headers()['idempotency-key']).toBeTruthy(); data = { ...draft, status: 'AUDIO_READY', audio: { ...draft.audio, status: 'READY' } }; }
    else if (path.endsWith('/submit')) { submitted = true; data = { ...draft, status: 'QUEUED' }; }
    else data = { ...draft, status: 'COMPLETED', result };
    await route.fulfill({ json: { code: 200, data } });
  });
  await page.goto('pronunciation');
  await page.getByLabel('要练习的英文').fill('hello');
  await page.getByRole('button', { name: '准备练习', exact: true }).click();
  await page.getByRole('button', { name: '练习发音', exact: true }).click();
  await expect(page.getByText('提交后，录音将发送至 Azure Speech')).toBeVisible();
  await page.getByRole('button', { name: '开始录音', exact: true }).click();
  await expect(page.getByRole('button', { name: '完成录音', exact: true })).toBeVisible();
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: '完成录音', exact: true }).click();
  await page.getByRole('button', { name: '使用这段录音', exact: true }).click();
  await expect(page.getByRole('heading', { name: '90 分', exact: true })).toBeVisible();
  expect(uploaded).toBe(true);
  expect(await page.evaluate(() => (window as any).__uploadedAudioBytes)).toBeGreaterThan(1000); expect(created).toBe(1);
  await page.getByRole('button', { name: '查看结果', exact: true }).click();
  await expect(page.getByRole('heading', { name: '90 分', exact: true })).toHaveCount(2);
});

test('missing service configuration leaves history usable without offering recording', async ({ page }) => {
  await page.route('**/ai/v1/pronunciation/**', route => route.fulfill({ json: { code: 200, data: route.request().url().endsWith('/capabilities') ? { available: false, reason: 'FEATURE_DISABLED', locales: ['en-US', 'en-GB'], sources: ['MANUAL'], learningWrite: false, coachSummary: false, maxDurationMs: 30000, maxBytes: 8388608, maxWords: 30, maxCharacters: 200 } : { items: [], nextCursor: null } } }));
  await page.goto('pronunciation');
  await expect(page.getByText('发音评测暂未开放', { exact: false })).toBeVisible();
  await expect(page.getByRole('heading', { name: '发音评测历史' })).toBeVisible();
  await expect(page.getByRole('button', { name: '开始录音' })).toHaveCount(0);
});
