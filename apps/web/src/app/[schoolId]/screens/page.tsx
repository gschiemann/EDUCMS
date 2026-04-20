"use client";

import { MonitorPlay, Plus, Loader2, Trash2, MapPin, MonitorCheck, Wifi, WifiOff, X, Smartphone, Monitor, Laptop, Tv, Globe, Clock, ExternalLink, QrCode, Map as MapIcon, List as ListIcon } from 'lucide-react';
import { useScreenGroups, useCreateScreenGroup, useDeleteScreenGroup, useDeleteScreen, useUpdateScreen, useScreens, useUpdateScreenLocation } from '@/hooks/use-api';
import { useState, useRef, useEffect, useMemo } from 'react';
import { ScreenMapClient } from '@/components/screens/ScreenMapClient';
import { appPrompt } from '@/components/ui/app-dialog';
import { apiFetch } from '@/lib/api-client';
import QRCode from 'qrcode';
import { appConfirm } from '@/components/ui/app-dialog';

// OS-shape icon colored by CURRENT screen status (not OS type). Previously
// we used emerald for Android, sky for Windows, amber for Linux — which
// meant a Windows laptop showed a blue icon while its status pill was
// green, and a Linux kiosk showed a red-ish amber icon while the status
// dot glowed green. Operators read the color mismatch as "something's
// wrong". Making icon color mirror liveStatus kills the confusion: green
// dot → green icon, slate dot → slate icon.
function OsIcon({ os, status }: { os?: string; status?: string }) {
  const colorCls =
    status === 'ONLINE' ? 'text-emerald-500'
    : status === 'PENDING' ? 'text-amber-500'
    : 'text-slate-400';
  const cls = `w-4 h-4 ${colorCls}`;
  if (!os) return <Monitor className={cls} />;
  const l = os.toLowerCase();
  if (l.includes('android')) return <Smartphone className={cls} />;
  if (l.includes('ios') || l.includes('mac')) return <Laptop className={cls} />;
  if (l.includes('windows')) return <Monitor className={cls} />;
  if (l.includes('linux') || l.includes('chrome os')) return <Tv className={cls} />;
  return <Monitor className={cls} />;
}

export default function ScreensPage() {
  const { data: groups, isLoading, refetch } = useScreenGroups();
  const { data: allScreens, refetch: refetchScreens } = useScreens();
  // Sprint 8 — fleet map view. Toggle persists in URL via search param so a
  // bookmarked map link still opens the map.
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');
  const updateLocation = useUpdateScreenLocation();
  const flatScreens = useMemo(() => (allScreens || []) as any[], [allScreens]);

  const handleSetLocation = async (screenId: string, screenName: string, currentAddress?: string | null) => {
    const address = await appPrompt({
      title: `Where is "${screenName}"?`,
      message: 'Type the building address or paste a street address. We auto-geocode via OpenStreetMap so the screen drops on the fleet map.',
      defaultValue: currentAddress || '',
    });
    if (address === null) return; // cancelled
    updateLocation.mutate({ id: screenId, address: address || null });
  };
  const createGroup = useCreateScreenGroup();
  const deleteGroup = useDeleteScreenGroup();
  const deleteScreen = useDeleteScreen();
  const updateScreen = useUpdateScreen();

  // Screens not assigned to any group
  const ungroupedScreens = (allScreens || []).filter((s: any) => !s.screenGroupId);

  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [showPairModal, setShowPairModal] = useState(false);
  const [pairGroupId, setPairGroupId] = useState<string>('');
  const [pairCode, setPairCode] = useState('');
  const [pairName, setPairName] = useState('');
  const [pairing, setPairing] = useState(false);
  const [pairError, setPairError] = useState('');
  const [editingScreen, setEditingScreen] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [showQrForScan, setShowQrForScan] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');

  // Generate a QR encoding the pairing code (or a deep-link to /pair?code=) so
  // a phone pointed at this modal can scan and complete pairing.
  useEffect(() => {
    if (!showQrForScan || !pairCode.trim()) { setQrDataUrl(''); return; }
    const payload = typeof window !== 'undefined'
      ? `${window.location.origin}/pair?code=${encodeURIComponent(pairCode.trim().toUpperCase())}`
      : pairCode.trim().toUpperCase();
    QRCode.toDataURL(payload, { width: 220, margin: 1 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(''));
  }, [showQrForScan, pairCode]);
  const newGroupInputRef = useRef<HTMLInputElement>(null);
  const pairCodeInputRef = useRef<HTMLInputElement>(null);
  const editNameInputRef = useRef<HTMLInputElement>(null);

  // Focus new-group name input when the form opens
  useEffect(() => {
    if (showCreateGroup) newGroupInputRef.current?.focus();
  }, [showCreateGroup]);

  // Focus pairing code input when the modal opens
  useEffect(() => {
    if (showPairModal) pairCodeInputRef.current?.focus();
  }, [showPairModal]);

  // Focus the inline rename input when a screen enters edit mode
  useEffect(() => {
    if (editingScreen) editNameInputRef.current?.focus();
  }, [editingScreen]);

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) return;
    await createGroup.mutateAsync({ name: newGroupName });
    setNewGroupName('');
    setShowCreateGroup(false);
  };

  const handlePairScreen = async () => {
    if (!pairCode.trim()) return;
    setPairing(true);
    setPairError('');
    try {
      await apiFetch('/screens/pair', {
        method: 'POST',
        body: JSON.stringify({
          pairingCode: pairCode.trim().toUpperCase(),
          name: pairName.trim() || undefined,
          screenGroupId: pairGroupId || undefined,
        }),
      });
      setShowPairModal(false);
      setPairCode('');
      setPairName('');
      setPairGroupId('');
      refetch();
      refetchScreens();
    } catch (e: any) {
      setPairError(e.message || 'Invalid pairing code');
    } finally {
      setPairing(false);
    }
  };

  const handleRename = async (screenId: string) => {
    if (!editName.trim()) return;
    await updateScreen.mutateAsync({ id: screenId, name: editName.trim() });
    setEditingScreen(null);
  };

  const playerUrl = typeof window !== 'undefined' ? `${window.location.origin}/player` : 'http://localhost:3000/player';

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-800 flex items-center gap-2">
            <MonitorPlay className="w-7 h-7 text-indigo-500" />
            Screens
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">Pair devices, organize into groups, and manage your display fleet.</p>
        </div>
        <div className="flex gap-2 items-center">
          {/* Sprint 8 — list/map toggle */}
          <div className="inline-flex bg-slate-100 rounded-lg p-0.5 border border-slate-200">
            <button onClick={() => setViewMode('list')}
              className={`px-3 py-1.5 text-xs font-bold rounded-md flex items-center gap-1.5 transition-colors ${viewMode === 'list' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              <ListIcon className="w-3.5 h-3.5" /> List
            </button>
            <button onClick={() => setViewMode('map')}
              className={`px-3 py-1.5 text-xs font-bold rounded-md flex items-center gap-1.5 transition-colors ${viewMode === 'map' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              <MapIcon className="w-3.5 h-3.5" /> Map
            </button>
          </div>
          <button onClick={() => { setShowPairModal(true); setPairGroupId(''); setPairCode(''); setPairName(''); setPairError(''); }}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg shadow-sm flex items-center gap-2">
            <Wifi className="w-4 h-4" /> Pair Screen
          </button>
          <button onClick={() => setShowCreateGroup(true)}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg shadow-sm flex items-center gap-2">
            <Plus className="w-4 h-4" /> New Group
          </button>
        </div>
      </div>

      {/* Sprint 8 — fleet map view (only when toggled on) */}
      {viewMode === 'map' && (
        <div className="bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-5 space-y-3">
          <div>
            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <MapIcon className="w-4 h-4 text-indigo-500" /> Fleet map
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Every screen with an address. Pin colors show live status — emergency-active screens pulse red. Click a pin for details.
            </p>
          </div>
          <ScreenMapClient
            screens={flatScreens.map(s => ({
              id: s.id, name: s.name, status: s.status,
              latitude: s.latitude, longitude: s.longitude,
              address: s.address, lastPingAt: s.lastPingAt,
              lastCacheReport: s.lastCacheReport,
            }))}
          />
          {flatScreens.length > 0 && (
            <p className="text-[11px] text-slate-400">
              Tip: open a screen card below and click <span className="font-bold">📍 Set location</span> to put it on the map.
            </p>
          )}
        </div>
      )}

      {/* How it works banner */}
      <div className="bg-gradient-to-br from-emerald-50 to-teal-50/50 rounded-3xl border-transparent p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
        <h3 className="text-sm font-bold text-slate-800 mb-4">How to Connect a Screen</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          <div className="flex gap-3.5 items-center">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-500 shadow-sm shadow-emerald-500/20 text-white flex items-center justify-center text-sm font-black shrink-0">1</div>
            <div>
              <p className="text-sm font-bold text-slate-700">Open the Player URL</p>
              <p className="text-xs text-slate-500">On any device browser</p>
            </div>
          </div>
          <div className="flex gap-3.5 items-center">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-500 shadow-sm shadow-emerald-500/20 text-white flex items-center justify-center text-sm font-black shrink-0">2</div>
            <div>
              <p className="text-sm font-bold text-slate-700">Get Pairing Code</p>
              <p className="text-xs text-slate-500">6 digits on screen</p>
            </div>
          </div>
          <div className="flex gap-3.5 items-center">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-500 shadow-sm shadow-emerald-500/20 text-white flex items-center justify-center text-sm font-black shrink-0">3</div>
            <div>
              <p className="text-sm font-bold text-slate-700">Pair it Here</p>
              <p className="text-xs text-slate-500">Click &quot;Pair Screen&quot;</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 mt-6 pt-4 border-t border-emerald-100/50">
          <code className="flex-1 px-4 py-2.5 bg-white rounded-xl text-sm font-mono text-slate-700 select-all shadow-sm">
            {playerUrl}
          </code>
          <button onClick={() => navigator.clipboard?.writeText(playerUrl)}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl shrink-0 shadow-sm transition-all focus:scale-95">
            Copy URL
          </button>
        </div>
      </div>

      {/* Create Group Form */}
      {showCreateGroup && (
        <div className="bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-6">
          <h3 className="text-sm font-bold text-slate-800 mb-3">New Screen Group</h3>
          <div className="flex gap-3">
            <input ref={newGroupInputRef} value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)}
              placeholder="e.g., Main Hallway, Cafeteria, Library"
              className="flex-1 px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              onKeyDown={(e) => e.key === 'Enter' && handleCreateGroup()} />
            <button onClick={handleCreateGroup} disabled={createGroup.isPending}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg">
              {createGroup.isPending ? 'Creating...' : 'Create'}
            </button>
            <button onClick={() => setShowCreateGroup(false)} className="px-3 py-2 text-slate-400 hover:text-slate-600 text-sm">Cancel</button>
          </div>
        </div>
      )}

      {isLoading && <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-indigo-500" /></div>}

      {/* Groups */}
      {groups && (
        <div className="space-y-6">
          {groups.map((group: any) => {
            const screens = group.screens || [];
            const online = screens.filter((s: any) => s.status === 'ONLINE').length;

            return (
              <div key={group.id} className="bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
                <div className="px-6 py-5 flex justify-between items-center bg-slate-50/30">
                  <div className="flex items-center gap-4">
                    <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-indigo-50 to-indigo-100/50 flex items-center justify-center">
                      <MonitorPlay className="w-5 h-5 text-indigo-600" />
                    </div>
                    <div>
                      <h3 className="text-[15px] font-bold text-slate-800">{group.name}</h3>
                      <p className="text-xs font-medium text-slate-400 mt-0.5">
                        {screens.length} {screens.length === 1 ? 'screen' : 'screens'}
                        {online > 0 && <span className="text-emerald-500 ml-1.5">• {online} online</span>}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2.5">
                    <button onClick={() => { setShowPairModal(true); setPairGroupId(group.id); setPairCode(''); setPairName(''); setPairError(''); }}
                      className="px-4 py-2 bg-emerald-50 text-emerald-600 hover:bg-emerald-600 hover:text-white transition-colors text-xs font-bold rounded-xl flex items-center gap-1.5">
                      <Wifi className="w-4 h-4" /> Pair to Group
                    </button>
                    <button onClick={async () => { if (await appConfirm({ title: 'Delete group?', message: `"${group.name}" will be deleted. Screens in it won't be deleted.`, tone: 'danger', confirmLabel: 'Delete' })) deleteGroup.mutate(group.id); }}
                      className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {screens.length > 0 ? (
                  <div className="p-2 space-y-1">
                    {screens.map((screen: any) => (
                      <div key={screen.id} className="px-4 py-3 flex items-center gap-3.5 group/item hover:bg-slate-50 rounded-2xl transition-colors cursor-default">
                        <div className={`w-2.5 h-2.5 rounded-full shrink-0 shadow-sm ${screen.status === 'ONLINE' ? 'bg-emerald-500 shadow-emerald-500/50 animate-pulse' : 'bg-slate-300'}`} />
                        <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
                          <OsIcon os={screen.osInfo} status={screen.status} />
                        </div>
                        <div className="flex-1 min-w-0">
                          {editingScreen === screen.id ? (
                            <div className="flex items-center gap-2">
                              <input ref={editNameInputRef} value={editName} onChange={e => setEditName(e.target.value)}
                                className="px-2 py-1 text-xs border border-indigo-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                                onKeyDown={e => e.key === 'Enter' && handleRename(screen.id)} />
                              <button onClick={() => handleRename(screen.id)} className="text-emerald-600 hover:underline text-xs font-bold">Save</button>
                              <button onClick={() => setEditingScreen(null)} className="text-slate-400 hover:text-slate-600 text-xs font-semibold">Cancel</button>
                            </div>
                          ) : (
                            <button
                              className="text-sm font-bold text-slate-700 hover:text-indigo-600 transition-colors text-left"
                              onClick={() => { setEditingScreen(screen.id); setEditName(screen.name); }}
                              title="Click to rename"
                            >
                              {screen.name}
                            </button>
                          )}
                          <div className="flex gap-3 mt-1 text-[11px] font-medium text-slate-400">
                            {screen.location && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {screen.location}</span>}
                            {screen.resolution && <span>📐 {screen.resolution}</span>}
                            {screen.osInfo && <span>💻 {screen.osInfo}</span>}
                            {screen.browserInfo && <span><Globe className="w-3 h-3 inline" /> {screen.browserInfo}</span>}
                            {screen.ipAddress && <span>🌐 {screen.ipAddress}</span>}
                          </div>
                        </div>
                        <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg ${
                          screen.status === 'ONLINE' ? 'bg-emerald-50 text-emerald-600'
                            : screen.status === 'PENDING' ? 'bg-amber-50 text-amber-600'
                            : 'bg-slate-100 text-slate-500'
                        }`}>
                          {screen.status || 'OFFLINE'}
                        </span>
                        {/* Emergency offline-cache readiness chip — green = assets on disk,
                            amber = no report yet, red = reported empty (would fetch from network) */}
                        {(() => {
                          const r: any = (screen as any).lastCacheReport;
                          if (!r) {
                            return <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg bg-slate-100 text-slate-400" title="Player has not reported cache status yet">cache: ?</span>;
                          }
                          const emCount = r?.emergency?.count || 0;
                          if (emCount > 0) {
                            return <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700" title={`${emCount} emergency assets cached on disk`}>🛡️ ready</span>;
                          }
                          return <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg bg-rose-50 text-rose-700" title="No emergency assets cached — would fetch from network during an alert">🛡️ none</span>;
                        })()}
                        {screen.lastPingAt && (
                          <span className="text-[10px] font-medium text-slate-400 flex items-center gap-1 shrink-0 px-2">
                            <Clock className="w-3 h-3" />
                            {new Date(screen.lastPingAt).toLocaleTimeString()}
                          </span>
                        )}
                        {/* Sprint 8 — set or update map location */}
                        <button
                          onClick={() => handleSetLocation(screen.id, screen.name, (screen as any).address)}
                          className={`p-2 bg-white border border-slate-100 rounded-lg transition-all shadow-sm opacity-0 group-hover/item:opacity-100 ${
                            (screen as any).latitude != null
                              ? 'text-emerald-600 border-emerald-100 hover:bg-emerald-50'
                              : 'text-slate-400 hover:text-indigo-600 hover:border-indigo-100 hover:bg-indigo-50'
                          }`}
                          title={(screen as any).latitude != null ? `On map: ${(screen as any).address || 'set'}` : 'Set map location'}
                        >
                          <MapPin className="w-4 h-4" />
                        </button>
                        <button onClick={() => deleteScreen.mutate(screen.id)}
                          className="p-2 bg-white border border-slate-100 rounded-lg text-slate-400 hover:text-red-500 hover:border-red-100 hover:bg-red-50 opacity-0 group-hover/item:opacity-100 transition-all shadow-sm">
                          <Trash2 className="w-4 h-4" />
                        </button>
                        <a
                          href={`${playerUrl}?deviceId=${screen.deviceFingerprint}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-2 bg-white border border-slate-100 rounded-lg text-slate-400 hover:text-indigo-600 hover:border-indigo-100 hover:bg-indigo-50 opacity-0 group-hover/item:opacity-100 transition-all shadow-sm"
                          title="Open Screen in Browser"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="px-5 py-8 text-center">
                    <p className="text-xs text-slate-400">No screens paired to this group yet.</p>
                    <button onClick={() => { setShowPairModal(true); setPairGroupId(group.id); setPairCode(''); setPairName(''); setPairError(''); }}
                      className="text-xs font-semibold text-emerald-600 hover:underline mt-1">
                      Pair a screen →
                    </button>
                  </div>
                )}

                <div className="px-6 py-3 bg-slate-50/20 border-t border-slate-50 flex justify-between items-center rounded-b-3xl">
                  {group.schedules?.length > 0 ? (
                    <span className="text-[11px] text-emerald-600 font-bold flex items-center gap-2">
                      <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse shadow-sm shadow-emerald-500/50" />
                      Now Playing: {group.schedules[0].playlist?.name}
                      {group.schedules.length > 1 && <span className="text-slate-400 font-semibold ml-1">+{group.schedules.length - 1} more</span>}
                    </span>
                  ) : (
                    <span className="text-[11px] font-semibold text-slate-400">No playlist assigned</span>
                  )}
                  <span className="text-[11px] font-medium text-slate-400">{group._count?.schedules || 0} schedules</span>
                </div>
              </div>
            );
          })}

          {groups.length === 0 && (
            <div className="bg-slate-50 rounded-2xl border border-dashed border-slate-300 p-12 text-center">
              <MonitorPlay className="w-12 h-12 text-slate-300 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-slate-700">No Screen Groups Yet</h3>
              <p className="text-sm text-slate-500 mt-2 mb-4">Create a group, then pair screens to it.</p>
              <button onClick={() => setShowCreateGroup(true)}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg inline-flex items-center gap-1.5">
                <Plus className="w-4 h-4" /> Create First Group
              </button>
            </div>
          )}

          {ungroupedScreens.length > 0 && (
            <div className="bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden mt-8">
              <div className="px-6 py-5 flex justify-between items-center bg-slate-50/30">
                <div className="flex items-center gap-4">
                  <div className="w-11 h-11 rounded-2xl bg-slate-100 flex items-center justify-center">
                    <Monitor className="w-5 h-5 text-slate-500" />
                  </div>
                  <div>
                    <h3 className="text-[15px] font-bold text-slate-800">Ungrouped Screens</h3>
                    <p className="text-xs font-medium text-slate-400 mt-0.5">Screens paired but not assigned to a group</p>
                  </div>
                </div>
              </div>
              <div className="p-2 space-y-1">
                {ungroupedScreens.map((screen: any) => (
                  <div key={screen.id} className="px-4 py-3 flex items-center gap-3.5 group/item hover:bg-slate-50 rounded-2xl transition-colors cursor-default">
                    <div className={`w-2.5 h-2.5 rounded-full shrink-0 shadow-sm ${screen.status === 'ONLINE' ? 'bg-emerald-500 shadow-emerald-500/50 animate-pulse' : 'bg-slate-300'}`} />
                    <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
                      <OsIcon os={screen.osInfo} status={screen.status} />
                    </div>
                    <div className="flex-1 min-w-0">
                      {editingScreen === screen.id ? (
                        <div className="flex items-center gap-2">
                          <input ref={editNameInputRef} value={editName} onChange={e => setEditName(e.target.value)}
                            className="px-2 py-1 text-xs border border-indigo-300 rounded-md focus:ring-2 focus:ring-indigo-500 outline-none"
                            onKeyDown={e => e.key === 'Enter' && handleRename(screen.id)} />
                          <button onClick={() => handleRename(screen.id)} className="text-emerald-600 hover:underline text-xs font-bold">Save</button>
                          <button onClick={() => setEditingScreen(null)} className="text-slate-400 hover:text-slate-600 text-xs font-semibold">Cancel</button>
                        </div>
                      ) : (
                        <button
                          className="text-sm font-bold text-slate-700 hover:text-indigo-600 transition-colors text-left"
                          onClick={() => { setEditingScreen(screen.id); setEditName(screen.name); }}
                          title="Click to rename"
                        >
                          {screen.name}
                        </button>
                      )}
                      <div className="flex gap-3 mt-1 text-[11px] font-medium text-slate-400">
                        {screen.location && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {screen.location}</span>}
                        {screen.resolution && <span>📐 {screen.resolution}</span>}
                        {screen.osInfo && <span>💻 {screen.osInfo}</span>}
                        {screen.browserInfo && <span><Globe className="w-3 h-3 inline" /> {screen.browserInfo}</span>}
                        {screen.ipAddress && <span>🌐 {screen.ipAddress}</span>}
                      </div>
                    </div>
                    {/* Add to group dropdown */}
                    <div className="opacity-0 group-hover/item:opacity-100 transition-opacity flex items-center gap-2 mr-2">
                      <select 
                        className="text-[10px] border border-slate-200 rounded px-1.5 py-1 bg-white outline-none"
                        onChange={(e) => {
                          if (e.target.value) {
                            updateScreen.mutateAsync({ id: screen.id, screenGroupId: e.target.value });
                          }
                        }}
                        value=""
                      >
                        <option value="" disabled>Move to group...</option>
                        {groups?.map((g: any) => (
                          <option key={g.id} value={g.id}>{g.name}</option>
                        ))}
                      </select>
                    </div>
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg ${
                      screen.status === 'ONLINE' ? 'bg-emerald-50 text-emerald-600'
                        : screen.status === 'PENDING' ? 'bg-amber-50 text-amber-600'
                        : 'bg-slate-100 text-slate-500'
                    }`}>
                      {screen.status || 'OFFLINE'}
                    </span>
                    {screen.lastPingAt && (
                      <span className="text-[10px] font-medium text-slate-400 flex items-center gap-1 shrink-0 px-2">
                        <Clock className="w-3 h-3" />
                        {new Date(screen.lastPingAt).toLocaleTimeString()}
                      </span>
                    )}
                    <button onClick={() => deleteScreen.mutate(screen.id)}
                      className="p-2 bg-white border border-slate-100 rounded-lg text-slate-400 hover:text-red-500 hover:border-red-100 hover:bg-red-50 opacity-0 group-hover/item:opacity-100 transition-all shadow-sm">
                      <Trash2 className="w-4 h-4" />
                    </button>
                    <a 
                      href={`${playerUrl}?deviceId=${screen.deviceFingerprint}`} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="p-2 bg-white border border-slate-100 rounded-lg text-slate-400 hover:text-indigo-600 hover:border-indigo-100 hover:bg-indigo-50 opacity-0 group-hover/item:opacity-100 transition-all shadow-sm"
                      title="Open Screen in Browser"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── Pair Screen Modal ─── */}
      {showPairModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Pair a Screen">
          <button className="absolute inset-0 cursor-default" aria-label="Close dialog" onClick={() => setShowPairModal(false)} />
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 relative z-10">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <Wifi className="w-5 h-5 text-emerald-600" /> Pair a Screen
              </h3>
              <button onClick={() => setShowPairModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-sm text-slate-500 mb-5">
              Enter the 6-digit code shown on the screen device.
            </p>

            <div className="space-y-4">
              <div>
                <label htmlFor="pair-code-input" className="block text-xs font-semibold text-slate-600 mb-1.5">Pairing Code</label>
                <input
                  id="pair-code-input"
                  ref={pairCodeInputRef}
                  value={pairCode}
                  onChange={e => setPairCode(e.target.value.toUpperCase())}
                  placeholder="e.g., ABC123"
                  maxLength={6}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-center text-2xl font-mono font-bold tracking-[0.3em] outline-none focus:ring-2 focus:ring-emerald-500 uppercase"
                  onKeyDown={e => e.key === 'Enter' && handlePairScreen()}
                />
              </div>

              <div>
                <label htmlFor="pair-name-input" className="block text-xs font-semibold text-slate-600 mb-1.5">Screen Name (optional)</label>
                <input
                  id="pair-name-input"
                  value={pairName}
                  onChange={e => setPairName(e.target.value)}
                  placeholder="e.g., Lobby Display, Room 201"
                  className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label htmlFor="pair-group-select" className="block text-xs font-semibold text-slate-600 mb-1.5">Assign to Group</label>
                <select
                  id="pair-group-select"
                  value={pairGroupId}
                  onChange={e => setPairGroupId(e.target.value)}
                  className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="">-- No group (assign later) --</option>
                  {groups?.map((g: any) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
              </div>

              {pairError && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2">
                  <p className="text-sm text-red-600 font-medium">{pairError}</p>
                </div>
              )}

              <button
                onClick={handlePairScreen}
                disabled={pairing || pairCode.length < 6}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold rounded-xl flex items-center justify-center gap-2"
              >
                {pairing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
                {pairing ? 'Pairing...' : 'Pair Screen'}
              </button>

              <button
                type="button"
                onClick={() => setShowQrForScan(v => !v)}
                disabled={pairCode.length < 4}
                className="w-full py-2 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 text-sm font-semibold rounded-xl flex items-center justify-center gap-2"
                aria-expanded={showQrForScan}
                data-testid="scan-instead-button"
              >
                <QrCode className="w-4 h-4" />
                {showQrForScan ? 'Hide QR code' : 'Scan instead with phone'}
              </button>

              {showQrForScan && qrDataUrl && (
                <div className="flex flex-col items-center gap-2 border border-slate-200 rounded-xl p-4" data-testid="pair-qr-container">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qrDataUrl} alt="QR code to pair screen with phone" width={220} height={220} />
                  <p className="text-xs text-slate-500 text-center">
                    On your phone, open <code className="font-mono">/pair</code> and scan this code.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
