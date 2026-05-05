// ── Playwright auth setup ─────────────────────────────────────
//
// Runs once before the authenticated specs. Hits the gated
// /api/test-auth/login endpoint which signs the test user in and
// writes Supabase session cookies on the response. We then dump the
// browser context's storage state to a JSON file; the actual specs
// load that state via test.use({ storageState }) and start already
// signed in — no per-test login round-trip.
//
// Required env vars (all three must be set or the project is skipped
// at the playwright.config.js level):
//   TEST_AUTH_SECRET — must match the production deploy's value
//   MV_TEST_EMAIL    — test user's email (Supabase auth.users row)
//   MV_TEST_PASSWORD — test user's password
//
// Setting up the test user (one-time, ~5 min):
//   1. Supabase dashboard → Authentication → Users → Add user.
//      Tick "Auto Confirm User" + set a password directly.
//   2. Optional: seed a few collection rows for that user so the
//      Stats / Persona panels render real data instead of empty
//      states.
//   3. Add the three env vars above to Vercel project (Preview
//      environment is enough — production never gets them).

import { test as setup, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = path.join(__dirname, '../../playwright/.auth/user.json');

setup('authenticate test user', async ({ page, baseURL }) => {
  const secret   = process.env.TEST_AUTH_SECRET;
  const email    = process.env.MV_TEST_EMAIL;
  const password = process.env.MV_TEST_PASSWORD;

  // The project-level `grep` filter in playwright.config.js skips this
  // setup when env is missing, but defend in depth in case someone
  // runs the setup file directly.
  if (!secret || !email || !password) {
    throw new Error(
      'Auth setup needs TEST_AUTH_SECRET + MV_TEST_EMAIL + MV_TEST_PASSWORD. ' +
      'See tests/e2e/auth.setup.js for setup instructions.'
    );
  }

  // page.request shares the page's cookie context, so the cookies
  // written by the response stick to that page's session.
  const res = await page.request.post(baseURL + '/api/test-auth/login', {
    headers: {
      'x-test-auth':  secret,
      'Content-Type': 'application/json',
    },
    data: { email, password },
  });

  expect(res.status(), 'test-auth login should succeed').toBe(200);
  const body = await res.json();
  expect(body.ok).toBe(true);
  expect(body.user?.email).toBe(email);

  // Sanity-check: now hit a protected endpoint to confirm the
  // session cookie actually authenticates us before we save state.
  const me = await page.request.get(baseURL + '/api/profile');
  expect(me.status(), '/api/profile should accept the session').toBe(200);

  // Persist cookies + localStorage so the actual specs start logged in.
  await page.context().storageState({ path: AUTH_FILE });
});
