# Metal Vault

A vinyl-collector tool for metal heads. Track your collection, monitor
prices, follow your favorite bands' release schedules, scan barcodes at
record fairs, generate insurance-ready PDFs of your collection. Built as
a PWA, deployed to Vercel, wrapped as a Trusted Web Activity for Google
Play.

> **Live:** https://metal-vault-six.vercel.app
> **Status:** v1.0 — preparing first Play Console submission

## Stack

- **Next.js 15** (App Router) on Vercel
- **Supabase** — Postgres + Auth + Storage (EU region, RLS on every user-data table)
- **Stripe** for web subscriptions, **RevenueCat + Play Billing** (via the
  Web Digital Goods API) for Android in-app purchases
- **Sentry** for error monitoring (source-map upload gated by env)
- Service-worker-backed PWA with offline barcode scan, push notifications
  (web-push + VAPID), native install on Android & iOS
- ZXing for barcode scanning, jsPDF for insurance reports

## Local development

Prerequisites:
- Node ≥ 18.17, npm 9+
- A Supabase project (free tier is enough)
- Optional: Discogs developer keys, Stripe test keys, Resend, Spotify,
  Ticketmaster, Setlist.fm, eBay — see `.env.example`

```bash
cp .env.example .env.local
# Fill in NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
# SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_APP_URL=http://localhost:3000

npm install
npm run dev
```

App at <http://localhost:3000>. Without Supabase env vars set, the UI
still renders in "demo mode" — feed pulls from Metal Archives, sign-in
shows clean error states.

### First-time database setup

In the Supabase SQL editor, paste & run `supabase/APPLY_PENDING.sql`
(combines all current migrations). Or apply each `supabase/migrations/0NN_*.sql`
in numeric order.

## Scripts

```bash
npm run dev    # local dev (port 3000)
npm run build  # prod build — also stamps the service-worker version
npm run start  # serve the prod build
npm run lint   # next lint
```

Asset generators (run any time the source PNGs or layout change):

```bash
node scripts/gen-maskable-icons.mjs    # 192/512 maskable from icon-XXX.png
node scripts/gen-screenshots.mjs       # Play Store screenshots from running dev server (needs system Chrome)
node scripts/gen-feature-graphic.mjs   # 1024x500 launch banner
```

## Deploy

`main` is the production branch. Vercel auto-deploys every push.

Environment variables (Vercel → Project → Settings → Environment Variables):

| Required | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client + middleware |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin operations (webhooks, crons, account deletion) |
| `NEXT_PUBLIC_APP_URL` | Used by OAuth callbacks, share links, email templates |
| `CRON_SECRET` | Bearer token required for `/api/cron/*` (fail-closed if unset) |
| `DISCOGS_KEY`, `DISCOGS_SECRET` | OAuth + price lookups |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_YEARLY` | Web subscriptions |

| Optional | Purpose |
|---|---|
| `NEXT_PUBLIC_REVENUECAT_PUBLIC_KEY`, `REVENUECAT_WEBHOOK_SECRET` | Play Billing on Android |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Push notifications |
| `RESEND_API_KEY`, `FROM_EMAIL` | Weekly digest emails |
| `TICKETMASTER_API_KEY`, `SETLISTFM_API_KEY` | Concert proximity + setlists |
| `EBAY_APP_ID`, `EBAY_CERT_ID`, `EBAY_EPN_CAMPAIGN_ID` | Marketplace comparison |
| `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` | Persona widget + share images |
| `SENTRY_DSN` (or `NEXT_PUBLIC_SENTRY_DSN`), `SENTRY_AUTH_TOKEN` | Error monitoring + source-map upload |
| `CSP_ENFORCE=1` | Switch CSP from report-only to enforcement |

## Repo layout

```
app/                  Next.js app router
  api/                Server routes (cron, webhooks, CRUD)
  components/         Shared UI (Toast, ErrorBoundary, modals)
  collection/         Vault tab + its modals
  concerts/           When's-On + concert journal
  artists/            Bands tab
  profile/            Profile + DangerZone (account deletion)
  scanner/            Barcode scan tab
  whens-on/           Tab wrapper around Concerts + Calendar
  page.js             Main shell (feed + nav + global modals)
lib/
  hooks/              useCollection, useBackButton
  i18n.js             EN + PL translations + locale switcher
  payments.js         Routes between Stripe (web) and Play Billing (TWA)
  pricing.js          FREE_TRIAL_DAYS + tier definitions (single source of truth)
  supabase.js         Browser client
  supabase-server.js  Server + admin clients (RLS bypass)
  theme.js            Color palette + font tokens (CSS variables)
public/
  manifest.json       PWA manifest (id, screenshots, maskable icons)
  sw.js               Service worker — auto-versioned at build time
  icons/              icon-{192,512}.png + maskable variants
  screenshots/        Play Store / install-prompt screenshots
  legal/              privacy.html, terms.html
  .well-known/        assetlinks.json for TWA Digital Asset Links
scripts/              Build-time + asset generators
supabase/migrations/  Numbered SQL migrations + APPLY_PENDING.sql aggregate
launch-marketing/     Play Store listing copy, feature graphic, social posts
```

## Bubblewrap (Android TWA)

See `BUBBLEWRAP.md` for the AAB build / fingerprint / sideload flow.
The Bubblewrap manifest template is in `twa-manifest.json` —
`packageId: pl.skudev.metalvault`, `playBilling.enabled: true`.

## Tech debt

Tracked in `TECHDEBT.md`. Highlights: bigger Toast / file-split sweep
across the rest of the tabs, jsPDF 4 major bump (advisory targets the
unused `.html()` path), explicit Sentry capture on more silent catches.

## License

Private. All rights reserved by SkuDev (Mateusz Skura).
