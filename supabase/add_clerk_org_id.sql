-- Run in Supabase SQL Editor before deploying multi-user org support

ALTER TABLE companies ADD COLUMN IF NOT EXISTS clerk_org_id TEXT;
CREATE INDEX IF NOT EXISTS idx_companies_clerk_org_id ON companies(clerk_org_id) WHERE clerk_org_id IS NOT NULL;
