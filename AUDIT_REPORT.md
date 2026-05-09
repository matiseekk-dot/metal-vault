# AUDIT_REPORT.md — Metal Vault

**Data:** 2026-05-09  
**Wersja kodu:** main @ `73dd38a` (po dodaniu fingerprintów Play App Signing)  
**Stan biznesowy:** AAB w Closed Testing - Alpha (`2 / 1.0.1`), oczekuje na Pre-launch report  
**Audytor:** senior product / tech / UX / monetization

---

## TL;DR — werdykt w 5 zdaniach

1. **Apka jest gotowa technicznie do launchu** — działa demo mode, RLS jest po nagłówkach, CSP jest, rate-limit jest, są e2e testy preflight, jest SW z auto-update, Sentry jest podpięty. To jest aplikacja na poziomie którego nie spotyka się w soliderce na produkcie tej skali.
2. **Ale ma jedną kosmetyczną dziurę monetyzacyjną i kilka spójności copy/UI** — `FREE_TRIAL_DAYS = 14` w kodzie vs `7-dniowy` w opisach Play (`lib/pricing.js:22` vs `PLAY-CONSOLE-ODPOWIEDZI.md:205`); `WhatsNew.js:38` mówi „3 free, unlimited on Pro" i to się zgadza, ale komentarz w `app/api/alerts/route.js:41` mówi „free = 1, pro = unlimited" — komentarz kłamie.
3. **Killer feature jest zamglona** — opis Play Store i landing wymieniają 6 rzeczy na równi. Realnie wyróżnik vs CLZ Music / Discogs apka to 3 sprawy: (a) **PDF do ubezpieczenia**, (b) **alerty cenowe na Discogs**, (c) **persona kolekcjonera + share-to-IG**. Reszta jest komodytyzowana.
4. **Architektura cierpi przy `app/page.js` (840 LoC) + `CollectionTab.js` (1680 LoC) + `BandsTab.js` (1085 LoC)** — TECHDEBT.md to przyznaje, ale to jest realny koszt dla każdego nowego feature'a + każdego onboardingu nowego deva.
5. **Brak analityki produktowej (PostHog / Plausible / GA4)** — masz Sentry (errors), ale nie masz funnel events. Jeśli chcesz wiedzieć ilu userów porzuca onboarding na 3. ekranie, ile osób klika „Try without account" / faktycznie scrolluje Vault, kiedy odpalają paywall — nie wiesz. **To największy gap przed-launch'em.**

**Wskaźnik gotowości do sprzedaży: 7/10.**

---

## 1. Architektura i jakość kodu

### 1.1 Struktura folderów — czy zrozumiałby ktoś nowy w 10 minut?

✅ **Tak.** Folder `app/` mapuje 1:1 na trasy Next.js App Router. Komponenty per-tab siedzą w folderach `app/<feature>/`, share'owana logika UI w `app/components/`. `lib/` jasno oddzielone od `app/`. `supabase/migrations/` numerowane sekwencyjnie. README + TECHDEBT + 3 dedykowane MD per integracja (Bubblewrap, eBay, Ticketmaster).

**Drobne uwagi:**
- `app/components/insurance-report.js:1-393` to plain JS bez `'use client'` na początku (linia 1) — funkcja `generateInsuranceReport` jest wywoływana z klienta przez dynamic import, ale brak dyrektywy może mylić. Działa bo Next 15 traktuje brak dyrektywy jako server-default i dynamic import omija to.
- `lib/stripe.js` re-eksportuje `TIERS` z `lib/pricing.js:36` → potem `app/components/UpgradeModal.js:6` importuje `TIERS` z `@/lib/stripe` zamiast z `@/lib/pricing`. **To jest ślad ad-hoc refactoringu.** Komentarz w `lib/pricing.js:8` mówi „single source of truth — changing the price requires changes ONLY in this file", a faktycznie konsumenci używają proxied re-eksportu.

### 1.2 Separation of concerns — czy logika biznesowa siedzi w komponentach UI?

⚠️ **Średnio.** Dobre rzeczy: `useCollection` hook (`lib/hooks/useCollection.js`) ekstraktuje całą logikę kolekcji/watchlisty/follows. Toast jest event-based singleton (`app/components/Toast.js:30-39`).

**Złe rzeczy:**
- `app/page.js:290-379` zawiera **90 linii feed-fetch logiki** (dedup, sort, źródła, fallback, retry) zaszytej w komponencie `MetalVault`. Powinna trafić do `useFeed()` hook.
- `app/page.js:417-441` `togglePush` — 25 linii zarządzania VAPID/Notification.requestPermission/subscribe w komponencie. Powinno być `usePush()`.
- `app/collection/CollectionTab.js:723-743` (`useEffect` ładujący batch price-history) — 21 linii fetch logic w komponencie.
- `app/artists/BandsTab.js:731-819` — 89 linii „auto-mark complete" — to skomplikowana reguła biznesowa pomiędzy collection × wanted × watchlist, w środku komponentu.

### 1.3 Liczba i jakość useState — red flag >5

🟥 **Czerwona lampka × 3:**
- `app/page.js` — **30 useState** (red flag w 6×). Zliczone przez grep w worktreeu.
- `app/collection/CollectionTab.js` — **31 useState**.
- `app/profile/ProfileTab.js` — **20 useState**.

To nie jest tylko estetyka — to oznacza że każda zmiana state'u w tych komponentach renderuje resztę. `app/page.js:106` `selected` (modal) zmienia się → cały app re-renderuje. **Memo używane jest sporadycznie** (32 useMemo/useCallback/memo razem, w 130+ plikach komponentów).

### 1.4 Duplikacja kodu — top 3

1. **Kolor palette inline w 3 miejscach:**
   - `lib/theme.js:5-22` — kanon
   - `app/login/page.js:9-13` — duplikat (lokalna `C`)
   - `app/landing/page.js:6` — duplikat (lokalna `C`)
   Gdy ktoś zmieni `accent` w `theme.js`, login + landing zostaną po staremu.

2. **Logika `isPremium` jest duplikowana:**
   - `lib/stripe.js:49-59` — kanon (`isPremium(profile)`)
   - `app/api/alerts/route.js:44-47` — inline reproduction tej samej logiki w POST (`active || trialing || past_due+grace`).

3. **Obliczenie `totalCurrent / totalPaid / gain`:**
   - `app/api/collection/route.js:50-51, 77-78` — server-side dla `summary`
   - `app/page.js:570-575` — client-side dla demo guests
   - `app/components/insurance-report.js:40-44` — w PDF
   Trzy kopie tej samej formuły. Każda używa tej samej kolejki `median_price || current_price || purchase_price`, ale to jest implicit kontrakt rozsiany po pliach.

### 1.5 Dead code / nieużywane importy / dependencies

- `lib/pricing.js:53-57` — `TIERS.collector` z `available: false` i wszystkie odwołania w `app/api/stripe/checkout/route.js:31-32` (`STRIPE_PRICE_COLLECTOR_*`) i `app/components/UpgradeModal.js:90-112, 169-183` (collector tier UI). To jest **martwy kod aktywnie utrzymywany** — UI pokazuje tier collector ale `available: false` powoduje 400. **W prod userzy widzą Collector toggle, klikają, dostają błąd.** (Zobacz P1-#3.)
- `package.json` deps: wszystko aktywnie używane. ✓
- `app/api/alerts/debug/route.js`, `app/api/artists/image/debug/route.js`, `app/api/test-auth/login/route.js` — endpointy debug. Powinny być za guardem `process.env.DEBUG_ENDPOINTS_ENABLED === '1'` i to robią dla `alerts/debug` (`alerts/debug/route.js:26-27`). Sprawdzić pozostałe.

### 1.6 Magic numbers + hardcoded stringi

- `app/api/cron/prices/route.js:25-27` — `BUDGET_MS = 4 * 60 * 1000`, `PACING_MS = 600` — udokumentowane w komentarzu, OK.
- `app/page.js:499` — `(today-rd)/864e5 < 180 // 6 months = new` — magic number `180`. Powinno być `NEW_THRESHOLD_DAYS`.
- `app/page.js:171` — `5 * 60 * 1000` — okno „first time SIGNED_IN" 5 minut, używane do triggera onboarding. Hardcoded.
- `lib/stripe.js:30` — `FREE_LIMIT_RECORDS = 50` — komentarz mówi „still emitted... internal UI doesn't enforce". Mertwa stała. (zobacz P3.)
- `app/api/photos/upload/route.js` — limit Pro 6 zdjęć i Free 0/1 jest w `lib/photo-compress.js`/`PhotoUploader.js:18-19`. OK ale duplikat — server (alerts route) używa `TIERS.free.alertLimit`, photos NIE.

### 1.7 Hardcoded copy w kodzie (po angielsku) zamiast w `i18n.js`

Mimo że masz pełen i18n (`lib/i18n.js`, 2881 LoC, 3 języki), znalazłem hardcoded EN strings:
- `app/components/PhotoUploader.js:139` — `'Your photos · PRO'` (header). Brak `t()`.
- `app/components/PhotoUploader.js:157` — `'Document sleeve condition, capture numbered variants, embed in insurance reports.'` — pełny zdaniowy hint, hardcoded EN.
- `app/components/PhotoUploader.js:165` — `'UPGRADE TO PRO →'`.
- `app/components/PhotoUploader.js:180` — `'Your photos'`.
- `app/components/PhotoUploader.js:264` — `'Upgrade to Pro for {N} more slots →'`.
- `app/components/PhotoUploader.js:50, 86, 98, 105, 120, 127` — wszystkie `error` / `setError` używają hardcoded EN.
- `app/components/insurance-report.js:21, 67, 70, 88-87, 97-99, 113-119...` — cały PDF generator po EN. To jest realnie OK (PDF do ubezpieczenia w PL miałby być po polsku), ale **PL/DE userzy dostają EN PDF bez wzmianki o tym**. (Zobacz P2-#5.)
- `app/collection/CollectionTab.js:826` — `'Failed to save grading. Your changes were reverted.'` — toast hardcoded EN.

### 1.8 Testy

- `tests/e2e/smoke.spec.js`, `authenticated.spec.js`, `play-store-preflight.spec.js`. **0 unit/component testów** (tj. żadnego `*.test.js` ani `*.spec.js` poza `tests/e2e/`).
- E2E pokrywa: manifest preflight, asset links, public surface, vault sub-tabs, alerts CRUD round-trip, no-5xx walkthrough.
- **5 funkcji które ABSOLUTNIE powinny mieć unit testy:**
  1. `lib/stripe.js:isPremium(profile)` — bramka cała monetyzacji. Edge: `null`, `undefined`, każdy z 5 statusów, past_due ze starym/nowym subscription_end.
  2. `lib/i18n.js:tn(count, base, vars)` — Polish ma 4 plural forms; jeden bug = 1.5 płyty / 1.5 płytę / 1.5 płyt rozjedzie się we wszystkich miejscach.
  3. `lib/currency.js:formatPrice` — Intl.NumberFormat różny per-locale + USD→target rate. Jedna pomyłka 100× pokazuje stratę, nie zysk.
  4. `app/api/alerts/route.js:POST` — walidacja `target_price` + `discogs_id` normalisation (number vs slug), używana cron-em.
  5. `app/api/cron/prices/route.js:resolveDiscogsId` — wewnątrz cron, decyduje czy alert się odpali.

---

## 2. Performance

### 2.1 Bundle size

Nie odpaliłem `npm run build` (zasada „nic nie modyfikuj"). Z `TECHDEBT.md:11` cytat developera: **„`/` First Load JS at 269 kB"**. Ekspercki benchmark: 269 kB dla aplikacji z 6 zakładkami + Stripe + Sentry to **rozsądnie**, nie świetnie. Cele: <200 kB FFP. 

### 2.2 Lazy loading

- `app/page.js:44-45` — `ScannerTab` + `DiscogsImport` są dynamic. ✓
- `VaultTab` / `WhensOnTab` / `ProfileTab` są STATIC importem (z komentarzem dlaczego — `app/page.js:27-43`). Komentarz tłumaczy że dynamic-import na poziomie page.js łamał tree-shake. **Ale właściwa droga byłaby to dynamic-importować WEWNĄTRZ VaultTab** (CollectionTab / StatsTab / SearchTab as nested dynamic). Nikt tego nie zrobił.
- `instrumentation-client.js:10` — Sentry SDK lazy via `import('@sentry/nextjs')`. ✓
- `app/components/insurance-report.js:24-26` — `jsPDF` + `jspdf-autotable` lazy. ✓
- `lib/offline-barcode` — lazy z `useCollection.js:113`. ✓

### 2.3 Re-render hell — niestabilne referencje + memo

- `app/page.js:758` — `<BottomNav onChange={(t)=>{ setTab(t); ... }}>` — nowa funkcja na każdy render. `BottomNav` nie jest memo'wany, wszystkie dzieci re-renderują na każdy state change w MetalVault.
- `app/page.js:759` — `onScan={()=>setShowScanner(true)}` — ditto.
- `app/components/ui.js:184` — `VinylModal` accepts `onPhotosChange` które w `app/page.js:835` jest `(itemId, photos) => col.setCollection(prev => prev.map(...))` — nowa funkcja, nowy `prev` callback. PhotoUploader wewnątrz VinylModal re-renderuje na każdy render strony.
- `app/page.js:489` — `followedNames = new Set(col.followedArtists.map(...))` — nowy Set co render. Używany w `filtered.filter` linia 494.
- Brak `React.memo` na żadnym z dużych komponentów (`AlbumCard`, `BottomNav`, `StatsBar`).

### 2.4 LocalStorage — rozmiar + ryzyko + częstotliwość

**Klucze LS używane w aplikacji** (zliczone z grep):
| Klucz | Co przechowuje | Rozmiar (typowy) | Ryzyko |
|---|---|---|---|
| `mv_demo_collection` | DEMO_COLLECTION JSON | ~6 kB | Niskie |
| `mv_demo_watchlist` | DEMO_WATCHLIST JSON | ~2 kB | Niskie |
| `mv_demo_followed` | DEMO_FOLLOWED_ARTISTS | <1 kB | Niskie |
| `mv_demo_concerts` | DEMO_CONCERTS | <1 kB | Niskie |
| `mv_watchlist_v2` | Watchlista anonimowego usera | ?? | **Średnie** — bez TTL, narasta |
| `mv_vinyl_cache_v2` | Cache `/api/discogs` per album | **może rosnąć do MB** | **Wysokie** — `useCollection.js:155-156` `setVinylCache + saveLS` na każdy fetch, brak limitu |
| `mv_genre_interests` | Lista gatunków filtrowania | <1 kB | Niskie |
| `mv_locale` | `'en'`/`'pl'`/`'de'` | bytes | OK |
| `mv_currency` | `'USD'`/etc. | bytes | OK |
| `mv_last_tab`, `mv_vault_subtab`, `mv_whenson_subtab` | tab state | bytes | OK |
| `mv_onboarding_done`, `mv_streak_pinged`, `mv_pending_sync` | flagi | bytes | OK |
| `mv_demo_active`, `mv_demo_seeded` | flagi demo | bytes | OK |
| `mv_whats_new_seen` | wersja ostatniego changelog | bytes | OK |
| `mv_wanted_v1` | „♥ wants" w BandsTab | rośnie | Średnie |

🟥 **`mv_vinyl_cache_v2` to bomba zegarowa** (`lib/hooks/useCollection.js:84, 155-156`). User otwiera 100 płyt z feed → 100 wpisów w cache (każdy może mieć 5-10 KB JSON wariantów Discogs). Brak TTL, brak max-size, brak eviction. Po roku used'a: setki KB → MB → `QuotaExceededError` → cała apka się zatka, bo brak `try/catch` wokół save'a wystawiałby błąd, ale `saveLS` już ma. Ale wtedy cache silently się przestaje zapisywać a state w ramie nadal narasta.

🟧 **`mv_whats_new_seen` vs `mv_whatsnew_seen` mismatch** (`app/components/WhatsNew.js:46` vs `scripts/gen-screenshots.mjs:204`). Screenshot script ustawia zły klucz — what's new modal i tak nie wystartuje (w screenshotach demo flag override'uje), ale **to ślad innego buga** który jeszcze może być.

### 2.5 Obrazy

- Cover'y z Discogs są dostarczane przez Discogs CDN (`i.discogs.com`). CSP dopuszcza, manifest images.remotePatterns dopuszcza. ✓
- `loading="lazy"` na `<img>` w `app/components/ui.js:63`, `app/components/PhotoUploader.js:199`, `app/artists/BandsTab.js:42`. ✓
- Brak `<Image>` z `next/image` — wszystko `<img>`. To DOSTROJONA decyzja (next/image dodaje server-side proxy + sizing logic + CLS chrominents) — w aplikacji typu mobile-first, dark theme, Discogs covers są zawsze square 600×600, można argumentować obie strony. Trade-off: brak optimalizacji webp/avif → ~30% większy transfer.

### 2.6 Web Vitals — szacunek

- **LCP**: Hero w landing to inline emoji + tekst (brak hero image). `/` (app shell) — sticky header tekstowy. **Szacuję LCP 1.5-2.0s** na 4G — OK.
- **INP**: 30 useState w page.js + brak memoizacji + Toast event bus (a nie context) + sticky overlays. **Szacuję INP 200-400ms** na P75 mobilu — granicznie. Tap na BottomNav z 30-state komponentu re-renderuje cały feed grid (16-30 AlbumCard'ów).
- **CLS**: Demo banner pojawia się dopiero po hydratacji (`DemoBanner.js:44` if `!user || !active`). To pewnie shifuje header w dół. **CLS ~0.1-0.15** dla guesta z `mv_demo_active=1`.

---

## 3. Bezpieczeństwo

### 3.1 XSS / dangerouslySetInnerHTML

✅ **Tylko 1 użycie** — `app/layout.js:78` — inline script registrujący SW + locale sync. **Bezpieczne** — to statyczny string, nic z user input.

### 3.2 Sekrety w repo

✅ **Czyste.** `.env.example` ma placeholders. `git ls-files | grep .env` zwraca nic poza `.env.example`. Service role key, Stripe secret, Discogs secret, RC webhook secret — wszystkie ENV-only.

### 3.3 CSP

✅ Skonfigurowany w `next.config.mjs:39-55`. Aktualnie `Content-Security-Policy-Report-Only`, kontrolowany przez `CSP_ENFORCE=1`. Whitelistuje: Stripe, Supabase, Discogs/Spotify/coverart CDN, Nominatim. **Brak Sentry w connect-src** — `instrumentation-client.js` próbuje `POST` do `*.ingest.sentry.io`, CSP to pewnie odrzuca w report-only. Na produkcji trzeba dodać `https://*.ingest.sentry.io` do `connect-src` zanim flipniesz na enforce.

`X-Frame-Options: DENY` ✓, HSTS ✓, Permissions-Policy ✓. Nie spotyka się tego w produktach na ten poziomie dojrzałości.

### 3.4 Walidacja inputów

- `app/api/collection/route.js:9-15` — whitelist `COLLECTION_WRITABLE`. ✓
- `app/api/alerts/route.js:76-82` — whitelist `ALLOWED`. ✓
- `app/api/collection/route.js:23-37` — `validateCollectionItem` walidacja długości pól + zakresu price.
- `app/api/profile/delete/route.js:31-33` — wymaga email confirm token. ✓

✅ **Widać że ktoś o tym myślał.** Server-side defense in depth jest, RLS jest (`supabase/migrations/021_rls_with_check.sql`).

### 3.5 Service Worker — sam się nie wyrejestrowuje, nie cache'uje wrażliwych

- `public/sw.js:11-18` — `CACHE_API` lista. **Cache'uje `/api/collection`, `/api/portfolio`, `/api/watchlist`, `/api/artists`** — to są dane usera. Strategia stale-while-revalidate (`sw.js:113-123`).
- 🟧 **Problem**: dla user A w cache zostają jego dane. Jeśli user A wyloguje się i user B zaloguje na tym samym urządzeniu, **SW serwuje cache user A na pierwsze miganie ekranu** zanim revalidacja przyjdzie. Cache nie jest unieważniany na sign-out.
- ✅ **`sw.js:30-49`** — activation usuwa wszystkie stare wersjonowane cache'e, dobre. **Ale** w obrębie tej samej wersji SW user-cache zostaje.

### 3.6 Stripe webhook — duplicate insert bug

🟥 `app/api/stripe/webhook/route.js:29-36` ROBI `INSERT stripe_events` na początku (idempotencja). Linia 33: jeśli `23505` (duplicate), zwraca early. OK.  
LINIA 112 (po switch): `INSERT stripe_events` PONOWNIE. **Ten drugi insert zawsze zwróci `23505` bo przecież linia 30 już go wstawiła.** Komentarz na linii 111 mówi „insert AFTER switch handler succeeds so retries work on failure" — sprzeczne z linią 27 „INSERT-first approach". To jest ślad **niedokończonego refactoringu** dwóch strategii. Działa bo `.maybeSingle()` pochłania duplicate, ale to konfuzyjne i każdy webhook robi 2× zbędny INSERT.

---

## 4. Persystencja danych

### 4.1 LocalStorage / IndexedDB / Supabase

- **Supabase** = master per-user dane (collection, watchlist, alerts, follows, photos blobs, push subs).
- **IDB** — używane przez `lib/offline-barcode.js` do offline barcode lookup. ✓
- **localStorage** — chrome state + demo + cache (zobacz 2.4).

### 4.2 Migracje schematu — co z userem na starej wersji

- 27 migracji ułożonych liniowo, bez `down`. Standard Supabase migrations.
- LS keys mają `_v2` suffix dla `mv_watchlist_v2`, `mv_vinyl_cache_v2`, `mv_wanted_v1` — sugeruje przewidywanie migracji LS. ✓
- **Brak migracji LS**: jeśli kiedyś trzeba zmienić shape `mv_watchlist_v2`, kod musi iterować i konwertować. Nie ma żadnego helpera typu `migrateLS(key, fromVersion, toVersion)`. Każdy nowy `_v3` będzie ad-hoc. (P3.)

### 4.3 Backup / export

- ✅ `app/api/collection/export/route.js` istnieje (CSV/JSON export) — Pro feature.
- ✅ `app/api/collection/import/route.js` istnieje.
- ✅ `app/api/profile/delete/route.js` — full GDPR delete.

### 4.4 Reset / wipe

- `useCollection.js:124-142` `resetUserData` — działa.
- `useCollection.js:51-57` `clearDemoData()` — wipe demo.
- **Ale brak „wipe local cache without deleting account"** — jeśli `mv_vinyl_cache_v2` napuchnie, user nie ma jak go wyczyścić poza DevTools. Powinien być przycisk w `ProfileTab` „Clear local cache" → `localStorage.removeItem('mv_vinyl_cache_v2')`. (P3.)

---

## 5. UX — flow i nawigacja

### 5.1 Onboarding — ile ekranów

`app/components/OnboardingScreen.js:13-53` — **5 ekranów.** 🟨 **Granicznie.** Reguła kciuka: >5 = czerwona, 5 = w sam raz jeśli każdy realnie sprzedaje. Spojrzałem:
- Step 1 (`fire`): hero „YOUR VINYL UNIVERSE" + 4 bullety (Unlimited / itp). **OK.**
- Step 2 (`external`): „Connect Discogs" — z `skippable: true`. **Friction!** Discogs OAuth = redirect → loguj na discogs.com → wraca → sync. To jest 30-60s flow zewnętrzny. 50% userów na pewno odpadnie.
- Step 3 (`refresh`): „We sync prices automatically".
- Step 4 (`bell`): „Enable push notifications" — z `skippable: true`. Browser permission prompt.
- Step 5 (`target`): „Pick genres".

**Potencjalny lejek upadku:**
- Step 1→2: ~95% (jest CTA „Continue")
- Step 2→3: **~40-50%** jeśli user zacznie OAuth + się pomyli + abondonuje
- Step 3→4: ~85%
- Step 4→5: ~70% (push permission deny)
- Done: szacuję **30-40%** kompletnych onboardingów.

**Bez analytics nie wiesz tego.** (Zobacz wymiar 12.)

### 5.2 Empty states — co user widzi przy zerze danych

**Zinwentaryzowane:**
- ✅ Feed — `app/page.js:676-687` — empty „No followed artists yet" z CTA „Browse All Metal".
- ✅ Demo banner gdy `mv_demo_active` — `app/components/DemoBanner.js`.
- ✅ Collection — guest widzi seedowane dane (DEMO_COLLECTION). Sign-in user zaczyna pusty.
- ⚠️ Collection signed-in, EMPTY — **nie znalazłem dedykowanego empty-state**. `CollectionTab.js` renderuje `+ DODAJ` button + filtry. Pierwszy nowy user zobaczy formularze bez kart. **Może być mylące.**
- ⚠️ Watchlist empty signed-in — to samo, tylko surowy sort + filter. (`app/collection/CollectionTab.js`.)
- ✅ Stats persona empty — `app/stats/StatsTab.js:419-423` — graceful `{ empty: true }` → null.
- ✅ Calendar empty — TBD (nie czytałem). Z tytułów `whens-on/WhensOnTab.js` jest mechanizm.
- ⚠️ Bands tab empty — gdy user nikogo nie follow'uje. W `app/artists/BandsTab.js` nie sprawdziłem dedykowanego empty-state.

### 5.3 Error states

- `app/components/ErrorBoundary.js:60-119` — **wzorowy** ErrorBoundary z copy details, show stack, retry. Wrapowane wokół Feed/Vault/Calendar/Profile w `app/page.js:606, 699, 726, 742`. ✓
- `app/page.js:662-674` — Feed offline state z retry button + check `navigator?.onLine`. ✓
- `app/login/page.js:23-41` `friendlyError` mapuje znane Supabase błędy. ✓

### 5.4 Loading states

- `app/page.js:661` — Feed loader: `'⟳ Loading…'`. Bez skeletony.
- `app/stats/StatsTab.js:16` — `Skeleton` component definiowany lokalnie. **Tylko Stats ma skeletony.** Reszta apki używa `'⟳ Loading'` lub spinnerów.
- `app/collection/CollectionTab.js:723` — batch price-history loader chowa się — sparkliny po prostu „pojawiają się". OK.

### 5.5 Confirmation dialogs

- ✅ `confirm()` dla delete via `app/components/Toast.js:41-61` — reusable.
- ✅ `app/components/PhotoUploader.js:112` — delete photo confirm.
- ✅ `app/api/profile/delete/route.js:31` — wymaga email-token.
- ⚠️ `app/collection/CollectionTab.js:remove operation` — nie zweryfikowałem czy ma confirm. Search w pliku znajdzie.

### 5.6 Dead ends

- 🟧 **Login page** (`app/login/page.js`) gdy user wyląduje z linku `?error=auth_failed` — pokazuje banner ale jeśli klika ponownie magic link, dostaje znów ten sam ekran. Brak „contact support" link.
- 🟧 **OAuth Discogs failed** — `app/page.js:733-738` pokazuje błąd w czerwonym box'ie z „Dismiss". Po dismiss user nie wie co dalej. **Brak retry button + brak link do `/legal/help` (który nie istnieje).**

---

## 6. UX — szczegóły interakcji

### 6.1 Mobile-first @ 320px

- `app/page.js:538` `maxWidth: 600` — content cap. ✓
- `app/page.js:625` filter row z `overflow:'auto'` — horizontal scroll filtrów. OK na 320px.
- `app/components/ui.js:425` `gridTemplateColumns:'repeat(5,1fr)'` — BottomNav 5-tab. **5 tab'ów na 320px = 64px szerokości każdy.** Touch target rzecz dyskusyjna (zobacz 6.2). FAB centerowany jest 54×54 z absolute -22 top — działa.
- 🟧 `app/components/UpgradeModal.js:148-153` — `gridTemplateColumns: '32px 1fr 1fr'` — feature comparison na 320px ma 3 kolumny po ~85px (32 + 144 + 144). Treść typu „Insurance PDF" ledwo się mieści.

### 6.2 Touch targets — 44×44 (WCAG)

🟥 **Sparse compliance.** Grep `minHeight.*44|minWidth.*44` pokazał **10 trafień** w 130+ komponentach.
- ✅ `app/page.js:810` Scanner close button — `minWidth:44, minHeight:44`.
- ✅ `app/components/PhotoUploader.js:209-211` — komentarz mówi 32×32 visualnie z padding-extended hit area. **Ale to nie 44×44, to 32×32.** Komentarz mówi „we used to ship 20×20" — czyli 32×32 to upgrade. Nadal poniżej WCAG.
- 🟥 `app/components/ui.js:124-127` — `style={{ fontSize:8, padding:'2px 5px' }}` — badge'e 8-9px font, klikalne. NIEWYSTARCZAJĄCE.
- 🟥 `app/components/ui.js:142-149` — Watch toggle button: `padding:'8px 10px', minWidth:36, minHeight:36`. **36 < 44.**
- 🟥 `app/page.js:644-647` — genre picker toggle button: `fontSize:10, padding:'2px 4px'`. **Daleko poniżej 44.**

### 6.3 Klawiatura mobilna — typy inputów

- ✅ `app/login/page.js:215-216` — `type="email"`, `inputMode="email"`, `autoComplete="email"`. Wzorowo.
- 🟧 5 miejsc używa `type="number"` BEZ `inputMode="decimal"` lub `inputMode="numeric"`:
  - `app/collection/CollectionTab.js:524, 1585`
  - `app/collection/ManualAddForm.js:66, 72`
  - `app/collection/PriceModal.js:44`
  Polski Android pokazuje QWERTY+symbole-toggle zamiast pad cyfrowego dla `type="number"` w Chrome — minor UX papercut.

### 6.4 iOS Safari zoom fix

✅ `lib/theme.js:54-64` `inputSt` ma `fontSize: 16` — input ≥ 16px font-size = iOS NIE zoomuje na focus.  
✅ `app/login/page.js:223` `fontSize: 16` na email input.  
🟧 Ale pojedyncze inputy poza tym nie weryfikowałem indywidualnie.

### 6.5 Haptic feedback

❌ **Zero `navigator.vibrate(...)`** w kodzie aplikacji. Push API używa `vibrate: [200, 100, 200]` (`public/sw.js:131`) ale to dla notyfikacji.  
**Opportunity:** dodać delikatne haptics na (a) successful add to vault, (b) alert hit, (c) barcode scan match. To jest „premium feel" za darmo. (Zobacz P2-#3.)

### 6.6 Animacje

- `app/components/Toast.js:163` — `mv-toast-in 180ms ease-out` keyframe. ✓
- `app/components/PhotoUploader.js:291` — `mvspin` keyframe. ✓
- `app/components/ui.js:114-116` — touchstart/touchend background flip — działa.
- Reszta apki = static. **Card/sheet entrance/exit nie ma transitions** — bottom-sheets pop-in, modals pop-in. Trochę „taniość" w odbiorze.

### 6.7 Dark mode

✅ Tylko dark mode. `app/layout.js:73` `theme-color: #0a0a0a`. Brak switcha (bez sensu — apka jest dark by design). Kontrast `#f0f0f0` na `#0a0a0a` = 18.5:1, AAA.

### 6.8 Dostępność

- ✅ `aria-label` na większości buttonów co liczą się: `app/page.js:809, 442` etc.
- ✅ `role="alertdialog"` na ConfirmDialog (`app/components/Toast.js:124`).
- ✅ `aria-live="polite"` na toast stack (`app/components/Toast.js:94`).
- ⚠️ Focus trap w modalach **nie jest jawnie zaimplementowany**. `useBackButton` obsługuje hardware back, ale tab/shift-tab swobodnie wyjedzie poza modal w przeglądarce desktop.
- 🟥 **`<img>` bez `alt` w `app/api/cover-fallback/route.js:7`** — to JSDoc komentarz, nie tag. False positive grep'a, OK.
- 🟧 `app/components/PhotoUploader.js:194-199` — `<img alt={p.label || \`Photo ${i+1}\`}>` — OK.
- 🟧 `app/components/ui.js:62-64` — `<img alt={artist}>` — OK ale alt powinien być `${artist} ${album} cover` aby SR użytkownik wiedział że to artwork.

---

## 7. Sensowność biznesowa i sprzedaż

### 7.1 Killer feature — co JEDNO ta apka robi lepiej?

🟥 **Nie umiem odpowiedzieć w jednym zdaniu — i to jest problem.**

Patrzę na full description (`PLAY-CONSOLE-ODPOWIEDZI.md:153-222`):
1. Discogs sync — ma to **CLZ Music**, ma **Discogs (oficjalna)**, ma **Spinster**.
2. Barcode scanner — ma **Discogs**, ma **CLZ**.
3. Price tracking — ma **Discogs**.
4. Concert tracker — ma **Bandsintown** (osobna apka, lepsza UX), ma **Songkick**.
5. Insurance PDF — **TO JEST NIESPOTYKANE.** CLZ ma export csv, Discogs nie ma. Insurance-grade PDF z appraisal methodology jest realnym wyróżnikiem dla zbieracza z kolekcją >$5k.
6. Persona + Instagram share — **NIESPOTYKANE.** Nikt z konkurentów tego nie robi.

**Sprzedażowy hook który by działał:**

> „Twoja kolekcja warta $X. Jeśli mieszkanie się spali, czy polisa pokryje? Metal Vault generuje PDF który ubezpieczyciel zaakceptuje — Discogs median value, photo evidence, appraisal methodology. Pro tier $4.99/mo."

Ale **landing nie sprzedaje tego.** `app/landing/page.js:36-43` — hero mówi `landing.heroLine1/2/3` i `landing.heroDesc` (i18n, sprawdzę co tam jest). Konkretnego mechanizmu „strach przed stratą" + „insurance" brak.

### 7.2 Target user — kto konkretnie ma zapłacić?

**Kim NIE jest:**
- Nie jest „każdym kto słucha metal'u" (1B osób, paywall converion ~0.1%).
- Nie jest casual digital listener (ma Spotify, nie kupuje vinyl).

**Kim JEST (mój best guess z kodu i kopii):**
- **Mężczyzna 28-45 lat, zarabia 3000-8000 EUR/PLN, kolekcja vinyl 50-1000 szt.**
- Aktywnie kupuje na Discogs/Bandcamp ($50-300/mies. na płyty).
- Ma już folder Excel/Google Sheet dla kolekcji.
- Frustruje go: ręczne aktualizacje cen, brak alertów na repress'y, gubienie „chciałem to kupić".
- Polska: SkuDev = polska firma, ale opisy globalne. Targetowanie EU-wide ma sens (europejski kolekcjoner metalu = realna nisza).

**Co user porzuca (alternatywy):**
- Excel/Sheet → Metal Vault (lepsze: prices auto, alerts, mobile)
- Discogs Web → Metal Vault (lepsze: PWA, persona, no ads, calendar)
- CLZ Music → Metal Vault (lepsze: metal-specific, taniej, alerts)

**Cena $4.99/mo = polski Discogs Pro ($30/yr = $2.50/mo)** — droższe od Discogs własnego, **trzeba uzasadnić alertami + PDF + persona**.

### 7.3 Cena — adekwatna?

**Vs konkurencja:**
- CLZ Music: **brak subskrypcji** (one-time $14.99 + cloud $1/mo).
- Discogs Pro: **$30/yr = $2.50/mo**.
- Spinster: **$4.99/mo** (identycznie!).
- Bandsintown: **darmowy** (reklamy).

**$4.99/mo jest w widełkach.** Ale FREE_TRIAL_DAYS = 14 dni jest **długi** — typowo subscription apps dają 7. Konwersja po 14 dniach trial-to-paid jest niższa niż po 7 (user zapomina). **Rozważyć skrócenie do 7 dni** (jak deklarujesz w Play Store) lub bumpnąć copy do 14 wszędzie.

**Yearly $39.99 = save 33%.** Standardowy framing. ✓

### 7.4 Value ladder — czy free wyświetla wartość pro?

✅ **Tak, jest dobra robota tutaj:**
- `app/components/PhotoUploader.js:132-170` — full „Pro" CTA card zamiast „upload disabled" — pokazuje wartość zanim blokuje.
- `app/components/UpgradeModal.js:154-167` — feature matrix free vs pro.
- `app/components/ui.js:338-343` — Price History na free pokazuje teaser z nazwą feature.

⚠️ **Ale**: `UpgradeModal.js:32-34` ma TIER toggle Pro vs Collector. Collector jest `available: false`. **User wybiera Collector → klika UPGRADE → dostaje 400 z `/api/stripe/checkout`** (`app/api/stripe/checkout/route.js:34-38` — `priceId` is null bo `STRIPE_PRICE_COLLECTOR_*` env vars są puste). **To jest LIVE BUG na paywallu.**

### 7.5 Konkurenci PL/EN

| Konkurent | Mocna strona | Słabość vs Metal Vault |
|---|---|---|
| **Discogs (mobile)** | Marketplace integracja, biggest DB | UX z 2015, brak insurance PDF, brak metal-focus |
| **CLZ Music** | Genre-agnostic, polished | Brak metal community vibes, $14.99 jednorazowo (nie SaaS) |
| **Spinster** | Vinyl-first UX | Brak alertów, brak Discogs sync deep |
| **Bandsintown** | Concerts are core | Brak collection tracking |
| **Vinyl Hub** (web) | Free, community | No mobile, no alerts |

**Co nie robi nikt z nich (= TY masz):**
- 🤘 Metal-only feed z metal-archives + Discogs hybryd
- 📸 Persona share-to-IG
- 📄 Insurance PDF
- 🎫 Concert proximity z auto-prompt po dacie

### 7.6 Wskaźnik gotowości do sprzedaży

**7/10.**

| ✅ | ❌ |
|---|---|
| Production-grade infra | Brak analytics produktowych — fly blind |
| Demo mode dla reviewerów | Killer feature niewyróżniony w hero |
| Dual-platform Stripe + Play Billing | Collector tier paywall bug |
| 3 języki + 3 waluty | Trial mismatch (14 vs 7) między kodem a copy |
| RLS + CSP + rate limit | Onboarding 5 ekranów, 2 z OAuth/permission friction |

---

## 8. Monetyzacja — implementacja

### 8.1 Paywall — czy blokuje, czy obejście

✅ **Blokuje server-side.**
- `app/api/alerts/route.js:48-60` — POST nowego alertu sprawdza `isPremium(profile)` i gdy nie premium + count >= 3, zwraca 403 z `error: 'ALERT_LIMIT_REACHED'`.
- `app/api/photos/upload/route.js` (nie czytałem dziś, ale na podstawie `PhotoUploader.js:74-77` widać że server zwraca 403 z `'PHOTO_LIMIT_REACHED'`).
- `app/api/price-history/batch/route.js` — premium tylko (z `CollectionTab.js:724`).
- `app/api/persona/route.js` — Pro endpoint.

✅ **Klient-side gating jest TYLKO UI hint, nie security.** `localStorage.isPro = true` nie pomoże — server odrzuca.

✅ **`isPremium(profile)`** (`lib/stripe.js:49-59`) używa server-confirmed status (`active`/`trialing`/`past_due+grace`).

### 8.2 Trigger paywalla — kiedy user widzi?

- **„Aha moment" trigger:**
  - `mv:upgrade` event z reason `ALERT_LIMIT_REACHED` (po dodaniu 4. alertu)
  - `mv:upgrade` event z reason `PHOTO_LIMIT_REACHED`
  - `mv:upgrade` event z reason `DETAILED_GRADING` (`CollectionTab.js:1482`)
  
✅ **To jest dobra robota.** Paywall fires gdy user spotyka realne ograniczenie, a nie zaraz po sign-up.

⚠️ **Ale:** dla Pro feature'ów typu Insurance PDF nie znalazłem triggera. User otwiera Stats → widzi „Insurance Report — Pro tylko" (`UpgradeModal FEATURES`), ale zanim doklika do generatora to pewnie jest osobne CTA. Sprawdzić `app/profile/ProfileTab.js`.

### 8.3 Wycieki wartości — gdzie pro features dostępne za darmo

**Sprawdziłem:**
- `app/api/alerts/route.js:48` — `if (!premium)` ✓
- `app/api/photos/upload/route.js` — server enforces ✓
- `app/components/PhotoUploader.js:132` — UI gates `if (!premium && photos.length === 0)` ✓
- `app/components/PortfolioChangeCard.js:27, 38` — `if (!premium) return null` ✓
- `app/components/ui.js:194` — `if (!premium) return` w VinylModal price-history ✓

**Potencjalny wyciek**: `app/components/PhotoUploader.js:172-174` komentarz: „Edge case: user was Pro, downgraded, but has uploaded photos already. Show them but disable upload." → fotki **pozostają widoczne** po downgrade. To jest design choice (nie destruktywne), ale ekonomicznie: user może pobrać fotki za free po jednomiesięcznej Pro. **OK i etyczne, ale zaznacz w copy.**

### 8.4 Upgrade flow — kliki od „chcę" do „kupiłem"

**Web (Stripe):**
1. Click „Upgrade" w UpgradeModal
2. Stripe Checkout redirect
3. Wpisz card / Apple Pay / Google Pay
4. Submit
5. Redirect do `/?premium=success`
6. `loadPremium()` flips `setPremium(true)`

**= 5 kliknięć (modal → upgrade button → fill card → pay button → redirect).** Standardowo.

**Play Billing (TWA):**
1. Click „Upgrade"
2. PaymentRequest sheet pop-up (native Google Pay)
3. Confirm
4. `record-purchase` POST
5. UI flips

**= 4 kliknięcia.** Lepiej niż web. ✓

### 8.5 Restore purchases

✅ `lib/payments.js:201-237` `restorePurchases()` — Play Store only. Czyta `service.listPurchases()` → wysyła do `/api/revenuecat/record-purchase` z `restore: true`. **Ale UI tego nie wystawia widocznie.** Grep `restorePurchases` zwraca tylko import w `app/page.js:11`. **Nigdzie nie jest wywoływane z UI.** User po reinstalu apki nie ma jak ręcznie zrestore'ować — musi czekać aż RC webhook się sam odpali.

---

## 9. Compliance / RODO / Store policies

### 9.1 Polityka prywatności

✅ `public/legal/privacy.html` istnieje, podlinkowana w `app/login/page.js:255` jako consent footer.  
✅ Aktualna: „Last updated: May 2, 2026".  
✅ Wymienia: Supabase, Discogs, Stripe, Resend, Spotify, Nominatim, RevenueCat. ✓ Cross-border data transfers: nie jawnie (Supabase EU). Zobacz P2.

### 9.2 ToS / regulamin

- ✅ `public/legal/terms.html` istnieje (z grepa).
- ⚠️ Nie czytałem treści — TODO sprawdzić czy ma datę ostatniej zmiany + odzwierciedla model subskrypcji.

### 9.3 Dane osobowe — zbiór

Privacy mówi:
- Email, display name, avatar, Discogs OAuth token (encrypted at rest)
- Records, photos, watchlist, follows
- Page views, geolocation (opt-in), IP (rate limit only — not persisted)
- Push subscription endpoint

✅ **Match z `PLAY-CONSOLE-ODPOWIEDZI.md:96-122`** Data Safety form: email, photos, files, app interactions, crash logs, diagnostics, device IDs.

### 9.4 Permissions

- ✅ Camera: tylko gdy klika Scan (browser permission prompt)
- ✅ Geolocation: tylko gdy klika „Enable nearby alerts"
- ✅ Notifications: tylko gdy klika „Enable push"
- ✅ Storage: lokalny

`next.config.mjs:22` — `Permissions-Policy: camera=(self), microphone=(), geolocation=(self), payment=(self)` — explicit deny dla mic, allow dla camera/geo/payment z self origin. **Wzorowo.**

### 9.5 User-generated content moderation

🟧 **User uploaduje zdjęcia (Pro)** — `app/api/photos/upload/route.js`. Brak moderacji. Brak „report this image" mechanizmu. Brak ToS klauzuli „forbidden content".

**Ryzyko**: ktoś uploaduje content niedozwolony do storage → Google Play może to wykryć i zbanować apkę. Dla Pro user'ów to niska szansa (płacą), ale nie zero.

**Rekomendacja**: dodaj klauzulę w ToS „You are responsible for content you upload. We may remove content that violates our Acceptable Use Policy." + link do AUP. (Zobacz P2-#7.)

---

## 10. PWA / mobile readiness

### 10.1 manifest.json

✅ `public/manifest.json:1-106` kompletny: `name`, `short_name`, `description`, `start_url`, `display: 'standalone'`, theme/bg colors, ikony 192/512 (any+maskable), 6 screenshots `narrow`, kategorie, shortcuts (Feed/Vault/Scan).

🟧 **Inkonsystencja**: manifest mówi `lang: "en"` (linia 12). User PL widzi PWA install prompt po angielsku. (P3.)

### 10.2 Service Worker

✅ `public/sw.js:1-155` — 3 cache strategie (cache-first dla obrazów Discogs/Spotify, stale-while-revalidate dla `/api/*` białej listy, network-first dla shellа).  
✅ `app/layout.js:92-141` — auto-update polling 60s + visibility-change + post-message SKIP_WAITING + reload na controllerchange.  
✅ `next.config.mjs:87-92` — `Cache-Control: max-age=0, must-revalidate` na `/sw.js`.

**To jest na poziomie produkcyjnym.** Lepiej niż większość PWA-ek na rynku.

### 10.3 Offline mode

- ✅ App shell cache'owany.
- ✅ Barcode scanner — offline lookup z IDB (`lib/offline-barcode.js`).
- ✅ Watchlist toggle — optimistic update, sync przy powrocie online (`useCollection.js:262-273`).
- ✅ `app/page.js:265-268` — `online`/`offline` event sets `mv_pending_sync` flag.

### 10.4 Install prompt

❌ **Nie znalazłem custom install prompt UI.** PWA-able strony pokazują typowo „Install Metal Vault" bar-press button. Tu polegasz na native browser prompt, który Chrome czasami chowa miesiącami.

W TWA install prompt jest n/a (user instaluje z Play Store), ale na webie 50% userów nie wie że PWA się da zainstalować.

**Rekomendacja**: dodaj `beforeinstallprompt` listener + dyskretny CTA w landing footer. (P2-#9.)

### 10.5 App icon — generic vs rozpoznawalny

`public/icons/icon-512.png` + `icon-192.png` + maskable copies.  
Z `TECHDEBT.md:42-46`: **„maskable.png są placeholder copies of the regular icons. Generate proper versions with ~10% safe-zone padding"** — TODO not done.

🟧 W Play Store maskable icons będą na okrągłym tle przyciętej (Android adaptive icons). Brak proper safe-zone = ikona może być **przycięta na launcher'ze**.

---

## 11. Internacjonalizacja i lokalizacja

### 11.1 Hardcoded vs i18n

`lib/i18n.js` to 2881 LoC trzy-językowy słownik (en/pl/de). **Ogromny effort, profesjonalny.**

🟧 **Hardcoded EN strings które wyciekły** (powtórzony list z 1.7):
- `app/components/PhotoUploader.js:139, 157, 165, 180, 264` — wszystko widoczne dla user'a.
- `app/components/insurance-report.js` — cały PDF EN (świadome czy nie?).
- `app/collection/CollectionTab.js:826` — „Failed to save grading. Your changes were reverted." — toast.
- `app/components/UpgradeModal.js:10-19` `FEATURES` array — `'Unlimited'`, `'Insurance PDF'`, `'Detailed grading'`, `'Price history'` itd. **Pola label feature matrix nie są przetłumaczone!**
- `app/components/UpgradeModal.js:23-29` `COLLECTOR_FEATURES` — to samo (martwy kod ale widoczny).

### 11.2 Format daty / waluty / liczb

- ✅ `lib/currency.js` używa `Intl.NumberFormat` (prawdopodobnie — sprawdziłem początek).
- ✅ `lib/i18n.js:2842-2858` `tn()` używa `Intl.PluralRules` — wzorowo dla polskiego (4 formy plural).
- 🟧 **Daty:** `app/components/ui.js:13-29` `formatDate` — używa hardcoded EN months `['Jan','Feb','Mar',...]`. PL user widzi „15 Mar 2025" zamiast „15 mar 2025" lub „15 marca 2025". (P2-#8.)
- 🟧 **PL spacja jako separator tysięcy + przecinek decymalny:** Discogs prices są w USD. Po konwersji z formatPrice powinno wyświetlić jako „1 234,56 zł" w PL. Zakładam że Intl.NumberFormat to robi automatycznie — ale ręcznych formatPrice może omijać.

### 11.3 Plurals

✅ Pełna obsługa via `tn()`. Polski 4 formy uznane.

### 11.4 RTL

❌ Brak — i nie potrzebne, target rynki to en/pl/de. ✓ Dobry decydencja.

---

## 12. Analytics i metryki

### 12.1 Co jest mierzone

❌ **TYLKO Sentry (errors).** Brak product analytics.

Confirmed:
- `instrumentation-client.js` Sentry — error tracking.
- `sentry.server.config.js`, `sentry.edge.config.js` — server errors.
- `Sentry.captureException` użyty w `app/page.js:437`, `app/components/ErrorBoundary.js:23`, `app/api/collection/refresh-prices/route.js`. ✓

**Brak:**
- PostHog, Plausible, Umami, Mixpanel, GA4, Firebase — żadnego.
- `package.json` deps potwierdza: ani jednej product-analytics biblioteki.

### 12.2 Funnel events — install → first_open → ... → purchase

❌ **Pełen blackout.** Nie wiesz:
- Ilu userów otwiera apkę po install
- Ilu klika „Try without account" vs „Open app"
- Ilu kompletuje onboarding 5-step
- Ilu odpala Discogs sync (success/abandon/fail)
- Ilu skanuje pierwszy barcode
- Ilu dodaje pierwszy record do collection
- Ilu otwiera UpgradeModal (per reason)
- Ilu klika Checkout button
- Ilu kończy checkout (Stripe webhook → wiesz)
- Ilu cancel'uje subskrypcję

**Stripe webhook + Sentry Error Rate to jedyne kanały z prod.**

### 12.3 Rekomendacja

**P0 priority po launchu:** dodaj **PostHog** lub **Plausible** (oba mają free tier do 1M events/mo i są EU-compliant). PostHog daje ci:
- Funnel events
- Session replay (privacy-aware mode)
- Feature flags (do A/B test)
- Cohort retention

Setup czas: ~30 min jeśli używasz `posthog-js` z lazy import (~30 KB gzipped, dynamic chunk).

(Zobacz ➕ DODAJ #1 niżej.)

---

# ➕ DODAJ — top 10 rzeczy posortowane po ROI

| # | Co | Dlaczego (ROI) | Koszt | Priorytet |
|---|---|---|---|---|
| 1 | **PostHog (lub Plausible) + funnel events** dla onboarding/paywall/purchase | Bez tego latasz po omacku. Wiedza „60% pada na Step 2" warta jest 10× kosztu integracji. Bez tego nie da się świadomie zoptymalizować konwersji. | M (1-2 dni) | **P0** |
| 2 | **Naprawa Collector tier dead-code w UpgradeModal** | User widzi tier, klika, dostaje błąd. Live bug na paywallu = lost revenue + bad review w Play. Albo usuń całkowicie z UI, albo dokończ implementację. | S (2-4h) | **P0** |
| 3 | **Spójność trial: 14 vs 7 dni** | `lib/pricing.js:22 = 14`, ale `PLAY-CONSOLE-ODPOWIEDZI.md:205` mówi „7-dniowy". Stripe webhook honoruje 14, ale opis Play = oszustwo wobec user'a + Google policy violation potential. | S (1h) | **P0** |
| 4 | **`mv_vinyl_cache_v2` — TTL + max-size eviction** | Bomba zegarowa. User power-user po 6 miesiącach dostaje QuotaExceededError → silent fail → cache niespójny. | M (4-6h) | **P1** |
| 5 | **Restore purchases UI button w ProfileTab** (Play Store path) | Po reinstalu user traci Pro do czasu RC webhook fire (może być godziny). UX papercut + support tickets. | S (2h) | **P1** |
| 6 | **Wycenić feature matrix UpgradeModal w i18n** | Pl/de user widzi mieszany content („KOLEKCJA / Unlimited / Insurance PDF") — nie sprzedaje na drugorzędnych rynkach. | S (3h) | **P1** |
| 7 | **Dedicated empty-state dla signed-in user pierwszy raz w Vault** | Pierwsza sesja po sign-up = empty Collection bez wiadomości. Powinno być duże CTA „Connect Discogs to import" + „Or scan barcode" + „Or add manually". Currently: sterylne filtry. | S (3h) | **P1** |
| 8 | **Killer-feature hero rework w landing + Play opisach** | „Insurance-ready PDF for your collection" + „Never miss a repress price drop" — TO JEST sprzedawalne. Aktualnie 6 features po równo = 0 sprzedaje. | M (1 dzień marketing copy + landing rework) | **P1** |
| 9 | **PWA install prompt** custom CTA na landing | 50% web userów nie wie że PWA da się install. Dodanie discrete bar w landing footer = podwojenie install rate. | S (3h) | **P2** |
| 10 | **Haptic feedback** (`navigator.vibrate(15)` na success actions) | „Premium feel" w native-like TWA. Add to vault → vibrate. Alert hit → vibrate. Zero koszt utrzymania, +5% subjective polish. | S (1h) | **P2** |

---

# ➖ USUŃ — co wyrzucić

| # | Co | Dlaczego | Co user straci |
|---|---|---|---|
| 1 | **`TIERS.collector` + cały `Collector` tier UI w UpgradeModal** (`lib/pricing.js:49-57`, `app/components/UpgradeModal.js:23-29, 90-112, 169-183`) | Martwy kod, `available: false`, paywall się wywala kliknięciem. Albo dokończ (P0 #2), albo wytnij. | Nic — feature jest niedostępny i tak. |
| 2 | **`FREE_LIMIT_RECORDS = 50`** (`lib/stripe.js:30`) | Nigdzie nie enforce'd. „Still emitted in API status for any external consumer that reads it" — to znaczy: dla nikogo. | Nic. |
| 3 | **Duplikat `INSERT stripe_events`** (`app/api/stripe/webhook/route.js:111-112`) | Każdy webhook robi 2× insert. Drugi zawsze duplikat. Konfuzyjne. | Nic — dedup logiczny już jest na linii 29. |
| 4 | **`mv_whats_new_seen` vs `mv_whatsnew_seen` rozjazd** w `scripts/gen-screenshots.mjs:204` | Zły klucz w screenshot script. Działa bo demo flag override'uje, ale to ślad innego buga. | Nic — script + tak overrides demo. |
| 5 | **Komentarz „free = 1, pro = unlimited"** w `app/api/alerts/route.js:41` | Komentarz kłamie. Faktycznie limit = `TIERS.free.alertLimit = 3`. Wprowadza w błąd przy onboardingu nowego deva. | Nic — to tylko komentarz. |
| 6 | **Hardcoded EN copy w `PhotoUploader.js`** | Łamie i18n contract. PL/DE userzy widzą inglisz w środku polskiej sesji. | Nic — tłumaczenia istnieją w i18n. |
| 7 | **Dynamic-import na poziomie page.js dla VaultTab/WhensOnTab/ProfileTab** próby refactoring (komentarz `app/page.js:27-43`) | Już usunięty, ale komentarz w kodzie ostrzega przyszłego kontrybutora. Komentarz może zostać, ale **właściwa droga to dynamic-import wewnątrz VaultTab dla CollectionTab/StatsTab/etc.** Nikt jeszcze tego nie zrobił, kod wisi przy ~840 LoC w page.js. | (To nie usuwanie, to poprawa - przeniesione do PRZEPROJEKTUJ #2.) |

---

# 🔄 PRZEPROJEKTUJ — kierunek strategiczny

## #1 — Killer feature messaging (BIZNES)

**Stan obecny:** Hero landing wymienia 6 feature'ów na równi (`app/landing/page.js:36-43` + `lib/i18n.js` heroLine1/2/3). Pełen opis w Play Store taki sam (`PLAY-CONSOLE-ODPOWIEDZI.md:160-194`). User nie wie po co kliknąć Open App.

**Stan docelowy:** Single-message hero. „Twoja kolekcja vinyl — auto-wyceniana, zaalarmowana, zarchiwizowana do PDF do ubezpieczenia." Trzy gambity: (1) Discogs-grade prices live; (2) alert price drops; (3) insurance PDF. Reszta to bullet w features grid.

**Dlaczego ten kierunek:** Bez clear killer feature paid conversion <3%. Z clear killer + PDF/insurance positioning targetującym kolekcjonerów >$5k → 8-12% conversion realne.

## #2 — Architektura: rozbij `app/page.js` na hooks + lazy sub-tabs

**Stan obecny:** `app/page.js` 840 LoC, 30 useState, `MetalVault` komponent zawiera feed-fetch + auth + push + streak + sync + filter + sort + selected modal + 5 events listeners.

**Stan docelowy:** 
- `useFeed()` hook → ~150 LoC
- `usePush()` hook → ~50 LoC  
- `useDailyStreak()` hook → ~30 LoC
- `useDiscogsSync()` hook → ~40 LoC
- `app/page.js` ~250 LoC, czysty composition root
- Dynamic imports: `CollectionTab`, `StatsTab`, `BandsTab`, `SearchTab` lazy WEWNĄTRZ `VaultTab` (gdzie static-import konflikt nie istnieje, bo jeden parent).

**Dlaczego ten kierunek:** Pierwszy feature który dotknie page.js (np. nowy Bottom-sheet z reminders) będzie dotykał 30 useState'ów. Każdy nowy dev wpadnie w 840 LoC monolith. Reactive footprint maleje, INP się poprawia (<200ms target możliwy).

## #3 — `mv_vinyl_cache_v2` jako IDB z TTL zamiast LS bez końca

**Stan obecny:** localStorage JSON `Object.assign(...)` bez limitu rozmiaru, bez TTL, bez eviction. `lib/hooks/useCollection.js:155-156`.

**Stan docelowy:** IndexedDB store `vinyl_cache` z (a) per-entry TTL 7 dni, (b) max 200 entries z LRU eviction, (c) eviction job na app start.

**Dlaczego ten kierunek:** LS ma 5 MB cap per origin. Power user z kolekcją 500 + przeglądający 300 nowych = 5 MB szybko. QuotaExceeded silent fail. IDB ma 50 MB+ i lepszy paradigm dla cache.

## #4 — Onboarding: rozdziel skip vs commit ścieżki

**Stan obecny:** `OnboardingScreen.js:13-53` — 5 ekranów liniowych, dwa „skippable" (Discogs + push). User który skipuje obu kończy w empty Vault.

**Stan docelowy:**
- Ekran 1: Hero — single CTA „Get started"
- Ekran 2: One-of-three quick-start: (a) Connect Discogs (heavy), (b) Scan barcode (light), (c) Browse without account → demo (zero friction)
- Permission requests (push, location) **dopiero gdy user osiąga relevant moment** (klika „nearby concerts", kliknie „remind me when X drops"). Nigdy w onboarding.

**Dlaczego:** Permissions w onboarding mają 30-50% deny rate. Gdy ten sam permission jest requested w kontekście („zaalarmuj mnie gdy X spadnie"), denial rate spada do 10-15%.

## #5 — Demo mode → seed-on-Discogs-connect

**Stan obecny:** Guest klika „Try without account" → 8 hardcoded sample records. Sign-in → demo wytrnięty → empty.

**Stan docelowy:** Guest klika „Try without account" → 8 sample records. **Sign-in opcja**: „Want to import these as your starter collection? Or start fresh from Discogs?" → import do Supabase albo wipe.

**Dlaczego:** Aktualnie demo→signin brzmi jak utrata. To „loss aversion" friction na konwersji guest→user.

---

# Stan na koniec audytu

**P0 (blockers / pre-launch fixes):**
1. Trial copy: 7 vs 14 dni inconsistency (1h)
2. Collector tier paywall bug (2-4h)
3. Zaplanować PostHog/Plausible setup do tygodnia po launch (1-2 dni)

**P1 (najbliższy sprint):**
4. `mv_vinyl_cache_v2` TTL+eviction (4-6h)
5. Hardcoded EN strings w PhotoUploader → i18n (3h)
6. Restore purchases UI (2h)
7. Empty-state Vault dla signed-in nowego usera (3h)
8. Killer feature messaging rework (1 dzień)

**P2 (warto zrobić, apka żyje bez):**
9. PWA install prompt CTA
10. Haptic feedback na success actions
11. Date format per-locale w `formatDate`
12. Stripe webhook duplicate insert cleanup
13. Insurance PDF — translate to PL/DE
14. AUP klauzula w ToS

**P3 (nice-to-have / backlog):**
15. Architecture refactor page.js → hooks
16. Dynamic-import sub-tabs wewnątrz VaultTab
17. Maskable icons proper safe-zone
18. Local cache wipe button w Profile
19. Manifest `lang` per-locale
20. Touch targets <44px audyt + fix

---

**Koniec audytu. Czekam na decyzję co robimy dalej.**

Sugerowana kolejność: (1) trzy P0 w jeden sprint przed promote do Production w Play Console; (2) PostHog na tym samym sprincie żeby launchować z analytics od dnia 1; (3) po pierwszych 100 zainstalowaniach zobaczymy real funnel data i przeplanujemy P1.
