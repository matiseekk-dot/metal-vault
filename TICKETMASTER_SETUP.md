# Ticketmaster Discovery API — Setup Guide

Migrated from Bandsintown after they enforced partnership-only API access (April 2026).

## Why Ticketmaster?

| Feature | Bandsintown | Ticketmaster |
|---|---|---|
| Free tier | ❌ Partnership only | ✅ 5000 req/day |
| Approval needed | ❌ Manual review (weeks/never) | ✅ Instant |
| Coverage | Strong indie/underground | Strong mainstream + global |
| Rate limit | Unspecified | 2 req/s, 5000/day |
| Affiliate program | No | Yes (commissions per ticket) |

## Setup (5 minutes)

### Step 1: Register

1. Visit https://developer.ticketmaster.com
2. Click **Register** (top right)
3. Fill out: email, password, app name "Metal Vault"
4. Verify email

### Step 2: Get API Key

1. Login → **My Apps** → **Default Application**
2. Copy **Consumer Key** — this is your API key

### Step 3: Add to Vercel

1. Vercel Dashboard → metal-vault-six → Settings → Environment Variables
2. Add:
   - **Key**: `TICKETMASTER_API_KEY`
   - **Value**: (paste Consumer Key)
   - **Environments**: Production, Preview
3. Save → Deployments → Redeploy

### Step 4: Remove old Bandsintown env var

In Vercel Environment Variables, delete:
- `BANDSINTOWN_APP_ID` (no longer used)

## Testing

After redeploy:

1. Hard reload app (F12 → Application → Storage → Clear site data → refresh)
2. When → Live tab
3. Should show real concerts for followed bands

If "no upcoming dates" but bands DO have tours:
- Check Vercel Function logs for `/api/concerts`
- Look for `invalid_api_key` or `rate_limited` errors

## API Coverage Notes

**Strong**:
- All major metal touring acts (Iron Maiden, Metallica, Gojira, Mastodon)
- US, UK, EU, AU markets
- Festival lineups (Hellfest, Wacken, etc.)

**Weaker**:
- Niche underground bands without official ticketing
- Eastern European local-only tours
- DIY/house show circuits

For niche bands, lineup attractions in larger festival events still surface them.

## Rate Limit Strategy

Default plan:
- 5000 requests/day
- 2 requests/second

Our usage:
- Per-artist cache 24h (in `discogs_cache` table, key prefix `tm-v2::`)
- Daily-digest cron: ~unique artists across all users (deduplicated)
- Per-user When→Live: max 30 followed artists
- Realistic: ~500-1500 calls/day for 100 active users

Well under limit.

## Affiliate Program (optional)

Ticketmaster Affiliate (https://developer.ticketmaster.com/products-and-docs/apis/affiliate)
allows revenue share on tickets purchased via your links.

Setup is separate from API key. Once approved, all event URLs returned by
the API automatically include affiliate tracking parameters.

To enable later: register at https://impact.com → Search "Ticketmaster" →
Apply → Add `TICKETMASTER_AFFILIATE_ID` env var (we'll wire this into
ticket links when ready).

## Migration Cleanup

After Ticketmaster works:

1. Vercel → delete `BANDSINTOWN_APP_ID` env var
2. Supabase SQL Editor → clean old cache:
   ```sql
   DELETE FROM discogs_cache WHERE cache_key LIKE 'bit::%';
   ```
3. Done — old Bandsintown layer fully removed.
