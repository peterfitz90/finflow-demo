-- Onboarding tracking, PAYE registration flag, and CRO number on companies.
-- Existing companies are backfilled to onboarding_completed = true and paye_registered = true
-- so they retain full compliance calendar visibility after this migration.

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS onboarding_steps     JSONB   NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS paye_registered      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cro_number           TEXT;

-- Backfill: existing set-up companies skip onboarding and keep P30/P35 visible
UPDATE companies
SET onboarding_completed = true,
    paye_registered      = true
WHERE onboarding_completed = false;
