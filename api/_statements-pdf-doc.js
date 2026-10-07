// FRS 105 statements as a PDF (STA-01 Stage 5a). React.createElement throughout (no JSX), and
// @react-pdf/renderer loaded by dynamic import (ESM-only; see api/_invoice-pdf-doc.js).
//
// The model comes from src/shared/statements/assemble.js (the same function the statements page
// uses), so the PDF shows what the screen shows. Two variants from the same figures:
//   full      cover, profit and loss account, balance sheet with items 3-5 and signatures, notes
//   abridged  the CRO abridged copy (wording sheet agreed by Peter, 7 October 2026): certification
//             page (s.347), cover, contents, balance sheet with comparatives and statements
//             (a)-(e), abridged notes; no profit and loss account
// Running header and footer, "Page n of m", and a DRAFT watermark on every page until approved.
// Font: Ledgrly Sans, embedded: Source Sans 3 with its ligatures removed (so PDF text extracts and
// searches as written) and renamed as the OFL requires (api/_fonts/README.txt). It has the € sign.
import React from 'react';
import path from 'node:path';
import { ABRIDGED } from '../src/shared/statements/wording.js';

const e = (type, props, ...children) => React.createElement(type, props, ...children);
const FONT_DIR = path.join(process.cwd(), 'api', '_fonts');
const INK = '#111111', MUTED = '#555555', RULE = '#999999';

// Statutory amount: whole euros, negatives in brackets, zero as a dash (as on screen).
export const fa = n => {
  if (n === null || n === undefined) return '';
  if (Math.round(Math.abs(n)) === 0) return '—';
  const s = '€' + Math.round(Math.abs(n)).toLocaleString('en-IE');
  return n < 0 ? `(${s})` : s;
};
const longFmt = d => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-IE', { day: 'numeric', month: 'long', year: 'numeric' }) : '');

// m: { companyName, croNumber, assembled (assembleStatements output), yearEnd, approved (bool),
//      variant: 'full' (default) | 'abridged' }
export async function renderStatementsPdf(m) {
  const R = await import('@react-pdf/renderer');
  R.Font.register({ family: 'Ledgrly Sans', fonts: [
    { src: path.join(FONT_DIR, 'ledgrly-sans-400.woff'), fontWeight: 400 },
    { src: path.join(FONT_DIR, 'ledgrly-sans-700.woff'), fontWeight: 700 },
  ] });
  R.Font.registerHyphenationCallback(w => [w]);
  if (m.variant !== 'abridged') return R.renderToBuffer(buildDoc(m, R, null, {}));
  // The abridged contents page lists page numbers: a first pass records where the sections land.
  const seen = {};
  await R.renderToBuffer(buildDoc(m, R, null, seen));
  return R.renderToBuffer(buildDoc(m, R, seen, {}));
}

// known: { bs, notes } page numbers for the contents page (second pass); seen: filled on the first.
function buildDoc(m, R, known, seen) {
  const { Document, Page, View, Text } = R;
  const abridged = m.variant === 'abridged';
  const A = m.assembled;
  const { s3bs, s3pnl, pfYear, frs105, prior, showPrior, periodPhrase, yeFmt, priorYE, approvalISO } = A;
  const bsStatements = abridged ? A.abridgedBs : A.bsStatements;
  const notes = abridged ? A.abridgedNotes : A.notes;
  // a heading that records the page it lands on (for the contents page)
  // (a static heading, plus an empty marker that records the page: render-prop text is not laid out)
  const mark = (key, text, style) => e(View, null,
    e(Text, { style }, text),
    e(Text, { style: { fontSize: 1, height: 0 }, render: ({ pageNumber }) => { if (seen[key] == null) seen[key] = pageNumber; return ''; } }));
  const draft = !m.approved;
  const pv = (g, k, sign = 1) => (prior[g] && k in prior[g] ? sign * prior[g][k] : undefined);
  const yearLabel = (m.yearEnd || '').slice(0, 4), priorLabel = (priorYE || '').slice(0, 4);
  const titleCase = periodPhrase.charAt(0).toUpperCase() + periodPhrase.slice(1);

  const S = {
    page: { fontFamily: 'Ledgrly Sans', fontSize: 10, color: INK, paddingTop: 64, paddingBottom: 64, paddingHorizontal: 56, lineHeight: 1.35 },
    header: { position: 'absolute', top: 28, left: 56, right: 56, flexDirection: 'row', justifyContent: 'space-between', fontSize: 8, color: MUTED, borderBottomWidth: 0.5, borderBottomColor: RULE, paddingBottom: 4 },
    // positioned from the top: A4 is 841.89pt tall (react-pdf drops fixed elements anchored with bottom)
    footer: { position: 'absolute', top: 800, left: 56, right: 56, flexDirection: 'row', justifyContent: 'space-between', fontSize: 8, color: MUTED, borderTopWidth: 0.5, borderTopColor: RULE, paddingTop: 4 },
    watermark: { position: 'absolute', top: 330, left: 60, fontSize: 120, fontWeight: 700, color: '#000000', opacity: 0.07, transform: 'rotate(-35deg)' },
    h1: { fontSize: 14, fontWeight: 700, marginBottom: 2 },
    h2: { fontSize: 9, color: MUTED, marginBottom: 14, textTransform: 'uppercase', letterSpacing: 0.5 },
    head: { fontSize: 10, fontWeight: 700, marginTop: 12, marginBottom: 4, textTransform: 'uppercase' },
    row: { flexDirection: 'row', paddingVertical: 2 },
    label: { flex: 1 },
    num: { width: 70, textAlign: 'right' },
    numP: { width: 70, textAlign: 'right', color: MUTED },
    p: { marginBottom: 5 },
    req: { marginBottom: 5, color: '#a61b1b' },
  };

  // label | c1 c2 (this year) | p1 p2 (prior year), like the screen's fsRow
  const row = (label, { c1, c2, p1, p2, bold, top2, dbl } = {}) => {
    const b = bold ? { fontWeight: 700 } : {};
    const tline = top2 ? { borderTopWidth: 0.5, borderTopColor: INK } : dbl ? { borderTopWidth: 0.5, borderTopColor: INK, borderBottomWidth: 1.5, borderBottomColor: INK } : {};
    return e(View, { style: S.row, wrap: false },
      e(Text, { style: [S.label, b] }, label),
      e(Text, { style: [S.num, b] }, c1 !== undefined ? fa(c1) : ''),
      e(Text, { style: [S.num, b, tline, { marginLeft: 6 }] }, c2 !== undefined ? fa(c2) : ''),
      ...(showPrior ? [
        e(Text, { style: [S.numP, { marginLeft: 14 }] }, p1 !== undefined ? fa(p1) : ''),
        e(Text, { style: [S.numP, tline, { marginLeft: 6 }] }, p2 !== undefined ? fa(p2) : ''),
      ] : []));
  };
  const cols = () => e(View, { style: [S.row, { color: MUTED, fontSize: 8 }] },
    e(Text, { style: S.label }, ''),
    e(Text, { style: [S.num, { width: 146, textAlign: 'right' }] }, showPrior ? `${yearLabel}\n€` : '€'),
    ...(showPrior ? [e(Text, { style: [S.numP, { width: 160, textAlign: 'right' }] }, `${priorLabel}\n€`)] : []));
  const rule = () => e(View, { style: { borderTopWidth: 0.5, borderTopColor: RULE, marginVertical: 4 } });
  const para = t => e(Text, { style: /\[Information required/.test(t) ? S.req : S.p }, t);

  const approvalLine = approvalISO ? `Approved by the directors on ${longFmt(approvalISO)}` : 'Directors’ approval date not recorded';
  const chrome = (withHeader = true) => [
    ...(draft ? [e(Text, { key: 'wm', style: S.watermark, fixed: true }, 'DRAFT')] : []),
    ...(withHeader ? [e(View, { key: 'hd', style: S.header, fixed: true },
      e(Text, null, m.companyName), e(Text, null, titleCase))] : []),
    e(View, { key: 'ft', style: S.footer, fixed: true },
      e(Text, null, `${m.croNumber ? `Registered number ${m.croNumber} · ` : ''}${draft ? `DRAFT · ${approvalLine}` : approvalLine}`),
      e(Text, { render: ({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}` })),
  ];

  const p = s3pnl;
  const pnlPage = e(Page, { size: 'A4', style: S.page },
    ...chrome(),
    e(Text, { style: S.h1 }, 'Profit and Loss Account'),
    e(Text, { style: S.h2 }, `For the ${periodPhrase}`),
    cols(),
    row('Turnover', { c2: p['1'].amount, p2: pv('pnl', 'pnl.1') }),
    ...((p['2'].amount !== 0 || pv('pnl', 'pnl.2')) ? [row('Other income', { c2: p['2'].amount, p2: pv('pnl', 'pnl.2') })] : []),
    ...((p['3'].amount !== 0 || pv('pnl', 'pnl.3')) ? [row('Cost of raw materials and consumables', { c2: -p['3'].amount, p2: pv('pnl', 'pnl.3', -1) })] : []),
    ...((p['4'].amount !== 0 || pv('pnl', 'pnl.4')) ? [row('Staff costs', { c2: -p['4'].amount, p2: pv('pnl', 'pnl.4', -1) })] : []),
    ...((p['5'].amount !== 0 || pv('pnl', 'pnl.5')) ? [row('Value adjustments and other amounts written off assets', { c2: -p['5'].amount, p2: pv('pnl', 'pnl.5', -1) })] : []),
    ...((p['6'].amount !== 0 || pv('pnl', 'pnl.6')) ? [row('Other expenses', { c2: -p['6'].amount, p2: pv('pnl', 'pnl.6', -1) })] : []),
    rule(),
    row('Tax', p['7'].amount !== 0 || pv('pnl', 'pnl.7') ? { c2: -p['7'].amount, p2: pv('pnl', 'pnl.7', -1) } : {}),
    row('Profit or loss', { c2: pfYear, p2: pv('pnl', 'pnl.8'), dbl: true, bold: true }));

  const b = s3bs;
  const bsPage = e(Page, { size: 'A4', style: S.page },
    ...chrome(),
    mark('bs', 'Balance Sheet', S.h1),
    e(Text, { style: S.h2 }, `As at ${yeFmt}`),
    cols(),
    ...((b.A.amount !== 0 || pv('bs', 'bs.A')) ? [row('Called up share capital not paid', { c2: b.A.amount, p2: pv('bs', 'bs.A') })] : []),
    row('Fixed assets', { c2: b.B.amount, p2: pv('bs', 'bs.B') }),
    rule(),
    row('Current assets', { c1: b.C.amount, p1: pv('bs', 'bs.C') }),
    ...((b.D.amount !== 0 || pv('bs', 'bs.D')) ? [row('Prepayments and accrued income', { c1: b.D.amount, p1: pv('bs', 'bs.D') })] : []),
    row('Creditors: amounts falling due within one year', { c1: -b.E.amount, p1: pv('bs', 'bs.E', -1) }),
    row('Net current assets (liabilities)', { c2: b.F.amount, p2: pv('bs', 'bs.F'), top2: true, bold: true }),
    rule(),
    row('Total assets less current liabilities', { c2: b.G.amount, p2: pv('bs', 'bs.G'), bold: true }),
    ...((b.H.amount !== 0 || pv('bs', 'bs.H')) ? [row('Creditors: amounts falling due after more than one year', { c2: -b.H.amount, p2: pv('bs', 'bs.H', -1) })] : []),
    ...((b.I.amount !== 0 || pv('bs', 'bs.I')) ? [row('Provisions for liabilities', { c2: -b.I.amount, p2: pv('bs', 'bs.I', -1) })] : []),
    row('', { c2: frs105.netAssets, p2: pv('bs', 'netAssets'), dbl: true, bold: true }),
    e(Text, { style: S.head }, 'Capital and reserves'),
    row('Called up share capital', { c1: b.K1.amount, p1: pv('bs', 'bs.K1') }),
    row('Profit and loss account', { c1: b.K2.amount, p1: pv('bs', 'bs.K2') }),
    row('', { c2: b.K.amount, p2: pv('bs', 'bs.K'), dbl: true, bold: true }),
    ...(Math.abs(A.s3Imbalance) >= 0.005 ? [e(Text, { style: [S.req, { fontWeight: 700 }] }, `Imbalance: balances with no statement line ${fa(A.s3Imbalance)}`)] : []),
    e(View, { style: { marginTop: 16 }, wrap: false },
      e(Text, { style: [S.p, { fontWeight: 700 }] }, bsStatements.microRegime),
      ...(bsStatements.auditExemption || []).map(para),
      e(Text, { style: [/\[Information required/.test(bsStatements.approval) ? S.req : S.p, { marginTop: 8 }] }, bsStatements.approval),
      e(View, { style: { flexDirection: 'row', marginTop: 34 } },
        ...(bsStatements.soleDirector ? [0] : [0, 1]).map(k => e(View, { key: k, style: { width: 200, marginRight: 30 } },
          e(Text, { style: { borderTopWidth: 0.5, borderTopColor: INK, paddingTop: 3, color: bsStatements.signatories[k] ? INK : '#a61b1b' } },
            bsStatements.signatories[k] || '[Information required: signatory]'),
          e(Text, { style: { fontSize: 8, color: MUTED } }, 'Director'))))));

  const notesPage = e(Page, { size: 'A4', style: S.page },
    ...chrome(),
    mark('notes', abridged ? ABRIDGED.notesTitle : 'Notes to the Financial Statements', S.h1),
    e(Text, { style: S.h2 }, `For the ${periodPhrase}`),
    ...notes.map((n, k) => e(View, { key: n.title, style: { marginBottom: 10 } },
      e(Text, { style: { fontWeight: 700, marginBottom: 3 }, minPresenceAhead: 40 }, `${k + 1}. ${n.title}`),
      ...(n.table ? [e(View, { style: { width: 360, marginBottom: 4 } },
        ...n.table.map(([label, amt], r) => e(View, { key: label, style: [S.row, r === n.table.length - 1 ? { fontWeight: 700, borderTopWidth: 0.5, borderTopColor: RULE } : {}] },
          e(Text, { style: S.label }, label), e(Text, { style: S.num }, fa(amt)))))] : []),
      ...n.paragraphs.map(para))));

  const cover = e(Page, { size: 'A4', style: S.page },
    ...chrome(false),
    e(View, { style: { marginTop: 180 } },
      e(Text, { style: { fontSize: 22, fontWeight: 700, lineHeight: 1.2, marginBottom: 10 } }, m.companyName),
      e(Text, { style: { fontSize: 13, marginBottom: 4 } }, abridged ? ABRIDGED.coverTitle : 'Unaudited Financial Statements'),
      e(Text, { style: { fontSize: 11, color: MUTED, marginBottom: 18 } }, `For the ${periodPhrase}`),
      e(Text, { style: { fontSize: 10, color: m.croNumber ? MUTED : '#a61b1b' } }, `Registered number ${m.croNumber || '[Information required: registered number]'}`),
      e(Text, { style: { fontSize: 9, color: MUTED, marginTop: 40 } }, 'Prepared under FRS 105, The Financial Reporting Standard applicable to the Micro-entities Regime.')));

  // A1 certification page (abridged): section 347, signatories named and dated.
  const C = A.certification;
  const certPage = e(Page, { size: 'A4', style: S.page },
    ...chrome(false),
    e(Text, { style: { fontWeight: 700, color: m.croNumber ? INK : '#a61b1b' } }, `Company number: ${m.croNumber || '[Information required: registered number]'}`),
    e(View, { style: { marginTop: 60, alignItems: 'center' } },
      e(Text, { style: { fontSize: 12, fontWeight: 700 } }, m.companyName),
      e(Text, { style: { fontSize: 10 } }, '(the "Company")')),
    e(Text, { style: { marginTop: 50, fontWeight: 700, lineHeight: 1.45 } }, C.text),
    e(View, { style: { marginTop: 60 } },
      ...C.signatories.map((sg, k) => e(View, { key: k, style: { width: 260, marginBottom: 36 }, wrap: false },
        e(Text, { style: { borderTopWidth: 0.5, borderTopColor: INK, paddingTop: 3, color: /^\[Information required/.test(sg.name) ? '#a61b1b' : INK } }, sg.name),
        e(Text, { style: { fontSize: 8, color: MUTED } }, sg.role))),
      e(Text, { style: { color: /^\[Information required/.test(C.date) ? '#a61b1b' : INK } }, `Date: ${C.date}`)));

  // A3 contents (abridged)
  const contentsRow = (label, pg) => e(View, { style: [S.row, { width: 400 }] }, e(Text, { style: S.label }, label), e(Text, { style: { width: 40, textAlign: 'right' } }, pg == null ? '' : String(pg)));
  const contentsPage = e(Page, { size: 'A4', style: S.page },
    ...chrome(),
    e(Text, { style: [S.h1, { marginBottom: 14 }] }, 'Contents'),
    contentsRow(ABRIDGED.contentsBalanceSheet, known?.bs),
    contentsRow(ABRIDGED.contentsNotes, known?.notes));

  const docTitle = `${m.companyName} — ${abridged ? 'abridged financial statements' : 'financial statements'}, ${periodPhrase}`;
  const pages = abridged ? [certPage, cover, contentsPage, bsPage, notesPage] : [cover, pnlPage, bsPage, notesPage];
  return e(Document, { title: docTitle, author: 'Ledgrly', creator: 'Ledgrly', producer: 'Ledgrly' }, ...pages);
}
