-- Journal attachments: file storage metadata table + private storage bucket.
-- Run this in Supabase SQL Editor AFTER creating the storage bucket (see below).
--
-- Storage bucket (create via Dashboard > Storage, or run the INSERT below):
--   Name:    journal-attachments
--   Public:  false
--   Max file size: 10 MB
--   Allowed MIME types: application/pdf, image/jpeg, image/png, image/webp, image/gif

-- ── Storage bucket ────────────────────────────────────────────────────────────
-- Supabase allows bucket creation via SQL on the storage schema.
-- If you prefer the Dashboard, create the bucket manually and skip this block.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'journal-attachments',
  'journal-attachments',
  false,
  10485760,
  ARRAY['application/pdf','image/jpeg','image/png','image/webp','image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS policies.
-- The app uses a plain anon-key Supabase client (no Supabase auth / JWT injection).
-- Security model: private bucket (no public URLs) + signed URLs that expire,
-- file paths embed company_id/journal_id so they are not guessable.

DROP POLICY IF EXISTS "anon can upload journal attachments" ON storage.objects;
CREATE POLICY "anon can upload journal attachments"
  ON storage.objects FOR INSERT TO anon
  WITH CHECK (bucket_id = 'journal-attachments');

DROP POLICY IF EXISTS "anon can read journal attachments" ON storage.objects;
CREATE POLICY "anon can read journal attachments"
  ON storage.objects FOR SELECT TO anon
  USING (bucket_id = 'journal-attachments');

DROP POLICY IF EXISTS "anon can delete journal attachments" ON storage.objects;
CREATE POLICY "anon can delete journal attachments"
  ON storage.objects FOR DELETE TO anon
  USING (bucket_id = 'journal-attachments');

-- ── Metadata table ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS journal_attachments (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_id  UUID        NOT NULL REFERENCES journals(id) ON DELETE CASCADE,
  company_id  UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  file_name   TEXT        NOT NULL,
  file_path   TEXT        NOT NULL UNIQUE,   -- storage object key: {company_id}/{journal_id}/{uuid}.{ext}
  mime_type   TEXT        NOT NULL,
  file_size   INTEGER     NOT NULL CHECK (file_size > 0),
  uploaded_by TEXT,                          -- Clerk user ID
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jatt_journal_id ON journal_attachments(journal_id);
CREATE INDEX IF NOT EXISTS idx_jatt_company_id ON journal_attachments(company_id);

-- Match the existing pattern for app tables: anon key has full access,
-- access control enforced at the application layer.
ALTER TABLE journal_attachments DISABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE journal_attachments TO anon;
