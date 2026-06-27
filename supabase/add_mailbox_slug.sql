-- AP mailbox: friendly slug-based addresses (bills-{slug}@inbound.ledgrly.ie)
-- Replaces the raw 10-hex inbound_token with a memorable, company-name-derived slug.
-- Old inbound_token column is kept (data preserved, routing deprecated).
--
-- UNIQUENESS: partial unique index on mailbox_slug WHERE NOT NULL so multiple
-- un-slugged rows can coexist during backfill without violating the constraint.
-- Once assigned, a slug maps to exactly one company.
--
-- RUN ORDER: apply after add_inbound_token.sql.

-- ── 1. Add mailbox_slug column ────────────────────────────────────────────────
ALTER TABLE companies ADD COLUMN IF NOT EXISTS mailbox_slug TEXT;

-- Partial unique index: enforces one-slug-per-company once set, permits NULLs.
CREATE UNIQUE INDEX IF NOT EXISTS companies_mailbox_slug_uidx
  ON companies (mailbox_slug)
  WHERE mailbox_slug IS NOT NULL;

-- ── 2. slugify_company_name ───────────────────────────────────────────────────
-- Strip everything except alphanumeric, lowercase.
-- "Hero's Gym" → "herosgym", "Fitzsimons Test" → "fitzsimonstest"
CREATE OR REPLACE FUNCTION slugify_company_name(p_name TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT lower(regexp_replace(p_name, '[^a-zA-Z0-9]', '', 'g'))
$$;

-- ── 3. claim_mailbox_slug ─────────────────────────────────────────────────────
-- Atomically assigns the first available slug (base, base2, base3, …) to a
-- company row. Returns the slug actually stored.
-- Called after INSERT (new company) or after rename.
CREATE OR REPLACE FUNCTION claim_mailbox_slug(p_company_id UUID, p_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_base TEXT := slugify_company_name(p_name);
  v_slug TEXT;
  v_i    INT  := 2;
BEGIN
  -- Guard: name was all punctuation/whitespace
  IF v_base = '' THEN v_base := 'company'; END IF;
  v_slug := v_base;
  LOOP
    BEGIN
      UPDATE companies SET mailbox_slug = v_slug WHERE id = p_company_id;
      RETURN v_slug;
    EXCEPTION WHEN unique_violation THEN
      -- Slug taken; try the next numeric suffix
      v_slug := v_base || v_i;
      v_i    := v_i + 1;
    END;
  END LOOP;
END;
$$;
GRANT EXECUTE ON FUNCTION claim_mailbox_slug(UUID, TEXT) TO anon;

-- ── 4. regenerate_mailbox_slug ────────────────────────────────────────────────
-- Reset action: assigns a new slug of the form {base}-{4-hex} and returns it.
-- The old slug is overwritten immediately — mail to the old address stops resolving.
CREATE OR REPLACE FUNCTION regenerate_mailbox_slug(p_company_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_name TEXT;
  v_base TEXT;
  v_slug TEXT;
  v_i    INT := 2;
BEGIN
  SELECT name INTO v_name FROM companies WHERE id = p_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Company not found'; END IF;

  v_base := slugify_company_name(v_name)
    || '-' || lower(encode(gen_random_bytes(2), 'hex'));
  v_slug := v_base;
  LOOP
    BEGIN
      UPDATE companies SET mailbox_slug = v_slug WHERE id = p_company_id;
      RETURN v_slug;
    EXCEPTION WHEN unique_violation THEN
      v_slug := v_base || v_i;
      v_i    := v_i + 1;
    END;
  END LOOP;
END;
$$;
GRANT EXECUTE ON FUNCTION regenerate_mailbox_slug(UUID) TO anon;

-- ── 5. Backfill existing companies ───────────────────────────────────────────
-- Assigns slugs to all companies that don't have one yet.
-- Runs claim_mailbox_slug per row so collisions (same company name) are
-- resolved to herosgym / herosgym2 / herosgym3… automatically.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id, name FROM companies WHERE mailbox_slug IS NULL ORDER BY created_at LOOP
    PERFORM claim_mailbox_slug(r.id, r.name);
  END LOOP;
END $$;
