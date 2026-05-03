// ── stamp-sw.mjs ───────────────────────────────────────────────────
// Replace the hardcoded VERSION constant in public/sw.js with a unique
// per-build identifier so cached service-worker artifacts get invalidated
// on every deploy. Runs as a `prebuild` step (see package.json scripts).
//
// Strategy: prefer Vercel's commit SHA (always set in Vercel CI), fall
// back to a timestamp for local builds. We update the source file in place
// — public/sw.js stays human-editable; the postbuild git diff just shows
// the version line bumped.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const swPath = join(__dirname, '..', 'public', 'sw.js');

const sha   = process.env.VERCEL_GIT_COMMIT_SHA || '';
const stamp = sha ? sha.slice(0, 8) : 'local-' + Date.now().toString(36);
const versionId = 'mv-' + stamp;

const src = readFileSync(swPath, 'utf8');
const next = src.replace(
  /^const VERSION\s*=\s*['"][^'"]+['"];?/m,
  `const VERSION    = '${versionId}';`,
);

if (next === src) {
  console.warn('[stamp-sw] VERSION line not found in public/sw.js; skipping');
} else {
  writeFileSync(swPath, next);
  console.log('[stamp-sw] sw.js VERSION = ' + versionId);
}
