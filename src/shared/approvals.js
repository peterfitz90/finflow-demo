import { todayStr, sanitiseDate } from './dates.js';
import { captureError } from '../sentry.js';
/**
 * Shared approval functions — used by both mobile and web.
 * Each function is a thin wrapper over a single Postgres RPC that executes
 * atomically; a mid-chain failure rolls back the entire transaction.
 *
 * confirmBankTxn : RPC confirm_journal_match
 *   Confirms a journal-type bank_match, marks bank_transaction reconciled,
 *   and rejects all other suggestions for the same transaction.
 *
 * approveApBill  : RPC approve_ap_bill
 *   Updates ap_invoices fields + posts accrual journal (Dr expense / Cr 2000).
 *
 * markApBillPaid : RPC mark_ap_bill_paid
 *   Updates ap_invoices status to paid + posts payment journal (Dr 2000 / Cr 1000).
 */
import { supabase } from '../supabase.js';

export async function confirmBankTxn(companyId, matchId, btId) {
  const { data, error } = await supabase.rpc('confirm_journal_match', {
    p_company_id: companyId,
    p_match_id:   matchId,
    p_bt_id:      btId,
  });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
}

export async function approveApBill(bill) {
  // No fallback-to-0 here on purpose: a caller-supplied gross of null/0 must reach the RPC
  // as-is so its own reconciliation guard rejects it, rather than this wrapper silently
  // turning "unknown" into a real zero that then posts (or worse, skips posting) as if it
  // were a legitimate €0 bill. See api/DID-Electrical incident — this exact substitution
  // (bill.gross_amount ?? bill.amount ?? 0) is what put a real €610.06 bill through as €0.
  const gross   = bill.gross_amount != null ? parseFloat(bill.gross_amount) : null;
  const nomCode = bill.suggested_nominal ?? bill.nominal_code ?? '6600';
  const { data, error } = await supabase.rpc('approve_ap_bill', {
    p_company_id:  bill.company_id,
    p_bill_id:     bill.id,
    p_gross:       gross,
    p_nom_code:    nomCode,
    p_vat_code:    bill.vat_code || 'STD23',
    p_date:        bill.invoice_date,
    p_supplier:    bill.supplier     ?? '',
    p_invoice_ref: bill.invoice_ref  ?? '',
    p_net_amount:  parseFloat(bill.net_amount  ?? 0) || null,
    p_vat_amount:  parseFloat(bill.vat_amount  ?? 0) || null,
    p_due_date:    bill.due_date ?? null,
  });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
}

export async function markApBillPaid(companyId, billId, paidAmt, date, bankAccountNominal) {
  const { data, error } = await supabase.rpc('mark_ap_bill_paid', {
    p_company_id: companyId,
    p_bill_id:    billId,
    p_paid_amt:   paidAmt,
    p_date:       date ?? todayStr(),
    p_bank_account_nominal: bankAccountNominal ?? null,
  });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
}

// ── Expenses — moved verbatim from the full app's Expenses page (approve / reject /
// updateNominal) so /mobile's Approvals tab posts exactly the same journal. Each returns
// { ok: true, … } or { ok: false, message } with the message the page shows.

// Credit leg: the company's bank for a company card / bank transfer, else 2000 (owed to the
// person who paid). Debit leg: the expense's nominal, with its VAT code.
export const expenseCreditAccount = (exp, bankNominal) =>
  ["company_card", "bank_transfer"].includes(exp.payment_method) ? bankNominal : "2000";

export async function approveExpense(companyId, exp, bankNominal) {
  const db = supabase;
  const creditAcct = expenseCreditAccount(exp, bankNominal);
  const ref = `EXP-${exp.id.slice(0, 6).toUpperCase()}`;
  const { data: jnl, error: jErr } = await db.from("journals").insert({
    company_id: companyId, date: sanitiseDate(exp.receipt_date),
    description: `Expense: ${exp.supplier}${exp.description ? ` — ${exp.description}` : ""}`,
    debit_account: exp.nominal_account, credit_account: creditAcct,
    // The expense's VAT code, so T2 counts its input VAT (null = not counted, as before).
    amount: exp.amount, reference: ref, vat_code: exp.vat_code || null,
  }).select("id").single();
  if (jErr) {
    // Do NOT mark the expense posted — a blocked insert must not look like a success.
    captureError(jErr, { company_id: companyId, operation: 'expense-approve' });
    return { ok: false, message: /period is locked/i.test(jErr.message)
      ? "This expense's receipt date falls in a locked (filed) period — it can't be posted until the period is unlocked."
      : `Approval failed: ${jErr.message}` };
  }
  const journalId = jnl?.id || null;
  const { error: updErr } = await db.from("expenses").update({ status: "posted", journal_id: journalId }).eq("id", exp.id);
  if (updErr) {
    captureError(updErr, { company_id: companyId, operation: 'expense-approve-status' });
    return { ok: false, message: `Journal posted (ref ${ref}) but marking the expense as posted failed: ${updErr.message} — please refresh and check before re-approving.` };
  }
  return { ok: true, journalId, ref };
}

export async function rejectExpense(exp) {
  const { error } = await supabase.from("expenses").update({ status: "rejected" }).eq("id", exp.id);
  return error ? { ok: false, message: `Couldn't reject: ${error.message}` } : { ok: true };
}

// Corrects an expense's nominal account while it's still status: 'submitted' — persists
// immediately (no draft/save step), so by the time approveExpense reads exp.nominal_account it's
// already right. `acct` = { code, name } from the company's chart.
export async function updateExpenseNominal(exp, acct) {
  const { error } = await supabase.from("expenses")
    .update({ nominal_account: acct.code, nominal_name: acct.name }).eq("id", exp.id);
  return error ? { ok: false, message: `Couldn't update nominal account: ${error.message}` } : { ok: true };
}

// The company's bank nominal for crediting expenses: its active bank account (every live company
// has exactly one), else 1000 — the Expenses page's defaultBankNominal.
export async function fetchExpenseBankNominal(companyId) {
  const { data } = await supabase.from('bank_accounts').select('id, nominal_code').eq('company_id', companyId).eq('is_active', true);
  return data?.[0]?.nominal_code || '1000';
}

// Sets an expense's VAT code while it's still 'submitted' (accountant — the database keeps the
// old code for anyone else, expenses_vat_code_lock). Persists immediately, like the nominal.
export async function updateExpenseVatCode(exp, vatCode) {
  const { error } = await supabase.from("expenses").update({ vat_code: vatCode || null }).eq("id", exp.id);
  return error ? { ok: false, message: `Couldn't update VAT code: ${error.message}` } : { ok: true };
}
