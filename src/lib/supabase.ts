import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Q1: Supabase client. Reads URL + publishable key from Vite env vars (VITE_*).
// `.env.local` is the dev source; `.env.example` documents the prod + staging
// values. Switching envs is a deploy-time concern (no in-app toggle).

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !anonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. ' +
      'Copy .env.example → .env.local and fill in the values.',
  );
}

export const supabase: SupabaseClient = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

// Convenience helper to surface which env we're talking to in console output.
export const supabaseUrl = url;
