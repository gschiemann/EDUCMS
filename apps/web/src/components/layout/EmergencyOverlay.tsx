"use client";

import { useAppStore } from '@/lib/store';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { useState, useTransition } from 'react';
import { allClearEmergency } from '@/actions/trigger-emergency';

export function EmergencyOverlay() {
  const setEmergencyActive = useAppStore((state) => state.setEmergencyActive);
  const user = useAppStore((state) => state.user);
  const token = useAppStore((state) => state.token);
  const [confirmKey, setConfirmKey] = useState('');
  const [isPending, startTransition] = useTransition();

  const handleAllClear = () => {
    if (confirmKey === 'CLEAR') {
      startTransition(async () => {
        try {
          await allClearEmergency({
            schoolId: user?.tenantId || 'global',
            token: token || undefined,
          });
          setEmergencyActive(false);
        } catch (e) {
          console.error("Failed to clear emergency", e);
          // Retry later or handle error UI
        }
      });
    }
  };

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center p-6 bg-red-950/90 backdrop-blur-3xl border-8 border-red-500 transition-all duration-300">
      
      {/* Flashing global indicator */}
      <div className="absolute inset-x-0 top-0 h-2 bg-red-500 animate-pulse" />
      <div className="absolute inset-x-0 bottom-0 h-2 bg-red-500 animate-pulse" />
      
      <div className="max-w-2xl w-full flex flex-col items-center justify-center text-center space-y-8 animate-in zoom-in-95 duration-500">
        <div className="w-32 h-32 rounded-full bg-red-500/20 flex items-center justify-center animate-pulse">
          <AlertTriangle className="w-16 h-16 text-red-500" />
        </div>

        <div className="space-y-4">
          <h1 className="text-5xl font-black tracking-tighter text-white">EMERGENCY ACTIVE</h1>
          <p className="text-xl text-red-200 mt-2 font-medium">
            All screens are currently locked and displaying the emergency override broadcast. Normal scheduling is suspended.
          </p>
        </div>

        <div className="w-full max-w-md bg-black/40 backdrop-blur-md rounded-xl p-8 border border-red-500/30 mt-8 space-y-6">
          <div>
            <label className="block text-sm font-bold uppercase tracking-wider text-red-400 mb-2">
              All-Clear Authorization
            </label>
            <p className="text-sm text-red-200 mb-4 opacity-80">
              To restore normal screen scheduling, type <strong>CLEAR</strong> and authorize the all-clear signal.
            </p>
            <input 
              type="text"
              value={confirmKey}
              onChange={(e) => setConfirmKey(e.target.value.toUpperCase())}
              placeholder="Type CLEAR"
              className="w-full px-4 py-3 bg-black/50 border border-red-500/30 rounded-lg text-white font-mono text-center tracking-[0.5em] focus:ring-2 focus:ring-red-500 outline-none uppercase"
            />
          </div>

          <button
            onClick={handleAllClear}
            disabled={confirmKey !== 'CLEAR' || isPending}
            className="w-full py-4 px-6 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:hover:bg-red-600 text-white font-bold rounded-lg shadow-xl hover:shadow-red-500/20 transition-all flex justify-center items-center gap-2"
          >
            {isPending ? (
              <span className="flex items-center gap-2 animate-pulse">
                <ShieldCheck className="w-5 h-5" /> Submitting...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5" /> Terminate Emergency (All Clear)
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
