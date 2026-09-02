-- Plan entitlements — add plan column to companies
-- Existing companies → 'founder' (zero change for pilots)
-- New companies created via signup → 'pending' (requires manual/Stripe flip to go live)
-- Safe to re-run: IF NOT EXISTS throughout

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'founder'
    CHECK (plan IN ('pending','personal','founder','practice','enterprise'));

-- Explicitly confirm all pre-existing companies are on founder
-- (No-op if already set because DEFAULT handles it, but makes intent explicit)
UPDATE companies SET plan = 'founder' WHERE plan IS NULL;

-- Comment: flip a new company live with:
--   UPDATE companies SET plan = 'founder' WHERE id = '<company-id>';
-- Later, Stripe webhook writes plan='founder' automatically on payment.
