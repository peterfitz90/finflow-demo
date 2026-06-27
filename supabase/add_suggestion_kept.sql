-- Track whether the user accepted the AI suggestion as-is.
-- NULL = row predates this flag (excluded from autoHandled count, not backfilled).
-- true  = user confirmed the AI's suggestion unchanged → counts as autoHandled.
-- false = user overrode or manually entered → does not count as autoHandled.
ALTER TABLE bank_matches
  ADD COLUMN IF NOT EXISTS suggestion_kept BOOLEAN;
