import { getAdminClient } from '@/lib/supabase-server';


const C = { bg: '#0a0a0a', bg2: '#141414', bg3: '#1e1e1e', border: '#2a2a2a', accent: '#dc2626', text: '#f0f0f0', muted: '#888' };
const BEBAS = { fontFamily: "'Bebas Neue', sans-serif" };
const MONO  = { fontFamily: "'Space Mono', monospace" };

export async function generateMetadata({ params }) {
  const { username } = await params;
  const { data: profile } = await getAdminClient()
    .from('profiles').select('display_name, username').eq('username', username).single();
  return { title: profile ? `${profile.display_name} · Metal Vault` : 'Metal Vault' };
}

export default async function PublicProfile({ params }) {
  const { username } = await params;
  const { data: profile } = await getAdminClient()
    .from('profiles')
    .select('*')
    .eq('username', username)
    .eq('is_public', true)
    .single();

  if (!profile) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', color: C.muted, ...MONO }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>👤</div>
          <div>Profile does not exist or is private</div>
        </div>
      </div>
    );
  }

  const { data: collection } = await getAdminClient()
    .from('collection').select('*')
    .eq('user_id', profile.id)
    .order('added_at', { ascending: false });

  const totalValue = (collection || []).reduce((s, i) => s + (Number(i.purchase_price) || 0), 0);

  return (
    <div style={{ minHeight: '100vh', background: C.bg, maxWidth: 600, margin: '0 auto', padding: '0 0 40px' }}>
      <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Space+Mono&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{ background: C.bg, borderBottom: `1px solid ${C.border}`, padding: '20px 16px' }}>
        <div style={{ ...BEBAS, fontSize: 22, color: C.muted, letterSpacing: '0.1em' }}>METAL VAULT</div>
      </div>

      {/* Profile header */}
      <div style={{ padding: '24px 16px', borderBottom: `1px solid ${C.border}`, display: 'flex', gap: 16, alignItems: 'center' }}>
        <div style={{
          width: 64, height: 64, borderRadius: '50%',
          background: `linear-gradient(135deg, ${C.accent}, #450a0a)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 28, overflow: 'hidden', flexShrink: 0,
        }}>
          {profile.avatar_url
            ? <img src={profile.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <span style={{ ...BEBAS }}>{(profile.display_name || '?')[0].toUpperCase()}</span>
          }
        </div>
        <div>
          <div style={{ ...BEBAS, fontSize: 26, color: C.text, letterSpacing: '0.05em', lineHeight: 1 }}>
            {profile.display_name}
          </div>
          {profile.username && (
            <div style={{ fontSize: 11, color: C.muted, ...MONO, marginTop: 3 }}>@{profile.username}</div>
          )}
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${C.border}` }}>
        {[
          { l: 'Records', v: (collection || []).length },
          { l: 'Value', v: totalValue > 0 ? `${totalValue.toFixed(0)} PLN` : '—' },
        ].map(s => (
          <div key={s.l} style={{ flex: 1, padding: '16px', textAlign: 'center', borderRight: `1px solid ${C.border}` }}>
            <div style={{ ...BEBAS, fontSize: 28, color: C.accent, lineHeight: 1 }}>{s.v}</div>
            <div style={{ fontSize: 9, color: C.muted, ...MONO, letterSpacing: '0.15em', textTransform: 'uppercase', marginTop: 4 }}>{s.l}</div>
          </div>
        ))}
      </div>

      {/* Collection */}
      <div style={{ padding: '16px' }}>
        <div style={{ fontSize: 10, color: C.accent, letterSpacing: '0.2em', textTransform: 'uppercase', ...MONO, marginBottom: 12 }}>
          Vinyl Collection
        </div>
        {(!collection || collection.length === 0) ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: C.muted, ...MONO, fontSize: 12 }}>Collection is empty</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {collection.map(item => (
              <div key={item.id} style={{
                background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 10,
                padding: '12px 14px', display: 'flex', gap: 12, alignItems: 'center',
              }}>
                <div style={{
                  width: 48, height: 48, borderRadius: 6, flexShrink: 0,
                  background: `linear-gradient(135deg, #1a0000, #0a0a0a)`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: `1px solid ${C.border}`, overflow: 'hidden',
                }}>
                  {item.cover
                    ? <img src={item.cover} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <span style={{ ...BEBAS, fontSize: 20, color: '#ffffff44' }}>{(item.artist || '?')[0]}</span>
                  }
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ ...BEBAS, fontSize: 16, color: C.text, lineHeight: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.artist}
                  </div>
                  <div style={{ fontSize: 11, color: C.muted, ...MONO, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.album}
                  </div>
                  {item.format && <div style={{ fontSize: 10, color: '#555', ...MONO, marginTop: 2 }}>{item.format}</div>}
                </div>
                {item.color && (
                  <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 10, background: '#1a1a1a', color: '#888', border: `1px solid ${C.border}`, ...MONO }}>
                    {item.color}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
