// finaliseInvoice must not claim an invoice number when it is going to refuse (unsaved draft,
// missing customer); a saved draft claims exactly one. Uses a fake Supabase client that records
// every call. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finaliseInvoice } from '../src/shared/invoice.js';

function fakeSupabase() {
  const calls = [];
  const chain = (table, op) => {
    const q = {
      delete() { calls.push([table, 'delete']); return q; },
      insert(rows) { calls.push([table, 'insert', rows]); return q; },
      update(v) { calls.push([table, 'update', v]); return q; },
      select() { return q; },
      eq() { return q; },
      then(res) { return Promise.resolve(table === 'journals' ? { data: [{ id: 'j1' }], error: null } : { data: null, error: null }).then(res); },
    };
    return q;
  };
  return {
    calls,
    rpc: async (name, args) => { calls.push(['rpc', name, args]); return { data: 'INV-007', error: null }; },
    from: table => chain(table),
  };
}

const customers = [{ id: 'c1', name: 'Acme' }];
const lines = [{ description: 'Work', quantity: 1, unit_price: 100, vat_code: 'STD23', line_total: 100, vat_amount: 23, gross_total: 123 }];
const rpcCalls = sb => sb.calls.filter(c => c[0] === 'rpc' && c[1] === 'claim_invoice_number');

test('unsaved draft is refused without claiming a number', async () => {
  const sb = fakeSupabase();
  await assert.rejects(finaliseInvoice(sb, 'co1', { customer_id: 'c1', issue_date: '2026-10-05' }, lines, customers, {}), /Save draft first/);
  assert.equal(rpcCalls(sb).length, 0);
  assert.equal(sb.calls.length, 0, 'nothing written at all');
});

test('missing customer is refused without claiming a number', async () => {
  const sb = fakeSupabase();
  await assert.rejects(finaliseInvoice(sb, 'co1', { id: 'inv1', customer_id: 'gone', issue_date: '2026-10-05' }, lines, customers, {}), /Customer not found/);
  assert.equal(rpcCalls(sb).length, 0);
});

test('saved draft claims exactly one number and stamps it on the invoice', async () => {
  const sb = fakeSupabase();
  const r = await finaliseInvoice(sb, 'co1', { id: 'inv1', customer_id: 'c1', issue_date: '2026-10-05', type: 'invoice' }, lines, customers, { payment_terms: 30 });
  assert.equal(rpcCalls(sb).length, 1);
  assert.deepEqual(rpcCalls(sb)[0][2], { p_company_id: 'co1', p_type: 'inv' });
  assert.equal(r.numStr, 'INV-007');
  const upd = sb.calls.find(c => c[0] === 'invoices' && c[1] === 'update')[2];
  assert.equal(upd.invoice_number, 'INV-007');
  assert.equal(upd.status, 'sent');
});

test('credit note claims a CN number', async () => {
  const sb = fakeSupabase();
  await finaliseInvoice(sb, 'co1', { id: 'cn1', customer_id: 'c1', issue_date: '2026-10-05', type: 'credit_note' }, lines, customers, {});
  assert.deepEqual(rpcCalls(sb)[0][2], { p_company_id: 'co1', p_type: 'cn' });
});
