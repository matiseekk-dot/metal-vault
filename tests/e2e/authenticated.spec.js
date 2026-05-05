// ── Auth-aware regression suite ───────────────────────────────
//
// Every test in this file would have caught one of the bugs the user
// hit during the audit-wave hot-fix marathon (see commits 94bf3d3 →
// 50dcb45). Those bugs were:
//
//   • VaultTab tree-shake collision (Stats / Calendar / Live broken)
//   • EventCard "locale is not defined" (When's On crash)
//   • PersonaCard crashed when /api/persona returned non-OK
//   • /api/persona 500 from selecting nonexistent collection.genre
//   • /api/alerts 500 from selecting nonexistent price_alerts.direction
//   • createAlert was fire-and-forget — no UI feedback on save
//   • 8× /api/collection per session from auth-listener double-fire
//
// All landed during a "narrow select(*) for perf" refactor that was
// type-clean and lint-clean and would still ship today without these
// tests. Public-surface smoke (smoke.spec.js) hits zero of them
// because the broken endpoints all require auth.
//
// Pattern: keep each test small and assertive. Detect ErrorBoundary
// fallback by its rendered string, not by some internal class — if
// the ErrorBoundary copy ever changes the matcher needs to follow.
// Detect /api/* 500s by listening on response events at page level
// (cheaper than a per-endpoint assertion and catches new endpoints
// added after this file).

import { test, expect } from '@playwright/test';

// Path is relative to the project root — see auth.setup.js comment.
// Touching `import.meta.url` here previously broke test discovery
// entirely under the project's CommonJS-default package.json.
const AUTH_FILE = 'playwright/.auth/user.json';

test.use({ storageState: AUTH_FILE });

// Strings rendered by ErrorBoundary's fallback. Any of these visible
// = a component below threw during render = test fails. We match
// substring only since the user's locale isn't fixed.
const BOUNDARY_STRINGS = [
  /coś się sypnęło/i,           // PL
  /something broke/i,           // EN
  /etwas ist .* kaputtgegangen/i, // DE
];

async function expectNoErrorBoundary(page) {
  for (const s of BOUNDARY_STRINGS) {
    await expect(page.getByText(s).first()).toBeHidden();
  }
}

// Listen for /api/* responses with status >= 500 across the page's
// lifetime. Returns a function that asserts none happened.
function trackApiFailures(page) {
  const failures = [];
  page.on('response', r => {
    const url = r.url();
    if (!url.includes('/api/')) return;
    if (r.status() >= 500) {
      failures.push({ status: r.status(), url: url.replace(/^https?:\/\/[^/]+/, '') });
    }
  });
  return () => {
    expect(failures, '/api/* should not return 5xx — got: ' + JSON.stringify(failures, null, 2))
      .toEqual([]);
  };
}

// Seed localStorage BEFORE the page loads. Initial test pattern was
// `page.evaluate(() => localStorage.setItem(...))` then `page.goto()`,
// but evaluate runs against the current page context (about:blank
// before the first nav), so the writes never landed on the deploy's
// origin. By the time React hydrated, localStorage was empty and the
// app fell back to the default tab — making "Vault → Stats" tests
// silently navigate to "Vault → Collection" instead and time out
// waiting for a /api/persona request that was never going to fire.
//
// addInitScript registers a script that runs on EVERY future page
// load BEFORE any page script — perfect for seeding localStorage so
// React's first render sees the right values.
async function seedLocalStorage(page, entries) {
  await page.addInitScript((data) => {
    try {
      for (const [k, v] of Object.entries(data)) {
        localStorage.setItem(k, v);
      }
    } catch {}
  }, entries);
}

test.describe('Authenticated user — Vault tab', () => {
  test('vault default sub-tab renders without ErrorBoundary', async ({ page }) => {
    const assertNoFailures = trackApiFailures(page);
    await seedLocalStorage(page, { mv_last_tab: 'vault' });
    await page.goto('/');
    await expect(page.locator('nav, [role="navigation"], button').first()).toBeVisible();
    await expectNoErrorBoundary(page);
    assertNoFailures();
  });

  test('vault → stats sub-tab renders + /api/persona 200', async ({ page }) => {
    const assertNoFailures = trackApiFailures(page);
    await seedLocalStorage(page, {
      mv_last_tab:       'vault',
      mv_vault_subtab:   'stats',
    });
    // Register the response listener BEFORE navigation so we don't
    // miss /api/persona if it fires very early in StatsTab's mount.
    const personaReq = page.waitForResponse(
      r => r.url().includes('/api/persona'),
      { timeout: 20_000 },
    );
    await page.goto('/');
    const persona = await personaReq;
    expect(persona.status(), '/api/persona should not 500 anymore').toBeLessThan(500);
    await expectNoErrorBoundary(page);
    assertNoFailures();
  });
});

test.describe('Authenticated user — When\'s On tab (Calendar / Live / Dziennik)', () => {
  test('whens-on default (calendar sub-tab) renders', async ({ page }) => {
    const assertNoFailures = trackApiFailures(page);
    await seedLocalStorage(page, {
      mv_last_tab:        'calendar',
      mv_whenson_subtab:  'calendar',
    });
    await page.goto('/');
    await expect(page.locator('nav, [role="navigation"], button').first()).toBeVisible();
    await expectNoErrorBoundary(page);
    assertNoFailures();
  });

  test('whens-on → live sub-tab renders without "locale is not defined"', async ({ page }) => {
    // This is the EventCard locale-undefined regression. EventCard
    // was a nested component that didn't get the locale prop after
    // the i18n(plural+dates) refactor; rendering a single event row
    // crashed the whole tab.
    const assertNoFailures = trackApiFailures(page);
    await seedLocalStorage(page, {
      mv_last_tab:        'calendar',
      mv_whenson_subtab:  'upcoming',
    });
    await page.goto('/');
    await expect(page.locator('nav, [role="navigation"], button').first()).toBeVisible();
    await expectNoErrorBoundary(page);
    assertNoFailures();
  });

  test('whens-on → dziennik (concerts) sub-tab renders', async ({ page }) => {
    const assertNoFailures = trackApiFailures(page);
    await seedLocalStorage(page, {
      mv_last_tab:        'calendar',
      mv_whenson_subtab:  'concerts',
    });
    await page.goto('/');
    await expect(page.locator('nav, [role="navigation"], button').first()).toBeVisible();
    await expectNoErrorBoundary(page);
    assertNoFailures();
  });
});

test.describe('Authenticated user — alerts CRUD', () => {
  test('GET /api/alerts returns 200 not 500', async ({ page, request, baseURL }) => {
    // Direct API check — covers the price_alerts.direction column
    // regression that 500'd the whole alerts list.
    const res = await request.get(baseURL + '/api/alerts');
    expect(res.status()).toBe(200);
    const d = await res.json();
    expect(Array.isArray(d.alerts)).toBeTruthy();
  });

  test('POST then DELETE /api/alerts (basic round-trip)', async ({ request, baseURL }) => {
    // Use a discogs_id unlikely to collide with the test user's real
    // collection. If the test user has no records this still works
    // because the route accepts identifier-only payloads.
    const fakeDiscogsId = 999_999_999;

    const created = await request.post(baseURL + '/api/alerts', {
      data: {
        discogs_id:   fakeDiscogsId,
        artist:       'E2E Test Artist',
        album:        'E2E Test Album',
        target_price: 1.23,
        alert_type:   'PRICE_DROP',
      },
    });

    // 403 ALERT_LIMIT_REACHED is a valid outcome on free tier — the
    // test user might already have their free alert filled. Treat
    // either as "the route works"; only 5xx fails the test.
    if (created.status() === 403) {
      const body = await created.json();
      expect(body.error).toBe('ALERT_LIMIT_REACHED');
      return;
    }

    expect(created.status(), 'POST /api/alerts should succeed').toBe(200);
    const { alert } = await created.json();
    expect(alert?.id).toBeTruthy();
    expect(Number(alert.target_price)).toBeCloseTo(1.23);

    // Cleanup so reruns don't accumulate fake alerts on the test row.
    const deleted = await request.delete(baseURL + '/api/alerts?id=' + alert.id);
    expect(deleted.status()).toBe(200);
  });
});

test.describe('Authenticated user — no /api/* should ever 500', () => {
  // Catch-all: walk through the major tabs / sub-tabs and assert no
  // /api endpoint blew up along the way. This test would catch the
  // next persona.genre / price_alerts.direction-style regression on
  // ANY endpoint, not just the ones I happened to think of.
  test('cross-tab walkthrough does not trigger any 5xx', async ({ page }) => {
    const assertNoFailures = trackApiFailures(page);

    await page.goto('/');
    // Wait for hydration without relying on networkidle — SW background
    // syncs + Sentry pings keep the network non-idle indefinitely on prod.
    await expect(page.locator('nav, [role="navigation"], button').first()).toBeVisible();

    // Iterate vault sub-tabs
    for (const sub of ['collection', 'watchlist', 'bands', 'search', 'stats']) {
      await page.evaluate((s) => {
        try {
          localStorage.setItem('mv_last_tab', 'vault');
          localStorage.setItem('mv_vault_subtab', s);
        } catch {}
      }, sub);
      await page.reload();
      // Wait for hydration without relying on networkidle — SW background
    // syncs + Sentry pings keep the network non-idle indefinitely on prod.
    await expect(page.locator('nav, [role="navigation"], button').first()).toBeVisible();
    }

    // Iterate whens-on sub-tabs
    for (const sub of ['calendar', 'upcoming', 'concerts']) {
      await page.evaluate((s) => {
        try {
          localStorage.setItem('mv_last_tab', 'calendar');
          localStorage.setItem('mv_whenson_subtab', s);
        } catch {}
      }, sub);
      await page.reload();
      // Wait for hydration without relying on networkidle — SW background
    // syncs + Sentry pings keep the network non-idle indefinitely on prod.
    await expect(page.locator('nav, [role="navigation"], button').first()).toBeVisible();
    }

    // Profile + feed
    for (const tab of ['profile', 'feed']) {
      await page.evaluate((t) => {
        try { localStorage.setItem('mv_last_tab', t); } catch {}
      }, tab);
      await page.reload();
      // Wait for hydration without relying on networkidle — SW background
    // syncs + Sentry pings keep the network non-idle indefinitely on prod.
    await expect(page.locator('nav, [role="navigation"], button').first()).toBeVisible();
    }

    assertNoFailures();
  });
});
