# Play Console submission — step-by-step

Step-by-step walkthrough for the first Play Console submission of
Metal Vault. All form answers are pre-filled — you can copy-paste
without having to make decisions on the spot.

Prerequisites (already done):
- ✅ Bubblewrap project built: `app-release-bundle.aab`, `app-release-signed.apk`
- ✅ assetlinks.json published with local keystore fingerprint
- ✅ Privacy policy at `/legal/privacy.html`
- ✅ App listing copy in `launch-marketing/04-play-store-listing.md`
- ✅ Feature graphic at `launch-marketing/assets/feature-1024x500.png`
- ✅ 6 phone screenshots at `public/screenshots/0{1..6}-*.png`
- ✅ App icon 512×512 at `public/icons/icon-512.png`

You'll need:
- Google Play Console account ($25 one-time fee, paid via Stripe in
  Play Console signup if you don't have one yet)
- Approximate time: 2-3 hours for the first listing

---

## 1. Create the app

Play Console → "Create app" (top right).

| Field | Answer |
|---|---|
| App name | `Metal Vault` |
| Default language | `English (US) – en-US` |
| App or game | App |
| Free or paid | **Free** (in-app purchases for Pro) |
| Declarations: developer rules | Tick all four |

→ Create app.

---

## 2. App content (left sidebar)

A checklist of policy declarations. Knock them out top-to-bottom:

### 2.1 Privacy policy

- URL: `https://metal-vault-six.vercel.app/legal/privacy.html`
- Save.

### 2.2 App access

- "All or some functionality is restricted" → tick.
- Add credentials Google can use to test:
  - Username: `e2e@metal-vault.test` (the test user you created in
    Supabase) OR create a dedicated reviewer account
  - Password: same as Supabase test user
  - Sign-in instructions:
    ```
    Open the app → tap "Open App" → use the credentials below to
    log in. Magic-link via email is also supported but the test
    account is configured with a password.
    ```
- Save.

### 2.3 Ads

- "No, my app does not contain ads." → save.

### 2.4 Content ratings

Click "Start questionnaire". Category: **Reference, News or Educational**.

| Question | Answer |
|---|---|
| Violence | None |
| Sexuality | None |
| Profanity | None |
| Drugs/Alcohol/Tobacco | None |
| Gambling | None |
| User-generated content | **Yes** (users can add their own collection notes) |
| Social features | None (no chat, no feed, no DMs) |
| Personal info | **Yes** (collects email, prices, photos of records) |
| Internet | Yes |
| Sensitive content | None |

Expected outcome: **Everyone** rating across all regions.

### 2.5 Target audience

- Age: 13+ (collectors are typically adult, but 13+ keeps families
  policies less strict)
- Apps for children: **No**
- Save.

### 2.6 News app

- This is **not** a news app. Save.

### 2.7 COVID-19 / contact tracing

- Skip — not a tracing app.

### 2.8 Data safety

This is the biggest form. Below is the exact set of answers for
Metal Vault.

**Data collection / sharing**

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | **Yes** |
| Is all the user data collected by your app encrypted in transit? | **Yes** (HTTPS everywhere via Vercel) |
| Do you provide a way for users to request that their data be deleted? | **Yes** (Profile → Delete account; route exists at `/api/profile/delete`) |

**Data types**

Tick these and only these:

- **Personal info → Email address** — Collected, NOT shared, "Account management" + "App functionality"
- **Photos and videos → Photos** — Collected, NOT shared, "App functionality" (record condition photos)
- **Files and docs** — Collected, NOT shared, "App functionality" (insurance PDFs)
- **App activity → App interactions** — Collected, NOT shared, "Analytics" (Sentry crash reports)
- **App info and performance → Crash logs** — Collected, NOT shared, "Analytics"
- **App info and performance → Diagnostics** — Collected, NOT shared, "Analytics"
- **Device or other IDs → Device or other IDs** — Collected, NOT shared, "Analytics" (Sentry session)

For each: tick "Required" (user can't opt out, except crash reports
where you can be honest and say Optional if Sentry has a kill-switch
in your code).

Do **not** tick: Location, Financial info (Stripe tokenises card
data, you never see it), Health, Messages, Contacts, Web history,
Audio, Calendar, Sensitive content.

### 2.9 Government apps

- **No** — this is not a government app. Save.

### 2.10 Financial features

- **No** — Stripe processes payments off-app, you don't store cards.

### 2.11 Health

- **No**.

---

## 3. Main store listing

Left sidebar → "Main store listing".

### 3.1 App details

| Field | Value |
|---|---|
| App name | `Metal Vault` |
| Short description (80 chars) | `Track, value, and document your metal vinyl collection. Insurance-ready PDFs.` |
| Full description (4000 chars) | Copy from `launch-marketing/04-play-store-listing.md` (the section under "Full Description") |

### 3.2 Graphics

| Asset | Source |
|---|---|
| App icon (512×512) | `public/icons/icon-512.png` |
| Feature graphic (1024×500) | `launch-marketing/assets/feature-1024x500.png` |
| Phone screenshots (1080×1920, ≥2 needed) | All 6 from `public/screenshots/` |

Tablet + Chromebook screenshots: optional, skip for first launch.

### 3.3 Categorization

| Field | Value |
|---|---|
| App category | **Music & Audio** (primary), **Lifestyle** (secondary if asked) |
| Tags | `music`, `vinyl`, `collector`, `metal`, `discogs` |
| Email | (your contact email) |
| Phone | (optional, leave blank) |
| Website | `https://metal-vault-six.vercel.app` |
| Privacy policy | `https://metal-vault-six.vercel.app/legal/privacy.html` |

Save.

---

## 4. Internal testing → upload first AAB

**Strongly recommended path**: Internal testing → Closed testing →
Open testing → Production. Each step has fewer reviewers + faster
turnaround. Publishing straight to Production is allowed but reviews
are slower and rejection rolls back the whole listing.

Left sidebar → "Testing" → "Internal testing".

### 4.1 Create release

- "Create new release" (top right)
- Sign with: **Use Google-generated key** ← TICK THIS
  (Google's "Play App Signing" stores the actual signing key for you;
  your local keystore is now only the *upload* key. This is the
  modern recommended path.)
- Upload `metal-vault-android/app-release-bundle.aab` (drag-drop)
- Release name: leave default (will read "1 (1.0.0)")
- Release notes:
  ```
  Initial release.
  - Discogs sync, barcode scanner, Discogs price tracking
  - Vinyl listening tracker, persona, market alerts
  - 3 languages: English, Polish, German
  - Currency: USD / EUR / PLN
  ```

Save → "Review release" → "Start rollout to internal testing".

### 4.2 GET YOUR PLAY APP SIGNING + UPLOAD KEY FINGERPRINTS

Left sidebar → "Setup" → "App integrity".

You'll see two SHA-256s:

- **App signing key certificate** → SHA-256 (this is what Play
  Store uses to sign all final APKs)
- **Upload key certificate** → SHA-256 (your `android.keystore`
  fingerprint that Play Console expects on uploads)

Copy both colon-hex values. Then locally:

```bash
cd /c/Users/kinga/Documents/GitHub/metal-vault
KEYSTORE_PASS=$(cat ../metal-vault-android/KEYSTORE_PASSWORD.txt) \
  node scripts/update-assetlinks.mjs \
    --keystore ../metal-vault-android/android.keystore \
    --play-app-signing AB:CD:...64-byte-hex... \
    --play-upload-key  12:34:...64-byte-hex...
git add public/.well-known/assetlinks.json
git commit -m "chore(twa): add Play Console fingerprints to assetlinks"
git push origin main
```

The script de-dupes. After redeploy, your TWA will pass digital asset
link verification for all three signing identities.

### 4.3 Add yourself as internal tester

Left sidebar (under Internal testing) → "Testers" → "Create email
list" → name it "Internal testers" → add your Gmail.

Then: copy the "Join URL" from "How testers join your test" → open
it on phone (signed in to the same Gmail) → "Become a tester".

Once you've joined, the app appears in Play Store with a "(Beta)"
suffix. You can install it like a normal app — this version is
signed by Play, opens from the launcher, and benefits from Play
Store auto-updates.

### 4.4 Test on phone

Install the Play-signed version. Verify:

| Check | Expected |
|---|---|
| Cold launch — splash + no URL bar | ✅ |
| Login (your test account or Discogs OAuth) | ✅ |
| Vault tab loads collection | ✅ |
| Push notifications (Profile → enable) work | ✅ |
| Barcode scan opens camera | ✅ |
| Pull-to-refresh works | (if implemented) |
| Hardware back closes overlays, not the app | ✅ |

If URL bar persists: usually means assetlinks fingerprint mismatch.
Make sure the file you pushed in 4.2 has all 3 fingerprints, and
that you opened the Play Store version (not your sideloaded APK from
earlier — that uses your local key).

---

## 5. After internal testing succeeds

Promote internal → closed → open → production (each is a button in
the same sidebar). Closed testing requires you specify tester emails.
Open testing is publicly joinable but lower priority for review.

For first launch I'd recommend:
1. **Internal** for 1-2 days (verify TWA works on Play-signed APK)
2. **Closed alpha** with 5-10 friends for 3-7 days (real-world bugs)
3. **Production** once feedback is incorporated

---

## 6. In-app billing (optional, for Pro tier)

Only matters if you want Pro purchasable from inside the TWA. Skip
for first launch if you only sell Pro via Stripe (web).

Required if you DO sell from TWA: Play Console → Monetisation →
Subscriptions → create products matching `lib/payments.js` SKUs:
- `mv_pro_monthly`
- `mv_pro_yearly` (if you have one)

Then RevenueCat dashboard → link Play product → copy public API key
to `NEXT_PUBLIC_REVENUECAT_API_KEY` in Vercel env.

Test path documented in `BUBBLEWRAP.md` ("In-app billing test").

---

## Cheatsheet — common rejection reasons

| Symptom | Cause | Fix |
|---|---|---|
| "Your app is not designed primarily for content from the web" | Play sometimes rejects TWAs that look too thin | Add 1+ Android-native feature OR appeal with link to Bubblewrap docs |
| "Your privacy policy doesn't cover all data" | Data Safety form ticks ≠ what privacy policy says | Make sure `/legal/privacy.html` mentions every data type ticked in 2.8 |
| "App contains misleading content" | Screenshots don't match what's in the app | Use only `public/screenshots/*.png` (canonical) |
| URL bar visible | Wrong fingerprint in assetlinks | Re-run `update-assetlinks.mjs` with all 3 keys, redeploy, clear Chrome cache on phone |
| Sign-in test failed (review team can't log in) | Test account credentials in App access section are wrong / blocked | Verify the account you registered exists in Supabase + can password-login |

---

## After launch

- Add Sentry env vars (`SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`,
  `SENTRY_AUTH_TOKEN`) to Vercel for error monitoring
- Add Resend env var for email digests (`RESEND_API_KEY`)
- Set up Play Console release notes for every future deploy
- Bump `appVersion` in `metal-vault-android/twa-manifest.json` and
  re-run `bubblewrap update --skipVersionUpgrade && bubblewrap build`
  to produce a new AAB
