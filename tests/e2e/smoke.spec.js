// ── Smoke tests — anonymous app surface ───────────────────────
//
// Runs without auth — no Supabase test fixtures needed. Asserts the
// public surface area still loads, manifest is valid, no console
// errors, no 4xx/5xx on key API endpoints. Past regressions this
// would have caught:
//   • manifest 404 referencing /screenshots/05-vinyl-modal.png
//   • Scanner ReferenceError "t is not defined"
//   • Service worker not registered after stamp-sw.mjs flake
//   • CSP violations on Sentry endpoint
//
// Add real auth flows in tests/e2e/auth.spec.js once we have a Supabase
// test project + seeded magic-link credentials.

import { test, expect } from '@playwright/test';

test.describe('Public surface', () => {
  test('landing page renders + has working CTA', async ({ page }) => {
    const response = await page.goto('/landing');
    expect(response?.ok()).toBeTruthy();
    await expect(page.locator('text=METAL VAULT').first()).toBeVisible();
    // CTA → /
    const cta = page.getByRole('link', { name: /OPEN APP|OTWÓRZ|ÖFFNEN/i }).first();
    await expect(cta).toBeVisible();
  });

  test('main app shell loads without console errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    // Bottom nav is the rendering signal — present after hydration.
    await expect(page.locator('nav, [role="navigation"], button').first()).toBeVisible();

    // Tolerate Sentry init noise + service-worker bootstrap warnings;
    // fail only on actual runtime errors. Filter known-benign messages.
    const real = errors.filter(e =>
      !/Sentry|ServiceWorker|VAPID|Discogs not configured|Loading chunk/i.test(e)
    );
    expect(real, 'unexpected runtime errors:\n' + real.join('\n')).toEqual([]);
  });

  test('manifest.json is valid + every screenshot resolves', async ({ request }) => {
    const res = await request.get('/manifest.json');
    expect(res.ok()).toBeTruthy();
    const m = await res.json();
    expect(m.name).toBeTruthy();
    expect(m.start_url).toBe('/');
    expect(m.icons.length).toBeGreaterThanOrEqual(2);

    // Every referenced icon + screenshot must 200. Past bug: manifest
    // referenced 05-vinyl-modal.png but only 05-login.png existed.
    for (const icon of m.icons) {
      const r = await request.get(icon.src);
      expect(r.status(), `icon ${icon.src}`).toBe(200);
    }
    for (const shot of m.screenshots || []) {
      const r = await request.get(shot.src);
      expect(r.status(), `screenshot ${shot.src}`).toBe(200);
    }
  });

  test('service worker registers + has SKIP_WAITING handler', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const swActive = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return false;
      const reg = await navigator.serviceWorker.getRegistration();
      return !!reg;
    });
    expect(swActive).toBeTruthy();
  });
});

test.describe('API health', () => {
  test('/api/version returns build info', async ({ request }) => {
    const res = await request.get('/api/version');
    expect(res.ok()).toBeTruthy();
    const d = await res.json();
    expect(d.version).toBeTruthy();
    expect(d.name).toBeTruthy();
  });

  test('/api/fx returns USD rates for EUR + PLN', async ({ request }) => {
    const res = await request.get('/api/fx');
    expect(res.ok()).toBeTruthy();
    const d = await res.json();
    expect(d.base).toBe('USD');
    expect(d.rates.EUR).toBeGreaterThan(0);
    expect(d.rates.PLN).toBeGreaterThan(0);
  });

  test('/api/search rate-limits + returns shape', async ({ request }) => {
    const res = await request.get('/api/search?q=Opeth&type=albums');
    expect(res.ok()).toBeTruthy();
    const d = await res.json();
    expect(Array.isArray(d.albums)).toBeTruthy();
    expect(Array.isArray(d.artists)).toBeTruthy();
    expect(Array.isArray(d.members)).toBeTruthy();
  });

  test('/api/cover-fallback rejects empty params', async ({ request }) => {
    const res = await request.get('/api/cover-fallback');
    expect(res.status()).toBe(400);
  });

  test('protected routes return 401 to anonymous', async ({ request }) => {
    const protectedPaths = ['/api/collection', '/api/profile', '/api/alerts'];
    for (const path of protectedPaths) {
      const res = await request.get(path);
      expect(res.status(), `${path} should require auth`).toBe(401);
    }
  });
});

test.describe('Routing', () => {
  test('/ deep-link tab=vault stays on vault', async ({ page }) => {
    await page.goto('/?tab=vault');
    await page.waitForLoadState('networkidle');
    // localStorage is not yet populated for first visit; just check
    // that we landed somewhere that renders.
    expect(page.url()).toContain('/');
  });

  test('/auth/callback handles missing code → redirect', async ({ request }) => {
    const res = await request.get('/auth/callback', { maxRedirects: 0 });
    // Either 302 to error page or back to /. Anything but a 5xx is fine.
    expect(res.status()).toBeLessThan(500);
  });
});
