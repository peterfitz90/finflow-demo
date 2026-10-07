// One fiscal-year helper for every screen (STA-01 Stage 4a follow-up). Pure: no React, no
// Supabase. Honours companies.fy_end_day (null = the month's last day) and recorded
// financial_periods (first / changed periods), through src/shared/statements/periods.js.
//
// For a company with fy_end_day null and no recorded periods every function here gives exactly
// what the old month-based formulas gave (tests/fiscalYear.test.mjs proves it for every month).
import { yearEndIn, regularPeriod } from './statements/periods.js';
import { addDaysStr, monthEnd } from './dates.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// company: a companies row (year_end_month, fy_end_day). periods: financial_periods rows
// ({ period_start, period_end }) for that company, or [].
export const fiscalConfig = (company, periods = []) => ({
  yeMonth: Number(company?.year_end_month) || 12,
  fyEndDay: company?.fy_end_day ?? null,
  periods: periods || [],
});

// The financial year (or recorded period) containing date 'YYYY-MM-DD': { start, end, recorded }.
export function fiscalYearContaining(date, { yeMonth = 12, fyEndDay = null, periods = [] } = {}) {
  const rec = periods.find(p => p.period_start <= date && date <= p.period_end);
  if (rec) return { start: rec.period_start, end: rec.period_end, recorded: true };
  const y = Number(date.slice(0, 4));
  let end = yearEndIn(y, yeMonth, fyEndDay);
  if (end < date) end = yearEndIn(y + 1, yeMonth, fyEndDay);
  let { start } = regularPeriod(end, yeMonth, fyEndDay);
  // A regular year never reaches back into a recorded period: it starts the day after it.
  for (const p of periods) if (p.period_end < date && p.period_end >= start) start = addDaysStr(p.period_end, 1);
  return { start, end, recorded: false };
}

// Year-to-date start for a month 'YYYY-MM': the start of the financial year containing that
// month's last day, or today when today is earlier (the current month). For a year ending
// mid-month (S&P, 8 October) the current October then stays in the year still running until
// the year end has passed. Month-end years give the same start either way.
export const ytdStartForMonth = (yyyymm, cfg, today = null) => {
  const [y, m] = yyyymm.split('-').map(Number);
  const end = monthEnd(y, m);
  return fiscalYearContaining(today && today < end ? today : end, cfg).start;
};

// CT1 is due on the 23rd day of the ninth month after the end of the accounting period
// (the rule the app already used). Returns a local-midnight Date, as the deadline lists expect.
export function ct1DueDate(periodEnd) {
  const [y, m] = periodEnd.split('-').map(Number);
  return new Date(y, m - 1 + 9, 23);
}

// Period ends falling in calendar years fromYear..toYear: the regular year ends no recorded
// period overrides, plus every recorded period end. Sorted ascending.
export function periodEndsInYears(fromYear, toYear, { yeMonth = 12, fyEndDay = null, periods = [] } = {}) {
  const ends = new Set();
  for (let y = fromYear; y <= toYear; y++) {
    const end = yearEndIn(y, yeMonth, fyEndDay);
    if (!periods.some(p => p.period_start <= end && end < p.period_end)) ends.add(end);
  }
  for (const p of periods) {
    const y = Number(p.period_end.slice(0, 4));
    if (y >= fromYear && y <= toYear) ends.add(p.period_end);
  }
  return [...ends].sort();
}

// CT1 deadlines for period ends in fromYear..toYear: [{ periodEnd, due, fy }], fy = the period
// end's calendar year (the "FY2025" label the screens use).
export const ct1Deadlines = (fromYear, toYear, cfg) =>
  periodEndsInYears(fromYear, toYear, cfg).map(periodEnd => ({ periodEnd, due: ct1DueDate(periodEnd), fy: Number(periodEnd.slice(0, 4)) }));

// "8 October", or the month alone ("December") when the year ends on the month's last day.
export const yearEndLabel = ({ yeMonth = 12, fyEndDay = null } = {}) =>
  (fyEndDay == null ? MONTHS[yeMonth - 1] : `${fyEndDay} ${MONTHS[yeMonth - 1]}`);
