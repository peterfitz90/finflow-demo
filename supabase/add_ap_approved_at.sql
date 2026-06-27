-- Track when an AP bill was approved from needs_review, for youCleared stats.
-- Run in Supabase SQL editor after extend_ap_invoices.sql.
ALTER TABLE ap_invoices
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
