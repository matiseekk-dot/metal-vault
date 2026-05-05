# Metal Vault — E2E test suite

Two tiers, both Playwright + Chromium:

| Tier | File | Auth | What it catches |
| --- | --- | --- | --- |
| Smoke | `smoke.spec.js` | anonymous | Manifest 404s, SW registration, public `/api/*` shape, console errors on landing |
| Auth | `authenticated.spec.js` | logged-in test user | ErrorBoundary fallbacks across all tabs, `/api/*` 5xx regressions, alerts CRUD |

The auth tier exists specifically because the audit-wave regressions
(persona.genre column, price_alerts.direction column, EventCard locale,
VaultTab tree-shake collision) all lived behind auth. Public smoke caught
zero of them. Anything that 500s a route or crashes a tab for a logged-in
user belongs in `authenticated.spec.js`.

## Running

```bash
# Anonymous smoke only — works out of the box
npm run test:e2e

# Full suite including auth — requires the env vars below
TEST_AUTH_SECRET=… MV_TEST_EMAIL=… MV_TEST_PASSWORD=… npm run test:e2e

# Against a deployed URL instead of localhost
PWPLAYWRIGHT_BASE_URL=https://metal-vault-six.vercel.app npm run test:e2e
```

When the three env vars are missing, the auth projects are excluded
from the run entirely (see `playwright.config.js`). No skipped-test
noise, no false confidence.

## One-time setup for the auth tier

### 1. Create a test user in Supabase

Dashboard → Authentication → Users → "Add user".

- Email: anything you'll remember (e.g. `e2e@metal-vault.test`)
- Password: any 12+ chars
- Tick **Auto Confirm User** so we don't need a real inbox

(Optional) Seed a few `collection` rows for that user via the SQL
editor or the app itself. Without seeded data the Stats sub-tab
shows the empty-vault state instead of Persona — tests still pass
(they assert "doesn't crash", not "renders Persona") but the auth
tier is more meaningful with at least 5–10 records.

### 2. Generate `TEST_AUTH_SECRET`

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. Add Vercel env vars

Project → Settings → Environment Variables → add to **Preview** only
(production must never have these set; the test-auth route returns 404
when the secret is missing):

| Name | Value | Environment |
| --- | --- | --- |
| `TEST_AUTH_SECRET` | the 64-char hex from step 2 | Preview |
| `MV_TEST_EMAIL` | test user's email | Preview |
| `MV_TEST_PASSWORD` | test user's password | Preview |

Production stays untouched. The `/api/test-auth/login` endpoint
checks `process.env.TEST_AUTH_SECRET` first; missing → 404.

### 4. Use the same values locally

Either via shell:

```bash
export TEST_AUTH_SECRET=…
export MV_TEST_EMAIL=…
export MV_TEST_PASSWORD=…
```

Or drop them in `.env.local` (already gitignored). Don't commit them.

### 5. Disable Vercel Authentication for Preview deployments

Vercel projects ship with **Deployment Protection → Vercel
Authentication** set to "All Deployments" by default — every
deployment URL returns a 401 SSO redirect to anonymous traffic.
Production alias (`metal-vault-six.vercel.app`) is exempt because
it's the team's public domain, but per-deployment URLs aren't.

CI on push-to-main uses the production alias automatically. CI on
PRs needs Preview URLs to be reachable, so:

**Option A — disable protection for Preview (simpler):**
Project → Settings → Deployment Protection → Vercel Authentication →
toggle to **"Only Production Deployments"** (Preview becomes public).
Acceptable while the project is unreleased; revisit before public PRs
land.

**Option B — bypass token (keeps protection on):**
Project → Settings → Deployment Protection → Protection Bypass for
Automation → Generate token. Add it as `VERCEL_AUTOMATION_BYPASS_TOKEN`
to GitHub repo secrets. The workflow can then send
`x-vercel-protection-bypass: <token>` header (TODO: not wired up yet —
add when needed).

### 6. Mirror the same secrets to GitHub Actions

GitHub repo → Settings → Secrets and variables → Actions →
"New repository secret". Add the same three names + values you put
in Vercel:

- `TEST_AUTH_SECRET`
- `MV_TEST_EMAIL`
- `MV_TEST_PASSWORD`

The `.github/workflows/e2e.yml` workflow runs on every PR and every
push to main:

1. Waits for Vercel to finish deploying the preview (or production
   for main).
2. Runs Playwright against that deployment URL.
3. Pulls the three secrets above into the runner so the auth tier
   actually executes.

Without these GitHub secrets the workflow still runs the smoke tier
but silently skips the auth tier — fine for forks/contributors
without credentials.

## How the auth flow works

1. `auth.setup.js` runs first (Playwright project dependency).
2. It POSTs to `/api/test-auth/login` with the secret in
   `x-test-auth` header. Route uses `signInWithPassword` and writes
   the SSR session cookies on the response.
3. Setup dumps `page.context().storageState()` to
   `playwright/.auth/user.json` (gitignored).
4. `authenticated.spec.js` declares
   `test.use({ storageState: 'playwright/.auth/user.json' })` and
   every test starts already logged in. No per-test login.

## Adding new auth tests

Follow the existing patterns in `authenticated.spec.js`:

- Use the `BOUNDARY_STRINGS` regex set + `expectNoErrorBoundary(page)`
  to assert no ErrorBoundary fallback rendered. Substring match in
  three locales — works regardless of the test user's stored locale.
- Use `trackApiFailures(page)` at the start of any flow-level test
  to catch new `/api/*` 5xx regressions automatically. The catch-all
  walkthrough test will then cover whatever new endpoint you added.
- For deterministic tab navigation, set the `mv_last_tab` and
  sub-tab localStorage keys via `page.evaluate(...)` then reload —
  much more stable than clicking through the bottom nav (which
  shifts when the layout changes).

## Files

```
tests/e2e/
├── README.md                  ← you are here
├── smoke.spec.js              ← anonymous public surface
├── auth.setup.js              ← Playwright project; runs once before auth tier
└── authenticated.spec.js      ← auth-protected regression suite
playwright.config.js           ← project wiring + AUTH_ENABLED gate
playwright/.auth/user.json     ← generated, gitignored
app/api/test-auth/login/       ← env-gated test-only login endpoint
```
