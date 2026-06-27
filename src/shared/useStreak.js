/**
 * useStreak(companyId) — consecutive days with at least one confirmed
 * bank_match, measured backwards from the most recent active day.
 *
 * This is a "days active in the queue" streak — computable entirely from
 * bank_matches.confirmed_at with no additional schema. AP bill approvals
 * are not yet included (no approved_at column); they can be added later.
 */
import { useState, useEffect } from 'react';
import { supabase } from '../supabase.js';

export function useStreak(companyId) {
  const [streak, setStreak] = useState(0);

  useEffect(() => {
    if (!companyId) return;
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    supabase.from('bank_matches')
      .select('confirmed_at')
      .eq('company_id', companyId)
      .eq('status', 'confirmed')
      .gte('confirmed_at', since)
      .then(({ data }) => {
        if (!data?.length) { setStreak(0); return; }

        // Distinct ISO date strings with activity, sorted newest-first
        const days = [...new Set(data.map(r => r.confirmed_at?.slice(0, 10)))]
          .filter(Boolean)
          .sort()
          .reverse();

        if (!days.length) { setStreak(0); return; }

        // Count consecutive days starting from the most recent active day
        let count = 1;
        for (let i = 1; i < days.length; i++) {
          const gap = Math.round(
            (new Date(days[i - 1]) - new Date(days[i])) / 86_400_000
          );
          if (gap === 1) count++;
          else break;
        }
        setStreak(count);
      })
      .catch(() => setStreak(0));
  }, [companyId]);

  return streak;
}
