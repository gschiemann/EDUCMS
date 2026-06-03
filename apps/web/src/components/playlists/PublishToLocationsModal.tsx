"use client";

/**
 * PublishToLocationsModal — Phase 2c. Corporate picks a playlist + screens
 * across ALL its locations, and publishes: the playlist (and its assets) is
 * copied down into each chosen location and scheduled live on the picked
 * screens there. Self-contained (own hooks) so the 3k-line playlists page only
 * needs a single mount + a button.
 *
 * Renders only meaningfully for a parent tenant (fleet has >1 location).
 * Dashboard surface → CSS gap/inset fine here.
 */

import { useMemo, useState } from 'react';
import { X, Loader2, Send, CheckCircle2, Wifi, WifiOff, Building2, MonitorCheck } from 'lucide-react';
import { useFleet, usePlaylists, usePublishToFleet, type PublishToFleetResult } from '@/hooks/use-api';
import { useQueryClient } from '@tanstack/react-query';

export function PublishToLocationsModal({
  open,
  onClose,
  initialPlaylistId,
}: {
  open: boolean;
  onClose: () => void;
  initialPlaylistId?: string;
}) {
  const qc = useQueryClient();
  const fleet = useFleet({ enabled: open });
  const { data: playlists } = usePlaylists();
  const publish = usePublishToFleet();

  const [playlistId, setPlaylistId] = useState<string>(initialPlaylistId ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<PublishToFleetResult | null>(null);

  const rootId = fleet.data?.root?.id;
  // Group the fleet's screens by location (exclude HQ-own unless it has screens).
  const byStore = useMemo(() => {
    const m = new Map<string, { id: string; name: string; screens: Array<{ id: string; name: string; status: string }> }>();
    for (const loc of fleet.data?.locations ?? []) m.set(loc.id, { id: loc.id, name: loc.name, screens: [] });
    for (const s of fleet.data?.screens ?? []) {
      if (!s.sourceTenant) continue;
      const e = m.get(s.sourceTenant.id);
      if (e) e.screens.push({ id: s.id, name: s.name, status: s.status });
    }
    return Array.from(m.values())
      .filter((e) => e.screens.length > 0)
      .sort((a, b) => (a.id === rootId ? -1 : b.id === rootId ? 1 : a.name.localeCompare(b.name)));
  }, [fleet.data, rootId]);

  if (!open) return null;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const toggleStore = (storeScreens: Array<{ id: string }>) =>
    setSelected((prev) => {
      const n = new Set(prev);
      const allOn = storeScreens.every((s) => n.has(s.id));
      storeScreens.forEach((s) => (allOn ? n.delete(s.id) : n.add(s.id)));
      return n;
    });

  const canPublish = !!playlistId && selected.size > 0 && !publish.isPending;

  const doPublish = async () => {
    if (!canPublish) return;
    const res = await publish.mutateAsync({ playlistId, screenIds: Array.from(selected) });
    setResult(res);
    // Each location got a fresh schedule; invalidate so any open views refresh.
    qc.invalidateQueries({ queryKey: ['schedules'] });
    qc.invalidateQueries({ queryKey: ['screens', 'fleet'] });
  };

  const close = () => {
    setResult(null);
    setSelected(new Set());
    publish.reset();
    onClose();
  };

  return (
    <div className="fixed top-0 right-0 bottom-0 left-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={close}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100">
          <Building2 className="w-5 h-5" style={{ color: 'var(--brand-primary, #4f46e5)' }} />
          <h2 className="text-base font-black text-slate-800 flex-1">Publish to locations</h2>
          <button onClick={close} aria-label="Close" className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"><X className="w-5 h-5" /></button>
        </div>

        {result ? (
          /* ─── Result summary ─── */
          <div className="p-5 overflow-y-auto">
            <div className="flex items-center gap-2 text-emerald-700 mb-3">
              <CheckCircle2 className="w-5 h-5" />
              <span className="font-bold">Published to {result.totalLocations} location{result.totalLocations === 1 ? '' : 's'} · {result.totalScreens} screen{result.totalScreens === 1 ? '' : 's'}</span>
            </div>
            <div className="space-y-1.5">
              {result.perLocation.map((l) => (
                <div key={l.tenantId} className="flex items-center justify-between text-sm rounded-lg border border-slate-200 px-3 py-2">
                  <span className="font-medium text-slate-700">{l.tenantName}{l.isParent && <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">HQ</span>}</span>
                  <span className="text-slate-500 text-xs inline-flex items-center gap-1"><MonitorCheck className="w-3.5 h-3.5 text-emerald-600" /> {l.screensScheduled} screen{l.screensScheduled === 1 ? '' : 's'} · copy {l.isParent ? 'scheduled' : 'delivered'}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-400 mt-3">Each location now has its own copy of this playlist, scheduled live. Re-publishing updates the copy in place.</p>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => { setResult(null); }} className="px-4 py-2 text-sm font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">Publish more</button>
              <button onClick={close} className="px-4 py-2 text-sm font-bold rounded-lg text-white" style={{ background: 'var(--brand-primary, #4f46e5)' }}>Done</button>
            </div>
          </div>
        ) : (
          /* ─── Picker ─── */
          <>
            <div className="p-5 overflow-y-auto space-y-4">
              {/* Playlist picker */}
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Playlist to publish</label>
                <select
                  value={playlistId}
                  onChange={(e) => setPlaylistId(e.target.value)}
                  className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white outline-none focus:border-slate-400"
                >
                  <option value="">— Choose a playlist —</option>
                  {(playlists ?? []).filter((p: any) => !p.isProtected).map((p: any) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              {/* Screen picker grouped by location */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Screens across your locations</label>
                  <span className="text-xs text-slate-500">{selected.size} selected</span>
                </div>
                {fleet.isLoading ? (
                  <div className="py-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
                ) : byStore.length === 0 ? (
                  <p className="text-sm text-slate-500 py-6 text-center">No locations with screens found.</p>
                ) : (
                  <div className="space-y-2">
                    {byStore.map((store) => {
                      const allOn = store.screens.every((s) => selected.has(s.id));
                      return (
                        <div key={store.id} className="rounded-xl border border-slate-200">
                          <button onClick={() => toggleStore(store.screens)} className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-50 rounded-t-xl">
                            <input type="checkbox" readOnly checked={allOn} className="accent-current" style={{ accentColor: 'var(--brand-primary, #4f46e5)' }} />
                            <span className="font-bold text-sm text-slate-700 flex-1">{store.name}{store.id === rootId && <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">HQ</span>}</span>
                            <span className="text-xs text-slate-400">{store.screens.length} screen{store.screens.length === 1 ? '' : 's'}</span>
                          </button>
                          <div className="px-3 pb-2 flex flex-wrap gap-1.5">
                            {store.screens.map((s) => {
                              const on = selected.has(s.id);
                              return (
                                <button
                                  key={s.id}
                                  onClick={() => toggle(s.id)}
                                  className={`text-[11px] px-2 py-1 rounded-full border inline-flex items-center gap-1 transition-colors ${on ? 'text-white border-transparent' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
                                  style={on ? { background: 'var(--brand-primary, #4f46e5)' } : undefined}
                                >
                                  {s.status === 'ONLINE' ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3 opacity-60" />}
                                  {s.name}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {publish.isError && (
                <p className="text-sm text-rose-600">{(publish.error as any)?.message || 'Publish failed.'}</p>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between gap-2 px-5 py-4 border-t border-slate-100">
              <span className="text-xs text-slate-400">Copies the playlist into each location + schedules it live.</span>
              <button
                onClick={doPublish}
                disabled={!canPublish}
                className="px-4 py-2 text-sm font-bold rounded-lg text-white inline-flex items-center gap-2 disabled:opacity-50"
                style={{ background: 'var(--brand-primary, #4f46e5)' }}
              >
                {publish.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Publish to {selected.size || ''} screen{selected.size === 1 ? '' : 's'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
