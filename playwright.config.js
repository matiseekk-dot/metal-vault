// ── Playwright E2E config ─────────────────────────────────────
//
// Two-tier suite:
//   • smoke.spec.js — anonymous public surface (manifest, SW,
//     /api/version, /api/fx, etc). Always runs.
//   • authenticated.spec.js — auth-protected flows (Vault → Stats,
//     When's On → Live, alerts CRUD, /api/* 5xx detection).
//     Runs only when test user creds are wired up via env vars.
//
// Why two tiers: the audit-wave regressions (persona.genre column,
// price_alerts.direction column, EventCard locale-undefined,
// VaultTab tree-shake collision) all lived behind auth. Public smoke
// caught zero of them. The authenticated tier exists specifically to
// gate against that class of bug going forward.
//
// Run modes:
//   npm run test:e2e         — chromium against local dev server
//   npm run test:e2e:ci      — headless, junit reporter, single browser
//   PWPLAYWRIGHT_BASE_URL=https://… npm run test:e2e   — against deploy
//
// To enable the authenticated tier, set all three:
//   TEST_AUTH_SECRET   — same value as the Vercel env var
//   MV_TEST_EMAIL      — Supabase test user email (manually created)
//   MV_TEST_PASSWORD   — that user's password
// See tests/e2e/README.md for end-to-end setup.
//
// Setup once (NOT in package.json devDependencies on purpose — Next
// 15.5.15 has a peerOptional on @playwright/test ^1.51.1 and pinning
// it in deps blocks `npm install` on Vercel. Install locally only):
//
//   npm i -D @playwright/test@latest
//   npx playwright install chromium

import { defineConfig, devices } from '@playwright/test';

const BASE = process.env.PWPLAYWRIGHT_BASE_URL || 'http://localhost:3000';
const AUTH_ENABLED = !!(process.env.TEST_AUTH_SECRET && process.env.MV_TEST_EMAIL && process.env.MV_TEST_PASSWORD);

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
    // Smoke (anonymous) — always on.
    {
      name: 'chromium-mobile',
      testIgnore: [/auth\.setup\.js/, /authenticated\.spec\.js/],
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'chromium-desktop',
      testIgnore: [/auth\.setup\.js/, /authenticated\.spec\.js/],
      use: { ...devices['Desktop Chrome'] },
    },

    // Authenticated tier — opt-in via env vars (see header). The
    // setup project signs the test user in once and persists
    // cookies+localStorage so the spec project starts already
    // authenticated for every test (skips a per-test login round-trip).
    ...(AUTH_ENABLED ? [
      {
        name: 'auth-setup',
        testMatch: /auth\.setup\.js/,
        use: { ...devices['Desktop Chrome'] },
      },
      {
        name: 'chromium-auth',
        testMatch: /authenticated\.spec\.js/,
        dependencies: ['auth-setup'],
        use: { ...devices['Desktop Chrome'] },
      },
    ] : []),
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
