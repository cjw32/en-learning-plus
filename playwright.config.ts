import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:8080/en/';
const host = new URL(baseURL).hostname;
const pronunciationCoreJourney = process.argv.some((argument) =>
  argument.includes('pronunciation-assessment.spec.ts'),
);
const pronunciationRecorderJourney = process.argv.some((argument) =>
  argument.includes('pronunciation-recorder.spec.ts'),
);

if (!['127.0.0.1', 'localhost'].includes(host) && !host.endsWith('.test')) {
  throw new Error('Coach E2E tests require a localhost or .test base URL');
}

export default defineConfig({
  testDir: '.',
  testMatch: pronunciationCoreJourney
    ? ['tests/pronunciation-assessment.spec.ts']
    : pronunciationRecorderJourney
      ? ['tests/pronunciation-recorder.spec.ts']
      : ['apps/web/e2e/**/*.spec.ts', 'tests/**/*.spec.ts'],
  tsconfig: './server/tsconfig.json',
  outputDir: './test-results/playwright',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [['list']],
  webServer: pronunciationCoreJourney
    ? undefined
    : {
        command: 'pnpm --filter @en/web dev --host 127.0.0.1',
        url: 'http://127.0.0.1:8080/en/',
        reuseExistingServer: true,
        timeout: 120_000,
      },
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: pronunciationRecorderJourney
        ? { ...devices['Desktop Chrome'] }
        : { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
    {
      name: 'firefox',
      testMatch: ['tests/pronunciation-recorder.spec.ts'],
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      testMatch: ['tests/pronunciation-recorder.spec.ts'],
      use: { ...devices['Desktop Safari'] },
    },
  ],
});
