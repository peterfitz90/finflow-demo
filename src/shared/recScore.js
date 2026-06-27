/**
 * Extracted verbatim from App.jsx recScoreCandidate and helpers.
 * Threshold used by the matching engine: score >= 60 → settlement candidate.
 * Keep in sync with App.jsx if scoring logic changes there.
 */

export function recTokenize(str) {
  return (str || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length > 2);
}

export function recFuzzyBonus(a, b) {
  const sa = new Set(recTokenize(a)), sb = new Set(recTokenize(b));
  let overlap = 0;
  for (const t of sa) if (sb.has(t)) overlap++;
  if (!overlap) return 0;
  const ratio = overlap / Math.min(sa.size || 1, sb.size || 1);
  return ratio >= 0.5 ? 15 : ratio >= 0.2 ? 10 : 0;
}

/**
 * Score a bank transaction against a settlement candidate (AP/AR invoice or journal).
 * Returns 0–100. Scores >= 60 are considered strong settlement matches.
 *
 * @param {{ amount: number, date: string, description: string }} bt
 * @param {{ _type: string, _date: string, outstanding: number, amount: number, [key: string]: any }} cand
 */
export function recScoreCandidate(bt, cand) {
  const absBt = Math.abs(Number(bt.amount));
  const outs  = Number(cand.outstanding ?? cand.amount);
  if (absBt <= 0 || outs <= 0) return 0;

  const diff    = absBt - outs;
  const diffAbs = Math.abs(diff);
  const days    = cand._date ? Math.abs(new Date(bt.date) - new Date(cand._date)) / 86400000 : 999;
  let base = 0;

  if (cand._type === 'journal') {
    if (diffAbs < 0.005) {
      base = days < 0.5 ? 85 : days <= 3 ? 70 : days <= 14 ? 45 : 0;
    }
  } else if (diffAbs < 0.005) {
    base = days < 0.5 ? 88 : days <= 3 ? 74 : days <= 14 ? 52 : days <= 30 ? 30 : 0;
  } else if (diffAbs <= 0.50) {
    base = days <= 3 ? 82 : days <= 14 ? 62 : days <= 30 ? 40 : 0;
  } else if (diff < 0 && absBt / outs >= 0.05) {
    base = days <= 14 ? 42 : days <= 30 ? 24 : days <= 60 ? 12 : 0;
  } else if (diff > 0 && outs / absBt >= 0.05) {
    base = 52;
  }

  if (!base) return 0;
  const candDesc = [
    cand.invoice_ref, cand.invoice_number, cand.client,
    cand.supplier, cand.description, cand.reference,
  ].filter(Boolean).join(' ');
  return Math.min(base + recFuzzyBonus(bt.description, candDesc), 100);
}
