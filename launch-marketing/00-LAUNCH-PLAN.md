# 🚀 Metal Vault Launch Plan — Week-by-Week

**Status**: v58 deployed, RC backend ready, Etap 2 frontend done. Ready for Closed Testing → Production.

---

## TIMELINE OVERVIEW

```
Week 0 (NOW):     Setup & assets
Week 1:           Closed Testing on Play Store
Week 2:           Continue Closed Testing + content prep
Week 3-4:         Closed Testing required period (14 days minimum)
Week 5:           Production release
Week 5-6:         Reddit + FB launch posts
Week 5-12:        Instagram daily presence
Week 8+:          First metric review, decide next moves
```

---

## WEEK 0 — Setup (BEFORE you can launch)

### Code & deployment
- [ ] Push v58 to GitHub
- [ ] Verify Vercel green build
- [ ] Run Supabase migrations 017, 018, 019, 020 in production
- [ ] Add `location_city TEXT` to profiles (single ALTER, was missing from 016)

### RevenueCat dashboard (in BabyLog account)
- [ ] Create new app for Metal Vault: `pl.skudev.metalvault`
- [ ] Connect Play Service Account (reuse from BabyLog)
- [ ] Create products: `mv_pro_monthly` ($4.99), `mv_pro_yearly` ($39.99) in Play Console FIRST
- [ ] Import to RevenueCat from Play Console
- [ ] Create entitlement: `pro` mapped to both products
- [ ] Configure webhook: `https://metal-vault-six.vercel.app/api/revenuecat/webhook`
- [ ] Set Bearer auth secret (generate via `openssl rand -hex 32`)

### Vercel env vars
- [ ] `REVENUECAT_WEBHOOK_SECRET` = (generated above)
- [ ] `NEXT_PUBLIC_REVENUECAT_PUBLIC_KEY` = (from RC dashboard → API Keys)

### Test webhook
- [ ] In RC dashboard → Webhooks → "Send test event"
- [ ] Check Vercel logs: should see `[revenuecat-webhook] type: TEST`
- [ ] Check Supabase: `SELECT * FROM revenuecat_events;` shows 1 row

### Legal & content
- [ ] Privacy Policy live at `/legal/privacy.html`
- [ ] Terms of Service live at `/legal/terms.html`
- [ ] Verify both load on production URL

### Play Console assets
- [ ] App icon (512×512) — already have ✓
- [ ] Feature graphic (1024×500) — **NEEDS CREATION**
- [ ] 8 phone screenshots (1080×1920) — **NEEDS REAL CAPTURE**
- [ ] App description (use `04-play-store-listing.md` template)
- [ ] Privacy Policy URL: `https://metal-vault-six.vercel.app/legal/privacy.html`
- [ ] Terms of Service URL: `https://metal-vault-six.vercel.app/legal/terms.html`
- [ ] Content rating questionnaire completed (Everyone)

### Build TWA
- [ ] Bubblewrap build with new pl.skudev.metalvault package
- [ ] Sign with Play Store key (use existing keystore from BabyLog if same dev account)
- [ ] Generate AAB file

### Closed Testing setup
- [ ] Upload AAB to Play Console Closed Testing track
- [ ] Create tester list (target: 12+ testers minimum for 14-day requirement)
- [ ] Send invitation links to 15-20 metalheads in your network
  - Polish metal community contacts
  - Discogs friends
  - Metal Facebook groups (DM admins, not public posts)
  - Reddit DMs to active r/Metal contributors

### Other
- [ ] HR ING notification for secondary employment (DO THIS BEFORE PUBLIC LAUNCH)
- [ ] Email forwarding for `hello@metalvault.app` setup
- [ ] Domain `metalvault.app` purchased (or alternative — `getmetalvault.com`?)

---

## WEEK 1-3 — Closed Testing Period

Google Play requires **minimum 14 days + 12 active testers** before promoting to Production. Use this time wisely:

### Daily during testing
- [ ] Monitor Sentry for crashes
- [ ] Check RC dashboard for purchase events (testers can buy with test cards)
- [ ] Reply to ALL tester feedback within 24h
- [ ] Fix bugs as they're reported (don't accumulate)

### Content prep (parallel work)
- [ ] Set up Instagram account `@metalvault.app`
- [ ] Take 30+ vinyl photos for content bank (your own collection)
- [ ] Record 5-10 short screen recordings of app features
- [ ] Draft first week of Instagram posts (use `03-instagram-calendar.md`)
- [ ] Identify 3-5 metal podcasts/blogs to outreach later

### Tester engagement
- [ ] Weekly digest email to testers: "Here's what changed this week, here's what's coming"
- [ ] Personal thank-you to first 3 testers who file substantive feedback
- [ ] Identify 2-3 power users who might become organic advocates

---

## WEEK 4 — Pre-launch Final Push

### Code freeze
- [ ] No new features after Day 21 of Closed Testing
- [ ] Last bug fixes only
- [ ] Final v60+ build with stability fixes

### Launch content finalization
- [ ] Reddit posts drafted and reviewed (use `01-reddit-posts.md`)
- [ ] Facebook group list confirmed, admin DMs sent (use `02-facebook-groups.md`)
- [ ] Instagram first 7 posts scheduled
- [ ] Play Store listing copy reviewed and locked

### Marketing assets
- [ ] Landing page final review (any English typos? broken links?)
- [ ] Social share image for posts (1200×630, OG tags)
- [ ] Demo video (30-60 sec) — optional but boosts conversion 20%+

### Track-and-promote setup
- [ ] UTM parameters configured for each channel:
  - `?utm_source=reddit&utm_medium=organic&utm_campaign=launch`
  - `?utm_source=fb&utm_medium=organic&utm_campaign=launch`
  - `?utm_source=instagram&utm_medium=organic&utm_campaign=launch`
- [ ] Vercel Analytics or simple analytics set up

---

## WEEK 5 — PRODUCTION LAUNCH 🚀

### Day 1 (Monday) — Promote to Production
- [ ] Click "Promote to Production" in Play Console
- [ ] App goes live (allow 24-48h for Google review)
- [ ] Verify install link works on a fresh device

### Day 2 (Tuesday) — r/Metal launch
- [ ] Post to r/Metal at 9am EST
- [ ] Reply to comments every 2 hours for first 12 hours
- [ ] Track signups via UTM

### Day 3 — Instagram launch
- [ ] First Instagram post (carousel announcement)
- [ ] Stories with countdown ended
- [ ] DM 5-10 metal accounts you've been engaging with

### Day 4 — r/vinyl
- [ ] Post to r/vinyl (different angle from r/Metal)
- [ ] Engage all comments

### Day 5 — Facebook groups (Tier 1)
- [ ] Post to first 2-3 Facebook groups (Metal Vinyl Trading, Vinyl Records — Heavy Metal Edition)
- [ ] Reply to comments

### Day 6-7 — Continue rollout
- [ ] r/MetalForTheMasses
- [ ] More Facebook groups (Tier 2)
- [ ] Instagram daily posts continue

---

## WEEK 6+ — Sustain & measure

### Daily
- [ ] Check Sentry for errors
- [ ] Check RC for new purchases
- [ ] Reply to support emails (target: <24h)
- [ ] Engage on Instagram (15 comments minimum)

### Weekly
- [ ] One Reddit post (rotating subreddit, value-add not promotion)
- [ ] One Facebook group post (different group, different angle)
- [ ] 3-4 Instagram posts + 1-2 Reels

### Monthly review (Day 30, 60, 90)
- [ ] Total signups, paid conversions
- [ ] Channel attribution (which UTM source converts best)
- [ ] Churn rate (users who canceled within 30 days)
- [ ] Feature usage analytics (which features matter most)
- [ ] Decision: invest more or scale back

---

## SUCCESS METRICS — what does "working" look like

### Month 1 targets
- 100-200 free signups
- 10-20 trial starts
- 3-8 paid conversions
- $15-40 MRR
- 2-3 reviews on Play Store

### Month 3 targets
- 300-600 total signups
- 40-80 trials started
- 15-30 paid users
- $75-150 MRR (~300-650 PLN)

### Month 6 targets
- 700-1500 signups
- 100-200 trials
- 30-60 paid users
- $150-300 MRR (~650-1300 PLN)

### Month 12 targets (your 2000 PLN goal)
- 2000+ signups
- 250-400 trials  
- 90-180 paid users
- $400-825 MRR
- **Net (after fees): ~1750-3450 PLN/month** ← TARGET RANGE

---

## DECISION POINTS

**Day 30 review**:
- If paid conversions < 3 → re-evaluate marketing channels, talk to 5 trial users about why they didn't convert
- If 5+ paid conversions → on track, continue current playbook
- If 10+ paid → ahead of schedule, consider doubling down on best channel

**Day 90 review**:
- If MRR < $50 → niche may be smaller than projected, consider B2B pivot or pricing tests
- If MRR $50-150 → solid niche, continue patient growth
- If MRR > $200 → strong signal, consider paid acquisition tests

**Day 180 review**:
- If MRR < $100 → product-market fit weak, hard decision time
- If MRR $200-500 → on track for 12-month goal, sustain
- If MRR > $500 → ahead of plan, scale aggressively

---

## KILL CRITERIA

Be honest with yourself. Set kill criteria up-front:

❌ **Stop investing in Metal Vault if:**
- 6 months in, MRR < $50 AND retention < 20% AND no clear "fix"
- You're spending more time than 10h/week and burning out
- BabyLog or another project is converting 5x better at same effort

❌ **Switch to maintenance mode if:**
- 9 months in, MRR plateaued under $200, no growth signal
- New feature launches don't move metrics
- You've lost passion for daily community engagement

If you hit kill criteria, **shutting down is OK**. It's not failure — it's data. Move energy to BabyLog or next project.

---

## RESOURCES

- **Reddit posts**: `01-reddit-posts.md`
- **Facebook groups**: `02-facebook-groups.md`
- **Instagram calendar**: `03-instagram-calendar.md`
- **Play Store listing**: `04-play-store-listing.md`
- **Privacy Policy**: `public/legal/privacy.html`
- **Terms of Service**: `public/legal/terms.html`
- **Setup steps**: this file (`00-LAUNCH-PLAN.md`)

