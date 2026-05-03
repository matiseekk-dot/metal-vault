# Tech debt — Metal Vault

Tracked for after the first Play Console release. Nothing here blocks
submission; each item has a reason for being deferred.

## Major dependency bumps

| Package | Current | Status |
|---------|---------|--------|
| `next` | **15.5.15** | ✅ Bumped from 14.2.35. Clears critical+postcss CVEs. App-router/middleware/instrumentation behaviour verified by build. |
| `@sentry/nextjs` | **10.51.0** | ✅ Bumped from 8.55.2. Migrated to `instrumentation.js` + `instrumentation-client.js` (SDK v10 layout). Slim init (BrowserTracing/Replay/Profiling integrations dropped, lazy-imported via dynamic `import()`) keeps `/` First Load JS at **269 kB**. |
| `@supabase/supabase-js` | **2.105.1** | ✅ Bumped from 2.45.4. |
| `@supabase/ssr` | **0.5.2** | ✅ Bumped from 0.5.1. |
| `jspdf` | 3.0.4 | ⚠️ Pinned. The remaining critical advisory (`GHSA-...`) targets `jsPDF.html()` HTML rendering, which we don't call (insurance-report.js uses only `text()`, `setFontSize()`, `addImage()`, `autoTable()`). Surface area not reached. Bump to 4.x deferred until insurance-report.js is verified pixel-identical. |

## UX polish — completed

- ✅ All `alert()` / `window.confirm()` calls in `app/page.js`, `app/collection/CollectionTab.js`, `app/concerts/ConcertsTab.js`, `app/profile/ProfileTab.js`, `app/artists/BandsTab.js`, `app/components/PhotoUploader.js`, and `lib/hooks/useCollection.js` replaced with `<Toast>` / `<Confirm>`.
- ✅ `next/font` migration done — `app/layout.js` loads `Bebas_Neue` and `Space_Mono` via `next/font/google`, exposes them as CSS variables (`--font-bebas-neue`, `--font-space-mono`); all inline `fontFamily: "'Space Mono'..."` references updated to `var(...)` form.
- ✅ Removed external `<link>` to `fonts.googleapis.com` from `app/layout.js`, `app/landing/page.js`, `app/p/[username]/page.js`, `app/share/[token]/page.js`.
- ✅ `@next/next/no-page-custom-font` lint rule re-enabled.

## Architecture — partial

- **Files >500 LoC** — partial:
  - ✅ `ManualAddForm` extracted to `app/collection/ManualAddForm.js`
  - ✅ `PriceModal` extracted to `app/collection/PriceModal.js`
  - ⚠️ Still over budget: `CollectionTab.js` (1182), `StatsTab.js` (877), `ProfileTab.js` (761), `page.js` (678), `ConcertsTab.js` (646), `BandsTab.js` (605). Splitting `WatchlistTab` and `VaultScore` out of CollectionTab.js is the next obvious move; deferred to keep this PR scoped.

- **`@zxing/browser` (0.1.5)** — unmaintained. Works but at risk of
  Chromium API changes silently breaking the barcode scanner. Evaluate
  `@undecaf/zbar-wasm` or the native `BarcodeDetector` API as
  successors.

- **Sentry instrumentation for silent `try/catch{}`** — the worst
  offenders (`/api/sync` username persist, portfolio_snapshots upsert,
  CollectionTab alert-creation) currently swallow errors silently.
  Wrap them with `Sentry.captureException(e)` so we see them in
  production telemetry. (Toasts already surface user-visible failures
  via `lib/log.js` in client paths.)

## Maskable icons

`public/icons/icon-{192,512}-maskable.png` are placeholder copies of the
regular icons. Generate proper versions with ~10% safe-zone padding via
[maskable.app](https://maskable.app/editor) — see `public/icons/README.md`.

## Screenshots

`public/screenshots/` is empty. Capture 6 PNGs at 1080×1920 — the
manifest already references the canonical filenames. See
`public/screenshots/README.md`.

## Feature graphic

Play Console wants a 1024×500 PNG. Not produced yet; design brief in
`launch-marketing/04-play-store-listing.md`.
