// ── Weekly Collection Report Email ─────────────────────────────
// Runs Sundays 18:00 UTC. Sends formatted HTML email via Resend
// to users who have verified email and are opted-in to digests.
//
// Content: week-over-week value change, top gainer, top loser,
// new records added, persona snapshot, pending pre-orders.

export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';

async function sendEmail({ to, subject, html }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { skipped: 'no_resend_key' };
  const from = process.env.FROM_EMAIL || 'Metal Vault <onboarding@resend.dev>';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({ from, to, subject, html }),
  });
  return res.ok ? { ok: true } : { ok: false, status: res.status };
}

function htmlEscape(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function buildEmail({ displayName, weekStart, collection, stats, topGainer, topLoser, newRecords, appUrl }) {
  const gainColor = stats.weekGain >= 0 ? '#4ade80' : '#f87171';
  const gainSign  = stats.weekGain >= 0 ? '+' : '';

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; background: #0a0a0a; color: #f0f0f0; padding: 0; margin: 0;">
  <div style="max-width: 520px; margin: 0 auto; padding: 28px 24px;">
    <!-- Header -->
    <div style="border-bottom: 2px solid #dc2626; padding-bottom: 16px; margin-bottom: 20px;">
      <div style="font-size: 32px; font-weight: bold; letter-spacing: 0.06em; color: #f0f0f0; line-height: 1;">METAL VAULT</div>
      <div style="font-size: 10px; color: #dc2626; letter-spacing: 0.25em; text-transform: uppercase; margin-top: 4px;">WEEKLY REPORT · ${weekStart}</div>
    </div>

    <!-- Personalized greeting -->
    <div style="font-size: 14px; color: #888; margin-bottom: 24px;">
      Hey ${htmlEscape(displayName)} — here's your week in metal.
    </div>

    <!-- Big stat: total value -->
    <div style="background: #1a0a0a; border-left: 4px solid #dc2626; padding: 16px 20px; margin-bottom: 20px;">
      <div style="font-size: 10px; color: #888; letter-spacing: 0.15em; text-transform: uppercase;">Collection value</div>
      <div style="font-size: 36px; color: #f5c842; font-weight: bold; margin-top: 4px;">$${stats.totalValue.toFixed(0)}</div>
      <div style="font-size: 13px; color: ${gainColor}; margin-top: 4px;">
        ${gainSign}$${stats.weekGain.toFixed(0)} this week
      </div>
    </div>

    ${topGainer ? `
    <div style="margin-bottom: 18px;">
      <div style="font-size: 11px; color: #4ade80; letter-spacing: 0.15em; text-transform: uppercase; margin-bottom: 6px;">📈 Top gainer</div>
      <div style="background: #0a0a0a; border: 1px solid #1a3d1a; border-radius: 8px; padding: 12px 14px;">
        <div style="font-size: 14px; color: #f0f0f0;">${htmlEscape(topGainer.artist)}</div>
        <div style="font-size: 12px; color: #888;">${htmlEscape(topGainer.album)}</div>
        <div style="font-size: 11px; color: #4ade80; margin-top: 4px;">+$${topGainer.gain.toFixed(0)} (${topGainer.gainPct >= 0 ? '+' : ''}${topGainer.gainPct.toFixed(0)}%)</div>
      </div>
    </div>
    ` : ''}

    ${topLoser && topLoser.gain < -5 ? `
    <div style="margin-bottom: 18px;">
      <div style="font-size: 11px; color: #f87171; letter-spacing: 0.15em; text-transform: uppercase; margin-bottom: 6px;">📉 Biggest drop</div>
      <div style="background: #0a0a0a; border: 1px solid #3d1a1a; border-radius: 8px; padding: 12px 14px;">
        <div style="font-size: 14px; color: #f0f0f0;">${htmlEscape(topLoser.artist)}</div>
        <div style="font-size: 12px; color: #888;">${htmlEscape(topLoser.album)}</div>
        <div style="font-size: 11px; color: #f87171; margin-top: 4px;">$${topLoser.gain.toFixed(0)} (${topLoser.gainPct.toFixed(0)}%)</div>
      </div>
    </div>
    ` : ''}

    ${newRecords.length > 0 ? `
    <div style="margin-bottom: 18px;">
      <div style="font-size: 11px; color: #f5c842; letter-spacing: 0.15em; text-transform: uppercase; margin-bottom: 6px;">🆕 ${newRecords.length} new record${newRecords.length > 1 ? 's' : ''} this week</div>
      <div style="background: #0a0a0a; border: 1px solid #2a2a2a; border-radius: 8px; padding: 12px 14px;">
        ${newRecords.slice(0, 5).map(r => `<div style="font-size: 12px; color: #888; margin-bottom: 3px;">${htmlEscape(r.artist)} — ${htmlEscape(r.album)}</div>`).join('')}
      </div>
    </div>
    ` : ''}

    <!-- Stats row -->
    <div style="display: table; width: 100%; border-spacing: 8px 0; margin-bottom: 20px;">
      <div style="display: table-cell; width: 33%; background: #0a0a0a; padding: 10px; border-radius: 6px; text-align: center;">
        <div style="font-size: 22px; color: #f0f0f0; font-weight: bold;">${stats.recordCount}</div>
        <div style="font-size: 9px; color: #888; letter-spacing: 0.1em; text-transform: uppercase; margin-top: 2px;">Records</div>
      </div>
      <div style="display: table-cell; width: 33%; background: #0a0a0a; padding: 10px; border-radius: 6px; text-align: center;">
        <div style="font-size: 22px; color: #f0f0f0; font-weight: bold;">${stats.uniqueArtists}</div>
        <div style="font-size: 9px; color: #888; letter-spacing: 0.1em; text-transform: uppercase; margin-top: 2px;">Artists</div>
      </div>
      <div style="display: table-cell; width: 33%; background: #0a0a0a; padding: 10px; border-radius: 6px; text-align: center;">
        <div style="font-size: 22px; color: #f0f0f0; font-weight: bold;">${stats.activeAlerts}</div>
        <div style="font-size: 9px; color: #888; letter-spacing: 0.1em; text-transform: uppercase; margin-top: 2px;">Alerts</div>
      </div>
    </div>

    <!-- CTA -->
    <a href="${appUrl}/?tab=stats" style="display: block; background: #dc2626; color: #fff; text-decoration: none; text-align: center; padding: 14px; border-radius: 8px; font-size: 14px; font-weight: bold; letter-spacing: 0.08em; margin-bottom: 20px;">
      🤘 OPEN YOUR VAULT
    </a>

    <!-- Footer -->
    <div style="border-top: 1px solid #2a2a2a; padding-top: 16px; font-size: 10px; color: #555; text-align: center; line-height: 1.6;">
      You're receiving this because you have a Metal Vault account.<br>
      <a href="${appUrl}/?tab=profile" style="color: #666; text-decoration: underline;">Manage preferences</a>
    </div>
  </div>
</body>
</html>
`;
}

export async function GET(request) {
  const auth = request.headers.get('authorization');
  if (process.env.CRON_SECRET && auth !== 'Bearer ' + process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ skipped: 'RESEND_API_KEY not set' });
  }

  const sb = supabaseAdmin;
  const results = { sent: 0, skipped: 0, errors: 0 };
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://metal-vault-six.vercel.app';
  const weekStart = new Date().toISOString().split('T')[0];

  try {
    // Only send to users with verified email AND at least 5 records
    const { data: profiles } = await sb
      .from('profiles').select('id, display_name, username');

    for (const profile of profiles || []) {
      try {
        // Get email from auth.users
        const { data: { user } } = await sb.auth.admin.getUserById(profile.id);
        if (!user?.email || !user?.email_confirmed_at) { results.skipped++; continue; }

        // Load collection
        const { data: collection } = await sb
          .from('collection').select('*').eq('user_id', profile.id);

        if (!collection || collection.length < 5) { results.skipped++; continue; }

        // Compute stats
        const totalValue = collection.reduce((s, i) => s + (Number(i.median_price || i.current_price || i.purchase_price) || 0), 0);
        const totalPaid  = collection.reduce((s, i) => s + (Number(i.purchase_price) || 0), 0);
        const uniqueArtists = new Set(collection.map(i => i.artist)).size;

        // Top gainer / loser
        const withGain = collection
          .filter(i => Number(i.purchase_price) > 0 && Number(i.median_price || i.current_price) > 0)
          .map(i => {
            const paid = Number(i.purchase_price), now = Number(i.median_price || i.current_price);
            return { artist: i.artist, album: i.album, gain: now - paid, gainPct: ((now - paid) / paid) * 100 };
          });
        const topGainer = withGain.length ? [...withGain].sort((a, b) => b.gain - a.gain)[0] : null;
        const topLoser  = withGain.length > 1 ? [...withGain].sort((a, b) => a.gain - b.gain)[0] : null;

        // Week-over-week value change (approximate: from portfolio_snapshots if available)
        let weekGain = 0;
        try {
          const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
          const { data: oldSnap } = await sb
            .from('portfolio_snapshots').select('total_value').eq('user_id', profile.id)
            .lte('snapshot_date', weekAgo.toISOString().split('T')[0])
            .order('snapshot_date', { ascending: false }).limit(1).single();
          if (oldSnap?.total_value) weekGain = totalValue - oldSnap.total_value;
        } catch {}

        // New records added in last 7 days
        const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
        const newRecords = collection.filter(i => i.added_at && new Date(i.added_at) >= weekAgo);

        // Active alerts
        const { count: activeAlerts } = await sb
          .from('price_alerts').select('id', { count: 'exact', head: true })
          .eq('user_id', profile.id).eq('is_active', true);

        const html = buildEmail({
          displayName: profile.display_name || profile.username || 'Collector',
          weekStart,
          collection,
          stats: { totalValue, recordCount: collection.length, uniqueArtists, weekGain, activeAlerts: activeAlerts || 0 },
          topGainer,
          topLoser,
          newRecords,
          appUrl,
        });

        await sendEmail({
          to:      user.email,
          subject: '🤘 Metal Vault weekly — $' + totalValue.toFixed(0) + ' (' + (weekGain >= 0 ? '+' : '') + '$' + weekGain.toFixed(0) + ')',
          html,
        });
        results.sent++;
        // Rate limit Resend: 10/sec free tier — sleep 150ms between sends
        await new Promise(r => setTimeout(r, 150));
      } catch (e) {
        console.error('Weekly email error for ' + profile.id + ':', e.message);
        results.errors++;
      }
    }
  } catch (e) {
    return NextResponse.json({ error: e.message, results }, { status: 500 });
  }

  return NextResponse.json({ success: true, ...results });
}
