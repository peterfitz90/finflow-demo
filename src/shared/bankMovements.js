// Cash movements from the ledger (Peter, 7 Oct 2026): Cash Flow's period movement and running
// balance come from journals on the company's bank nominals, the same source as its opening
// balance (nominal_balance_as_of), so the period-end balance always equals the ledger's bank
// balance. Statement lines (bank_transactions) still drive the forecast's daily flow and the
// recurring-payment detection. Pure: no Supabase.

const r2 = n => Math.round(n * 100) / 100;

// journals: rows with date, description, debit_account, credit_account, amount (any order).
// codes: the company's bank nominals. Returns the movements in date order (then id), one per
// journal touching exactly one bank nominal: amount positive into the bank, negative out;
// nominal_account is the other side. A journal between two bank nominals (or on one bank nominal
// both sides) moves no cash in total and is left out.
export function bankMovements(journals, codes) {
  const set = new Set(codes);
  return journals
    .filter(j => set.has(j.debit_account) !== set.has(j.credit_account))
    .map(j => {
      const into = set.has(j.debit_account);
      return { id: j.id, date: j.date, description: j.description, reference: j.reference ?? null,
        nominal_account: into ? j.credit_account : j.debit_account, amount: r2(into ? Number(j.amount) : -Number(j.amount)) };
    })
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.id ?? '') < String(b.id ?? '') ? -1 : 1));
}

// Running balance from an opening balance, in cents to avoid float drift.
export function withRunningBalance(moves, opening) {
  let cents = Math.round(opening * 100);
  return moves.map(m => { cents += Math.round(m.amount * 100); return { ...m, runningBalance: cents / 100 }; });
}

export const netMovement = moves => r2(moves.reduce((s, m) => s + m.amount, 0));
