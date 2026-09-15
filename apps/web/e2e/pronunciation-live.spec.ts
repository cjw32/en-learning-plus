import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
test.use({ trace: 'off' }); // Authentication tokens must not enter trace archives.

// Explicit opt-in: real local backend + Azure F0, using synthetic speech only.
test.describe('live pronunciation journey', () => {
  test.skip(process.env.PRONUNCIATION_LIVE_BROWSER !== 'true', 'Requires prepared local services and synthetic audio');
  test('records synthetic speech, displays real scores, plays history and deletes it', async ({ page, request }) => {
    test.setTimeout(90000);
    const session = JSON.parse(readFileSync('/tmp/en-pron-live-session.json', 'utf8'));
    const refreshed = await request.post('http://127.0.0.1:3000/api/v1/user/refresh-token', {data:{refreshToken:session.user.token.refreshToken}}).then(r=>r.json());
    if (refreshed.data?.accessToken) session.user.token = refreshed.data;
    const speech = readFileSync('/tmp/en-pron-live-speech.webm').toString('base64');
    await page.addInitScript(({ user, speech }) => {
      localStorage.setItem('user', JSON.stringify({ user }));
      navigator.mediaDevices.getUserMedia = async () => {
        const context = new AudioContext();
        const source = context.createBufferSource();
        source.buffer = await context.decodeAudioData(Uint8Array.from(atob(speech), char => char.charCodeAt(0)).buffer);
        const destination = context.createMediaStreamDestination();
        source.connect(destination); await context.resume(); source.start();
        for (const track of destination.stream.getTracks()) {
          const stop = track.stop.bind(track);
          track.stop = () => { stop(); source.stop(); void context.close(); };
        }
        return destination.stream;
      };
    }, { user: session.user, speech });
    await page.goto('pronunciation');
    await expect(page.getByText('发音评测暂未开放', {exact:false})).toHaveCount(0);
    await page.getByLabel('要练习的英文').fill('Good morning. I would like a cup of coffee.');
    await page.getByRole('button', {name:'准备练习',exact:true}).click();
    await page.getByRole('button', {name:'练习发音',exact:true}).click();
    await page.getByRole('button', {name:'开始录音',exact:true}).click();
    await page.waitForTimeout(3200);
    await page.getByRole('button', {name:'完成录音',exact:true}).click();
    await page.getByRole('button', {name:'使用这段录音',exact:true}).click();
    await expect(page.getByRole('heading', {name:/^\d+ 分$/}).first()).toBeVisible({timeout:65000});
    const row = page.locator('.pronunciation-history li').first();
    await row.getByRole('button', {name:'查看结果',exact:true}).click();
    await expect(row.getByRole('heading', {name:'逐词反馈'})).toBeVisible();
    await row.getByRole('button', {name:'播放录音',exact:true}).click();
    const audio = row.locator('audio');
    await expect(audio).toBeVisible();
    await expect.poll(() => audio.evaluate((el: HTMLAudioElement) => el.readyState)).toBeGreaterThanOrEqual(1);
    await page.screenshot({path:'/tmp/en-pronunciation-live.png',fullPage:true});
    page.on('dialog', dialog => dialog.accept());
    await row.getByRole('button', {name:'仅删除录音',exact:true}).click();
    await expect(page.getByText('录音已撤销；评测结果仍保留。')).toBeVisible();
    await expect(row.getByRole('button', {name:'播放录音',exact:true})).toHaveCount(0);
    await row.getByRole('button', {name:'删除完整评测',exact:true}).click();
    await expect(page.getByText('评测已隐藏，学习影响正在安全重算。')).toBeVisible();
  });
});
