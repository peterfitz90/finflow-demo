import { useState, useEffect } from 'react';
import { supabase } from '../supabase.js';
import { computeDeadlines } from './computeDeadlines.js';

// Reconstruct vat_returns period_val from a VAT3 deadline date.
// computeDeadlines always uses the 19th as due day regardless of ROS e-filer status,
// so the due date is: month after period end, day 19.
function vatDeadlineToPeriodVal(dueDate, vatPeriod) {
  const dueYear = dueDate.getFullYear(), dueMonth = dueDate.getMonth();
  if (vatPeriod === 'monthly') {
    // period month = month before due month
    const periodMonth = dueMonth === 0 ? 11 : dueMonth - 1;
    const periodYear  = dueMonth === 0 ? dueYear - 1 : dueYear;
    return `m-${periodYear}-${periodMonth}`;
  }
  // bimonthly: due month is one after the pair's end month
  const endMonth = dueMonth === 0 ? 11 : dueMonth - 1;
  const endYear  = dueMonth === 0 ? dueYear - 1 : dueYear;
  const pair     = Math.floor(endMonth / 2);
  return `b-${endYear}-${pair}`;
}

export function useHealthy(companyId) {
  const [state, setState] = useState({ healthy: null, loading: true });

  useEffect(() => {
    if (!companyId) { setState({ healthy: null, loading: false }); return; }

    const today = new Date(); today.setHours(0,0,0,0);
    const todayStr = today.toISOString().slice(0, 10);
    const diff = d => Math.floor((d - today) / 86400000);

    Promise.all([
      // 1. Overdue AR: invoices past due date, unpaid
      supabase.from('invoices').select('id', { count: 'exact', head: true })
        .eq('company_id', companyId).lt('due_date', todayStr).neq('status', 'paid'),

      // 2. Needs-review AP bills
      supabase.from('ap_invoices').select('id', { count: 'exact', head: true })
        .eq('company_id', companyId).eq('status', 'needs_review'),

      // 3. Bank categorise queue: journal-type AI suggestions awaiting confirmation
      supabase.from('bank_matches').select('id', { count: 'exact', head: true })
        .eq('company_id', companyId).eq('status', 'suggested').eq('matched_type', 'journal'),

      // 4a. Company config for compliance deadline calc
      supabase.from('companies').select('vat_period,year_end_month,ard_month,ard_day')
        .eq('id', companyId).single(),

      // 4b. Filed VAT periods for the "not filed" cross-check
      supabase.from('vat_returns').select('period_val')
        .eq('company_id', companyId).eq('status', 'filed'),
    ]).then(([arRes, apRes, bankRes, coRes, vatRes]) => {
      const overdueAR     = arRes.count  ?? 0;
      const needsReviewAP = apRes.count  ?? 0;
      const bankQueue     = bankRes.count ?? 0;
      const company       = coRes.data;
      // Degrade gracefully if vat_returns table doesn't exist yet.
      // vatRes.error = table absent → skip compliance check rather than falsely blocking health.
      const vatTableOk = !vatRes.error;
      const filedVals  = new Set(vatTableOk ? (vatRes.data || []).map(r => r.period_val) : []);

      // 4. Compliance: any VAT3 deadline that is PAST and whose period is not filed.
      // Skipped entirely when the table is absent (degrades to "not overdue").
      let complianceOverdue = false;
      if (company && vatTableOk) {
        const vatPeriod = company.vat_period || 'bimonthly';
        complianceOverdue = computeDeadlines(company)
          .filter(d => d.type === 'VAT3' && diff(d.due) < 0)
          .some(d => !filedVals.has(vatDeadlineToPeriodVal(d.due, vatPeriod)));
      }

      setState({
        healthy: overdueAR === 0 && needsReviewAP === 0 && bankQueue === 0 && !complianceOverdue,
        loading: false,
      });
    }).catch(() => setState({ healthy: null, loading: false }));
  }, [companyId]);

  return state;
}
