import { createClient } from '@supabase/supabase-js';

/**
 * Supabase client. Configured via VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
 * (Vercel env vars in deploys, .env.local in development).
 * If they are missing, `supabase` is null and data loads fail with an error state.
 *
 * Auth: PKCE flow — Google sign-in returns to `…/?code=…#/path` (a query string, so it does
 * not clash with HashRouter). The session is kept in localStorage under `sb-*` (the only
 * localStorage use besides mitzpe.locale / mitzpe.theme). Email links (reset password,
 * confirm email) use token_hash templates and are handled by pages/auth/ConfirmPage.
 */
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if ((!url || !anonKey) && import.meta.env.DEV) {
  console.warn('[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set — see .env.local');
}

export const supabase =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
      })
    : null;

/** Project URL and publishable key (the Edge Function `account` is called with plain fetch). */
export const supabaseUrl = url || null;
export const supabaseKey = anonKey || null;

/** Base URL the auth emails / Google send the user back to (no hash, no query). */
export function authRedirectBase() {
  return `${window.location.origin}${window.location.pathname}`;
}
