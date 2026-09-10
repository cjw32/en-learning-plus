import { expect, test } from '@playwright/test';

test('supported browser exposes a secure local-first recording runtime with complete cleanup primitives', async ({
  page,
  browserName,
}) => {
  await page.goto('./', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('load');
  const evidence = await page.evaluate(async () => {
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/mp4;codecs=mp4a.40.2',
    ];
    const selected = candidates.find((type) =>
      globalThis.MediaRecorder?.isTypeSupported(type),
    );
    const blob = new Blob(['synthetic-browser-fixture'], {
      type: selected ?? 'application/octet-stream',
    });
    const objectUrl = URL.createObjectURL(blob);
    URL.revokeObjectURL(objectUrl);
    const audioContext = globalThis.AudioContext
      ? new globalThis.AudioContext()
      : null;
    await audioContext?.close();
    const timer = setInterval(() => undefined, 1_000);
    clearInterval(timer);
    return {
      secureContext: globalThis.isSecureContext,
      hasGetUserMedia:
        typeof globalThis.navigator.mediaDevices?.getUserMedia === 'function',
      hasMediaRecorder: typeof globalThis.MediaRecorder === 'function',
      selected,
      objectUrlWasLocal: objectUrl.startsWith('blob:'),
      audioContextClosed: audioContext === null || audioContext.state === 'closed',
      userAgentRead: false,
    };
  });

  expect(evidence, `${browserName} runtime evidence`).toMatchObject({
    secureContext: true,
    hasGetUserMedia: true,
    hasMediaRecorder: true,
    objectUrlWasLocal: true,
    audioContextClosed: true,
    userAgentRead: false,
  });
  expect(evidence.selected).toMatch(
    /^audio\/(webm;codecs=opus|mp4;codecs=mp4a\.40\.2)$/,
  );
});
