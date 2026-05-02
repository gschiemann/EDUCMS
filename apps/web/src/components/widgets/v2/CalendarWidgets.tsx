"use client";
/**
 * CALENDARS pack — 5 widgets.
 *  CAL_NEON_GRID, CAL_PAPER_AGENDA, CAL_CRAYON_DAYS, CAL_GLASS_TIMELINE, CAL_OPS_QUEUE
 */
import { resolveStyle, frameStyle, animDurationSec } from './_shared/styleSystem';
import type { WidgetStyle } from './_shared/styleSystem';
import type { WidgetProps } from './_shared/types';

interface CalEvent { date?: string; time?: string; title?: string; location?: string; tag?: string; }
interface CalCfg { style?: WidgetStyle; title?: string; events?: CalEvent[]; feedUrl?: string; }

const SAMPLE_EVENTS: CalEvent[] = [
  { date: 'TUE 04', time: '7:00 PM', title: 'Spring Concert', location: 'Auditorium', tag: 'ARTS' },
  { date: 'WED 05', time: '3:30 PM', title: 'Robotics Meet', location: 'STEM Lab', tag: 'CLUB' },
  { date: 'FRI 07', time: 'ALL DAY', title: 'Field Day', location: 'Athletic Field', tag: 'EVENT' },
  { date: 'MON 10', time: '6:30 PM', title: 'PTA Meeting', location: 'Library', tag: 'PARENT' },
  { date: 'WED 12', time: '8:00 AM', title: 'State Testing', location: 'Homerooms', tag: 'EXAM' },
];

// 1. NEON GRID — high school
export function CalendarNeonGridWidget({ config }: WidgetProps<CalCfg>) {
  const c = config || {}; const evs = c.events?.length ? c.events : SAMPLE_EVENTS;
  const r = resolveStyle({ fontFamily: "'Audiowide', sans-serif", fontSize: 28, textColor: '#fff', bgColor: '#0a0014', bgGradient: 'radial-gradient(ellipse at top, #1a0033, #0a0014)', padding: 32, borderRadius: 16, accentColor: '#ff2bd6', accentColor2: '#00f0ff', ...(c.style || {}) });
  return (
    <div style={frameStyle(r)}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 16 }}>
        <h2 style={{ margin: 0, fontSize: '1.6em', color: r.accent.primary, textShadow: `0 0 16px ${r.accent.primary}`, letterSpacing: '0.2em' }}>{c.title || 'UPCOMING'}</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 12, fontSize: r.font.size }}>
          {evs.slice(0, 6).map((e, i) => (
            <div key={i} style={{ display: 'contents' }}>
              <div style={{ background: r.accent.primary, color: '#000', padding: '6px 14px', borderRadius: 6, fontWeight: 700, letterSpacing: '0.1em', boxShadow: `0 0 12px ${r.accent.primary}88` }}>{e.date}</div>
              <div style={{ color: '#fff', fontWeight: 600 }}>{e.title} <span style={{ color: r.accent.secondary, fontSize: '0.7em', marginLeft: 8 }}>· {e.location}</span></div>
              <div style={{ color: r.accent.secondary, fontWeight: 500, textShadow: `0 0 8px ${r.accent.secondary}` }}>{e.time}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// 2. PAPER AGENDA — middle school
export function CalendarPaperAgendaWidget({ config }: WidgetProps<CalCfg>) {
  const c = config || {}; const evs = c.events?.length ? c.events : SAMPLE_EVENTS;
  const r = resolveStyle({ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 24, textColor: '#0a0a0a', bgColor: '#f5f1e8', padding: 40, accentColor: '#7c1d1d', ...(c.style || {}) });
  return (
    <div style={frameStyle(r)}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <h2 style={{ margin: '0 0 16px 0', fontSize: '2.2em', textAlign: 'center', borderBottom: '4px double #0a0a0a', paddingBottom: 12, fontStyle: 'italic' }}>{c.title || 'Calendar of Events'}</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {evs.slice(0, 6).map((e, i) => (
            <div key={i} style={{ display: 'flex', gap: 16, paddingBottom: 8, borderBottom: '1px dashed #94a3b8', alignItems: 'baseline' }}>
              <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: r.font.size, minWidth: 80, color: r.accent.primary }}>{e.date}</span>
              <span style={{ flex: 1, fontWeight: 600, fontSize: '1.1em' }}>{e.title}</span>
              <span style={{ fontStyle: 'italic', color: '#525252', fontSize: '0.9em' }}>{e.time} · {e.location}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// 3. CRAYON DAYS — elementary
export function CalendarCrayonDaysWidget({ config }: WidgetProps<CalCfg>) {
  const c = config || {}; const evs = c.events?.length ? c.events : SAMPLE_EVENTS;
  const r = resolveStyle({ fontFamily: "'Fredoka', sans-serif", fontSize: 24, textColor: '#1c1917', bgColor: '#fff8e7', padding: 32, borderRadius: 32, accentColor: '#ff6b9d', accentColor2: '#4ecdc4', highlightColor: '#ffd93d', ...(c.style || {}) });
  const colors = [r.accent.primary, r.accent.secondary, r.accent.highlight, '#a78bfa', '#fb923c', '#22d3ee'];
  return (
    <div style={frameStyle(r)}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 14 }}>
        <h2 style={{ margin: 0, fontSize: '1.8em', fontWeight: 800, textAlign: 'center' }}>📅 {c.title || "What's Coming Up!"}</h2>
        <div style={{ display: 'grid', gap: 10 }}>
          {evs.slice(0, 5).map((e, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14, background: '#fff', padding: 12, borderRadius: 16, boxShadow: '0 4px 0 rgba(0,0,0,0.08)' }}>
              <div style={{ width: 64, height: 64, background: colors[i % colors.length], color: '#fff', borderRadius: 12, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', fontWeight: 800, transform: `rotate(${i % 2 ? -3 : 3}deg)`, boxShadow: '0 4px 0 rgba(0,0,0,0.15)' }}>
                <span style={{ fontSize: '0.6em' }}>{e.date?.split(' ')[0]}</span>
                <span style={{ fontSize: '1.2em' }}>{e.date?.split(' ')[1]}</span>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 800, fontSize: '1.2em' }}>{e.title}</div>
                <div style={{ color: '#64748b', fontWeight: 600, fontSize: '0.85em' }}>{e.time} · {e.location}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// 4. GLASS TIMELINE — universal
export function CalendarGlassTimelineWidget({ config }: WidgetProps<CalCfg>) {
  const c = config || {}; const evs = c.events?.length ? c.events : SAMPLE_EVENTS;
  const r = resolveStyle({ fontFamily: "'Inter', sans-serif", fontSize: 22, textColor: '#0f172a', bgColor: 'rgba(255,255,255,0.7)', bgGradient: 'linear-gradient(135deg, rgba(99,102,241,0.08), rgba(168,85,247,0.08))', padding: 32, borderRadius: 24, accentColor: '#6366f1', ...(c.style || {}) });
  return (
    <div style={{ ...frameStyle(r), backdropFilter: 'blur(20px)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h2 style={{ margin: 0, fontSize: '1.6em', fontWeight: 700, letterSpacing: '-0.02em' }}>{c.title || 'Upcoming Events'}</h2>
          <span style={{ fontSize: '0.85em', color: '#64748b' }}>{evs.length} scheduled</span>
        </div>
        <div style={{ position: 'relative', flex: 1 }}>
          <div style={{ position: 'absolute', left: 11, top: 8, bottom: 8, width: 2, background: `linear-gradient(180deg, ${r.accent.primary}, transparent)` }} />
          {evs.slice(0, 5).map((e, i) => (
            <div key={i} style={{ display: 'flex', gap: 16, paddingLeft: 0, marginBottom: 14, position: 'relative' }}>
              <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#fff', border: `3px solid ${r.accent.primary}`, flexShrink: 0, marginTop: 4, boxShadow: `0 0 0 4px rgba(99,102,241,0.1)` }} />
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span style={{ fontWeight: 700, fontSize: '1.1em' }}>{e.title}</span>
                  <span style={{ fontSize: '0.75em', color: r.accent.primary, fontWeight: 600, letterSpacing: '0.1em' }}>{e.date}</span>
                </div>
                <div style={{ fontSize: '0.8em', color: '#64748b' }}>{e.time} · {e.location}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// 5. OPS QUEUE — admin/staff
export function CalendarOpsQueueWidget({ config }: WidgetProps<CalCfg>) {
  const c = config || {}; const evs = c.events?.length ? c.events : SAMPLE_EVENTS;
  const r = resolveStyle({ fontFamily: "'JetBrains Mono', monospace", fontSize: 18, textColor: '#fafafa', bgColor: '#0a0e14', padding: 24, borderRadius: 8, borderWidth: 1, borderColor: '#1e293b', accentColor: '#22d3ee', accentColor2: '#fbbf24', ...(c.style || {}) });
  return (
    <div style={frameStyle(r)}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: `1px dashed ${r.accent.primary}55`, paddingBottom: 8, fontSize: '0.95em' }}>
          <b style={{ color: r.accent.primary, letterSpacing: '0.2em' }}>$ {c.title?.toUpperCase() || 'EVENT QUEUE'}</b>
          <span style={{ color: r.accent.secondary }}>{evs.length} ITEMS</span>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: r.font.size }}>
          <thead><tr style={{ color: r.accent.primary, fontSize: '0.8em', textTransform: 'uppercase' }}>
            <th style={{ textAlign: 'left', padding: 4 }}>WHEN</th>
            <th style={{ textAlign: 'left', padding: 4 }}>EVENT</th>
            <th style={{ textAlign: 'left', padding: 4 }}>LOCATION</th>
            <th style={{ textAlign: 'right', padding: 4 }}>TAG</th>
          </tr></thead>
          <tbody>
            {evs.slice(0, 6).map((e, i) => (
              <tr key={i} style={{ borderBottom: '1px dashed #1e293b' }}>
                <td style={{ padding: 4, color: r.accent.secondary }}>{e.date} {e.time}</td>
                <td style={{ padding: 4, fontWeight: 600 }}>{e.title}</td>
                <td style={{ padding: 4, opacity: 0.7 }}>{e.location}</td>
                <td style={{ padding: 4, textAlign: 'right' }}><span style={{ background: '#1e293b', padding: '1px 6px', borderRadius: 3, color: r.accent.primary, fontSize: '0.85em' }}>{e.tag}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
