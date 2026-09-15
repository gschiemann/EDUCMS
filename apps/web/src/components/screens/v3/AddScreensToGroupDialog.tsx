'use client';

/**
 * "Add screens to <group>" — pick existing screens (unassigned first, then
 * the ones sitting in other groups) and move them into this group. One
 * PUT /screens/:id per screen, the same call the drawer's Group select makes.
 * 2026-09-14 (Greg): "have an option to add a screen where I can pick from
 * the ones in other groups or unassigned."
 */
import { useEffect, useMemo, useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import { useUpdateScreen } from '@/hooks/use-api';
import type { OpsScreen } from './screenOps';

export function AddScreensToGroupDialog({
  group,
  screens,
  onClose,
  onAdded,
}: {
  group: { id: string; name: string };
  /** Every screen the operator can see; the ones already in `group` are hidden. */
  screens: OpsScreen[];
  onClose: () => void;
  onAdded: (count: number) => void;
}) {
  const updateScreen = useUpdateScreen();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Unassigned first, then by current group name; the target group's own screens never show.
  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    const candidates = screens.filter((s) => (s.screenGroupId ?? null) !== group.id && (!q || (s.name ?? '').toLowerCase().includes(q)));
    const by = new Map<string, { title: string; items: OpsScreen[] }>();
    for (const s of candidates) {
      const key = s.screenGroupId ?? '';
      const title = s.screenGroupId ? (s.screenGroup?.name ?? 'Another group') : 'Not in a group';
      const sec = by.get(key) ?? { title, items: [] };
      sec.items.push(s); by.set(key, sec);
    }
    return [...by.entries()]
      .sort(([a, sa], [b, sb]) => (a === '' ? -1 : b === '' ? 1 : sa.title.localeCompare(sb.title)))
      .map(([, sec]) => ({ ...sec, items: sec.items.slice().sort((x, y) => (x.name ?? '').localeCompare(y.name ?? '')) }));
  }, [screens, group.id, query]);

  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const submit = async () => {
    if (picked.size === 0 || busy) return;
    setBusy(true); setError(null);
    let done = 0;
    try {
      for (const id of picked) {
        await updateScreen.mutateAsync({ id, screenGroupId: group.id });
        done += 1;
      }
      onAdded(done);
      onClose();
    } catch (e) {
      setError(`${done} of ${picked.size} moved. ${e instanceof Error ? e.message : 'The rest did not.'}`);
    } finally {
      setBusy(false);
    }
  };

  const total = sections.reduce((n, s) => n + s.items.length, 0);

  return (
    <div role="dialog" aria-modal="true" aria-label={`Add screens to ${group.name}`} className="fixed top-0 right-0 bottom-0 left-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <button type="button" aria-label="Close dialog" onClick={onClose} className="absolute top-0 right-0 bottom-0 left-0 cursor-default" />
      <div className="relative w-full max-w-lg bg-white rounded-2xl border border-slate-200 shadow-2xl flex flex-col max-h-[85vh]">
        <div className="px-5 pt-4 pb-3 flex items-start gap-3 border-b border-slate-100">
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-black text-slate-900">Add screens to “{group.name}”</h2>
            <p className="text-[12px] font-semibold text-slate-500 mt-0.5">Pick from screens not in a group or in another group. They move here; nothing else changes.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close dialog" className="w-9 h-9 -mt-1 -mr-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center">
            <X className="w-4 h-4" aria-hidden />
          </button>
        </div>
        <div className="px-5 py-2.5 border-b border-slate-100">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" aria-hidden />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a screen by name"
              aria-label="Find a screen by name"
              className="w-full h-10 pl-9 pr-3 rounded-xl border border-slate-200 text-sm font-medium outline-none focus:ring-2 focus:ring-indigo-300"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {total === 0 ? (
            <p className="px-3 py-8 text-center text-sm font-semibold text-slate-400">
              {query ? 'No screen matches that name.' : 'Every screen is already in this group.'}
            </p>
          ) : sections.map((sec) => (
            <div key={sec.title} className="mb-2">
              <p className="px-3 pt-2 pb-1 text-[10.5px] font-bold uppercase tracking-wider text-slate-400">{sec.title} · {sec.items.length}</p>
              {sec.items.map((s) => (
                <label key={s.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={picked.has(s.id)}
                    onChange={() => toggle(s.id)}
                    aria-label={`Add ${s.name ?? 'screen'}`}
                    className="w-4 h-4 rounded border-slate-300"
                  />
                  <span className="min-w-0 flex-1 text-[13px] font-semibold text-slate-800 truncate">{s.name ?? 'Unnamed screen'}</span>
                  <span className={`text-[11px] font-bold ${s.status === 'ONLINE' ? 'text-emerald-600' : 'text-slate-400'}`}>{s.status === 'ONLINE' ? 'Online' : 'Offline'}</span>
                </label>
              ))}
            </div>
          ))}
        </div>
        <div className="px-5 py-3 border-t border-slate-100 flex items-center gap-2">
          {error && <p role="alert" className="text-[12px] font-semibold text-rose-600 flex-1 min-w-0">{error}</p>}
          <button type="button" onClick={onClose} className="ml-auto h-10 px-3 text-sm font-bold text-slate-500 hover:text-slate-700">Cancel</button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={picked.size === 0 || busy}
            className="h-10 px-4 rounded-xl text-white text-sm font-bold disabled:opacity-50 flex items-center gap-2"
            style={{ background: 'var(--brand-primary, #4f46e5)' }}
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-label="Moving" /> : `Add ${picked.size || ''} screen${picked.size === 1 ? '' : 's'}`.replace('  ', ' ')}
          </button>
        </div>
      </div>
    </div>
  );
}
