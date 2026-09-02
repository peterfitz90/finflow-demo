-- Adds the ros_efiler flag to companies.
-- This column was defined in add_vat_fields.sql but that migration was never applied.
-- Safe to run on live DB: IF NOT EXISTS means no-op if somehow already present.
-- Default false means existing companies are treated as non-ROS-eFilers (correct).

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS ros_efiler BOOLEAN NOT NULL DEFAULT false;
