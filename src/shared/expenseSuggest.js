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
  return { code: match.nominal_code, name: acct.name, category: acct.category || acct.type || '' };
}

// The accounts an expense can be coded to: the company's active chart, else the static GL list
// (same as the Expenses form's picker).
export function expenseAccountOptions(coaAccounts) {
  const active = (coaAccounts || []).filter(a => a.is_active !== false);
  return active.length > 0 ? active : GL_ACCOUNTS;
}
