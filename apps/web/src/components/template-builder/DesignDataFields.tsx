"use client";

import React from 'react';
import { DATA_CHART_MAX_ROWS, DATA_TABLE_MAX_COLUMNS, DATA_TABLE_MAX_ROWS, DEFAULT_DESIGN_CHART, DEFAULT_DESIGN_TABLE, readDesignChartConfig, readDesignTableConfig } from '@/components/widgets/DesignDataWidgets';

type Props = { config: Record<string, unknown>; onChange: (patch: Record<string, unknown>) => void; renderFontPicker?: (props: { label: string; value: string; onChange: (font: string) => void }) => React.ReactNode };
const fieldStyle: React.CSSProperties = { display: 'grid', gap: 5, marginBottom: 12, fontSize: 12, color: '#475569' };
const inputStyle: React.CSSProperties = { boxSizing: 'border-box', width: '100%', minHeight: 34, padding: '7px 9px', border: '1px solid #cbd5e1', borderRadius: 6, background: '#ffffff', color: '#0f172a', font: 'inherit' };
const buttonStyle: React.CSSProperties = { minHeight: 32, padding: '5px 9px', border: '1px solid #cbd5e1', borderRadius: 6, background: '#f8fafc', color: '#334155', cursor: 'pointer', fontSize: 12 };

function TextInput({ label, value, onChange, type = 'text', min, max }: { label: string; value: string | number; onChange: (value: string) => void; type?: string; min?: number; max?: number }) {
  return <label style={fieldStyle}>{label}<input aria-label={label} type={type} min={min} max={max} value={value} onChange={(e) => onChange(e.target.value)} style={inputStyle} /></label>;
}
function ColorInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <label style={fieldStyle}>{label}<span style={{ display: 'flex', gap: 8 }}><input aria-label={label} type="color" value={/^#[\da-f]{6}$/i.test(value) ? value : '#ffffff'} onChange={(e) => onChange(e.target.value)} style={{ width: 46, height: 34 }} /><input aria-label={`${label} value`} value={value} onChange={(e) => onChange(e.target.value)} style={inputStyle} /></span></label>;
}

export function DesignDataFields({ config, onChange, renderFontPicker }: Props) {
  const variant = String(config.variant || '');
  if (variant === 'design-table') {
    const c = readDesignTableConfig(config);
    const patch = (p: Record<string, unknown>) => onChange(p);
    const setColumn = (index: number, value: string) => patch({ columns: c.columns.map((item, i) => i === index ? value : item) });
    const setCell = (ri: number, ci: number, value: string) => patch({ rows: c.rows.map((row, i) => i === ri ? c.columns.map((_, j) => j === ci ? value : (row[j] ?? '')) : row) });
    const addColumn = () => { if (c.columns.length < DATA_TABLE_MAX_COLUMNS) patch({ columns: [...c.columns, `Column ${c.columns.length + 1}`], rows: c.rows.map(row => [...row, '']) }); };
    const removeColumn = (index: number) => patch({ columns: c.columns.filter((_, i) => i !== index), rows: c.rows.map(row => row.filter((_, i) => i !== index)) });
    const addRow = () => { if (c.rows.length < DATA_TABLE_MAX_ROWS) patch({ rows: [...c.rows, c.columns.map(() => '')] }); };
    const removeRow = (index: number) => patch({ rows: c.rows.filter((_, i) => i !== index) });
    return <section aria-label="Table content">
      <TextInput label="Heading" value={c.heading} onChange={heading => patch({ heading })} />
      <TextInput label="Caption" value={c.caption} onChange={caption => patch({ caption })} />
      <div style={{ fontWeight: 700, margin: '16px 0 8px' }}>Columns ({c.columns.length}/{DATA_TABLE_MAX_COLUMNS})</div>
      {c.columns.length > DATA_TABLE_MAX_COLUMNS && <p role="status">This saved table has more columns than the editor can add. All columns are preserved; remove columns to return within the supported limit.</p>}
      {c.columns.map((column, ci) => <div key={ci} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 6, alignItems: 'end' }}>
        <TextInput label={`Column ${ci + 1} heading`} value={column} onChange={v => setColumn(ci, v)} />
        <button type="button" style={{ ...buttonStyle, marginBottom: 12 }} onClick={() => removeColumn(ci)} aria-label={`Remove column ${ci + 1}`}>Remove</button>
      </div>)}
      <button type="button" style={buttonStyle} disabled={c.columns.length >= DATA_TABLE_MAX_COLUMNS} onClick={addColumn}>Add column</button>
      <div style={{ fontWeight: 700, margin: '18px 0 8px' }}>Rows ({c.rows.length}/{DATA_TABLE_MAX_ROWS})</div>
      {c.rows.length > DATA_TABLE_MAX_ROWS && <p role="status">This saved table has more rows than the editor can add. All rows are preserved; remove rows to return within the supported limit.</p>}
      {c.rows.map((row, ri) => <fieldset key={ri} style={{ border: '1px solid #e2e8f0', borderRadius: 7, padding: 9, margin: '0 0 10px' }}>
        <legend>Row {ri + 1}</legend>
        {c.columns.map((_, ci) => <TextInput key={ci} label={`${c.columns[ci] || `Column ${ci + 1}`} · row ${ri + 1}`} value={row[ci] ?? ''} onChange={v => setCell(ri, ci, v)} />)}
        <button type="button" style={buttonStyle} aria-label={`Remove row ${ri + 1}`} onClick={() => removeRow(ri)}>Remove row</button>
      </fieldset>)}
      <button type="button" style={buttonStyle} disabled={c.rows.length >= DATA_TABLE_MAX_ROWS} onClick={addRow}>Add row</button>
      <div style={{ fontWeight: 700, margin: '18px 0 8px' }}>Appearance</div>
      <ColorInput label="Text color" value={c.textColor} onChange={textColor => patch({ textColor })} />
      <ColorInput label="Header background" value={c.headerColor} onChange={headerColor => patch({ headerColor })} />
      <ColorInput label="Cell background" value={c.backgroundColor} onChange={backgroundColor => patch({ backgroundColor })} />
      <ColorInput label="Border color" value={c.borderColor} onChange={borderColor => patch({ borderColor })} />
      {renderFontPicker ? renderFontPicker({ label: "Font family", value: c.fontFamily, onChange: fontFamily => patch({ fontFamily }) }) : <TextInput label="Font family" value={c.fontFamily} onChange={fontFamily => patch({ fontFamily })} />}
      {renderFontPicker ? renderFontPicker({ label: "Heading font", value: c.headingFont, onChange: headingFont => patch({ headingFont }) }) : <TextInput label="Heading font" value={c.headingFont} onChange={headingFont => patch({ headingFont })} />}
      <TextInput label="Text size (px)" type="number" min={12} max={160} value={c.fontSize} onChange={v => patch({ fontSize: Math.max(12, Math.min(160, Number(v) || DEFAULT_DESIGN_TABLE.fontSize)) })} />
      <label style={fieldStyle}>Text alignment<select aria-label="Text alignment" value={c.alignment} onChange={e => patch({ alignment: e.target.value })} style={inputStyle}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label>
    </section>;
  }
  if (variant.startsWith('design-chart-')) {
    const c = readDesignChartConfig(config);
    const patch = (p: Record<string, unknown>) => onChange(p);
    const setRow = (index: number, value: Partial<typeof c.rows[number]>) => patch({ rows: c.rows.map((row, i) => i === index ? { ...row, ...value } : row) });
    const addRow = () => { if (c.rows.length < DATA_CHART_MAX_ROWS) patch({ rows: [...c.rows, { label: `Item ${c.rows.length + 1}`, value: 0, color: DEFAULT_DESIGN_CHART.rows[c.rows.length % DEFAULT_DESIGN_CHART.rows.length].color }] }); };
    const removeRow = (index: number) => patch({ rows: c.rows.filter((_, i) => i !== index) });
    const negativePie = c.variant === 'design-chart-pie' && c.rows.some(row => row.value < 0);
    return <section aria-label="Chart content">
      <TextInput label="Heading" value={c.heading} onChange={heading => patch({ heading })} />
      <TextInput label="Caption" value={c.caption} onChange={caption => patch({ caption })} />
      <label style={fieldStyle}>Chart type<select aria-label="Chart type" value={c.variant} onChange={e => patch({ variant: e.target.value })} style={inputStyle}><option value="design-chart-bar">Bar</option><option value="design-chart-line">Line</option><option value="design-chart-pie">Pie</option></select></label>
      {c.rows.length > DATA_CHART_MAX_ROWS && <p role="status">This saved chart has more than {DATA_CHART_MAX_ROWS} rows. All rows are preserved; remove rows to return within the supported limit.</p>}
      {negativePie && <p role="status">Pie charts only support values of zero or more. Choose bar or line to keep the negative values visible.</p>}
      <div style={{ fontWeight: 700, margin: '16px 0 8px' }}>Data rows ({c.rows.length}/{DATA_CHART_MAX_ROWS})</div>
      {c.rows.map((row, i) => <fieldset key={i} style={{ border: '1px solid #e2e8f0', borderRadius: 7, padding: 9, margin: '0 0 10px' }}>
        <legend>Data row {i + 1}</legend>
        <TextInput label={`Label · row ${i + 1}`} value={row.label} onChange={label => setRow(i, { label })} />
        <TextInput label={`Value · row ${i + 1}`} type="number" value={row.value} onChange={v => setRow(i, { value: Number(v) })} />
        <ColorInput label={`Color · row ${i + 1}`} value={row.color} onChange={color => setRow(i, { color })} />
        <button type="button" style={buttonStyle} aria-label={`Remove data row ${i + 1}`} onClick={() => removeRow(i)}>Remove row</button>
      </fieldset>)}
      <button type="button" style={buttonStyle} disabled={c.rows.length >= DATA_CHART_MAX_ROWS} onClick={addRow}>Add data row</button>
      <div style={{ fontWeight: 700, margin: '18px 0 8px' }}>Appearance</div>
      <ColorInput label="Text color" value={c.textColor} onChange={textColor => patch({ textColor })} />
      <ColorInput label="Background" value={c.backgroundColor} onChange={backgroundColor => patch({ backgroundColor })} />
      {c.variant !== 'design-chart-pie' && <ColorInput label="Grid color" value={c.gridColor} onChange={gridColor => patch({ gridColor })} />}
      {renderFontPicker ? renderFontPicker({ label: "Font family", value: c.fontFamily, onChange: fontFamily => patch({ fontFamily }) }) : <TextInput label="Font family" value={c.fontFamily} onChange={fontFamily => patch({ fontFamily })} />}
      {renderFontPicker ? renderFontPicker({ label: "Heading font", value: c.headingFont, onChange: headingFont => patch({ headingFont }) }) : <TextInput label="Heading font" value={c.headingFont} onChange={headingFont => patch({ headingFont })} />}
      <TextInput label="Text size (px)" type="number" min={12} max={160} value={c.fontSize} onChange={v => patch({ fontSize: Math.max(12, Math.min(160, Number(v) || DEFAULT_DESIGN_CHART.fontSize)) })} />
      {c.variant !== 'design-chart-pie' && <label style={{ ...fieldStyle, display: 'flex', alignItems: 'center' }}><input aria-label="Show grid" type="checkbox" checked={c.showGrid} onChange={e => patch({ showGrid: e.target.checked })} />Show grid</label>}
      <label style={{ ...fieldStyle, display: 'flex', alignItems: 'center' }}><input aria-label="Show legend" type="checkbox" checked={c.showLegend} onChange={e => patch({ showLegend: e.target.checked })} />Show legend</label>
    </section>;
  }
  return null;
}
