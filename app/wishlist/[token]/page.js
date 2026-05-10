// ── /wishlist/[token] — public share page ──────────────────────
//
// Server component — Open Graph + Twitter card meta render with the
// wishlist's name + first cover, so when a user pastes the share
// link on Facebook / Discord / Messenger they get a proper preview
// instead of a naked URL.
//
// No auth required. Loads via the public-readable share endpoint
// which respects is_public on the wishlist row.

import { headers } from 'next/headers';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

async function fetchWishlist(token, baseUrl) {
  try {
    const r = await fetch(baseUrl + '/api/wishlists/share/' + encodeURIComponent(token), {
      cache: 'no-store',
    });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

async function resolveBaseUrl() {
  // Prefer the env var — works at build time AND request time, no
  // request-context dependency. headers() is only safe inside a
  // dynamic request scope, and during Vercel build it can throw
  // ("dynamic context not available") even with force-dynamic on
  // the page, because generateMetadata may be evaluated for OG
  // pre-flight. Wrapped in try so a missing context falls back to
  // the canonical URL.
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  if (process.env.VERCEL_URL)         return 'https://' + process.env.VERCEL_URL;
  try {
    const h = await headers();
    const host = h.get('host') || 'localhost:3000';
    const proto = h.get('x-forwarded-proto') || 'http';
    return proto + '://' + host;
  } catch {
    return 'http://localhost:3000';
  }
}

export async function generateMetadata({ params }) {
  // Defensive: if anything throws (no request context during a Vercel
  // build sweep, Supabase env missing, network) we still want the page
  // to render. Falls back to a generic title so the route isn't a
  // hard build-blocker.
  try {
    const { token } = await params;
    const base = await resolveBaseUrl();
    const data = await fetchWishlist(token, base);
    if (!data?.wishlist) {
      return { title: 'Wishlist not found · Metal Vault' };
    }
    const name = data.wishlist.name || 'Wishlist';
    const owner = data.wishlist.owner_name ? ' · ' + data.wishlist.owner_name : '';
    const desc = data.wishlist.description
      || (data.items.length + ' albums · gift wishlist on Metal Vault');
    const ogImage = data.items.find(i => i.cover)?.cover || base + '/icons/icon-512.png';

    return {
      title: name + owner + ' · Metal Vault',
      description: desc,
      openGraph: {
        title:       name + owner,
        description: desc,
        type:        'website',
        url:         base + '/wishlist/' + token,
        images:      [{ url: ogImage }],
      },
      twitter: {
        card:        'summary_large_image',
        title:       name + owner,
        description: desc,
        images:      [ogImage],
      },
    };
  } catch {
    return { title: 'Gift wishlist · Metal Vault' };
  }
}

export default async function WishlistSharePage({ params }) {
  const { token } = await params;
  const base = await resolveBaseUrl();
  const data = await fetchWishlist(token, base);

  if (!data?.wishlist) {
    return (
      <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#f0f0f0',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        fontFamily: 'monospace' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🎸</div>
          <div style={{ fontSize: 16, marginBottom: 8 }}>Wishlist not found</div>
          <div style={{ fontSize: 12, color: '#888' }}>
            The link may be invalid, or the owner made the list private.
          </div>
          <Link href="/" style={{ display: 'inline-block', marginTop: 24, color: '#dc2626',
            textDecoration: 'none', fontSize: 12 }}>
            ← Open Metal Vault
          </Link>
        </div>
      </div>
    );
  }

  const { wishlist, items } = data;
  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#f0f0f0',
      fontFamily: 'monospace', padding: 16, maxWidth: 720, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ borderBottom: '1px solid #222', paddingBottom: 16, marginBottom: 20 }}>
        <Link href="/" style={{ color: '#dc2626', textDecoration: 'none', fontSize: 12,
          letterSpacing: '0.18em', textTransform: 'uppercase' }}>
          🎸 Metal Vault
        </Link>
        <h1 style={{ fontSize: 28, margin: '12px 0 4px', fontFamily: '"Bebas Neue", sans-serif',
          letterSpacing: '0.04em' }}>
          {wishlist.name}
        </h1>
        {wishlist.owner_name && (
          <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>
            by {wishlist.owner_name}
          </div>
        )}
        {wishlist.description && (
          <div style={{ fontSize: 13, color: '#bbb', lineHeight: 1.5, marginTop: 8 }}>
            {wishlist.description}
          </div>
        )}
        <div style={{ fontSize: 11, color: '#666', marginTop: 10 }}>
          {items.length} {items.length === 1 ? 'album' : 'albums'}
        </div>
      </div>

      {/* Items */}
      {items.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 16px', color: '#888', fontSize: 13 }}>
          This wishlist is empty.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {items.map(it => {
            // Wrap each row in <a> only if discogs_url is present —
            // otherwise the row stays a plain div (still renders fine).
            const hasLink = !!it.discogs_url;
            const Wrap = hasLink ? 'a' : 'div';
            const wrapProps = hasLink
              ? { href: it.discogs_url, target: '_blank', rel: 'noopener noreferrer' }
              : {};
            return (
              <Wrap key={it.id} {...wrapProps}
                style={{
                  display: 'grid', gridTemplateColumns: '60px 1fr', gap: 12,
                  padding: 12, background: '#111', border: '1px solid #222',
                  borderRadius: 10, textDecoration: 'none', color: 'inherit',
                  alignItems: 'center',
                }}>
                {it.cover ? (
                  <img src={it.cover} alt={it.artist}
                    style={{ width: 60, height: 60, borderRadius: 6, objectFit: 'cover',
                      border: '1px solid #333' }}/>
                ) : (
                  <div style={{ width: 60, height: 60, borderRadius: 6, background: '#1a1a1a',
                    border: '1px solid #333', display: 'flex', alignItems: 'center',
                    justifyContent: 'center', fontSize: 24 }}>💿</div>
                )}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 16, fontFamily: '"Bebas Neue", sans-serif',
                    letterSpacing: '0.04em',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {it.artist}
                  </div>
                  <div style={{ fontSize: 12, color: '#888', marginTop: 2,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {it.album}
                  </div>
                  {it.notes && (
                    <div style={{ fontSize: 11, color: '#f97316', marginTop: 4, lineHeight: 1.4 }}>
                      📝 {it.notes}
                    </div>
                  )}
                </div>
              </Wrap>
            );
          })}
        </div>
      )}

      {/* Footer CTA */}
      <div style={{ marginTop: 32, padding: 16, background: '#0d1f3a',
        border: '1px solid #3b82f644', borderRadius: 10, textAlign: 'center' }}>
        <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>
          Build your own wishlist
        </div>
        <Link href="/" style={{ display: 'inline-block', padding: '10px 20px',
          background: '#dc2626', color: '#fff', textDecoration: 'none',
          borderRadius: 8, fontSize: 13, letterSpacing: '0.06em' }}>
          OPEN METAL VAULT
        </Link>
      </div>
    </div>
  );
}
