-- Replace the global UNIQUE on companies.name with a per-practice composite unique.
-- Without this, two different practices cannot both have a client called "ABC Ltd".
--
-- PostgreSQL default-names a column-level UNIQUE constraint as {table}_{column}_key,
-- so the original constraint created via Supabase Table Editor is companies_name_key.
-- We drop it and replace with UNIQUE (clerk_user_id, name) so uniqueness is scoped
-- to the owning practice user rather than the entire database.

-- Drop the old global constraint (no-op if already replaced).
ALTER TABLE companies DROP CONSTRAINT IF EXISTS companies_name_key;
DROP INDEX IF EXISTS companies_name_key;

-- Add per-practice composite unique.
-- Guard with DO block so the migration is safe to re-run.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name       = 'companies'
    AND   constraint_name  = 'companies_clerk_user_id_name_key'
    AND   constraint_type  = 'UNIQUE'
  ) THEN
    ALTER TABLE companies
      ADD CONSTRAINT companies_clerk_user_id_name_key UNIQUE (clerk_user_id, name);
  END IF;
END $$;
