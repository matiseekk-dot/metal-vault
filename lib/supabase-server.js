import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {}
        },
      },
    }
  );
}

// Service role client — lazy, never initialized at build time
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

let _adminClient = null;
export function getAdminClient() {
  if (!_adminClient) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('Supabase env vars not set');
    _adminClient = createSupabaseClient(url, key);
  }
  return _adminClient;
}

// Keep supabaseAdmin as getter for backwards compat
export const supabaseAdmin = new Proxy({}, {
  get(_t, prop) {
    return getAdminClient()[prop];
  }
});

