-- suggested_journals: stores AI-detected draft journal suggestions for human review.
-- Nothing posts automatically; every row must be explicitly approved by a user.
--
-- DO NOT run this file manually — apply via Supabase dashboard or migration CLI.

CREATE TABLE IF NOT EXISTS suggested_journals (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID          NOT NULL,
  period          TEXT          NOT NULL,            -- 'YYYY-MM'
  type            TEXT          NOT NULL,            -- 'missing_accrual' | 'prepayment'
  status          TEXT          NOT NULL DEFAULT 'pending',  -- 'pending' | 'approved' | 'rejected'

  -- Draft journal entry (always balanced: DR debit_account / CR credit_account)
  debit_account   TEXT          NOT NULL,
  credit_account  TEXT          NOT NULL,
  amount          NUMERIC(12,2) NOT NULL,
  description     TEXT,
  date            DATE,

  -- Plain-English explanation of why this was suggested
  rationale       TEXT,

  -- Engine metadata: used to schedule reversals / recurring releases on approval
  -- missing_accrual: { code, accountName, avgAmount, monthsPosted, topDescription, recentAmounts }
  -- prepayment:      { code, accountName, totalAmount, spreadMonths, futureMonths, monthlyAmount, sourceDesc }
  meta            JSONB,

  rejected_reason TEXT,
  created_at      TIMESTAMPTZ   DEFAULT now()
);

-- Open access consistent with rest of app (anon key, RLS disabled)
ALTER TABLE suggested_journals DISABLE ROW LEVEL SECURITY;
GRANT ALL ON suggested_journals TO anon;

-- Indexes for the two main query patterns
CREATE INDEX IF NOT EXISTS suggested_journals_company_period
  ON suggested_journals (company_id, period);

CREATE INDEX IF NOT EXISTS suggested_journals_status
  ON suggested_journals (company_id, status);
