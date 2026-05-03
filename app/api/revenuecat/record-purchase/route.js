// ── /api/revenuecat/record-purchase ─────────────────────────────────
// Called by the TWA client right after PaymentRequest.show() returns a
// purchaseToken from Play Billing. We forward the token to RevenueCat REST
// (POST /v1/receipts), which validates with Google Play Developer API,
// creates the subscriber record, and then asynchronously fires our existing
// /api/revenuecat/webhook with INITIAL_PURCHASE.
//
// We also synchronously read the entitlements out of the RC response and
// optimistically flip the profile to active, so the user doesn't have to
// wait for the webhook round-trip. The webhook handler is idempotent and
// will reconcile if anything was wrong.
//
// Body shapes:
//   { purchaseToken, productId, plan }      — single new purchase
//   { restore: [ { itemId, purchaseToken } ] } — restore flow

export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient, getAdminClient } from '@/lib/supabase-server';

const RC_RECEIPTS_ENDPOINT = 'https://api.revenuecat.com/v1/receipts';

const ALLOWED_PRODUCT_IDS = new Set(['mv_pro_monthly', 'mv_pro_yearly']);

async function postReceiptToRC({ rcKey, appUserId, productId, purchaseToken, isRestore }) {
  const r = await fetch(RC_RECEIPTS_ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + rcKey,
      'Content-Type':  'application/json',
      'X-Platform':    'android',
    },
    body: JSON.stringify({
      app_user_id:  appUserId,
      fetch_token:  purchaseToken,
      product_id:   productId,
      is_restore:   !!isRestore,
    }),
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

function deriveProfileUpdate(subscriberPayload) {
  // RC's response: { subscriber: { entitlements: { pro: { expires_date, ... } }, ... } }
  const ent = subscriberPayload?.subscriber?.entitlements?.pro;
  if (!ent) return null;

  const expiresIso = ent.expires_date || null;
  const expiry = expiresIso ? new Date(expiresIso).getTime() : 0;
  const isActive = expiry > Date.now();

  return {
    subscription_status: isActive ? 'active' : 'canceled',
    subscription_end:    expiresIso,
    subscription_source: 'revenuecat',
    revenuecat_user_id:  subscriberPayload?.subscriber?.original_app_user_id || null,
  };
}

export async function POST(request) {
  // 1) Auth — must be a logged-in user
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 2) RC key — public SDK key works for /v1/receipts (per RC docs).
  // Server-side lookup so the env var doesn't have to be public.
  const rcKey = process.env.NEXT_PUBLIC_REVENUECAT_PUBLIC_KEY
             || process.env.REVENUECAT_PUBLIC_KEY;
  if (!rcKey) {
    return NextResponse.json({ error: 'RevenueCat not configured' }, { status: 500 });
  }

  // 3) Parse body
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // 4) Build the list of (productId, purchaseToken) pairs to record.
  //    Restore flow can deliver multiple at once.
  const items = [];
  if (Array.isArray(body.restore)) {
    for (const p of body.restore) {
      if (!p?.itemId || !p?.purchaseToken) continue;
      if (!ALLOWED_PRODUCT_IDS.has(p.itemId)) continue;
      items.push({ productId: p.itemId, purchaseToken: p.purchaseToken, isRestore: true });
    }
  } else {
    const { purchaseToken, productId } = body;
    if (!purchaseToken || !productId) {
      return NextResponse.json({ error: 'Missing purchaseToken or productId' }, { status: 400 });
    }
    if (!ALLOWED_PRODUCT_IDS.has(productId)) {
      return NextResponse.json({ error: 'Unknown productId' }, { status: 400 });
    }
    items.push({ productId, purchaseToken, isRestore: false });
  }

  if (items.length === 0) {
    return NextResponse.json({ ok: true, recorded: 0 });
  }

  // 5) Forward each receipt to RC. Bail on first hard error so the client
  //    can show an actionable message; partial success on restore is fine.
  let lastSubscriber = null;
  for (const item of items) {
    const res = await postReceiptToRC({
      rcKey,
      appUserId:     user.id,
      productId:     item.productId,
      purchaseToken: item.purchaseToken,
      isRestore:     item.isRestore,
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: res.data?.message || 'RevenueCat rejected the receipt', status: res.status },
        { status: 502 },
      );
    }
    lastSubscriber = res.data;
  }

  // 6) Optimistic profile update from the RC response so the UI doesn't
  //    have to wait for the webhook. The webhook handler is idempotent
  //    and will re-apply the canonical state shortly.
  const update = deriveProfileUpdate(lastSubscriber);
  if (update) {
    const { error: updErr } = await getAdminClient()
      .from('profiles')
      .update(update)
      .eq('id', user.id);
    if (updErr) {
      // Profile update failed but the receipt was accepted — webhook will fix.
      return NextResponse.json({ ok: true, recorded: items.length, deferred: true });
    }
  }

  return NextResponse.json({
    ok:        true,
    recorded:  items.length,
    status:    update?.subscription_status || null,
  });
}
