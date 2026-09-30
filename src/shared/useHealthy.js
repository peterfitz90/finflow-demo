import { localDateStr } from './dates.js';
import { useState, useEffect } from 'react';
import { supabase } from '../supabase.js';
import { computeDeadlines, filedVatPeriodVals } from './computeDeadlines.js';
import { deadlineApplies } from './practicePortfolio.js';

export function useHealthy(companyId) {
  const [state, setState] = useState({ healthy: null, loading: true });

  useEffect(() => {
    if (!companyId) { setState({ healthy: null, loading: false }); return; }

    const today = new Date(); today.setHours(0,0,0,0);
    const todayStr = localDateStr(today);
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

      // 4a. Company config for compliance deadline calc — incl. the flags deadlineApplies needs
      // (VAT registration) and ros_efiler (computeDeadlines' due dates).
      supabase.from('companies').select('vat_period,year_end_month,ard_month,ard_day,vat_registered,paye_registered,company_type,ros_efiler')
        .eq('id', companyId).single(),

      // 4b. Filed VAT periods — via get_locked_periods, not vat_returns: that table's SELECT is
      // accountant-only, so for a business_owner a direct read is silently empty and every past
      // VAT3 would count as unfiled.
      supabase.rpc('get_locked_periods', { p_company_id: companyId }),
    ]).then(([arRes, apRes, bankRes, coRes, vatRes]) => {
      const overdueAR     = arRes.count  ?? 0;
      const needsReviewAP = apRes.count  ?? 0;
      const bankQueue     = bankRes.count ?? 0;
      const company       = coRes.data;
      // Degrade gracefully: if the filed-periods lookup fails, skip the compliance check rather
      // than falsely blocking health.
      const vatLookupOk = !vatRes.error;

      // 4. Compliance: any VAT3 deadline that is PAST and still applies — the company is VAT-
      // registered and that period isn't filed (deadlineApplies, the Practice Dashboard / mobile
      // rule). Due dates respect ROS e-filing (computeDeadlines → vatDueDay).
      let complianceOverdue = false;
      if (company && vatLookupOk) {
        const deadlines = computeDeadlines(company);
        const vatFiled  = filedVatPeriodVals(deadlines, vatRes.data || []);
        complianceOverdue = deadlines
          .filter(d => d.type === 'VAT3' && diff(d.due) < 0)
          .some(d => deadlineApplies(company, d, vatFiled));
      }

      setState({
        healthy: overdueAR === 0 && needsReviewAP === 0 && bankQueue === 0 && !complianceOverdue,
        loading: false,
      });
    }).catch(() => setState({ healthy: null, loading: false }));
  }, [companyId]);

  return state;
}
