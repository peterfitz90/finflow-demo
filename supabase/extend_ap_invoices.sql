-- Extend ap_invoices for the AP Mailbox feature.
-- Adds columns for email-sourced invoices: origin tracking, parsed amounts,
-- VAT breakdown, nominal suggestion, line items, and attachment path.

-- ── Drop any existing status CHECK so we can expand allowed values ────────────
DO $$
DECLARE
  v_con TEXT;
BEGIN
  SELECT conname INTO v_con
  FROM pg_constraint
  WHERE conrelid = 'ap_invoices'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%status%';
  IF v_con IS NOT NULL THEN
    EXECUTE format('ALTER TABLE ap_invoices DROP CONSTRAINT %I', v_con);
  END IF;
END $$;

-- ── New columns ───────────────────────────────────────────────────────────────
ALTER TABLE ap_invoices
  ADD COLUMN IF NOT EXISTS source           TEXT            NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS raw_email_id     TEXT,          -- Postmark MessageID for idempotency
  ADD COLUMN IF NOT EXISTS attachment_path  TEXT,          -- storage object key in journal-attachments bucket
  ADD COLUMN IF NOT EXISTS net_amount       NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS vat_amount       NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS gross_amount     NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS vat_rate         TEXT,          -- e.g. "23%", "13.5%"
  ADD COLUMN IF NOT EXISTS currency         TEXT            NOT NULL DEFAULT 'EUR',
  ADD COLUMN IF NOT EXISTS suggested_nominal TEXT,         -- nominal code suggested by AI
  ADD COLUMN IF NOT EXISTS line_items       JSONB,
  ADD COLUMN IF NOT EXISTS new_supplier_flag BOOLEAN       NOT NULL DEFAULT false;

-- Idempotency: each Postmark message may only create one row.
CREATE UNIQUE INDEX IF NOT EXISTS ap_invoices_raw_email_id_key
  ON ap_invoices (raw_email_id)
  WHERE raw_email_id IS NOT NULL;

-- ── Re-add status CHECK with expanded values ──────────────────────────────────
ALTER TABLE ap_invoices
  ADD CONSTRAINT ap_invoices_status_check
  CHECK (status IN ('needs_review','pending','approved','paid','disputed','rejected'));
