// ────────────────────────────────────────────────────────────────
// Test-only password login. Disabled in production by default.
//
// Why this exists: the app's user-facing login is magic-link OTP only
// (signInWithOtp), which can't be automated in Playwright without a
// real email inbox. For E2E auth coverage we need a deterministic way
// to put a session cookie on the test browser. Letting tests hit
// Supabase's signInWithPassword directly works, but the cookie shape
// expected by @supabase/ssr is non-trivial to construct outside the
// library — easier to call signInWithPassword from inside a route
// handler that already has the proper SSR cookie writer wired up.
//
// Hard gates (must satisfy ALL three to even reach the body):
//   1. env TEST_AUTH_SECRET is set and ≥32 chars (production never
//      sets it; preview deploys can opt in).
//   2. request header x-test-auth equals TEST_AUTH_SECRET.
//   3. body { email, password } both provided.
//
// Anything missing → 404, not 401, so probing for the route's
// existence in production tells the prober nothing.
// ────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

const NOT_FOUND = NextResponse.json({ error: 'Not found' }, { status: 404 });

export async function POST(request) {
  const secret = process.env.TEST_AUTH_SECRET;
  if (!secret || secret.length < 32) return NOT_FOUND;

  const provided = request.headers.get('x-test-auth');
  if (provided !== secret) return NOT_FOUND;

  let body;
  try { body = await request.json(); } catch { return NOT_FOUND; }
  const { email, password } = body || {};
  if (!email || !password) return NOT_FOUND;

  // Use the SSR-aware client so signInWithPassword writes the
  // session cookies the rest of the app expects on subsequent
  // requests. createServerClient handles the cookie schema; we
  // just have to wire reader + writer.
  const cookieStore = await cookies();
  const sb = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        },
      },
    }
  );

  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    user: { id: data.user?.id, email: data.user?.email },
  });
}
