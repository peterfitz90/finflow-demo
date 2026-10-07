// A company's recorded financial periods (financial_periods; readable by any member of the
// company), for src/shared/fiscalYear.js. [] until loaded, and on error (the regular year then
// applies, which is right for every company with no recorded periods).
import { useState, useEffect } from 'react';
import { supabase } from '../supabase.js';

export function fetchFinancialPeriods(db, companyIds) {
  return db.from('financial_periods').select('company_id, period_start, period_end, kind, reason')
    .in('company_id', companyIds).order('period_end', { ascending: false });
}

export function useFinancialPeriods(companyId) {
  const [periods, setPeriods] = useState([]);
  useEffect(() => {
    setPeriods([]);
    if (!companyId) return;
    let live = true;
    fetchFinancialPeriods(supabase, [companyId]).then(({ data, error }) => {
      if (error) console.warn('[useFinancialPeriods] load failed:', error.message);
      if (live) setPeriods(data || []);
    });
    return () => { live = false; };
  }, [companyId]);
  return periods;
}
