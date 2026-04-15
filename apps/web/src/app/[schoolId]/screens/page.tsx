"use client";

import { MonitorPlay, Plus, Loader2, Trash2, MapPin, MonitorCheck, Wifi, WifiOff, X, Smartphone, Monitor, Laptop, Tv, Globe, Clock, ExternalLink } from 'lucide-react';
import { useScreenGroups, useCreateScreenGroup, useDeleteScreenGroup, useDeleteScreen, useUpdateScreen, useScreens } from '@/hooks/use-api';
import { useState } from 'react';
import { apiFetch } from '@/lib/api-client';

function OsIcon({ os }: { os?: string }) {
  if (!os) return <Monitor className="w-4 h-4 text-slate-400" />;
  const l = os.toLowerCase();
  if (l.includes('android')) return <Smartphone className="w-4 h-4 text-emerald-500" />;
  if (l.includes('ios') || l.includes('mac')) return <Laptop className="w-4 h-4 text-slate-600" />;
  if (l.includes('windows')) return <Monitor className="w-4 h-4 text-sky-500" />;
  if (l.includes('linux') || l.includes('chrome os')) return <Tv className="w-4 h-4 text-amber-500" />;
  return <Monitor className="w-4 h-4 text-slate-400" />;
}

export default function ScreensPage() {
  const { data: groups, isLoading, refetch } = useScreenGroups();
  const { data: allScreens, refetch: refetchScreens } = useScreens();
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
        <div className="flex gap-2">
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

      {/* How it works banner */}
      <div className="bg-gradient-to-r from-emerald-50 to-teal-50 rounded-xl border border-emerald-200 p-5">
        <h3 className="text-sm font-bold text-slate-800 mb-3">How to Connect a Screen</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center text-sm font-bold shrink-0">1</div>
            <div>
              <p className="text-xs font-semibold text-slate-700">Open the Player URL</p>
              <p className="text-[10px] text-slate-500 mt-0.5">On any device with a browser (TV, tablet, PC)</p>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center text-sm font-bold shrink-0">2</div>
            <div>
              <p className="text-xs font-semibold text-slate-700">Get the Pairing Code</p>
              <p className="text-[10px] text-slate-500 mt-0.5">A 6-digit code will appear on screen</p>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center text-sm font-bold shrink-0">3</div>
            <div>
              <p className="text-xs font-semibold text-slate-700">Pair it Here</p>
              <p className="text-[10px] text-slate-500 mt-0.5">Click &quot;Pair Screen&quot; and enter the code</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 mt-4 pt-3 border-t border-emerald-200">
          <code className="flex-1 px-4 py-2 bg-white border border-emerald-200 rounded-lg text-sm font-mono text-slate-800 select-all">
            {playerUrl}
          </code>
          <button onClick={() => navigator.clipboard?.writeText(playerUrl)}
            className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg shrink-0">
            Copy URL
          </button>
        </div>
      </div>

      {/* Create Group Form */}
      {showCreateGroup && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <h3 className="text-sm font-semibold text-slate-800 mb-3">New Screen Group</h3>
          <div className="flex gap-3">
            <input value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)}
              placeholder="e.g., Main Hallway, Cafeteria, Library"
              className="flex-1 px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              onKeyDown={(e) => e.key === 'Enter' && handleCreateGroup()} autoFocus />
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
              <div key={group.id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center">
                      <MonitorPlay className="w-4 h-4 text-indigo-600" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-800">{group.name}</h3>
                      <p className="text-[10px] text-slate-400">
                        {screens.length} {screens.length === 1 ? 'screen' : 'screens'}
                        {online > 0 && <span className="text-emerald-500 ml-1">• {online} online</span>}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => { setShowPairModal(true); setPairGroupId(group.id); setPairCode(''); setPairName(''); setPairError(''); }}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg flex items-center gap-1">
                      <Wifi className="w-3.5 h-3.5" /> Pair to Group
                    </button>
                    <button onClick={() => { if (confirm(`Delete group "${group.name}"?`)) deleteGroup.mutate(group.id); }}
                      className="p-1.5 text-slate-300 hover:text-red-500">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {screens.length > 0 ? (
                  <div className="divide-y divide-slate-50">
                    {screens.map((screen: any) => (
                      <div key={screen.id} className="px-5 py-3 flex items-center gap-3 group/item hover:bg-slate-50/50 transition-colors">
                        <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${screen.status === 'ONLINE' ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`} />
                        <OsIcon os={screen.osInfo} />
                        <div className="flex-1 min-w-0">
                          {editingScreen === screen.id ? (
                            <div className="flex items-center gap-2">
                              <input value={editName} onChange={e => setEditName(e.target.value)}
                                className="px-2 py-1 text-xs border border-indigo-300 rounded-md focus:ring-2 focus:ring-indigo-500 outline-none"
                                onKeyDown={e => e.key === 'Enter' && handleRename(screen.id)} autoFocus />
                              <button onClick={() => handleRename(screen.id)} className="text-emerald-600 hover:underline text-xs font-semibold">Save</button>
                              <button onClick={() => setEditingScreen(null)} className="text-slate-400 text-xs">Cancel</button>
                            </div>
                          ) : (
                            <p className="text-xs font-semibold text-slate-700 cursor-pointer hover:text-indigo-600" onClick={() => { setEditingScreen(screen.id); setEditName(screen.name); }}>
                              {screen.name}
                            </p>
                          )}
                          <div className="flex gap-3 mt-0.5 text-[10px] text-slate-400">
                            {screen.location && <span className="flex items-center gap-0.5"><MapPin className="w-2.5 h-2.5" /> {screen.location}</span>}
                            {screen.resolution && <span>📐 {screen.resolution}</span>}
                            {screen.osInfo && <span>💻 {screen.osInfo}</span>}
                            {screen.browserInfo && <span><Globe className="w-2.5 h-2.5 inline" /> {screen.browserInfo}</span>}
                            {screen.ipAddress && <span>🌐 {screen.ipAddress}</span>}
                          </div>
                        </div>
                        <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                          screen.status === 'ONLINE' ? 'bg-emerald-50 text-emerald-600'
                            : screen.status === 'PENDING' ? 'bg-amber-50 text-amber-600'
                            : 'bg-slate-100 text-slate-400'
                        }`}>
                          {screen.status || 'OFFLINE'}
                        </span>
                        {screen.lastPingAt && (
                          <span className="text-[10px] text-slate-300 flex items-center gap-0.5 shrink-0">
                            <Clock className="w-2.5 h-2.5" />
                            {new Date(screen.lastPingAt).toLocaleTimeString()}
                          </span>
                        )}
                        <button onClick={() => deleteScreen.mutate(screen.id)}
                          className="p-1 text-slate-200 hover:text-red-500 opacity-0 group-hover/item:opacity-100 transition-all">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                        <a 
                          href={`${playerUrl}?deviceId=${screen.deviceFingerprint}`} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="p-1 text-slate-300 hover:text-indigo-600 transition-all"
                          title="Open Screen in Browser"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
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

                <div className="px-5 py-2.5 border-t border-slate-100 bg-slate-50/50 flex justify-between items-center">
                  {group.schedules?.length > 0 ? (
                    <span className="text-[10px] text-emerald-600 font-semibold flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                      Now Playing: {group.schedules[0].playlist?.name}
                      {group.schedules.length > 1 && <span className="text-slate-400 font-normal ml-1">+{group.schedules.length - 1} more</span>}
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-400">No playlist assigned</span>
                  )}
                  <span className="text-[10px] text-slate-300">{group._count?.schedules || 0} schedules</span>
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
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mt-6">
              <div className="px-5 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center">
                    <Monitor className="w-4 h-4 text-slate-500" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-800">Ungrouped Screens</h3>
                    <p className="text-[10px] text-slate-400">Screens paired but not assigned to a group</p>
                  </div>
                </div>
              </div>
              <div className="divide-y divide-slate-50">
                {ungroupedScreens.map((screen: any) => (
                  <div key={screen.id} className="px-5 py-3 flex items-center gap-3 group/item hover:bg-slate-50/50 transition-colors">
                    <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${screen.status === 'ONLINE' ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`} />
                    <OsIcon os={screen.osInfo} />
                    <div className="flex-1 min-w-0">
                      {editingScreen === screen.id ? (
                        <div className="flex items-center gap-2">
                          <input value={editName} onChange={e => setEditName(e.target.value)}
                            className="px-2 py-1 text-xs border border-indigo-300 rounded-md focus:ring-2 focus:ring-indigo-500 outline-none"
                            onKeyDown={e => e.key === 'Enter' && handleRename(screen.id)} autoFocus />
                          <button onClick={() => handleRename(screen.id)} className="text-emerald-600 hover:underline text-xs font-semibold">Save</button>
                          <button onClick={() => setEditingScreen(null)} className="text-slate-400 text-xs">Cancel</button>
                        </div>
                      ) : (
                        <p className="text-xs font-semibold text-slate-700 cursor-pointer hover:text-indigo-600" onClick={() => { setEditingScreen(screen.id); setEditName(screen.name); }}>
                          {screen.name}
                        </p>
                      )}
                      <div className="flex gap-3 mt-0.5 text-[10px] text-slate-400">
                        {screen.location && <span className="flex items-center gap-0.5"><MapPin className="w-2.5 h-2.5" /> {screen.location}</span>}
                        {screen.resolution && <span>📐 {screen.resolution}</span>}
                        {screen.osInfo && <span>💻 {screen.osInfo}</span>}
                        {screen.browserInfo && <span><Globe className="w-2.5 h-2.5 inline" /> {screen.browserInfo}</span>}
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
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                      screen.status === 'ONLINE' ? 'bg-emerald-50 text-emerald-600'
                        : screen.status === 'PENDING' ? 'bg-amber-50 text-amber-600'
                        : 'bg-slate-100 text-slate-400'
                    }`}>
                      {screen.status || 'OFFLINE'}
                    </span>
                    {screen.lastPingAt && (
                      <span className="text-[10px] text-slate-300 flex items-center gap-0.5 shrink-0">
                        <Clock className="w-2.5 h-2.5" />
                        {new Date(screen.lastPingAt).toLocaleTimeString()}
                      </span>
                    )}
                    <button onClick={() => deleteScreen.mutate(screen.id)}
                      className="p-1 text-slate-200 hover:text-red-500 opacity-0 group-hover/item:opacity-100 transition-all">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    <a 
                      href={`${playerUrl}?deviceId=${screen.deviceFingerprint}`} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="p-1 text-slate-300 hover:text-indigo-600 transition-all"
                      title="Open Screen in Browser"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
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
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowPairModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
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
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Pairing Code</label>
                <input
                  value={pairCode}
                  onChange={e => setPairCode(e.target.value.toUpperCase())}
                  placeholder="e.g., ABC123"
                  maxLength={6}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-center text-2xl font-mono font-bold tracking-[0.3em] outline-none focus:ring-2 focus:ring-emerald-500 uppercase"
                  onKeyDown={e => e.key === 'Enter' && handlePairScreen()}
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Screen Name (optional)</label>
                <input
                  value={pairName}
                  onChange={e => setPairName(e.target.value)}
                  placeholder="e.g., Lobby Display, Room 201"
                  className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Assign to Group</label>
                <select
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
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
