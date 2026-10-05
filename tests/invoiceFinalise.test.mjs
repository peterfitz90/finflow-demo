// finaliseInvoice issues an invoice through ONE database call (finalise_invoice), so a failure
// can't leave a claimed number behind. Refusals it can detect up front make no call at all.
// Uses a fake Supabase client that records every call. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finaliseInvoice, toLineRows } from '../src/shared/invoice.js';

function fakeSupabase(rpcResult = { data: { invoice_number: 'INV-007', journal_ids: ['j1', 'j2'], total: 134.35 }, error: null }) {
  const calls = [];
  return {
    calls,
    rpc: async (name, args) => { calls.push(['rpc', name, args]); return rpcResult; },
    from: table => { calls.push(['from', table]); throw new Error('finaliseInvoice must not write tables directly'); },
  };
}

const customers = [{ id: 'c1', name: 'Acme' }];
const lines = [
  { description: 'Work', quantity: '2', unit_price: '50', vat_code: 'STD23', line_total: 100, vat_amount: 23, gross_total: 123, _ui: 'x' },
  { description: 'Food', quantity: 1, unit_price: 10, vat_code: 'RED13', line_total: '10', vat_amount: '1.35', gross_total: '11.35' },
];

test('unsaved draft is refused with no database call (no number claimed)', async () => {
  const sb = fakeSupabase();
  await assert.rejects(finaliseInvoice(sb, 'co1', { customer_id: 'c1', issue_date: '2026-10-05' }, lines, customers, {}), /Save draft first/);
  assert.equal(sb.calls.length, 0);
});

test('missing customer is refused with no database call', async () => {
  const sb = fakeSupabase();
  await assert.rejects(finaliseInvoice(sb, 'co1', { id: 'inv1', customer_id: 'gone', issue_date: '2026-10-05' }, lines, customers, {}), /Customer not found/);
  assert.equal(sb.calls.length, 0);
});

test('saved draft → exactly one call, to finalise_invoice, with coerced lines and terms', async () => {
  const sb = fakeSupabase();
  const r = await finaliseInvoice(sb, 'co1', { id: 'inv1', customer_id: 'c1', issue_date: '2026-10-05', payment_terms: 14 }, lines, customers, { payment_terms: 30 });
  assert.equal(sb.calls.length, 1);
  const [kind, name, args] = sb.calls[0];
  assert.equal(kind, 'rpc'); assert.equal(name, 'finalise_invoice');
  assert.equal(args.p_company_id, 'co1'); assert.equal(args.p_invoice_id, 'inv1'); assert.equal(args.p_payment_terms, 14);
  assert.deepEqual(args.p_lines, toLineRows(lines));
  assert.deepEqual(args.p_lines[0], { description: 'Work', quantity: 2, unit_price: 50, vat_code: 'STD23', line_total: 100, vat_amount: 23, gross_total: 123 });
  assert.equal(args.p_lines[1].gross_total, 11.35);
  assert.deepEqual(r, { numStr: 'INV-007', jids: ['j1', 'j2'] });
});

test('payment terms fall back to settings, then 30', async () => {
  const sb1 = fakeSupabase();
  await finaliseInvoice(sb1, 'co1', { id: 'inv1', customer_id: 'c1' }, lines, customers, { payment_terms: 21 });
  assert.equal(sb1.calls[0][2].p_payment_terms, 21);
  const sb2 = fakeSupabase();
  await finaliseInvoice(sb2, 'co1', { id: 'inv1', customer_id: 'c1' }, lines, customers, {});
  assert.equal(sb2.calls[0][2].p_payment_terms, 30);
});

test('a database refusal (e.g. filed VAT period) is surfaced as the error message', async () => {
  const sb = fakeSupabase({ data: null, error: { message: 'Period is locked — this date falls inside a filed VAT return' } });
  await assert.rejects(finaliseInvoice(sb, 'co1', { id: 'inv1', customer_id: 'c1' }, lines, customers, {}), /Period is locked/);
  assert.equal(sb.calls.length, 1);
});
