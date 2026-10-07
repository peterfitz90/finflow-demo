// POST /api/statements-pdf { company_id, year_end } -> a DRAFT FRS 105 statements PDF (STA-01 Stage 5a).
// Accountant-only (requireAccountant: the caller must be the accountant of company_id). The figures are
// computed here from the ledger, never taken from the browser, and every read uses a Supabase client
// carrying the caller's own token, so RLS applies exactly as it does on the statements page; nothing
// uses the service role. Nothing is stored: approval and the archive come in Stages 5b and 5c.
import { createClient } from '@supabase/supabase-js';
import { withSentry } from './_sentry.js';
import { requireAccountant, AuthError } from './_auth.js';
import { loadStatements } from './_statements-data.js';
import { renderStatementsPdf } from './_statements-pdf-doc.js';
import { todayStr } from '../src/shared/dates.js';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export default withSentry(async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { company_id, year_end } = req.body ?? {};
  if (!company_id || !ISO.test(year_end || '')) return res.status(400).json({ error: 'company_id and year_end (YYYY-MM-DD) required' });
  try {
    await requireAccountant(req, company_id);
  } catch (e) {
    if (e instanceof AuthError) return res.status(e.status).json({ error: e.message });
    throw e;
  }
  const url = process.env.SUPABASE_URL?.trim();
  const anonKey = process.env.SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return res.status(500).json({ error: 'Server not configured (SUPABASE_ANON_KEY)' });
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  // The caller's own token: RLS decides what is read, as on screen.
  const db = createClient(url, anonKey, { accessToken: async () => token, auth: { persistSession: false } });

  try {
    const { company, assembled } = await loadStatements(db, company_id, year_end, todayStr());
    const pdf = await renderStatementsPdf({ companyName: company.name, croNumber: company.cro_number, assembled, yearEnd: year_end, approved: false });
    const safe = company.name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safe}-FRS105-${year_end}-DRAFT.pdf"`);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(Buffer.from(pdf));
  } catch (e) {
    if (e.status === 404) return res.status(404).json({ error: e.message });
    throw e;
  }
});
