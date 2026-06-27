-- Add status column to recurring_journal_runs to distinguish posted vs skipped-locked rows.
-- Safe to run after add_recurring_checklist.sql; existing rows default to 'posted'.

ALTER TABLE recurring_journal_runs
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'posted'
    CHECK (status IN ('posted', 'skipped_locked'));
