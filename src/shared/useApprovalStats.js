/**
 * useApprovalStats(companyId) — real approval counts for the last 7 days.
 *
 * autoHandled: transactions that required no human correction:
 *   - matched_by = 'auto' AND suggestion_kept IS NULL  → engine auto-confirmed (no human step)
 *   - matched_by = 'auto' AND suggestion_kept = true   → AI suggested, human kept as-is
 *   Excluded: suggestion_kept = false (human corrected) and matched_by = 'user' (manual).
 *
 *   This is the same signal as the "AUTO" badge in the Reconciliation UI
 *   (which reads matched_by === 'auto'), extended to also count future kept-suggestion rows.
 *   Matches the definition in compute_automation_rollup() exactly.
 *
 * totalProcessed: all bank lines posted (reconciled) in the window — denominator for
 *   % automated = autoHandled / totalProcessed.
 *
 * youCleared: items explicitly approved out of needs_review this week:
 *   bank_matches confirmed + ap_invoices approved_at.
 */
import { useState, useEffect } from 'react';
import { supabase } from '../supabase.js';

export function useApprovalStats(companyId, days = 7) {
  const [stats, setStats] = useState({ autoHandled: 0, totalProcessed: 0, youCleared: 0, loading: true });

  useEffect(() => {
    if (!companyId) return;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    Promise.all([
      // autoHandled: engine auto-confirmed (suggestion_kept IS NULL) OR AI-suggested kept (= true).
      // Excludes human-corrected (= false) and all manual rows (matched_by = 'user').
      // Must stay in sync with compute_automation_rollup() in add_public_stats.sql.
      supabase.from('bank_matches')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .eq('status', 'confirmed')
        .eq('matched_by', 'auto')
        .or('suggestion_kept.is.null,suggestion_kept.eq.true')
        .gte('confirmed_at', since),

      // totalProcessed: all posted bank lines in the window (denominator for % automated)
      supabase.from('bank_transactions')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .eq('reconciled', true)
        .gte('reconciled_at', since),

      // youCleared (bank): confirmed journal-category suggestions
      supabase.from('bank_matches')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .eq('status', 'confirmed')
        .gte('confirmed_at', since),

      // youCleared (AP bills): bills approved from needs_review this week
      supabase.from('ap_invoices')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .eq('status', 'pending')
        .gte('approved_at', since),
    ]).then(([autoRes, totalRes, matchRes, apRes]) => {
      setStats({
        autoHandled:    autoRes.count  ?? 0,
        totalProcessed: totalRes.count ?? 0,
        youCleared:     (matchRes.count ?? 0) + (apRes.count ?? 0),
        loading:        false,
      });
    }).catch(() => {
      setStats({ autoHandled: 0, totalProcessed: 0, youCleared: 0, loading: false });
    });
  }, [companyId, days]);

  return stats;
}
