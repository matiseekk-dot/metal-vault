// ── gen-screenshots.mjs ───────────────────────────────────────────
// Captures Play Store-shaped screenshots (1080×1920) of the live
// Metal Vault deployment, with demo mode pre-seeded so populated
// states render (collection has 8 records, watchlist has 2,
// followed-artists has 3 — see lib/demo-data.js). Loops over
// English / Polish / German so the Play Store listing can show
// localized screenshots per locale.
//
// Run:
//   node scripts/gen-screenshots.mjs
//
// Env knobs:
//   BASE_URL     production target (default https://metal-vault-six.vercel.app)
//   CHROME_PATH  path to system Chrome (Windows-default below)
//   LOCALES      comma-separated subset, e.g. "en,pl"
//
// Output:
//   public/screenshots/{en|pl|de}/0X-name.png
//   public/screenshots/0X-name.png            (mirrors EN — manifest defaults)
//
// Each shot navigates with localStorage already containing:
//   mv_demo_active=1, mv_locale=<locale>, mv_last_tab=<tab>,
//   mv_vault_subtab / mv_whenson_subtab as needed, plus the
//   demo-collection / watchlist / followed / concerts / seeded
//   blobs from lib/demo-data.js — so the app boots straight into
//   the populated screen with no async seed delay.

import { chromium } from 'playwright-core';
import sharp from 'sharp';
import { mkdirSync, writeFileSync, unlinkSync, existsSync, copyFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import https from 'node:https';

import {
  DEMO_COLLECTION,
  DEMO_WATCHLIST,
  DEMO_FOLLOWED_ARTISTS,
  DEMO_CONCERTS,
  DEMO_KEYS,
} from '../lib/demo-data.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_ROOT  = join(__dirname, '..', 'public', 'screenshots');
mkdirSync(OUT_ROOT, { recursive: true });

const BASE_URL = (process.env.BASE_URL || 'https://metal-vault-six.vercel.app').replace(/\/$/, '');
const CHROME = process.env.CHROME_PATH ||
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';

const LOCALES = (process.env.LOCALES || 'en,pl,de')
  .split(',').map(s => s.trim()).filter(Boolean);

// Final dimensions — Play Console + manifest screenshots (16:9 portrait).
const TARGET_W = 1080;
const TARGET_H = 1920;

// CSS viewport — Pixel 5-ish.
const CSS_W = 412;
const CSS_H = 915;
const DPR   = TARGET_W / CSS_W;       // 1080 / 412 ≈ 2.62

// Each shot defines:
//   name        output filename
//   tab         value for mv_last_tab
//   vaultSub    value for mv_vault_subtab (only when tab='vault')
//   whensSub    value for mv_whenson_subtab (only when tab='calendar')
//   openScanner if true, dispatch mv:open-scanner after load
//   wait        extra ms after load for the screen to settle
//   afterLoad   optional async hook running on the page
//
// All shots load the SAME URL ("/") — the LS-seeded tab handles
// the routing. This is faster (one route, one bundle) and avoids
// the empty-state flash you'd get from ?tab=foo when the page
// reads LS afterward.
const SHOTS = [
  {
    name: '01-feed.png',
    tab:  'feed',
    wait: 9000,
    waitForFeed: true,
  },
  {
    name: '02-vault.png',
    tab:  'vault',
    vaultSub: 'collection',
    wait: 2500,
  },
  {
    name: '03-scan.png',
    tab:  'feed',
    openScanner: true,
    wait: 3000,
  },
  {
    name: '04-when-live.png',
    tab:  'calendar',
    whensSub: 'calendar',
    wait: 4000,
  },
  {
    name: '05-bands.png',
    tab:  'vault',
    vaultSub: 'bands',
    wait: 2500,
  },
  {
    name: '06-stats-persona.png',
    tab:  'vault',
    vaultSub: 'stats',
    wait: 2500,
  },
];

// Build the localStorage payload that's injected into every page
// before any app script runs. addInitScript runs in every page on
// every navigation, so this seeds at the right moment regardless
// of how the SPA boots.
function buildSeed(locale, shot) {
  return {
    locale,
    last_tab:        shot.tab,
    vault_subtab:    shot.vaultSub || null,
    whenson_subtab:  shot.whensSub || null,
    keys: {
      collection:      DEMO_KEYS.collection,
      watchlist:       DEMO_KEYS.watchlist,
      followedArtists: DEMO_KEYS.followedArtists,
      concerts:        DEMO_KEYS.concerts,
      seeded:          DEMO_KEYS.seeded,
      active:          DEMO_KEYS.active,
    },
    payload: {
      collection:      DEMO_COLLECTION,
      watchlist:       DEMO_WATCHLIST,
      followedArtists: DEMO_FOLLOWED_ARTISTS,
      concerts:        DEMO_CONCERTS,
    },
  };
}

// Cache the slow /api/releases response on first hit so subsequent
// shots (across locales) reuse it instead of re-paying the 30 s
// Discogs roundtrip every time. Without this, generating 18 shots
// takes well over 10 minutes.
let RELEASES_JSON = null;
let MA_JSON = null;

async function fetchJSON(url, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
        try { resolve(body); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
  });
}

async function prewarmApis() {
  console.log('[gen-screenshots] pre-warming /api/releases (this can take ~30s on cold cache)…');
  const t0 = Date.now();
  try {
    [RELEASES_JSON, MA_JSON] = await Promise.all([
      fetchJSON(BASE_URL + '/api/releases', 60_000).catch(() => null),
      fetchJSON(BASE_URL + '/api/releases/metal-archives', 30_000).catch(() => null),
    ]);
    console.log('[gen-screenshots] pre-warm done in', Date.now() - t0, 'ms (releases:',
      RELEASES_JSON ? RELEASES_JSON.length : 'null', 'bytes, ma:',
      MA_JSON ? MA_JSON.length : 'null', 'bytes)');
  } catch (e) {
    console.warn('[gen-screenshots] pre-warm failed:', e.message);
  }
}

async function captureOne(browser, locale, shot) {
  const ctx = await browser.newContext({
    viewport:           { width: CSS_W, height: CSS_H },
    deviceScaleFactor:  DPR,
    isMobile:           true,
    hasTouch:           true,
    userAgent:          'Mozilla/5.0 (Linux; Android 13; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36',
    colorScheme:        'dark',
    locale:             locale === 'pl' ? 'pl-PL' : locale === 'de' ? 'de-DE' : 'en-US',
    // Block the service worker — without this, sw.js intercepts
    // /api/releases with a cache-first strategy and our page.route
    // stub never sees the request, leaving the feed stuck on
    // "Loading…" until the real upstream finishes (~30s).
    serviceWorkers: 'block',
  });

  const seed = buildSeed(locale, shot);

  // Inject ONCE before any page script runs. Demo seed + locale +
  // tab/sub-tab persistence + suppressed onboarding/whats-new modals.
  await ctx.addInitScript((s) => {
    try {
      // Bypass onboarding + what's-new + streak / pending-sync chrome.
      localStorage.setItem('mv_onboarding_done', '1');
      localStorage.setItem('mv_whatsnew_seen', '999');
      localStorage.setItem('mv_streak_pinged', new Date().toISOString().slice(0, 10));

      // Locale.
      localStorage.setItem('mv_locale', s.locale);

      // Tab + sub-tab (so app boots straight into the right screen).
      localStorage.setItem('mv_last_tab', s.last_tab);
      if (s.vault_subtab)   localStorage.setItem('mv_vault_subtab',   s.vault_subtab);
      if (s.whenson_subtab) localStorage.setItem('mv_whenson_subtab', s.whenson_subtab);

      // Demo-mode flag + seeded payloads (so populated states render
      // immediately — useCollection picks them up synchronously when
      // mv_demo_active === '1').
      localStorage.setItem(s.keys.active,   '1');
      localStorage.setItem(s.keys.seeded,   '1');
      localStorage.setItem(s.keys.collection,      JSON.stringify(s.payload.collection));
      localStorage.setItem(s.keys.watchlist,       JSON.stringify(s.payload.watchlist));
      localStorage.setItem(s.keys.followedArtists, JSON.stringify(s.payload.followedArtists));
      localStorage.setItem(s.keys.concerts,        JSON.stringify(s.payload.concerts));
    } catch (e) {
      // ignored — addInitScript runs in browser sandbox
    }
  }, seed);

  const page = await ctx.newPage();

  // Stub the slow feed APIs with the body we pre-warmed. Saves
  // ~30 s per locale × per feed shot. Other API calls fall through
  // to the live deployment unchanged.
  if (RELEASES_JSON) {
    await page.route('**/api/releases**', (route) => {
      // Don't stub /api/releases/metal-archives — it has its own handler.
      const u = route.request().url();
      if (u.includes('/metal-archives')) return route.continue();
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: RELEASES_JSON,
      });
    });
  }
  if (MA_JSON) {
    await page.route('**/api/releases/metal-archives**', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: MA_JSON,
      });
    });
  }

  page.on('console', m => {
    if (m.type() === 'error' && !String(m.text()).includes('Failed to fetch')) {
      console.log('   [console.error]', m.text().slice(0, 160));
    }
  });

  try {
    await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    // Don't wait for full networkidle — feed APIs poll forever.
    // domcontentloaded + manual settle ms is enough for the SPA
    // to hydrate, read LS, and render the seeded state.
    await page.waitForTimeout(800);

    if (shot.openScanner) {
      // Scanner modal opens via global event listener in app/page.js
      // (mv:open-scanner). The listener attaches in a useEffect, so
      // we wait for hydration to finish, then fire — and retry once
      // 1.5 s later in case the first dispatch lost the race.
      await page.waitForTimeout(1500);
      await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent('mv:open-scanner'));
      });
      await page.waitForTimeout(800);
      // Re-fire if no scanner-modal element is in the DOM yet.
      const opened = await page.evaluate(() => {
        return !!document.querySelector('[data-scanner-modal], video, [aria-label*="canner" i], [aria-label*="kaner" i]')
          || /scanner|kaner|kanuj|scan/i.test(document.body.innerText);
      });
      if (!opened) {
        await page.evaluate(() => {
          window.dispatchEvent(new CustomEvent('mv:open-scanner'));
        });
        await page.waitForTimeout(1000);
      }
    }

    if (shot.waitForFeed) {
      // Feed populates from /api/releases — wait for at least one
      // album card to render OR for the "Loading..." copy to vanish.
      await page.waitForFunction(() => {
        const t = document.body.innerText;
        if (/Loading|Ładowanie|Lädt/i.test(t)) return false;
        // Either real release cards rendered, or an offline notice.
        return /releases|premier|ver(ö|oe)ffentlich|Wszystkie|All Metal|Cały metal/i.test(t)
          && document.querySelectorAll('img').length >= 4;
      }, null, { timeout: 12000 }).catch(() => {});
    }

    if (shot.wait) await page.waitForTimeout(shot.wait);

    // Hide the bottom nav for shots that should show as much
    // content as possible — actually KEEP it: bottom nav with the
    // active tab highlighted is part of the value proposition.
    // (No-op intentionally.)

    const localeDir = join(OUT_ROOT, locale);
    mkdirSync(localeDir, { recursive: true });

    const tmp = join(localeDir, '_tmp_' + shot.name);
    await page.screenshot({
      path: tmp,
      type: 'png',
      clip: { x: 0, y: 0, width: CSS_W, height: CSS_H },
    });

    const out = join(localeDir, shot.name);
    await sharp(tmp)
      .resize(TARGET_W, TARGET_H, {
        fit: 'cover',
        position: 'top',
        background: { r: 10, g: 10, b: 10, alpha: 1 },
      })
      .png({ compressionLevel: 9 })
      .toFile(out);
    unlinkSync(tmp);

    // Mirror EN to top-level public/screenshots/ — those paths are
    // what manifest.json + Play Store default-locale references.
    if (locale === 'en') {
      copyFileSync(out, join(OUT_ROOT, shot.name));
    }

    const meta = await sharp(out).metadata();
    console.log('  ✓', locale, shot.name, '(' + meta.width + 'x' + meta.height + ')');
  } finally {
    await ctx.close();
  }
}

(async () => {
  console.log('[gen-screenshots] base URL:', BASE_URL);
  console.log('[gen-screenshots] locales: ', LOCALES.join(', '));
  console.log('[gen-screenshots] launching Chrome at:', CHROME);

  if (!existsSync(CHROME)) {
    console.error('[gen-screenshots] Chrome not found. Set CHROME_PATH env or install Chrome.');
    process.exit(1);
  }
  await prewarmApis();

  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROME,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    for (const locale of LOCALES) {
      console.log('\n[gen-screenshots] === locale:', locale, '===');
      for (const shot of SHOTS) {
        try {
          await captureOne(browser, locale, shot);
        } catch (err) {
          console.error('  ✗', locale, shot.name, '—', err.message);
        }
      }
    }
    console.log('\n[gen-screenshots] done — output:', OUT_ROOT);
  } finally {
    await browser.close();
  }
})().catch(err => {
  console.error('[gen-screenshots] failed:', err.message, err.stack);
  process.exit(1);
});
