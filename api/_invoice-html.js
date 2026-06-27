// Shared invoice/CN HTML generator — used by both invoice-pdf.js and send-invoice.js.
// RCT/RC_EU/EXEMPT lines render with zero VAT and append mandatory statutory statements.

export const INV_VAT_PCT = { STD23: 23, RED13: 13.5, RED9: 9, ZERO: 0, EXEMPT: 0, RCT: 0, RC_EU: 0 };

export const INV_VAT_LABEL = {
  STD23: '23%', RED13: '13.5%', RED9: '9%',
  ZERO: '0% (Zero-rated)', EXEMPT: 'Exempt',
  RCT: 'RCT (Reverse Charge)', RC_EU: 'Reverse Charge (EU)',
};

const ZERO_VAT = new Set(['EXEMPT', 'RCT', 'RC_EU']);

const DEFAULT_STMT_RCT    = 'This invoice is subject to Relevant Contracts Tax (RCT). VAT is to be accounted for by the principal contractor under the reverse charge mechanism in accordance with Section 16(3) of the VAT Consolidation Act 2010.';
const DEFAULT_STMT_RC_EU  = 'Reverse charge applies – VAT to be accounted for by the recipient under Articles 44 and 196 of the EU VAT Directive';
const DEFAULT_STMT_EXEMPT = 'VAT exempt supply under Section 34 of the VAT Consolidation Act 2010';

export function calcLine(line) {
  const qty      = Number(line.quantity)   || 0;
  const price    = Number(line.unit_price) || 0;
  const lineNet  = Math.round(qty * price * 100) / 100;
  const lineVat  = ZERO_VAT.has(line.vat_code) ? 0 : Math.round(lineNet * (INV_VAT_PCT[line.vat_code] ?? 0)) / 100;
  const lineGross = Math.round((lineNet + lineVat) * 100) / 100;
  return { ...line, line_total: lineNet, vat_amount: lineVat, gross_total: lineGross };
}

export function buildInvoiceHTML(inv, lines, customer, settings, companyName) {
  const isCN   = inv.type === 'credit_note';
  const accent = isCN ? '#b91c1c' : '#1d6b72';
  const fmt    = v => '€' + Number(v || 0).toFixed(2);

  // Aggregate VAT by code and detect special codes
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

  const bizName  = settings?.trading_name || companyName || '';
  const compAddr = (settings?.address     || '').replace(/\n/g, '<br>');
  const custAddr = (customer?.address     || '').replace(/\n/g, '<br>');
  const bankDet  = (settings?.bank_details || '').replace(/\n/g, '<br>');
  const footer   = settings?.footer_notes || inv.footer || '';

  // Statutory statements — pull from settings (user-editable), fall back to defaults
  const docNoun    = isCN ? 'credit note' : 'invoice';
  const stmtRCT    = (settings?.stmt_rct   || DEFAULT_STMT_RCT).replace('This invoice', `This ${docNoun}`);
  const stmtRC_EU  =  settings?.stmt_rc_eu  || DEFAULT_STMT_RC_EU;
  const stmtExempt =  settings?.stmt_exempt || DEFAULT_STMT_EXEMPT;
  const statements = [];
  if (hasRCT)    statements.push(stmtRCT);
  if (hasRC_EU)  statements.push(stmtRC_EU);
  if (hasExempt) statements.push(stmtExempt);

  const lineRows = lines.map(l => {
    const showVat = !ZERO_VAT.has(l.vat_code);
    return `<tr>
      <td style="padding:8px 7px;border-bottom:1px solid #f0f0f0;font-size:12px">${l.description || ''}</td>
      <td style="padding:8px 7px;border-bottom:1px solid #f0f0f0;font-size:12px;text-align:right">${Number(l.quantity).toLocaleString('en-IE',{maximumFractionDigits:4})}</td>
      <td style="padding:8px 7px;border-bottom:1px solid #f0f0f0;font-size:12px;text-align:right">${fmt(l.unit_price)}</td>
      <td style="padding:8px 7px;border-bottom:1px solid #f0f0f0;font-size:11px;text-align:right;color:#888">${INV_VAT_LABEL[l.vat_code] || l.vat_code}</td>
      <td style="padding:8px 7px;border-bottom:1px solid #f0f0f0;font-size:12px;text-align:right">${fmt(l.line_total)}</td>
      <td style="padding:8px 7px;border-bottom:1px solid #f0f0f0;font-size:12px;text-align:right;color:${showVat ? '#555' : '#aaa'}">${showVat ? fmt(l.vat_amount) : 'N/A'}</td>
      <td style="padding:8px 7px;border-bottom:1px solid #f0f0f0;font-size:12px;text-align:right;font-weight:600">${fmt(l.gross_total)}</td>
    </tr>`;
  }).join('');

  const vatRows = Object.entries(vatAgg).map(([vc, r]) => `<tr>
    <td style="padding:5px 10px;font-size:11.5px">${INV_VAT_LABEL[vc] || vc}</td>
    <td style="padding:5px 10px;font-size:11.5px;text-align:right">${fmt(r.net)}</td>
    <td style="padding:5px 10px;font-size:11.5px;text-align:right">${fmt(r.vat)}</td>
    <td style="padding:5px 10px;font-size:11.5px;text-align:right;font-weight:600">${fmt(r.gross)}</td>
  </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${isCN ? 'Credit Note' : 'Invoice'} ${inv.invoice_number || ''}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;color:#1a1a2e;background:#fff;font-size:13px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.pg{max-width:800px;margin:0 auto;padding:48px 52px}
.hdr{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:36px}
.logo-img{max-height:60px;max-width:160px;object-fit:contain;display:block;margin-bottom:10px}
.biz-name{font-size:17px;font-weight:700;color:#1a1a2e}
.addr{font-size:11px;color:#666;line-height:1.65;margin-top:4px}
.vat-reg{font-size:11px;color:#888;margin-top:3px}
.doc-type{font-size:26px;font-weight:800;color:${accent};letter-spacing:-.5px;line-height:1}
.doc-num{font-size:14px;font-weight:600;color:#1a1a2e;margin-top:3px}
.cn-badge{display:inline-block;background:#fef2f2;border:1.5px solid #fca5a5;color:#b91c1c;padding:3px 10px;border-radius:4px;font-size:10px;font-weight:700;letter-spacing:.06em;margin-bottom:8px}
.meta{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-bottom:32px}
.meta-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#888;margin-bottom:6px}
.meta-val{font-size:12.5px;line-height:1.7;color:#333}
.meta-tbl{width:100%;font-size:12px;border-collapse:collapse}
.meta-tbl td{padding:2px 0}
.meta-tbl td:last-child{text-align:right;font-weight:600}
.meta-tbl td:first-child{color:#888}
table.lines{width:100%;border-collapse:collapse;margin-bottom:20px}
table.lines th{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#888;padding:5px 7px;border-bottom:2px solid ${accent};text-align:left}
table.lines th.r{text-align:right}
.vat-sum{width:100%;border-collapse:collapse;background:#f8f9fa;border-radius:5px;margin-bottom:22px}
.vat-sum th{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#888;padding:6px 10px;text-align:right}
.vat-sum th:first-child{text-align:left}
.vat-sum td{border-top:1px solid #eaeaea}
.totals{display:flex;justify-content:flex-end;margin-bottom:22px}
.totals-tbl{width:240px;font-size:12.5px;border-collapse:collapse}
.totals-tbl td{padding:3px 0}
.totals-tbl td:last-child{text-align:right;font-weight:600}
.tot-final{border-top:2px solid #1a1a2e}
.tot-final td{padding-top:8px;font-size:14px;font-weight:700}
.bank{background:#f8f9fa;border-radius:5px;padding:13px;margin-bottom:20px;font-size:12px;color:#444;line-height:1.8}
.bank-lbl{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#888;margin-bottom:5px}
.stmt{background:#fffbeb;border:1px solid #fde68a;border-radius:4px;padding:10px 13px;margin-bottom:16px;font-size:11.5px;color:#78350f;line-height:1.6}
.ft{border-top:1px solid #e8e8e8;padding-top:14px;font-size:11px;color:#999;text-align:center;line-height:1.7}
@media print{@page{size:A4;margin:0}body{margin:0}}
</style>
</head>
<body>
<div class="pg">

  <div class="hdr">
    <div>
      ${settings?.logo_url ? `<img class="logo-img" src="${settings.logo_url}" alt="">` : ''}
      <div class="biz-name">${bizName}</div>
      ${compAddr ? `<div class="addr">${compAddr}</div>` : ''}
      ${settings?.vat_number ? `<div class="vat-reg">VAT Reg: ${settings.vat_number}</div>` : ''}
      ${settings?.reg_number ? `<div class="vat-reg">CRN: ${settings.reg_number}</div>` : ''}
    </div>
    <div style="text-align:right">
      ${isCN ? '<div class="cn-badge">CREDIT NOTE</div><br>' : ''}
      <div class="doc-type">${isCN ? 'Credit Note' : 'Invoice'}</div>
      <div class="doc-num">${inv.invoice_number || ''}</div>
      ${inv.credit_note_for_number ? `<div style="font-size:11px;color:#888;margin-top:3px">Against: ${inv.credit_note_for_number}</div>` : ''}
    </div>
  </div>

  <div class="meta">
    <div>
      <div class="meta-label">Bill To</div>
      <div class="meta-val">
        <strong>${customer?.name || ''}</strong>
        ${customer?.vat_number ? `<br>VAT: ${customer.vat_number}` : ''}
        ${custAddr ? `<br>${custAddr}` : ''}
        ${customer?.email ? `<br>${customer.email}` : ''}
      </div>
    </div>
    <div style="text-align:right">
      <table class="meta-tbl">
        <tr><td>${isCN ? 'Credit Note Date' : 'Invoice Date'}:</td><td>${inv.issue_date || ''}</td></tr>
        ${inv.due_date_calc || inv.due_date ? `<tr><td>Due Date:</td><td>${inv.due_date_calc || inv.due_date}</td></tr>` : ''}
        ${inv.reference ? `<tr><td>Reference:</td><td>${inv.reference}</td></tr>` : ''}
        ${inv.payment_terms ? `<tr><td>Terms:</td><td>Net ${inv.payment_terms} days</td></tr>` : ''}
      </table>
    </div>
  </div>

  <table class="lines">
    <thead>
      <tr>
        <th>Description</th>
        <th class="r">Qty</th>
        <th class="r">Unit Price (ex. VAT)</th>
        <th class="r">VAT Rate</th>
        <th class="r">Net</th>
        <th class="r">VAT</th>
        <th class="r">Gross</th>
      </tr>
    </thead>
    <tbody>${lineRows}</tbody>
  </table>

  ${Object.keys(vatAgg).length > 0 ? `
  <table class="vat-sum">
    <thead><tr><th>VAT Rate</th><th style="text-align:right">Net</th><th style="text-align:right">VAT</th><th style="text-align:right">Gross</th></tr></thead>
    <tbody>${vatRows}</tbody>
  </table>` : ''}

  <div class="totals">
    <table class="totals-tbl">
      <tr><td style="color:#666">Subtotal (ex. VAT)</td><td>${fmt(inv.subtotal)}</td></tr>
      <tr><td style="color:#666">VAT</td><td>${fmt(inv.vat_total)}</td></tr>
      <tr class="tot-final"><td>${isCN ? 'Credit Total' : 'Total Due'}</td><td style="color:${accent}">${fmt(inv.total)}</td></tr>
    </table>
  </div>

  ${statements.length > 0 ? `<div class="stmt">${statements.join('<br><br>')}</div>` : ''}

  ${bankDet && !isCN ? `<div class="bank"><div class="bank-lbl">Payment Details</div>${bankDet}</div>` : ''}

  ${inv.notes ? `<div style="font-size:12px;color:#555;margin-bottom:18px;line-height:1.7">${inv.notes}</div>` : ''}

  ${footer ? `<div class="ft">${footer}</div>` : ''}

</div>
</body>
</html>`;
}
