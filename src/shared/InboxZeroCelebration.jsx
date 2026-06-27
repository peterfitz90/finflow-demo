/**
 * InboxZeroCelebration — shared delight component for web + mobile.
 *
 * Props:
 *   companyId    — Supabase company ID (passed to stats/streak hooks)
 *   justCleared  — true only when the queue transitioned >0 → 0 by user action
 *                  this render cycle. Controls whether confetti fires.
 *   theme        — 'dark' (mobile default) | 'light' (web)
 *
 * Behaviour:
 *   • justCleared=true  → animated check draw-in + confetti burst (once per mount)
 *   • justCleared=false → same calm state, no confetti (e.g. returning to empty queue)
 *   • prefers-reduced-motion → no confetti in either case
 *   • Stats and streak are fetched from real data via useApprovalStats + useStreak
 */
import { useEffect, useRef } from 'react';
import { useApprovalStats } from './useApprovalStats.js';
import { useStreak }        from './useStreak.js';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// SVG checkmark with CSS draw-in animation
function AnimatedCheck({ color, size = 56 }) {
  return (
    <>
      <style>{`
        @keyframes izc-circle { to { stroke-dashoffset: 0; } }
        @keyframes izc-tick   { to { stroke-dashoffset: 0; } }
      `}</style>
      <svg width={size} height={size} viewBox="0 0 56 56" fill="none" aria-hidden="true"
           style={{ display: 'block' }}>
        {/* faint ring */}
        <circle cx="28" cy="28" r="26" stroke={color} strokeWidth="2" opacity="0.18" />
        {/* animated ring */}
        <circle cx="28" cy="28" r="26" stroke={color} strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray="164" strokeDashoffset="164"
          style={{ animation: 'izc-circle 0.5s cubic-bezier(.4,0,.2,1) 0.05s forwards' }} />
        {/* animated tick */}
        <path d="M16 28.5l9 9 15-18" stroke={color} strokeWidth="2.5"
          strokeLinecap="round" strokeLinejoin="round"
          strokeDasharray="34" strokeDashoffset="34"
          style={{ animation: 'izc-tick 0.3s ease-out 0.48s forwards' }} />
      </svg>
    </>
  );
}

export function InboxZeroCelebration({ companyId, justCleared, theme = 'dark' }) {
  const fired  = useRef(false);
  const stats  = useApprovalStats(companyId);
  const streak = useStreak(companyId);
  const dark   = theme !== 'light';

  // Fire confetti once when justCleared=true, respecting reduced-motion
  useEffect(() => {
    if (!justCleared || fired.current || prefersReducedMotion()) return;
    fired.current = true;
    import('canvas-confetti').then(({ default: confetti }) => {
      confetti({
        particleCount: 70,
        spread: 58,
        origin: { y: 0.55 },
        colors: ['#34d399', '#26a9b3', '#1d8a93', '#6366f1', '#f59e0b'],
        gravity: 1.1,
        scalar: 0.88,
        ticks: 220,
        disableForReducedMotion: true,
      });
    }).catch(() => {});
  }, [justCleared]);

  // Theme tokens
  const t = dark ? {
    title:      '#e4eaf4',
    sub:        '#6d7f9c',
    cardBg:     '#111d30',
    cardBorder: '#192338',
    statVal:    '#26a9b3',
    statLbl:    '#6d7f9c',
    divider:    '#192338',
    streakBg:   'rgba(29,138,147,0.12)',
    streakBdr:  'rgba(38,169,179,0.28)',
    streakTxt:  '#26a9b3',
    check:      '#34d399',
    font:       "'Inter', system-ui, sans-serif",
    monoFont:   "'Source Code Pro', monospace",
    serifFont:  "'Playfair Display', serif",
  } : {
    title:      '#111827',
    sub:        '#6b7280',
    cardBg:     '#f8fafc',
    cardBorder: '#e2e8f0',
    statVal:    '#1d6b72',
    statLbl:    '#6b7280',
    divider:    '#e2e8f0',
    streakBg:   'rgba(29,107,114,0.07)',
    streakBdr:  'rgba(29,107,114,0.22)',
    streakTxt:  '#1d6b72',
    check:      '#059669',
    font:       "Inter, system-ui, sans-serif",
    monoFont:   "'Source Code Pro', monospace",
    serifFont:  "Georgia, 'Times New Roman', serif",
  };

  const pct        = stats.totalProcessed > 0 ? Math.round((stats.autoHandled / stats.totalProcessed) * 100) : null;
  const showStats  = !stats.loading && (stats.autoHandled > 0 || stats.youCleared > 0);
  const showStreak = streak > 1;

  return (
    <div style={{
      display:        'flex',
      flexDirection:  'column',
      alignItems:     'center',
      gap:            18,
      padding:        '52px 24px',
      textAlign:      'center',
    }}>
      {/* Animated check */}
      <AnimatedCheck color={t.check} size={56} />

      {/* Heading */}
      <div style={{ fontFamily: t.serifFont, fontSize: 22, fontWeight: 700, color: t.title, letterSpacing: '-0.01em' }}>
        You're all caught up
      </div>
      <div style={{ fontSize: 13, color: t.sub, lineHeight: 1.65, maxWidth: 268, fontFamily: t.font }}>
        Nothing needs your approval — the loop's running itself.
      </div>

      {/* Stats card */}
      {showStats && (
        <div style={{
          background:   t.cardBg,
          border:       `1px solid ${t.cardBorder}`,
          borderRadius: 14,
          padding:      '16px 28px',
          display:      'flex',
          alignItems:   'center',
          gap:          28,
          marginTop:    4,
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: t.serifFont, fontSize: 30, fontWeight: 700, lineHeight: 1, color: t.statVal }}>
              {pct !== null ? `${pct}%` : stats.autoHandled}
            </div>
            <div style={{ fontSize: 9, fontFamily: t.monoFont, textTransform: 'uppercase', letterSpacing: '0.08em', color: t.statLbl, marginTop: 5, lineHeight: 1.45 }}>
              % automated<br/>this week
            </div>
          </div>

          <div style={{ width: 1, alignSelf: 'stretch', background: t.divider }} />

          <div style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: t.serifFont, fontSize: 30, fontWeight: 700, lineHeight: 1, color: t.statVal }}>
              {stats.youCleared}
            </div>
            <div style={{ fontSize: 9, fontFamily: t.monoFont, textTransform: 'uppercase', letterSpacing: '0.08em', color: t.statLbl, marginTop: 5, lineHeight: 1.45 }}>
              You cleared<br/>this week
            </div>
          </div>
        </div>
      )}

      {/* Streak chip */}
      {showStreak && (
        <div style={{
          background:   t.streakBg,
          border:       `1px solid ${t.streakBdr}`,
          borderRadius: 20,
          padding:      '5px 15px',
          fontSize:     12,
          fontWeight:   600,
          color:        t.streakTxt,
          fontFamily:   t.monoFont,
          letterSpacing:'0.04em',
        }}>
          ⚡ {streak}-day streak
        </div>
      )}
    </div>
  );
}
