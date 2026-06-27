-- Sprint C: Recurring Journals + Self-Completing Checklist
-- Run AFTER add_vat_fields.sql (journals table must exist with vat_code column).

-- ─── RECURRING JOURNALS ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS recurring_journals (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           UUID        NOT NULL,
  name                 TEXT        NOT NULL,
  debit_account        TEXT        NOT NULL,
  credit_account       TEXT        NOT NULL,
  amount               NUMERIC(12,2) NOT NULL,
  vat_code             TEXT        CHECK (vat_code IN ('STD23','RED13','RED9','ZERO','EXEMPT','RC','NONE')),
  description_template TEXT        NOT NULL DEFAULT '',
  day_of_month         INTEGER     NOT NULL CHECK (day_of_month BETWEEN 1 AND 28),
  start_date           DATE        NOT NULL,
  end_date             DATE,
  journal_type         TEXT        NOT NULL DEFAULT 'standard'
                                   CHECK (journal_type IN ('standard','accrual')),
  active               BOOLEAN     NOT NULL DEFAULT true,
  created_at           TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS recurring_journal_runs (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  recurring_journal_id UUID        NOT NULL REFERENCES recurring_journals(id) ON DELETE CASCADE,
  period               TEXT        NOT NULL,   -- 'YYYY-MM'
  journal_id           UUID,                   -- posted journal id (NULL until posted)
  posted_at            TIMESTAMPTZ DEFAULT now(),
  UNIQUE (recurring_journal_id, period)
);

-- Columns added to journals so postings can be traced back to their template
ALTER TABLE journals
  ADD COLUMN IF NOT EXISTS source_recurring_id   UUID    REFERENCES recurring_journals(id),
  ADD COLUMN IF NOT EXISTS is_accrual_reversal   BOOLEAN NOT NULL DEFAULT false;

-- RLS
ALTER TABLE recurring_journals       ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_journal_runs   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company members can manage recurring_journals"
  ON recurring_journals FOR ALL
  USING (
    company_id IN (
      SELECT id FROM companies WHERE clerk_user_id = auth.jwt() ->> 'sub'
    )
  );

CREATE POLICY "company members can manage recurring_journal_runs"
  ON recurring_journal_runs FOR ALL
  USING (
    recurring_journal_id IN (
      SELECT id FROM recurring_journals
      WHERE company_id IN (
        SELECT id FROM companies WHERE clerk_user_id = auth.jwt() ->> 'sub'
      )
    )
  );

-- ─── SELF-COMPLETING CHECKLIST ────────────────────────────────────────────────

-- completion_condition: code evaluated by the client engine; NULL = manual-only item
-- completed_by: 'system' when auto-completed, NULL when manually ticked/unticked
-- pinned_manual: true when user explicitly un-ticks an auto-completed item —
--   prevents the engine from re-ticking it automatically
ALTER TABLE checklists
  ADD COLUMN IF NOT EXISTS completion_condition TEXT,
  ADD COLUMN IF NOT EXISTS completed_by         TEXT,
  ADD COLUMN IF NOT EXISTS pinned_manual        BOOLEAN NOT NULL DEFAULT false;
