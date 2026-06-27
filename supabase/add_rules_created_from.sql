-- Add created_from column to transaction_rules
-- Run in Supabase SQL editor before deploying the rules learning loop feature.

ALTER TABLE transaction_rules
  ADD COLUMN IF NOT EXISTS created_from TEXT NOT NULL DEFAULT 'manual'
    CHECK (created_from IN ('manual', 'learned'));
