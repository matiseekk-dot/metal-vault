// ── gen-maskable-icons.mjs ────────────────────────────────────────
// Generates icon-{192,512}-maskable.png by compositing the existing
// `any`-purpose icon onto a brand-color background with a safe-zone
// padding. Android launchers crop maskable icons with circle / squircle
// / rounded-square masks depending on the device — the visible mark
// must sit inside the inner ~80% of the canvas.
//
// Run once after updating the source icons:
//   node scripts/gen-maskable-icons.mjs
//
// Idempotent — overwrites the output files each run.
import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ICONS_DIR = join(__dirname, '..', 'public', 'icons');

const BRAND_BG = { r: 10, g: 10, b: 10, alpha: 1 }; // #0a0a0a, matches manifest

const SAFE_ZONE_RATIO = 0.80; // mark scaled to 80% of canvas, so 10% pad each side

async function makeMaskable(srcName, outName, size) {
  const srcPath = join(ICONS_DIR, srcName);
  const outPath = join(ICONS_DIR, outName);

  const inner = Math.round(size * SAFE_ZONE_RATIO);

  // Resize the source icon to fit the inner safe zone, preserving aspect.
  // PNGs in this project are square already so `fit:'contain'` is a no-op
  // for shape but ensures correct sampling.
  const innerBuffer = await sharp(srcPath)
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  // Composite onto solid brand background, centered.
  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: BRAND_BG,
    },
  })
    .composite([
      {
        input: innerBuffer,
        top: Math.round((size - inner) / 2),
        left: Math.round((size - inner) / 2),
      },
    ])
    .png({ compressionLevel: 9 })
    .toFile(outPath);

  const stats = await sharp(outPath).metadata();
  console.log(
    '[gen-maskable] wrote ' + outName +
    ' (' + stats.width + 'x' + stats.height +
    ', inner ' + inner + 'px, padding ' + Math.round((size - inner) / 2) + 'px)'
  );
}

(async () => {
  await makeMaskable('icon-512.png', 'icon-512-maskable.png', 512);
  await makeMaskable('icon-192.png', 'icon-192-maskable.png', 192);
  console.log('[gen-maskable] done');
})().catch(err => {
  console.error('[gen-maskable] failed:', err.message);
  process.exit(1);
});
