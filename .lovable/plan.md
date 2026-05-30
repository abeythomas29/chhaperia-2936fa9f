
## What's happening

The app's Supabase client points to `eezbgxbbgaqifgcxxbun` (your live backend). The 36 Head submit POST is returning:

```
404 PGRST205 — Could not find the table 'public.head36_entries' in the schema cache
```

The table simply does not exist in that backend. I cannot run migrations there from here — that project is not managed by Lovable Cloud. The fix has to be applied once, by hand, in that backend's SQL editor.

## Plan

### Step 1 — You run this SQL in the live backend (`eezbgxbbgaqifgcxxbun` → SQL editor)

```sql
-- 1. Table
CREATE TABLE IF NOT EXISTS public.head36_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL DEFAULT CURRENT_DATE,
  slitting_entry_id uuid,
  product_code_id uuid,
  operator_id uuid NOT NULL,
  rolls_taken numeric NOT NULL DEFAULT 0,
  rolls_produced numeric NOT NULL DEFAULT 0,
  roll_width_mm numeric,
  length_per_tape_mtr numeric,
  thickness_mm numeric,
  gsm numeric,
  total_quantity numeric,
  unit text NOT NULL DEFAULT 'meters',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Grants (required — PostgREST won't see the table without these)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.head36_entries TO authenticated;
GRANT ALL ON public.head36_entries TO service_role;

-- 3. RLS
ALTER TABLE public.head36_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view head36 entries"
  ON public.head36_entries FOR SELECT TO authenticated USING (true);

CREATE POLICY "Slitting managers can insert own head36 entries"
  ON public.head36_entries FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = operator_id AND public.has_role(auth.uid(), 'slitting_manager'));

CREATE POLICY "Slitting managers can update own head36 entries"
  ON public.head36_entries FOR UPDATE TO authenticated
  USING (auth.uid() = operator_id AND public.has_role(auth.uid(), 'slitting_manager'))
  WITH CHECK (auth.uid() = operator_id AND public.has_role(auth.uid(), 'slitting_manager'));

CREATE POLICY "Admins can manage head36 entries"
  ON public.head36_entries FOR ALL USING (public.is_admin(auth.uid()));

-- 4. Force PostgREST to pick up the new table
NOTIFY pgrst, 'reload schema';
```

Notes:
- Assumes `public.has_role(uuid, text)` and `public.is_admin(uuid)` already exist in the live backend (they do in the schema you're using here).
- If your user account is missing the `slitting_manager` role in the live backend, the INSERT will still fail with an RLS error after the table exists. In that case also run, replacing the uuid with your `auth.users` id:
  ```sql
  INSERT INTO public.user_roles (user_id, role) VALUES ('<your-user-id>', 'slitting_manager')
  ON CONFLICT DO NOTHING;
  ```

### Step 2 — Add a friendlier client error (frontend-only)

In `src/pages/slitting/Head36Entry.tsx`, when the insert returns code `PGRST205`, show a clearer toast: "36 Head table is not provisioned in the backend yet. Ask an admin to run the head36_entries setup SQL." This avoids the raw Supabase message and points future users to the right fix instead of looping.

No other app code changes are required — the existing insert payload already matches the table schema above.

### Step 3 — Verify

1. Reload the 36 Head page.
2. Pick a source slitting entry, fill rolls produced, submit.
3. Expect a success toast and no 404 in network requests against `/rest/v1/head36_entries`.
