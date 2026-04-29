# eBay API Setup — Market Comparison Feature

The "Available now · price comparison" section in the album detail modal
shows lowest active eBay listings. This is a **display-only** feature
(eBay API License "Public Display" clause, no arbitrage / price modeling).

## Setup steps (~15 minutes)

### 1. Create eBay developer account

Go to https://developer.ebay.com/ → "Join the eBay Developers Program" → free.

### 2. Create an application

Developer Account → Application Keysets → "Create a keyset" → choose **Production**.

You'll get:
- **App ID (Client ID)**
- **Cert ID (Client Secret)**

### 3. Apply for Browse API access (if needed)

Browse API is generally accessible to all developer accounts WITHOUT extra
approval as of 2026 — try a request first; if you get a `marketplace_insights`
error, request access via developer support.

### 4. (Optional) Enroll in eBay Partner Network for affiliate revenue

https://partnernetwork.ebay.com/ → free signup → 24h approval.

You'll get a **Campaign ID** (e.g. `5338000001`). When set, the API uses
`itemAffiliateWebUrl` instead of `itemWebUrl`, attributing user clicks to
your account. Commission is 1-4% of sale value, paid monthly.

### 5. Set Vercel environment variables

```
EBAY_APP_ID=YourApp-MetalVau-PRD-xxxxxxxxx
EBAY_CERT_ID=PRD-xxxxxxxxxxxxxxxxxxxxxxxxxxxx
EBAY_EPN_CAMPAIGN_ID=5338000001    # optional, for affiliate revenue
```

### 6. Redeploy

Vercel → Deployments → Redeploy latest. The MarketComparison component will
start showing live eBay data within the next album modal open.

## What's NOT supported

- **Allegro API**: not available for solo developers without business approval.
  The Allegro row uses a search deep-link to allegro.pl/listing instead.
- **OLX API**: marketplace API is gated to RE (real estate) only. Not suitable
  for vinyl. Skipped entirely.
- **Sold listings / price history**: requires eBay Marketplace Insights API,
  which is gated and "cannot be granted upon request" per eBay docs.
  We show only currently active listings.

## Compliance notes

The integration is designed to be eBay-compliant:

| Behavior                                        | Why it's safe                          |
|-------------------------------------------------|----------------------------------------|
| Show eBay lowest price next to Discogs           | Public Display clause                  |
| Click-through opens eBay in browser              | Drives traffic to eBay (their goal)    |
| Cache eBay results for 6h                        | Within their freshness expectations    |
| No "buy on Discogs, sell on eBay" suggestions    | Avoids "seller arbitrage" prohibition  |
| No automated repricing                           | Avoids "price modeling" prohibition    |
| No aggregated seller performance data            | Avoids forbidden derivations           |
| Affiliate URL when available                     | eBay encourages this                   |

## Cost estimate

eBay Browse API is free up to 5,000 calls/day (default tier). Our cache
reduces actual API hits to ~10% of user-facing calls. For 100 active users
viewing ~20 albums/day each, expect ~200-400 actual API calls/day, well
within the free tier.

If you exceed 5k/day in the future, eBay grants higher tiers via developer
support — also free, just requires app review.

---

# Bandsintown API Setup — Live Concerts

The "Live" sub-tab in WHEN'S ON shows upcoming concerts for the user's
followed artists, optionally filtered by location radius.

## Setup (5 minutes)

### 1. Register a Bandsintown app

Go to https://www.artists.bandsintown.com/support/public-api → email them
asking for a public API `app_id`. Free, usually approved within 24-48h.

Alternative: many smaller dev tools use `app_id=metalvault-dev` style
identifiers without formal registration — Bandsintown does not enforce
strict app_id ownership, but registering is the right path for production.

### 2. Set Vercel env var

```
BANDSINTOWN_APP_ID=your-app-id-here
```

### 3. Redeploy

The "Live" sub-tab will automatically work for users with at least 1
followed artist.

## What it does

- Fetches upcoming events for each followed artist (parallel batched)
- 24h cache per artist (concerts don't change minute-by-minute)
- Optional radius filter: 100 / 300 / 500 km from user location
- Default view: next 90 days · "Show all" expands to full tour calendar
- Click a card → opens Bandsintown ticket page

## Costs

- **Free.** No daily limit on app_id-based access.
- 24h cache means a typical user with 30 followed artists triggers ~30
  requests/day TOTAL (not per session) thanks to the cache.

## Integration with daily digest cron

Already wired: `/api/cron/daily-digest` could be extended to push
"🎸 Gojira plays Warsaw in 14 days" notifications when a soon-to-happen
concert is detected. Future enhancement.

---

# Setlist.fm API (optional)

Used by ConcertsTab history → "♪ Setlist" button to show what was played at past shows.

## Setup (5 min)

1. Sign up at https://www.setlist.fm/settings/api (free)
2. Get API key
3. Set Vercel env var: `SETLISTFM_API_KEY=your-key`
4. Redeploy

Without this key, the Setlist button still appears but shows "Setlist lookup not configured". No errors.

---

# Daily-digest concerts behavior

When `BANDSINTOWN_APP_ID` is set, the daily-digest cron (08:00 UTC):

1. **Scans all unique followed artists** across all users (deduplicated)
2. **Diffs against `artist_event_snapshots`** to find new events
3. **For each user**, computes:
   - Concert proximity: events ≤14 days away, within their location radius
   - Tour announcements: artists they follow with new events
4. **Pushes one combined notification** with prioritization:
   - Proximity wins (most actionable)
   - Then announcement
   - Then alerts/preorders
5. **Marks `concert_notifications`** to prevent duplicate pushes for same event

## Profile location

User can set lat/lng/radius via `/api/profile/location` POST. Without it, proximity push uses worldwide filter (i.e., any concert in next 14 days for any followed band triggers a push). Recommend in onboarding: "Enable location for nearby concert alerts."

