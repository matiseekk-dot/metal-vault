'use client';
// ── Metal Vault — product analytics (PostHog) ─────────────────────
//
// Thin wrapper over posthog-js. Lazy-loaded when
// NEXT_PUBLIC_POSTHOG_KEY is set; no-op otherwise (zero KB cost in
// dev, on preview deploys, and for installs that haven't enabled it).
//
// Goals:
//   • Capture funnel: install → first_open → onboarding_complete →
//     first_value_moment → paywall_view → purchase_started → purchase_done
//   • Capture key engagement events (add_to_collection, scan_barcode,
//     alert_created, demo_started)
//   • EU-compliant: PostHog Cloud EU host, IP set to no-precise, no
//     session-recording (privacy + bandwidth)
//
// Usage:
//   import { track, identify, reset } from '@/lib/analytics';
//   track('paywall_viewed', { reason: 'ALERT_LIMIT_REACHED' });
//   identify(user.id, { email: user.email });
//
// Adding a new event: just call track(name, props). If you find
// yourself shaping payloads in callsites repeatedly, add a helper
// here (e.g. trackPaywall, trackPurchase) so naming + props stay
// consistent across the app.

let _ph = null;          // posthog instance once loaded
let _loadPromise = null; // dedupe concurrent init() calls

const KEY  = process.env.NEXT_PUBLIC_POSTHOG_KEY;
// EU host by default. Polish/EU users → no cross-Atlantic data.
// Override via NEXT_PUBLIC_POSTHOG_HOST if your project lives in US.
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://eu.i.posthog.com';

function isEnabled() {
  if (typeof window === 'undefined') return false;          // SSR no-op
  if (!KEY) return false;                                    // not configured
  // Don't pollute analytics with the dev server. Preview/prod only.
  if (process.env.NODE_ENV !== 'production') return false;
  return true;
}

async function ensureLoaded() {
  if (!isEnabled()) return null;
  if (_ph) return _ph;
  if (_loadPromise) return _loadPromise;

  _loadPromise = import('posthog-js').then(({ default: posthog }) => {
    posthog.init(KEY, {
      api_host:                 HOST,
      person_profiles:          'identified_only',
      capture_pageview:          true,
      capture_pageleave:         true,
      autocapture:               false,    // explicit events only — saves $ + cleaner reports
      disable_session_recording: true,     // privacy + bandwidth
      ip:                        false,    // mask IP at ingest
      respect_dnt:               true,     // honour Do-Not-Track
      loaded: (ph) => {
        if (typeof window !== 'undefined') window.posthog = ph;  // for ad-hoc browser console use
      },
    });
    _ph = posthog;
    return posthog;
  }).catch(() => null);

  return _loadPromise;
}

/**
 * Capture a named event. Fire-and-forget — no await needed at callsites.
 * Properties should be a flat object of primitives + arrays of primitives.
 */
export function track(event, props) {
  if (!isEnabled()) return;
  ensureLoaded().then(ph => {
    if (!ph) return;
    try { ph.capture(event, props); } catch {}
  });
}

/**
 * Mark a session as belonging to a known user. Call right after sign-in
 * resolves so subsequent events tie to a stable distinct_id.
 *
 *   identify(user.id, { email: user.email, plan: 'pro' })
 */
export function identify(userId, traits) {
  if (!isEnabled() || !userId) return;
  ensureLoaded().then(ph => {
    if (!ph) return;
    try { ph.identify(userId, traits || {}); } catch {}
  });
}

/**
 * Wipe the PostHog user identity from the device. Call on sign-out so
 * the next anonymous session doesn't keep ghost-identifying as the
 * previous user.
 */
export function reset() {
  if (!isEnabled()) return;
  ensureLoaded().then(ph => {
    if (!ph) return;
    try { ph.reset(); } catch {}
  });
}

// ── Helpers — keep event naming + property shape consistent ───────

export function trackPaywallView(reason) {
  track('paywall_viewed', { reason: reason || 'unknown' });
}

export function trackPaywallCTA(reason, plan) {
  track('paywall_cta_clicked', { reason: reason || 'unknown', plan });
}

export function trackPurchaseStarted(plan, provider) {
  track('purchase_started', { plan, provider });
}

export function trackPurchaseCompleted(plan, provider) {
  track('purchase_completed', { plan, provider });
}

export function trackAddToCollection(source) {
  // source: 'discogs_sync' | 'barcode_scan' | 'manual' | 'feed_quick_add' | 'demo_seed'
  track('add_to_collection', { source });
}

export function trackBarcodeScan(found) {
  track('barcode_scan', { found: !!found });
}

export function trackAlertCreated(alertType) {
  track('alert_created', { alert_type: alertType });
}

export function trackDemoStarted() {
  track('demo_started');
}

export function trackOnboardingStep(stepIndex, action) {
  // action: 'view' | 'next' | 'skip' | 'complete'
  track('onboarding_step', { step: stepIndex, action });
}
