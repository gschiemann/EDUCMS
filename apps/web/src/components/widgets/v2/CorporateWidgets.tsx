"use client";
/**
 * VenueOS · Corporate / office widgets.
 * Meeting rooms, KPIs, leaderboards, door signs, visitor welcome, OKRs, anniversaries.
 */
import React from 'react';
import { resolveStyle, frameStyle, animDurationSec } from './_shared/styleSystem';
import type { BaseCfg, WidgetProps } from './_shared/types';
import { useNowTick } from './_shared/useNowTick';
import { formatInZone, nextWindowIndex, readClock } from '@/lib/time-truth';
import { parseTimeToMinutes, formatTime12Spaced } from '@/lib/format-time';

function px(z: number, f: number): number { return Math.max(8, Math.round(z * f)); }

/* ════════════════ ROOM SCHEDULE ════════════════ */

export interface RoomEvent {
  start: string;
  title: string;
  host: string;
  seats: number;
  /** Optional. When a booking carries its own end, a BOOKED door sign may
   *  say "Until <end>". Without one, nothing in the config says when the
   *  room frees up and the sign makes no time claim at all. */
  end?: string;
}
export interface RoomScheduleCfg extends BaseCfg {
  room?: string;
  status?: 'AVAILABLE' | 'BOOKED' | 'RESERVED';
  events?: RoomEvent[];
  /** IANA zone for the door sign's clock, e.g. "America/Chicago". Unset =
   *  the device clock, which is what a wall-mounted panel already runs on. */
  timezone?: string;
}

/**
 * W02 (2026-09-12) — this sign used to read, in full:
 *
 *   status === 'AVAILABLE' ? 'Free for 32 min'
 *     : status === 'BOOKED' ? 'Until 2:30 PM' : 'Reserved · standby'
 *
 * Both time claims were STRING CONSTANTS. Every meeting room in the
 * building said it was free for the same 32 minutes, forever, including
 * rooms with a booking starting in two. Somebody walks in and sits down.
 *
 * Availability now comes only from the configured bookings against a real
 * clock: "Free for N min" is the distance to the next booking that actually
 * starts after now, and with no upcoming booking the honest state is "No
 * bookings today". A BOOKED room says "Until <end>" only when a booking in
 * progress carries an end — otherwise it shows the status pill and nothing
 * more, because nothing here knows when the room frees up.
 */
export function RoomScheduleWidget({ config, live = true, height = 480 }: WidgetProps<RoomScheduleCfg>) {
  const c = config ?? {};
  const status = c.status ?? 'AVAILABLE';
  const tone = status === 'AVAILABLE' ? '#22c55e' : status === 'BOOKED' ? '#dc2626' : '#f59e0b';
  const r = resolveStyle({ bgColor: '#0b0c0e', textColor: '#fff', accentColor: tone, ...c.style });
  const room = c.room ?? 'Pacific · 12-A';
  const events: RoomEvent[] = c.events ?? [
    { start: '2:30 PM', title: 'Q3 Engineering Planning', host: 'A. Chen', seats: 14 },
    { start: '4:00 PM', title: 'Design review · Onboarding', host: 'M. Stevens', seats: 8 },
    { start: '5:30 PM', title: 'Interview · Senior PM', host: 'R. Patel', seats: 4 },
  ];

  // A minute-resolution sign: 30s keeps "Free for N min" honest to the minute.
  const now = useNowTick(30_000, live);
  const { minutes } = readClock(now, c.timezone);
  const availability = (() => {
    if (status === 'BOOKED') {
      // Only a booking that is genuinely in progress can say when it ends.
      const running = events.find((e) => {
        const s = parseTimeToMinutes(e?.start);
        const end = parseTimeToMinutes(e?.end);
        return s != null && end != null && end > s && minutes >= s && minutes < end;
      });
      return running ? `Until ${formatTime12Spaced(running.end)}` : '';
    }
    if (status !== 'AVAILABLE') return 'Reserved · standby';
    const nextIdx = nextWindowIndex(events, minutes);
    if (nextIdx < 0) return 'No bookings today';
    const startsIn = (parseTimeToMinutes(events[nextIdx].start) as number) - minutes;
    return `Free for ${startsIn} min`;
  })();

  return (
    <div style={frameStyle(r)}>
      <div style={{ position: 'absolute', top: '4%', left: '5%', right: '5%', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div style={{ color: '#74767d', fontSize: px(height, 0.06), fontWeight: 700, letterSpacing: '0.06em' }}>MEETING ROOM</div>
        <div style={{ color: '#74767d', fontSize: px(height, 0.06), fontWeight: 700 }}>{formatInZone(now, { weekday: 'long', month: 'long', day: 'numeric' }, c.timezone)}</div>
      </div>

      <div style={{ position: 'absolute', top: '13%', left: '5%', right: '5%' }}>
        <div style={{ fontWeight: 800, fontSize: px(height, 0.33), letterSpacing: '-0.02em', lineHeight: 1.0 }}>{room}</div>
        <div style={{ display: 'flex', alignItems: 'center', marginTop: '3%' }}>
          <div style={{ background: tone, color: '#fff', padding: '3% 6%', borderRadius: 14, fontWeight: 800, fontSize: px(height, 0.075), letterSpacing: '0.04em', marginRight: '3%' }}>{status}</div>
          <div style={{ color: '#cfd8e3', fontSize: px(height, 0.07), fontWeight: 600 }}>
            {availability}
          </div>
        </div>
      </div>

      <div style={{ position: 'absolute', top: '60%', bottom: '4%', left: '5%', right: '5%', background: '#11161e', border: '1px solid #1c2230', borderRadius: 18, padding: '3%' }}>
        <div style={{ color: '#74767d', fontWeight: 700, fontSize: px(height, 0.05), letterSpacing: '0.06em', marginBottom: '2%' }}>UP NEXT TODAY</div>
        {events.slice(0, 3).map((e, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', padding: '1.5% 0', borderBottom: i < events.length - 1 ? '1px solid #1c2230' : 'none' }}>
            <div style={{ width: '20%', color: '#cfd8e3', fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontWeight: 700, fontSize: px(height, 0.062) }}>{e.start}</div>
            <div style={{ flex: '1 0 0', fontWeight: 700, fontSize: px(height, 0.062) }}>{e.title}</div>
            <div style={{ color: '#74767d', fontWeight: 600, fontSize: px(height, 0.046), textAlign: 'right' }}>{e.host} · {e.seats} seats</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ════════════════ VISITOR WELCOME ════════════════ */

export interface VisitorWelcomeCfg extends BaseCfg {
  host?: string;
  visitor?: string;
  company?: string;
  meeting?: string;
  where?: string;
  /** IANA zone for the lobby clock. Unset = the device clock. */
  timezone?: string;
}

export function VisitorWelcomeWidget({ config, live = true, height = 480 }: WidgetProps<VisitorWelcomeCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#0b0c0e', textColor: '#fff', accentColor: '#7b5cff', ...c.style });
  // W02 — a lobby clock read inline from `new Date()` freezes at boot.
  const now = useNowTick(30_000, live);
  const host = c.host ?? 'Northwind HQ';
  const visitor = c.visitor ?? 'Alex Morgan';
  const company = c.company ?? 'Acme Robotics';
  const meeting = c.meeting ?? 'Dana Stevens';
  const where = c.where ?? 'Lobby reception';

  return (
    <div style={frameStyle(r)}>
      <div style={{ position: 'absolute', top: '8%', left: '6%', display: 'flex', alignItems: 'baseline' }}>
        <div style={{ width: px(height, 0.11), height: px(height, 0.11), borderRadius: 14, background: '#3955d1', marginRight: '3%' }} />
        <div style={{ fontWeight: 800, fontSize: px(height, 0.1) }}>{host}</div>
      </div>

      <div style={{ position: 'absolute', top: '30%', left: '6%', right: '6%' }}>
        <div style={{ color: r.accent.primary, fontWeight: 700, fontSize: px(height, 0.088), letterSpacing: '0.04em', marginBottom: '2%' }}>WELCOME</div>
        <div style={{ fontWeight: 800, fontSize: px(height, 0.46), lineHeight: 0.9, letterSpacing: '-0.03em' }}>{visitor}</div>
        <div style={{ color: '#cfd8e3', fontWeight: 700, fontSize: px(height, 0.133), marginTop: '2%' }}>from {company}</div>
      </div>

      <div style={{ position: 'absolute', bottom: '4%', left: '6%', right: '6%', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ color: '#74767d', fontWeight: 600, fontSize: px(height, 0.063) }}>You&apos;re meeting <span style={{ color: '#fff', fontWeight: 700 }}>{meeting}</span> · {where}</div>
        <div style={{ color: '#74767d', fontWeight: 600, fontSize: px(height, 0.063), fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>
          {formatInZone(now, { hour: 'numeric', minute: '2-digit' }, c.timezone)}
        </div>
      </div>
    </div>
  );
}

/* ════════════════ KPI TILE (single metric) ════════════════ */

export interface KpiTileCfg extends BaseCfg {
  label?: string;
  value?: string;
  prefix?: string;
  suffix?: string;
  delta?: number;
  target?: string;
  trend?: number[];
}

export function KpiTileWidget({ config, live = true, height = 480 }: WidgetProps<KpiTileCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#fff', textColor: '#0b0c0e', accentColor: '#18a957', ...c.style });
  const label = c.label ?? 'Revenue · MRR';
  const value = c.value ?? '1.42M';
  const prefix = c.prefix ?? '$';
  const suffix = c.suffix ?? '';
  const delta = c.delta ?? 12;
  const target = c.target ?? '1.5M';
  const trend = c.trend ?? [5, 8, 6, 9, 11, 9, 13, 15, 14, 17];
  const up = delta >= 0;
  const trendColor = up ? '#18a957' : '#dc2626';
  const maxT = Math.max(...trend, 1);
  const pts = trend.map((v, i) => `${i * (200 / (trend.length - 1))},${50 - (v / maxT) * 40}`).join(' ');

  return (
    <div style={frameStyle(r)}>
      <div style={{ position: 'absolute', top: '8%', left: '6%', right: '6%', color: '#74767d', fontWeight: 700, fontSize: px(height, 0.062), letterSpacing: '0.08em', textTransform: 'uppercase' }}>{label}</div>

      <div style={{ position: 'absolute', top: '24%', left: '6%', right: '6%', display: 'flex', alignItems: 'baseline' }}>
        {prefix && <span style={{ color: '#74767d', fontWeight: 700, fontSize: px(height, 0.19), marginRight: '2%' }}>{prefix}</span>}
        <span style={{ fontWeight: 800, fontSize: px(height, 0.7), lineHeight: 0.85, letterSpacing: '-0.04em' }}>{value}</span>
        {suffix && <span style={{ color: '#74767d', fontWeight: 700, fontSize: px(height, 0.19), marginLeft: '2%' }}>{suffix}</span>}
      </div>

      <div style={{ position: 'absolute', bottom: '24%', left: '6%', right: '6%', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ color: trendColor, fontWeight: 700, fontSize: px(height, 0.083) }}>{up ? '▲' : '▼'} {Math.abs(delta)}% <span style={{ color: '#74767d', fontWeight: 600 }}>vs last quarter</span></div>
        {target && <div style={{ color: '#74767d', fontWeight: 600, fontSize: px(height, 0.066) }}>Goal {target}</div>}
      </div>

      <svg viewBox="0 0 200 50" preserveAspectRatio="none" style={{ position: 'absolute', bottom: '4%', left: '6%', right: '6%', width: '88%', height: px(height, 0.21) }}>
        <polyline points={pts} fill="none" stroke={trendColor} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </div>
  );
}

/* ════════════════ SALES LEADERBOARD ════════════════ */

export interface LeaderRow { name: string; team: string; deals: number; amount: number; pct: number; color: string; }
export interface SalesLeaderboardCfg extends BaseCfg {
  title?: string;
  goal?: string;
  percent?: number;
  rows?: LeaderRow[];
}

export function SalesLeaderboardWidget({ config, live = true, height = 480 }: WidgetProps<SalesLeaderboardCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#0b0c0e', textColor: '#fff', accentColor: '#7b5cff', ...c.style });
  const title = c.title ?? 'Sales · September';
  const goal = c.goal ?? '$2.5M';
  const percent = c.percent ?? 78;
  const rows: LeaderRow[] = c.rows ?? [
    { name: 'Priya Patel', team: 'West', deals: 12, amount: 412000, pct: 137, color: '#7c3aed' },
    { name: 'Jordan Reyes', team: 'East', deals: 9, amount: 298000, pct: 119, color: '#0ea5e9' },
    { name: 'Sam Whitaker', team: 'West', deals: 8, amount: 234000, pct: 104, color: '#22c55e' },
    { name: 'Chen Liu', team: 'Central', deals: 7, amount: 198000, pct: 88, color: '#f97316' },
    { name: 'Erin O\'Brien', team: 'East', deals: 6, amount: 174000, pct: 77, color: '#ec4899' },
  ];
  const maxVal = Math.max(...rows.map(r1 => r1.amount), 1);

  return (
    <div style={frameStyle(r)}>
      <div style={{ position: 'absolute', top: '3%', left: '4%', right: '4%', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div style={{ fontWeight: 800, fontSize: px(height, 0.13), letterSpacing: '-0.02em' }}>{title}</div>
        <div style={{ color: r.accent.primary, fontWeight: 700, fontSize: px(height, 0.062) }}>Goal {goal} · {percent}% YTD</div>
      </div>

      <div style={{ position: 'absolute', top: '20%', bottom: '4%', left: '4%', right: '4%', background: '#11161e', border: '1px solid #1c2230', borderRadius: 18, overflow: 'hidden' }}>
        {rows.slice(0, 5).map((row, i) => {
          const w = (row.amount / maxVal) * 100;
          return (
            <div key={i} style={{ padding: '2% 3%', borderBottom: i < rows.length - 1 ? '1px solid #1c2230' : 'none', display: 'flex', alignItems: 'center', position: 'relative' }}>
              <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: `${w}%`, background: `${i === 0 ? '#7b5cff' : '#3955d1'}22` }} />
              <div style={{ position: 'relative', width: '8%', color: i === 0 ? '#ffd23a' : i < 3 ? '#cfd8e3' : '#74767d', fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontWeight: 800, fontSize: px(height, 0.075) }}>#{i + 1}</div>
              <div style={{ position: 'relative', width: px(height, 0.11), height: px(height, 0.11), borderRadius: '50%', background: row.color, color: '#fff', fontWeight: 800, fontSize: px(height, 0.046), display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: '3%' }}>{row.name.split(' ').map(x => x[0]).slice(0, 2).join('')}</div>
              <div style={{ position: 'relative', flex: '1 0 0' }}>
                <div style={{ fontWeight: 700, fontSize: px(height, 0.058) }}>{row.name}</div>
                <div style={{ color: '#74767d', fontWeight: 600, fontSize: px(height, 0.038) }}>{row.team} · {row.deals} deals</div>
              </div>
              <div style={{ position: 'relative', textAlign: 'right' }}>
                <div style={{ fontWeight: 800, fontSize: px(height, 0.075) }}>${(row.amount / 1000).toFixed(0)}K</div>
                <div style={{ color: '#22d39b', fontWeight: 700, fontSize: px(height, 0.038) }}>{row.pct}% of quota</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ════════════════ DOOR SIGN (Portrait) ════════════════ */

export interface DoorSignCfg extends BaseCfg {
  occupant?: string;
  title?: string;
  status?: 'AVAILABLE' | 'BUSY' | 'DO_NOT_DISTURB' | 'OUT_OF_OFFICE';
  room?: string;
  /** IANA zone for the sign's clock. Unset = the device clock. */
  timezone?: string;
}

export function DoorSignWidget({ config, live = true, height = 480 }: WidgetProps<DoorSignCfg>) {
  const c = config ?? {};
  const status = c.status ?? 'AVAILABLE';
  const tone = status === 'AVAILABLE' ? '#22c55e' : status === 'BUSY' ? '#dc2626' : status === 'DO_NOT_DISTURB' ? '#7f1d1d' : '#f59e0b';
  const r = resolveStyle({ bgColor: tone, textColor: '#fff', ...c.style });
  const occupant = c.occupant ?? 'Dana Stevens';
  const title = c.title ?? 'VP Engineering';
  const room = c.room ?? 'Room 412';
  // W02 — a door sign that renders once at boot and then never again was
  // showing the minute the screen started up as the current time.
  const now = useNowTick(30_000, live);
  const statusText = status.replace(/_/g, ' ');
  // W02 — BUSY used to read "In a meeting · back at 3:30". Nothing on this
  // sign knows when the occupant is back; 3:30 was a constant, and a visitor
  // waiting in the corridor for it is a real cost. The status is the
  // operator's own claim and stays; the invented return time is gone.
  const note = status === 'AVAILABLE' ? 'Walk in any time' : status === 'BUSY' ? 'In a meeting' : 'Heads-down · please email';

  return (
    <div style={frameStyle(r)}>
      <div style={{ position: 'absolute', top: '5%', left: '6%', right: '6%' }}>
        <div style={{ fontWeight: 700, fontSize: px(height, 0.075), opacity: 0.7, letterSpacing: '0.08em' }}>OFFICE</div>
        <div style={{ fontWeight: 800, fontSize: px(height, 0.29), letterSpacing: '-0.02em', lineHeight: 0.95, marginTop: '2%' }}>{occupant}</div>
        <div style={{ fontSize: px(height, 0.088), fontWeight: 600, marginTop: '3%', opacity: 0.85 }}>{title}</div>
      </div>

      <div style={{ position: 'absolute', bottom: '20%', left: '6%', right: '6%' }}>
        <div style={{ fontWeight: 800, fontSize: px(height, 0.25), letterSpacing: '-0.02em', lineHeight: 1 }}>{statusText}</div>
        <div style={{ fontSize: px(height, 0.075), fontWeight: 600, marginTop: '2.5%', opacity: 0.85 }}>{note}</div>
      </div>

      <div style={{ position: 'absolute', bottom: '5%', left: '6%', right: '6%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: px(height, 0.063), fontWeight: 600 }}>
        <span>{room}</span>
        <span style={{ fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>{formatInZone(now, { hour: 'numeric', minute: '2-digit' }, c.timezone)}</span>
      </div>
    </div>
  );
}

/* ════════════════ OKR TRACKER ════════════════ */

export interface OkrEntry { title: string; pct: number; krs: Array<{ label: string; now: string | number; target: string | number }>; }
export interface OkrTrackerCfg extends BaseCfg { okrs?: OkrEntry[]; quarter?: string; }

export function OkrTrackerWidget({ config, live = true, height = 480 }: WidgetProps<OkrTrackerCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#f7f7f5', textColor: '#0b0c0e', accentColor: '#3955d1', ...c.style });
  const quarter = c.quarter ?? 'Q3';
  const okrs: OkrEntry[] = c.okrs ?? [
    { title: 'Reach $2M ARR by end of Q3', pct: 78, krs: [{ label: 'New ARR', now: '$1.42M', target: '$2.0M' }, { label: 'Logos', now: 42, target: 60 }] },
    { title: 'NPS ≥ 70 (currently 68)', pct: 62, krs: [{ label: 'NPS', now: 68, target: 70 }, { label: 'Survey responses', now: 312, target: 400 }] },
    { title: 'Ship multi-tenant SSO', pct: 35, krs: [{ label: 'Connectors', now: 2, target: 5 }, { label: 'Pilot tenants live', now: 1, target: 5 }] },
  ];

  return (
    <div style={frameStyle(r)}>
      <div style={{ position: 'absolute', top: '4%', left: '4%', right: '4%', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div style={{ fontWeight: 800, fontSize: px(height, 0.13), letterSpacing: '-0.02em' }}>OKRs · {quarter} progress</div>
        <div style={{ color: '#74767d', fontSize: px(height, 0.055), fontWeight: 600 }}>7 weeks remaining</div>
      </div>

      <div style={{ position: 'absolute', top: '22%', bottom: '4%', left: '4%', right: '4%' }}>
        {okrs.slice(0, 3).map((o, i) => {
          const barColor = o.pct >= 70 ? '#18a957' : o.pct >= 40 ? '#f59e0b' : '#dc2626';
          return (
            <div key={i} style={{ background: '#fff', border: '1px solid #e7e6e1', borderRadius: 14, padding: '2.5% 3%', marginBottom: i === okrs.length - 1 ? 0 : '2%' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5%' }}>
                <div>
                  <div style={{ color: '#74767d', fontWeight: 700, fontSize: px(height, 0.038), letterSpacing: '0.06em' }}>OBJECTIVE {i + 1}</div>
                  <div style={{ fontWeight: 700, fontSize: px(height, 0.066) }}>{o.title}</div>
                </div>
                <div style={{ color: barColor, fontWeight: 800, fontSize: px(height, 0.1) }}>{o.pct}%</div>
              </div>
              <div style={{ height: px(height, 0.038), background: '#efeeea', borderRadius: 9, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${o.pct}%`, background: barColor, borderRadius: 9 }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ════════════════ TEAM ANNIVERSARIES ════════════════ */

export interface PersonRow { name: string; team: string; years: number; type: 'work' | 'birthday'; color: string; }
export interface TeamAnniversariesCfg extends BaseCfg { list?: PersonRow[]; company?: string; }

export function TeamAnniversariesWidget({ config, live = true, height = 480 }: WidgetProps<TeamAnniversariesCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#fdfaf3', textColor: '#0b0c0e', accentColor: '#3955d1', ...c.style });
  const company = c.company ?? 'Northwind';
  const list: PersonRow[] = c.list ?? [
    { name: 'Priya Patel', team: 'Sales · West', years: 5, type: 'work', color: '#7c3aed' },
    { name: 'Jordan Reyes', team: 'Customer Success', years: 3, type: 'work', color: '#0ea5e9' },
    { name: 'Sam Whitaker', team: 'Engineering', years: 1, type: 'work', color: '#22c55e' },
    { name: 'Chen Liu', team: 'Product', years: 30, type: 'birthday', color: '#f97316' },
    { name: 'Erin O\'Brien', team: 'Design', years: 7, type: 'work', color: '#ec4899' },
    { name: 'Marcus Kim', team: 'People Ops', years: 2, type: 'work', color: '#facc15' },
  ];

  return (
    <div style={frameStyle(r)}>
      <div style={{ position: 'absolute', top: '4%', left: '4%', right: '4%' }}>
        <div style={{ color: r.accent.primary, fontWeight: 700, fontSize: px(height, 0.062), letterSpacing: '0.08em' }}>THIS WEEK</div>
        <div style={{ fontWeight: 800, fontSize: px(height, 0.19), letterSpacing: '-0.02em' }}>Celebrating our team 🎉</div>
      </div>

      <div style={{ position: 'absolute', top: '36%', bottom: '4%', left: '4%', right: '4%', display: 'flex', flexWrap: 'wrap' }}>
        {list.slice(0, 6).map((p, i) => {
          const col = i % 3;
          return (
            <div key={i} style={{ width: '32%', marginRight: col === 2 ? 0 : '2%', marginBottom: '2%', background: '#fff', border: '1px solid #e7e6e1', borderRadius: 14, padding: '3%' }}>
              <div style={{ width: px(height, 0.2), height: px(height, 0.2), borderRadius: '50%', background: p.color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: px(height, 0.08), marginBottom: '4%' }}>{p.name.split(' ').map(x => x[0]).slice(0, 2).join('')}</div>
              <div style={{ fontWeight: 700, fontSize: px(height, 0.062) }}>{p.name}</div>
              <div style={{ color: '#74767d', fontWeight: 600, fontSize: px(height, 0.042) }}>{p.team}</div>
              <div style={{ display: 'flex', alignItems: 'baseline', marginTop: '4%' }}>
                <span style={{ color: r.accent.primary, fontWeight: 800, fontSize: px(height, 0.13), marginRight: '4%' }}>{p.years}</span>
                <span style={{ color: '#74767d', fontWeight: 700, fontSize: px(height, 0.046) }}>{p.type === 'birthday' ? 'years of you 🎂' : `years at ${company}`}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
