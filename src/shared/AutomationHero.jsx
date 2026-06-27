import { useApprovalStats } from './useApprovalStats.js';
import { useStreak }        from './useStreak.js';

const PULSE_CSS = `
@keyframes health-pulse {
  0%   { box-shadow: 0 0 0 0 currentColor; }
  70%  { box-shadow: 0 0 0 5px transparent; }
  100% { box-shadow: 0 0 0 0 transparent; }
}
@media (prefers-reduced-motion: reduce) {
  .health-pulse-dot { animation: none !important; }
}
`;

export function HealthPulseDot({ healthy, size = 8 }) {
  if (healthy === null || healthy === undefined) return null;
  const color = healthy ? '#34d399' : '#f87171';
  // Pulse only when healthy — a pulsing red reads as an active alarm.
  // prefers-reduced-motion disables animation in either state via the CSS rule.
  return (
    <>
      <style>{PULSE_CSS}</style>
      <span
        className={healthy ? 'health-pulse-dot' : undefined}
        aria-label={healthy ? 'Books healthy' : 'Needs attention'}
        style={{
          display:      'inline-block',
          width:        size,
          height:       size,
          borderRadius: '50%',
          background:   color,
          color,
          flexShrink:   0,
          verticalAlign:'middle',
          animation:    healthy ? 'health-pulse 2s ease-in-out infinite' : 'none',
        }}
      />
    </>
  );
}

export function AutomationHero({ companyId, theme = 'dark' }) {
  const stats30 = useApprovalStats(companyId, 30);
  const stats7  = useApprovalStats(companyId);
  const streak  = useStreak(companyId);

  const dark = theme !== 'light';

  const wrap = dark
    ? { background: '#111d30', border: '1px solid #192338', borderRadius: 14, padding: '18px 20px', marginBottom: 12 }
    : { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-card)', padding: '14px 18px', marginBottom: 12 };

  const heroColor   = dark ? '#26a9b3' : '#1d6b72';
  const labelColor  = dark ? '#6d7f9c' : 'var(--text-muted)';
  const tallyColor  = dark ? '#6d7f9c' : 'var(--text-muted)';
  const streakBg    = dark ? 'rgba(29,138,147,0.12)' : 'rgba(29,107,114,0.07)';
  const streakBdr   = dark ? 'rgba(38,169,179,0.28)' : 'rgba(29,107,114,0.22)';
  const streakTxt   = dark ? '#26a9b3' : '#1d6b72';
  const heroFont    = dark ? "'Playfair Display', serif" : "'Playfair Display', Georgia, serif";
  const monoFont    = dark ? "'Source Code Pro', monospace" : "'Source Code Pro', monospace";

  const pct30 = stats30.totalProcessed > 0
    ? Math.round((stats30.autoHandled / stats30.totalProcessed) * 100)
    : null;

  if (stats30.loading) return null;

  return (
    <div style={wrap}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16 }}>
        <div>
          <div style={{ fontFamily: heroFont, fontSize: dark ? 40 : 34, fontWeight: 700, color: heroColor, lineHeight: 1 }}>
            {pct30 !== null ? `${pct30}%` : '—'}
          </div>
          <div style={{ fontSize: 9, fontFamily: monoFont, textTransform: 'uppercase', letterSpacing: '0.1em', color: labelColor, marginTop: 4 }}>
            automated · last 30 days
          </div>
        </div>
        {streak > 1 && (
          <div style={{ marginBottom: 3, background: streakBg, border: `1px solid ${streakBdr}`, borderRadius: 20, padding: '4px 12px', fontSize: 11, fontWeight: 600, color: streakTxt, fontFamily: monoFont, letterSpacing: '0.04em' }}>
            ⚡ {streak}d streak
          </div>
        )}
      </div>
      {!stats7.loading && (stats7.youCleared > 0 || stats7.autoHandled > 0) && (
        <div style={{ fontSize: 12, color: tallyColor, marginTop: 10 }}>
          <span style={{ color: heroColor, fontWeight: 600 }}>{stats7.youCleared}</span> cleared ·{' '}
          <span style={{ color: heroColor, fontWeight: 600 }}>{stats7.autoHandled}</span> auto this week
        </div>
      )}
    </div>
  );
}
