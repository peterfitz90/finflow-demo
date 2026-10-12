// GEO-02: the ledger is EUR-only (journals carry no currency), so a foreign-currency bank line
// must never post its face value as euro. Used by the shared posting step (importDedup.js
// postImportBatch), the bank import preview (CSV and PDF) and Reconciliation. Pure module.
//
// The one exception: a foreign-currency section (one currency in one preview: a PDF section, or
// the lines of one currency in a CSV) where EVERY line prints its euro amount (eur_amount). The
// euro column then posts, and the line records its original currency and amount and the printed
// euro amount. If any line in the section lacks one, the whole section stays blocked.

export const FX_BLOCK_MESSAGE = "Foreign-currency lines can't be posted yet; multi-currency posting is planned.";
// Reconciliation: a foreign-currency line is not settled against a euro invoice or bill (or on
// account), nor categorised to a new journal; both would post its amount as euro.
export const SETTLE_FX_MESSAGE = "Foreign-currency lines can't be settled against an invoice or bill yet; multi-currency posting is planned.";

export const isEurCurrency = c => c == null || c === '' || String(c).toUpperCase() === 'EUR';
export const isForeignLine = r => !isEurCurrency(r?.currency);

// A printed euro amount the line can post: a number, non-zero, in the same direction as the line.
const hasEuro = r => {
  const e = r.eur_amount;
  if (e == null || e === '' || !Number.isFinite(Number(e)) || Number(e) === 0) return false;
  return Math.sign(Number(e)) === Math.sign(Number(r.amount));
};

// The plan for the lines of one preview (rows: { revolut_id, amount, currency, eur_amount? }).
// -> { sections: [{ currency, lines, missing, mode: 'euro-printed' | 'blocked' }],
//      blockedIds: Set of revolut_ids that are reference only, euroIds: Set posting their euro amount }
export function fxPlan(rows) {
  const byCur = new Map();
  for (const r of rows || []) {
    if (!isForeignLine(r)) continue;
    const cur = String(r.currency).toUpperCase();
    if (!byCur.has(cur)) byCur.set(cur, []);
    byCur.get(cur).push(r);
  }
  const sections = [], blockedIds = new Set(), euroIds = new Set();
  for (const [currency, lines] of byCur) {
    const missing = lines.filter(r => !hasEuro(r)).length;
    const mode = missing ? 'blocked' : 'euro-printed';
    for (const r of lines) (mode === 'blocked' ? blockedIds : euroIds).add(r.revolut_id);
    sections.push({ currency, lines: lines.length, missing, mode });
  }
  return { sections, blockedIds, euroIds };
}

// The line as it posts. A EUR line is unchanged. A line in a euro-printed section posts its
// printed euro amount, keeping its original currency and amount; its printed running balance is
// in the foreign currency, so it is not carried. Any other foreign line throws: it must never
// reach the ledger.
export function toLedgerLine(r, plan) {
  if (!isForeignLine(r)) return r;
  if (!plan.euroIds.has(r.revolut_id) || !hasEuro(r)) throw new Error(FX_BLOCK_MESSAGE);
  const eur = Math.round(Number(r.eur_amount) * 100) / 100;
  return { ...r, amount: eur, currency: 'EUR', balance: null,
    original_currency: String(r.currency).toUpperCase(), original_amount: Number(r.amount), printed_eur_amount: eur };
}

// For the shared posting step: the bank transactions that would post a foreign amount as euro.
export function foreignLinesIn(bts) {
  return (bts || []).filter(isForeignLine);
}
