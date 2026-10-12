"use client";

import React, { useMemo } from 'react';
import type { ThemeWidgetProps } from './themes/registry';

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
  fontSize: number;
  showGrid: boolean;
  showLegend: boolean;
}

const DEFAULT_COLUMNS = ['Category', 'Value', 'Notes'];
const DEFAULT_ROWS = [
  ['Enrollment', '1,240', 'Updated this term'],
  ['Attendance', '96%', 'School average'],
  ['Clubs', '18', 'Student-led'],
];
const DEFAULT_CHART_ROWS: DesignChartDatum[] = [
  { label: 'Mon', value: 42, color: '#2563eb' },
  { label: 'Tue', value: 58, color: '#0f766e' },
  { label: 'Wed', value: 35, color: '#d97706' },
  { label: 'Thu', value: 71, color: '#7c3aed' },
];

export const DEFAULT_DESIGN_TABLE: DesignTableConfig = {
  variant: 'design-table', heading: 'School snapshot', caption: '', columns: DEFAULT_COLUMNS,
  rows: DEFAULT_ROWS, textColor: '#172033', headerColor: '#e8eef8',
  backgroundColor: '#ffffff', borderColor: '#aab6c8', fontFamily: 'Arial, sans-serif',
  fontSize: 28, alignment: 'left',
};
export const DEFAULT_DESIGN_CHART: DesignChartConfig = {
  variant: 'design-chart-bar', heading: 'Weekly progress', caption: '', rows: DEFAULT_CHART_ROWS,
  textColor: '#172033', backgroundColor: '#ffffff', gridColor: '#cbd5e1',
  fontFamily: 'Arial, sans-serif', fontSize: 26, showGrid: true, showLegend: true,
};

const asText = (v: unknown, fallback = '') => typeof v === 'string' ? v : fallback;
const asColor = (v: unknown, fallback: string) => typeof v === 'string' && /^(#[\da-f]{3,8}|rgba?\([^)]*\)|[a-z]+)$/i.test(v.trim()) ? v : fallback;
const asSize = (v: unknown, fallback: number) => typeof v === 'number' && Number.isFinite(v) ? Math.max(12, Math.min(160, v)) : fallback;

export function readDesignTableConfig(config: Record<string, unknown> = {}): DesignTableConfig {
  const columns = Array.isArray(config.columns) ? config.columns.map((x) => asText(x)) : DEFAULT_COLUMNS.slice();
  const rows = Array.isArray(config.rows) ? config.rows.map((row) => Array.isArray(row) ? row.map((x) => asText(x)) : []) : DEFAULT_ROWS.map((r) => r.slice());
  return {
    variant: 'design-table', heading: asText(config.heading, DEFAULT_DESIGN_TABLE.heading), caption: asText(config.caption),
    columns, rows, textColor: asColor(config.textColor, DEFAULT_DESIGN_TABLE.textColor),
    headerColor: asColor(config.headerColor, DEFAULT_DESIGN_TABLE.headerColor),
    backgroundColor: asColor(config.backgroundColor, DEFAULT_DESIGN_TABLE.backgroundColor),
    borderColor: asColor(config.borderColor, DEFAULT_DESIGN_TABLE.borderColor),
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
    gridColor: asColor(config.gridColor, DEFAULT_DESIGN_CHART.gridColor), fontFamily: asText(config.fontFamily, DEFAULT_DESIGN_CHART.fontFamily),
    fontSize: asSize(config.fontSize, DEFAULT_DESIGN_CHART.fontSize), showGrid: config.showGrid !== false, showLegend: config.showLegend !== false,
  };
}

function useBoxHeight(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = React.useRef<HTMLDivElement>(null);
  const [height, setHeight] = React.useState(360);
  React.useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setHeight(Math.max(160, entry.contentRect.height)));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, height];
}

export function DesignTableWidget({ config = {} }: ThemeWidgetProps) {
  const c = useMemo(() => readDesignTableConfig(config || {}), [config]);
  const [ref] = useBoxHeight();
  const table = <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', color: c.textColor, fontFamily: c.fontFamily, fontSize: `${c.fontSize}px`, textAlign: c.alignment }}>
    <thead><tr>{c.columns.map((column, i) => <th key={i} scope="col" style={{ background: c.headerColor, border: `1px solid ${c.borderColor}`, padding: '0.55em', overflowWrap: 'anywhere' }}>{column || `Column ${i + 1}`}</th>)}</tr></thead>
    <tbody>{c.rows.map((row, ri) => <tr key={ri}>{c.columns.map((_, ci) => <td key={ci} style={{ background: c.backgroundColor, border: `1px solid ${c.borderColor}`, padding: '0.5em', overflowWrap: 'anywhere' }}>{row[ci] ?? ''}</td>)}</tr>)}</tbody>
  </table>;
  return <section ref={ref} aria-label={c.heading || 'Data table'} style={{ boxSizing: 'border-box', width: '100%', height: '100%', overflow: 'auto', padding: '2.5%', background: c.backgroundColor, color: c.textColor, fontFamily: c.fontFamily }}>
    {c.heading && <h2 style={{ fontSize: `clamp(18px, ${Math.min(c.fontSize * 1.45, 64)}px, 7vh)`, lineHeight: 1.15, margin: '0 0 0.2em', overflowWrap: 'anywhere' }}>{c.heading}</h2>}
    {c.caption && <p style={{ margin: '0 0 0.7em', fontSize: `${c.fontSize * 0.72}px`, overflowWrap: 'anywhere' }}>{c.caption}</p>}
    {c.columns.length === 0 ? <p role="status">Add a column to begin this table.</p> : table}
  </section>;
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

export function DesignChartWidget({ config = {} }: ThemeWidgetProps) {
  const c = useMemo(() => readDesignChartConfig(config || {}), [config]);
  const [ref, boxHeight] = useBoxHeight();
  const values = c.rows.map((r) => r.value);
  const min = Math.min(0, ...values); const max = Math.max(0, ...values);
  const span = max - min || 1;
  const zeroPct = (0 - min) / span * 100;
  const pie = c.variant === 'design-chart-pie' ? pieSegments(c.rows) : null;
  const linePoints = c.rows.map((row, i) => `${c.rows.length < 2 ? 50 : i / (c.rows.length - 1) * 100},${100 - ((row.value - min) / span * 86 + 7)}`).join(' ');
  const labelSize = `${c.fontSize}px`;
  return <section ref={ref} aria-label={c.heading || 'Data chart'} style={{ boxSizing: 'border-box', width: '100%', height: '100%', overflow: 'auto', padding: '2.5%', background: c.backgroundColor, color: c.textColor, fontFamily: c.fontFamily }}>
    {c.heading && <h2 style={{ fontSize: `clamp(18px, ${Math.min(c.fontSize * 1.45, boxHeight * 0.16)}px, 7vh)`, lineHeight: 1.15, margin: '0 0 0.2em', overflowWrap: 'anywhere' }}>{c.heading}</h2>}
    {c.caption && <p style={{ margin: '0 0 0.5em', fontSize: `${c.fontSize * 0.72}px`, overflowWrap: 'anywhere' }}>{c.caption}</p>}
    {c.rows.length === 0 ? <p role="status">Add a data row to begin this chart.</p> : pie?.invalid ? <p role="status">{pie.invalid}</p> : c.variant === 'design-chart-pie' && pie ? <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: '1em', minHeight: '65%' }}>
      <svg role="img" aria-label={`Pie chart: ${c.rows.map((r) => `${r.label || 'Unlabeled'} ${r.value}`).join(', ')}`} viewBox="0 0 100 100" style={{ width: 'min(58%, 42vh)', maxHeight: '100%', aspectRatio: '1', flex: '0 1 260px' }}>
        {pie.segments.map((segment, i) => segment.path ? <path key={i} d={segment.path} fill={segment.color} stroke={c.backgroundColor} strokeWidth="1" /> : <circle key={i} cx="50" cy="50" r="45" fill={segment.color} />)}
      </svg>
      {c.showLegend && <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: labelSize }}>{c.rows.map((row, i) => <li key={i} style={{ display: 'flex', gap: '0.45em', alignItems: 'baseline', marginBottom: '0.3em', overflowWrap: 'anywhere' }}><span aria-hidden="true" style={{ display: 'inline-block', width: '0.75em', height: '0.75em', background: row.color, flex: '0 0 auto' }} />{row.label}: {row.value} ({pie.total ? Math.round(row.value / pie.total * 100) : 0}%)</li>)}</ul>}
    </div> : c.variant === 'design-chart-line' ? <div style={{ minHeight: '68%', display: 'flex', flexDirection: 'column' }}>
      <svg role="img" aria-label={`Line chart: ${c.rows.map((r) => `${r.label || 'Unlabeled'} ${r.value}`).join(', ')}`} viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', flex: 1, minHeight: 100, overflow: 'visible' }}>
        {c.showGrid && [20, 40, 60, 80].map(y => <line key={y} x1="0" x2="100" y1={y} y2={y} stroke={c.gridColor} strokeDasharray="1 2" />)}
        <line x1="0" x2="100" y1={100 - zeroPct} y2={100 - zeroPct} stroke={c.gridColor} />
        <polyline points={linePoints} fill="none" stroke={c.rows[0]?.color || '#2563eb'} strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
        {c.rows.map((row, i) => <circle key={i} cx={c.rows.length < 2 ? 50 : i / (c.rows.length - 1) * 100} cy={100 - ((row.value - min) / span * 86 + 7)} r="1.7" fill={row.color} />)}
      </svg>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, c.rows.length)}, minmax(0,1fr))`, gap: 4, fontSize: labelSize, textAlign: 'center' }}>{c.rows.map((r, i) => <div key={i} style={{ overflowWrap: 'anywhere' }}>{r.label}<br />{r.value}</div>)}</div>
    </div> : <div style={{ display: 'grid', gap: '0.5em', alignContent: 'center', minHeight: '68%' }}>
      {c.rows.map((row, i) => {
        const width = Math.abs(row.value) / span * 100;
        const left = row.value < 0 ? zeroPct - width : zeroPct;
        return <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(4em, 1.1fr) minmax(3em, 3fr) auto', alignItems: 'center', gap: '0.65em', fontSize: labelSize }}>
          <span style={{ overflowWrap: 'anywhere' }}>{row.label || `Item ${i + 1}`}</span>
          <span aria-hidden="true" style={{ position: 'relative', height: '1.5em', borderBottom: c.showGrid ? `1px solid ${c.gridColor}` : undefined, minWidth: 0 }}>
            {c.showGrid && [25, 50, 75].map(x => <i key={x} style={{ position: 'absolute', top: 0, bottom: 0, left: `${x}%`, borderLeft: `1px dashed ${c.gridColor}` }} />)}
            <i style={{ position: 'absolute', left: `${left}%`, width: `${width}%`, top: '15%', height: '70%', background: row.color, minWidth: row.value === 0 ? 2 : undefined }} />
            <i style={{ position: 'absolute', left: `${zeroPct}%`, top: 0, bottom: 0, borderLeft: `2px solid ${c.textColor}` }} />
          </span>
          <strong>{row.value}</strong>
        </div>;
      })}
    </div>}
    {c.showLegend && c.variant !== 'design-chart-pie' && <ul aria-label="Chart values" style={{ listStyle: 'none', padding: 0, margin: '0.4em 0 0', fontSize: `${c.fontSize * 0.62}px`, display: 'flex', flexWrap: 'wrap', gap: '0.35em 1em' }}>{c.rows.map((r, i) => <li key={i} style={{ display: 'flex', gap: '0.35em', alignItems: 'baseline', overflowWrap: 'anywhere' }}><span aria-hidden="true" style={{ display: 'inline-block', width: '0.7em', height: '0.7em', background: r.color }} />{r.label}: {r.value}</li>)}</ul>}
  </section>;
}
