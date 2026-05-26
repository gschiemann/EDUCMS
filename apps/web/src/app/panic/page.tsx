"use client";

import { useAppStore } from '@/lib/store';
import { ShieldAlert, Loader2, AlertTriangle, CheckCircle2, Megaphone, LogIn, Hand, Lock, HeartPulse, CloudLightning, ShieldOff } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { broadcastEmergency } from '@/actions/trigger-emergency';
// LIFE-SAFETY (2026-05-23 launch audit P0 #1): use the centralized
// helper so a missing NEXT_PUBLIC_API_URL surfaces a loud warning AND
// the page can detect the misconfiguration to show an explicit error
// instead of silently failing the 5s all-clear poll.
import { API_URL, warnIfMisconfigured, isLikelyMisconfigured } from '@/lib/api-url';

// Roles that inherently carry emergency-trigger authority — mirrored from
// the API's @RequireRoles on /emergency/trigger (apps/api/src/emergency/
// emergency.controller.ts). The `canTriggerPanic` opt-in flag covers
// delegated authority for non-admin roles (per CLAUDE.md "Emergency
// System → Key Safeguards #1").
const PANIC_AUTHORITY_ROLES = new Set(['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN']);
function hasPanicAuthority(user: { role?: string; canTriggerPanic?: boolean } | null): boolean {
  if (!user) return false;
  if (PANIC_AUTHORITY_ROLES.has(user.role || '')) return true;
  if (user.canTriggerPanic === true) return true;
  return false;
}

// 2026-05-03 BUG FIX (cycle 1 emergency BUG-001) — was 1500ms, but
// CLAUDE.md "Key Safeguards #5: Hold-to-Trigger UX" requires
// 3 seconds to prevent accidental taps. Life-safety regression
// restored. The animated progress ring matches this duration.
const HOLD_DURATION_MS = 3000;

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
  // LIFE-SAFETY (2026-05-23 launch audit P0 #1): on a forgotten-env
  // deploy the page would silently fall back to localhost; surface
  // it instead so the operator knows their alert path is broken.
  const [phase, setPhase] = useState<'loading' | 'idle' | 'triggering' | 'triggered' | 'error' | 'unauthorized' | 'misconfigured'>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [firedType, setFiredType] = useState<string | null>(null);

  // Per-button hold state — keyed by type id
  const [holdingId, setHoldingId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  // A11y audit (2026-05-25): aria-live announcement string. Mirrored
  // into a <div role="status" aria-live="assertive" sr-only> below so
  // a screen-reader user follows the trigger lifecycle in audio. We
  // also speak the message through Web Speech API when available
  // (browser-permission-gated; degrades silently if blocked). ADA
  // Title II / Section 504 — without this, an SR user gets nothing
  // as phase flips idle → triggering → triggered → cleared.
  const [announcement, setAnnouncement] = useState('');

  const [verifiedUser, setVerifiedUser] = useState<any>(null);
  const [verifiedToken, setVerifiedToken] = useState<string | null>(null);

  const holdTimerRef = useRef<NodeJS.Timeout | null>(null);
  const progressTimerRef = useRef<NodeJS.Timeout | null>(null);

  // A11y audit (2026-05-25): update the live region AND speak the
  // text through Web Speech API. Speech is best-effort — older
  // WebViews (Taurus Chromium 83) or browsers with TTS disabled
  // throw or silently no-op. We swallow errors so SR + visible
  // operators get the message even when speech can't fire.
  const announce = (text: string) => {
    setAnnouncement(text);
    try {
      const w = typeof window !== 'undefined' ? (window as any) : null;
      if (w && w.speechSynthesis && typeof w.SpeechSynthesisUtterance === 'function') {
        // Cancel any in-flight utterance so successive phase
        // changes don't queue up and overlap.
        w.speechSynthesis.cancel?.();
        const u = new w.SpeechSynthesisUtterance(text);
        u.rate = 1.0;
        u.volume = 1.0;
        u.lang = 'en-US';
        w.speechSynthesis.speak(u);
      }
    } catch {
      // No-op: SR users still get the aria-live region; visible
      // operators still see the on-screen state. Speech is bonus.
    }
  };

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
          announce('All clear. An administrator cleared the alert. Returning to trigger panel.');
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
    // LIFE-SAFETY (audit P0 #1): if the deploy is missing
    // NEXT_PUBLIC_API_URL the alert path is broken end-to-end. Surface
    // a hard error instead of letting the page act as if it's working.
    warnIfMisconfigured();
    if (isLikelyMisconfigured()) {
      setPhase('misconfigured');
      return;
    }

    async function verifySession() {
      const token = storeToken;
      if (!token) { router.push('/login?redirect=/panic'); return; }
      try {
        const res = await fetch(`${API_URL}/users`, { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok && storeUser) {
          // LIFE-SAFETY (audit P0 #3): role gate the UI BEFORE showing
          // the trigger grid. A CONTRIBUTOR who lands here would hold for
          // 3s, get back a server 403, and see misleading "Session
          // expired" copy — dangerous during a real lockdown.
          if (!hasPanicAuthority(storeUser)) {
            setVerifiedUser(storeUser);
            setVerifiedToken(token);
            setPhase('unauthorized');
            return;
          }
          setVerifiedUser(storeUser);
          setVerifiedToken(token);
          setPhase('idle');
          announce('Emergency trigger panel ready. Press and hold any button for 3 seconds to broadcast.');
          return;
        }
      } catch {
        if (storeUser) {
          if (!hasPanicAuthority(storeUser)) {
            setVerifiedUser(storeUser);
            setVerifiedToken(token);
            setPhase('unauthorized');
            return;
          }
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

  // Shared "start hold" routine — Pointer events fire it on touch;
  // keyboard activation routes through the same code path so admins
  // with motor impairments / keyboard-only assistive input can trigger
  // an emergency just like a touch user. WCAG 2.1.1.
  const startHold = (typeId: string) => {
    if (phase !== 'idle') return;
    setHoldingId(typeId);
    setProgress(0);
    const startTime = Date.now();
    const type = TYPES.find((t) => t.id === typeId);
    if (type) announce(`Holding ${type.name} alert. Continue holding for 3 seconds to broadcast.`);
    progressTimerRef.current = setInterval(() => {
      const pct = Math.min(((Date.now() - startTime) / HOLD_DURATION_MS) * 100, 100);
      setProgress(pct);
    }, 50);
    holdTimerRef.current = setTimeout(() => fireEmergency(typeId), HOLD_DURATION_MS);
  };

  const handlePointerDown = (typeId: string) => (e: React.PointerEvent) => {
    e.preventDefault();
    // LIFE-SAFETY (2026-05-23 launch audit P1 #8): pin the gesture to
    // THIS button so finger drift within the 160px target doesn't fire
    // pointerleave and reset the 3s hold timer. setPointerCapture keeps
    // the same element receiving pointer events until pointerup or
    // pointercancel — exactly the semantics we want for a sustained
    // emergency-trigger hold.
    try {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch {
      // Older WebViews may not implement setPointerCapture; the
      // pointer events still fire normally, just without capture —
      // operator might have to re-position the finger if they drift
      // off the circle. Better than failing the press entirely.
    }
    startHold(typeId);
  };

  // Keyboard hold — Space/Enter starts the countdown on the focused
  // button; key-up before HOLD_DURATION_MS cancels exactly like a
  // pointer-release. Repeat key events are squelched so holding the
  // key down doesn't reset the timer 30×/sec (A11y audit, 2026-05-12).
  const handleKeyDown = (typeId: string) => (e: React.KeyboardEvent) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    if (e.repeat) return;
    e.preventDefault();
    startHold(typeId);
  };

  const handleKeyUp = (e: React.KeyboardEvent) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    clearHold();
  };

  const fireEmergency = async (typeId: string) => {
    clearHold();
    setPhase('triggering');
    setFiredType(typeId);
    const type = TYPES.find((t) => t.id === typeId);
    if (type) announce(`Triggering ${type.name} alert. Broadcasting to all displays.`);
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
        // LIFE-SAFETY (audit P1 #7): differentiate auth vs network vs
        // server errors. Previously every 4xx/5xx collapsed to "Session
        // expired" which misroutes the operator during a real incident.
        if (result.error.includes('401') || result.error.includes('403')) {
          throw new Error(
            'Your account no longer has emergency-trigger authority. ' +
              'NOTIFY SECURITY MANUALLY now — your alert was NOT broadcast.',
          );
        }
        if (result.error.toLowerCase().includes('network') || result.error.toLowerCase().includes('fetch')) {
          throw new Error(
            'Could not reach the server. NOTIFY SECURITY MANUALLY now — ' +
              'your alert was NOT broadcast. Retry once you have internet.',
          );
        }
        throw new Error(result.error);
      }
      setPhase('triggered');
      if (type) announce(`${type.name} alert sent to all displays. Waiting for an administrator to clear.`);
    } catch (e: any) {
      console.error('[PANIC] Emergency trigger failed:', e);
      const msg = e.message || 'Could not reach the server. NOTIFY SECURITY MANUALLY now — your alert was NOT broadcast.';
      setErrorMsg(msg);
      setPhase('error');
      announce(`Alert failed. Your alert was NOT broadcast. Notify security manually now. ${msg}`);
    }
  };

  // A11y audit (2026-05-25): single live region rendered as the first
  // child of every phase return. role="status" + aria-live="assertive"
  // + aria-atomic="true" lets a screen reader speak the entire
  // announcement on each phase change. The visible operator never sees
  // it (sr-only). Kept inline here rather than extracted because it
  // must appear in the DOM before the SR-visible content changes.
  const LiveRegion = (
    <div
      role="status"
      aria-live="assertive"
      aria-atomic="true"
      className="sr-only"
    >
      {announcement}
    </div>
  );

  if (phase === 'loading') {
    return (
      <div className="fixed top-0 right-0 bottom-0 left-0 bg-slate-950 text-white flex flex-col items-center justify-center">
        {LiveRegion}
        <Loader2 className="w-12 h-12 text-red-500 animate-spin mb-4" />
        <p className="text-slate-400 text-sm">Verifying authorization...</p>
      </div>
    );
  }

  // LIFE-SAFETY (audit P0 #1): misconfigured deploy — every poll + every
  // trigger will silently fail because API_URL is localhost. Don't pretend
  // the page is working.
  if (phase === 'misconfigured') {
    return (
      <div className="fixed top-0 right-0 bottom-0 left-0 bg-slate-950 text-white flex flex-col items-center justify-center p-6">
        {LiveRegion}
        <AlertTriangle className="w-24 h-24 text-red-500 mb-6" />
        <h1 className="text-3xl font-black mb-2 text-red-500 uppercase text-center">Not Configured</h1>
        <p className="text-slate-300 mb-3 max-w-[300px] text-center text-sm font-bold">
          Emergency trigger is unavailable on this deploy.
        </p>
        <p className="text-slate-400 mb-8 max-w-[300px] text-center text-xs">
          The server URL is missing from this build (NEXT_PUBLIC_API_URL not set).
          NOTIFY SECURITY MANUALLY for any emergency — DO NOT rely on this app
          until your admin fixes the deploy configuration.
        </p>
      </div>
    );
  }

  // LIFE-SAFETY (audit P0 #3): user is authenticated but lacks the
  // capability to trigger emergencies. Show that explicitly so they
  // know not to rely on this surface during a real incident.
  if (phase === 'unauthorized') {
    return (
      <div className="fixed top-0 right-0 bottom-0 left-0 bg-slate-950 text-white flex flex-col items-center justify-center p-6">
        {LiveRegion}
        <ShieldOff className="w-24 h-24 text-amber-500 mb-6" />
        <h1 className="text-2xl font-black mb-2 text-amber-400 uppercase text-center">No Trigger Authority</h1>
        <p className="text-slate-300 mb-3 max-w-[300px] text-center text-sm font-bold">
          Your account doesn&rsquo;t have emergency-trigger authority.
        </p>
        <p className="text-slate-400 mb-8 max-w-[300px] text-center text-xs">
          NOTIFY SECURITY MANUALLY for any emergency. Ask a district or school admin
          to grant trigger authority if you should have it.
        </p>
        <button
          onClick={() => router.push('/login?redirect=/panic')}
          className="px-8 py-3 bg-slate-900 border border-slate-700 rounded-full font-bold uppercase tracking-wider text-sm flex items-center justify-center gap-2 min-h-[44px]"
        >
          <LogIn className="w-4 h-4" /> Switch Account
        </button>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="fixed top-0 right-0 bottom-0 left-0 bg-slate-950 text-white flex flex-col items-center justify-center p-6">
        {LiveRegion}
        <AlertTriangle className="w-24 h-24 text-red-500 mb-6" />
        <h1 className="text-3xl font-black mb-2 text-red-500">FAILED</h1>
        {/* LIFE-SAFETY (audit P1 #7): error copy now spells out the
            "alert was NOT broadcast — notify security manually" guidance
            explicitly, then surfaces the technical reason. */}
        <p className="text-slate-300 mb-3 max-w-[300px] text-center text-sm font-bold">
          Your alert was NOT broadcast.
        </p>
        <p className="text-slate-400 mb-6 max-w-[300px] text-center text-xs">
          NOTIFY SECURITY MANUALLY for the actual incident, then try again here.
        </p>
        <p className="text-slate-500 mb-8 max-w-[280px] text-center text-xs italic">{errorMsg}</p>
        <div className="flex flex-col gap-3 w-full max-w-xs">
          <button onClick={() => { setPhase('idle'); setErrorMsg(''); setFiredType(null); }} className="px-8 py-3 bg-slate-800 rounded-full font-bold uppercase tracking-wider text-sm min-h-[44px]">
            Try Again
          </button>
          <button onClick={() => router.push('/login?redirect=/panic')} className="px-8 py-3 bg-slate-900 border border-slate-700 rounded-full font-bold uppercase tracking-wider text-sm flex items-center justify-center gap-2 min-h-[44px]">
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
        <div className="fixed top-0 right-0 bottom-0 left-0 bg-slate-950 text-white flex flex-col items-center justify-center p-6">
          {LiveRegion}
          <div className="relative mb-6">
            <div className="absolute top-0 right-0 bottom-0 left-0 bg-emerald-500 rounded-full animate-ping opacity-20 scale-150" />
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
      <div className="fixed top-0 right-0 bottom-0 left-0 bg-slate-950 text-white flex flex-col items-center justify-center p-6">
        {LiveRegion}
        <div className="relative mb-6">
          <div className="absolute top-0 right-0 bottom-0 left-0 bg-red-600 rounded-full animate-ping opacity-20 scale-150" />
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
    <div className="fixed top-0 right-0 bottom-0 left-0 bg-slate-950 text-white flex flex-col overscroll-none select-none">
      {LiveRegion}
      {/* Header */}
      <div className="flex justify-between items-center px-5 pt-5 pb-3 opacity-60">
        <ShieldAlert className="w-5 h-5" />
        <span className="text-[10px] font-bold uppercase tracking-widest truncate max-w-[60%] text-right">{verifiedUser?.email || 'AUTHORIZED'}</span>
      </div>

      <div className="px-5 pb-2 text-center">
        <h1 className="text-xl font-black tracking-tight">EMERGENCY TRIGGER</h1>
        {/* 2026-05-03 BUG FIX (cycle 4 emergency-BUG-013) — copy used to
            say "1.5 seconds" but HOLD_DURATION_MS is 3000 (cycle-1 fix
            restoring the CLAUDE.md "Key Safeguards #5" 3-second hold).
            Updated to match actual timer so operators see truthful UX. */}
        <p className="text-slate-500 text-[11px] mt-1">Press and hold any button for 3 seconds to broadcast.</p>
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
              // LIFE-SAFETY (audit P1 #8): onPointerLeave intentionally
              // removed — with setPointerCapture in handlePointerDown,
              // pointerleave doesn't fire while the gesture is captured.
              // On a WebView where capture isn't available, removing
              // this handler makes the hold more forgiving to finger
              // drift; pointerup + pointercancel still terminate the
              // hold cleanly.
              onPointerCancel={clearHold}
              onKeyDown={handleKeyDown(type.id)}
              onKeyUp={handleKeyUp}
              onBlur={clearHold}
              onContextMenu={(e) => e.preventDefault()}
              aria-label={`Trigger ${type.id} emergency. Hold for 3 seconds to broadcast.`}
              disabled={phase === 'triggering'}
              className={`relative aspect-square w-full max-w-[160px] rounded-full flex flex-col items-center justify-center
                shadow-[inset_0_-6px_0_rgba(0,0,0,0.25)] transition-all duration-150 outline-none
                ${dim ? 'opacity-30' : ''}
                ${isHolding ? `${type.hold} scale-95` : type.color}
              `}
              style={{ WebkitTapHighlightColor: 'transparent', touchAction: 'none' }}
            >
              {/* Progress ring */}
              <svg className="absolute top-0 right-0 bottom-0 left-0 w-full h-full -rotate-90 pointer-events-none" viewBox="0 0 100 100">
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
