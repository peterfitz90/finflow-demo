-- Allow drafts to have no invoice number; claim_invoice_number is only called on finalise.
-- Run AFTER add_ar_core.sql.

ALTER TABLE invoices ALTER COLUMN invoice_ref DROP NOT NULL;

-- Enforce: once finalised (status != 'draft'), a number is mandatory.
ALTER TABLE invoices ADD CONSTRAINT invoices_ref_required_when_final
  CHECK (status = 'draft' OR invoice_ref IS NOT NULL);
