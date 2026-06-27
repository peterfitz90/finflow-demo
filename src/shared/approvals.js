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
  const gross   = parseFloat(bill.gross_amount ?? bill.amount ?? 0) || 0;
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

export async function markApBillPaid(companyId, billId, paidAmt, date) {
  const { data, error } = await supabase.rpc('mark_ap_bill_paid', {
    p_company_id: companyId,
    p_bill_id:    billId,
    p_paid_amt:   paidAmt,
    p_date:       date ?? new Date().toISOString().slice(0, 10),
  });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
}
