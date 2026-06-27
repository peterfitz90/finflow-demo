-- Revenue feed framework: provider connections, raw events, and review queue.
-- DO NOT run this file manually — apply via Supabase dashboard or migration CLI.

-- ── companies: default sales VAT rate for clearing-account journals ─────────
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS sales_vat_rate NUMERIC(5,2) NOT NULL DEFAULT 23;

-- ── provider_connections: one row per payment provider per company ───────────
CREATE TABLE IF NOT EXISTS provider_connections (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID        NOT NULL,
  provider         TEXT        NOT NULL,            -- 'stripe' | 'gocardless' | 'square' | 'paypal'
  status           TEXT        NOT NULL DEFAULT 'active',  -- 'active' | 'disconnected'
  credentials_enc  TEXT,                            -- AES-256-GCM encrypted JSON (api_key, signing_secret)
  webhook_secret_hint TEXT,                         -- last-4 hint shown in UI
  display_name     TEXT,                            -- Stripe account display name
  last_event_at    TIMESTAMPTZ,
  -- Nominal account overrides (fall back to GL defaults when null)
  acc_sales        TEXT        NOT NULL DEFAULT '4000',
  acc_clearing     TEXT        NOT NULL DEFAULT '1300',
  acc_fees         TEXT        NOT NULL DEFAULT '6500',
  acc_bank         TEXT        NOT NULL DEFAULT '1000',
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS provider_connections_company_provider
  ON provider_connections (company_id, provider)
  WHERE status != 'disconnected';

ALTER TABLE provider_connections DISABLE ROW LEVEL SECURITY;
GRANT ALL ON provider_connections TO anon;

-- ── revenue_events: one row per raw Stripe / GoCardless event ────────────────
CREATE TABLE IF NOT EXISTS revenue_events (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID        NOT NULL,
  provider       TEXT        NOT NULL,
  connection_id  UUID        REFERENCES provider_connections(id),
  external_id    TEXT        NOT NULL,              -- Stripe event id — idempotency key
  event_type     TEXT        NOT NULL,              -- 'charge' | 'refund' | 'payout'
  occurred_at    TIMESTAMPTZ NOT NULL,
  currency       TEXT        NOT NULL DEFAULT 'EUR',
  gross          NUMERIC(12,2) NOT NULL DEFAULT 0,
  fee            NUMERIC(12,2) NOT NULL DEFAULT 0,
  vat            NUMERIC(12,2) NOT NULL DEFAULT 0,
  net            NUMERIC(12,2) NOT NULL DEFAULT 0,
  customer_ref   TEXT,
  description    TEXT,
  raw_payload    JSONB,
  review_item_id UUID,                              -- FK filled when event is linked to a review item
  processed      BOOLEAN     NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS revenue_events_external_id ON revenue_events (external_id);
CREATE INDEX IF NOT EXISTS revenue_events_company_period ON revenue_events (company_id, occurred_at);

ALTER TABLE revenue_events DISABLE ROW LEVEL SECURITY;
GRANT ALL ON revenue_events TO anon;

-- ── revenue_review_items: human-in-the-loop approval queue ───────────────────
CREATE TABLE IF NOT EXISTS revenue_review_items (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID        NOT NULL,
  provider         TEXT        NOT NULL,
  connection_id    UUID        REFERENCES provider_connections(id),
  item_type        TEXT        NOT NULL,            -- 'weekly_summary' | 'payout'
  period_label     TEXT,                            -- e.g. 'W24 2026' or '2026-06-19'
  week_start       DATE,
  week_end         DATE,
  status           TEXT        NOT NULL DEFAULT 'pending',  -- 'pending' | 'approved' | 'rejected'
  -- Aggregates for weekly_summary
  charge_count     INTEGER     NOT NULL DEFAULT 0,
  charge_gross     NUMERIC(12,2) NOT NULL DEFAULT 0,
  charge_net       NUMERIC(12,2) NOT NULL DEFAULT 0,
  charge_vat       NUMERIC(12,2) NOT NULL DEFAULT 0,
  fee_total        NUMERIC(12,2) NOT NULL DEFAULT 0,
  refund_count     INTEGER     NOT NULL DEFAULT 0,
  refund_gross     NUMERIC(12,2) NOT NULL DEFAULT 0,
  -- Payout fields
  payout_amount    NUMERIC(12,2),
  payout_date      DATE,
  bank_transaction_id UUID,                         -- linked bank_transaction after recon
  -- User overrides (can differ from connection defaults)
  overrides        JSONB,
  notes            TEXT,
  rejected_reason  TEXT,
  journal_ids      UUID[],                          -- posted journal UUIDs
  approved_by      TEXT,                            -- Clerk user id
  approved_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS revenue_review_items_company_status
  ON revenue_review_items (company_id, status);

ALTER TABLE revenue_review_items DISABLE ROW LEVEL SECURITY;
GRANT ALL ON revenue_review_items TO anon;
