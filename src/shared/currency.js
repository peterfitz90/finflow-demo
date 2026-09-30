// Currency formatting shared by the full app, /mobile and the AI chat context.
export const CURRENCY_SYMBOLS = { EUR: "€", GBP: "£", USD: "$" };
export function fmtCurrencyFull(n, currency) {
  const sym = CURRENCY_SYMBOLS[currency] ?? (currency + " ");
  const v = Number(n) || 0;
  return `${sym}${Math.abs(v).toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${v < 0 ? " CR" : ""}`;
}
