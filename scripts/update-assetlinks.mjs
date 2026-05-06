// ── update-assetlinks.mjs ─────────────────────────────────────
// Reads SHA-256 fingerprints from a Java keystore (and optionally
// from Play Console exports) and writes them into
// public/.well-known/assetlinks.json. Replaces the REPLACE_ME_*
// placeholders that ship in the file by default.
//
// Without correct fingerprints the TWA shows a URL bar at the top
// (looks like a glorified browser tab) — Chrome refuses to verify
// the digital asset link otherwise.
//
// Usage:
//   # Just the local keystore (first build, before Play Console):
//   node scripts/update-assetlinks.mjs --keystore ../metal-vault-android/android.keystore
//
//   # All three fingerprints (after first Play Console upload):
//   node scripts/update-assetlinks.mjs \
//     --keystore ../metal-vault-android/android.keystore \
//     --play-app-signing AB:CD:EF:... \
//     --play-upload-key  12:34:56:...
//
// The Play Console fingerprints come from:
//   Play Console → Setup → App integrity →
//     "App signing key certificate" → SHA-256 (Play App Signing)
//     "Upload key certificate"      → SHA-256 (Upload Key)
//
// Idempotent — re-running with the same inputs produces the same
// output. Already-correct fingerprints stay put; only placeholders
// or stale values get replaced.

import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname    = dirname(fileURLToPath(import.meta.url));
const ASSETLINKS   = join(__dirname, '..', 'public', '.well-known', 'assetlinks.json');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i === -1) return fallback;
  return process.argv[i + 1];
}

function normaliseFingerprint(raw) {
  if (!raw) return null;
  // Strip whitespace + optional "SHA256: " prefix; force uppercase
  // hex with colon separators every 2 chars to match Google's spec.
  const hex = raw.replace(/SHA-?256:?/i, '').replace(/[^0-9a-f]/gi, '').toUpperCase();
  if (hex.length !== 64) {
    throw new Error('Expected 64 hex chars (32 bytes), got ' + hex.length + ' from "' + raw + '"');
  }
  return hex.match(/.{2}/g).join(':');
}

function readKeystoreSHA(keystorePath, alias = 'android', storepass = process.env.KEYSTORE_PASS) {
  // keytool requires interactive password unless -storepass is passed.
  // We pull from KEYSTORE_PASS env to keep the password out of shell
  // history. Fail loudly if neither path exists.
  const args = [
    '-list', '-v',
    '-keystore', resolve(keystorePath),
    '-alias',    alias,
  ];
  if (storepass) args.push('-storepass', storepass);

  let out;
  try {
    out = execFileSync('keytool', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) {
    throw new Error(
      'keytool failed for ' + keystorePath + '. Make sure JDK is installed, the alias ' +
      'is correct (default: android), and KEYSTORE_PASS env is set if the keystore ' +
      'is password-protected. Underlying error: ' + e.message
    );
  }

  // Look for the SHA-256 line in the cert fingerprints block.
  const m = out.match(/SHA-?256:\s*([0-9A-F:]{95})/i);
  if (!m) {
    throw new Error('Could not find SHA-256 fingerprint in keytool output. ' +
      'Make sure the alias exists. Output:\n' + out.slice(0, 500));
  }
  return normaliseFingerprint(m[1]);
}

(async () => {
  const keystore     = arg('--keystore');
  const alias        = arg('--alias', 'android');
  const playAppSign  = arg('--play-app-signing');
  const playUpload   = arg('--play-upload-key');

  if (!keystore && !playAppSign && !playUpload) {
    console.error('Usage: node scripts/update-assetlinks.mjs ' +
      '--keystore <path> [--alias <name>] [--play-app-signing <SHA256>] [--play-upload-key <SHA256>]');
    process.exit(1);
  }

  const fingerprints = [];
  if (keystore) {
    const fp = readKeystoreSHA(keystore, alias);
    fingerprints.push(fp);
    console.log('[assetlinks] local keystore SHA256: ' + fp);
  }
  if (playAppSign) {
    const fp = normaliseFingerprint(playAppSign);
    fingerprints.push(fp);
    console.log('[assetlinks] Play App Signing SHA256: ' + fp);
  }
  if (playUpload) {
    const fp = normaliseFingerprint(playUpload);
    fingerprints.push(fp);
    console.log('[assetlinks] Play Upload Key SHA256: ' + fp);
  }

  // Read current assetlinks.json, patch fingerprints in-place. Keep
  // the existing structure (relation, namespace, package_name) so we
  // don't overwrite operator edits.
  const current = JSON.parse(await readFile(ASSETLINKS, 'utf8'));
  if (!Array.isArray(current) || !current[0]?.target) {
    throw new Error('assetlinks.json has unexpected shape — refusing to overwrite. ' +
      'Path: ' + ASSETLINKS);
  }

  // Merge: keep any existing real fingerprints, drop placeholders,
  // append the ones we computed. Dedupe.
  const existing = (current[0].target.sha256_cert_fingerprints || [])
    .filter(fp => fp && !/REPLACE/i.test(fp));
  const merged = [...new Set([...existing, ...fingerprints])];

  current[0].target.sha256_cert_fingerprints = merged;
  await writeFile(ASSETLINKS, JSON.stringify(current, null, 2) + '\n');
  console.log('[assetlinks] wrote ' + merged.length + ' fingerprint(s) to ' + ASSETLINKS);
  console.log('[assetlinks] commit + deploy → TWA URL bar should disappear after Chrome refreshes.');
})().catch(e => {
  console.error('[assetlinks] failed:', e.message);
  process.exit(1);
});
