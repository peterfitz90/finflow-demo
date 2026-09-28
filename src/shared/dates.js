// Date → 'YYYY-MM-DD' helpers that never shift a day.
//
// The bug these replace: `new Date(y, m, d).toISOString().slice(0, 10)`. The Date is LOCAL
// midnight; toISOString() renders it in UTC, so anywhere east of UTC — Ireland during summer
// time (UTC+1) — local midnight is 23:00 UTC the previous day and the string comes out one day
// early. It only bit for dates inside IST (roughly Mar 31 – Oct 30), which is why VAT periods,
// month-ends and depreciation dates were wrong in summer and fine in winter.

const pad = n => String(n).padStart(2, '0');

// A Date's own LOCAL calendar date — for Dates that genuinely represent a local day (e.g.
// "today", or a Date built with new Date(y, m, d)). Reads local fields, so no UTC conversion.
export const localDateStr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Built purely in UTC arithmetic and read back from UTC fields, so the result is identical in
// every timezone and across DST changes. `m` is a 1-based calendar month (1 = Jan) and may
// overflow in either direction like the Date constructor: monthEnd(2026, 0) = '2025-12-31',
// monthStart(2026, 13) = '2027-01-01'.
const utcStr = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
export const monthEnd   = (y, m) => utcStr(new Date(Date.UTC(y, m, 0)));     // last day of month m
export const monthStart = (y, m) => utcStr(new Date(Date.UTC(y, m - 1, 1))); // 1st of month m
