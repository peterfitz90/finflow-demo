-- Applied 2026-10-05 as migration revoke_public_invoker_writers (proposed and dry-run tested the same day).
--
-- The 11 ordinary (SECURITY INVOKER) functions that write still have PUBLIC execute, and five also
-- have an explicit anon grant. They run with the caller's rights, so RLS and table grants already
-- stop a caller without access, but any new role (e.g. mcp_reader) inherits EXECUTE through PUBLIC.
-- Least privilege: only signed-in users (and the service role) may call them.
--
-- authenticated has no grant of its own today (it relies on PUBLIC), so it is granted explicitly
-- here; skipping that would break the app. No api/ code calls any of them (grep 2026-10-05);
-- service_role is granted to match the previous migration's convention.
-- Callers: src/shared/approvals.js (approve_ap_bill, mark_ap_bill_paid, confirm_journal_match),
-- src/shared/invoice.js (claim_invoice_number), src/App.jsx (the rest), all signed in.

revoke execute on function public.approve_ap_bill(uuid, uuid, numeric, text, text, date, text, text, numeric, numeric, date) from public, anon;
revoke execute on function public.mark_ap_bill_paid(uuid, uuid, numeric, date, text)                                     from public, anon;
revoke execute on function public.void_ar_invoice(uuid, uuid)                                                             from public, anon;
revoke execute on function public.confirm_journal_match(uuid, uuid, uuid)                                                 from public, anon;
revoke execute on function public.confirm_settlement(uuid, uuid, text, jsonb, text, text)                                 from public, anon;
revoke execute on function public.claim_invoice_number(uuid, text)                                                        from public, anon;
revoke execute on function public.claim_mailbox_slug(uuid, text)                                                          from public, anon;
revoke execute on function public.regenerate_mailbox_slug(uuid)                                                           from public, anon;
revoke execute on function public.apply_learned_rule(uuid, text, text, text, text, text, text)                            from public, anon;
revoke execute on function public.undo_learned_rule(uuid, uuid, text[], text)                                             from public, anon;
revoke execute on function public.post_asset_disposal(uuid, uuid, date, numeric, numeric, text, numeric)                  from public, anon;

grant execute on function public.approve_ap_bill(uuid, uuid, numeric, text, text, date, text, text, numeric, numeric, date) to authenticated, service_role;
grant execute on function public.mark_ap_bill_paid(uuid, uuid, numeric, date, text)                                     to authenticated, service_role;
grant execute on function public.void_ar_invoice(uuid, uuid)                                                             to authenticated, service_role;
grant execute on function public.confirm_journal_match(uuid, uuid, uuid)                                                 to authenticated, service_role;
grant execute on function public.confirm_settlement(uuid, uuid, text, jsonb, text, text)                                 to authenticated, service_role;
grant execute on function public.claim_invoice_number(uuid, text)                                                        to authenticated, service_role;
grant execute on function public.claim_mailbox_slug(uuid, text)                                                          to authenticated, service_role;
grant execute on function public.regenerate_mailbox_slug(uuid)                                                           to authenticated, service_role;
grant execute on function public.apply_learned_rule(uuid, text, text, text, text, text, text)                            to authenticated, service_role;
grant execute on function public.undo_learned_rule(uuid, uuid, text[], text)                                             to authenticated, service_role;
grant execute on function public.post_asset_disposal(uuid, uuid, date, numeric, numeric, text, numeric)                  to authenticated, service_role;
