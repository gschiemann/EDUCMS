"use client";

import { useEffect, useRef, useState, type ComponentType } from 'react';
import { isFromDocumentFrame } from '@/lib/board-message-source';

export type DirectoryLocation = { id: string; name: string; suite: string; [key: string]: unknown };
export type DirectoryDocument = {
  format: 'arc-riot.directory'; version: 1; designId: string; orientation: string;
  dataset: { title: string; tenants: DirectoryLocation[]; [key: string]: unknown };
  playback: Record<string, unknown>; theme: Record<string, unknown>;
};
type TextProps = { label: string; value: string; placeholder?: string; onChange: (value: string) => void };
type NumberProps = { id: string; label: string; value: number; min?: number; max?: number; step?: number; onChange: (value: number) => void };
type SelectProps = { label: string; value: string; options: [string, string][]; onChange: (value: string) => void };
type ListProps = { label: string; itemNoun?: string; value: unknown; compact?: boolean; onItemFocus?: (id: string) => void; onChange: (rows: Record<string, unknown>[]) => void; fields: Array<{ key: string; label: string; type?: 'text'; maxLength?: number }>; makeNewItem?: () => Record<string, unknown> };
/** These are the existing PropertiesPanel controls, supplied without a circular import. */
export type DirectoryControls = { Text: ComponentType<TextProps>; Number: ComponentType<NumberProps>; Select: ComponentType<SelectProps>; List: ComponentType<ListProps> };
const COPY_LABELS: Record<string, string> = {
  brandLabel: 'Directory label', locationLabel: 'Location label', title: 'Building name', subtitle: 'Address or subtitle',
  tagline: 'Welcome message', directoryHeading: 'List heading', footer: 'Footer text', statusLabel: 'Footer note',
  imageCaption: 'Photo caption', pageLabel: 'Page label', rangeLabel: 'List range label', emptyLabel: 'Empty directory message',
  nameColumnLabel: 'Name column label', suiteLabel: 'Suite column label',
};
const TRANSITIONS: [string, string][] = [['crossfade', 'Fade'], ['flip', 'Flip'], ['slide', 'Slide'], ['vertical-scroll', 'Scroll up'], ['continuous-scroll', 'Continuous scroll']];
const SPEEDS: [string, string][] = [['slow', 'Slow'], ['normal', 'Normal'], ['fast', 'Fast']];
const LIMIT = 500;

function documentFromConfig(cfg: Record<string, unknown>): DirectoryDocument {
  const document = cfg.directoryDocument as DirectoryDocument;
  const overrides = cfg.textOverrides;
  if (!overrides || typeof overrides !== 'object') return document;
  const text = overrides as Record<string, unknown>;
  const dataset = { ...document.dataset };
  for (const key of Object.keys(COPY_LABELS)) if (typeof text['property.' + key] === 'string') dataset[key] = text['property.' + key];
  dataset.tenants = dataset.tenants.map(row => {
    const next = { ...row };
    for (const key of ['name', 'suite']) if (typeof text[`tenant.${row.id}.${key}`] === 'string') next[key] = text[`tenant.${row.id}.${key}`] as string;
    return next;
  });
  return { ...document, dataset };
}

export function parseDirectoryLocations(text: string): DirectoryLocation[] {
  const delimiter = text.includes('\t') ? '\t' : ',';
  const rows: string[][] = []; let row: string[] = [], value = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted; }
    else if (c === delimiter && !quoted) { row.push(value); value = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) { if (c === '\r' && text[i + 1] === '\n') i++; row.push(value); if (row.some(v => v.trim())) rows.push(row); row = []; value = ''; }
    else value += c;
  }
  if (quoted) throw new Error('Check the quotation marks in your list.');
  row.push(value); if (row.some(v => v.trim())) rows.push(row);
  let name = 0, suite = 1;
  const headers = rows[0]?.map(v => v.trim().toLowerCase()) || [];
  if (headers.some(v => ['name', 'tenant', 'company', 'destination'].includes(v))) {
    name = headers.findIndex(v => ['name', 'tenant', 'company', 'destination'].includes(v));
    suite = headers.findIndex(v => ['suite', 'room', 'location', 'unit'].includes(v)); rows.shift();
  }
  if (!rows.length) throw new Error('Paste at least one location.');
  return rows.map((r, i) => {
    const location = { id: crypto.randomUUID(), name: (r[name] || '').trim(), suite: (r[suite] || '').trim() };
    if (!location.name || location.name.length > 180 || location.suite.length > 16) throw new Error(`Check the name and suite on line ${i + 1}.`);
    return location;
  });
}

export function DirectoryBoardEditor({ cfg, setField, controls }: {
  cfg: Record<string, unknown>; setField: (patch: Record<string, unknown>) => void; controls: DirectoryControls;
}) {
  const root = useRef<HTMLElement>(null);
  const latest = useRef({ cfg, setField });
  useEffect(() => { latest.current = { cfg, setField }; }, [cfg, setField]);
  const [selectedCopy, setSelectedCopy] = useState<{ key: string; fallback: string } | null>(null);
  const [copyAreas, setCopyAreas] = useState<Record<string, string>>({});
  const [paste, setPaste] = useState(''); const [pasteOpen, setPasteOpen] = useState(false); const [error, setError] = useState('');
  const doc = documentFromConfig(cfg);
  const { Text, Number: NumberField, Select, List } = controls;
  const playback = doc.playback || {};
  const mode = playback.displayMode === 'pages' ? 'pages' : 'single';
  const pageSize = Math.max(1, Math.min(LIMIT, Math.round(Number(playback.locationsPerPage) || 24)));
  const count = doc.dataset.tenants.filter(row => row.active !== false && row.name.trim()).length;
  const pages = mode === 'single' ? 1 : Math.max(1, Math.ceil(count / pageSize));
  const transition = String(playback.transitionMode || 'crossfade');
  const speed = String(playback.motionSpeed || 'normal');

  function commit(document: DirectoryDocument) {
    const previous = latest.current.cfg.textOverrides;
    const text = { ...(previous && typeof previous === 'object' ? previous : {}) } as Record<string, unknown>;
    // The complete document owns its copy; a stale generic override must not repaint it.
    Object.keys(text).forEach(key => { if (key === 'directory.payload' || key.startsWith('property.') || key.startsWith('tenant.')) delete text[key]; });
    latest.current.setField({ directoryDocument: document, contentChanged: true, textOverrides: text });
  }
  function focusLocation(id: string) {
    document.querySelectorAll<HTMLIFrameElement>('iframe[src*="/templates/signage/corporate/directory/"]').forEach(frame => frame.contentWindow?.postMessage({ type: 'arc-directory-focus-location', id }, '*'));
  }
  function updatePlayback(patch: Record<string, unknown>) {
    const current = documentFromConfig(latest.current.cfg);
    commit({ ...current, playback: { ...current.playback, displayMode: mode, locationsPerPage: pageSize, motionSpeed: speed, autoplay: true, paused: false, pageDurationsMs: [], ...patch } });
  }
  function updateCopy(key: string, value: string) {
    const current = documentFromConfig(latest.current.cfg);
    commit({ ...current, dataset: { ...current.dataset, [key]: value } });
  }
  function importLocations(replace: boolean) {
    try {
      const current = documentFromConfig(latest.current.cfg);
      const rows = parseDirectoryLocations(paste);
      if (rows.length + (replace ? 0 : current.dataset.tenants.length) > LIMIT) throw new Error('Use up to 500 locations.');
      commit({ ...current, dataset: { ...current.dataset, tenants: replace ? rows : [...current.dataset.tenants, ...rows] } });
      setPaste(''); setPasteOpen(false); setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Check your list.'); }
  }

  useEffect(() => {
    function select(event: MessageEvent) {
      const message = event.data;
      if (!isFromDocumentFrame(event) || !message) return;
      if (message.type === 'arc-directory-status' && message.designId === (latest.current.cfg.directoryDocument as DirectoryDocument).designId && message.copy && typeof message.copy === 'object') {
        const copy: Record<string, string> = {};
        for (const [key, value] of Object.entries(message.copy)) if (Object.prototype.hasOwnProperty.call(COPY_LABELS, key) && typeof value === 'string') copy[key] = value;
        setCopyAreas(old => JSON.stringify(old) === JSON.stringify(copy) ? old : copy);
        return;
      }
      if (!['arc-directory-select', 'educms-field-click'].includes(message.type) || typeof message.key !== 'string') return;
      const tenant = /^tenant\.(.+)\.(name|suite)$/.exec(message.key);
      if (tenant) {
        requestAnimationFrame(() => {
          const row = [...(root.current?.querySelectorAll<HTMLElement>('[data-list-id]') || [])].find(node => node.dataset.listId === tenant[1]);
          const input = [...(row?.querySelectorAll<HTMLInputElement>('[data-list-field]') || [])].find(node => node.dataset.listField === tenant[2]);
          input?.focus(); input?.scrollIntoView({ block: 'nearest' });
        });
      } else if (message.key.startsWith('property.')) {
        const key = message.key.slice(9);
        if (key === 'title') root.current?.querySelector<HTMLInputElement>('[data-directory-title] input')?.focus();
        else if (Object.prototype.hasOwnProperty.call(COPY_LABELS, key)) setSelectedCopy(old => old && old.key === key && (typeof message.text !== 'string' || old.fallback === message.text) ? old : { key, fallback: typeof message.text === 'string' ? message.text : '' });
      }
    }
    window.addEventListener('message', select);
    document.querySelectorAll<HTMLIFrameElement>('iframe[src*="/templates/signage/corporate/directory/"]').forEach(frame => frame.contentWindow?.postMessage({ type: 'arc-directory-request-status' }, '*'));
    return () => window.removeEventListener('message', select);
  }, []);

  return (
    <section ref={root} className="space-y-4" aria-label="Directory settings">
      <div data-directory-title><Text label="Building name" value={doc.dataset.title} onChange={v => updateCopy('title', v)} /></div>
      <p className="text-[11px] leading-relaxed text-slate-500">Click any wording on the preview to edit it.</p>
      {!!Object.keys(copyAreas).length && <button type="button" className="text-xs font-semibold text-indigo-600" onClick={() => { const key = Object.keys(copyAreas).find(k => k !== 'title') || 'title'; setSelectedCopy({ key, fallback: copyAreas[key] }); }}>Edit other text</button>}
      {selectedCopy && <div className="space-y-2 rounded-lg border border-indigo-200 bg-indigo-50/40 p-3">
        {!!Object.keys(copyAreas).length && <Select label="Text area" value={selectedCopy.key} options={Object.keys(copyAreas).filter(key => key !== 'title').map(key => [key, COPY_LABELS[key]] as [string, string])} onChange={key => setSelectedCopy({ key, fallback: copyAreas[key] })} />}
        <Text label={COPY_LABELS[selectedCopy.key]} value={typeof doc.dataset[selectedCopy.key] === 'string' ? doc.dataset[selectedCopy.key] as string : copyAreas[selectedCopy.key] ?? selectedCopy.fallback} onChange={v => updateCopy(selectedCopy.key, v)} />
        {['pageLabel', 'rangeLabel'].includes(selectedCopy.key) && typeof doc.dataset[selectedCopy.key] === 'string' && <button type="button" className="mr-3 text-xs font-semibold text-slate-600" onClick={() => { const dataset = { ...doc.dataset }; delete dataset[selectedCopy.key]; commit({ ...doc, dataset }); }}>Use automatic label</button>}
        <button type="button" className="text-xs font-semibold text-indigo-600" onClick={() => setSelectedCopy(null)}>Done</button>
      </div>}
      <Select label="Display" value={mode} options={[[ 'single', 'Fit everything on one screen' ], [ 'pages', 'Create pages automatically' ]]} onChange={v => updatePlayback({ displayMode: v })} />
      {mode === 'pages' && <div className="space-y-3">
        <NumberField id="directory-page-size" label="Locations per page" value={pageSize} min={1} max={LIMIT} onChange={v => updatePlayback({ locationsPerPage: Math.round(v) })} />
        <Select label="Transition" value={transition} options={TRANSITIONS} onChange={v => updatePlayback({ transitionMode: v })} />
        {transition !== 'continuous-scroll' && <NumberField id="directory-page-seconds" label="Change pages every (seconds)" value={Number(playback.pageDurationMs || 14000) / 1000} min={3} max={120} onChange={v => updatePlayback({ pageDurationMs: v * 1000 })} />}
        <Select label={transition === 'continuous-scroll' ? 'Scroll speed' : 'Transition speed'} value={speed} options={SPEEDS} onChange={v => updatePlayback({ motionSpeed: v })} />
      </div>}
      <p className="text-[11px] font-medium text-slate-600" role="status">{count} locations · {mode === 'single' ? '1 screen' : `${pages} ${pages === 1 ? 'page' : 'pages'}`} · text fits automatically</p>
      <List label="Locations" itemNoun="location" compact onItemFocus={focusLocation} value={doc.dataset.tenants} fields={[{ key: 'name', label: 'Name', maxLength: 180 }, { key: 'suite', label: 'Suite / room', maxLength: 16 }]} makeNewItem={() => ({ id: crypto.randomUUID(), name: '', suite: '' })} onChange={rows => {
        if (rows.length > LIMIT) { setError('Use up to 500 locations in this directory.'); return; }
        commit({ ...doc, dataset: { ...doc.dataset, tenants: rows as DirectoryLocation[] } });
        if (rows.length === doc.dataset.tenants.length + 1) requestAnimationFrame(() => {
          const id = String(rows.at(-1)?.id || '');
          const row = [...(root.current?.querySelectorAll<HTMLElement>('[data-list-id]') || [])].find(node => node.dataset.listId === id);
          const input = row?.querySelector<HTMLInputElement>('input'); input?.focus(); input?.scrollIntoView({ block: 'nearest' });
        });
      }} />
      <button type="button" className="text-xs font-semibold text-indigo-600" onClick={() => setPasteOpen(!pasteOpen)}>{pasteOpen ? 'Close list import' : 'Paste a list from Excel'}</button>
      {pasteOpen && <div className="space-y-2">
        <label className="block text-[11px] text-slate-600">Name and suite, one location per line<textarea aria-label="Paste locations" rows={5} value={paste} onChange={e => setPaste(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-xs" /></label>
        <div className="flex gap-3"><button type="button" className="text-xs font-semibold text-indigo-600" onClick={() => importLocations(false)}>Add locations</button><button type="button" className="text-xs font-semibold text-slate-600" onClick={() => importLocations(true)}>Replace list</button></div>
      </div>}
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
      {!!doc.dataset.sourceStatus && <p className="text-[11px] text-amber-700">This tenant list still needs source review.</p>}
    </section>
  );
}
