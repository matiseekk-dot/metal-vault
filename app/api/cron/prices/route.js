export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { Resend } from 'resend';

// Resend initialized lazily inside handler

// Called daily at 09:00 UTC by Vercel Cron
export async function GET(request) {
  const resend = new Resend(process.env.RESEND_API_KEY);
  const FROM = process.env.FROM_EMAIL || 'Metal Vault <alerts@metal-vault.app>';
  // Verify cron secret
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results = { checked: 0, triggered: 0, errors: [] };

  try {
    // Get all active alerts with user email
    const { data: alerts } = await supabaseAdmin
      .from('price_alerts')
      .select('*, auth_user:user_id(email)')
      .eq('is_active', true);

    if (!alerts || alerts.length === 0) {
      return NextResponse.json({ ...results, message: 'No active alerts' });
    }

    const key    = process.env.DISCOGS_KEY;
    const secret = process.env.DISCOGS_SECRET;

    for (const alert of alerts) {
      results.checked++;
      try {
        // Check current Discogs price
        const q = encodeURIComponent(`${alert.artist} ${alert.album}`);
        const res = await fetch(
          `https://api.discogs.com/database/search?q=${q}&type=release&format=vinyl&per_page=5`,
          { headers: { Authorization: `Discogs key=${key}, secret=${secret}`, 'User-Agent': 'MetalVault/1.0' } }
        );
        const data = await res.json();
        const releases = data.results || [];

        // Find lowest price among results
        const prices = releases
          .map(r => r.lowest_price)
          .filter(p => p && p > 0);

        if (prices.length === 0) continue;
        const lowestPrice = Math.min(...prices);

        // Update current price in collection if linked
        if (alert.collection_id) {
          await supabaseAdmin
            .from('collection')
            .update({ current_price: lowestPrice, last_price_check: new Date().toISOString() })
            .eq('id', alert.collection_id);
        }

        // Trigger if price <= target
        if (lowestPrice <= alert.target_price) {
          results.triggered++;

          // Don't re-trigger within 7 days
          if (alert.last_triggered) {
            const daysSince = (Date.now() - new Date(alert.last_triggered)) / (1000 * 60 * 60 * 24);
            if (daysSince < 7) continue;
          }

          const userEmail = alert.auth_user?.email;
          if (userEmail && process.env.RESEND_API_KEY) {
            await resend.emails.send({
              from: FROM,
              to: userEmail,
              subject: `💎 Price alert: ${alert.artist} — ${alert.album}`,
              html: `
                <div style="font-family: monospace; background: #0a0a0a; color: #f0f0f0; padding: 24px; border-radius: 8px;">
                  <h1 style="color: #dc2626; font-size: 28px; margin: 0 0 8px;">METAL VAULT</h1>
                  <p style="color: #888; font-size: 12px; margin: 0 0 24px;">ALERT CENOWY</p>

                  <div style="background: #141414; border: 1px solid #2a2a2a; border-left: 4px solid #f5c842; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
                    <div style="font-size: 20px; color: #f0f0f0; margin-bottom: 4px;">${alert.artist}</div>
                    <div style="font-size: 14px; color: #888;">${alert.album}</div>
                    <div style="margin-top: 12px; display: flex; gap: 16px;">
                      <div>
                        <div style="font-size: 11px; color: #555; text-transform: uppercase; letter-spacing: 0.1em;">Current price</div>
                        <div style="font-size: 24px; color: #4ade80;">$${lowestPrice.toFixed(2)}</div>
                      </div>
                      <div>
                        <div style="font-size: 11px; color: #555; text-transform: uppercase; letter-spacing: 0.1em;">Your target</div>
                        <div style="font-size: 24px; color: #f5c842;">$${alert.target_price.toFixed(2)}</div>
                      </div>
                    </div>
                  </div>

                  <a href="https://www.discogs.com/search/?q=${encodeURIComponent(alert.artist + ' ' + alert.album)}&type=release&format=Vinyl"
                     style="display: block; background: #dc2626; color: white; text-decoration: none; text-align: center; padding: 12px; border-radius: 8px; font-size: 14px;">
                    🔗 View on Discogs
                  </a>

                  <p style="color: #444; font-size: 10px; margin-top: 20px; text-align: center;">
                    Metal Vault · Alert will be re-triggered after 7 days if the price remains low.
                  </p>
                </div>
              `,
            });
          }

          // Mark as triggered
          await supabaseAdmin
            .from('price_alerts')
            .update({ last_triggered: new Date().toISOString() })
            .eq('id', alert.id);
        }
      } catch (e) {
        results.errors.push({ alertId: alert.id, error: e.message });
      }

      // Rate limit: 1 req/sec for Discogs
      await new Promise(r => setTimeout(r, 1000));
    }
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }

  return NextResponse.json(results);
}
