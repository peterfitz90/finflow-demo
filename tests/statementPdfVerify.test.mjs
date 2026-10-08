// BNK-14 step 3: the text-PDF reader's checks, with synthetic statements (no client data, no model).
// Run: node --test "tests/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { verifyStatement, classifyPage, readPrintedAmount, readPrintedDate } from '../src/shared/statementPdfVerify.js';
import { readStatementPdf, classifyFile, pageTexts, chunkPdf } from '../api/_statement-pdf-read.js';

// A synthetic 3-page statement: opening 100.00, five lines over three pages, closing 125.00.
const LINES = [
  { page: 1, date: '01 Jul 2026', desc: 'TEST Opening top up', in: '50.00', out: null, bal: '150.00' },
  { page: 1, date: '03 Jul 2026', desc: 'TEST Coffee', in: null, out: '3.50', bal: '146.50' },
  { page: 2, date: '10 Jul 2026', desc: 'TEST Supplier', in: null, out: '1,021.50', bal: '-875.00' },
  { page: 2, date: '15 Jul 2026', desc: 'TEST Customer', in: '1,000.00', out: null, bal: '125.00' },
  { page: 3, date: '20 Jul 2026', desc: 'TEST Refund', in: '0.00', out: null, bal: '125.00' },
];
const pageText = p => [
  p === 1 ? 'TEST BANK Statement 01 Jul 2026 to 31 Jul 2026 Opening balance €100.00' : `Page ${p}`,
  'Date Description Money in Money out Balance',
  ...LINES.filter(l => l.page === p).map(l => `${l.date} ${l.desc} ${l.in ? `€${l.in}` : ''} ${l.out ? `€${l.out}` : ''} €${l.bal}`),
  p === 3 ? 'Closing balance €125.00 Total in €1,050.00 Total out €1,025.00' : '',
].join('\n');
const TEXTS = [1, 2, 3].map(pageText);
const row = (l, page = l.page) => ({ page, date_text: l.date, description: l.desc, money_in_text: l.in ? `€${l.in}` : null, money_out_text: l.out ? `€${l.out}` : null, amount_text: null, balance_text: `€${l.bal}`, status_text: null });
const section = (rows, extra = {}) => ({ key: 'EUR main', account_label: 'Current ··1234', currency: 'EUR', opening_balance_text: null, closing_balance_text: null, total_in_text: null, total_out_text: null, count_text: null, rows, ...extra });
const statement = { bank: 'TEST BANK', document_type: 'transactions', period_start_text: '01 Jul 2026', period_end_text: '31 Jul 2026' };
const oneChunk = (rows, extra) => [{ firstPage: 1, result: { statement, sections: [section(rows, { opening_balance_text: '€100.00', closing_balance_text: '€125.00', total_in_text: '€1,050.00', total_out_text: '€1,025.00', ...extra })] } }];

test('a correct read passes every check', () => {
  const v = verifyStatement({ chunks: oneChunk(LINES.map(l => row(l))), pageTexts: TEXTS });
  assert.equal(v.summary.ok, true, JSON.stringify(v.sections[0].checks.filter(c => !c.ok)));
  assert.equal(v.summary.rows, 5);
  assert.deepEqual(v.sections[0].rows.map(r => r.amount), [50, -3.5, -1021.5, 1000, 0]);
  assert.ok(v.sections[0].checks.some(c => c.check === 'opening + movements = closing' && c.ok));
  assert.equal(new Set(v.sections[0].rows.map(r => r.revolut_id)).size, 5);
});

test('a misread figure is caught even when it is internally consistent: it is not on the page', () => {
  const rows = LINES.map(l => row(l));
  rows[1] = { ...rows[1], money_out_text: '€3.60', balance_text: '€146.40' }; // misread, and the balance "follows"
  const v = verifyStatement({ chunks: oneChunk(rows), pageTexts: TEXTS });
  assert.equal(v.summary.ok, false);
  assert.match(v.sections[0].errors[0].message, /money_out "€3.60" is not on page 1/);
});

test('a dropped line at a page break is caught by the running balance carried across pages', () => {
  const rows = LINES.filter((_, i) => i !== 2).map(l => row(l)); // the first line on page 2 is missing
  const v = verifyStatement({ chunks: oneChunk(rows), pageTexts: TEXTS });
  const bal = v.sections[0].checks.find(c => /running balance/.test(c.check));
  assert.equal(bal.ok, false);
  assert.equal(v.summary.ok, false);
});

test('a line repeated at a page break is caught', () => {
  const rows = LINES.map(l => row(l));
  rows.splice(2, 0, row(LINES[1], 2)); // page 1's last line repeated at the top of page 2
  const texts = [...TEXTS]; texts[1] = `${LINES[1].date} ${LINES[1].desc} €${LINES[1].out} €${LINES[1].bal}\n${texts[1]}`;
  const v = verifyStatement({ chunks: oneChunk(rows), pageTexts: texts });
  assert.ok(v.sections[0].checks.some(c => /repeated/.test(c.check) && !c.ok));
  assert.equal(v.summary.ok, false);
});

test('chunks: the balance is carried across chunk boundaries; page numbers map to the whole PDF', () => {
  // three one-page chunks, each with its own 1-based page numbers
  const chunks = [1, 2, 3].map(p => ({ firstPage: p, result: { ...(p === 1 ? { statement } : {}), sections: [section(LINES.filter(l => l.page === p).map(l => row(l, 1)),
    p === 1 ? { opening_balance_text: '€100.00' } : p === 3 ? { closing_balance_text: '€125.00' } : {})] } }));
  const v = verifyStatement({ chunks, pageTexts: TEXTS });
  assert.equal(v.summary.ok, true, JSON.stringify(v.sections[0].checks));
  assert.deepEqual(v.sections[0].rows.map(r => r.page), [1, 1, 2, 2, 3]);
  // the same, with chunk 2's first line dropped: the carried balance breaks at the boundary
  const broken = chunks.map(c => c.firstPage === 2 ? { ...c, result: { sections: [section(c.result.sections[0].rows.slice(1))] } } : c);
  assert.equal(verifyStatement({ chunks: broken, pageTexts: TEXTS }).summary.ok, false);
});

test('totals, counts and the statement period are checked', () => {
  const v = verifyStatement({ chunks: oneChunk(LINES.map(l => row(l)), { total_in_text: '€1,050.00', count_text: '6' }), pageTexts: [...TEXTS.slice(0, 2), `${TEXTS[2]} 6 transactions`] });
  assert.ok(v.sections[0].checks.some(c => c.check === 'transaction count' && !c.ok));
  const late = LINES.map(l => row(l)); late[4] = { ...late[4], date_text: '20 Aug 2026' };
  const texts = [...TEXTS]; texts[2] = texts[2].replace('20 Jul 2026', '20 Aug 2026');
  assert.ok(verifyStatement({ chunks: oneChunk(late), pageTexts: texts }).sections[0].checks.some(c => /period/.test(c.check) && !c.ok));
});

test('no balances and no opening/closing: the section is not verifiable and does not pass', () => {
  const rows = LINES.map(l => ({ ...row(l), balance_text: null }));
  const v = verifyStatement({ chunks: [{ firstPage: 1, result: { statement, sections: [section(rows)] } }], pageTexts: TEXTS });
  assert.equal(v.sections[0].verifiable, false);
  assert.equal(v.summary.ok, false);
});

test('page classes: text, none (scanned or photographed), unreadable', () => {
  assert.equal(classifyPage(TEXTS[0]), 'text');
  assert.equal(classifyPage('  '), 'no_text');
  assert.equal(classifyPage('\u0003\u0007ÞÞÛ\u0001\u0002'.repeat(20)), 'unreadable_text');
  assert.equal(classifyFile(['', '', 'x']).kind, 'scanned');
  assert.equal(classifyFile([TEXTS[0], '\u0003\u0007ÞÞÛ\u0001'.repeat(20)]).kind, 'unreadable_text');
  assert.equal(readPrintedAmount('1.234,56').error != null, true);
});

async function syntheticPdf() {
  const doc = await PDFDocument.create(); const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const t of TEXTS) {
    const page = doc.addPage([595, 842]);
    t.replace(/€/g, 'EUR ').split('\n').forEach((line, i) => page.drawText(line, { x: 40, y: 800 - i * 16, size: 9, font }));
  }
  return Buffer.from(await doc.save());
}

test('end to end on a generated PDF: text extraction, page chunks, fake model, verification', async () => {
  const buf = await syntheticPdf();
  const texts = await pageTexts(buf);
  assert.equal(texts.length, 3);
  assert.equal(classifyFile(texts).kind, 'text');
  assert.equal((await chunkPdf(buf, 2)).length, 2);
  const calls = [];
  const callClaude = async ({ messages }) => {
    const chunkBuf = Buffer.from(messages[0].content[0].source.data, 'base64');
    const n = await PDFDocument.load(chunkBuf).then(d => d.getPageCount());
    // which pages this chunk holds, from its own text (chunks are read in parallel, in any order)
    const t1 = (await pageTexts(chunkBuf))[0];
    const first = /TEST BANK Statement/.test(t1) ? 1 : Number(t1.match(/Page (\d+)/)[1]); calls.push([first, n]);
    const pages = Array.from({ length: n }, (_, k) => first + k);
    const toText = s => s && s.replace('€', 'EUR ');
    const rows = LINES.filter(l => pages.includes(l.page)).map(l => ({ ...row(l, l.page - first + 1), money_in_text: toText(row(l).money_in_text), money_out_text: toText(row(l).money_out_text), balance_text: toText(row(l).balance_text) }));
    const result = { ...(first === 1 ? { statement } : {}), sections: [section(rows, first === 1 ? { opening_balance_text: 'EUR 100.00' } : { closing_balance_text: 'EUR 125.00' })] };
    return { ok: true, status: 200, text: JSON.stringify(result), data: { usage: { input_tokens: 1000 * n, output_tokens: 300 }, stop_reason: 'end_turn' } };
  };
  const out = await readStatementPdf({ callClaude }, { buf, model: 'claude-sonnet-5-5', chunkPages: 2 });
  assert.deepEqual(calls.sort((x, y) => x[0] - y[0]), [[1, 2], [3, 1]]);
  assert.equal(out.result.summary.ok, true, JSON.stringify(out.result.sections[0]?.checks));
  assert.equal(out.result.summary.rows, 5);
  assert.deepEqual(out.tokens, { input: 3000, output: 600 });
  assert.equal(Math.round(out.cost.usd * 1e6), Math.round((3000 * 2 + 600 * 10)));
});

test('a scanned file is refused before any model call', async () => {
  const doc = await PDFDocument.create(); doc.addPage([595, 842]); doc.addPage([595, 842]);
  let called = 0;
  const out = await readStatementPdf({ callClaude: async () => { called++; return {}; } }, { buf: Buffer.from(await doc.save()), model: 'claude-sonnet-5-5' });
  assert.deepEqual([out.kind, called], ['scanned', 0]);
  assert.match(out.refused, /cannot read photographed or scanned statements yet\. Ask for the PDF downloaded from online banking/);
});

test('a statement of fees (or any other document) is refused with its reason after one read', async () => {
  const doc = await PDFDocument.create(); const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([595, 842]).drawText('TEST BANK Statement of Fees 01/07/2026 to 30/09/2026 Fees paid on the account', { x: 40, y: 800, size: 9, font });
  const callClaude = async () => ({ ok: true, status: 200, text: JSON.stringify({ statement: { bank: 'TEST BANK', document_type: 'fees' }, sections: [] }), data: { usage: { input_tokens: 900, output_tokens: 40 } } });
  const out = await readStatementPdf({ callClaude }, { buf: Buffer.from(await doc.save()), model: 'claude-sonnet-5-5' });
  assert.match(out.refused, /statement of fees/);
  assert.equal(out.result, undefined);
  assert.deepEqual(out.tokens, { input: 900, output: 40 });
});

test('dates as banks print them, including the run-together DDMONYY form PTSB uses', () => {
  assert.equal(readPrintedDate('01DEC24').value, '2024-12-01');
  assert.equal(readPrintedDate('15Jan2025').value, '2025-01-15');
  assert.equal(readPrintedDate('31FEB25').error != null, true);
  assert.equal(readPrintedDate('1 Jul 2026').value, '2026-07-01');
  assert.equal(readPrintedDate('Jul 1, 2026').value, '2026-07-01');
});

test('amounts: an overdrawn balance with a trailing minus (PTSB) is negative', () => {
  assert.equal(readPrintedAmount('123.45 -').value, -123.45);
  assert.equal(readPrintedAmount('1,234.50-').value, -1234.5);
  assert.equal(readPrintedAmount('-').value, null);
  assert.equal(readPrintedAmount('12.30').value, 12.3);
});

test('dates: a row out of sequence fails the check and is flagged for review', () => {
  const rows = LINES.map(l => row(l));
  rows[3] = { ...rows[3], date_text: '02 Jul 2026' };               // printed after 10 Jul
  const texts = [...TEXTS]; texts[1] = texts[1].replace('15 Jul 2026', '02 Jul 2026');
  const v = verifyStatement({ chunks: oneChunk(rows), pageTexts: texts });
  assert.ok(v.sections[0].checks.some(c => c.check === 'dates in sequence' && !c.ok));
  assert.deepEqual(v.sections[0].rows.filter(r => r.flags).map(r => [r.date, r.flags]), [['2026-07-02', ['date out of sequence']]]);
  assert.equal(v.summary.ok, false);
});

test('chunks: the same account named differently in another part is merged, and the balance carries across', () => {
  const names = ['EUR Explore', 'Explore Account', 'Explore'];
  const chunks = [1, 2, 3].map((p, i) => ({ firstPage: p, result: { statement: { ...statement, period_start_text: i === 0 ? '01 Jul 2026' : null, period_end_text: i === 2 ? '31 Jul 2026' : null },
    sections: [section(LINES.filter(l => l.page === p).map(l => row(l, 1)), { key: names[i], ...(p === 1 ? { opening_balance_text: '€100.00' } : p === 3 ? { closing_balance_text: '€125.00' } : {}) })] } }));
  const v = verifyStatement({ chunks, pageTexts: TEXTS });
  assert.equal(v.sections.length, 1);
  assert.equal(v.summary.ok, true, JSON.stringify(v.sections.map(s => s.checks)));
  // two accounts in the same currency in one part are not merged
  const two = [{ firstPage: 1, result: { statement, sections: [section([row(LINES[0])], { key: 'EUR 1111' }), section([row(LINES[1])], { key: 'EUR 2222' })] } },
    { firstPage: 2, result: { sections: [section([row(LINES[2], 1)], { key: 'EUR 3333' })] } }];
  assert.equal(verifyStatement({ chunks: two, pageTexts: TEXTS }).sections.length, 3);
});

test('period: from the earliest start to the latest end printed in any part', () => {
  const chunks = [{ firstPage: 1, result: { statement: { ...statement, period_start_text: '01 Jul 2026', period_end_text: '10 Jul 2026' }, sections: [section(LINES.filter(l => l.page === 1).map(l => row(l)), { opening_balance_text: '€100.00' })] } },
    { firstPage: 2, result: { statement: { period_start_text: '11 Jul 2026', period_end_text: '31 Jul 2026' }, sections: [section(LINES.filter(l => l.page > 1).map(l => row(l, l.page - 1)), { closing_balance_text: '€125.00' })] } }];
  const v = verifyStatement({ chunks, pageTexts: TEXTS });
  assert.deepEqual(v.period, { start: '2026-07-01', end: '2026-07-31' });
  assert.ok(v.sections[0].checks.some(c => c.check === 'dates within the statement period' && c.ok));
});
