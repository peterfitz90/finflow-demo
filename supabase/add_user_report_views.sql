-- RPT-01 Stage 1: saved report views + fix dashboard tile-layout persistence (PLT-15).
-- Applied 2026-09-29 as migration add_user_report_views_and_fix_dashboard_layouts.

-- ── 1. Saved report views ─────────────────────────────────────────────────────
-- One row per saved view. company_id NULL = "all my clients" (a view like "TB, YTD, vs
-- previous year" an accountant uses across every client); set = pinned to that company.
-- config holds only the fields the screen has — validated client-side on load, so a stale
-- saved view can't put a screen into a broken state.
CREATE TABLE IF NOT EXISTS public.user_report_views (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     text NOT NULL DEFAULT (auth.jwt() ->> 'sub'),
  company_id  uuid NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  screen      text NOT NULL CHECK (screen IN ('gl_reports', 'cash_flow', 'overview')),
  name        text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  config      jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(config) = 'object'),
  is_default  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Unique name per (user, screen, scope). NULLS NOT DISTINCT so two "all my clients" views
-- (company_id NULL) with the same name also collide — a plain UNIQUE treats NULLs as distinct.
ALTER TABLE public.user_report_views
  ADD CONSTRAINT user_report_views_name_key UNIQUE NULLS NOT DISTINCT (user_id, screen, company_id, name);

-- At most one default per (user, screen, scope) — again NULL scope counts as one scope.
CREATE UNIQUE INDEX IF NOT EXISTS user_report_views_one_default
  ON public.user_report_views (user_id, screen, company_id) NULLS NOT DISTINCT
  WHERE is_default;

CREATE INDEX IF NOT EXISTS user_report_views_lookup
  ON public.user_report_views (user_id, screen);

CREATE OR REPLACE FUNCTION public.user_report_views_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS user_report_views_touch ON public.user_report_views;
CREATE TRIGGER user_report_views_touch BEFORE UPDATE ON public.user_report_views
  FOR EACH ROW EXECUTE FUNCTION public.user_report_views_touch();

ALTER TABLE public.user_report_views ENABLE ROW LEVEL SECURITY;

-- Own rows only; a company-scoped view only for a company the user can access (the same
-- membership rule as every other table, user_company_ids()).
CREATE POLICY user_report_views_select ON public.user_report_views FOR SELECT
  USING (user_id = (auth.jwt() ->> 'sub')
         AND (company_id IS NULL OR company_id IN (SELECT public.user_company_ids())));
CREATE POLICY user_report_views_insert ON public.user_report_views FOR INSERT
  WITH CHECK (user_id = (auth.jwt() ->> 'sub')
              AND (company_id IS NULL OR company_id IN (SELECT public.user_company_ids())));
CREATE POLICY user_report_views_update ON public.user_report_views FOR UPDATE
  USING (user_id = (auth.jwt() ->> 'sub')
         AND (company_id IS NULL OR company_id IN (SELECT public.user_company_ids())))
  WITH CHECK (user_id = (auth.jwt() ->> 'sub')
              AND (company_id IS NULL OR company_id IN (SELECT public.user_company_ids())));
CREATE POLICY user_report_views_delete ON public.user_report_views FOR DELETE
  USING (user_id = (auth.jwt() ->> 'sub'));

-- Explicit grants (this project has been bitten by missing GRANTs before).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_report_views TO authenticated;
GRANT ALL ON public.user_report_views TO service_role;
REVOKE ALL ON public.user_report_views FROM anon;
REVOKE ALL ON FUNCTION public.user_report_views_touch() FROM PUBLIC, anon, authenticated;

-- ── 2. user_dashboard_layouts: the missing unique constraint (PLT-15) ─────────
-- The Overview saves with upsert(..., { onConflict: 'user_id' }), but user_id had no unique
-- constraint, so Postgres rejected every save (42P10) and the app ignored the error — tile
-- layouts have never persisted (0 rows). 0 rows today, so this adds cleanly.
ALTER TABLE public.user_dashboard_layouts
  ADD CONSTRAINT user_dashboard_layouts_user_id_key UNIQUE (user_id);
