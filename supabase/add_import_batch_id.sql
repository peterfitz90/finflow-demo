-- Run this in the Supabase SQL Editor before deploying the Reverse Import feature

ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS import_batch_id UUID;
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS bank_format TEXT;
ALTER TABLE journals ADD COLUMN IF NOT EXISTS import_batch_id UUID;

-- Optional: index for fast reversal lookups
CREATE INDEX IF NOT EXISTS idx_bank_transactions_batch ON bank_transactions(import_batch_id) WHERE import_batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_journals_batch ON journals(import_batch_id) WHERE import_batch_id IS NOT NULL;
