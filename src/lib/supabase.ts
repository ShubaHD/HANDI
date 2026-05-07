import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.warn(
    '[supabase] Lipsesc VITE_SUPABASE_URL si/sau VITE_SUPABASE_ANON_KEY in .env. Aplicatia ruleaza in mod degradat.',
  );
}

export const supabase = createClient(url ?? 'http://localhost', anonKey ?? 'anon', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'handi-auth',
  },
});

export const isSupabaseConfigured = Boolean(url && anonKey);
