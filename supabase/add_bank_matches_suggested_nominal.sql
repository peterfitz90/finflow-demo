-- Store the AI's originally suggested nominal code on each journal-type bank_match.
-- Populated by the matching engine at suggestion creation time.
-- Used at confirm time to detect whether the user accepted as-is (suggestion_kept).
-- NULL = row predates this column or non-journal match type.
ALTER TABLE bank_matches
  ADD COLUMN IF NOT EXISTS suggested_nominal_code TEXT;
