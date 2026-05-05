// ── Playwright E2E config ─────────────────────────────────────
//
// Smoke-test scope: anything-but-zero. Goal is to catch the next
// "manifest 404 / scanner crash / login redirect loop" before it
// reaches production. NOT a full coverage suite — those need real
// Supabase test data which is a separate project.
//
// Run modes:
//   npm run test:e2e         — chromium against local dev server
//   npm run test:e2e:ci      — headless, junit reporter, single browser
//   PWPLAYWRIGHT_BASE_URL=https://… npm run test:e2e   — against deploy
//
// Setup once (NOT in package.json devDependencies on purpose — Next
// 15.5.15 has a peerOptional on @playwright/test ^1.51.1 and pinning
// it in deps blocks `npm install` on Vercel. Install locally only):
//
//   npm i -D @playwright/test@latest
//   npx playwright install chromium

import { defineConfig, devices } from '@playwright/test';

const BASE = process.env.PWPLAYWRIGHT_BASE_URL || 'http://localhost:3000';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,

  // Reporter: JUnit on CI for readable failure logs, list locally.
  reporter: process.env.CI
    ? [['junit', { outputFile: 'test-results/junit.xml' }], ['list']]
    : 'list',

  use: {
    baseURL: BASE,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // Match the touch-friendly viewport the app is designed for.
    viewport: { width: 414, height: 896 },
    locale: 'en-US',
  },

  projects: [
    { name: 'chromium-mobile', use: { ...devices['Pixel 7'] } },
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } },
  ],

  // When running against localhost, boot the dev server. Skip when
  // PWPLAYWRIGHT_BASE_URL is set (we're testing a deployed instance).
  webServer: process.env.PWPLAYWRIGHT_BASE_URL ? undefined : {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
