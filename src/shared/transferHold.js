// Same-account guard (Peter, 7 Oct 2026). A journal whose debit and credit accounts are the same
// nets to nothing, so the bank movement it came from is lost (Moyvencap: nine feed lines coded to
// their own bank nominal 1000). Pure: shared by the bank feed ingest (api/yapily/ingest.js), the
// statement import, Reconciliation and manual journals.
//
// A bank line whose category is TRANSFER, or is its own bank account's nominal, is not posted:
// it is held unreconciled in Reconciliation (bank_transactions.hold_reason = 'transfer') until
// the accountant chooses the other account. A transfer to another bank nominal posts normally.

export const TRANSFER = 'TRANSFER';
export const TRANSFER_LABEL = 'Transfer between own accounts (choose the account in Reconciliation)';

// The AI categoriser's answer as a category: a bank account code (1000–1099) or TRANSFER becomes
// TRANSFER, so an internal transfer is held rather than posted against a bank nominal.
export const categoryFromAI = code => {
  const c = String(code ?? '').trim();
  return /^10\d\d$/.test(c) || c.toUpperCase() === TRANSFER ? TRANSFER : c;
};

// true when a bank line with this category can't be posted against its bank nominal.
export const isTransferHold = (category, bankNominal) =>
  category === TRANSFER || (!!category && !!bankNominal && category === bankNominal);

export const sameAccount = j => !!j && !!j.debit_account && j.debit_account === j.credit_account;

// Throws before any write when a journal would debit and credit the same account.
export function assertDistinctAccounts(rows) {
  const bad = (Array.isArray(rows) ? rows : [rows]).find(sameAccount);
  if (bad) throw new Error(`A journal can't debit and credit the same account (${bad.debit_account}). For a transfer between bank accounts, choose the other account.`);
}
