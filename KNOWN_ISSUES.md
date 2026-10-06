# Known issues

Tracked problems that are understood but not yet fixed. Each entry has an ID, a status, what goes wrong,
where, who is affected, and the agreed next step. Close an entry by changing its status to "Fixed in <commit>".

## LOGO-01: invoice logos can never display (public URL for a private bucket)

- **Status:** Open. Logged 2026-10-06; do not fix yet (Peter).
- **What goes wrong:** Settings → Invoice settings → Upload logo stores the file in the
  `journal-attachments` bucket at `logos/<company>.<ext>` (upsert), then saves
  `getPublicUrl(path)` into `invoice_settings.logo_url`. That bucket is private (`public = false`),
  so the public URL always returns 400 "Bucket not found". The settings preview, the invoice HTML
  and the invoice PDF all render a broken or missing image.
- **Where:**
  - `src/App.jsx` `uploadLogo` (around line 13462): upload, then `getPublicUrl`
  - `src/App.jsx` around line 2304: in-app invoice print/preview `<img src={settings.logo_url}>`
  - `api/_invoice-html.js:131`: emailed/HTML invoice
  - `api/_invoice-pdf-doc.js:113`: PDF `Image` (the server fetches the URL, so it fails there too)
- **Who is affected:** nobody yet. `invoice_settings` has 0 rows, so no company has a logo saved.
  It will fail for the first company that uploads one.
- **Not caused by** the 2026-10-05 storage fix (`scope_journal_attachments_storage`). The URL was
  unusable before it, and the upload itself works for members after it (tested: upload and upsert 200).
- **Fix options (to decide):**
  1. Store the storage path, not a URL, and create a short-lived signed URL when rendering
     (client with the user's session; server functions with service_role for the PDF/email).
  2. Move logos to a separate public bucket (e.g. `logos`, public read, member-only write by path).
     Simplest for emailed invoices, but anyone with the URL can fetch the logo.
  3. Embed the logo as a data URI in `invoice_settings` (small images only).
  Whichever is chosen: keep writes scoped by `storage_path_company_id`, extend
  `tests/anon/catalog.json` if a bucket is added, and run `npm run check:anon`.
