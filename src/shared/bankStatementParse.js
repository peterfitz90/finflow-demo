// BNK-14 step 1: bank statement CSV parsing, shared and testable (no React, no Supabase). Used by
// the CSV import (App.jsx BankImport). Every layout here is recognised by its header row; anything
// else is refused as "not a bank statement Ledgrly can read".
//
// Rules (Peter, 8 Oct 2026):
//   - a wrong number never passes silently: an unreadable date or amount is a visible row error,
//     never a 0 or a silently skipped row;
//   - the running balance printed on the statement is checked against the parsed amounts, per row
//     or per day (Bank of Ireland prints one balance per day);
//   - Revolut: the bank movement is "Total amount"; a non-zero Fee becomes its own bank-charges
//     line, so the two lines add up to the movement.
//
// Normalised row (as the import has always used):
//   { revolut_id, date: 'YYYY-MM-DD', description, amount (money in positive), currency,
//     balance (number, or null where the statement prints none), type,
//     nominal_hint? (a fixed coding, e.g. '6500' for a Revolut fee), fee_of? (the paired row id) }

export const FORMAT_LABEL = { aib: 'AIB', revolut: 'Revolut', wise: 'Wise', boi: 'Bank of Ireland' };
export const BANK_CHARGES_NOMINAL = '6500';

// ── CSV ───────────────────────────────────────────────────────────────────────────────────────
// RFC 4180: quoted fields may contain commas, doubled quotes and line breaks. Strips a BOM. Returns
// every non-blank line as a record ({ line, cells, empty }); a line of only commas is kept with
// empty: true, because the AIB id has always counted it.
export function parseCsvRecords(text) {
  const s = String(text || '').replace(/^﻿/, '');
  const out = [];
  let rec = [], field = '', inQ = false, line = 1, recLine = 1;
  const endField = () => { rec.push(field); field = ''; };
  const endRec = () => {
    endField();
    if (rec.length > 1 || rec[0].trim() !== '') out.push({ line: recLine, cells: rec, empty: rec.every(c => c.trim() === '') });
    rec = [];
  };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else { if (c === '\n') line++; field += c; }
      continue;
    }
    if (c === '"') { inQ = true; continue; }
    if (c === ',') { endField(); continue; }
    if (c === '\r') continue;
    if (c === '\n') { endRec(); line++; recLine = line; continue; }
    field += c;
  }
  if (field !== '' || rec.length) endRec();
  return out;
}

// ── Values ────────────────────────────────────────────────────────────────────────────────────
// An amount as printed: optional sign, optional €, thousands commas, up to 2 decimals. Blank is
// `blank` (null by default: "nothing printed"). Anything else is unreadable: { error }.
export function readAmount(raw, { blank = null } = {}) {
  const s = String(raw ?? '').trim();
  if (s === '') return { value: blank };
  const m = s.replace(/[€\s]/g, '').match(/^([+-]?)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/);
  if (!m) return { error: `unreadable amount "${s}"` };
  const v = Number(`${m[1]}${m[2].replace(/,/g, '')}${m[3] ? `.${m[3]}` : ''}`);
  return Number.isFinite(v) ? { value: v } : { error: `unreadable amount "${s}"` };
}

const pad = n => String(n).padStart(2, '0');
const validYMD = (y, m, d) => {
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
};
// DD/MM/YYYY (Irish banks; never MM/DD), optionally followed by a time.
export function readDateDMY(raw) {
  const s = String(raw ?? '').trim().split(' ')[0];
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return { error: `unreadable date "${String(raw ?? '').trim()}"` };
  const [d, mo, y] = [+m[1], +m[2], +m[3]];
  return validYMD(y, mo, d) ? { value: `${y}-${pad(mo)}-${pad(d)}` } : { error: `invalid date "${s}"` };
}
// Revolut: "DD/MM/YYYY HH:MM:SS" or ISO "YYYY-MM-DD…".
export function readDateRevolut(raw) {
  const s = String(raw ?? '').trim().split(' ')[0];
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return validYMD(+iso[1], +iso[2], +iso[3]) ? { value: `${iso[1]}-${iso[2]}-${iso[3]}` } : { error: `invalid date "${s}"` };
  return readDateDMY(s);
}
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
// "05 Jan 2026", or DD-MM-YYYY, or DD/MM/YYYY (Wise).
export function readDateWise(raw) {
  const s = String(raw ?? '').trim();
  const t = s.match(/^(\d{1,2})[ -]([A-Za-z]{3})[a-z]*[ -](\d{4})$/);
  if (t && MONTHS[t[2].toLowerCase()]) {
    const [d, mo, y] = [+t[1], MONTHS[t[2].toLowerCase()], +t[3]];
    return validYMD(y, mo, d) ? { value: `${y}-${pad(mo)}-${pad(d)}` } : { error: `invalid date "${s}"` };
  }
  const dash = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (dash) return readDateDMY(`${dash[1]}/${dash[2]}/${dash[3]}`);
  return readDateDMY(s);
}

// djb2-style 32-bit hash (unchanged from the AIB import, so existing AIB ids stay the same).
export function hash32(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
  return (h >>> 0).toString(16).padStart(8, '0');
}
const normDesc = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// ── Layouts ───────────────────────────────────────────────────────────────────────────────────
const H = s => String(s || '').trim().toLowerCase();
const has = (headers, ...names) => names.every(n => headers.includes(H(n)));

export function detectFormat(headerCells) {
  const h = headerCells.map(H);
  if (has(h, 'Posted Transactions Date', 'Debit Amount', 'Credit Amount')) return 'aib';
  if (has(h, 'Date completed (UTC)', 'Amount', 'Balance')) return 'revolut';
  if (has(h, 'Transaction_ID', 'Incoming_EUR', 'Outgoing_EUR', 'Balance_EUR')) return 'wise';
  if (has(h, 'TransferWise ID', 'Amount', 'Running Balance')) return 'wise';
  if (h.length >= 5 && has(h, 'Date', 'Details', 'Debit', 'Credit', 'Balance')) return 'boi';
  return null;
}

// Rows in date order (oldest first). Statements come either way round; within a day the file's own
// order is kept (reversed with the file when it is newest first).
function chronological(rows) {
  if (rows.length < 2) return rows;
  return rows[0].date > rows[rows.length - 1].date ? [...rows].reverse() : rows;
}

// Stable ids for layouts without the bank's own transaction id: the same line in two overlapping
// files gets the same id. n counts identical lines (same date, amount and description) in order.
function contentIds(prefix, rows) {
  const seen = new Map();
  for (const r of rows) {
    const key = `${r.date}|${r.amount.toFixed(2)}|${normDesc(r.description)}`;
    const n = (seen.get(key) || 0) + 1;
    seen.set(key, n);
    r.revolut_id = `${prefix}-${hash32(`${key}|${n}`)}`;
  }
  return rows;
}

function parseAIB(records, idx) {
  const rows = [], errors = [];
  records.slice(1).forEach((rec, k) => {
    const i = k + 1; // position among non-blank lines, as the AIB id has always used
    if (rec.empty) return;
    const c = rec.cells.map(x => x.trim());
    const date = readDateDMY(c[idx('Posted Transactions Date')]);
    const credit = readAmount(c[idx('Credit Amount')], { blank: 0 });
    const debit = readAmount(c[idx('Debit Amount')], { blank: 0 });
    const bal = readAmount(c[idx('Balance')]);
    const description = [c[idx('Description1')], c[idx('Description2')], c[idx('Description3')]].filter(Boolean).join(' ');
    const errs = [date.error, credit.error, debit.error, bal.error].filter(Boolean);
    if (errs.length) { errors.push({ line: rec.line, message: errs.join('; '), raw: { date: c[idx('Posted Transactions Date')], description, debit: c[idx('Debit Amount')], credit: c[idx('Credit Amount')] } }); return; }
    const amount = credit.value - debit.value;
    rows.push({ revolut_id: `AIB-${hash32(`${date.value}|${description}|${amount}|${i}`)}`, date: date.value, description, amount,
      currency: c[idx('Posted Currency')] || 'EUR', balance: bal.value, type: c[idx('Transaction Type')] || '' });
  });
  return { rows: chronological(rows), errors };
}

function parseRevolut(records, idx) {
  const rows = [], errors = [];
  const totalI = idx('Total amount'), feeI = idx('Fee');
  for (const rec of records.slice(1)) {
    if (rec.empty) continue;
    const c = rec.cells.map(x => x.trim());
    if ((c[idx('State')] || '').toUpperCase() !== 'COMPLETED') continue;
    const id = c[idx('ID')];
    const description = c[idx('Description')] || '';
    const date = readDateRevolut(c[idx('Date completed (UTC)')]);
    const amt = readAmount(c[idx('Amount')]);
    const fee = feeI >= 0 ? readAmount(c[feeI], { blank: 0 }) : { value: 0 };
    const bal = readAmount(c[idx('Balance')]);
    const errs = [date.error, amt.error, fee.error, bal.error, !id && 'no transaction ID', amt.value == null && !amt.error && 'no amount'].filter(Boolean);
    if (!errs.length && totalI >= 0) {
      const tot = readAmount(c[totalI]);
      if (tot.error) errs.push(tot.error);
      else if (tot.value != null && Math.abs(tot.value - (amt.value + fee.value)) >= 0.005) errs.push(`Total amount ${tot.value} is not Amount ${amt.value} plus Fee ${fee.value}`);
    }
    if (errs.length) { errors.push({ line: rec.line, message: errs.join('; '), raw: { date: c[idx('Date completed (UTC)')], description, amount: c[idx('Amount')] } }); continue; }
    const currency = c[idx('Currency')] || c[idx('Payment currency')] || 'EUR';
    const type = c[idx('Type')] || '';
    // the fee comes off after the payment: the payment's balance is the printed one less the fee
    const feeV = Math.round(fee.value * 100) / 100;
    const r2 = v => (v == null ? null : Math.round(v * 100) / 100);
    rows.push({ _group: id, revolut_id: id, date: date.value, description, amount: amt.value, currency, balance: feeV && bal.value != null ? r2(bal.value - feeV) : bal.value, type });
    if (feeV) rows.push({ _group: id, revolut_id: `${id}-FEE`, fee_of: id, date: date.value, description: `Revolut fee: ${description}`.trim(), amount: feeV, currency,
      balance: bal.value, type: 'FEE', nominal_hint: BANK_CHARGES_NOMINAL });
  }
  // newest first in the file: reverse whole payment+fee pairs, keeping each pair's own order
  const groups = [];
  for (const r of rows) { if (groups.length && groups[groups.length - 1][0]._group === r._group) groups[groups.length - 1].push(r); else groups.push([r]); }
  const ordered = groups.length > 1 && groups[0][0].date > groups[groups.length - 1][0].date ? groups.reverse() : groups;
  return { rows: ordered.flat().map(({ _group, ...r }) => r), errors };
}

function parseWise(records, idx) {
  const rows = [], errors = [];
  const classic = idx('TransferWise ID') >= 0;
  for (const rec of records.slice(1)) {
    if (rec.empty) continue;
    const c = rec.cells.map(x => x.trim());
    const id = classic ? c[idx('TransferWise ID')] : c[idx('Transaction_ID')];
    const date = readDateWise(c[idx('Date')]);
    let amount, errs = [];
    if (classic) {
      const a = readAmount(c[idx('Amount')]);
      if (a.error || a.value == null) errs.push(a.error || 'no amount'); else amount = a.value;
    } else {
      const inc = readAmount(c[idx('Incoming_EUR')], { blank: 0 }), out = readAmount(c[idx('Outgoing_EUR')], { blank: 0 });
      if (inc.error || out.error) errs.push(inc.error || out.error);
      else if (inc.value && out.value) errs.push('both money in and money out on one line');
      else amount = Math.round((inc.value - Math.abs(out.value)) * 100) / 100;
    }
    const bal = readAmount(classic ? c[idx('Running Balance')] : c[idx('Balance_EUR')]);
    const description = classic ? (c[idx('Description')] || '') : [c[idx('Transaction_Type')], c[idx('Merchant_Payee')], c[idx('Reference')]].filter(Boolean).join(' ');
    errs = [date.error, ...errs, bal.error, !id && 'no transaction ID'].filter(Boolean);
    if (errs.length) { errors.push({ line: rec.line, message: errs.join('; '), raw: { date: c[idx('Date')], description } }); continue; }
    rows.push({ revolut_id: `WISE-${id}`, date: date.value, description, amount, currency: classic ? (c[idx('Currency')] || 'EUR') : 'EUR',
      balance: bal.value, type: classic ? '' : (c[idx('Transaction_Type')] || '') });
  }
  return { rows: chronological(rows), errors };
}

function parseBOI(records, idx) {
  const rows = [], errors = [];
  for (const rec of records.slice(1)) {
    if (rec.empty) continue;
    const c = rec.cells.map(x => x.trim());
    const date = readDateDMY(c[idx('Date')]);
    const debit = readAmount(c[idx('Debit')], { blank: 0 }), credit = readAmount(c[idx('Credit')], { blank: 0 });
    const bal = readAmount(c[idx('Balance')]);
    const description = c[idx('Details')] || '';
    const errs = [date.error, debit.error, credit.error, bal.error].filter(Boolean);
    if (!errs.length && !debit.value && !credit.value) errs.push('no amount');
    if (errs.length) { errors.push({ line: rec.line, message: errs.join('; '), raw: { date: c[idx('Date')], description, debit: c[idx('Debit')], credit: c[idx('Credit')] } }); continue; }
    rows.push({ date: date.value, description, amount: Math.round((credit.value - debit.value) * 100) / 100, currency: 'EUR', balance: bal.value, type: '' });
  }
  return { rows: contentIds('BOI', chronological(rows)), errors };
}

// ── Balance check ─────────────────────────────────────────────────────────────────────────────
// rows: oldest first. Per row: each printed balance = the previous printed balance + the
// movements since. Per day: when that fails, each day's printed balance (any row of the day) =
// the previous day's + the day's movements (statements that print one balance per day). Returns
// { mode: 'row' | 'day' | 'none', checked, breaks: [{ date, expected, printed, ids }] }.
export function checkBalances(rows) {
  const r2 = v => Math.round(v * 100) / 100;
  const withBal = rows.filter(r => r.balance != null);
  if (withBal.length < 2) return { mode: 'none', checked: 0, breaks: [] };
  const perRow = () => {
    const breaks = []; let last = null, acc = 0, ids = [], checked = 0;
    for (const r of rows) {
      acc += r.amount; ids.push(r.revolut_id);
      if (r.balance == null) continue;
      if (last != null) { checked++; if (Math.abs(r2(last + acc) - r.balance) >= 0.005) breaks.push({ date: r.date, expected: r2(last + acc), printed: r.balance, ids }); }
      last = r.balance; acc = 0; ids = [];
    }
    return { checked, breaks };
  };
  const row = perRow();
  if (!row.breaks.length) return { mode: 'row', ...row };
  const days = [];
  for (const r of rows) {
    const d = days[days.length - 1];
    if (d && d.date === r.date) { d.mv += r.amount; d.ids.push(r.revolut_id); if (r.balance != null) d.bals.push(r.balance); }
    else days.push({ date: r.date, mv: r.amount, ids: [r.revolut_id], bals: r.balance != null ? [r.balance] : [] });
  }
  const breaks = []; let last = null, acc = 0, ids = [], checked = 0;
  for (const d of days) {
    acc += d.mv; ids.push(...d.ids);
    if (!d.bals.length) continue;
    const expected = last == null ? null : r2(last + acc);
    if (last != null) {
      checked++;
      const hit = d.bals.find(b => Math.abs(b - expected) < 0.005);
      if (hit == null) breaks.push({ date: d.date, expected, printed: d.bals[d.bals.length - 1], ids });
      last = hit ?? d.bals[d.bals.length - 1];
    } else last = d.bals[d.bals.length - 1];
    acc = 0; ids = [];
  }
  return breaks.length < row.breaks.length ? { mode: 'day', checked, breaks } : { mode: 'row', ...row };
}

// ── Entry point ───────────────────────────────────────────────────────────────────────────────
// -> { format, label, rows, errors, balance } or { format: null, refused: message }.
export function parseStatement(text) {
  const records = parseCsvRecords(text);
  if (records.length < 2) return { format: null, refused: 'This file has no rows.' };
  const header = (records.find(r => !r.empty) || records[0]).cells;
  const format = detectFormat(header);
  if (!format) return { format: null, refused: "This doesn't look like a bank statement export Ledgrly can read. Supported CSV statements: AIB, Bank of Ireland, Revolut and Wise." };
  const hIdx = header.map(H);
  const idx = name => hIdx.indexOf(H(name));
  const parsed = { aib: parseAIB, revolut: parseRevolut, wise: parseWise, boi: parseBOI }[format](records, idx);
  return { format, label: FORMAT_LABEL[format], rows: parsed.rows, errors: parsed.errors, balance: checkBalances(parsed.rows) };
}
