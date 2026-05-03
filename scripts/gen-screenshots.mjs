// ── gen-screenshots.mjs ───────────────────────────────────────────
// Captures Play Store-shaped screenshots (1080×1920) of the running
// app at http://localhost:3000. Uses playwright-core driving the
// system Chrome install, so no Chromium download is needed.
//
// Each shot is rendered at the Pixel 5 CSS viewport (412×915) with
// device-pixel-ratio 2.62, which produces a 1080×~2400 native PNG.
// We then crop / pad to exactly 1080×1920 (Google's required ratio
// is 16:9 portrait at minimum 1080 wide).
//
// Run after `npm run dev` is up:
//   node scripts/gen-screenshots.mjs
//
// Outputs to public/screenshots/0X-name.png matching the names listed
// in public/manifest.json's `screenshots` array.

import { chromium } from 'playwright-core';
import sharp from 'sharp';
import { mkdirSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR   = join(__dirname, '..', 'public', 'screenshots');
mkdirSync(OUT_DIR, { recursive: true });

const CHROME = process.env.CHROME_PATH ||
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';

// Final dimensions we want on disk for Play Console + manifest screenshots.
const TARGET_W = 1080;
const TARGET_H = 1920;

// CSS viewport that the app should believe it's running on. Pixel 5-ish.
const CSS_W = 412;
const CSS_H = 915;
// 1080 / 412 ≈ 2.62, so DPR = 1080 / CSS_W gives the native pixel match.
const DPR = TARGET_W / CSS_W;

// Each step: navigate, optional setup function, save as filename.
const SHOTS = [
  {
    name: '01-feed.png',
    url:  'http://localhost:3000/',
    wait: 'networkidle',
    setup: async (page) => {
      // Let the feed populate from /api/releases (demo Discogs in dev).
      await page.waitForFunction(
        () => document.body.innerText.includes('releases') &&
              document.body.innerText.match(/[0-9]+ releases/),
        null, { timeout: 15000 }
      ).catch(() => {});
    },
    label: 'Feed (English)',
  },
  {
    name: '02-vault.png',
    url:  'http://localhost:3000/?tab=vault',
    wait: 'networkidle',
    setup: async (page) => {
      // Empty-state vault — what a brand-new signed-in user sees first.
      await page.waitForTimeout(1500);
    },
    label: 'Vault (empty-state)',
  },
  {
    name: '03-scan.png',
    url:  'http://localhost:3000/',
    wait: 'networkidle',
    setup: async (page) => {
      // Click the Scan FAB in the bottom nav (works without auth).
      await page.waitForTimeout(1200);
      await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b =>
          b.textContent.trim() === 'Scan');
        btn?.click();
      });
      await page.waitForTimeout(1500);
    },
    label: 'Barcode Scanner',
  },
  {
    name: '04-when-live.png',
    url:  'http://localhost:3000/?tab=calendar',
    wait: 'networkidle',
    setup: async (page) => {
      await page.waitForTimeout(1500);
    },
    label: "When's On",
  },
  {
    name: '05-login.png',
    url:  'http://localhost:3000/login',
    wait: 'networkidle',
    setup: async (page) => {
      await page.waitForTimeout(800);
    },
    label: 'Sign in',
  },
  {
    name: '06-stats-persona.png',
    url:  'http://localhost:3000/?tab=profile',
    wait: 'networkidle',
    setup: async (page) => {
      await page.waitForTimeout(1500);
    },
    label: 'Profile (signed-out CTA)',
  },
];

async function captureOne(browser, shot) {
  const ctx = await browser.newContext({
    viewport:           { width: CSS_W, height: CSS_H },
    deviceScaleFactor:  DPR,
    isMobile:           true,
    hasTouch:           true,
    userAgent:          'Mozilla/5.0 (Linux; Android 13; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36',
    colorScheme:        'dark',
  });
  const page = await ctx.newPage();
  page.on('console', m => {
    if (m.type() === 'error' && !String(m.text()).includes('Failed to fetch')) {
      console.log('   [console.error]', m.text().slice(0, 160));
    }
  });
  try {
    await page.goto(shot.url, { waitUntil: shot.wait || 'networkidle', timeout: 30000 });
    if (shot.setup) await shot.setup(page);

    // Capture full viewport at native resolution. The browser produces
    // a PNG at CSS_W * DPR wide ≈ TARGET_W. Then crop / pad to exact
    // 1080x1920 with sharp so Play Console / manifest accept it.
    const tmp = join(OUT_DIR, '_tmp_' + shot.name);
    await page.screenshot({
      path: tmp,
      type: 'png',
      clip: { x: 0, y: 0, width: CSS_W, height: CSS_H },
    });

    // Center-crop / extend to TARGET_W x TARGET_H (background = brand bg).
    const out = join(OUT_DIR, shot.name);
    await sharp(tmp)
      .resize(TARGET_W, TARGET_H, {
        fit: 'cover',
        position: 'top',
        background: { r: 10, g: 10, b: 10, alpha: 1 },
      })
      .png({ compressionLevel: 9 })
      .toFile(out);
    unlinkSync(tmp);

    const meta = await sharp(out).metadata();
    console.log('  ✓', shot.name, '—', shot.label, '(' + meta.width + 'x' + meta.height + ')');
  } finally {
    await ctx.close();
  }
}

(async () => {
  console.log('[gen-screenshots] launching Chrome at:', CHROME);
  if (!existsSync(CHROME)) {
    console.error('[gen-screenshots] Chrome not found. Set CHROME_PATH env or install Chrome.');
    process.exit(1);
  }
  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROME,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    for (const shot of SHOTS) {
      console.log('[gen-screenshots]', shot.name, '←', shot.url);
      await captureOne(browser, shot);
    }
    console.log('[gen-screenshots] done — output dir:', OUT_DIR);
  } finally {
    await browser.close();
  }
})().catch(err => {
  console.error('[gen-screenshots] failed:', err.message, err.stack);
  process.exit(1);
});
