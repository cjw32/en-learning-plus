import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:8080/en/'
const host = new URL(baseURL).hostname

if (!['127.0.0.1', 'localhost'].includes(host) && !host.endsWith('.test')) {
  throw new Error('Coach E2E tests require a localhost or .test base URL')
}

export default defineConfig({
  testDir: './apps/web/e2e',
  outputDir: './test-results/playwright',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [['list']],
  webServer: {
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
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
  ],
})
