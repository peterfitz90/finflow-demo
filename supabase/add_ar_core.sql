-- AR Core: invoice branding, customers, sequential numbering, line items.
-- Extends the existing invoices table and adds the supporting tables.
-- DO NOT run manually — apply via Supabase dashboard or migration CLI.

-- ── invoice_settings: per-company branding ───────────────────────────────────
CREATE TABLE IF NOT EXISTS invoice_settings (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID        NOT NULL UNIQUE,
  logo_url      TEXT,
  trading_name  TEXT,
  address       TEXT,
  vat_number    TEXT,
  reg_number    TEXT,
  payment_terms INTEGER     NOT NULL DEFAULT 30,
  bank_details  TEXT,
  footer_notes  TEXT,
  stmt_rct      TEXT,
  stmt_rc_eu    TEXT,
  stmt_exempt   TEXT,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE invoice_settings DISABLE ROW LEVEL SECURITY;
GRANT ALL ON invoice_settings TO anon;

-- ── customers ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customers (
  id            UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID    NOT NULL,
  name          TEXT    NOT NULL,
  address       TEXT,
  email         TEXT,
  vat_number    TEXT,
  contact_name  TEXT,
  phone         TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customers_company_id ON customers (company_id);
ALTER TABLE customers DISABLE ROW LEVEL SECURITY;
GRANT ALL ON customers TO anon;

-- ── invoice_sequences: atomic gap-free numbering ─────────────────────────────
CREATE TABLE IF NOT EXISTS invoice_sequences (
  company_id UUID    PRIMARY KEY,
  next_inv   INTEGER NOT NULL DEFAULT 1,
  next_cn    INTEGER NOT NULL DEFAULT 1
);
ALTER TABLE invoice_sequences DISABLE ROW LEVEL SECURITY;
GRANT ALL ON invoice_sequences TO anon;

-- Postgres function — called via supabase.rpc('claim_invoice_number', {...})
-- Returns e.g. 'INV-003' or 'CN-001'. Guaranteed no gaps under concurrent load.
CREATE OR REPLACE FUNCTION claim_invoice_number(p_company_id UUID, p_type TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  v_next   INTEGER;
  v_prefix TEXT;
BEGIN
  INSERT INTO invoice_sequences (company_id, next_inv, next_cn)
  VALUES (p_company_id, 1, 1)
  ON CONFLICT (company_id) DO NOTHING;

  IF p_type = 'inv' THEN
    UPDATE invoice_sequences SET next_inv = next_inv + 1
    WHERE company_id = p_company_id
    RETURNING next_inv - 1 INTO v_next;
    v_prefix := 'INV';
  ELSE
    UPDATE invoice_sequences SET next_cn = next_cn + 1
    WHERE company_id = p_company_id
    RETURNING next_cn - 1 INTO v_next;
    v_prefix := 'CN';
  END IF;

  RETURN v_prefix || '-' || LPAD(v_next::TEXT, 3, '0');
END;
$$;

-- ── invoices: extend existing table ──────────────────────────────────────────
-- The old columns (invoice_ref, client, amount, invoice_date, due_date, status)
-- are preserved; new columns are added alongside.
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS company_id       UUID,
  ADD COLUMN IF NOT EXISTS customer_id      UUID REFERENCES customers(id),
  ADD COLUMN IF NOT EXISTS type             TEXT NOT NULL DEFAULT 'invoice',
  ADD COLUMN IF NOT EXISTS invoice_number   TEXT,
  ADD COLUMN IF NOT EXISTS credit_note_for  UUID REFERENCES invoices(id),
  ADD COLUMN IF NOT EXISTS issue_date       DATE,
  ADD COLUMN IF NOT EXISTS due_date_calc    DATE,
  ADD COLUMN IF NOT EXISTS reference        TEXT,
  ADD COLUMN IF NOT EXISTS payment_terms    INTEGER,
  ADD COLUMN IF NOT EXISTS currency         TEXT NOT NULL DEFAULT 'EUR',
  ADD COLUMN IF NOT EXISTS subtotal         NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vat_total        NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total            NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS amount_paid      NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notes            TEXT,
  ADD COLUMN IF NOT EXISTS footer           TEXT,
  ADD COLUMN IF NOT EXISTS journal_ids      UUID[],
  ADD COLUMN IF NOT EXISTS sent_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at       TIMESTAMPTZ DEFAULT now();

-- Unique constraint for sequential numbering per company
CREATE UNIQUE INDEX IF NOT EXISTS invoices_company_number
  ON invoices (company_id, invoice_number)
  WHERE invoice_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS invoices_company_status
  ON invoices (company_id, status);

ALTER TABLE invoices DISABLE ROW LEVEL SECURITY;
GRANT ALL ON invoices TO anon;

-- ── invoice_lines: line items ─────────────────────────────────────────────────
-- Forward VAT: line_total = qty * unit_price (ex-VAT); vat_amount = line_total * rate%
CREATE TABLE IF NOT EXISTS invoice_lines (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id  UUID          NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  sort_order  INTEGER       NOT NULL DEFAULT 0,
  description TEXT          NOT NULL,
  quantity    NUMERIC(10,4) NOT NULL DEFAULT 1,
  unit_price  NUMERIC(12,4) NOT NULL DEFAULT 0,   -- ex-VAT
  vat_code    TEXT          NOT NULL DEFAULT 'STD23',
  line_total  NUMERIC(12,2) NOT NULL DEFAULT 0,   -- qty * unit_price
  vat_amount  NUMERIC(12,2) NOT NULL DEFAULT 0,   -- forward VAT
  gross_total NUMERIC(12,2) NOT NULL DEFAULT 0,   -- line_total + vat_amount
  created_at  TIMESTAMPTZ   DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invoice_lines_invoice ON invoice_lines (invoice_id);
ALTER TABLE invoice_lines DISABLE ROW LEVEL SECURITY;
GRANT ALL ON invoice_lines TO anon;
