-- Adds the sales_vat_rate column to companies.
-- This column was defined in add_revenue_providers.sql but that migration was never applied.
-- Safe to run on live DB: IF NOT EXISTS means no-op if somehow already present.
-- Default 23 matches the fallback in code — existing companies get 23% until explicitly changed.

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS sales_vat_rate NUMERIC(5,2) NOT NULL DEFAULT 23;
