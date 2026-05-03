# Digital Asset Links

`assetlinks.json` proves to Chrome that this domain owns the matching
Android app, so the TWA renders without a URL bar.

## Filling in the SHA256 fingerprints

You need three fingerprints in the array (any can be omitted if you don't
use that signing path, but Play recommends all three):

1. **Local keystore signature** (the one Bubblewrap created when you ran
   `bubblewrap init`). Print it with:
   ```
   keytool -list -v -keystore android.keystore -alias android
   ```
   Look for `SHA256:` and copy the colon-separated hex.

2. **Play App Signing** — Google re-signs your AAB after upload. Get this
   from Play Console → your app → Setup → App integrity → "App signing key
   certificate" → SHA-256 certificate fingerprint.

3. **Play Upload key** — the key Play uses to verify your uploads. Same
   page, "Upload key certificate" → SHA-256 certificate fingerprint.

## Verifying

After deploying with the real fingerprints, test with:
```
https://digitalassetlinks.googleapis.com/v1/assetlinks:check?source.web.site=https://metal-vault-six.vercel.app&relation=delegate_permission/common.handle_all_urls&target.android_app.package_name=pl.skudev.metalvault&target.android_app.certificate.sha256_fingerprint=YOUR_FINGERPRINT
```

Empty `linked` list = the verification failed; Chrome will keep showing
the URL bar in TWA.

## Caching

Chrome caches `assetlinks.json` aggressively. After updating, force a
re-fetch on a test device with:
```
adb shell pm clear com.google.android.gms
```
or by reinstalling the TWA app.
