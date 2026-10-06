-- 2026-10-05: hard delete of invoices is for drafts only. A finalised invoice or credit note has a
-- claimed number, posted journals and possibly payments, so it must be voided (void_ar_invoice
-- posts reversing journals) rather than deleted. Previously any company member could delete a
-- document of any status through the API; the UI only offered Delete on drafts but its query had
-- no status filter. The app now also filters .eq('status','draft') (src/App.jsx deleteDraft).
-- No database function deletes invoices; service_role (server code) bypasses RLS and is unaffected.
--
-- Definition as it stood:
--   CREATE POLICY invoices_delete ON public.invoices AS PERMISSIVE FOR DELETE TO public
--     USING (company_id IN (SELECT user_company_ids()));

drop policy if exists invoices_delete on public.invoices;
create policy invoices_delete on public.invoices
  for delete to public
  using (company_id in (select public.user_company_ids()) and status = 'draft');
