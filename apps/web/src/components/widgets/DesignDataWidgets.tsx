"use client";

import React, { useMemo } from 'react';
import type { ThemeWidgetProps } from './themes/registry';
import { useDesignFont } from './use-design-font';
import { DesignElementStage } from './DesignElementStage';

export const DATA_WIDGET_VARIANTS = ['design-table', 'design-chart-bar', 'design-chart-line', 'design-chart-pie'] as const;
export const DATA_TABLE_MAX_COLUMNS = 6;
export const DATA_TABLE_MAX_ROWS = 8;
export const DATA_CHART_MAX_ROWS = 8;

export interface DesignTableConfig {
  variant: 'design-table';
  heading: string;
  caption: string;
  columns: string[];
  rows: string[][];
  textColor: string;
  headerColor: string;
  backgroundColor: string;
  borderColor: string;
  fontFamily: string;
  headingFont: string;
  fontSize: number;
  alignment: 'left' | 'center' | 'right';
}
export interface DesignChartDatum { label: string; value: number; color: string; }
export interface DesignChartConfig {
  variant: 'design-chart-bar' | 'design-chart-line' | 'design-chart-pie';
  heading: string;
  caption: string;
  rows: DesignChartDatum[];
  textColor: string;
  backgroundColor: string;
  gridColor: string;
  fontFamily: string;
  headingFont: string;
  fontSize: number;
  showGrid: boolean;
  showLegend: boolean;
}

const DEFAULT_COLUMNS = ['Item', 'Details', 'Notes'];
const DEFAULT_ROWS = [
  ['First item', 'Add your details', 'Add a note'],
  ['Second item', 'Add your details', 'Add a note'],
  ['Third item', 'Add your details', 'Add a note'],
];
const DEFAULT_CHART_ROWS: DesignChartDatum[] = [
  { label: 'Mon', value: 42, color: '#285c52' },
  { label: 'Tue', value: 58, color: '#b65d43' },
  { label: 'Wed', value: 35, color: '#bc984f' },
  { label: 'Thu', value: 71, color: '#70668e' },
];

export const DEFAULT_DESIGN_TABLE: DesignTableConfig = {
  variant: 'design-table', heading: 'At a glance', caption: '', columns: DEFAULT_COLUMNS,
  rows: DEFAULT_ROWS, textColor: '#172033', headerColor: '#e8eef8',
  backgroundColor: '#ffffff', borderColor: '#aab6c8', fontFamily: 'DM Sans, sans-serif', headingFont: 'Cormorant Garamond, serif',
  fontSize: 60, alignment: 'left',
};
export const DEFAULT_DESIGN_CHART: DesignChartConfig = {
  variant: 'design-chart-bar', heading: 'Weekly progress', caption: '', rows: DEFAULT_CHART_ROWS,
  textColor: '#172033', backgroundColor: '#ffffff', gridColor: '#cbd5e1',
  fontFamily: 'DM Sans, sans-serif', headingFont: 'Cormorant Garamond, serif', fontSize: 60, showGrid: true, showLegend: false,
};

const asText = (v: unknown, fallback = '') => typeof v === 'string' ? v : fallback;
const asColor = (v: unknown, fallback: string) => typeof v === 'string' && /^(#[\da-f]{3,8}|rgba?\([^)]*\)|[a-z]+)$/i.test(v.trim()) ? v : fallback;
const asSize = (v: unknown, fallback: number) => typeof v === 'number' && Number.isFinite(v) ? Math.max(12, Math.min(160, v)) : fallback;

export function readDesignTableConfig(config: Record<string, unknown> = {}): DesignTableConfig {
  const columns = Array.isArray(config.columns) ? config.columns.map((x) => asText(x)) : DEFAULT_COLUMNS.slice();
  const rows = Array.isArray(config.rows) ? config.rows.map((row) => Array.isArray(row) ? row.map((x) => asText(x)) : []) : DEFAULT_ROWS.map((r) => r.slice());
  // Malformed/older configs can contain cells beyond the declared headers.
  // Surface each one under an editable generated heading instead of hiding it.
  const widestRow = rows.reduce((widest, row) => Math.max(widest, row.length), 0);
  while (columns.length < widestRow) columns.push(`Column ${columns.length + 1}`);
  return {
    variant: 'design-table', heading: asText(config.heading, DEFAULT_DESIGN_TABLE.heading), caption: asText(config.caption),
    columns, rows, textColor: asColor(config.textColor, DEFAULT_DESIGN_TABLE.textColor),
    headerColor: asColor(config.headerColor, DEFAULT_DESIGN_TABLE.headerColor),
    backgroundColor: asColor(config.backgroundColor, DEFAULT_DESIGN_TABLE.backgroundColor),
    borderColor: asColor(config.borderColor, DEFAULT_DESIGN_TABLE.borderColor),
    headingFont: asText(config.headingFont, asText(config.fontFamily, DEFAULT_DESIGN_TABLE.headingFont)),
    fontFamily: asText(config.fontFamily, DEFAULT_DESIGN_TABLE.fontFamily), fontSize: asSize(config.fontSize, DEFAULT_DESIGN_TABLE.fontSize),
    alignment: ['left', 'center', 'right'].includes(String(config.alignment)) ? config.alignment as DesignTableConfig['alignment'] : 'left',
  };
}

export function readDesignChartConfig(config: Record<string, unknown> = {}): DesignChartConfig {
  const rows: DesignChartDatum[] = Array.isArray(config.rows) ? config.rows.map((item, i) => {
    const row = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    return { label: asText(row.label), value: typeof row.value === 'number' && Number.isFinite(row.value) ? row.value : Number.isFinite(Number(row.value)) ? Number(row.value) : 0,
      color: asColor(row.color, DEFAULT_CHART_ROWS[i % DEFAULT_CHART_ROWS.length].color) };
  }) : DEFAULT_CHART_ROWS.map((r) => ({ ...r }));
  const variant = ['design-chart-line', 'design-chart-pie'].includes(String(config.variant)) ? config.variant as DesignChartConfig['variant'] : 'design-chart-bar';
  return {
    variant, heading: asText(config.heading, DEFAULT_DESIGN_CHART.heading), caption: asText(config.caption), rows,
    textColor: asColor(config.textColor, DEFAULT_DESIGN_CHART.textColor), backgroundColor: asColor(config.backgroundColor, DEFAULT_DESIGN_CHART.backgroundColor),
    gridColor: asColor(config.gridColor, DEFAULT_DESIGN_CHART.gridColor), headingFont: asText(config.headingFont, asText(config.fontFamily, DEFAULT_DESIGN_CHART.headingFont)), fontFamily: asText(config.fontFamily, DEFAULT_DESIGN_CHART.fontFamily),
    fontSize: asSize(config.fontSize, DEFAULT_DESIGN_CHART.fontSize), showGrid: config.showGrid !== false, showLegend: typeof config.showLegend === 'boolean' ? config.showLegend : variant === 'design-chart-pie',
  };
}

function DataHeading({ config: c }: { config: DesignTableConfig | DesignChartConfig }) {
  useDesignFont(c.headingFont);
  return <header style={{ marginBottom: 30 }}>
    {c.heading && <h2 style={{ fontFamily: c.headingFont, fontSize: c.fontSize * 1.8, fontWeight: 500, lineHeight: 1.1, letterSpacing: '-0.025em', margin: 0, overflowWrap: 'anywhere' }}>{c.heading}</h2>}
    {c.caption && <p style={{ margin: '16px 0 0', fontSize: c.fontSize * 0.85, lineHeight: 1.25, overflowWrap: 'anywhere' }}>{c.caption}</p>}
  </header>;
}

export function DesignTableWidget({ config = {} }: ThemeWidgetProps) {
  const c = useMemo(() => readDesignTableConfig(config || {}), [config]);
  useDesignFont(c.fontFamily);
  const compact = c.rows.length > 5;
  return <DesignElementStage background={c.backgroundColor}><section data-design-data="table" aria-label={c.heading || 'Data table'} style={{ boxSizing: 'border-box', width: '100%', height: '100%', overflow: 'auto', padding: 48, background: c.backgroundColor, color: c.textColor, fontFamily: c.fontFamily }}>
    <DataHeading config={c} />
    {c.columns.length === 0 ? <p role="status" style={{ fontSize: c.fontSize }}>Add a column to begin this table.</p> :
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', color: c.textColor, fontFamily: c.fontFamily, fontSize: c.fontSize, lineHeight: 1.2, textAlign: c.alignment }}>
        <thead><tr>{c.columns.map((column, i) => <th key={i} scope="col" style={{ background: c.headerColor, borderTop: `3px solid ${c.textColor}`, borderBottom: `2px solid ${c.borderColor}`, fontSize: c.fontSize * .85, fontWeight: 650, padding: compact ? '8px 24px' : '24px', overflowWrap: 'anywhere' }}>{column || `Column ${i + 1}`}</th>)}</tr></thead>
        <tbody>{c.rows.map((row, ri) => <tr key={ri}>{c.columns.map((_, ci) => <td key={ci} style={{ background: c.backgroundColor, borderBottom: `${ri === c.rows.length - 1 ? 2 : 1}px solid ${c.borderColor}`, padding: compact ? '5px 24px' : '28px 24px', fontWeight: ci === 0 ? 550 : 400, verticalAlign: 'top', overflowWrap: 'anywhere' }}>{row[ci] ?? ''}</td>)}</tr>)}</tbody>
      </table>}
  </section></DesignElementStage>;
}

function pieSegments(rows: DesignChartDatum[]) {
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  if (rows.some((row) => row.value < 0)) return { total, invalid: 'Pie charts need values of zero or more. Change the chart type to bar or line to show negative values.' };
  if (total <= 0) return { total, invalid: 'Add a positive value to draw this pie chart.' };
  let angle = -90;
  const segments = rows.map((row) => {
    const start = angle;
    angle += (row.value / total) * 360;
    const end = angle;
    const point = (a: number) => [50 + 45 * Math.cos(a * Math.PI / 180), 50 + 45 * Math.sin(a * Math.PI / 180)];
    const [sx, sy] = point(start); const [ex, ey] = point(end);
    const large = end - start > 180 ? 1 : 0;
    return { ...row, path: row.value === total ? '' : `M 50 50 L ${sx} ${sy} A 45 45 0 ${large} 1 ${ex} ${ey} Z` };
  });
  return { total, segments };
}

/** Labels and marks share the same categorical cell centers. */
export function chartPointX(index: number, count: number) { return 220 + (index + .5) / Math.max(1, count) * 1284; }
const axisNumber = (value: number) => Math.abs(value) >= 1000 ? new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value) : String(Math.round(value * 10) / 10);

export function DesignChartWidget({ config = {} }: ThemeWidgetProps) {
  const c = useMemo(() => readDesignChartConfig(config || {}), [config]);
  useDesignFont(c.fontFamily);
  const values = c.rows.map(r => r.value);
  const min = Math.min(0, ...values), max = Math.max(0, ...values), span = max - min || 1;
  const zeroPct = -min / span * 100;
  const pie = c.variant === 'design-chart-pie' ? pieSegments(c.rows) : null;
  const y = (value: number) => 306 - (value - min) / span * 256;
  const ticks = max === min ? [0] : min < 0 && max > 0 ? [min, 0, max] : [min, min + span / 2, max];
  const legend = <ul aria-label="Chart values" style={{ listStyle: 'none', padding: '24px 0 0', borderTop: `1px solid ${c.gridColor}`, margin: '24px 0 0', fontSize: c.fontSize * .85, lineHeight: 1.3, display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', columnGap: 32, rowGap: 16 }}>{c.rows.map((r, i) => <li key={i} style={{ display: 'grid', gridTemplateColumns: '18px minmax(0,1fr)', columnGap: 14, alignItems: 'baseline', overflowWrap: 'anywhere' }}><span aria-hidden="true" style={{ width: 18, height: 18, background: r.color }} /><span>{r.label}: {r.value}</span></li>)}</ul>;
  return <DesignElementStage background={c.backgroundColor}><section data-design-data="chart" aria-label={c.heading || 'Data chart'} style={{ boxSizing: 'border-box', width: '100%', height: '100%', overflow: 'auto', padding: 48, background: c.backgroundColor, color: c.textColor, fontFamily: c.fontFamily }}>
    <DataHeading config={c} />
    {c.rows.length === 0 ? <p role="status" style={{ fontSize: c.fontSize }}>Add a data row to begin this chart.</p> : pie?.invalid ? <p role="status" style={{ fontSize: c.fontSize, lineHeight: 1.3 }}>{pie.invalid}</p> : c.variant === 'design-chart-pie' && pie ?
      <div style={{ display: 'grid', gridTemplateColumns: c.showLegend ? 'minmax(0,1fr) minmax(0,1fr)' : '1fr', columnGap: 64, alignItems: 'center', height: c.caption ? 560 : 620 }}>
        <svg role="img" aria-label={`Pie chart: ${c.rows.map(r => `${r.label || 'Unlabeled'} ${r.value}`).join(', ')}`} viewBox="0 0 100 100" style={{ width: '100%', height: '100%' }}>
          {(pie.segments ?? []).filter(segment => segment.value > 0).map((segment, i) => segment.path ? <path key={i} d={segment.path} fill={segment.color} stroke={c.backgroundColor} strokeWidth="1.2" /> : <circle key={i} cx="50" cy="50" r="45" fill={segment.color} />)}
        </svg>
        {c.showLegend && <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: c.fontSize, lineHeight: 1.25 }}>{c.rows.map((r,i) => <li key={i} style={{ display: 'grid', gridTemplateColumns: '24px minmax(0,1fr) auto', columnGap: 20, alignItems: 'baseline', padding: '16px 0', borderBottom: `1px solid ${c.gridColor}` }}><span aria-hidden="true" style={{ width: 24, height: 24, background: r.color }}/><span style={{ overflowWrap: 'anywhere' }}>{r.label}<span style={{ display: 'block', fontSize: c.fontSize * .85, marginTop: 4 }}>{Math.round(r.value / pie.total * 100)}%</span></span><strong>{r.value}</strong></li>)}</ul>}
      </div> : c.variant === 'design-chart-line' ? <div>
        <svg role="img" aria-label={`Line chart: ${c.rows.map(r => `${r.label || 'Unlabeled'} ${r.value}`).join(', ')}`} viewBox="0 0 1504 360" style={{ display: 'block', width: '100%', height: 360 }}>
          {ticks.map(tick => <g key={tick}><text x="198" y={y(tick)} dy=".35em" textAnchor="end" fill={c.textColor} fontSize={c.fontSize * .85}>{axisNumber(tick)}</text>{(c.showGrid || tick === 0) && <line x1="220" x2="1504" y1={y(tick)} y2={y(tick)} stroke={tick === 0 ? c.textColor : c.gridColor} strokeWidth={tick === 0 ? 2 : 1}/>}</g>)}
          <polyline points={c.rows.map((r,i) => `${chartPointX(i,c.rows.length)},${y(r.value)}`).join(' ')} fill="none" stroke={c.rows[0]?.color || '#285c52'} strokeWidth="7" strokeLinejoin="round" strokeLinecap="round"/>
          {c.rows.map((r,i) => <circle key={i} data-chart-point={i} cx={chartPointX(i,c.rows.length)} cy={y(r.value)} r="11" fill={r.color} stroke={c.backgroundColor} strokeWidth="4"/>)}
        </svg>
        <div style={{ marginLeft: 220, display: 'grid', gridTemplateColumns: `repeat(${Math.max(1,c.rows.length)},minmax(0,1fr))`, textAlign: 'center', fontSize: c.fontSize * .85, lineHeight: 1.25 }}>{c.rows.map((r,i) => <div key={i} data-chart-label={i} style={{ padding: '0 10px', overflowWrap: 'anywhere' }}><span>{r.label}</span><strong style={{ display: 'block', fontSize: c.fontSize, marginTop: 10 }}>{r.value}</strong></div>)}</div>
      </div> : <div style={{ paddingTop: 12 }}>
        {c.rows.map((r,i) => { const width = Math.abs(r.value) / span * 100; const left = r.value < 0 ? zeroPct - width : zeroPct; return <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.05fr) minmax(0,3fr) 180px', columnGap: 32, alignItems: 'center', marginBottom: 22, fontSize: c.fontSize, lineHeight: 1.2 }}>
          <span style={{ overflowWrap: 'anywhere' }}>{r.label || `Item ${i+1}`}</span>
          <span aria-hidden="true" style={{ position: 'relative', height: 78, minWidth: 0 }}>
            {c.showGrid && [0,25,50,75,100].map(x => <i key={x} style={{ position: 'absolute', top: 0, height: '100%', left: `${x}%`, borderLeft: `1px solid ${c.gridColor}` }}/>)}
            <i style={{ position: 'absolute', top: 10, height: 58, left: `${left}%`, width: `${width}%`, background: r.color, minWidth: r.value === 0 ? 2 : undefined }}/>
            <i style={{ position: 'absolute', top: 0, height: '100%', left: `${zeroPct}%`, borderLeft: `2px solid ${c.textColor}` }}/>
          </span><strong style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.value}</strong>
        </div>; })}
        <div aria-label="Value axis" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.05fr) minmax(0,3fr) 180px', columnGap: 32, fontSize: c.fontSize * .85 }}><span/><div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{axisNumber(min)}</span><span>{axisNumber(max)}</span></div></div>
      </div>}
    {c.showLegend && c.variant !== 'design-chart-pie' && !pie?.invalid && c.rows.length > 0 && legend}
  </section></DesignElementStage>;
}
