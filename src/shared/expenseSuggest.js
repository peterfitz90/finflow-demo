// Expense nominal suggestion — the Expenses form's rule, shared by the full app and /mobile.
// Matches "supplier description" against the transaction_rules engine BankImport uses
// (applyRules + useTransactionRules). Expenses are always money out regardless of the stored
// amount's sign, so -Math.abs(amount) makes applyRules' direction filter treat every expense
// correctly. Returns the matched account ({ code, name, category }) from the company's chart,
// falling back to the static GL list, or null when nothing matches (leave the default alone).
import { applyRules } from './txRules.js';
import { GL_ACCOUNTS } from './chartOfAccounts.js';

export function suggestExpenseAccount(supplier, description, amount, rules, coaAccounts) {
  const matchText = `${supplier || ''} ${description || ''}`.trim();
  if (!matchText || !rules?.length) return null;
  const match = applyRules(matchText, -Math.abs(parseFloat(amount) || 0), rules);
  if (!match) return null;
  const acct = (coaAccounts || []).find(a => a.code === match.nominal_code) || GL_ACCOUNTS.find(a => a.code === match.nominal_code);
  if (!acct) return null;
  return { code: match.nominal_code, name: acct.name, category: acct.category || acct.type || '', ruleVatCode: match.vat_code ?? null };
}

// The accounts an expense can be coded to: the company's active chart, else the static GL list
// (same as the Expenses form's picker).
export function expenseAccountOptions(coaAccounts) {
  const active = (coaAccounts || []).filter(a => a.is_active !== false);
  return active.length > 0 ? active : GL_ACCOUNTS;
}

// ── VAT code ───────────────────────────────────────────────────────────────────────────────
// The codes an expense can carry — the bill form's list. An accountant sets it; for anyone else
// the suggestion is kept (expenses_vat_code_lock, like journals_vat_code_lock, ignores a
// non-accountant's change), and it's carried onto the expense's journal so T2 counts it.
export const EXPENSE_VAT_CODES = ['STD23', 'RED13', 'RED9', 'ZERO', 'EXEMPT', 'NONE'];
const RATE_CODES = [['STD23', 23], ['RED13', 13.5], ['RED9', 9]];

// The receipt's own rate: the reader's vat_rate if it read one, else VAT ÷ net. Within 1.5
// points of 23 / 13.5 / 9 → that code; anything else (or no VAT shown) → no suggestion.
export function vatCodeFromReceipt({ vatAmount, total, vatRate }) {
  let rate = vatRate !== null && vatRate !== undefined && vatRate !== '' && Number.isFinite(Number(vatRate)) && Number(vatRate) > 0 ? Number(vatRate) : null;
  const v = Number(vatAmount) || 0, t = Number(total) || 0;
  if (rate === null && v > 0 && t > v) rate = (v / (t - v)) * 100;
  if (rate === null) return null;
  const hit = RATE_CODES.find(([, r]) => Math.abs(rate - r) <= 1.5);
  return hit ? hit[0] : null;
}

// Suggested VAT code, in order of preference: the matched transaction rule's vat_code, then the
// expense account's default_vat_code, then the receipt's own rate. → { code, source } | null.
export function suggestExpenseVatCode({ ruleVatCode, nominal, coaAccounts, vatAmount, total, vatRate }) {
  if (ruleVatCode && EXPENSE_VAT_CODES.includes(ruleVatCode)) return { code: ruleVatCode, source: 'rule' };
  const acct = (coaAccounts || []).find(a => a.code === nominal);
  if (acct?.default_vat_code && EXPENSE_VAT_CODES.includes(acct.default_vat_code)) return { code: acct.default_vat_code, source: 'account' };
  const fromReceipt = vatCodeFromReceipt({ vatAmount, total, vatRate });
  return fromReceipt ? { code: fromReceipt, source: 'receipt' } : null;
}

export const VAT_SOURCE_LABEL = { rule: 'from the matching rule', account: "from the account's default", receipt: "from the receipt's VAT rate" };
