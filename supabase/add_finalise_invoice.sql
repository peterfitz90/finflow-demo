-- finalise_invoice: issue a draft invoice or credit note in ONE transaction: replace its lines,
-- claim the next number, post the sales journals and mark it sent. Any failure (period lock, RLS,
-- a constraint, a dropped connection mid-call) rolls back everything, the number claim
-- included, so a number is only ever consumed by an invoice that was actually issued.
--
-- Before this, src/shared/invoice.js did the same steps as four separate requests from the
-- browser; a failure after the claim left a gap (e.g. an issue date inside a filed VAT period:
-- the journal insert was refused and ignored, then the invoice update was refused, and the
-- number was gone) or journals for an invoice that stayed a draft.
--
-- SECURITY INVOKER on purpose: the caller's RLS and the period-lock triggers still apply. Same
-- rules as before: any company member may finalise (the UI offers it to accountants only).
-- Lines arrive already coerced by the client (upsertInvoiceLines' mapping); totals are computed
-- here from the lines being saved, so the stored totals always match the stored lines.

create or replace function public.finalise_invoice(p_company_id uuid, p_invoice_id uuid, p_lines jsonb, p_payment_terms int)
returns jsonb language plpgsql security invoker set search_path to 'public' as $$
declare
  v_inv      public.invoices;
  v_cust     text;
  v_is_cn    boolean;
  v_num      text;
  v_sub      numeric;
  v_vat      numeric;
  v_total    numeric;
  v_jids     uuid[];
begin
  if not coalesce(p_company_id in (select public.user_company_ids()), false) then
    raise exception 'Forbidden — no access to this company';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'An invoice needs at least one line';
  end if;

  select * into v_inv from public.invoices where id = p_invoice_id and company_id = p_company_id for update;
  if not found then raise exception 'Save draft first'; end if;
  if v_inv.status <> 'draft' then raise exception 'Only a draft can be finalised (this one is %)', v_inv.status; end if;
  if v_inv.issue_date is null then raise exception 'Set an issue date before finalising'; end if;
  select name into v_cust from public.customers where id = v_inv.customer_id and company_id = p_company_id;
  if v_cust is null then raise exception 'Customer not found — please close this form, reload, and try again'; end if;
  v_is_cn := v_inv.type = 'credit_note';

  -- 1. lines
  delete from public.invoice_lines where invoice_id = p_invoice_id;
  insert into public.invoice_lines (invoice_id, sort_order, description, quantity, unit_price, vat_code, line_total, vat_amount, gross_total)
  select p_invoice_id, (l.ord - 1)::int, l.v->>'description', coalesce((l.v->>'quantity')::numeric, 1), coalesce((l.v->>'unit_price')::numeric, 0),
         l.v->>'vat_code', coalesce((l.v->>'line_total')::numeric, 0), coalesce((l.v->>'vat_amount')::numeric, 0), coalesce((l.v->>'gross_total')::numeric, 0)
  from jsonb_array_elements(p_lines) with ordinality as l(v, ord);

  select round(coalesce(sum(line_total), 0), 2), round(coalesce(sum(vat_amount), 0), 2), round(coalesce(sum(gross_total), 0), 2)
    into v_sub, v_vat, v_total from public.invoice_lines where invoice_id = p_invoice_id;

  -- 2. number (same counter as before; rolled back with everything else on failure)
  v_num := public.claim_invoice_number(p_company_id, case when v_is_cn then 'cn' else 'inv' end);

  -- 3. journals: DR 1100 / CR 4000 (reversed for a credit note), one per VAT code, gross amounts
  with ins as (
    insert into public.journals (company_id, date, description, debit_account, credit_account, amount, vat_code, reference, source_recurring_id, is_accrual_reversal)
    select p_company_id, v_inv.issue_date,
           (case when v_is_cn then 'Credit Note ' else 'Invoice ' end) || v_num || ' — ' || v_cust,
           case when v_is_cn then '4000' else '1100' end,
           case when v_is_cn then '1100' else '4000' end,
           abs(round(sum(gross_total), 2)), vc, v_num, null, false
    from (select coalesce(vat_code, 'STD23') vc, gross_total from public.invoice_lines where invoice_id = p_invoice_id) g
    group by vc
    returning id)
  select coalesce(array_agg(id), '{}') into v_jids from ins;

  -- 4. the invoice itself
  update public.invoices set
    invoice_ref = v_num, invoice_number = v_num, status = 'sent',
    subtotal = v_sub, vat_total = v_vat, total = v_total, amount = v_total,
    client = v_cust,
    invoice_date = v_inv.issue_date,
    due_date_calc = case when v_is_cn then null else v_inv.issue_date + coalesce(p_payment_terms, 30) end,
    payment_terms = coalesce(p_payment_terms, 30),
    journal_ids = v_jids,
    updated_at = now()
  where id = p_invoice_id;

  return jsonb_build_object('invoice_number', v_num, 'journal_ids', to_jsonb(v_jids), 'total', v_total);
end;
$$;

revoke execute on function public.finalise_invoice(uuid, uuid, jsonb, int) from public, anon;
grant execute on function public.finalise_invoice(uuid, uuid, jsonb, int) to authenticated, service_role;
