import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

const PROJECT_SUPABASE_URL = "https://orkfpujabjltzsgxlzor.supabase.co";
const PROJECT_SUPABASE_PUBLISHABLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ya2ZwdWphYmpsdHpzZ3hsem9yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwNjQ5NzIsImV4cCI6MjA5MzY0MDk3Mn0.XiQV6DR3PYJKnqrMZthbE7JuPmtXKccVu97OKYNzCdQ";

export const projectSupabase = createClient<Database>(PROJECT_SUPABASE_URL, PROJECT_SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  },
});