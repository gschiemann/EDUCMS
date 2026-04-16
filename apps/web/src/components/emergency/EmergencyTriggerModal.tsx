import { useAppStore } from '@/lib/store';
import { AlertCircle, X, Megaphone, ShieldAlert, WifiOff } from 'lucide-react';
import { useState, useTransition } from 'react';
import { broadcastEmergency } from '@/actions/trigger-emergency';
import { usePlaylists } from '@/hooks/use-api';

interface Props {
  onClose: () => void;
}

export function EmergencyTriggerModal({ onClose }: Props) {
  const setEmergencyActive = useAppStore((state) => state.setEmergencyActive);
  const user = useAppStore((state) => state.user);
  
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [selectedPlaylist, setSelectedPlaylist] = useState<string>('');
  const [confirmKey, setConfirmKey] = useState('');
  const [isPending, startTransition] = useTransition();
  const { data: playlists } = usePlaylists();

  const confirmWord = "LOCKDOWN"; 

  const handleTrigger = () => {
    if (confirmKey === confirmWord) {
      startTransition(async () => {
         // Next.js Server Action handles backend communication
         await broadcastEmergency({
            schoolId: user?.tenantId || 'global',
            type: selectedType!,
            playlistId: selectedPlaylist || undefined,
            triggeredBy: 'admin-123'
         });
         
         // Zustand global state update locks the UI optimistically immediately after resolution
         setEmergencyActive(true);
         onClose();
      });
    }
  };

  const types = [
    { id: 'lockdown', name: 'Lockdown', description: 'Immediate threat. All doors lock, screens show quiet instructions.', icon: ShieldAlert },
    { id: 'weather', name: 'Tornado / Weather', description: 'Severe weather alert. Directs to safe zones.', icon: AlertCircle },
    { id: 'evacuate', name: 'Evacuate', description: 'Fire or evacuation order. Shows exit routes.', icon: Megaphone },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-red-50 dark:bg-red-500/10">
          <h2 className="text-lg font-bold text-red-600 dark:text-red-400 flex items-center gap-2">
            <ShieldAlert className="w-5 h-5" />
            Trigger Emergency Override
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-8 flex-1 overflow-y-auto">
          {/* Step 1 */}
          <div>
            <h3 className="text-sm font-semibold tracking-tight text-slate-900 dark:text-white mb-4">
              1. Select Emergency Profile
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {types.map((type) => (
                <button
                  key={type.id}
                  onClick={() => setSelectedType(type.id)}
                  className={`p-4 rounded-xl border text-left transition-all ${
                    selectedType === type.id 
                      ? 'border-red-500 bg-red-50 dark:bg-red-500/10 ring-1 ring-red-500' 
                      : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 bg-white dark:bg-slate-800'
                  }`}
                >
                  <type.icon className={`w-6 h-6 mb-3 ${selectedType === type.id ? 'text-red-600' : 'text-slate-400'}`} />
                  <div className={`font-semibold text-sm ${selectedType === type.id ? 'text-red-700 dark:text-red-300' : 'text-slate-700 dark:text-slate-300'}`}>
                    {type.name}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Step 2 */}
          {selectedType && (
            <div className="animate-in fade-in slide-in-from-top-4 duration-300 pt-6 border-t border-slate-100 dark:border-slate-800">
              <h3 className="text-sm font-semibold tracking-tight text-slate-900 dark:text-white mb-4">
                2. Assign Emergency Playlist
              </h3>
              <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-5 border border-slate-200 dark:border-slate-700">
                <p className="text-xs text-slate-600 dark:text-slate-400 mb-3">
                  Select the playlist containing the media (e.g., evacuation routes, alert graphics) to display on all screens during the override.
                </p>
                <select 
                  value={selectedPlaylist}
                  onChange={(e) => setSelectedPlaylist(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-red-500"
                >
                  <option value="">-- No specific media (red alert text only) --</option>
                  {playlists?.map((p: any) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Step 3 */}
          {selectedType && (
            <div className="animate-in fade-in slide-in-from-top-4 duration-300 pt-6 border-t border-slate-100 dark:border-slate-800">
              <h3 className="text-sm font-semibold tracking-tight text-slate-900 dark:text-white mb-4">
                3. Final Authorization
              </h3>
              <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-5 border border-slate-200 dark:border-slate-700 space-y-4">
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  This action will bypass all current scheduling and immediately display the selected emergency profile on <strong className="text-slate-900 dark:text-white">all online screens</strong>.
                </p>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                    Type {confirmWord} to confirm
                  </label>
                  <input 
                    type="text"
                    value={confirmKey}
                    onChange={(e) => setConfirmKey(e.target.value.toUpperCase())}
                    placeholder={`Type ${confirmWord}`}
                    className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-mono outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent transition-all uppercase"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex justify-end gap-3">
          <button 
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleTrigger}
            disabled={!selectedType || confirmKey !== confirmWord || isPending}
            className="px-6 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:hover:bg-red-600 text-white text-sm font-semibold rounded-md shadow-sm transition-all flex justify-center items-center gap-2 min-w-[140px]"
          >
            {isPending ? (
              <span className="flex items-center gap-2 animate-pulse">
                Broadcasting...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <WifiOff className="w-4 h-4" /> Trigger Override
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
