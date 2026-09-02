-- Links a correcting (reclassification) journal back to the original journal it corrects,
-- for audit trail purposes. NULL on every normal journal — only set on journals created by
-- the GL "Reclassify" action. The original journal is NEVER modified; this column only ever
-- appears on the NEW correcting entry.
ALTER TABLE journals ADD COLUMN IF NOT EXISTS reclass_of_journal_id UUID REFERENCES journals(id);
CREATE INDEX IF NOT EXISTS idx_journals_reclass_of ON journals (reclass_of_journal_id);
