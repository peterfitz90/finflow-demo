-- Allow invoice drafts to have no client name yet.
-- Mirrors the invoice_ref pattern in fix_invoice_ref_nullable.sql:
--   NULL is permitted while status='draft'; required once finalised.
--
-- Background: client is a legacy denormalised column (pre-AR-core).
-- The source of truth is customer_id → customers.name; client is a cached copy.
-- Drafts can legitimately be created before a customer is chosen; the check
-- constraint ensures the name is populated before the invoice is issued.

ALTER TABLE invoices ALTER COLUMN client DROP NOT NULL;

ALTER TABLE invoices ADD CONSTRAINT invoices_client_required_when_final
  CHECK (status = 'draft' OR client IS NOT NULL);
