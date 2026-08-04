"use client";
/**
 * BELL SCHEDULES pack — 5 widgets that show full period schedule + highlight current period when live.
 * BELL_NEON_PIT, BELL_PAPER_PROGRAM, BELL_CRAYON_DAYPLAN, BELL_GLASS_TIMETABLE, BELL_OPS_DISPATCH
 */
import { useEffect, useMemo, useState } from 'react';
import { resolveStyle, frameStyle } from './_shared/styleSystem';
import type { WidgetStyle } from './_shared/styleSystem';
import type { WidgetProps } from './_shared/types';
// 2026-05-03 — single source of truth for time parsing/formatting.
// Every bell schedule renderer (v2 + legacy + theme variants) now reads
// from this shared module so a 24-hour input never escapes to the canvas.
import { formatTime12, parseTimeToMinutes } from '@/lib/format-time';

interface Period { num?: string | number; label?: string; room?: string; startTime?: string; endTime?: string; }
interface BellCfg { style?: WidgetStyle; title?: string; subtitle?: string; periods?: Period[]; clockTimeZone?: string; }

const FALLBACK: Period[] = [
  { num: 1, label: 'Homeroom',  room: 'Rm 101',     startTime: '8:15',  endTime: '9:00'  },
  { num: 2, label: 'Math',      room: 'Rm 118',     startTime: '9:05',  endTime: '9:55'  },
  { num: 3, label: 'English',   room: 'Rm 205',     startTime: '10:00', endTime: '10:50' },
  { num: 4, label: 'Science',   room: 'Rm 214',     startTime: '11:15', endTime: '12:00' },
  { num: 5, label: 'Lunch B',   room: 'Cafeteria',  startTime: '12:05', endTime: '12:45' },
  { num: 6, label: 'History',   room: 'Rm 312',     startTime: '12:50', endTime: '1:40'  },
  { num: 7, label: 'Gym / PE',  room: 'Gym',        startTime: '1:45',  endTime: '2:35'  },
  { num: 8, label: 'Art',       room: 'Studio',     startTime: '2:40',  endTime: '3:25'  },
];
// 2026-05-03 — parseHM kept as a thin alias for the schedule "current
// period" lookup. Delegates to the shared parser so 24-hour input still
// resolves to a real minute count (used for highlighting `now`).
const parseHM = parseTimeToMinutes;
function useNowMin(tz?: string, live?: boolean) {
  const [m, setM] = useState<number>(() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); });
  useEffect(() => { if (!live) return; const upd = () => { const fmt = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, ...(tz ? { timeZone: tz } : {}) }); const parts = fmt.formatToParts(new Date()); const h = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10); const mm = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10); setM(h * 60 + mm); }; upd(); const id = setInterval(upd, 30_000); return () => clearInterval(id); }, [tz, live]);
  return m;
}
function findCurrent(periods: Period[], nowMin: number): number {
  if (!Array.isArray(periods)) return -1;
  for (let i = 0; i < periods.length; i++) {
    const p = periods[i];
    if (!p || typeof p !== 'object') continue;
    const s = parseHM(p.startTime);
    const e = parseHM(p.endTime);
    if (s != null && e != null && nowMin >= s && nowMin < e) return i;
  }
  return -1;
}
// 2026-05-03 — Operator: "When I select the 1st bell schedule in the
// widget list and change anything the entire webpage crashes." Likely
// trigger: c.periods stored as a non-array (legacy string from the
// pre-mirror days, or null after a partial save). `c.periods?.length`
// returns truthy for strings (string length), then `periods.map(...)`
// in the render path crashes with "periods.map is not a function".
// Coerce to a real array here so every renderer below sees a safe value.
function safePeriods(value: unknown): Period[] {
  if (Array.isArray(value)) {
    return value
      .filter((p) => p && typeof p === 'object')
      .map((p: any) => ({
        num: p.num,
        label: typeof p.label === 'string' ? p.label : undefined,
        room: typeof p.room === 'string' ? p.room : undefined,
        startTime: typeof p.startTime === 'string' ? p.startTime : (typeof p.start === 'string' ? p.start : undefined),
        endTime: typeof p.endTime === 'string' ? p.endTime : (typeof p.end === 'string' ? p.end : undefined),
      }));
  }
  return [];
}

// 1. NEON PIT — racing/scoreboard vibe
export function BellNeonPitWidget({ config, live }: WidgetProps<BellCfg>) {
  const c = config || {}; const safe = safePeriods(c.periods); const periods = safe.length ? safe : FALLBACK; const nowMin = useNowMin(c.clockTimeZone, live);
  const cur = useMemo(() => findCurrent(periods, nowMin), [periods, nowMin]);
  const r = resolveStyle({ fontFamily: "'Audiowide', sans-serif", fontSize: 18, textColor: '#fff', bgColor: '#0a0014', padding: 24, borderRadius: 12, accentColor: '#ff2bd6', accentColor2: '#00f0ff', highlightColor: '#ffd60a', ...(c.style || {}) });
  return (
    <div style={frameStyle(r)}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderBottom: `1px solid ${r.accent.primary}`, paddingBottom: 6, marginBottom: 10 }}>
        <span style={{ color: r.accent.primary, fontSize: '1.2em', textShadow: `0 0 12px ${r.accent.primary}`, letterSpacing: '0.15em' }}>● <span data-field="title">{c.title || 'BELL SCHEDULE'}</span></span>
        <span style={{ color: r.accent.highlight, fontSize: '0.75em', letterSpacing: '0.25em', textShadow: `0 0 8px ${r.accent.highlight}` }} data-field="subtitle">{c.subtitle || 'REGULAR'}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontFamily: "'JetBrains Mono', monospace" }}>
        {periods.map((p, i) => {
          const active = i === cur; return (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '48px 1fr 1fr 110px', alignItems: 'center', gap: 8, padding: '4px 8px', background: active ? `${r.accent.primary}22` : 'transparent', border: active ? `1px solid ${r.accent.primary}` : `1px solid transparent`, borderRadius: 4, color: active ? r.accent.primary : '#cbd5e1', textShadow: active ? `0 0 10px ${r.accent.primary}` : 'none' }}>
              <b style={{ color: active ? r.accent.primary : r.accent.secondary, fontSize: '1.1em' }}>P{p.num}</b>
              <span style={{ fontFamily: r.font.family, fontSize: r.font.size, letterSpacing: '0.05em' }}>{p.label}</span>
              <span style={{ fontSize: '0.85em', opacity: 0.85 }}>{p.room}</span>
              <span style={{ color: r.accent.highlight, fontSize: '0.9em' }}>{formatTime12(p.startTime)}–{formatTime12(p.endTime)}{active && ' ◀'}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// 2. PAPER PROGRAM — playbill
export function BellPaperProgramWidget({ config, live }: WidgetProps<BellCfg>) {
  const c = config || {}; const safe = safePeriods(c.periods); const periods = safe.length ? safe : FALLBACK; const nowMin = useNowMin(c.clockTimeZone, live);
  const cur = useMemo(() => findCurrent(periods, nowMin), [periods, nowMin]);
  const r = resolveStyle({ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 18, textColor: '#0a0a0a', bgColor: '#f5f1e8', padding: 28, accentColor: '#7c1d1d', ...(c.style || {}) });
  return (
    <div style={frameStyle(r)}>
      <div style={{ textAlign: 'center', borderBottom: '4px double #0a0a0a', paddingBottom: 8, marginBottom: 12 }}>
        <div style={{ fontSize: '0.7em', letterSpacing: '0.4em', color: r.accent.primary, fontWeight: 700, textTransform: 'uppercase' }}>· The Daily Programme ·</div>
        <h2 style={{ margin: '4px 0', fontSize: '2em', fontWeight: 900 }} data-field="title">{c.title || 'Bell Schedule'}</h2>
        <div style={{ fontStyle: 'italic', fontSize: '0.95em' }} data-field="subtitle">{c.subtitle || 'Regular Day'}</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {periods.map((p, i) => {
          const active = i === cur;
          return (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '40px 1fr auto', columnGap: 12, alignItems: 'baseline', borderBottom: '1px dotted #94a3b8', padding: '4px 0', background: active ? '#fef3c7' : undefined, paddingLeft: active ? 6 : 0 }}>
              <b style={{ color: r.accent.primary, fontSize: '1.05em' }}>{p.num}.</b>
              <span><i style={{ fontSize: r.font.size, fontWeight: 600 }}>{p.label}</i><span style={{ color: '#7c7c7c', fontSize: '0.85em', marginLeft: 8 }}>· {p.room}</span></span>
              <span style={{ fontFamily: 'monospace', fontSize: '0.95em' }}>{formatTime12(p.startTime)}–{formatTime12(p.endTime)} {active && '◆'}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// 3. CRAYON DAYPLAN — elementary
export function BellCrayonDayplanWidget({ config, live }: WidgetProps<BellCfg>) {
  const c = config || {}; const safe = safePeriods(c.periods); const periods = safe.length ? safe : FALLBACK.slice(0, 6); const nowMin = useNowMin(c.clockTimeZone, live);
  const cur = useMemo(() => findCurrent(periods, nowMin), [periods, nowMin]);
  const r = resolveStyle({ fontFamily: "'Fredoka', sans-serif", fontSize: 18, textColor: '#1c1917', bgColor: '#fff8e7', padding: 24, borderRadius: 32, accentColor: '#ff6b9d', accentColor2: '#4ecdc4', highlightColor: '#ffd93d', ...(c.style || {}) });
  const colors = [r.accent.primary, r.accent.secondary, r.accent.highlight, '#a78bfa', '#34d399', '#fb923c', '#60a5fa', '#f472b6'];
  return (
    <div style={frameStyle(r)}>
      <h2 style={{ margin: 0, fontSize: '1.7em', fontWeight: 800, textAlign: 'center' }}>📅 <span data-field="title">{c.title || 'Our Day!'}</span></h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
        {periods.map((p, i) => {
          const active = i === cur;
          const color = colors[i % colors.length];
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#fff', padding: '8px 14px', borderRadius: 999, border: active ? `4px dashed ${color}` : `2px solid ${color}`, transform: active ? 'scale(1.02)' : 'none', boxShadow: '0 4px 0 rgba(0,0,0,0.1)' }}>
              <div style={{ background: color, color: '#fff', width: 36, height: 36, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1em', fontWeight: 800 }}>{p.num}</div>
              <div style={{ flex: 1 }}><div style={{ fontWeight: 800, fontSize: r.font.size }}>{p.label} {active && '⭐'}</div><div style={{ fontSize: '0.75em', color: '#7c7c7c' }}>{p.room}</div></div>
              <div style={{ fontWeight: 700, color, fontSize: '0.95em' }}>{formatTime12(p.startTime)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// 4. GLASS TIMETABLE
export function BellGlassTimetableWidget({ config, live }: WidgetProps<BellCfg>) {
  const c = config || {}; const safe = safePeriods(c.periods); const periods = safe.length ? safe : FALLBACK; const nowMin = useNowMin(c.clockTimeZone, live);
  const cur = useMemo(() => findCurrent(periods, nowMin), [periods, nowMin]);
  const r = resolveStyle({ fontFamily: "'Inter', sans-serif", fontSize: 16, textColor: '#0f172a', bgColor: 'rgba(255,255,255,0.75)', bgGradient: 'linear-gradient(135deg, rgba(99,102,241,0.06), rgba(168,85,247,0.06))', padding: 28, borderRadius: 24, accentColor: '#6366f1', ...(c.style || {}) });
  return (
    <div style={{ ...frameStyle(r), backdropFilter: 'blur(20px)' }}>
      <div style={{ marginBottom: 12 }}>
        {c.subtitle && <div style={{ fontSize: '0.75em', fontWeight: 600, letterSpacing: '0.2em', color: r.accent.primary, textTransform: 'uppercase' }} data-field="subtitle">{c.subtitle}</div>}
        <h2 style={{ margin: '2px 0 0', fontSize: '1.7em', fontWeight: 600, letterSpacing: '-0.02em' }} data-field="title">{c.title || 'Today'}</h2>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {periods.map((p, i) => {
          const active = i === cur;
          return (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '36px 1fr auto', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 12, background: active ? `${r.accent.primary}1a` : 'rgba(255,255,255,0.4)', border: active ? `1px solid ${r.accent.primary}55` : '1px solid rgba(0,0,0,0.04)' }}>
              <span style={{ width: 28, height: 28, borderRadius: '50%', background: active ? r.accent.primary : '#e2e8f0', color: active ? '#fff' : '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.85em', fontWeight: 700 }}>{p.num}</span>
              <div><div style={{ fontWeight: 600, fontSize: r.font.size }}>{p.label}</div><div style={{ fontSize: '0.75em', color: '#64748b' }}>{p.room}</div></div>
              <div style={{ fontFamily: 'monospace', fontSize: '0.85em', color: active ? r.accent.primary : '#64748b', fontWeight: active ? 700 : 500 }}>{formatTime12(p.startTime)}–{formatTime12(p.endTime)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// 5. OPS DISPATCH
export function BellOpsDispatchWidget({ config, live }: WidgetProps<BellCfg>) {
  const c = config || {}; const safe = safePeriods(c.periods); const periods = safe.length ? safe : FALLBACK; const nowMin = useNowMin(c.clockTimeZone, live);
  const cur = useMemo(() => findCurrent(periods, nowMin), [periods, nowMin]);
  const r = resolveStyle({ fontFamily: "'JetBrains Mono', monospace", fontSize: 14, textColor: '#cbd5e1', bgColor: '#0a0e14', padding: 20, borderRadius: 8, borderWidth: 1, borderColor: '#1e293b', accentColor: '#22d3ee', accentColor2: '#fbbf24', highlightColor: '#22c55e', ...(c.style || {}) });
  return (
    <div style={frameStyle(r)}>
      <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: `1px dashed ${r.accent.primary}55`, paddingBottom: 4, marginBottom: 6, fontSize: '1em' }}><b style={{ color: r.accent.primary, letterSpacing: '0.2em' }}>● BELL.DISPATCH</b><span style={{ color: r.accent.secondary }} data-field="subtitle">{c.subtitle || 'REGULAR'}</span></div>
      <div style={{ display: 'grid', gridTemplateColumns: '32px 80px 1fr 90px', columnGap: 8, rowGap: 2, fontSize: r.font.size }}>
        <b style={{ color: r.accent.primary }}>#</b><b style={{ color: r.accent.primary }}>TIME</b><b style={{ color: r.accent.primary }}>BLOCK</b><b style={{ color: r.accent.primary }}>STATE</b>
        {periods.map((p, i) => {
          const active = i === cur; const past = cur !== -1 && i < cur;
          return (
            <>
              <span key={`n${i}`} style={{ color: r.accent.secondary }}>{p.num}</span>
              <span key={`t${i}`} style={{ color: r.accent.highlight }}>{formatTime12(p.startTime)}</span>
              <span key={`l${i}`} style={{ color: active ? r.accent.primary : r.font.color, fontWeight: active ? 700 : 400, textShadow: active ? `0 0 8px ${r.accent.primary}` : 'none' }}>{p.label} <span style={{ opacity: 0.5 }}>· {p.room}</span></span>
              <span key={`s${i}`} style={{ color: active ? r.accent.highlight : past ? '#475569' : r.accent.secondary }}>{active ? '▶ LIVE' : past ? 'DONE' : 'QUEUED'}</span>
            </>
          );
        })}
      </div>
    </div>
  );
}
