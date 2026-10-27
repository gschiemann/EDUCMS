"use client";

import { useEffect, useRef, useState, type ComponentType } from 'react';
import { isFromDocumentFrame } from '@/lib/board-message-source';
import { useBuilderStore } from './useBuilderStore';

export type DirectoryLocation = { id: string; name: string; suite: string; [key: string]: unknown };
export type DirectoryDocument = {
  format: 'arc-riot.directory'; version: 1; designId: string; orientation: string;
  dataset: { title: string; tenants: DirectoryLocation[]; [key: string]: unknown };
  playback: Record<string, unknown>; theme: Record<string, unknown>;
};
type TextProps = { label: string; value: string; placeholder?: string; onChange: (value: string) => void; onFocus?: () => void };
type NumberProps = { id: string; label: string; value: number; min?: number; max?: number; step?: number; onChange: (value: number) => void };
type SelectProps = { label: string; value: string; options: [string, string][]; onChange: (value: string) => void };
type ListProps = { label: string; itemNoun?: string; value: unknown; compact?: boolean; onItemFocus?: (id: string) => void; onChange: (rows: Record<string, unknown>[]) => void; fields: Array<{ key: string; label: string; type?: 'text'; maxLength?: number }>; makeNewItem?: () => Record<string, unknown> };
/** These are the existing PropertiesPanel controls, supplied without a circular import. */
export type DirectoryControls = { Text: ComponentType<TextProps>; Number: ComponentType<NumberProps>; Select: ComponentType<SelectProps>; List: ComponentType<ListProps> };
const COPY_LABELS: Record<string, string> = {
  brandLabel: 'Top left label', locationLabel: 'Top right label', title: 'Building name', subtitle: 'Address or subtitle',
  tagline: 'Welcome message', directoryHeading: 'List heading', footer: 'Footer text', statusLabel: 'Footer note',
  imageCaption: 'Photo caption', pageLabel: 'Page label', rangeLabel: 'List range label', emptyLabel: 'Empty directory message',
  nameColumnLabel: 'Name column label', suiteLabel: 'Suite column label',
};
const TRANSITIONS: [string, string][] = [['crossfade', 'Fade'], ['flip', 'Flip'], ['slide', 'Slide left'], ['slide-right', 'Slide right'], ['vertical-scroll', 'Scroll up'], ['vertical-scroll-down', 'Scroll down'], ['continuous-scroll', 'Continuous scroll up'], ['continuous-scroll-down', 'Continuous scroll down']];
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

export function DirectoryBoardEditor({ cfg, setField, controls, zoneId }: {
  zoneId: string; cfg: Record<string, unknown>; setField: (patch: Record<string, unknown>) => void; controls: DirectoryControls;
}) {
  const root = useRef<HTMLElement>(null);
  const latest = useRef({ cfg, setField, zoneId });
  useEffect(() => { latest.current = { cfg, setField, zoneId }; }, [cfg, setField, zoneId]);
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
  const continuous = transition.startsWith('continuous-scroll');
  const seconds = Math.max(3, Math.min(120, Number(playback.pageDurationMs || 14000) / 1000));
  const transitionLabel = TRANSITIONS.find(([value]) => value === transition)?.[1] || 'Fade';

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
      if (event.source !== window && latest.current.zoneId) {
        const frame = Array.from(document.querySelectorAll<HTMLIFrameElement>('[data-zone-id] iframe')).find(frame => frame.contentWindow === event.source);
        if (frame?.closest<HTMLElement>('[data-zone-id]')?.dataset.zoneId !== latest.current.zoneId) return;
      }
      if (['educms-media-select', 'educms-field-click'].includes(message.type) && message.key === 'property.hero') {
        document.querySelector<HTMLElement>('[data-edit-img="property.hero"]')?.scrollIntoView({ block: 'nearest' });
        return;
      }
      if (message.type === 'arc-directory-status' && message.designId === (latest.current.cfg.directoryDocument as DirectoryDocument).designId && message.copy && typeof message.copy === 'object') {
        const copy: Record<string, string> = {};
        for (const [key, value] of Object.entries(message.copy)) if (Object.prototype.hasOwnProperty.call(COPY_LABELS, key) && typeof value === 'string') copy[key] = value;
        setCopyAreas(old => JSON.stringify(old) === JSON.stringify(copy) ? old : copy);
        return;
      }
      if (message.type === 'arc-directory-text-change' && (useBuilderStore.getState().previewMode || useBuilderStore.getState().zones.find(zone => zone.id === latest.current.zoneId)?.locked)) return;
      if (message.type === 'arc-directory-text-change' && typeof message.key === 'string' && typeof message.value === 'string') {
        const current = documentFromConfig(latest.current.cfg);
        const tenant = /^tenant\.(.+)\.(name|suite)$/.exec(message.key);
        if (tenant && current.dataset.tenants.some(row => row.id === tenant[1]) && message.value.length <= (tenant[2] === 'suite' ? 16 : 180)) {
          commit({ ...current, dataset: { ...current.dataset, tenants: current.dataset.tenants.map(row => row.id === tenant[1] ? { ...row, [tenant[2]]: message.value } : row) } });
        } else if (message.key.startsWith('property.') && Object.prototype.hasOwnProperty.call(COPY_LABELS, message.key.slice(9)) && message.value.length <= 1200) updateCopy(message.key.slice(9), message.value);
        return;
      }
      if (!['arc-directory-select', 'educms-field-click'].includes(message.type) || typeof message.key !== 'string') return;
      if (latest.current.zoneId) { useBuilderStore.getState().select(latest.current.zoneId); useBuilderStore.getState().setActiveFieldName(message.key); }
      const tenant = /^tenant\.(.+)\.(name|suite)$/.exec(message.key);
      if (tenant && !message.inline) {
        requestAnimationFrame(() => {
          const row = [...(root.current?.querySelectorAll<HTMLElement>('[data-list-id]') || [])].find(node => node.dataset.listId === tenant[1]);
          const input = [...(row?.querySelectorAll<HTMLInputElement>('[data-list-field]') || [])].find(node => node.dataset.listField === tenant[2]);
          input?.focus(); input?.scrollIntoView({ block: 'nearest' });
        });
      } else if (message.key.startsWith('property.')) {
        const key = message.key.slice(9);
        if (Object.prototype.hasOwnProperty.call(COPY_LABELS, key)) setCopyAreas(old => ({ ...old, [key]: typeof message.text === 'string' ? message.text : old[key] || '' }));
        if (key === 'title' && !message.inline) root.current?.querySelector<HTMLInputElement>('[data-directory-title] input')?.focus();
        else if (Object.prototype.hasOwnProperty.call(COPY_LABELS, key)) setSelectedCopy(old => old && old.key === key && (typeof message.text !== 'string' || old.fallback === message.text) ? old : { key, fallback: typeof message.text === 'string' ? message.text : '' });
      }
    }
    window.addEventListener('message', select);
    document.querySelectorAll<HTMLIFrameElement>('iframe[src*="/templates/signage/corporate/directory/"]').forEach(frame => frame.contentWindow?.postMessage({ type: 'arc-directory-request-status' }, '*'));
    return () => window.removeEventListener('message', select);
  }, []);

  useEffect(() => {
    setCopyAreas({}); setSelectedCopy(null);
    document.querySelectorAll<HTMLIFrameElement>('[data-zone-id] iframe').forEach(frame => {
      if (frame.closest<HTMLElement>('[data-zone-id]')?.dataset.zoneId === zoneId) frame.contentWindow?.postMessage({type:'arc-directory-request-status'}, '*');
    });
  }, [zoneId]);

  const selectedKey = selectedCopy && Object.prototype.hasOwnProperty.call(copyAreas, selectedCopy.key) ? selectedCopy.key : Object.keys(copyAreas).find(key => key !== 'title') || 'brandLabel';
  function selectText(key: string) { setSelectedCopy({ key, fallback: copyAreas[key] || '' }); if (zoneId) { useBuilderStore.getState().select(zoneId); useBuilderStore.getState().setActiveFieldName('property.' + key); } }

  return (
    <section ref={root} className="space-y-4" aria-label="Directory settings" onFocusCapture={event => {
      const input = event.target as HTMLElement;
      const row = input.closest<HTMLElement>('[data-list-id]');
      const field = input.getAttribute('data-list-field');
      if (zoneId && row && ['name', 'suite'].includes(field || '')) useBuilderStore.getState().setActiveFieldName(`tenant.${row.dataset.listId}.${field}`);
    }}>
      <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3" role="group" aria-label="Pages and rotation">
      <h3 className="text-xs font-semibold text-slate-700">Pages &amp; rotation</h3>
      <Select label="Sort by" value={playback.sort === 'suite' ? 'suite' : 'name'} options={[['name', 'Company name'], ['suite', 'Suite number']]} onChange={sort => updatePlayback({ sort })} />
      <Select label="Display" value={mode} options={[[ 'single', 'Fit everything on one screen' ], [ 'pages', 'Create pages automatically' ]]} onChange={v => updatePlayback({ displayMode: v })} />
      {mode === 'single' && count > 1 && <button type="button" className="text-xs font-semibold text-indigo-600" onClick={() => updatePlayback({ displayMode: 'pages', locationsPerPage: Math.ceil(count / 2) })}>Make 2 pages</button>}
      <div className="space-y-3">
        {mode === 'pages' && <NumberField id="directory-page-size" label="Locations per page" value={pageSize} min={1} max={LIMIT} onChange={v => updatePlayback({ locationsPerPage: Math.round(v) })} />}
        <Select label="Transition" value={transition} options={TRANSITIONS} onChange={v => updatePlayback({ transitionMode: v })} />
        <NumberField id="directory-page-seconds" label="Seconds per page" value={seconds} min={3} max={120} onChange={v => updatePlayback({ pageDurationMs: v * 1000 })} />
        {!continuous && <Select label="Transition speed" value={speed} options={SPEEDS} onChange={v => updatePlayback({ motionSpeed: v })} />}
      </div>
      <p className="text-[11px] font-medium leading-relaxed text-slate-600" role="status">{count} locations · {mode === 'single' ? '1 screen' : `${pages} ${pages === 1 ? 'page' : 'pages'}`} · {transitionLabel}{` · ${seconds} sec/page`} · text fits automatically</p>
      <p className="text-[11px] leading-relaxed text-slate-500">{mode === 'single' ? 'Rotation settings are saved now and play when you use multiple pages.' : continuous ? 'Seconds per page sets how long each page takes to scroll. Use Preview to watch it.' : 'More locations create more pages automatically. Use Preview to watch the rotation.'}</p>
      </div>
      <div data-directory-title><Text label="Building name" value={doc.dataset.title} onFocus={() => { if (zoneId) useBuilderStore.getState().setActiveFieldName('property.title'); }} onChange={v => updateCopy('title', v)} /></div>
      <p className="text-[11px] leading-relaxed text-slate-500">Click text to type on the canvas, or edit it here. The bottom toolbar changes the selected text's style.</p>
      {!!Object.keys(copyAreas).length && <div className="space-y-2" data-directory-copy>
        <Select label="Text area" value={selectedKey} options={Object.keys(copyAreas).filter(key => key !== 'title').map(key => [key, COPY_LABELS[key]] as [string, string])} onChange={selectText} />
        <Text key={selectedKey} label={COPY_LABELS[selectedKey]} value={typeof doc.dataset[selectedKey] === 'string' ? doc.dataset[selectedKey] as string : copyAreas[selectedKey] ?? selectedCopy?.fallback ?? ''} onFocus={() => selectText(selectedKey)} onChange={v => updateCopy(selectedKey, v)} />
        {['pageLabel', 'rangeLabel'].includes(selectedKey) && typeof doc.dataset[selectedKey] === 'string' && <button type="button" className="text-xs font-semibold text-slate-600" onClick={() => { const dataset = { ...doc.dataset }; delete dataset[selectedKey]; commit({ ...doc, dataset }); }}>Use automatic label</button>}
      </div>}
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
