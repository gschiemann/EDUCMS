"use client";
/**
 * VenueOS · Charts & KPI widgets — single-tile data viz primitives.
 */
import React from 'react';
import { resolveStyle, frameStyle, animDurationSec } from './_shared/styleSystem';
import type { BaseCfg, WidgetProps } from './_shared/types';

function px(z: number, f: number): number { return Math.max(8, Math.round(z * f)); }

/* ════════════════ BAR CHART ════════════════ */

export interface BarItem { label: string; value: number; }
export interface BarChartCfg extends BaseCfg {
  label?: string;
  title?: string;
  bars?: BarItem[];
  color?: string;
}

export function BarChartWidget({ config, live = true, height = 480 }: WidgetProps<BarChartCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#fff', textColor: '#0b0c0e', accentColor: c.color ?? '#3955d1', ...c.style });
  const label = c.label ?? 'Weekly signups';
  const title = c.title ?? 'New users · last 7 days';
  const bars: BarItem[] = c.bars ?? [
    { label: 'Mon', value: 124 }, { label: 'Tue', value: 168 }, { label: 'Wed', value: 142 },
    { label: 'Thu', value: 198 }, { label: 'Fri', value: 234 }, { label: 'Sat', value: 102 },
    { label: 'Sun', value: 88 },
  ];
  const max = Math.max(...bars.map(b => b.value), 1);

  return (
    <div style={frameStyle(r)}>
      <div style={{ position: 'absolute', top: '4%', left: '5%', right: '5%' }}>
        <div style={{ color: '#74767d', fontWeight: 700, fontSize: px(height, 0.058), letterSpacing: '0.06em', textTransform: 'uppercase' }}>{label}</div>
        <div style={{ fontWeight: 800, fontSize: px(height, 0.15), letterSpacing: '-0.02em', marginTop: '1%' }}>{title}</div>
      </div>

      <div style={{ position: 'absolute', top: '32%', bottom: '4%', left: '5%', right: '5%', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        {bars.map((b, i) => {
          const h = (b.value / max) * 100;
          return (
            <div key={i} style={{ flex: '1 0 0', display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', marginRight: i === bars.length - 1 ? 0 : '2%' }}>
              <div style={{ fontWeight: 800, fontSize: px(height, 0.075), marginBottom: '3%' }}>{b.value}</div>
              <div style={{ width: '100%', background: `linear-gradient(180deg, ${r.accent.primary}, ${r.accent.primary}cc)`, borderRadius: '12px 12px 0 0', flexShrink: 0, height: `${h}%` }} />
              <div style={{ color: '#74767d', fontWeight: 700, fontSize: px(height, 0.05), marginTop: '3%' }}>{b.label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ════════════════ DONUT GAUGE ════════════════ */

export interface DonutGaugeCfg extends BaseCfg {
  label?: string;
  title?: string;
  value?: number;
  goal?: number;
  color?: string;
}

export function DonutGaugeWidget({ config, live = true, height = 480 }: WidgetProps<DonutGaugeCfg>) {
  const c = config ?? {};
  const color = c.color ?? '#18a957';
  const r = resolveStyle({ bgColor: '#fff', textColor: '#0b0c0e', accentColor: color, ...c.style });
  const label = c.label ?? 'NPS · Last 30d';
  const title = c.title ?? 'Customer satisfaction';
  const value = c.value ?? 78;
  const goal = c.goal ?? 100;
  const pct = Math.min(1, value / goal);

  return (
    <div style={frameStyle(r)}>
      <div style={{ position: 'absolute', top: '4%', left: '5%', right: '5%' }}>
        <div style={{ color: '#74767d', fontWeight: 700, fontSize: px(height, 0.058), letterSpacing: '0.06em', textTransform: 'uppercase' }}>{label}</div>
        <div style={{ fontWeight: 800, fontSize: px(height, 0.15), letterSpacing: '-0.02em', marginTop: '1%' }}>{title}</div>
      </div>

      <div style={{ position: 'absolute', top: '32%', bottom: '4%', left: 0, right: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: px(height, 1.08), height: px(height, 1.08), borderRadius: '50%', background: `conic-gradient(${color} ${pct * 360}deg, #efeeea 0)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: px(height, 0.79), height: px(height, 0.79), borderRadius: '50%', background: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ color: '#74767d', fontWeight: 700, fontSize: px(height, 0.05), letterSpacing: '0.06em' }}>SCORE</div>
            <div style={{ fontWeight: 800, fontSize: px(height, 0.46), lineHeight: 0.9, letterSpacing: '-0.04em' }}>{value}</div>
            <div style={{ color, fontWeight: 700, fontSize: px(height, 0.063) }}>of {goal}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ════════════════ LINE CHART ════════════════ */

export interface LineSeries { name: string; color: string; values: number[]; }
export interface LineChartCfg extends BaseCfg {
  label?: string;
  title?: string;
  series?: LineSeries[];
}

export function LineChartWidget({ config, live = true, height = 480 }: WidgetProps<LineChartCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#0b0c0e', textColor: '#fff', accentColor: '#7b5cff', ...c.style });
  const label = c.label ?? '6-week trend';
  const title = c.title ?? 'Revenue vs forecast';
  const series: LineSeries[] = c.series ?? [
    { name: 'Actual', color: '#3955d1', values: [80, 92, 105, 121, 138, 152, 168] },
    { name: 'Forecast', color: '#7b5cff', values: [80, 95, 110, 125, 140, 155, 175] },
  ];
  const max = Math.max(...series.flatMap(s => s.values), 1);

  return (
    <div style={frameStyle(r)}>
      <div style={{ position: 'absolute', top: '4%', left: '5%', right: '5%' }}>
        <div style={{ color: '#74767d', fontWeight: 700, fontSize: px(height, 0.058), letterSpacing: '0.06em', textTransform: 'uppercase' }}>{label}</div>
        <div style={{ fontWeight: 800, fontSize: px(height, 0.15), letterSpacing: '-0.02em' }}>{title}</div>
      </div>

      <div style={{ position: 'absolute', top: '28%', bottom: '15%', left: '5%', right: '5%' }}>
        <svg viewBox="0 0 800 400" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
          {[0, 1, 2, 3, 4].map(i => <line key={i} x1="0" x2="800" y1={i * 100} y2={i * 100} stroke="#1c2230" strokeDasharray="4 6" />)}
          {series.map((s, si) => {
            const pts = s.values.map((v, i) => `${(i / (s.values.length - 1)) * 800},${400 - (v / max) * 380}`).join(' ');
            return (
              <g key={si}>
                <polyline points={pts} fill="none" stroke={s.color} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
                {s.values.map((v, i) => <circle key={i} cx={(i / (s.values.length - 1)) * 800} cy={400 - (v / max) * 380} r="6" fill={s.color} />)}
              </g>
            );
          })}
        </svg>
      </div>

      <div style={{ position: 'absolute', bottom: '4%', left: '5%', right: '5%', display: 'flex' }}>
        {series.map((s, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', marginRight: '6%' }}>
            <span style={{ width: px(height, 0.03), height: px(height, 0.03), borderRadius: '50%', background: s.color, marginRight: '2%' }} />
            <span style={{ color: '#cfd8e3', fontWeight: 600, fontSize: px(height, 0.046) }}>{s.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ════════════════ PROGRESS LIST ════════════════ */

export interface ProgressRow { title: string; pct: number; note?: string; }
export interface ProgressListCfg extends BaseCfg {
  label?: string;
  title?: string;
  rows?: ProgressRow[];
}

export function ProgressListWidget({ config, live = true, height = 480 }: WidgetProps<ProgressListCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#fff', textColor: '#0b0c0e', accentColor: '#3955d1', ...c.style });
  const label = c.label ?? 'Project status';
  const title = c.title ?? 'Where we are this week';
  const rows: ProgressRow[] = c.rows ?? [
    { title: 'Foundation pour', pct: 100, note: 'Completed week 1' },
    { title: 'Framing', pct: 82, note: 'Roof framing in progress' },
    { title: 'Mechanical / Electrical', pct: 45, note: 'HVAC ducting next' },
    { title: 'Interior finishes', pct: 18, note: 'Drywall starting May 22' },
    { title: 'Inspection & handover', pct: 0, note: 'Scheduled June 30' },
  ];

  return (
    <div style={frameStyle(r)}>
      <div style={{ position: 'absolute', top: '4%', left: '5%', right: '5%' }}>
        <div style={{ color: '#74767d', fontWeight: 700, fontSize: px(height, 0.058), letterSpacing: '0.06em', textTransform: 'uppercase' }}>{label}</div>
        <div style={{ fontWeight: 800, fontSize: px(height, 0.15), letterSpacing: '-0.02em' }}>{title}</div>
      </div>

      <div style={{ position: 'absolute', top: '26%', bottom: '4%', left: '5%', right: '5%' }}>
        {rows.slice(0, 5).map((row, i) => {
          const color = row.pct >= 80 ? '#18a957' : row.pct >= 50 ? '#3955d1' : row.pct >= 25 ? '#f59e0b' : '#dc2626';
          return (
            <div key={i} style={{ marginBottom: i === rows.length - 1 ? 0 : '2.5%' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                <div style={{ fontWeight: 700, fontSize: px(height, 0.075) }}>{row.title}</div>
                <div style={{ fontWeight: 800, fontSize: px(height, 0.083) }}>{row.pct}%</div>
              </div>
              <div style={{ marginTop: '1%', height: px(height, 0.046), background: '#efeeea', borderRadius: 11, overflow: 'hidden' }}>
                <div style={{ width: `${row.pct}%`, height: '100%', background: color, borderRadius: 11 }} />
              </div>
              {row.note && <div style={{ color: '#74767d', fontSize: px(height, 0.046), fontWeight: 600, marginTop: '0.5%' }}>{row.note}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ════════════════ COUNT-UP STATS ════════════════ */

export interface CountStat { label: string; value: string; note: string; }
export interface CountUpStatsCfg extends BaseCfg {
  label?: string;
  title?: string;
  stats?: CountStat[];
}

export function CountUpStatsWidget({ config, live = true, height = 480 }: WidgetProps<CountUpStatsCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#0b0c0e', textColor: '#fff', accentColor: '#7b5cff', ...c.style });
  const label = c.label ?? 'By the numbers';
  const title = c.title ?? 'A year in numbers';
  const stats: CountStat[] = c.stats ?? [
    { label: 'STUDENTS', value: '1,247', note: 'enrolled this year' },
    { label: 'CLUBS', value: '42', note: 'student-led organizations' },
    { label: 'AWARDS', value: '89', note: 'state + regional in spring' },
    { label: 'ALUMNI', value: '13K', note: 'across 6 generations' },
  ];

  return (
    <div style={frameStyle(r)}>
      <div style={{ position: 'absolute', top: '4%', left: '4%', right: '4%' }}>
        <div style={{ color: r.accent.primary, fontWeight: 700, fontSize: px(height, 0.062), letterSpacing: '0.08em' }}>{label.toUpperCase()}</div>
        <div style={{ fontWeight: 800, fontSize: px(height, 0.19), letterSpacing: '-0.02em' }}>{title}</div>
      </div>

      <div style={{ position: 'absolute', top: '40%', bottom: '4%', left: '4%', right: '4%', display: 'flex', flexWrap: 'wrap' }}>
        {stats.slice(0, 4).map((s, i) => {
          const col = i % 2;
          return (
            <div key={i} style={{ width: '49%', marginRight: col === 1 ? 0 : '2%', marginBottom: '2%', background: '#11161e', border: '1px solid #1c2230', borderRadius: 14, padding: '3% 4%' }}>
              <div style={{ color: r.accent.primary, fontWeight: 700, fontSize: px(height, 0.054), letterSpacing: '0.06em' }}>{s.label}</div>
              <div style={{ fontWeight: 800, fontSize: px(height, 0.46), lineHeight: 0.9, letterSpacing: '-0.04em', marginTop: '2%' }}>{s.value}</div>
              <div style={{ color: '#cfd8e3', fontWeight: 600, fontSize: px(height, 0.054), marginTop: '2%' }}>{s.note}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* KPI_TILE is exported from CorporateWidgets.tsx — KPI_DASHBOARD is a composition of N KpiTileWidgets, build at the template level rather than as a separate widget. */
