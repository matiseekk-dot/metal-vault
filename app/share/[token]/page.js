import { getAdminClient } from '@/lib/supabase-server';

export async function generateMetadata({ params }) {
  const { token } = await params;
  const { data } = await getAdminClient().from('share_tokens').select('label').eq('token', token).single();
  return { title: (data?.label || 'Collection') + ' · Metal Vault' };
}

const C = { bg:'#0a0a0a',bg2:'#141414',bg3:'#1e1e1e',border:'#2a2a2a',accent:'#dc2626',text:'#f0f0f0',muted:'#888' };
const BEBAS = {fontFamily:"'Bebas Neue',sans-serif"};
const MONO  = {fontFamily:"'Space Mono',monospace"};
const GRADE_COLOR = {'M':'#4ade80','NM':'#4ade80','VG+':'#f5c842','VG':'#f5c842','G+':'#f97316','G':'#f87171','F':'#f87171','P':'#888'};

export default async function SharePage({ params }) {
  const { token } = await params;

  const { data: share } = await getAdminClient().from('share_tokens').select('user_id,label').eq('token', token).single();
  if (!share) return (
    <div style={{minHeight:'100vh',background:C.bg,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Space Mono,monospace',color:'#555'}}>
      <div style={{textAlign:'center'}}>
        <div style={{fontSize:40,marginBottom:12}}>🔒</div>
        <div>This share link is invalid or has been removed</div>
      </div>
    </div>
  );

  const [{ data: collection }, { data: profile }] = await Promise.all([
    sb.from('collection').select('*').eq('user_id', share.user_id).order('added_at', { ascending: false }),
    sb.from('profiles').select('display_name,username,avatar_url').eq('id', share.user_id).single(),
  ]);

  const totalPaid    = (collection||[]).reduce((s,i)=>s+(Number(i.purchase_price)||0),0);
  const totalCurrent = (collection||[]).reduce((s,i)=>s+(Number(i.median_price||i.current_price||i.purchase_price)||0),0);
  const gain         = totalCurrent - totalPaid;

  return (
    <div style={{minHeight:'100vh',background:C.bg,maxWidth:600,margin:'0 auto',paddingBottom:40}}>
      <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Space+Mono&display=swap" rel="stylesheet"/>

      {/* Header */}
      <div style={{background:C.bg,borderBottom:'1px solid '+C.border,padding:'16px'}}>
        <div style={{...BEBAS,fontSize:22,color:'#555',letterSpacing:'0.1em'}}>METAL VAULT</div>
      </div>

      {/* Profile */}
      <div style={{padding:'20px 16px',borderBottom:'1px solid '+C.border,display:'flex',gap:14,alignItems:'center'}}>
        <div style={{width:56,height:56,borderRadius:'50%',background:'linear-gradient(135deg,'+C.accent+',#450a0a)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,overflow:'hidden'}}>
          {profile?.avatar_url
            ?<img src={profile.avatar_url} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}}/>
            :<span style={{...BEBAS,fontSize:24,color:'#fff'}}>{(profile?.display_name||'?')[0]}</span>
          }
        </div>
        <div>
          <div style={{...BEBAS,fontSize:24,color:C.text,letterSpacing:'0.05em',lineHeight:1}}>{profile?.display_name||'Metal Fan'}</div>
          <div style={{fontSize:11,color:'#555',...MONO,marginTop:2}}>{share.label}</div>
        </div>
      </div>

      {/* Stats */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',borderBottom:'1px solid '+C.border}}>
        {[
          {l:'Records',v:(collection||[]).length},
          {l:'Value',v:totalCurrent>0?'$'+totalCurrent.toFixed(0):'—'},
          {l:'Gain',v:gain!==0?(gain>0?'+$':'-$')+Math.abs(gain).toFixed(0):'—',c:gain>0?'#4ade80':gain<0?'#f87171':C.muted},
        ].map(s=>(
          <div key={s.l} style={{textAlign:'center',padding:'14px 8px',borderRight:'1px solid '+C.border}}>
            <div style={{...BEBAS,fontSize:26,color:s.c||C.accent,lineHeight:1}}>{s.v}</div>
            <div style={{fontSize:9,color:'#555',...MONO,letterSpacing:'0.12em',textTransform:'uppercase',marginTop:3}}>{s.l}</div>
          </div>
        ))}
      </div>

      {/* Collection */}
      <div style={{padding:'16px'}}>
        <div style={{fontSize:10,color:C.accent,...MONO,letterSpacing:'0.2em',textTransform:'uppercase',marginBottom:12}}>Vinyl Collection</div>
        {(collection||[]).length===0?(
          <div style={{textAlign:'center',padding:'40px 0',color:'#333',...MONO}}>Collection is empty</div>
        ):(
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            {(collection||[]).map(item=>(
              <div key={item.id} style={{background:C.bg2,border:'1px solid '+C.border,borderRadius:10,padding:'12px 14px',display:'flex',gap:12,alignItems:'center'}}>
                <div style={{width:48,height:48,borderRadius:6,flexShrink:0,overflow:'hidden',border:'1px solid '+C.border,background:'linear-gradient(135deg,#1a0000,#0a0a0a)',display:'flex',alignItems:'center',justifyContent:'center'}}>
                  {item.cover
                    ?<img src={item.cover} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}}/>
                    :<span style={{...BEBAS,fontSize:20,color:'#ffffff22'}}>{(item.artist||'?')[0]}</span>
                  }
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{...BEBAS,fontSize:16,color:C.text,lineHeight:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{item.artist}</div>
                  <div style={{fontSize:11,color:C.muted,...MONO,marginTop:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{item.album}</div>
                  <div style={{display:'flex',gap:6,marginTop:4,flexWrap:'wrap',alignItems:'center'}}>
                    {item.grade&&item.grade!=='NM'&&<span style={{fontSize:9,padding:'1px 5px',borderRadius:4,background:GRADE_COLOR[item.grade]+'22',color:GRADE_COLOR[item.grade],...MONO}}>{item.grade}</span>}
                    {item.format&&<span style={{fontSize:9,color:'#555',...MONO}}>{item.format}</span>}
                    {item.median_price>0&&<span style={{fontSize:10,color:'#f5c842',...MONO}}>${Number(item.median_price).toFixed(0)}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{textAlign:'center',padding:'20px',fontSize:10,color:'#333',...MONO}}>
        Shared via Metal Vault · metal-vault-six.vercel.app
      </div>
    </div>
  );
}
