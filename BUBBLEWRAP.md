# Bubblewrap — Android TWA build instructions

This is the recipe for turning the deployed PWA into an `.aab` (Android App
Bundle) ready to upload to Google Play Console.

## Prerequisites (one-time)

```bash
npm install -g @bubblewrap/cli
```

You'll also need:
- **JDK 17** (Bubblewrap will offer to download Android SDK + JDK automatically)
- **A Java keystore** that you control — Bubblewrap creates one on first run

## First build

```bash
# From the metal-vault repo root, in a separate folder so AAB artifacts
# don't pollute the web project:
mkdir ../metal-vault-android
cd    ../metal-vault-android

# Pulls manifest.json from the live PWA and prefills twa-manifest.json
bubblewrap init --manifest=https://metal-vault-six.vercel.app/manifest.json
```

When prompted:
- **Application ID**: `pl.skudev.metalvault` (matches lib/payments.js)
- **Use existing key**? No (first time) — let Bubblewrap create
  `android.keystore` for you. Use a strong password and **back this file
  up immediately**. Losing it means losing the ability to update the app.

If you already have the template `twa-manifest.json` from this repo, copy
it into the android folder before `bubblewrap update` to inherit the
playBilling / location settings.

## Build the AAB

```bash
bubblewrap build
```

Outputs:
- `app-release-bundle.aab` — upload this to Play Console
- `app-release-signed.apk` — for sideload testing on a device

## Get fingerprints for assetlinks.json

There's a helper script that pulls the SHA-256 out of the keystore
and writes it into `public/.well-known/assetlinks.json` directly,
preserving the existing structure and de-duping:

```bash
# After bubblewrap build, pointing at the keystore Bubblewrap created:
KEYSTORE_PASS='your-keystore-password' \
  node scripts/update-assetlinks.mjs --keystore ../metal-vault-android/android.keystore

# After first Play Console upload (Setup → App integrity), add the
# two extra fingerprints in one go. Copy them as raw colon-hex from
# Play Console:
KEYSTORE_PASS='your-keystore-password' \
  node scripts/update-assetlinks.mjs \
    --keystore ../metal-vault-android/android.keystore \
    --play-app-signing AB:CD:...64-byte-hex... \
    --play-upload-key  12:34:...64-byte-hex...
```

The script accepts either colon-separated or contiguous hex and
normalises both. Existing real fingerprints are kept; only the
`REPLACE_ME_*` placeholders get displaced.

If you'd rather do it by hand:

```bash
keytool -list -v -keystore android.keystore -alias android
```

Look for `SHA256:` and copy the colon-separated hex into
`public/.well-known/assetlinks.json`, replacing `REPLACE_ME_LOCAL_KEYSTORE_SHA256`.
After your first Play Console upload, also grab the **Play App Signing**
SHA-256 from Play Console → Setup → App integrity, and add it as a
second entry in the `sha256_cert_fingerprints` array. The Upload Key
fingerprint goes there as a third entry.

Either way, deploy the updated `assetlinks.json` to production — without
all relevant fingerprints, Chrome will show the URL bar inside the TWA.

The `tests/e2e/play-store-preflight.spec.js` test logs a warning to CI
output whenever placeholder fingerprints are still present; the
pre-launch checklist isn't done until that warning's gone.

## Local sideload test

```bash
adb install app-release-signed.apk
```

Then on the device:
1. Launch the app
2. If you see a URL bar at the top → assetlinks.json or fingerprint is wrong
3. If the app loads cleanly with status-bar tinted #0a0a0a → success

## In-app billing test

After uploading to a Play Console **internal test track** with the app
linked to RevenueCat:
1. Add yourself as a license tester in Play Console → Setup → License testing
2. Open the app → tap "Upgrade to Pro"
3. PaymentRequest should open Play Billing's native sheet with mv_pro_monthly
4. Use a "test card, always approves" payment method
5. Confirm: profile flips to active, RC dashboard shows the test purchase,
   `/api/revenuecat/webhook` shows INITIAL_PURCHASE in Vercel logs

## Updating

After the first build, every subsequent web change just needs:

```bash
# Bump version
bubblewrap update            # syncs twa-manifest from web manifest if changed
bubblewrap build             # builds new AAB with incremented appVersion
```

Then upload the new AAB to Play Console.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| URL bar visible in TWA | assetlinks.json missing or wrong fingerprint | See "Get fingerprints" above; clear Chrome data on device after fixing |
| Play Billing sheet doesn't appear | `playBilling.enabled` false in twa-manifest | Set true, rebuild AAB |
| "Install blocked" on sideload | APK signed with debug key but device only allows Play install | Use Play Console internal test track |
| Subscription doesn't persist after restart | RC webhook not firing | Check Vercel logs for /api/revenuecat/webhook 401s — usually `REVENUECAT_WEBHOOK_SECRET` mismatch between Vercel env and RC dashboard |
