 // Hardcoded to original Supabase project — bypasses Lovable Cloud .env
  import { createClient } from '@supabase/supabase-js';                                                                                    
  import type { Database } from './types';
                                                                                                                                           
  const SUPABASE_URL = "https://eezbgxbbgaqifgcxxbun.supabase.co";                                                                         
  const SUPABASE_PUBLISHABLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVlemJneGJiZ2FxaWZnY3h4YnVuIiwicm
  9sZSI6ImFub24iLCJpYXQiOjE3NzIzNTc2ODAsImV4cCI6MjA4NzkzMzY4MH0.WTckXSncDW3mbVhbLQnQUeIcb1x2Ks58roVkmboe8q0";                              
                                                                                           
  export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {                                                 
    auth: {                                                                                
      storage: localStorage,                   
      persistSession: true,
      autoRefreshToken: true,
    }
  });