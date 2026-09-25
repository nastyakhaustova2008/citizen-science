import { createClient } from '@supabase/supabase-js';

/**
 * Supabase client. Configured via VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
 * (Vercel env vars in deploys, .env.local in development).
 * If they are missing, `supabase` is null and data loads fail with an error state.
 */
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if ((!url || !anonKey) && import.meta.env.DEV) {
  console.warn('[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set — see .env.local');
}

export const supabase = url && anonKey ? createClient(url, anonKey) : null;
