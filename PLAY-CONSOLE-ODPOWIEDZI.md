# Play Console — gotowe odpowiedzi do przeklejenia

Skondensowany ściągawka do formularzy w Play Console. Wszystko po
polsku gdzie da się, **z wyjątkiem treści listingu (Nazwa, opisy,
tagi)** które zostają po angielsku — Default language to `en-US`,
więc to są wartości default dla całego świata. Polska wersja
listingu doinaisz potem przez „Inne języki" jeśli chcesz.

⚠️ **Ważne**: zaznaczasz na każdym kroku **Zapisz** — Play Console
nie auto-saveuje.

---

## 1. Utwórz aplikację

| Pole | Wartość |
|---|---|
| Nazwa aplikacji | `Metal Vault` |
| Nazwa pakietu | `pl.skudev.metalvault` |
| Język domyślny | `angielski (Stany Zjednoczone) – en-US` |
| Aplikacja czy gra | Aplikacja |
| Bezpłatna czy płatna | **Bezpłatne** |
| Deklaracje (4 checkboxy) | wszystkie zaznaczone |

---

## 2. Zawartość aplikacji

### 2.1 Polityka prywatności

```
https://metal-vault-six.vercel.app/legal/privacy.html
```

### 2.2 Dostęp do aplikacji

Zaznacz: **„Cała funkcjonalność jest dostępna bez specjalnych dostępów"**.

(Dzięki nowemu trybowi demo recenzent Google nie potrzebuje
credentials — może kliknąć „Try without account" na landing page i
od razu widzi pełną aplikację z przykładową kolekcją.)

W polu „Instrukcje" wklej:

```
This app supports a guest/demo mode. To review functionality:
1. Open the app — you land on the marketing landing page.
2. Tap "Try without account" (outlined button next to the primary CTA).
3. The full app loads with a sample metal vinyl collection
   (8 records, 2 watchlist items, 3 followed artists).
4. All tabs work: Vault → Collection / Watchlist / Bands / Search /
   Stats. Calendar → Calendar / Live / Concerts. Feed shows real
   upcoming releases from Discogs + MusicBrainz.

No login is required to evaluate the app's core experience.
Authentication (Google OAuth or email magic-link) is optional and
unlocks cross-device sync via Supabase.
```

### 2.3 Reklamy

**Nie, moja aplikacja nie zawiera reklam.**

### 2.4 Klasyfikacja treści

Kategoria: **Materiały referencyjne, wiadomości lub edukacyjne**

| Pytanie | Odpowiedź |
|---|---|
| Przemoc | Brak |
| Seksualność | Brak |
| Wulgaryzmy | Brak |
| Narkotyki / alkohol / tytoń | Brak |
| Hazard | Brak |
| Treści tworzone przez użytkowników | **Tak** (notatki w kolekcji) |
| Funkcje społecznościowe | Brak |
| Dane osobowe | **Tak** (email, ceny, zdjęcia płyt) |
| Internet | Tak |
| Treści wrażliwe | Brak |

Oczekiwany wynik: **Dla każdego** (wszystkie regiony)

### 2.5 Grupa docelowa

- Wiek: **13+**
- Aplikacja dla dzieci: **Nie**

### 2.6 Aplikacja informacyjna

**Nie**

### 2.7 COVID-19 / contact tracing

Pomiń (przycisk „Pomiń" lub po prostu nie dotykaj)

### 2.8 Bezpieczeństwo danych

**Sekcja 1 — pytania ogólne:**

| Pytanie | Odpowiedź |
|---|---|
| Czy aplikacja zbiera lub udostępnia jakiekolwiek wymagane dane użytkownika? | **Tak** |
| Czy wszystkie dane są szyfrowane podczas przesyłania? | **Tak** |
| Czy zapewniasz sposób na żądanie usunięcia danych? | **Tak** |

**Sekcja 2 — typy danych:**

Zaznacz **TYLKO te** kategorie (resztę zostaw odznaczone):

| Kategoria | Konkretny typ | Zbierane | Udostępniane | Przeznaczenie | Wymagane / Opcjonalne |
|---|---|---|---|---|---|
| Dane osobowe | Adres e-mail | ✅ | ❌ | Zarządzanie kontem + Funkcje aplikacji | Wymagane |
| Zdjęcia i filmy | Zdjęcia | ✅ | ❌ | Funkcje aplikacji | Opcjonalne |
| Pliki i dokumenty | Pliki i dokumenty | ✅ | ❌ | Funkcje aplikacji | Opcjonalne |
| Aktywność w aplikacji | Interakcje z aplikacją | ✅ | ❌ | Analityka | Wymagane |
| Informacje o aplikacji i jej działaniu | Dzienniki awarii | ✅ | ❌ | Analityka | Wymagane |
| Informacje o aplikacji i jej działaniu | Diagnostyka | ✅ | ❌ | Analityka | Wymagane |
| Identyfikatory urządzenia lub inne | Identyfikator urządzenia | ✅ | ❌ | Analityka | Wymagane |

**Nie zaznaczaj:** Lokalizacji, Informacji finansowych, Zdrowia,
Wiadomości, Kontaktów, Historii internetu, Audio, Kalendarza,
Treści wrażliwych.

### 2.9 Aplikacja rządowa

**Nie**

### 2.10 Funkcje finansowe

**Nie**

### 2.11 Zdrowie

**Nie**

---

## 3. Główna strona aplikacji w sklepie

### 3.1 Szczegóły (po angielsku — Default language en-US)

**Nazwa aplikacji:**
```
Metal Vault
```

**Krótki opis (max 80 znaków):**
```
Track, value, and document your metal vinyl collection. Insurance-ready PDFs.
```

**Pełny opis (max 4000 znaków):**
```
🤘 Built by a metal collector, for metal collectors.

Metal Vault is the vinyl tracking app I always wanted but couldn't find. Whether your collection is 50 records or 5,000, Metal Vault helps you track what you own, watch what you want, document what's valuable, and never miss a repress.

━━━━━━━━━━━━━━━━━━━━━━━━━━

⚡ FREE FEATURES

📀 Collection tracking
• Add records via Discogs sync, barcode scan, or manual entry
• Track condition, purchase price, and personal notes
• Filter by genre, decade, format, owned/wanted

🎯 Smart watchlist
• Save records you want to buy
• Get notified when prices drop on Discogs
• See current value of records in your collection

📸 Barcode scanner
• Scan vinyl barcodes to instantly add records
• Works offline at record fairs (when you've synced once)
• Discogs lookup falls back to MusicBrainz

📅 Release calendar
• Browse upcoming metal releases (Discogs + MusicBrainz)
• Follow artists to filter the feed
• Get push notifications on release day

🎫 Concert tracker (Live)
• See upcoming shows from artists you follow (Ticketmaster)
• Log concerts you've attended (your personal gig diary)
• Filter by distance from your location

📊 Stats + Persona
• Collection value, gain/loss, completionist score
• Auto-generated "metal persona" — share as Instagram Story
• Genre breakdown, era distribution, top labels

🌍 3 languages: English / Polski / Deutsch
💱 3 currencies: USD / EUR / PLN (live ECB rates)

━━━━━━━━━━━━━━━━━━━━━━━━━━

⭐ PRO FEATURES (optional)

• Unlimited price alerts (free tier: 1 alert)
• 30-day price history charts
• Insurance-ready PDF reports for your collection
• Concert proximity scoring (festivals + tours)
• Priority support

7-day free trial, then €4.99/month or €49/year. Cancel anytime.

━━━━━━━━━━━━━━━━━━━━━━━━━━

🔒 Privacy first
• No third-party ads, ever
• Email + collection data stored on Supabase (EU servers)
• Photos are yours — we never re-share them
• Full account deletion at any time
• Read the privacy policy: metal-vault-six.vercel.app/legal/privacy.html

━━━━━━━━━━━━━━━━━━━━━━━━━━

Built with ❤️ in Poland by a fellow metal head.
Try it without an account — tap "Try without account" on the landing page to explore with sample records.

🤘 Stay heavy.
```

### 3.1.PL Polska wersja listingu (po dodaniu „Polski (Polska) – pl-PL")

**Nazwa aplikacji:**
```
Metal Vault
```

**Krótki opis (max 80 znaków):**
```
Śledź, wyceniaj i dokumentuj swoją kolekcję metalowych winyli. PDF do ubezpieczenia.
```

**Pełny opis (max 4000 znaków):**
```
🤘 Stworzona przez kolekcjonera metalu — dla kolekcjonerów metalu.

Metal Vault to aplikacja do śledzenia winyli, której zawsze szukałem i nigdy nie znalazłem. Czy masz 50 płyt czy 5 000, Metal Vault pomaga monitorować to co masz, obserwować to czego pragniesz, dokumentować to co cenne — i nigdy nie przegapić wznowienia.

━━━━━━━━━━━━━━━━━━━━━━━━━━

⚡ FUNKCJE BEZPŁATNE

📀 Śledzenie kolekcji
• Dodawaj płyty przez sync z Discogs, skanowanie kodu kreskowego lub ręcznie
• Zapisuj stan, cenę zakupu i osobiste notatki
• Filtruj po gatunku, dekadzie, formacie, posiadane / pożądane

🎯 Sprytna watchlista
• Zapisuj płyty które chcesz kupić
• Otrzymuj powiadomienia gdy ceny spadną na Discogs
• Sprawdzaj aktualną wartość płyt z Twojej kolekcji

📸 Skaner kodów kreskowych
• Zeskanuj kod kreskowy z winyla i dodaj go natychmiast
• Działa offline na giełdach płytowych (po pierwszej synchronizacji)
• Lookup Discogs z fallbackiem na MusicBrainz

📅 Kalendarz premier
• Przeglądaj nadchodzące metalowe premiery (Discogs + MusicBrainz)
• Obserwuj artystów, żeby filtrować feed
• Otrzymuj push notifications w dniu premiery

🎫 Tracker koncertów (Live)
• Sprawdzaj nadchodzące koncerty obserwowanych artystów (Ticketmaster)
• Loguj koncerty, na których byłeś (osobisty dziennik gigów)
• Filtruj po odległości od Twojej lokalizacji

📊 Statystyki + Persona
• Wartość kolekcji, zysk/strata, completionist score
• Auto-generowana „metalowa persona" — udostępnij jako Instagram Story
• Rozkład gatunków, dekady, top wytwórnie

🌍 3 języki: English / Polski / Deutsch
💱 3 waluty: PLN / EUR / USD (kursy live z ECB)

━━━━━━━━━━━━━━━━━━━━━━━━━━

⭐ FUNKCJE PRO (opcjonalne)

• Nielimitowane alerty cenowe (free tier: 1 alert)
• Wykresy historii cen z 30 dni
• Raporty PDF do ubezpieczenia kolekcji
• Scoring bliskości koncertów (festiwale + trasy)
• Wsparcie priorytetowe

7-dniowy bezpłatny okres próbny, później 19,99 zł/miesiąc lub 199 zł/rok. Możesz anulować w każdej chwili.

━━━━━━━━━━━━━━━━━━━━━━━━━━

🔒 Prywatność na pierwszym miejscu
• Zero reklam stron trzecich, nigdy
• Email + dane kolekcji na serwerach Supabase (UE)
• Twoje zdjęcia są Twoje — nigdy ich nie udostępniamy
• Pełne usunięcie konta w każdej chwili
• Polityka prywatności: metal-vault-six.vercel.app/legal/privacy.html

━━━━━━━━━━━━━━━━━━━━━━━━━━

Stworzone z ❤️ w Polsce przez kolegę metalowca.
Wypróbuj bez konta — kliknij „Wypróbuj bez konta" na ekranie startowym, żeby zobaczyć aplikację z przykładową kolekcją.

🤘 Stay heavy.
```

### 3.1.DE Deutsche Listing-Version (nach Hinzufügen von „Deutsch – de-DE")

**App-Name:**
```
Metal Vault
```

**Kurzbeschreibung (max. 80 Zeichen):**
```
Verwalte, bewerte und dokumentiere deine Metal-Vinyl-Sammlung. PDFs für Versicherung.
```

**Vollständige Beschreibung (max. 4000 Zeichen):**
```
🤘 Von einem Metal-Sammler — für Metal-Sammler.

Metal Vault ist die Vinyl-Tracking-App, die ich immer wollte, aber nie gefunden habe. Egal ob deine Sammlung 50 oder 5.000 Platten umfasst — Metal Vault hilft dir nachzuhalten, was du besitzt, zu beobachten, was du willst, zu dokumentieren, was wertvoll ist, und nie wieder einen Repress zu verpassen.

━━━━━━━━━━━━━━━━━━━━━━━━━━

⚡ KOSTENLOSE FUNKTIONEN

📀 Sammlung verwalten
• Platten per Discogs-Sync, Barcode-Scan oder manuell hinzufügen
• Zustand, Kaufpreis und persönliche Notizen erfassen
• Nach Genre, Dekade, Format, eigen/gewünscht filtern

🎯 Intelligente Watchlist
• Platten speichern, die du kaufen willst
• Benachrichtigung bei Preissenkungen auf Discogs
• Aktuellen Wert deiner Sammlung jederzeit sehen

📸 Barcode-Scanner
• Vinyl-Barcodes scannen und sofort hinzufügen
• Funktioniert offline auf Plattenbörsen (nach einmaliger Sync)
• Discogs-Lookup mit MusicBrainz-Fallback

📅 Release-Kalender
• Kommende Metal-Releases durchstöbern (Discogs + MusicBrainz)
• Künstlern folgen, um den Feed zu filtern
• Push-Benachrichtigungen am Release-Tag

🎫 Konzert-Tracker (Live)
• Kommende Shows deiner gefolgten Künstler sehen (Ticketmaster)
• Besuchte Konzerte protokollieren (persönliches Gig-Tagebuch)
• Nach Entfernung von deinem Standort filtern

📊 Stats + Persona
• Sammlungswert, Gewinn/Verlust, Completionist-Score
• Automatisch generierte „Metal-Persona" — als Instagram-Story teilen
• Genre-Verteilung, Dekaden, Top-Labels

🌍 3 Sprachen: English / Polski / Deutsch
💱 3 Währungen: EUR / USD / PLN (Live-Kurse von der EZB)

━━━━━━━━━━━━━━━━━━━━━━━━━━

⭐ PRO-FUNKTIONEN (optional)

• Unbegrenzte Preisalarme (Free-Tier: 1 Alarm)
• 30-Tage-Preisverlaufsdiagramme
• Versicherungs-PDFs für deine Sammlung
• Konzert-Nähe-Scoring (Festivals + Touren)
• Bevorzugter Support

7 Tage kostenlos testen, danach 4,99 €/Monat oder 49 €/Jahr. Jederzeit kündbar.

━━━━━━━━━━━━━━━━━━━━━━━━━━

🔒 Privatsphäre zuerst
• Keine Drittanbieter-Werbung, niemals
• E-Mail + Sammlungsdaten auf Supabase (EU-Server)
• Deine Fotos gehören dir — wir teilen sie nie
• Vollständige Konto-Löschung jederzeit möglich
• Datenschutzrichtlinie: metal-vault-six.vercel.app/legal/privacy.html

━━━━━━━━━━━━━━━━━━━━━━━━━━

Mit ❤️ in Polen von einem Metalhead gebaut.
Probiere es ohne Konto — tippe auf „Try without account" auf der Landing-Page, um die App mit Beispiel-Sammlung zu erkunden.

🤘 Stay heavy.
```

### 3.2 Grafika

| Element | Plik (od Twojego repo) |
|---|---|
| Ikona aplikacji 512×512 | `public/icons/icon-512.png` |
| Grafika promocyjna 1024×500 | `launch-marketing/assets/feature-1024x500.png` |
| Zrzuty ekranu EN (6 sztuk) | `public/screenshots/en/01-feed.png` … `06-stats-persona.png` |
| Zrzuty ekranu PL (6 sztuk, dla pl-PL) | `public/screenshots/pl/01-feed.png` … `06-stats-persona.png` |
| Zrzuty ekranu DE (6 sztuk, dla de-DE) | `public/screenshots/de/01-feed.png` … `06-stats-persona.png` |

Zrzuty z tabletu / Chromebooka — pomiń.

⚠️ **Ważne:** w Play Console zrzuty ekranów uploadujesz osobno per
locale. Default (en-US) używa zrzutów z folderu `en/`, a po
dodaniu polskiej / niemieckiej wersji listingu (Settings →
Manage translations) odpowiednio z `pl/` i `de/`. To gwarantuje,
że użytkownik widzi UI w swoim języku już w sklepie.

### 3.3 Kategoryzacja

| Pole | Wartość |
|---|---|
| Kategoria główna aplikacji | **Muzyka i dźwięk** |
| Tagi (max 5) | `music`, `vinyl`, `collector`, `metal`, `discogs` |
| E-mail kontaktowy | (Twój email kontaktu — może być prywatny lub np. `hello@metal-vault.app`) |
| Telefon | zostaw puste |
| Witryna | `https://metal-vault-six.vercel.app` |
| Polityka prywatności | `https://metal-vault-six.vercel.app/legal/privacy.html` |

---

## 4. Wersja do testów wewnętrznych

### Wczytaj wersję

- Plik AAB: `C:/Users/kinga/Documents/GitHub/metal-vault-android/app-release-bundle.aab`
- Podpisywanie: **Użyj klucza wygenerowanego przez Google** ← zaznacz
- Nazwa wersji: `1.0.2`

**Informacje o wersji (release notes — max 500 znaków per locale):**

```
<en-US>
v1.0.2 — quality + onboarding pass
- Onboarding rebuilt as 3 steps with a "pick your path" picker
  (Discogs sync, barcode scan, or browse). Push permission moved
  to ask-on-first-alert.
- 7-day free trial (was 14) — matches the listing.
- Live cache cleanup (no more storage bloat over time).
- Haptic feedback on add / scan / alert.
- Locale-aware date formatting.
- Restore Purchases now works after reinstall.
</en-US>
<pl-PL>
v1.0.2 — jakość + nowe wprowadzenie
- Wprowadzenie przebudowane do 3 ekranów z wyborem ścieżki
  (sync Discogs, skan kodu, lub przeglądanie). Pytanie o
  powiadomienia push przeniesione do momentu pierwszego alertu.
- 7-dniowy okres próbny (było 14) — zgodne z opisem w sklepie.
- Sprzątanie lokalnego cache (kolekcja nie spuchnie po miesiącach).
- Wibracja przy dodawaniu / skanowaniu / alercie.
- Daty formatowane wg języka aplikacji.
- "Przywróć zakupy" działa poprawnie po reinstalu.
</pl-PL>
<de-DE>
v1.0.2 — Qualität + neues Onboarding
- Onboarding zu 3 Schritten umgebaut mit "wähle deinen Weg"
  (Discogs-Sync, Barcode-Scan, oder Stöbern). Push-Berechtigung
  wird jetzt erst beim ersten Preisalarm abgefragt.
- 7-Tage-Testversion (statt 14) — passt zur Store-Beschreibung.
- Lokaler Cache-Aufräumen (kein Speicher-Aufblähen mehr).
- Haptisches Feedback beim Hinzufügen / Scannen / Alarm.
- Datumsformat folgt der App-Sprache.
- "Käufe wiederherstellen" funktioniert nach Reinstall.
</de-DE>
```

### Po uploadzie — pobierz fingerprint'y

**Konfiguracja → Integralność aplikacji** — skopiuj dwa SHA-256:

1. **Certyfikat klucza podpisywania aplikacji** (Play App Signing) — kopiuj
2. **Certyfikat klucza przesyłania** (Upload Key) — kopiuj

**Wklej je tutaj w czacie**, ja uruchomię script który update'uje
`assetlinks.json` i pushuje. Albo lokalnie:

```bash
cd /c/Users/kinga/Documents/GitHub/metal-vault
KEYSTORE_PASS=$(cat ../metal-vault-android/KEYSTORE_PASSWORD.txt) \
  node scripts/update-assetlinks.mjs \
    --keystore ../metal-vault-android/android.keystore \
    --play-app-signing AB:CD:...64-hex... \
    --play-upload-key  12:34:...64-hex...
git add public/.well-known/assetlinks.json
git commit -m "chore(twa): add Play Console fingerprints"
git push
```

### Dodaj siebie jako tester wewnętrzny

- **Testerzy** → **Utwórz listę adresów e-mail** → nazwa: „Wewnętrzni"
- Dodaj swój Gmail
- Skopiuj **Adres URL dołączenia** → otwórz na phone (zalogowany na
  ten Gmail) → **Zostań testerem**
- Zainstaluj wersję z Play Store (z dopiskiem „(Beta)")

### Test na phone — checklist

| Sprawdź | OK? |
|---|---|
| Cold launch — splash + brak URL bara | |
| Landing page → „Wypróbuj bez konta" → demo collection widoczna | |
| Vault → Kolekcja: 8 płyt z cover'ami, cenami | |
| Vault → Stats → Persona widoczna | |
| Calendar → Kalendarz wydań ładuje się | |
| Hardware back zamyka overlay'e | |
| Logowanie Google działa | |
| Po zalogowaniu demo collection znika, real account ładuje się | |
| Push notifications enable w Profile → permission grant → push działa | |

Jeśli URL bar widoczny — fingerprint mismatch. Sprawdź że
`assetlinks.json` z 4. kroku zawiera 2 fingerprinty, redeploy
przeszedł, **wyczyść cache Chrome na phone** (Ustawienia → Aplikacje
→ Chrome → Pamięć → Wyczyść pamięć podręczną).

---

## 5. Promowanie do Produkcji

Po pomyślnym teście wewnętrznym:

1. **Testowanie zamknięte** (5-10 znajomych przez 3-7 dni) →
   wewnątrz zakładki Testowanie → Zamknięte testy → utwórz wersję
   przeciągając AAB → Promuj
2. **Testy otwarte** (opcjonalnie, publicznie joinable)
3. **Produkcja** → Lewy panel → Produkcja → Promuj wersję z testów
   zamkniętych

Recenzja Google na produkcję: typowo 1-7 dni.

---

## Częste powody odrzucenia + naprawy

| Co Google napisze | Co naprawić |
|---|---|
| „Aplikacja nie jest zaprojektowana głównie dla treści z internetu" | Standardowy zarzut do TWA. Odpowiedz przez „Skontaktuj się z zespołem" z linkiem do dokumentacji Bubblewrap + wskaż że Twoja aplikacja ma natywny scanner kodów kreskowych + push notifications + offline barcode lookup |
| „Polityka prywatności nie obejmuje wszystkich danych" | Tiki z 2.8 ≠ co mówi `/legal/privacy.html`. Sprawdź że polityka wymienia: email, photos, files, app interactions, crash logs, diagnostics, device IDs |
| „Aplikacja zawiera mylące treści" | Zrzuty ekranu nie pasują do tego co rzeczywiście robi aplikacja. Użyj tylko `public/screenshots/*.png` |
| URL bar widoczny w TWA | Bad fingerprint w assetlinks. Re-run `update-assetlinks.mjs` z **wszystkimi** kluczami, redeploy, wyczyść Chrome cache |

---

## Co po launchu

- **Sentry env vars w Vercel:** `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`,
  `SENTRY_AUTH_TOKEN` — bez nich crash reports nie działają
- **Resend env var:** `RESEND_API_KEY`, `FROM_EMAIL` — emailowe
  alerty i digesty
- **Każdy kolejny deploy:** bumpnij `appVersion` w
  `metal-vault-android/twa-manifest.json` → uruchom
  `bubblewrap update --skipVersionUpgrade && bubblewrap build` →
  upload nowy AAB do Internal track

---

## Skrót: 7 rzeczy które MUSISZ skończyć

1. ☐ Backup `android.keystore` + `KEYSTORE_PASSWORD.txt` na 2 nośniki
2. ☐ Sideload APK na phone, sprawdź że bez URL bara
3. ☐ Stwórz aplikację w Play Console (sekcja 1)
4. ☐ Wypełnij Zawartość aplikacji (sekcja 2 — wszystkie 11 podsekcji)
5. ☐ Wypełnij Główną stronę aplikacji (sekcja 3)
6. ☐ Upload AAB do Testów wewnętrznych + zaznacz „Klucz wygenerowany przez Google"
7. ☐ Po uploadzie pobierz 2 SHA-256 z Integralności aplikacji →
   wklej tutaj → ja uruchomię script
