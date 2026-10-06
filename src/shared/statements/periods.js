// Financial periods (STA-01 Stage 4a). Pure: no React, no Supabase.
//
// A company's regular year ends on day fy_end_day of year_end_month (null = the month's last day;
// a day past the month's end, e.g. 29 February in a non-leap year, is read as the month's last
// day). Each regular year runs from the day after the previous year end to the year end. Periods
// that are not the regular 12 months (a first period from incorporation, a shortened or extended
// period after a change of year end) are rows in financial_periods; they are listed first and
// replace any regular year they overlap.
import { monthEnd, addDaysStr } from '../dates.js';

const pad = n => String(n).padStart(2, '0');

// The year end in calendar year y.
export function yearEndIn(y, yeMonth, fyEndDay = null) {
  const last = monthEnd(y, yeMonth);
  if (fyEndDay == null) return last;
  const lastDay = Number(last.slice(8, 10));
  return `${y}-${pad(yeMonth)}-${pad(Math.min(fyEndDay, lastDay))}`;
}

// The regular year ending on yearEnd: { start, end }.
export function regularPeriod(yearEnd, yeMonth, fyEndDay = null) {
  const y = Number(yearEnd.slice(0, 4));
  return { start: addDaysStr(yearEndIn(y - 1, yeMonth, fyEndDay), 1), end: yearEnd };
}

const dayNo = d => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86400000;
export const periodDays = (start, end) => dayNo(end) - dayNo(start) + 1;
// Length in months, for pro-rating (s.280D(5)): whole months where the period is a run of whole
// months, otherwise days scaled to a 365-day year (a regular year is always 12).
export function periodMonths(start, end) {
  const next = addDaysStr(end, 1);
  if (start.slice(8) === next.slice(8)) return (+next.slice(0, 4) - +start.slice(0, 4)) * 12 + (+next.slice(5, 7) - +start.slice(5, 7));
  return Math.round(periodDays(start, end) * 12 / 365 * 100) / 100;
}

const fmt = d => new Date(d + 'T00:00:00').toLocaleDateString('en-IE', { day: 'numeric', month: 'long', year: 'numeric' });

// The periods the statements page offers, newest first: every financial_periods row, then the
// `count` most recent regular years ending on or before today that no row overlaps. today is
// 'YYYY-MM-DD'. With no rows and fy_end_day null this is exactly the old list (the last day of
// year_end_month in the three most recent years ended).
export function listPeriods({ yeMonth = 12, fyEndDay = null, periods = [], today, count = 3 }) {
  const rows = periods.map(p => ({ start: p.period_start, end: p.period_end, kind: p.kind, reason: p.reason || null, source: 'table' }));
  const overlaps = (s, e) => rows.some(r => r.start <= e && s <= r.end);
  // No regular years before a first period (the company did not exist) or a changed year end
  // (earlier years ended on the old day, which is not stored: record them as periods if needed).
  const firstStart = rows.filter(r => r.kind === 'first' || r.kind === 'changed').reduce((m, r) => (m === null || r.start < m ? r.start : m), null);
  const y0 = Number(today.slice(0, 4));
  const regular = [];
  for (let y = y0; y >= y0 - 50 && regular.length < count; y--) {
    const end = yearEndIn(y, yeMonth, fyEndDay);
    if (end > today) continue;
    const { start } = regularPeriod(end, yeMonth, fyEndDay);
    if (firstStart && end < firstStart) break;
    if (!overlaps(start, end)) regular.push({ start, end, kind: 'regular', reason: null, source: 'regular' });
  }
  return [...rows.sort((a, b) => (a.end < b.end ? 1 : -1)), ...regular].map(p => {
    const months = periodMonths(p.start, p.end);
    const note = p.source === 'table' ? ` (${p.kind === 'first' ? 'first period' : p.kind === 'changed' ? 'changed year end' : 'recorded period'}, ${fmt(p.start)} to ${fmt(p.end)})` : '';
    return { ...p, months, val: p.end, label: fmt(p.end) + note };
  });
}

// Is date a year end of this company: a regular year end or the end of a recorded period?
export function isYearEnd(date, { yeMonth = 12, fyEndDay = null, periods = [] }) {
  if (periods.some(p => p.period_end === date)) return true;
  return yearEndIn(Number(date.slice(0, 4)), yeMonth, fyEndDay) === date;
}
