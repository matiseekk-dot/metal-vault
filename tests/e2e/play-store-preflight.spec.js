// ── Play Store / TWA submission pre-flight ────────────────────
//
// Runs as part of the smoke tier. Asserts every requirement that
// would block (or visually break) a Play Console submission, so any
// future regression (icon rename, manifest field drop, assetlinks
// fingerprint typo) gets caught at PR time instead of when the
// reviewer rejects the upload.
//
// Each test is small + standalone so the failure annotation tells
// you exactly what's wrong.

import { test, expect } from '@playwright/test';

test.describe('Play Store pre-flight', () => {
  test('manifest.json has all Play-required fields', async ({ request }) => {
    const r = await request.get('/manifest.json');
    expect(r.ok()).toBeTruthy();
    const m = await r.json();

    // Identity — Play Console pulls these into the listing.
    expect(m.name,            'name').toBeTruthy();
    expect(m.short_name,      'short_name').toBeTruthy();
    expect(m.description,     'description').toBeTruthy();
    expect(m.start_url,       'start_url').toBe('/');
    expect(m.scope,           'scope').toBe('/');
    expect(m.display,         'display').toBe('standalone');
    expect(m.theme_color,     'theme_color').toMatch(/^#[0-9a-f]{6}$/i);
    expect(m.background_color,'background_color').toMatch(/^#[0-9a-f]{6}$/i);
    expect(m.lang,            'lang').toBeTruthy();

    // Icons — needs both sizes AND maskable purpose for adaptive
    // launcher support.
    const haveSize = (size, purpose) => m.icons.some(i =>
      i.sizes === size + 'x' + size && (i.purpose || 'any').includes(purpose)
    );
    expect(haveSize(192, 'any'),       'icon 192 any').toBeTruthy();
    expect(haveSize(512, 'any'),       'icon 512 any').toBeTruthy();
    expect(haveSize(192, 'maskable'),  'icon 192 maskable').toBeTruthy();
    expect(haveSize(512, 'maskable'),  'icon 512 maskable').toBeTruthy();

    // Screenshots — at least 1 narrow form_factor for phone listings.
    expect(Array.isArray(m.screenshots), 'screenshots array').toBeTruthy();
    const narrow = (m.screenshots || []).filter(s => s.form_factor === 'narrow');
    expect(narrow.length, 'narrow screenshots').toBeGreaterThanOrEqual(1);
  });

  test('every icon + screenshot URL referenced in manifest returns 200', async ({ request }) => {
    const m = await (await request.get('/manifest.json')).json();
    const failures = [];
    for (const icon of m.icons || []) {
      const r = await request.get(icon.src);
      if (r.status() !== 200) failures.push(icon.src + ' → ' + r.status());
    }
    for (const shot of m.screenshots || []) {
      const r = await request.get(shot.src);
      if (r.status() !== 200) failures.push(shot.src + ' → ' + r.status());
    }
    expect(failures, 'broken asset URLs').toEqual([]);
  });

  test('/.well-known/assetlinks.json published + valid TWA shape', async ({ request }) => {
    // Without a working assetlinks.json the TWA shows a URL bar and
    // looks like a glorified browser tab — sometimes Google rejects
    // listings outright.
    const r = await request.get('/.well-known/assetlinks.json');
    expect(r.status(), '/.well-known/assetlinks.json must serve 200').toBe(200);
    const al = await r.json();
    expect(Array.isArray(al), 'assetlinks must be a JSON array').toBeTruthy();
    expect(al.length, 'at least one statement').toBeGreaterThanOrEqual(1);

    const stmt = al[0];
    expect(stmt.relation, 'relation').toContain('delegate_permission/common.handle_all_urls');
    expect(stmt.target?.namespace, 'target.namespace').toBe('android_app');
    expect(stmt.target?.package_name, 'target.package_name').toBeTruthy();
    expect(Array.isArray(stmt.target?.sha256_cert_fingerprints), 'fingerprints array').toBeTruthy();

    // Soft signal — log placeholders so we know to update them, but
    // don't fail the test (deploys can ship before signing is set up).
    const placeholders = stmt.target.sha256_cert_fingerprints.filter(f => /REPLACE/i.test(f));
    if (placeholders.length) {
      // eslint-disable-next-line no-console
      console.warn('[preflight] assetlinks.json still has ' + placeholders.length +
        ' placeholder fingerprint(s). TWA URL bar will show until replaced.');
    }
  });

  test('privacy policy reachable + non-empty', async ({ request }) => {
    // Play Console rejects listings without a privacy URL. This must
    // be the URL we're going to paste into the form.
    const r = await request.get('/legal/privacy.html');
    expect(r.status()).toBe(200);
    const html = await r.text();
    // Sanity-check it's an actual policy, not a 200-empty placeholder.
    expect(html.length).toBeGreaterThan(2000);
    expect(html.toLowerCase()).toMatch(/privacy|polityka prywatno/);
  });

  test('Play-relevant API endpoints respond', async ({ request }) => {
    // /api/version drives both /api/version display + Sentry release
    // tag wiring; /api/fx fuels currency display in the listing
    // screenshots; /manifest.json is the TWA entry point.
    for (const url of ['/api/version', '/api/fx', '/manifest.json']) {
      const r = await request.get(url);
      expect(r.status(), url + ' status').toBe(200);
    }
  });

  test('start_url renders without console errors', async ({ page }) => {
    // Same idea as the smoke "main app shell loads" test, but
    // explicitly tied to the manifest's start_url so a future
    // start_url change can't drift undetected.
    const m = await (await page.request.get('/manifest.json')).json();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console',  e => { if (e.type() === 'error') errors.push(e.text()); });
    await page.goto(m.start_url);
    await expect(page.locator('nav, [role="navigation"], button').first()).toBeVisible();
    const real = errors.filter(e =>
      !/Sentry|ServiceWorker|VAPID|Discogs not configured|Loading chunk|vercel\.live|Content Security Policy/i.test(e)
    );
    expect(real, 'unexpected runtime errors:\n' + real.join('\n')).toEqual([]);
  });
});
