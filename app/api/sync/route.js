export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient, getAdminClient } from '@/lib/supabase-server';

function oauthHeader(consumerKey, consumerSecret, token, secret) {
  const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `OAuth oauth_consumer_key="${consumerKey}",oauth_token="${token}",oauth_signature_method="PLAINTEXT",oauth_signature="${consumerSecret}&${secret}",oauth_version="1.0",oauth_timestamp="${Math.floor(Date.now()/1000)}",oauth_nonce="${nonce}"`;
}

function buildHeader(discogsToken) {
  const key=process.env.DISCOGS_KEY, secret=process.env.DISCOGS_SECRET, token=process.env.DISCOGS_TOKEN;
  if(discogsToken?.access_token&&key&&secret)
    return{Authorization:oauthHeader(key,secret,discogsToken.access_token,discogsToken.access_secret),'User-Agent':'MetalVault/1.0'};
  if(token) return{Authorization:'Discogs token='+token,'User-Agent':'MetalVault/1.0'};
  return null;
}

async function fetchAllPages(baseUrl,headers){
  const items=[];let page=1,totalPages=1;
  while(page<=totalPages&&page<=20){
    const r=await fetch(baseUrl+`&page=${page}&per_page=100`,{headers,cache:'no-store'});
    if(!r.ok){
      if(r.status===404)throw new Error('Discogs collection is private — connect Discogs OAuth');
      if(r.status===401)throw new Error('Discogs auth failed — reconnect Discogs');
      if(r.status===429)throw new Error('Discogs rate limited — try again later');
      throw new Error('Discogs error '+r.status);
    }
    const data=await r.json();
    totalPages=data.pagination?.pages||1;
    items.push(...(data.releases||data.wants||[]));
    page++;
    if(page<=totalPages)await new Promise(r=>setTimeout(r,400));
  }
  return items;
}

function normalizeItem(r){
  const info=r.basic_information||r;
  return{
    discogs_id:String(info.id||r.id),
    artist:(info.artists?.[0]?.name||'Unknown').replace(/\s*\(\d+\)$/,''),
    album:info.title||'',cover:info.cover_image||info.thumb||null,
    format:info.formats?.[0]?.name||'Vinyl',label:info.labels?.[0]?.name||null,
    year:info.year||null,genres:info.genres||[],styles:info.styles||[],
    discogsUrl:`https://www.discogs.com/release/${info.id||r.id}`,
    date_added:r.date_added||null,rating:r.rating||null,
    purchase_price:r.notes?.find?.(n=>n.field_id===1)?.value?parseFloat(r.notes.find(n=>n.field_id===1).value)||null:null,
  };
}

export async function POST(req){
  try{
    const sb=await createClient();
    const admin=getAdminClient();
    const{data:{user}}=await sb.auth.getUser();
    if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
    const body=await req.json().catch(()=>({}));
    const{type='both'}=body;
    const{data:discogsToken}=await admin.from('discogs_tokens').select('access_token,access_secret,discogs_username').eq('user_id',user.id).single();
    const headers=buildHeader(discogsToken);
    if(!headers)return NextResponse.json({error:'Discogs not configured'},{status:503});
    const username=discogsToken?.discogs_username;
    if(!username)return NextResponse.json({error:'No Discogs username — connect Discogs in Me tab',needsConnect:true},{status:400});
    const result={added:0,updated:0,watchAdded:0,errors:[]};
    if(type==='collection'||type==='both'){
      try{
        const raw=await fetchAllPages(`https://api.discogs.com/users/${username}/collection/folders/0/releases?sort=added&sort_order=desc`,headers);
        for(const r of raw){
          const item=normalizeItem(r);
          const{data:ex}=await admin.from('collection').select('id,purchase_price').eq('user_id',user.id).eq('discogs_id',item.discogs_id).single();
          if(ex){
            await admin.from('collection').update({cover:item.cover,format:item.format,label:item.label,year:item.year,genres:item.genres,styles:item.styles,...(item.purchase_price&&!ex.purchase_price?{purchase_price:item.purchase_price}:{})}).eq('id',ex.id);
            result.updated++;
          }else{
            await admin.from('collection').insert({user_id:user.id,...item,added_at:new Date().toISOString()});
            result.added++;
          }
        }
      }catch(e){result.errors.push({source:'collection',error:e.message});}
    }
    if(type==='wantlist'||type==='both'){
      try{
        const raw=await fetchAllPages(`https://api.discogs.com/users/${username}/wants?sort=added&sort_order=desc`,headers);
        for(const r of raw){
          const item=normalizeItem(r);
          const{data:ex}=await admin.from('watchlist').select('id').eq('user_id',user.id).eq('album_id',item.discogs_id).single();
          if(!ex){
            await admin.from('watchlist').insert({user_id:user.id,album_id:item.discogs_id,artist:item.artist,album:item.album,cover:item.cover,year:item.year,discogsUrl:item.discogsUrl,release_date:item.year?String(item.year):null,added_at:new Date().toISOString()});
            result.watchAdded++;
          }
        }
      }catch(e){result.errors.push({source:'wantlist',error:e.message});}
    }
    return NextResponse.json({success:true,username,...result});
  }catch(e){
    return NextResponse.json({error:e.message},{status:500});
  }
               }
