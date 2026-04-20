"use client";

import { useAppStore } from '@/lib/store';
import { ShieldAlert, Loader2, AlertTriangle, CheckCircle2, Megaphone, LogIn, Hand, Lock, HeartPulse, CloudLightning } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { broadcastEmergency } from '@/actions/trigger-emergency';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';

const HOLD_DURATION_MS = 1500;

// Full SRP — same id strings + order as the dashboard EmergencyTriggerModal.
const TYPES = [
  { id: 'hold',     name: 'Hold',     icon: Hand,           color: 'bg-yellow-500',  hold: 'bg-yellow-600',  ring: 'stroke-yellow-300',  text: 'text-yellow-400' },
  { id: 'secure',   name: 'Secure',   icon: Lock,           color: 'bg-blue-600',    hold: 'bg-blue-700',    ring: 'stroke-blue-300',    text: 'text-blue-400' },
  { id: 'lockdown', name: 'Lockdown', icon: ShieldAlert,    color: 'bg-red-600',     hold: 'bg-red-700',     ring: 'stroke-red-300',     text: 'text-red-400' },
  { id: 'evacuate', name: 'Evacuate', icon: Megaphone,      color: 'bg-orange-500',  hold: 'bg-orange-600',  ring: 'stroke-orange-300',  text: 'text-orange-400' },
  { id: 'weather',  name: 'Shelter',  icon: CloudLightning, color: 'bg-amber-500',   hold: 'bg-amber-600',   ring: 'stroke-amber-300',   text: 'text-amber-400' },
  { id: 'medical',  name: 'Medical',  icon: HeartPulse,     color: 'bg-emerald-600', hold: 'bg-emerald-700', ring: 'stroke-emerald-300', text: 'text-emerald-400' },
];

export default function MobilePanicPage() {
  const router = useRouter();
  const storeUser = useAppStore((s) => s.user);
  const storeToken = useAppStore((s) => s.token);
  const [phase, setPhase] = useState<'loading' | 'idle' | 'triggering' | 'triggered' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [firedType, setFiredType] = useState<string | null>(null);

  // Per-button hold state — keyed by type id
  const [holdingId, setHoldingId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  const [verifiedUser, setVerifiedUser] = useState<any>(null);
  const [verifiedToken, setVerifiedToken] = useState<string | null>(null);

  const holdTimerRef = useRef<NodeJS.Timeout | null>(null);
  const progressTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Was-cleared flag — briefly surfaces an "All Clear" banner before
  // we transition back to idle so staff get visual confirmation that
  // the event was resolved (rather than the screen silently flipping
  // out of the triggered view).
  const [justCleared, setJustCleared] = useState(false);

  // Poll /emergency/status while sitting on the 'triggered' or
  // 'idle-with-active-emergency' screen so the mobile app mirrors
  // all-clear events fired from the desktop dashboard. User ask:
  // "once an emergency is cleared, it should clear the mobile app
  // as well". Cadence 5s is fast enough for operator comfort without
  // hammering the API — this page only loads when staff actively
  // open it, so concurrent pollers are few.
  useEffect(() => {
    // Only poll once we have a session + only in states where an
    // emergency COULD be active.
    if (phase !== 'triggered' && phase !== 'idle') return;
    if (!verifiedToken || !verifiedUser?.tenantId) return;

    let cancelled = false;
    const check = async () => {
      try {
        const r = await fetch(
          `${API_URL}/emergency/status?tenantId=${encodeURIComponent(verifiedUser.tenantId)}`,
          { headers: { Authorization: `Bearer ${verifiedToken}` }, cache: 'no-store' },
        );
        if (!r.ok || cancelled) return;
        const data = await r.json();
        const isActive = data?.tenantStatus && data.tenantStatus !== 'INACTIVE';
        if (!isActive && phase === 'triggered') {
          // Admin cleared it. Flash All Clear, then return to idle so
          // staff can re-fire if they need to.
          setJustCleared(true);
          setTimeout(() => {
            if (cancelled) return;
            setPhase('idle');
            setFiredType(null);
            setJustCleared(false);
          }, 2500);
        }
      } catch { /* network blip — next tick retries */ }
    };
    check();
    const t = setInterval(check, 5000);
    return () => { cancelled = true; clearInterval(t); };
  }, [phase, verifiedToken, verifiedUser?.tenantId]);

  // Verify session on mount
  useEffect(() => {
    async function verifySession() {
      const token = storeToken;
      if (!token) { router.push('/login?redirect=/panic'); return; }
      try {
        const res = await fetch(`${API_URL}/users`, { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok && storeUser) {
          setVerifiedUser(storeUser);
          setVerifiedToken(token);
          setPhase('idle');
          return;
        }
      } catch {
        if (storeUser) {
          setVerifiedUser(storeUser);
          setVerifiedToken(token);
          setPhase('idle');
          return;
        }
      }
      router.push('/login?redirect=/panic');
    }
    verifySession();
  }, [storeToken, storeUser, router]);

  const clearHold = () => {
    if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
    if (progressTimerRef.current) { clearInterval(progressTimerRef.current); progressTimerRef.current = null; }
    setHoldingId(null);
    setProgress(0);
  };

  const handlePointerDown = (typeId: string) => (e: React.PointerEvent) => {
    e.preventDefault();
    if (phase !== 'idle') return;
    setHoldingId(typeId);
    setProgress(0);
    const startTime = Date.now();
    progressTimerRef.current = setInterval(() => {
      const pct = Math.min(((Date.now() - startTime) / HOLD_DURATION_MS) * 100, 100);
      setProgress(pct);
    }, 50);
    holdTimerRef.current = setTimeout(() => fireEmergency(typeId), HOLD_DURATION_MS);
  };

  const fireEmergency = async (typeId: string) => {
    clearHold();
    setPhase('triggering');
    setFiredType(typeId);
    try {
      if (!verifiedToken) throw new Error('No auth token. Please log in again.');
      if (!verifiedUser?.tenantId) throw new Error('No school ID. Please log in again.');
      const result = await broadcastEmergency({
        schoolId: verifiedUser.tenantId,
        type: typeId,
        triggeredBy: verifiedUser.id || 'unknown',
        token: verifiedToken,
      });
      if (result?.error) {
        if (result.error.includes('401') || result.error.includes('403')) {
          throw new Error('Session expired. Please log out and log back in, then try again.');
        }
        throw new Error(result.error);
      }
      setPhase('triggered');
    } catch (e: any) {
      console.error('[PANIC] Emergency trigger failed:', e);
      setErrorMsg(e.message || 'Failed to connect. Ensure you have internet.');
      setPhase('error');
    }
  };

  if (phase === 'loading') {
    return (
      <div className="fixed inset-0 bg-slate-950 text-white flex flex-col items-center justify-center">
        <Loader2 className="w-12 h-12 text-red-500 animate-spin mb-4" />
        <p className="text-slate-400 text-sm">Verifying authorization...</p>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="fixed inset-0 bg-slate-950 text-white flex flex-col items-center justify-center p-6">
        <AlertTriangle className="w-24 h-24 text-red-500 mb-6" />
        <h1 className="text-3xl font-black mb-2 text-red-500">FAILED</h1>
        <p className="text-slate-400 mb-8 max-w-[280px] text-center text-sm">{errorMsg}</p>
        <div className="flex flex-col gap-3 w-full max-w-xs">
          <button onClick={() => { setPhase('idle'); setErrorMsg(''); setFiredType(null); }} className="px-8 py-3 bg-slate-800 rounded-full font-bold uppercase tracking-wider text-sm">
            Try Again
          </button>
          <button onClick={() => router.push('/login?redirect=/panic')} className="px-8 py-3 bg-slate-900 border border-slate-700 rounded-full font-bold uppercase tracking-wider text-sm flex items-center justify-center gap-2">
            <LogIn className="w-4 h-4" /> Re-Login
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'triggered') {
    const fired = TYPES.find((t) => t.id === firedType) || TYPES[2];

    // Admin just fired all-clear from the dashboard. Flash a green
    // "All Clear" confirmation before the polling effect transitions
    // us back to idle so staff see the resolution land.
    if (justCleared) {
      return (
        <div className="fixed inset-0 bg-slate-950 text-white flex flex-col items-center justify-center p-6">
          <div className="relative mb-6">
            <div className="absolute inset-0 bg-emerald-500 rounded-full animate-ping opacity-20 scale-150" />
            <CheckCircle2 className="w-24 h-24 text-emerald-400 relative z-10" />
          </div>
          <h1 className="text-3xl font-black mb-2 text-emerald-400 uppercase text-center">All Clear</h1>
          <p className="text-slate-400 max-w-[260px] mx-auto text-center text-sm">
            An administrator cleared the {fired.name.toLowerCase()} alert. Returning to the trigger panel.
          </p>
        </div>
      );
    }

    return (
      <div className="fixed inset-0 bg-slate-950 text-white flex flex-col items-center justify-center p-6">
        <div className="relative mb-6">
          <div className="absolute inset-0 bg-red-600 rounded-full animate-ping opacity-20 scale-150" />
          <CheckCircle2 className="w-24 h-24 text-red-500 relative z-10" />
        </div>
        <h1 className="text-3xl font-black mb-2 text-red-500 uppercase text-center">{fired.name}<br/>Broadcasted</h1>
        <p className="text-slate-400 mb-8 max-w-[260px] mx-auto text-center text-sm">
          All screens are now locked to the emergency profile.
        </p>
        <p className="absolute bottom-8 italic text-slate-500 text-xs text-center w-full px-8">
          Waiting for an administrator to clear from a secure terminal. This screen will
          return to the trigger panel automatically once that happens.
        </p>
      </div>
    );
  }

  // Main grid — 6 circles, 2 rows × 3 columns, each press-and-hold triggers
  return (
    <div className="fixed inset-0 bg-slate-950 text-white flex flex-col overscroll-none select-none">
      {/* Header */}
      <div className="flex justify-between items-center px-5 pt-5 pb-3 opacity-60">
        <ShieldAlert className="w-5 h-5" />
        <span className="text-[10px] font-bold uppercase tracking-widest truncate max-w-[60%] text-right">{verifiedUser?.email || 'AUTHORIZED'}</span>
      </div>

      <div className="px-5 pb-2 text-center">
        <h1 className="text-xl font-black tracking-tight">EMERGENCY TRIGGER</h1>
        <p className="text-slate-500 text-[11px] mt-1">Press and hold any button for 1.5 seconds to broadcast.</p>
      </div>

      {/* 2x3 grid — generous spacing so adjacent buttons aren't easy to fat-finger */}
      <div className="flex-1 grid grid-cols-2 grid-rows-3 gap-x-6 gap-y-5 px-6 pb-6 pt-2 place-items-center">
        {TYPES.map((type) => {
          const isHolding = holdingId === type.id;
          const isTriggering = phase === 'triggering' && firedType === type.id;
          const dim = phase === 'triggering' && !isTriggering;
          const Icon = type.icon;
          return (
            <button
              key={type.id}
              onPointerDown={handlePointerDown(type.id)}
              onPointerUp={clearHold}
              onPointerLeave={clearHold}
              onPointerCancel={clearHold}
              onContextMenu={(e) => e.preventDefault()}
              disabled={phase === 'triggering'}
              className={`relative aspect-square w-full max-w-[160px] rounded-full flex flex-col items-center justify-center
                shadow-[inset_0_-6px_0_rgba(0,0,0,0.25)] transition-all duration-150 outline-none
                ${dim ? 'opacity-30' : ''}
                ${isHolding ? `${type.hold} scale-95` : type.color}
              `}
              style={{ WebkitTapHighlightColor: 'transparent', touchAction: 'none' }}
            >
              {/* Progress ring */}
              <svg className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="46" className="stroke-black/20" strokeWidth="3" fill="none" />
                <circle
                  cx="50" cy="50" r="46"
                  className={`${type.ring} transition-[stroke-dashoffset] duration-75`}
                  strokeWidth="4" fill="none"
                  strokeDasharray="289"
                  strokeDashoffset={isHolding ? 289 - (289 * progress) / 100 : 289}
                  strokeLinecap="round"
                />
              </svg>

              {isTriggering ? (
                <Loader2 className="w-10 h-10 text-white animate-spin" />
              ) : (
                <>
                  <Icon className="w-10 h-10 text-white/95 drop-shadow-md mb-1" />
                  <span className="font-bold text-white/95 uppercase tracking-wider text-xs drop-shadow-md">
                    {isHolding ? 'Hold…' : type.name}
                  </span>
                </>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
