-- Add created_at to bank_transactions if it doesn't already exist.
-- Run once in the Supabase SQL editor. Safe to re-run (IF NOT EXISTS).

ALTER TABLE public.bank_transactions
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
