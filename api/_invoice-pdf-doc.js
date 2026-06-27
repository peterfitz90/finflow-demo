// React-PDF invoice/credit-note document.
// Uses React.createElement throughout (no JSX) so it works as a plain .js module.
// Statutory VAT wording is verbatim — never paraphrase.

import React from 'react';
import { Document, Page, View, Text, Image, pdf } from '@react-pdf/renderer';

// toBuffer() returns Promise<PDFDocument> — PDFDocument is a PDFKit Readable stream.
// Collect chunks via events to produce a standard Node.js Buffer.
export async function renderPDF(element) {
  const stream = await pdf(element).toBuffer();
  const chunks = [];
  return new Promise((resolve, reject) => {
    stream.on('data',  chunk => chunks.push(Buffer.from(chunk)));
    stream.on('end',   () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

// ── Constants (kept in sync with _invoice-html.js) ───────────────────────────
const INV_VAT_PCT = { STD23: 23, RED13: 13.5, RED9: 9, ZERO: 0, EXEMPT: 0, RCT: 0, RC_EU: 0 };
const INV_VAT_LABEL = {
  STD23: '23%', RED13: '13.5%', RED9: '9%',
  ZERO: '0% (Zero-rated)', EXEMPT: 'Exempt',
  RCT: 'RCT (Reverse Charge)', RC_EU: 'Reverse Charge (EU)',
};
const ZERO_VAT = new Set(['EXEMPT', 'RCT', 'RC_EU']);

// Verbatim statutory statements — compliance text, do not edit.
const DEFAULT_STMT_RCT    = 'This invoice is subject to Relevant Contracts Tax (RCT). VAT is to be accounted for by the principal contractor under the reverse charge mechanism in accordance with Section 16(3) of the VAT Consolidation Act 2010.';
const DEFAULT_STMT_RC_EU  = 'Reverse charge applies – VAT to be accounted for by the recipient under Articles 44 and 196 of the EU VAT Directive';
const DEFAULT_STMT_EXEMPT = 'VAT exempt supply under Section 34 of the VAT Consolidation Act 2010';

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = v => '€' + Number(v || 0).toFixed(2);

// React.createElement shorthand — avoids JSX requirement in .js files
const e = (type, props, ...children) => React.createElement(type, props, ...children);

// Style factories
const t    = (sz, extra = {}) => ({ fontSize: sz, color: '#1a1a2e', ...extra });
const bold = (sz, extra = {}) => ({ fontSize: sz, fontFamily: 'Helvetica-Bold', color: '#1a1a2e', ...extra });
const dim  = (sz, extra = {}) => ({ fontSize: sz, color: '#888', ...extra });

const TH = { fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#888', textTransform: 'uppercase', letterSpacing: 0.4 };

// ── Document builder ──────────────────────────────────────────────────────────
export function buildInvoicePDF(inv, lines, customer, settings, companyName) {
  const isCN    = inv.type === 'credit_note';
  const accent  = isCN ? '#b91c1c' : '#1d6b72';
  const docNoun = isCN ? 'credit note' : 'invoice';

  // VAT aggregation + special-code detection
  const vatAgg = {};
  let hasRCT = false, hasRC_EU = false, hasExempt = false;
  for (const l of lines) {
    const vc = l.vat_code || 'STD23';
    if (vc === 'RCT')    hasRCT    = true;
    if (vc === 'RC_EU')  hasRC_EU  = true;
    if (vc === 'EXEMPT') hasExempt = true;
    if (!vatAgg[vc]) vatAgg[vc] = { net: 0, vat: 0, gross: 0 };
    vatAgg[vc].net   += Number(l.line_total)  || 0;
    vatAgg[vc].vat   += Number(l.vat_amount)  || 0;
    vatAgg[vc].gross += Number(l.gross_total) || 0;
  }

  // Statutory statements — verbatim from settings with default fallback; noun-swap for CN
  const stmtRCT    = (settings?.stmt_rct   || DEFAULT_STMT_RCT).replace('This invoice', `This ${docNoun}`);
  const stmtRC_EU  =  settings?.stmt_rc_eu  || DEFAULT_STMT_RC_EU;
  const stmtExempt =  settings?.stmt_exempt || DEFAULT_STMT_EXEMPT;
  const statements = [];
  if (hasRCT)    statements.push(stmtRCT);
  if (hasRC_EU)  statements.push(stmtRC_EU);
  if (hasExempt) statements.push(stmtExempt);

  const bizName       = settings?.trading_name || companyName || '';
  const bankDet       = settings?.bank_details || '';
  const footer        = settings?.footer_notes || inv.footer || '';
  const compAddrLines = (settings?.address || '').split('\n').filter(Boolean);
  const custAddrLines = (customer?.address  || '').split('\n').filter(Boolean);

  // Column widths — A4 content ≈ 515pt (40pt side padding each)
  const C = {
    desc:  { flex: 1 },
    qty:   { width: 32, textAlign: 'right' },
    price: { width: 70, textAlign: 'right' },
    vatr:  { width: 64, textAlign: 'right' },
    net:   { width: 55, textAlign: 'right' },
    vat:   { width: 48, textAlign: 'right' },
    gross: { width: 58, textAlign: 'right' },
  };

  // Line item rows
  const lineRows = lines.map((l, i) => {
    const showVat = !ZERO_VAT.has(l.vat_code);
    return e(View, { key: i, style: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#f0f0f0', paddingVertical: 5 } },
      e(View, { style: C.desc },  e(Text, { style: t(11) }, l.description || '')),
      e(View, { style: C.qty },   e(Text, { style: t(11) }, String(Number(l.quantity) || 0))),
      e(View, { style: C.price }, e(Text, { style: t(11) }, fmt(l.unit_price))),
      e(View, { style: C.vatr },  e(Text, { style: dim(10) }, INV_VAT_LABEL[l.vat_code] || l.vat_code || '')),
      e(View, { style: C.net },   e(Text, { style: t(11) }, fmt(l.line_total))),
      e(View, { style: C.vat },   e(Text, { style: showVat ? t(11) : dim(11) }, showVat ? fmt(l.vat_amount) : 'N/A')),
      e(View, { style: C.gross }, e(Text, { style: bold(11) }, fmt(l.gross_total))),
    );
  });

  // VAT summary rows
  const vatRowEls = Object.entries(vatAgg).map(([vc, r], i) =>
    e(View, { key: i, style: { flexDirection: 'row', borderTopWidth: i > 0 ? 1 : 0, borderTopColor: '#eaeaea', paddingVertical: 3 } },
      e(View, { style: { flex: 1 } },                       e(Text, { style: t(11) },    INV_VAT_LABEL[vc] || vc)),
      e(View, { style: { width: 72, textAlign: 'right' } }, e(Text, { style: t(11) },    fmt(r.net))),
      e(View, { style: { width: 72, textAlign: 'right' } }, e(Text, { style: t(11) },    fmt(r.vat))),
      e(View, { style: { width: 72, textAlign: 'right' } }, e(Text, { style: bold(11) }, fmt(r.gross))),
    )
  );

  // Header left: logo + biz info
  const headerLeft = [
    ...(settings?.logo_url ? [e(Image, { key: 'logo', src: settings.logo_url, style: { height: 48, objectFit: 'contain', marginBottom: 6 } })] : []),
    e(Text, { key: 'biz', style: bold(16, { marginBottom: 2 }) }, bizName),
    ...compAddrLines.map((ln, i) => e(Text, { key: `a${i}`, style: dim(10, { lineHeight: 1.5 }) }, ln)),
    ...(settings?.vat_number ? [e(Text, { key: 'vatn', style: dim(10, { marginTop: 2 }) }, `VAT Reg: ${settings.vat_number}`)] : []),
    ...(settings?.reg_number ? [e(Text, { key: 'crn',  style: dim(10, { marginTop: 2 }) }, `CRN: ${settings.reg_number}`)] : []),
  ];

  // Header right: doc type + number
  const headerRight = [
    ...(isCN ? [e(Text, { key: 'cnb', style: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#b91c1c', letterSpacing: 0.5, marginBottom: 6 } }, '■ CREDIT NOTE')] : []),
    e(Text, { key: 'dtype', style: { fontSize: 24, fontFamily: 'Helvetica-Bold', color: accent } }, isCN ? 'Credit Note' : 'Invoice'),
    e(Text, { key: 'dnum',  style: bold(13, { marginTop: 2 }) }, inv.invoice_number || ''),
    ...(inv.credit_note_for_number ? [e(Text, { key: 'cnref', style: dim(10, { marginTop: 2 }) }, `Against: ${inv.credit_note_for_number}`)] : []),
  ];

  // Bill To block
  const billToChildren = [
    e(Text, { key: 'lbl', style: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#888', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 5 } }, 'Bill To'),
    ...(customer?.name        ? [e(Text, { key: 'cn', style: bold(11) }, customer.name)] : []),
    ...(customer?.vat_number  ? [e(Text, { key: 'cv', style: t(11, { lineHeight: 1.5 }) }, `VAT: ${customer.vat_number}`)] : []),
    ...custAddrLines.map((ln, i) => e(Text, { key: `ca${i}`, style: t(11, { lineHeight: 1.5 }) }, ln)),
    ...(customer?.email       ? [e(Text, { key: 'ce', style: t(11, { lineHeight: 1.5 }) }, customer.email)] : []),
  ];

  // Meta table (dates, reference, terms)
  const metaRows = [
    e(View, { key: 'idate', style: { flexDirection: 'row', marginBottom: 3 } },
      e(Text, { style: dim(11, { width: 90 }) }, isCN ? 'CN Date:' : 'Invoice Date:'),
      e(Text, { style: bold(11) }, inv.issue_date || ''),
    ),
    ...((inv.due_date_calc || inv.due_date) ? [
      e(View, { key: 'ddate', style: { flexDirection: 'row', marginBottom: 3 } },
        e(Text, { style: dim(11, { width: 90 }) }, 'Due Date:'),
        e(Text, { style: bold(11) }, inv.due_date_calc || inv.due_date),
      ),
    ] : []),
    ...(inv.reference ? [
      e(View, { key: 'ref', style: { flexDirection: 'row', marginBottom: 3 } },
        e(Text, { style: dim(11, { width: 90 }) }, 'Reference:'),
        e(Text, { style: bold(11) }, inv.reference),
      ),
    ] : []),
    ...(inv.payment_terms ? [
      e(View, { key: 'terms', style: { flexDirection: 'row', marginBottom: 3 } },
        e(Text, { style: dim(11, { width: 90 }) }, 'Terms:'),
        e(Text, { style: bold(11) }, `Net ${inv.payment_terms} days`),
      ),
    ] : []),
  ];

  return e(Document, {},
    e(Page, { size: 'A4', style: { padding: 40, fontFamily: 'Helvetica', fontSize: 12, color: '#1a1a2e' } },

      // Header
      e(View, { style: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 28 } },
        e(View, { style: { flex: 1 } }, ...headerLeft),
        e(View, { style: { alignItems: 'flex-end' } }, ...headerRight),
      ),

      // Bill To + dates
      e(View, { style: { flexDirection: 'row', marginBottom: 28 } },
        e(View, { style: { flex: 1 } }, ...billToChildren),
        e(View, { style: { alignItems: 'flex-end' } }, ...metaRows),
      ),

      // Line items
      e(View, { style: { marginBottom: 14 } },
        e(View, { style: { flexDirection: 'row', borderBottomWidth: 2, borderBottomColor: accent, paddingBottom: 4, marginBottom: 1 } },
          e(View, { style: C.desc },  e(Text, { style: TH }, 'Description')),
          e(View, { style: C.qty },   e(Text, { style: TH }, 'Qty')),
          e(View, { style: C.price }, e(Text, { style: TH }, 'Unit Price')),
          e(View, { style: C.vatr },  e(Text, { style: TH }, 'VAT Rate')),
          e(View, { style: C.net },   e(Text, { style: TH }, 'Net')),
          e(View, { style: C.vat },   e(Text, { style: TH }, 'VAT')),
          e(View, { style: C.gross }, e(Text, { style: TH }, 'Gross')),
        ),
        ...lineRows,
      ),

      // VAT summary
      ...(Object.keys(vatAgg).length > 0 ? [
        e(View, { style: { backgroundColor: '#f8f9fa', padding: 10, marginBottom: 16 } },
          e(View, { style: { flexDirection: 'row', marginBottom: 4 } },
            e(View, { style: { flex: 1 } },                       e(Text, { style: TH }, 'VAT Rate')),
            e(View, { style: { width: 72, textAlign: 'right' } }, e(Text, { style: TH }, 'Net')),
            e(View, { style: { width: 72, textAlign: 'right' } }, e(Text, { style: TH }, 'VAT')),
            e(View, { style: { width: 72, textAlign: 'right' } }, e(Text, { style: TH }, 'Gross')),
          ),
          ...vatRowEls,
        ),
      ] : []),

      // Totals
      e(View, { style: { alignItems: 'flex-end', marginBottom: 18 } },
        e(View, { style: { width: 230 } },
          e(View, { style: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 } },
            e(Text, { style: dim(12) }, 'Subtotal (ex. VAT)'),
            e(Text, { style: bold(12) }, fmt(inv.subtotal)),
          ),
          e(View, { style: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 } },
            e(Text, { style: dim(12) }, 'VAT'),
            e(Text, { style: bold(12) }, fmt(inv.vat_total)),
          ),
          e(View, { style: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 2, borderTopColor: '#1a1a2e', paddingTop: 7, marginTop: 4 } },
            e(Text, { style: bold(14) }, isCN ? 'Credit Total' : 'Total Due'),
            e(Text, { style: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: accent } }, fmt(inv.total)),
          ),
        ),
      ),

      // Statutory statements (RCT / RC_EU / EXEMPT)
      ...(statements.length > 0 ? [
        e(View, { style: { backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fde68a', padding: 10, marginBottom: 14 } },
          e(Text, { style: { fontSize: 10, color: '#78350f', lineHeight: 1.6 } }, statements.join('\n\n')),
        ),
      ] : []),

      // Bank details (invoices only)
      ...(bankDet && !isCN ? [
        e(View, { style: { backgroundColor: '#f8f9fa', padding: 11, marginBottom: 16 } },
          e(Text, { style: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#888', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 5 } }, 'Payment Details'),
          ...bankDet.split('\n').filter(Boolean).map((ln, i) =>
            e(Text, { key: i, style: { fontSize: 11, color: '#444', lineHeight: 1.7 } }, ln)
          ),
        ),
      ] : []),

      // Notes
      ...(inv.notes ? [
        e(Text, { style: { fontSize: 11, color: '#555', lineHeight: 1.7, marginBottom: 16 } }, inv.notes),
      ] : []),

      // Footer
      ...(footer ? [
        e(View, { style: { borderTopWidth: 1, borderTopColor: '#e8e8e8', paddingTop: 12, marginTop: 8 } },
          e(Text, { style: { fontSize: 10, color: '#999', textAlign: 'center', lineHeight: 1.7 } }, footer),
        ),
      ] : []),

    ),
  );
}
