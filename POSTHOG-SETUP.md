# PostHog setup — Metal Vault analytics

Aplikacja ma już cały kod analytics scaffolded (`lib/analytics.js` +
wpięte eventy w paywall, onboarding, scan, alert, demo, purchase).
Zero KB cost dopóki klucze nie są ustawione — wrapper graceful
degraduje. Te kroki to **5 minut roboty raz** żeby uruchomić zbieranie.

---

## 1. Załóż projekt PostHog (3 min)

1. Wejdź na **https://eu.posthog.com/signup** (NIE us.posthog.com — chcemy
   żeby dane Polaków/Niemców zostały w UE, GDPR-friendly).
2. Sign up Google'em (najszybciej) lub e-mailem.
3. Po loginie — wybierz „**Product analytics**" jako use case.
4. Nazwa organizacji: `SkuDev` (albo cokolwiek)
5. Nazwa projektu: `Metal Vault`

Zostaniesz w projekcie. **W lewym górnym rogu** powinien być wybór
„Metal Vault".

---

## 2. Skopiuj Project API Key

W projekcie:

1. Lewy panel → **Settings** (kółko zębate na dole)
2. Settings → **Project** (zakładka)
3. **Project API Key** — pole z `phc_...` długim stringiem
4. Klik ikonki kopiowania obok klucza

Zachowaj go — będzie potrzebny w kroku 3.

---

## 3. Vercel envy (2 min)

1. **https://vercel.com/dashboard** → projekt **metal-vault**
2. Settings → **Environment Variables**
3. Dodaj **dwie** zmienne (zaznacz **Production + Preview** dla obu):

| Name | Value |
|---|---|
| `NEXT_PUBLIC_POSTHOG_KEY` | `phc_...` (skopiowany w kroku 2) |
| `NEXT_PUBLIC_POSTHOG_HOST` | `https://eu.i.posthog.com` |

4. **Save** dla każdej.
5. Zakładka **Deployments** → ostatni deploy → **⋮** → **Redeploy**
   → potwierdź.

Vercel zbuduje od nowa z envami. Trwa ~2 min.

---

## 4. Sprawdź że działa (1 min)

1. Otwórz **https://metal-vault-six.vercel.app** w karcie incognito
2. Otwórz DevTools → Network → filter `posthog` lub `i.posthog.com`
3. Po krótkiej chwili powinieneś zobaczyć POST requesty na
   `eu.i.posthog.com/e/`
4. W PostHog dashboard → **Activity** (lewy panel) → powinny pojawić
   się eventy `$pageview` w real-time

✅ Jak widzisz `$pageview` to scaffold zadziałał.

---

## 5. Funnele które chcesz utworzyć

Po pierwszych ~50 install'ach masz dane do tych analiz. Pre-build w
PostHog: **Insights** → **+ New** → **Funnel**.

### Funnel #1 — Activation

| Step | Event | Filter |
|---|---|---|
| 1 | `$pageview` | (auto — landing entry) |
| 2 | `demo_started` LUB `onboarding_step` | `action = view` AND `step = 0` |
| 3 | `add_to_collection` | (any source) |

**Pytanie:** „% userów co dochodzi do dodania pierwszej płyty?"

### Funnel #2 — Onboarding completion

| Step | Event | Filter |
|---|---|---|
| 1 | `onboarding_step` | `step = 0` AND `action = view` |
| 2 | `onboarding_step` | `step = 1` AND `action = view` |
| 3 | `onboarding_step` | `action = path_discogs` OR `path_scan` OR `path_browse` OR `complete` |

**Pytanie:** „Gdzie ginie 5→3-step onboarding po redesignie?"

Bonus segmentacja: **breakdown by `properties.action`** w step 3
pokazuje który path wybierają. Po 100 install'ach zobaczysz czy
`path_discogs` / `path_scan` / `path_browse` mają inne retention.

### Funnel #3 — Paywall conversion

| Step | Event |
|---|---|
| 1 | `paywall_viewed` |
| 2 | `paywall_cta_clicked` |
| 3 | `purchase_completed` |

**Pytanie:** „% userów co widzi paywall i kupuje" — typowo 2-8% w
SaaS, niżej = problem z value prop, wyżej = niedoceniony tier
gating.

Bonus segmentacja: breakdown by `properties.reason` — który trigger
najlepiej konwertuje (`ALERT_LIMIT_REACHED` / `PHOTO_LIMIT_REACHED`
/ `DETAILED_GRADING` / `manual`).

### Funnel #4 — Engagement loop

| Step | Event |
|---|---|
| 1 | `add_to_collection` |
| 2 | `alert_created` |
| 3 | `barcode_scan` (found=true) |

**Pytanie:** „Czy power-userzy używają wszystkich 3 kanałów wartości?"

---

## 6. Co NIE jest zbierane (świadomie)

- **Nie ma autocapture** (`autocapture: false` w `lib/analytics.js:55`).
  Tylko explicite event'owane akcje. Czysty dashboard, bez śmieci typu
  „kliknął div w nav".
- **Nie ma session recording** (`disable_session_recording: true`).
  Privacy + bandwidth + cost.
- **IP jest maskowane** (`ip: false`). Geolokalizacja będzie tylko
  na poziomie kraju (PostHog odgaduje z Cloudflare headers, nie z IP
  zapisanego u nich).
- **Honour Do-Not-Track** (`respect_dnt: true`) — userzy z DNT enabled
  są wyłączeni automatycznie.
- **Person profiles tylko po sign-in** (`identified_only`). Anonimowi
  użytkownicy generują eventy ale nie zostawiają „person" rekordu —
  dopiero `identify(userId)` w `app/page.js:142` zaczyna profil.

To pozwala napisać szczerze w privacy policy „we use PostHog for
anonymous usage analytics, EU-hosted, no IP tracking, no session
recording" i nie kłamać.

---

## 7. Update privacy policy (5 min, robisz raz)

Po włączeniu PostHog dodaj w `public/legal/privacy.html` linijkę
do Third-Party Services:

```html
<li><strong>PostHog</strong> — anonymous product usage analytics
(EU-hosted, no IP storage, no session recording). Helps us understand
which features are used and where users drop off.</li>
```

Bez tego masz (drobny) compliance gap — Google Play może wytknąć przy
review jeśli sprawdzą Data Safety vs faktyczny code.

---

## 8. Cost ceiling

- **Free tier** PostHog Cloud EU: 1 milion events/mc.
- Metal Vault na 1000 install'ów × 50 events/user/mc ≈ 50k events/mc.
- Mieścisz się w free tier do **~20 000 active users**. Po tym czasie
  pay-as-you-go zaczyna się od $0.0001/event powyżej miliona = ~$10/mc
  na 100k events powyżej. Nie jest groźne.

---

## TL;DR

1. https://eu.posthog.com → signup → utwórz projekt „Metal Vault"
2. Settings → Project → kopiuj `phc_...` API key
3. Vercel → metal-vault → Settings → Env Variables → dodaj
   `NEXT_PUBLIC_POSTHOG_KEY` + `NEXT_PUBLIC_POSTHOG_HOST=https://eu.i.posthog.com`
4. Redeploy
5. Otwórz prod URL → PostHog Activity widzi `$pageview`
6. Zbuduj 4 funnele wymienione w sekcji 5
7. Dodaj linijkę o PostHog w privacy.html

Po 100 install'ach z Closed Testing dane będą wystarczające do
A/B testów onboardingu i killer-feature messagingu.
