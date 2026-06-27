-- Per-user dashboard layout persistence.
-- Stores an ordered array of tile ids with visibility flags, keyed to user_id.
-- DO NOT run this file manually — apply via Supabase dashboard or migration CLI.

CREATE TABLE IF NOT EXISTS user_dashboard_layouts (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    TEXT        NOT NULL,
  layout     JSONB       NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- One row per user; upsert pattern in app uses this index for conflict resolution.
CREATE UNIQUE INDEX IF NOT EXISTS user_dashboard_layouts_user_id
  ON user_dashboard_layouts (user_id);

-- Open access consistent with rest of app (anon key, RLS disabled).
ALTER TABLE user_dashboard_layouts DISABLE ROW LEVEL SECURITY;
GRANT ALL ON user_dashboard_layouts TO anon;
