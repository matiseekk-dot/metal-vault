# Last.fm setup — Metal Vault

Last.fm jest mostkiem do prawie każdego serwisu streamingowego —
**Apple Music** (przez darmowe iOS Shortcut albo apki Marvis/Soor),
**Tidal** (Last.fm ma direct integration), **YouTube Music**
(przez Web Scrobbler extension), **iTunes/Apple Music desktop**,
**Plex**, **VLC**. Jeden setup → coverage 5+ platform.

To 5-minutowa procedura.

---

## 1. Zarejestruj Last.fm Developer App (3 min)

### Jeśli **NIE MASZ** aplikacji jeszcze:

1. **https://www.last.fm/api/account/create**
2. Wypełnij formularz:

| Pole | Wartość |
|---|---|
| Application name | `Metal Vault` |
| Application description | `Sync scrobbles into Metal Vault collection` |
| Application homepage | `https://metal-vault-six.vercel.app` |
| Callback URL | `https://metal-vault-six.vercel.app/api/lastfm/callback` |

3. **Submit application**
4. Last.fm pokaże stronę z 2 stringami — **zachowaj oba**:
   - **API Key** — zaczyna się literami i cyframi
   - **Shared Secret** — drugi string

### Jeśli **MASZ** już aplikację:

1. **https://www.last.fm/api/accounts** (zaloguj się jeśli nie)
2. Kliknij swoją apkę → szczegóły
3. Skopiuj **API Key** + **Shared Secret**
4. **Sprawdź Callback URL** — musi być **dokładnie**:
   ```
   https://metal-vault-six.vercel.app/api/lastfm/callback
   ```
   Jeśli puste lub inne — kliknij **Edit** → wpisz powyższy URL → Save.

---

## 2. Vercel Environment Variables (1 min)

1. **https://vercel.com/dashboard** → projekt **metal-vault**
2. Settings → **Environment Variables**
3. Dodaj **dwie** zmienne (Production + Preview zaznaczone dla obu):

| Name | Value |
|---|---|
| `LASTFM_API_KEY` | `<API Key z kroku 1>` |
| `LASTFM_SECRET` | `<Shared Secret z kroku 1>` |

⚠️ **Sprawdź czy `LASTFM_API_KEY` już istnieje** — używamy go też dla
artist bio/similar w innych miejscach. Jeśli artist info działa to
ten klucz jest. Wtedy dodaj tylko `LASTFM_SECRET`.

4. **Save** dla każdej.
5. Deployments → ostatni deploy → ⋮ → **Redeploy** → potwierdź.

Vercel rebuilduje (~1-2 min).

---

## 3. Apply migrację Supabase

W **Supabase Dashboard** → SQL Editor → wykonaj:

```sql
-- supabase/migrations/032_lastfm_tokens.sql
CREATE TABLE IF NOT EXISTS lastfm_tokens (
  user_id        uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  session_key    text NOT NULL,
  username       text NOT NULL,
  last_synced_at timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE lastfm_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Own lastfm token" ON lastfm_tokens;
CREATE POLICY "Own lastfm token"
  ON lastfm_tokens FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

(albo otwórz `supabase/migrations/032_lastfm_tokens.sql` z repo i
skopiuj cały plik).

---

## 4. Test

1. Otwórz Metal Vault → **Profil** (zalogowany)
2. Scrolluj do karty **„LAST.FM AUTO-LISTEN"**
3. Klik **POŁĄCZ LAST.FM**
4. Last.fm pyta „Do you authorize Metal Vault to access your account?"
5. Klik **Yes, allow access**
6. Wracasz do Metal Vault — toast „✓ Last.fm połączone"
7. Karta pokazuje teraz **„Połączono jako: <twoja-nazwa>"**
8. Klik **SYNCHRONIZUJ**
9. Toast pokazuje wynik:
   - „X nowych odsłuchów ✓" (gdy znalazł albumy z Twojej kolekcji w scrobblach)
   - „Jeszcze brak nowych dopasowań — scrobbluj dalej!" (gdy nikt z scrobbli nie matchuje kolekcji)

---

## 5. Jak scrobblować z Apple Music / innych platform

### Apple Music (iOS)
1. **Marvis Pro** ($4.99 jednorazowo) — najlepsze
2. **Soor** — alternatywa
3. **iOS Shortcut „Auto-scrobble Apple Music"** — darmowe, ale clunky

Każda apka ma sekcję „Scrobbling" → wpisz Last.fm credentials → all listens auto-scrobble.

### Apple Music (macOS)
**iTunes/Music app** ma natywny Last.fm support: Last.fm scrobbler app
z ich strony.

### Tidal
**https://www.last.fm/about/trackmymusic** → Tidal sekcja → klik
**Connect** → już.

### YouTube Music
**Web Scrobbler** Chrome extension —
https://chromewebstore.google.com/detail/web-scrobbler/hhinaapppaileiechjoiifaancjggfjm

### Plex
**PlexAmp** ma natywny Last.fm w settings, albo **Tautulli** plugin.

### Spotify
Nie potrzebujesz — masz już osobną integrację Spotify w apce.

---

## 6. Match logic — co matchuje a co nie

`/api/lastfm/sync` pull'uje ostatnie 200 scrobbli (Last.fm cap) i
matchuje przez **normalised (artist, album)**:
- case-insensitive
- strip remaster/reissue/deluxe suffixes
- strip Discogs disambiguation `(2)` etc.
- pierwszy artysta jeśli kolaboracja

**Match przykład:** scrobble „Mastodon — Crack the Skye (Reissue)" →
norm: `mastodon::crack the skye` → match z item `Mastodon · Crack The Skye`.

**Nie zmatchuje:**
- albumy których **nie masz w kolekcji** (nie ma do czego przypisać listen log)
- single tracks bez album metadata
- nazwy z literówkami

---

## 7. Cost ceiling

Last.fm API jest **darmowe i bez limitów** dla read methods.
`user.getRecentTracks` można wołać bez throttle. Zero kosztów per
user, niezależnie od skali.

---

## TL;DR

1. https://www.last.fm/api/accounts → API Key + Shared Secret
2. Vercel → Env Variables → `LASTFM_API_KEY` + `LASTFM_SECRET`
3. Redeploy
4. Supabase → SQL Editor → zaaplikuj `032_lastfm_tokens.sql`
5. Profile → POŁĄCZ LAST.FM → Authorize → SYNCHRONIZUJ
