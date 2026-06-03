import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
export const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const projectRef = (() => {
  try {
    return new URL(SUPABASE_URL).hostname.split(".")[0] ?? "default";
  } catch {
    return "default";
  }
})();

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: localStorage,
    storageKey: `sb-${projectRef}-auth-token`,
    persistSession: true,
    autoRefreshToken: true,
  }
});
