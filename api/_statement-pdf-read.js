// BNK-14 step 3: read a text-PDF bank statement. The server extracts each page's text layer
// (pdf.js), refuses scanned or photographed files and files whose text layer cannot be read,
// splits the PDF into chunks of pages (pdf-lib), has the model copy what is printed, and hands the
// result to src/shared/statementPdfVerify.js. Dependencies are passed in (deps.callClaude), so the
// flow is tested without the model.
import { PDFDocument } from 'pdf-lib';
import { classifyPage, verifyStatement } from '../src/shared/statementPdfVerify.js';

export const CHUNK_PAGES = 10;
// Published rates, USD per million tokens (platform.claude.com pricing, checked 9 Oct 2026).
export const PRICE_PER_MTOK = { 'claude-sonnet-5-5': { input: 2, output: 10 }, 'claude-haiku-4-5-20251001': { input: 1, output: 5 } };

export async function pageTexts(buf) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await getDocument({ data: new Uint8Array(buf), verbosity: 0, isEvalSupported: false }).promise;
  const out = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    out.push(tc.items.map(i => i.str + (i.hasEOL ? '\n' : ' ')).join(''));
  }
  return out;
}

// 'text' when every page with content has a readable text layer; 'scanned' when the pages have no
// text (images only: scanned or photographed); 'unreadable_text' when a text layer exists but its
// characters cannot be decoded. Only 'text' is read in this phase.
export function classifyFile(texts) {
  const kinds = texts.map(classifyPage);
  const n = kinds.length;
  const count = k => kinds.filter(x => x === k).length;
  if (count('unreadable_text') > 0) return { kind: 'unreadable_text', kinds };
  if (count('text') === 0 || count('no_text') > n / 2) return { kind: 'scanned', kinds };
  return { kind: 'text', kinds };
}

export async function chunkPdf(buf, size = CHUNK_PAGES) {
  const src = await PDFDocument.load(buf, { ignoreEncryption: false });
  const n = src.getPageCount();
  const chunks = [];
  for (let start = 0; start < n; start += size) {
    const idx = Array.from({ length: Math.min(size, n - start) }, (_, k) => start + k);
    const out = await PDFDocument.create();
    (await out.copyPages(src, idx)).forEach(p => out.addPage(p));
    chunks.push({ firstPage: start + 1, lastPage: start + idx.length, base64: Buffer.from(await out.save()).toString('base64') });
  }
  return chunks;
}

export const READ_PROMPT = `You are reading pages of a bank statement. Copy what is printed; never calculate, round, reformat or infer a figure.

Return ONLY a JSON object of this shape:
{"statement": {"bank": string, "document_type": "transactions" | "fees" | "other", "period_start_text": string|null, "period_end_text": string|null},
 "sections": [{"key": string, "account_label": string, "currency": string|null,
   "opening_balance_text": string|null, "closing_balance_text": string|null,
   "total_in_text": string|null, "total_out_text": string|null, "count_text": string|null,
   "rows": [{"page": number, "date_text": string, "description": string,
     "money_in_text": string|null, "money_out_text": string|null, "amount_text": string|null,
     "balance_text": string|null, "status_text": string|null}]}]}

Rules:
- document_type: "transactions" for an account statement listing transactions; "fees" for a statement of fees, charges or interest; "other" for anything else (then return no sections).
- Every *_text value is copied character for character from the page (keep currency signs, commas, minus signs, CR/DR). Use null when nothing is printed.
- One section per account, currency or pocket, in the order printed. "key" is short and identical for the same account in every part of the statement (for example "EUR main" or "GBP"). In account_label write only the account's name or type and at most the last 4 digits of any account number or IBAN.
- One row per transaction line, in the order printed, with the page number (1 = the first page you were given). Join a description that wraps onto several lines.
- Use money_in_text and money_out_text when the statement has separate in/out (or credit/debit) columns; use amount_text when it prints one signed amount. Never both.
- Do not output as rows: column headers, page totals, "balance brought forward" or "carried forward" lines, opening or closing balance lines, or summaries. Put the statement's opening and closing balance, total in, total out and transaction count in the section fields when printed.
- status_text: only if the statement marks the line (for example "Pending" or "Reverted").`;

function parseJson(text) {
  const t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('no JSON object in the reply');
  return JSON.parse(t.slice(a, b + 1));
}

// -> { kind, pages, refused?, chunks: [{ firstPage, lastPage, ms, usage, stop_reason }], result, cost }
export async function readStatementPdf(deps, { buf, model, chunkPages = CHUNK_PAGES, companyId = null }) {
  const texts = await pageTexts(buf);
  const cls = classifyFile(texts);
  if (cls.kind !== 'text') return { kind: cls.kind, pages: texts.length, refused: cls.kind === 'scanned' ? 'Scanned or photographed statements are not read yet' : 'This PDF has a text layer that cannot be read (its characters are not decodable)' };
  const parts = await chunkPdf(buf, chunkPages);
  const chunks = [];
  for (const part of parts) {
    const t0 = Date.now();
    const r = await deps.callClaude({
      model, max_tokens: 32000, operation: 'read-statement-pdf', company_id: companyId,
      messages: [{ role: 'user', content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: part.base64 } },
        { type: 'text', text: READ_PROMPT },
      ] }],
    });
    if (!r.ok) throw new Error(`model call failed for pages ${part.firstPage}-${part.lastPage}: ${r.data?.error?.message || r.status}`);
    chunks.push({ firstPage: part.firstPage, lastPage: part.lastPage, ms: Date.now() - t0, usage: r.data?.usage || {}, stop_reason: r.data?.stop_reason, result: parseJson(r.text) });
  }
  // A statement of fees, or any other document, is not a statement of transactions: refused with
  // its reason, not imported.
  const docType = chunks[0]?.result?.statement?.document_type;
  if (docType && docType !== 'transactions') {
    return { kind: 'text', pages: texts.length, chunks, refused: docType === 'fees'
      ? 'This PDF is a statement of fees or charges, not a statement of transactions'
      : 'This PDF does not look like a bank statement of transactions', document_type: docType, ...costOf(chunks, model, texts.length) };
  }
  const result = verifyStatement({ chunks, pageTexts: texts });
  return { kind: 'text', pages: texts.length, chunks, result, ...costOf(chunks, model, texts.length) };
}

// Tokens, cost (USD at the published rates) and model time for a set of chunk reads.
export function costOf(chunks, model, pages) {
  const tokens = chunks.reduce((t, c) => ({ input: t.input + (c.usage?.input_tokens || 0), output: t.output + (c.usage?.output_tokens || 0) }), { input: 0, output: 0 });
  const price = PRICE_PER_MTOK[model];
  const usd = price ? (tokens.input * price.input + tokens.output * price.output) / 1e6 : null;
  return { tokens, cost: { usd, per_page: usd == null ? null : usd / pages }, ms: chunks.reduce((t, c) => t + (c.ms || 0), 0) };
}
