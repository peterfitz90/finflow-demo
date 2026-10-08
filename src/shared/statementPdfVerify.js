// BNK-14 step 3: the text-PDF reader's code side (pure, no model, no I/O). The model copies what is
// printed on each page into a fixed JSON shape (strings exactly as printed, never a computed
// figure); this module parses those strings, checks every one against the page's own text layer,
// and verifies the arithmetic. Bank-agnostic: no per-bank templates.
//
// Model output (per chunk; page numbers are 1-based within the chunk):
//   { statement: { bank, period_start_text, period_end_text },
//     sections: [{ key, account_label, currency, opening_balance_text, closing_balance_text,
//                  total_in_text, total_out_text, count_text,
//                  rows: [{ page, date_text, description, money_in_text, money_out_text, amount_text,
//                           balance_text, status_text }] }] }
import { checkBalances, hash32 } from './bankStatementParse.js';

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const pad = n => String(n).padStart(2, '0');
const validYMD = (y, m, d) => m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate();

// ── Amounts ───────────────────────────────────────────────────────────────────────────────────
// As printed on a statement: optional sign, currency symbol or code, thousands separators, two
// decimals; a trailing CR/DR or brackets for negatives. Returns { value } or { error }.
export function readPrintedAmount(raw) {
  if (raw == null) return { value: null };
  let s = String(raw).trim();
  if (s === '' || s === '-' || s === '—') return { value: null };
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1).trim(); }
  const flag = s.match(/\s*(CR|DR|Cr|Dr|cr|dr)\.?$/);
  if (flag) { s = s.slice(0, flag.index).trim(); if (/dr/i.test(flag[1])) neg = !neg; }
  s = s.replace(/(EUR|GBP|USD|PLN|CHF)/g, '').replace(/[€£$\s ]/g, '');
  if (/^[-−–]/.test(s)) { neg = !neg; s = s.slice(1); }
  if (/^\+/.test(s)) s = s.slice(1);
  if (/^[-−–]/.test(s)) return { error: `unreadable amount "${raw}"` };
  const m = s.match(/^(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})$/);
  if (!m) return { error: `unreadable amount "${raw}"` };
  const v = Number(`${m[1].replace(/,/g, '')}.${m[2]}`);
  return { value: neg ? -v : v };
}

// ── Dates ─────────────────────────────────────────────────────────────────────────────────────
// Day before month always (Irish and EU statements), with a text month, or DD/MM/YYYY, or ISO. A
// missing year comes from the statement period: the year that puts the date inside it.
export function readPrintedDate(raw, { periodStart = null, periodEnd = null } = {}) {
  const s = String(raw ?? '').trim().replace(/,/g, ' ').replace(/\s+/g, ' ');
  const monthOf = name => { const n = String(name).toLowerCase(); return MONTHS[n.slice(0, 4)] ?? MONTHS[n.slice(0, 3)] ?? null; };
  let y, m, d, m2;
  if ((m2 = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) [y, m, d] = [+m2[1], +m2[2], +m2[3]];
  else if ((m2 = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/))) [d, m, y] = [+m2[1], +m2[2], +m2[3] < 100 ? 2000 + +m2[3] : +m2[3]];
  else if ((m2 = s.match(/^(\d{1,2})(?:st|nd|rd|th)? ([A-Za-z]{3,9})\.?(?: (\d{4}))?$/)) && monthOf(m2[2])) [d, m, y] = [+m2[1], monthOf(m2[2]), m2[3] ? +m2[3] : null];
  else if ((m2 = s.match(/^([A-Za-z]{3,9})\.? (\d{1,2})(?: (\d{4}))?$/)) && monthOf(m2[1])) [d, m, y] = [+m2[2], monthOf(m2[1]), m2[3] ? +m2[3] : null];
  else return { error: `unreadable date "${raw}"` };
  if (y == null) {
    const years = [periodStart, periodEnd].filter(Boolean).map(p => +p.slice(0, 4));
    if (!years.length) return { error: `date "${raw}" has no year and the statement period is unknown` };
    const cands = [...new Set(years)].map(yy => `${yy}-${pad(m)}-${pad(d)}`);
    const inside = cands.find(c => (!periodStart || c >= periodStart) && (!periodEnd || c <= periodEnd));
    y = +(inside || cands[0]).slice(0, 4);
  }
  if (!validYMD(y, m, d)) return { error: `invalid date "${raw}"` };
  return { value: `${y}-${pad(m)}-${pad(d)}` };
}

// ── Text-layer check ──────────────────────────────────────────────────────────────────────────
// Every printed string the model returns must be on that page. Whitespace is ignored on both sides
// (a figure is often split across text runs); nothing else is normalised.
const squash = s => String(s ?? '').replace(/[\s ]+/g, '');
export function onPage(str, pageText) {
  const k = squash(str);
  return k === '' || squash(pageText).includes(k);
}

// Pages from the text layer: a page with real statement text, one with none (scanned or
// photographed), or one whose text cannot be read (a font without a usable character map).
export function classifyPage(text) {
  const t = String(text || '');
  const visible = t.replace(/\s+/g, '');
  if (visible.length < 40) return 'no_text';
  const odd = [...t].filter(c => { const k = c.charCodeAt(0); return k < 32 ? !/\s/.test(c) : k > 126 && !/[€£–—’‘“”•·½¼¾éèáíóúÉÁÍÓÚ]/.test(c); }).length;
  return odd / visible.length > 0.2 ? 'unreadable_text' : 'text';
}

// ── Assemble and verify ───────────────────────────────────────────────────────────────────────
// chunks: [{ firstPage (1-based in the whole PDF), result (model JSON) }]; pageTexts: text by page
// (0-based). Returns { sections: [{ key, label, currency, rows, checks, errors }], issues, summary }.
export function verifyStatement({ chunks, pageTexts }) {
  const first = chunks.find(c => c.result?.statement)?.result.statement || {};
  const period = {
    start: first.period_start_text ? readPrintedDate(first.period_start_text).value ?? null : null,
    end: first.period_end_text ? readPrintedDate(first.period_end_text).value ?? null : null,
  };
  const byKey = new Map();
  for (const c of chunks) {
    for (const s of c.result?.sections || []) {
      const key = String(s.key || s.account_label || s.currency || 'main');
      if (!byKey.has(key)) byKey.set(key, { key, label: s.account_label || key, currency: s.currency || null, raw: [], printed: {} });
      const sec = byKey.get(key);
      for (const f of ['opening_balance_text', 'closing_balance_text', 'total_in_text', 'total_out_text', 'count_text']) {
        if (s[f] != null && s[f] !== '') {
          // opening from the earliest chunk that prints one; closing, totals and count from the latest
          if (f === 'opening_balance_text' && sec.printed[f] != null) continue;
          sec.printed[f] = { text: s[f], page: c.firstPage + ((s.rows?.[s.rows.length - 1]?.page || 1) - 1) };
        }
      }
      for (const r of s.rows || []) sec.raw.push({ ...r, absPage: c.firstPage + ((Number(r.page) || 1) - 1), chunkStart: c.firstPage });
    }
  }

  const sections = [];
  for (const sec of byKey.values()) {
    const rows = [], errors = [];
    sec.raw.forEach((r, i) => {
      const pageText = pageTexts[r.absPage - 1] ?? '';
      const errs = [];
      const fields = { date_text: r.date_text, money_in_text: r.money_in_text, money_out_text: r.money_out_text, amount_text: r.amount_text, balance_text: r.balance_text };
      for (const [f, v] of Object.entries(fields)) if (v != null && v !== '' && !onPage(v, pageText)) errs.push(`${f.replace('_text', '')} "${v}" is not on page ${r.absPage}`);
      const date = readPrintedDate(r.date_text, { periodStart: period.start, periodEnd: period.end });
      const inn = readPrintedAmount(r.money_in_text), out = readPrintedAmount(r.money_out_text), amt = readPrintedAmount(r.amount_text), bal = readPrintedAmount(r.balance_text);
      for (const x of [date, inn, out, amt, bal]) if (x.error) errs.push(x.error);
      let amount = null;
      if (!errs.length) {
        if (amt.value != null && (inn.value != null || out.value != null)) errs.push('both a signed amount and money in/out');
        else if (amt.value != null) amount = amt.value;
        else if (inn.value != null && out.value != null && inn.value && out.value) errs.push('money in and money out on one line');
        else if (inn.value != null || out.value != null) amount = Math.round(((inn.value || 0) - Math.abs(out.value || 0)) * 100) / 100;
        else errs.push('no amount');
      }
      if (errs.length) { errors.push({ index: i, page: r.absPage, message: errs.join('; ') }); return; }
      rows.push({ date: date.value, description: String(r.description || '').trim(), amount, balance: bal.value, currency: sec.currency || 'EUR',
        status: r.status_text || null, page: r.absPage, chunkStart: r.chunkStart, index: i });
    });

    const checks = [];
    // printed opening / closing / totals / count, each also on its page
    const pv = f => { const p = sec.printed[f]; if (!p) return null; const a = f === 'count_text' ? { value: Number(String(p.text).replace(/[^\d]/g, '')) || null } : readPrintedAmount(p.text); return { ...a, text: p.text }; };
    const opening = pv('opening_balance_text'), closing = pv('closing_balance_text'), tin = pv('total_in_text'), tout = pv('total_out_text'), cnt = pv('count_text');
    for (const [f, v] of Object.entries(sec.printed)) {
      const onAny = pageTexts.some(t => onPage(v.text, t));
      if (!onAny) checks.push({ check: `${f.replace('_text', '')} is printed`, ok: false, detail: `"${v.text}" is not on any page` });
    }
    const sum = r2(rows.reduce((t, r) => t + r.amount, 0));
    if (opening?.value != null && closing?.value != null) {
      checks.push({ check: 'opening + movements = closing', ok: Math.abs(r2(opening.value + sum) - closing.value) < 0.005, detail: `difference ${r2(closing.value - opening.value - sum)}` });
    }
    if (tin?.value != null) { const s = r2(rows.filter(r => r.amount > 0).reduce((t, r) => t + r.amount, 0)); checks.push({ check: 'total money in', ok: Math.abs(s - Math.abs(tin.value)) < 0.005, detail: `difference ${r2(Math.abs(tin.value) - s)}` }); }
    if (tout?.value != null) { const s = r2(rows.filter(r => r.amount < 0).reduce((t, r) => t - r.amount, 0)); checks.push({ check: 'total money out', ok: Math.abs(s - Math.abs(tout.value)) < 0.005, detail: `difference ${r2(Math.abs(tout.value) - s)}` }); }
    if (cnt?.value != null) checks.push({ check: 'transaction count', ok: cnt.value === rows.length, detail: `printed ${cnt.value}, read ${rows.length}` });

    // running balance, in date order, carried across page and chunk boundaries (an opening balance
    // seeds the chain so the first row is checked too)
    const ordered = rows.length > 1 && rows[0].date > rows[rows.length - 1].date ? [...rows].reverse() : rows;
    const chain = [...(opening?.value != null ? [{ revolut_id: 'opening', date: ordered[0]?.date || '0000-00-00', amount: 0, balance: opening.value }] : []),
      ...ordered.map(r => ({ revolut_id: `row-${r.index}`, date: r.date, amount: r.amount, balance: r.balance }))];
    const bal = checkBalances(chain);
    if (bal.mode !== 'none') checks.push({ check: `running balance (${bal.mode === 'day' ? 'per day' : 'per row'})`, ok: bal.breaks.length === 0, detail: `${bal.checked} checked, ${bal.breaks.length} breaks`, breaks: bal.breaks });
    // a line repeated across a page or chunk break
    const dupes = [];
    for (let i = 1; i < ordered.length; i++) {
      const a = ordered[i - 1], b = ordered[i];
      if (a.page !== b.page && a.date === b.date && a.amount === b.amount && a.balance === b.balance && a.description === b.description) dupes.push({ page: b.page, date: b.date });
    }
    checks.push({ check: 'no line repeated across a page break', ok: dupes.length === 0, detail: `${dupes.length} repeated` });
    // dates within the statement period
    if (period.start || period.end) {
      const outside = rows.filter(r => (period.start && r.date < period.start) || (period.end && r.date > period.end)).length;
      checks.push({ check: 'dates within the statement period', ok: outside === 0, detail: `${outside} outside` });
    }
    const verifiable = checks.some(c => /running balance|opening \+ movements/.test(c.check));
    sections.push({
      key: sec.key, label: sec.label, currency: sec.currency,
      rows: ordered.map(r => ({ ...r, revolut_id: `PDF-${hash32(`${sec.key}|${r.date}|${r.amount.toFixed(2)}|${r.description.toLowerCase()}|${r.index}`)}` })),
      errors, checks, verifiable, ok: errors.length === 0 && checks.every(c => c.ok) && verifiable,
    });
  }
  const rowsTotal = sections.reduce((t, s) => t + s.rows.length, 0), errTotal = sections.reduce((t, s) => t + s.errors.length, 0);
  return {
    period, sections,
    summary: { sections: sections.length, rows: rowsTotal, row_errors: errTotal, checks_failed: sections.reduce((t, s) => t + s.checks.filter(c => !c.ok).length, 0),
      unverifiable_sections: sections.filter(s => !s.verifiable).length, ok: sections.length > 0 && sections.every(s => s.ok) },
  };
}
const r2 = v => Math.round(v * 100) / 100;
