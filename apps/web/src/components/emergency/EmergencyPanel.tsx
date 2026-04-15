"use client";

import React, { useState } from 'react';
import { AlertTriangle, ShieldCheck, Siren } from 'lucide-react';

export const EmergencyPanel = () => {
  const [typedConfirm, setTypedConfirm] = useState('');
  const [active, setActive] = useState(false);
  const [loading, setLoading] = useState(false);

  const canFire = typedConfirm === 'LOCKDOWN';

  const fireOverride = async () => {
    if (!canFire) return;
    setLoading(true);
    try {
      // Firing against actual NestJS backend
      const res = await fetch('/api/v1/emergency/trigger', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + (typeof window !== 'undefined' ? localStorage.getItem('token') : '')
        },
        body: JSON.stringify({
          scopeType: 'group',
          scopeId: 'ALL_SCREENS',
          overridePayload: { severity: 'CRITICAL' }
        })
      });
      if (res.ok) {
        setActive(true);
        setTypedConfirm('');
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const clearOverride = async () => {
    setLoading(true);
    try {
      const res = await fetch('http://localhost:3000/api/v1/emergency/override/clear', {
        method: 'POST'
      });
      if (res.ok) setActive(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`rounded-2xl border p-6 transition-all duration-500 overflow-hidden relative shadow-lg ${active ? 'bg-red-50 dark:bg-red-950/20 border-red-500' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800'}`}>
      {active && (
        <div className="absolute inset-0 bg-red-500/5 animate-pulse pointer-events-none" />
      )}
      
      <div className="flex items-start justify-between relative z-10">
        <div>
          <div className="flex items-center space-x-2">
            <Siren className={active ? "text-red-500 animate-bounce" : "text-slate-400"} size={24} />
            <h2 className="text-xl font-bold dark:text-slate-100">Global Emergency Override</h2>
          </div>
          <p className="text-slate-500 mt-2 text-sm max-w-md">
            Instantly seize control of all active signage screens within your RBAC scope. This bypasses all active playlists immediately.
          </p>
        </div>

        {active ? (
          <button 
            onClick={clearOverride}
            disabled={loading}
            className="flex items-center space-x-2 px-6 py-3 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold transition-all shadow-md focus:ring-4 focus:ring-slate-200"
          >
            <ShieldCheck size={20} />
            <span>Restore Normal Operations</span>
          </button>
        ) : (
          <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-200 dark:border-slate-700 w-80">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">
              Type "LOCKDOWN" to verify
            </label>
            <input 
              type="text" 
              className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-800 dark:text-slate-100 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent transition-all font-mono mb-3"
              value={typedConfirm}
              onChange={e => setTypedConfirm(e.target.value)}
              placeholder="Case sensitive..."
            />
            <button 
              onClick={fireOverride}
              disabled={!canFire || loading}
              className={`w-full flex items-center justify-center space-x-2 py-3 rounded-lg font-bold transition-all shadow-sm ${canFire ? 'bg-red-600 hover:bg-red-700 text-white shadow-red-500/30' : 'bg-slate-200 dark:bg-slate-700 text-slate-400 cursor-not-allowed'}`}
            >
              <AlertTriangle size={20} />
              <span>{loading ? 'Transmitting...' : 'EXECUTE OVERRIDE'}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
