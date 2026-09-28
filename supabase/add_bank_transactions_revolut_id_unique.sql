-- Database-level backstop against duplicate bank transactions.
-- Applied 2026-09-28 as migration bank_transactions_company_revolut_id_unique.
--
-- revolut_id is the external-id column for every import source (legacy name): Yapily tx.id,
-- Revolut CSV ids, and AIB CSVs' synthetic aibHash. The app-level checks (id + content match)
-- run first; this makes the database the final gate. Both import paths insert
-- bank_transactions BEFORE journals (src/shared/importDedup.js postImportBatch), so a
-- rejected row never leaves an orphaned journal, and a 23505 is handled as "already imported".
--
-- Prerequisite (done 2026-09-28): the one pre-existing clash — two genuine €1 APCOA charges on
-- Heros Gym 2025-01-13 that shared AIB-6613d20c because aibHash didn't include the row index
-- before 2026-06-27 — was re-keyed to AIB-6613d20c-2 (bank transaction + its journal reference).
--
-- NULL revolut_ids stay allowed (NULLs are distinct in a unique constraint).

ALTER TABLE public.bank_transactions
  ADD CONSTRAINT bank_transactions_company_revolut_id_key UNIQUE (company_id, revolut_id);
