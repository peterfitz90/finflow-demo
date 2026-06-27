-- Extend checklists for editability: sort order, optional owner, due offset.
-- Add checklist_template to companies to track which template is in use.
-- Existing seeded checklists are preserved; sort_order is backfilled from
-- insertion order (matches the template section sequence for seeded data).
--
-- DO NOT run this file manually — apply via Supabase dashboard or migration CLI.

-- ── checklists: new columns ────────────────────────────────────────────────────

ALTER TABLE checklists
  ADD COLUMN IF NOT EXISTS sort_order  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS owner       TEXT,
  ADD COLUMN IF NOT EXISTS due_offset  TEXT;

-- Backfill sort_order from insertion order per (company_id, period) partition.
-- Row numbers start at 0 so the first item gets sort_order = 0.
UPDATE checklists AS c
SET sort_order = sub.rn
FROM (
  SELECT id,
    (ROW_NUMBER() OVER (PARTITION BY company_id, period ORDER BY created_at) - 1)::INTEGER AS rn
  FROM checklists
) sub
WHERE c.id = sub.id;

-- ── companies: track which template is loaded ──────────────────────────────────

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS checklist_template TEXT NOT NULL DEFAULT 'basic';

-- Existing companies default to 'basic' — the DEFAULT clause covers them.
-- No explicit UPDATE needed; new rows set via the app after template load.
