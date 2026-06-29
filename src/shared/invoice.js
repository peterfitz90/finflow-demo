// AR invoice engine — shared between web (InvoicesTab) and mobile.
// Logic is verbatim from App.jsx; only the closure state (cid, customers) has been
// converted to explicit parameters.
//
// api/_invoice-pdf-doc.js and api/_invoice-html.js keep their own copies of the
// VAT constants — api/ cannot import from src/. That duplication is accepted.

export const INV_VAT_RATES  = { STD23: 23, RED13: 13.5, RED9: 9, ZERO: 0, EXEMPT: 0, RCT: 0, RC_EU: 0 };
export const INV_VAT_LABELS = { STD23: '23%', RED13: '13.5%', RED9: '9%', ZERO: '0% (Zero-rated)', EXEMPT: 'Exempt', RCT: 'RCT – Reverse Charge', RC_EU: 'Reverse Charge (EU B2B)' };

export function calcLineAmounts(line) {
  const qty       = Number(line.quantity)   || 0;
  const unitPrice = Number(line.unit_price) || 0;
  const line_total  = Math.round(qty * unitPrice * 100) / 100;
  const noVat       = line.vat_code === 'EXEMPT' || line.vat_code === 'RCT' || line.vat_code === 'RC_EU';
  const rate        = noVat ? 0 : (INV_VAT_RATES[line.vat_code] ?? 0);
  const vat_amount  = noVat ? 0 : Math.round(line_total * rate) / 100;
  const gross_total = Math.round((line_total + vat_amount) * 100) / 100;
  return { ...line, line_total, vat_amount, gross_total };
}

export function calcInvTotals(lines) {
  const subtotal  = lines.reduce((s, l) => s + (Number(l.line_total)  || 0), 0);
  const vat_total = lines.reduce((s, l) => s + (Number(l.vat_amount)  || 0), 0);
  const total     = lines.reduce((s, l) => s + (Number(l.gross_total) || 0), 0);
  return {
    subtotal:  Math.round(subtotal  * 100) / 100,
    vat_total: Math.round(vat_total * 100) / 100,
    total:     Math.round(total     * 100) / 100,
  };
}

export function vatCodeForRate(rate) {
  const r = Number(rate);
  if (r === 23)   return 'STD23';
  if (r === 13.5) return 'RED13';
  if (r === 9)    return 'RED9';
  if (r === 0)    return 'ZERO';
  return null;
}

// Deletes and re-inserts all line items for an invoice with explicit field
// mapping and Number() coercion. The coercion is a hard-won bug fix — do not tidy.
export async function upsertInvoiceLines(supabase, invoiceId, lines) {
  await supabase.from('invoice_lines').delete().eq('invoice_id', invoiceId);
  if (lines.length) await supabase.from('invoice_lines').insert(lines.map((l, i) => ({
    invoice_id: invoiceId, sort_order: i,
    description: l.description, quantity: Number(l.quantity) || 1,
    unit_price: Number(l.unit_price) || 0, vat_code: l.vat_code,
    line_total: Number(l.line_total) || 0, vat_amount: Number(l.vat_amount) || 0,
    gross_total: Number(l.gross_total) || 0,
  })));
}

// Posts DR 1100 / CR 4000 journals grouped by VAT code. Returns journal IDs.
export async function postJournals(supabase, companyId, inv, lines, customers) {
  const isCN = inv.type === 'credit_note';
  const cust = customers.find(c => c.id === inv.customer_id);
  const groups = {};
  for (const l of lines) { const vc = l.vat_code || 'STD23'; groups[vc] = (groups[vc] || 0) + (Number(l.gross_total) || 0); }
  const rows = Object.entries(groups).map(([vc, gross]) => ({
    company_id: companyId, date: inv.issue_date,
    description: `${isCN ? 'Credit Note' : 'Invoice'} ${inv.invoice_number}${cust ? ' — ' + cust.name : ''}`,
    debit_account:  isCN ? '4000' : '1100',
    credit_account: isCN ? '1100' : '4000',
    amount: Math.abs(Math.round(gross * 100) / 100),
    vat_code: vc, reference: inv.invoice_number,
    source_recurring_id: null, is_accrual_reversal: false,
  }));
  const { data: inserted } = await supabase.from('journals').insert(rows).select('id');
  return (inserted || []).map(j => j.id);
}

// Creates or updates a draft invoice and its line items.
// Returns the invoice UUID (callers store it when creating a new draft).
export async function createInvoiceDraft(supabase, companyId, inv, lines, customers, settings, currency) {
  const totals = calcInvTotals(lines);

  // Resolve client name — null is fine for drafts (constraint only enforces on finalised rows).
  // Error early if customer_id is set but not present in the loaded list.
  let clientName = null;
  if (inv.customer_id) {
    const cust = customers.find(c => c.id === inv.customer_id);
    if (!cust) throw new Error('Selected customer not found — please reload the page and try again');
    clientName = cust.name;
  }

  // Legacy columns (pre-AR-core) that are NOT NULL with no default.
  // invoice_date mirrors issue_date; amount mirrors total (0 for empty drafts).
  const invoice_date = inv.issue_date || new Date().toISOString().slice(0, 10);
  const amount       = totals.total;

  let invId = inv.id;
  if (!invId) {
    const { data: ni, error: ie } = await supabase.from('invoices').insert({
      company_id: companyId, type: inv.type || 'invoice',
      customer_id: inv.customer_id || null,
      client: clientName,
      status: 'draft',
      issue_date: inv.issue_date, invoice_date,
      amount, reference: inv.reference || null,
      notes: inv.notes || null,
      payment_terms: Number(inv.payment_terms ?? settings?.payment_terms ?? 30),
      credit_note_for: inv.credit_note_for || null,
      currency, ...totals,
    }).select('id').single();
    if (ie) throw new Error(ie.message);
    invId = ni.id;
  } else {
    await supabase.from('invoices').update({
      customer_id: inv.customer_id || null,
      client: clientName,
      issue_date: inv.issue_date, invoice_date,
      amount,
      reference: inv.reference || null, notes: inv.notes || null,
      payment_terms: Number(inv.payment_terms ?? settings?.payment_terms ?? 30),
      currency, ...totals, updated_at: new Date().toISOString(),
    }).eq('id', invId);
  }
  await upsertInvoiceLines(supabase, invId, lines);
  return invId;
}

// Claims the next invoice/CN number, re-writes lines, posts journals, stamps
// the invoice as sent. Returns { numStr, jids }.
export async function finaliseInvoice(supabase, companyId, inv, lines, customers, settings) {
  const isCN = inv.type === 'credit_note';
  const { data: numStr, error: numErr } = await supabase.rpc('claim_invoice_number', {
    p_company_id: companyId, p_type: isCN ? 'cn' : 'inv',
  });
  if (numErr) throw new Error('Numbering failed: ' + numErr.message);
  const totals = calcInvTotals(lines);
  if (!inv.id) throw new Error('Save draft first');
  // canFinalise guards require customer_id; verify it's in the loaded list before issuing.
  const finalCust = customers.find(c => c.id === inv.customer_id);
  if (!finalCust) throw new Error('Customer not found — please close this form, reload, and try again');
  await upsertInvoiceLines(supabase, inv.id, lines);
  const jids = await postJournals(supabase, companyId, { ...inv, invoice_number: numStr, ...totals }, lines, customers);
  const terms = Number(inv.payment_terms ?? settings?.payment_terms ?? 30);
  const issueD = new Date(inv.issue_date + 'T00:00:00');
  issueD.setDate(issueD.getDate() + terms);
  const { error: updErr } = await supabase.from('invoices').update({
    invoice_ref: numStr, invoice_number: numStr, status: 'sent', ...totals,
    client: finalCust.name,
    amount: totals.total,
    invoice_date: inv.issue_date || new Date().toISOString().slice(0, 10),
    due_date_calc: !isCN ? issueD.toISOString().slice(0, 10) : null,
    payment_terms: terms, journal_ids: jids, updated_at: new Date().toISOString(),
  }).eq('id', inv.id);
  if (updErr) throw new Error(updErr.message);
  return { numStr, jids };
}
