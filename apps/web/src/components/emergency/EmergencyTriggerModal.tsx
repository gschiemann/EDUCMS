import { useAppStore } from '@/lib/store';
import { X, Megaphone, ShieldAlert, WifiOff, Hand, Lock, HeartPulse, CloudLightning } from 'lucide-react';
import { useState, useTransition } from 'react';
import { broadcastEmergency } from '@/actions/trigger-emergency';
import { clog } from '@/lib/client-logger';

/**
 * Emergency Trigger — the red button on the dashboard.
 *
 * Trigger-only modal. Setup (which playlist + media plays for each
 * SRP type) happens in /settings → Emergency Content. This modal is
 * for the life-safety moment: pick the type, type the confirm word,
 * fire.
 *
 * The server looks up the right playlist for the tenant by type
 * (panicHoldPlaylistId, panicSecurePlaylistId, panicLockdownPlaylistId,
 * etc.) and broadcasts it on the tenant's signed channel. No playlist
 * selection happens here — that shortens the time-to-trigger and stops
 * operators from pairing a Hold with an Evacuate playlist by mistake.
 */

interface Props {
  onClose: () => void;
}

export function EmergencyTriggerModal({ onClose }: Props) {
  const setEmergencyActive = useAppStore((state) => state.setEmergencyActive);
  const user = useAppStore((state) => state.user);
  const token = useAppStore((state) => state.token);

  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [confirmKey, setConfirmKey] = useState('');
  const [isPending, startTransition] = useTransition();

  // Full Standard Response Protocol — used by the vast majority of US
  // K-12 districts. Each type has its own confirm word so an operator
  // tense under pressure can't accidentally fire Lockdown when they
  // meant Hold. Order matches SRP training materials so muscle memory
  // aligns.
  const types = [
    { id: 'hold',     name: 'Hold',      description: 'Clear hallways, continue instruction. Used for medical or police activity in a hallway.',  icon: Hand,           confirm: 'HOLD' },
    { id: 'secure',   name: 'Secure',    description: 'External threat. Lock outer doors. Business as usual inside.',                                icon: Lock,           confirm: 'SECURE' },
    { id: 'lockdown', name: 'Lockdown',  description: 'Internal threat. Lock classroom doors, lights off, out of sight.',                             icon: ShieldAlert,    confirm: 'LOCKDOWN' },
    { id: 'evacuate', name: 'Evacuate',  description: 'Fire or evacuation order. Leave the building via posted routes.',                              icon: Megaphone,      confirm: 'EVACUATE' },
    { id: 'weather',  name: 'Shelter',   description: 'Severe weather / hazmat. Direct to interior safe zones.',                                      icon: CloudLightning, confirm: 'SHELTER' },
    { id: 'medical',  name: 'Medical',   description: 'Medical emergency in the building. Directs staff to assist + clears onlookers.',              icon: HeartPulse,     confirm: 'MEDICAL' },
  ];

  const currentType = types.find((t) => t.id === selectedType);
  const confirmWord = currentType?.confirm || '';

  const handleTrigger = () => {
    if (!selectedType || confirmKey !== confirmWord) return;
    startTransition(async () => {
      const started = performance.now();
      clog.warn('emergency', `TRIGGER: ${selectedType}`, {
        schoolId: user?.tenantId,
        triggeredBy: user?.id,
        role: user?.role,
      });
      try {
        await broadcastEmergency({
          schoolId: user?.tenantId || 'global',
          type: selectedType,
          // No playlistId — the server resolves the right panic playlist
          // for this type from the tenant's stored settings.
          triggeredBy: user?.id || 'unknown',
          token: token || undefined,
        });
        clog.info('emergency', `TRIGGER success: ${selectedType}`, {
          elapsedMs: Math.round(performance.now() - started),
        });
        setEmergencyActive(true);
        onClose();
      } catch (err) {
        clog.error('emergency', `TRIGGER FAILED: ${selectedType}`, {
          err: err instanceof Error ? err.message : String(err),
          elapsedMs: Math.round(performance.now() - started),
        });
        throw err;
      }
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-red-50 dark:bg-red-500/10">
          <div>
            <h2 className="text-lg font-bold text-red-600 dark:text-red-400 flex items-center gap-2">
              <ShieldAlert className="w-5 h-5" />
              Trigger Emergency
            </h2>
            <p className="text-xs text-red-700/80 dark:text-red-400/80 mt-0.5">
              Emergency content is configured in <strong>Settings → Emergency Content</strong>.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6 flex-1 overflow-y-auto">
          {/* Step 1 — pick the SRP type */}
          <div>
            <h3 className="text-sm font-semibold tracking-tight text-slate-900 dark:text-white mb-3">
              1. Select Emergency Type
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {types.map((type) => (
                <button
                  key={type.id}
                  onClick={() => { setSelectedType(type.id); setConfirmKey(''); }}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    selectedType === type.id
                      ? 'border-red-500 bg-red-50 dark:bg-red-500/10 ring-2 ring-red-500'
                      : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 bg-white dark:bg-slate-800'
                  }`}
                >
                  <type.icon className={`w-6 h-6 mb-2 ${selectedType === type.id ? 'text-red-600' : 'text-slate-500'}`} />
                  <div className={`font-bold text-sm ${selectedType === type.id ? 'text-red-700 dark:text-red-300' : 'text-slate-800 dark:text-slate-200'}`}>
                    {type.name}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-snug">
                    {type.description}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Step 2 — type the confirm word */}
          {selectedType && (
            <div className="animate-in fade-in slide-in-from-top-4 duration-200 pt-5 border-t border-slate-100 dark:border-slate-800">
              <h3 className="text-sm font-semibold tracking-tight text-slate-900 dark:text-white mb-3">
                2. Confirm
              </h3>
              <div className="bg-red-50/60 dark:bg-red-500/5 rounded-xl p-4 border border-red-200 dark:border-red-500/20 space-y-3">
                <p className="text-sm text-slate-700 dark:text-slate-300">
                  This will immediately broadcast <strong className="text-red-700 dark:text-red-400">{currentType?.name}</strong> to every online screen in your school.
                </p>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                    Type <span className="text-red-600 font-mono">{confirmWord}</span> to confirm
                  </label>
                  <input
                    type="text"
                    value={confirmKey}
                    onChange={(e) => setConfirmKey(e.target.value.toUpperCase())}
                    placeholder={confirmWord}
                    autoFocus
                    className="w-full px-4 py-2.5 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-mono text-sm outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent transition-all uppercase tracking-wider"
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
            className="px-6 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:hover:bg-red-600 text-white text-sm font-bold rounded-md shadow-sm transition-all flex justify-center items-center gap-2 min-w-[160px]"
          >
            {isPending ? (
              <span className="animate-pulse">Broadcasting…</span>
            ) : (
              <span className="flex items-center gap-2">
                <WifiOff className="w-4 h-4" /> Trigger Emergency
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
