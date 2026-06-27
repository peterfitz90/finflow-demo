-- Base / reporting currency support — LIGHT version.
-- Adds base_currency to companies, and RESERVED dormant columns to
-- journals and bank_transactions for a future multi-currency build.
-- Nothing reads or writes the reserved columns beyond their defaults.

-- ── companies ────────────────────────────────────────────────────────────────

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS base_currency TEXT NOT NULL DEFAULT 'EUR';

-- Backfill from existing currency column where present; else default to EUR.
UPDATE companies
SET base_currency = COALESCE(NULLIF(currency, ''), 'EUR')
WHERE base_currency = 'EUR';

-- ── journals (reserved columns — dormant) ────────────────────────────────────

ALTER TABLE journals
  ADD COLUMN IF NOT EXISTS transaction_currency TEXT    NOT NULL DEFAULT 'EUR',
  ADD COLUMN IF NOT EXISTS fx_rate              NUMERIC(10,6) NOT NULL DEFAULT 1.0;

UPDATE journals
SET transaction_currency = 'EUR',
    fx_rate              = 1.0
WHERE transaction_currency = 'EUR';  -- no-op for new rows; safe to re-run

-- ── bank_transactions (reserved columns — dormant) ───────────────────────────

ALTER TABLE bank_transactions
  ADD COLUMN IF NOT EXISTS transaction_currency TEXT    NOT NULL DEFAULT 'EUR',
  ADD COLUMN IF NOT EXISTS fx_rate              NUMERIC(10,6) NOT NULL DEFAULT 1.0;

UPDATE bank_transactions
SET transaction_currency = 'EUR',
    fx_rate              = 1.0
WHERE transaction_currency = 'EUR';
