# Play Console — przewodnik po pierwszej publikacji

Walkthrough dla pierwszego uploadu Metal Vault do Play Console.
**Etykiety pól po polsku** (UI Play Console w języku polskim), ale
**dane wpisywane do aplikacji zostają po angielsku** (App name,
descriptions, URLs) — bo Default language listingu to en-US.

Wymagania (już spełnione):
- ✅ Bubblewrap zbudowany: `app-release-bundle.aab`, `app-release-signed.apk`
- ✅ assetlinks.json z fingerprintem lokalnego keystore'a (deployed)
- ✅ Polityka prywatności: `/legal/privacy.html`
- ✅ Tekst listingu: `launch-marketing/04-play-store-listing.md`
- ✅ Feature graphic: `launch-marketing/assets/feature-1024x500.png`
- ✅ 6 zrzutów ekranu telefonu: `public/screenshots/0{1..6}-*.png`
- ✅ Ikona 512×512: `public/icons/icon-512.png`

Czego potrzebujesz:
- Konto Google Play Console ($25 jednorazowo)
- ~2-3h na pierwszy listing

---

## 1. Utwórz aplikację

Play Console → **„Utwórz aplikację"** (prawy górny róg).

| Pole (PL) | Wartość |
|---|---|
| Nazwa aplikacji | `Metal Vault` |
| Nazwa pakietu | `pl.skudev.metalvault` ⚠️ **NIE da się zmienić później** |
| Język domyślny | `angielski (Stany Zjednoczone) – en-US` |
| Aplikacja czy gra | **Aplikacja** |
| Bezpłatna czy płatna | **Bezpłatne** ← (Pro to in-app purchase, nie paid install) |
| Deklaracje dewelopera (4 pola wyboru) | Zaznacz wszystkie cztery |

→ **Utwórz aplikację**.

---

## 2. Zawartość aplikacji (lewy panel)

Lista wymaganych deklaracji. Po kolei od góry:

### 2.1 Polityka prywatności

- URL: `https://metal-vault-six.vercel.app/legal/privacy.html`
- **Zapisz**.

### 2.2 Dostęp do aplikacji

- Zaznacz: **„Cała lub niektóre funkcje są ograniczone"**
- Dodaj dane logowania dla recenzentów Google:
  - Login (email): `e2e@metal-vault.test` (test user który stworzyłeś
    w Supabase) ALBO osobne konto-recenzent
  - Hasło: hasło tego konta
  - Instrukcje logowania (skopiuj do textarea):
    ```
    Open the app → tap "Open App" → use the credentials below to
    log in. Magic-link via email is also supported but the test
    account has a password configured.
    ```
- **Zapisz**.

### 2.3 Reklamy

- **Nie, moja aplikacja nie zawiera reklam.** → **Zapisz**.

### 2.4 Klasyfikacja treści

Kliknij **„Rozpocznij kwestionariusz"**. Kategoria:
**Materiały referencyjne, wiadomości lub edukacyjne**.

| Pytanie | Odpowiedź |
|---|---|
| Przemoc | Brak |
| Seksualność | Brak |
| Wulgaryzmy | Brak |
| Narkotyki / alkohol / tytoń | Brak |
| Hazard | Brak |
| Treści tworzone przez użytkowników | **Tak** (notatki użytkowników w kolekcji) |
| Funkcje społecznościowe | Brak (nie ma czatu, feedu, DM) |
| Dane osobowe | **Tak** (email, ceny, zdjęcia płyt) |
| Internet | Tak |
| Treści wrażliwe | Brak |

Oczekiwany wynik: **Dla każdego** (Everyone) we wszystkich regionach.

### 2.5 Grupa docelowa

- Wiek: **13+**
- Aplikacje dla dzieci: **Nie**
- **Zapisz**.

### 2.6 Aplikacja informacyjna

- To **nie** jest aplikacja informacyjna. **Zapisz**.

### 2.7 COVID-19 / aplikacja śledząca kontakty

- Pomiń — to nie jest aplikacja contact-tracing.

### 2.8 Bezpieczeństwo danych

Najdłuższy formularz. Dokładne odpowiedzi dla Metal Vault:

**Zbieranie i udostępnianie danych:**

| Pytanie | Odpowiedź |
|---|---|
| Czy aplikacja zbiera lub udostępnia jakiekolwiek wymagane dane użytkownika? | **Tak** |
| Czy wszystkie dane zbierane przez aplikację są szyfrowane podczas przesyłania? | **Tak** (HTTPS przez Vercel) |
| Czy zapewniasz użytkownikom sposób na żądanie usunięcia ich danych? | **Tak** (Profil → Usuń konto; endpoint `/api/profile/delete` istnieje) |

**Typy danych:**

Zaznacz tylko te (po polsku Play Console):

- **Dane osobowe → Adres e-mail** — Zbierane, NIE udostępniane,
  cel: „Zarządzanie kontem" + „Funkcjonalność aplikacji"
- **Zdjęcia i filmy → Zdjęcia** — Zbierane, NIE udostępniane,
  cel: „Funkcjonalność aplikacji" (zdjęcia stanu płyt)
- **Pliki i dokumenty** — Zbierane, NIE udostępniane,
  cel: „Funkcjonalność aplikacji" (PDF do ubezpieczenia)
- **Aktywność w aplikacji → Interakcje z aplikacją** — Zbierane,
  NIE udostępniane, cel: „Analityka" (Sentry telemetry)
- **Informacje o aplikacji i jej działaniu → Dzienniki awarii** —
  Zbierane, NIE udostępniane, cel: „Analityka"
- **Informacje o aplikacji i jej działaniu → Diagnostyka** —
  Zbierane, NIE udostępniane, cel: „Analityka"
- **Identyfikatory urządzenia lub inne** — Zbierane, NIE
  udostępniane, cel: „Analityka" (Sentry session)

Dla każdego: zaznacz **„Wymagane"** (user nie może zrezygnować —
oprócz crash logs, jeśli chcesz być purystą zaznacz tam „Opcjonalne").

**NIE zaznaczaj:** Lokalizacji, Informacji finansowych (Stripe
tokenizuje karty, nigdy ich nie widzimy), Zdrowia, Wiadomości,
Kontaktów, Historii internetu, Audio, Kalendarza, Treści wrażliwych.

### 2.9 Aplikacja rządowa

- **Nie** — to nie jest aplikacja rządowa. **Zapisz**.

### 2.10 Funkcje finansowe

- **Nie** — Stripe przetwarza płatności poza aplikacją, my nie
  przechowujemy danych kart.

### 2.11 Zdrowie

- **Nie**.

---

## 3. Główna strona aplikacji w sklepie

Lewy panel → **„Główna strona aplikacji w sklepie"**.

### 3.1 Szczegóły aplikacji (zostają po angielsku — Default language to en-US)

| Pole | Wartość |
|---|---|
| Nazwa aplikacji | `Metal Vault` |
| Krótki opis (80 znaków) | `Track, value, and document your metal vinyl collection. Insurance-ready PDFs.` |
| Pełny opis (4000 znaków) | Skopiuj z `launch-marketing/04-play-store-listing.md` (sekcja „Full Description") |

### 3.2 Grafika

| Element | Plik |
|---|---|
| Ikona aplikacji (512×512) | `public/icons/icon-512.png` |
| Grafika promocyjna / Feature graphic (1024×500) | `launch-marketing/assets/feature-1024x500.png` |
| Zrzuty ekranu telefonu (1080×1920, min 2) | Wszystkie 6 z `public/screenshots/` |

Zrzuty z tabletu i Chromebooka — opcjonalne, **pomiń** dla pierwszego launchu.

### 3.3 Kategoryzacja

| Pole (PL) | Wartość |
|---|---|
| Kategoria aplikacji | **Muzyka i dźwięk** (główna), **Styl życia** (drugorzędna jeśli pyta) |
| Tagi | `music`, `vinyl`, `collector`, `metal`, `discogs` |
| E-mail kontaktowy | (Twój email dla kontaktu) |
| Telefon | (opcjonalne, zostaw puste) |
| Witryna | `https://metal-vault-six.vercel.app` |
| Polityka prywatności | `https://metal-vault-six.vercel.app/legal/privacy.html` |

**Zapisz**.

---

## 4. Testy wewnętrzne → upload pierwszego AAB

**Zalecana ścieżka**: Testy wewnętrzne → Testy zamknięte → Testy
otwarte → Produkcja. Każdy etap ma mniej recenzentów + szybszy
turnaround. Można od razu na produkcję, ale recenzje są wolniejsze
i odrzucenie cofa cały listing.

Lewy panel → **„Testowanie"** → **„Testy wewnętrzne"**.

### 4.1 Utwórz wersję

- **„Utwórz nową wersję"** (prawy górny róg)
- Podpisywanie: **„Użyj klucza wygenerowanego przez Google"** ← ZAZNACZ
  (Google's „Play App Signing" przechowuje ostateczny klucz; Twój
  lokalny keystore staje się wtedy *kluczem przesyłania*. To
  współczesna zalecana ścieżka.)
- Prześlij `metal-vault-android/app-release-bundle.aab` (drag-drop)
- Nazwa wersji: zostaw domyślną (będzie „1 (1.0.0)")
- Informacje o wersji (release notes, w textarea):
  ```
  Initial release.
  - Discogs sync, barcode scanner, Discogs price tracking
  - Vinyl listening tracker, persona, market alerts
  - 3 languages: English, Polish, German
  - Currency: USD / EUR / PLN
  ```

**Zapisz** → **„Sprawdź wersję"** → **„Rozpocznij wdrażanie do testów wewnętrznych"**.

### 4.2 ⚠️ POBIERZ FINGERPRINT'Y Z PLAY CONSOLE

Lewy panel → **„Konfiguracja"** → **„Integralność aplikacji"**.

Zobaczysz dwa SHA-256:

- **Certyfikat klucza podpisywania aplikacji** → SHA-256
  (to czym Play Store podpisuje końcowe APKi)
- **Certyfikat klucza przesyłania** → SHA-256
  (Twój `android.keystore` fingerprint, z którym Play Console
  oczekuje uploadów)

Skopiuj oba (colon-hex). Następnie lokalnie:

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

Albo wklej mi te dwa SHA tutaj — uruchomię script za Ciebie.

Po redeployu Vercel TWA przejdzie weryfikację digital asset link
dla wszystkich trzech tożsamości podpisywania.

### 4.3 Dodaj siebie jako tester wewnętrzny

Lewy panel (pod „Testy wewnętrzne") → **„Testerzy"** →
**„Utwórz listę adresów e-mail"** → nazwij ją „Testerzy wewnętrzni"
→ dodaj swój Gmail.

Następnie: skopiuj **„Adres URL dołączenia"** z sekcji „Jak testerzy
dołączają do testu" → otwórz na phone (zalogowany na ten sam Gmail)
→ **„Zostań testerem"**.

Po dołączeniu app pokaże się w Play Store z dopiskiem „(Beta)".
Możesz ją zainstalować jak normalną apkę — ta wersja podpisana
przez Play, otwiera się z launchera, dostaje Play Store auto-update.

### 4.4 Testowanie na phone

Zainstaluj wersję podpisaną przez Play. Sprawdź:

| Test | Oczekiwane |
|---|---|
| Cold launch — splash + brak URL bara | ✅ |
| Login (Twoje konto albo Discogs OAuth) | ✅ |
| Vault tab ładuje kolekcję | ✅ |
| Push notifications (Profil → włącz) działają | ✅ |
| Skaner kodów kreskowych otwiera kamerę | ✅ |
| Pull-to-refresh działa | (jeśli zaimplementowane) |
| Hardware back zamyka overlay'e, nie aplikację | ✅ |

Jeśli URL bar dalej widoczny: zazwyczaj fingerprint mismatch.
Sprawdź że plik z 4.2 ma wszystkie 3 fingerprint'y, i otwierasz
wersję ZE SKLEPU (nie sideload z wcześniej — tamta używa Twojego
lokalnego klucza).

---

## 5. Po sukcesie testów wewnętrznych

Promuj wewnętrzne → zamknięte → otwarte → produkcja (każda to
przycisk w tym samym sidebarze). Testy zamknięte wymagają podania
emaili testerów. Testy otwarte są publicznie joinable ale niski
priorytet recenzji.

Dla pierwszego launchu polecam:
1. **Wewnętrzne** przez 1-2 dni (sprawdź TWA na Play-signed APK)
2. **Zamknięte alpha** z 5-10 znajomymi przez 3-7 dni (real-world bugi)
3. **Produkcja** po inkorporowaniu feedbacku

---

## 6. In-app billing (opcjonalne, dla tier Pro)

Ważne tylko jeśli chcesz Pro kupowalne **z TWA**. Pomiń dla
pierwszego launchu jeśli sprzedajesz Pro tylko przez Stripe (web).

Wymagane jeśli sprzedajesz z TWA: Play Console → **„Monetyzacja"** →
**„Subskrypcje"** → utwórz produkty pasujące do SKU w `lib/payments.js`:
- `mv_pro_monthly`
- `mv_pro_yearly` (jeśli masz)

Następnie RevenueCat dashboard → linkuj produkt Play → skopiuj
public API key do `NEXT_PUBLIC_REVENUECAT_API_KEY` w Vercel env.

Ścieżka testowa udokumentowana w `BUBBLEWRAP.md` („In-app billing test").

---

## Cheatsheet — typowe powody odrzucenia

| Symptom | Przyczyna | Naprawa |
|---|---|---|
| „Twoja aplikacja nie jest zaprojektowana głównie dla treści z internetu" | Play czasem odrzuca TWA jako „za cienkie" | Dodaj 1+ natywną funkcję Android LUB odwołaj się z linkiem do dokumentacji Bubblewrap |
| „Polityka prywatności nie obejmuje wszystkich danych" | Tiki w Bezpieczeństwie danych ≠ co mówi privacy policy | Upewnij się że `/legal/privacy.html` wymienia każdy typ danych zaznaczony w 2.8 |
| „Aplikacja zawiera mylące treści" | Zrzuty ekranu nie pasują do tego co jest w aplikacji | Używaj tylko `public/screenshots/*.png` (kanoniczne) |
| URL bar widoczny | Zły fingerprint w assetlinks | Uruchom ponownie `update-assetlinks.mjs` z wszystkimi 3 kluczami, redeploy, wyczyść cache Chrome na phone |
| Test logowania nieudany (recenzent nie może się zalogować) | Konto testowe w sekcji Dostęp do aplikacji jest złe / zablokowane | Sprawdź że konto które wpisałeś istnieje w Supabase + można zalogować się hasłem |

---

## Po launchu

- Dodaj Sentry env vars (`SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`,
  `SENTRY_AUTH_TOKEN`) do Vercel — monitoring błędów
- Dodaj `RESEND_API_KEY` do Vercel — emailowe digesty
- Ustaw release notes w Play Console dla każdego kolejnego deployu
- Bumpnij `appVersion` w `metal-vault-android/twa-manifest.json` i
  uruchom `bubblewrap update --skipVersionUpgrade && bubblewrap build`
  żeby wyprodukować nowy AAB
