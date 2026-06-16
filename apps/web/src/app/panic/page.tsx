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
// LIFE-SAFETY (2026-06-16): bound the session-verify + all-clear-poll fetches
// so a HUNG api (not just a refused one) can't strand the operator forever on
// "Verifying authorization…". On timeout these throw; the existing catch
// blocks fall back gracefully (verify → show the grid w/ cached user; poll →
// ignore + retry next tick).
import { fetchWithTimeout } from '@/lib/fetch-timeout';

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
// 2026-06-15 redesign: dropped the six fully-saturated rainbow circles for the
// VenueOS premium-dark control board. Each type keeps its semantic SRP color
// (life-safety meaning is preserved + the page still reads as "emergency"),
// but renders as a dark-glass control with that color as a GLOW ACCENT at rest
// that fully ignites to a solid fill on hold. `accent` = the live color, `dark`
// = the bottom of the hold-fill gradient, `rgb` = the same color as a raw
// triplet for rgba() glow/tint composition in inline styles (Tailwind can't
// build class names from runtime values, so the per-type look is inline).
const TYPES = [
  { id: 'hold',     name: 'Hold',     icon: Hand,           accent: '#f5a623', dark: '#b9791a', rgb: '245,166,35'  },
  { id: 'secure',   name: 'Secure',   icon: Lock,           accent: '#3b82f6', dark: '#1d4ed8', rgb: '59,130,246'  },
  { id: 'lockdown', name: 'Lockdown', icon: ShieldAlert,    accent: '#ef4444', dark: '#b91c1c', rgb: '239,68,68'   },
  { id: 'evacuate', name: 'Evacuate', icon: Megaphone,      accent: '#f97316', dark: '#c2410c', rgb: '249,115,22'  },
  { id: 'weather',  name: 'Shelter',  icon: CloudLightning, accent: '#22d3ee', dark: '#0e7490', rgb: '34,211,238'  },
  { id: 'medical',  name: 'Medical',  icon: HeartPulse,     accent: '#10b981', dark: '#047857', rgb: '16,185,129'  },
];

// Shared premium-dark page surface — a deep VenueOS navy radial that matches
// the dashboard's oklch(0.14 0.03 260) dark token (vs the old flat bg-slate-950).
// Every phase screen uses this so loading / triggered / error / idle feel like
// one product, not a stranded slate sub-page.
const PAGE_STYLE: React.CSSProperties = {
  background:
    'radial-gradient(135% 90% at 50% -10%, #16203b 0%, #0b1124 46%, #070a13 100%)',
};
const PAGE_CLS =
  'fixed top-0 right-0 bottom-0 left-0 text-white flex flex-col overscroll-none select-none';

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
        const r = await fetchWithTimeout(
          `${API_URL}/emergency/status?tenantId=${encodeURIComponent(verifiedUser.tenantId)}`,
          { headers: { Authorization: `Bearer ${verifiedToken}` }, cache: 'no-store' },
          // 4s < the 5s poll interval, so a stalled poll is aborted before the
          // next one fires — no pile-up of hung requests.
          4000,
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
      // LIFE-SAFETY: role-gate the UI BEFORE showing the trigger grid. A user
      // without authority who held for 3s would get a server 403 + misleading
      // "Session expired" copy — dangerous during a real lockdown.
      const gateOn = (user: typeof storeUser, why?: string) => {
        setVerifiedUser(user);
        setVerifiedToken(token);
        if (!hasPanicAuthority(user)) { setPhase('unauthorized'); return; }
        setPhase('idle');
        announce('Emergency trigger panel ready. Press and hold any button for 3 seconds to broadcast.');
      };
      try {
        // Validate the session against an endpoint EVERY authenticated role
        // can reach. This was `/users` (the admin-only list) — so a
        // CONTRIBUTOR with canTriggerPanic, exactly the delegated staff this
        // page exists for, got a 403, fell through the ok-check (403 isn't
        // res.ok and doesn't throw), and was bounced to /login, never able to
        // reach the trigger grid (2026-06-09 Fable mobile audit, life-safety).
        // /users/me also returns the LIVE role + canTriggerPanic, so the
        // authority gate reflects the current DB row, not a stale JWT/store.
        const res = await fetchWithTimeout(
          `${API_URL}/users/me`,
          { headers: { Authorization: `Bearer ${token}` } },
          // 6s — generous for a slow cellular uplink, but bounded so a hung
          // API falls through to the catch (→ gate on cached user, show grid)
          // instead of leaving the operator stuck on the loading spinner.
          6000,
        );
        if (res.ok) {
          const me = await res.json().catch(() => null);
          const liveUser = me && typeof me === 'object' ? { ...storeUser, ...me } : storeUser;
          gateOn(liveUser);
          return;
        }
        // 401 = token genuinely invalid/expired → must re-authenticate.
        if (res.status === 401) { router.push('/login?redirect=/panic'); return; }
        // Any other status (e.g. transient 5xx) on a token we hold: do NOT
        // strand a valid session mid-emergency — gate on the cached user.
        if (storeUser) { gateOn(storeUser); return; }
      } catch {
        // Network error (offline): a held token + cached user is enough to
        // show the grid; the trigger itself is server-authoritative.
        if (storeUser) { gateOn(storeUser); return; }
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
      <div className={`${PAGE_CLS} items-center justify-center`} style={PAGE_STYLE}>
        {LiveRegion}
        <div className="relative mb-5 flex items-center justify-center">
          <span className="absolute h-16 w-16 rounded-2xl bg-white/[0.04] ring-1 ring-white/10" />
          <ShieldAlert className="relative w-7 h-7 text-white/80" />
        </div>
        <Loader2 className="w-6 h-6 text-white/60 animate-spin mb-3" />
        <p className="text-white/60 text-xs uppercase tracking-[0.2em] font-semibold">Verifying authorization</p>
      </div>
    );
  }

  // LIFE-SAFETY (audit P0 #1): misconfigured deploy — every poll + every
  // trigger will silently fail because API_URL is localhost. Don't pretend
  // the page is working.
  if (phase === 'misconfigured') {
    return (
      <div className={`${PAGE_CLS} items-center justify-center p-6`} style={PAGE_STYLE}>
        {LiveRegion}
        <div className="relative mb-6 flex items-center justify-center">
          <span
            className="absolute h-24 w-24 rounded-3xl"
            style={{ background: 'rgba(239,68,68,0.10)', boxShadow: '0 0 48px rgba(239,68,68,0.30)' }}
          />
          <AlertTriangle className="relative w-12 h-12" style={{ color: '#ef4444' }} />
        </div>
        <h1 className="text-2xl font-black mb-2 uppercase tracking-tight text-center" style={{ color: '#f87171' }}>Not Configured</h1>
        <p className="text-white/80 mb-3 max-w-[300px] text-center text-sm font-bold">
          Emergency trigger is unavailable on this deploy.
        </p>
        <p className="text-white/65 mb-8 max-w-[300px] text-center text-xs leading-relaxed">
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
      <div className={`${PAGE_CLS} items-center justify-center p-6`} style={PAGE_STYLE}>
        {LiveRegion}
        <div className="relative mb-6 flex items-center justify-center">
          <span
            className="absolute h-24 w-24 rounded-3xl"
            style={{ background: 'rgba(245,166,35,0.10)', boxShadow: '0 0 48px rgba(245,166,35,0.28)' }}
          />
          <ShieldOff className="relative w-12 h-12" style={{ color: '#f5a623' }} />
        </div>
        <h1 className="text-2xl font-black mb-2 uppercase tracking-tight text-center" style={{ color: '#fbbf24' }}>No Trigger Authority</h1>
        <p className="text-white/80 mb-3 max-w-[300px] text-center text-sm font-bold">
          Your account doesn&rsquo;t have emergency-trigger authority.
        </p>
        <p className="text-white/65 mb-8 max-w-[300px] text-center text-xs leading-relaxed">
          NOTIFY SECURITY MANUALLY for any emergency. Ask a district or school admin
          to grant trigger authority if you should have it.
        </p>
        <button
          onClick={() => router.push('/login?redirect=/panic')}
          className="px-8 py-3 rounded-2xl font-bold uppercase tracking-wider text-sm flex items-center justify-center gap-2 min-h-[48px] bg-white/[0.04] border border-white/10 text-white/85 active:bg-white/[0.08] transition-colors"
        >
          <LogIn className="w-4 h-4" /> Switch Account
        </button>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className={`${PAGE_CLS} items-center justify-center p-6`} style={PAGE_STYLE}>
        {LiveRegion}
        <div className="relative mb-6 flex items-center justify-center">
          <span
            className="absolute h-24 w-24 rounded-3xl"
            style={{ background: 'rgba(239,68,68,0.12)', boxShadow: '0 0 56px rgba(239,68,68,0.40)' }}
          />
          <AlertTriangle className="relative w-12 h-12" style={{ color: '#ef4444' }} />
        </div>
        <h1 className="text-3xl font-black mb-2 tracking-tight" style={{ color: '#f87171' }}>FAILED</h1>
        {/* LIFE-SAFETY (audit P1 #7): error copy now spells out the
            "alert was NOT broadcast — notify security manually" guidance
            explicitly, then surfaces the technical reason. */}
        <p className="text-white/80 mb-3 max-w-[300px] text-center text-sm font-bold">
          Your alert was NOT broadcast.
        </p>
        <p className="text-white/65 mb-6 max-w-[300px] text-center text-xs leading-relaxed">
          NOTIFY SECURITY MANUALLY for the actual incident, then try again here.
        </p>
        <p className="text-white/55 mb-8 max-w-[280px] text-center text-xs italic">{errorMsg}</p>
        <div className="flex flex-col gap-3 w-full max-w-xs">
          <button
            onClick={() => { setPhase('idle'); setErrorMsg(''); setFiredType(null); }}
            className="px-8 py-3 rounded-2xl font-bold uppercase tracking-wider text-sm min-h-[48px] text-white transition-transform active:scale-[0.98]"
            style={{ background: 'linear-gradient(160deg, #ef4444, #b91c1c)', boxShadow: '0 0 32px rgba(239,68,68,0.35)' }}
          >
            Try Again
          </button>
          <button
            onClick={() => router.push('/login?redirect=/panic')}
            className="px-8 py-3 rounded-2xl font-bold uppercase tracking-wider text-sm flex items-center justify-center gap-2 min-h-[48px] bg-white/[0.04] border border-white/10 text-white/85 active:bg-white/[0.08] transition-colors"
          >
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
        <div className={`${PAGE_CLS} items-center justify-center p-6`} style={PAGE_STYLE}>
          {LiveRegion}
          <div className="relative mb-6 flex items-center justify-center">
            <span className="absolute h-28 w-28 rounded-full bg-emerald-400/20 animate-ping" />
            <span
              className="absolute h-28 w-28 rounded-full"
              style={{ boxShadow: '0 0 64px rgba(16,185,129,0.45)' }}
            />
            <CheckCircle2 className="w-20 h-20 relative z-10" style={{ color: '#34d399' }} />
          </div>
          <h1 className="text-3xl font-black mb-2 uppercase tracking-tight text-center" style={{ color: '#34d399' }}>All Clear</h1>
          <p className="text-white/65 max-w-[260px] mx-auto text-center text-sm leading-relaxed">
            An administrator cleared the {fired.name.toLowerCase()} alert. Returning to the trigger panel.
          </p>
        </div>
      );
    }

    return (
      <div className={`${PAGE_CLS} items-center justify-center p-6`} style={PAGE_STYLE}>
        {LiveRegion}
        <div className="relative mb-6 flex items-center justify-center">
          <span
            className="absolute h-28 w-28 rounded-full animate-ping"
            style={{ background: `rgba(${fired.rgb},0.22)` }}
          />
          <span
            className="absolute h-28 w-28 rounded-full"
            style={{ boxShadow: `0 0 72px rgba(${fired.rgb},0.50)` }}
          />
          <CheckCircle2 className="w-20 h-20 relative z-10" style={{ color: fired.accent }} />
        </div>
        <h1 className="text-3xl font-black mb-2 uppercase tracking-tight text-center" style={{ color: fired.accent }}>{fired.name}<br/>Broadcasted</h1>
        <p className="text-white/55 mb-8 max-w-[260px] mx-auto text-center text-sm leading-relaxed">
          All screens are now locked to the emergency profile.
        </p>
        <p className="absolute bottom-8 italic text-white/55 text-xs text-center w-full px-8 leading-relaxed">
          Waiting for an administrator to clear from a secure terminal. This screen will
          return to the trigger panel automatically once that happens.
        </p>
      </div>
    );
  }

  // Main grid — 6 dark-glass controls, 2 rows × 3 columns, each press-and-hold
  // triggers. Premium-dark VenueOS board: each control keeps its semantic SRP
  // color as a glow accent at rest, then fully ignites to a solid fill on hold.
  return (
    <div className={PAGE_CLS} style={PAGE_STYLE}>
      {LiveRegion}
      {/* Header — brand mark + authorized identity pill */}
      <div className="flex justify-between items-center px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.05] ring-1 ring-white/10">
            <ShieldAlert className="w-[18px] h-[18px] text-white/80" />
          </span>
          <span className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/55">VenueOS</span>
        </div>
        <span className="text-[10px] font-semibold uppercase tracking-widest truncate max-w-[55%] text-right text-white/60 rounded-full bg-white/[0.04] ring-1 ring-white/10 px-3 py-1.5">
          {verifiedUser?.email || 'AUTHORIZED'}
        </span>
      </div>

      <div className="px-5 pb-2 text-center">
        <h1 className="text-[1.35rem] font-black tracking-tight text-white">Emergency Trigger</h1>
        {/* 2026-05-03 BUG FIX (cycle 4 emergency-BUG-013) — copy used to
            say "1.5 seconds" but HOLD_DURATION_MS is 3000 (cycle-1 fix
            restoring the CLAUDE.md "Key Safeguards #5" 3-second hold).
            Updated to match actual timer so operators see truthful UX. */}
        <p className="text-white/60 text-[11px] mt-1">Press and hold any button for 3 seconds to broadcast.</p>
      </div>

      {/* 2x3 grid — generous spacing so adjacent buttons aren't easy to fat-finger */}
      <div className="flex-1 grid grid-cols-2 grid-rows-3 gap-x-5 gap-y-4 px-5 pt-2 pb-[max(1.5rem,env(safe-area-inset-bottom))] place-items-center">
        {TYPES.map((type) => {
          const isHolding = holdingId === type.id;
          const isTriggering = phase === 'triggering' && firedType === type.id;
          const dim = phase === 'triggering' && !isTriggering;
          const Icon = type.icon;
          // Rest = dark-glass control with the semantic color as a faint
          // inner glow + ring. Hold = the color fully ignites (solid radial
          // fill) and the whole control depresses (scale-95) — the "punch"
          // that signals an emergency is being armed.
          const restBg =
            `radial-gradient(120% 90% at 50% 22%, rgba(${type.rgb},0.18) 0%, rgba(255,255,255,0.015) 55%),` +
            ' linear-gradient(180deg, rgba(22,28,46,0.92) 0%, rgba(11,16,28,0.96) 100%)';
          const holdBg = `radial-gradient(115% 90% at 50% 18%, ${type.accent} 0%, ${type.dark} 78%)`;
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
              className={`relative aspect-square w-full max-w-[156px] rounded-full flex flex-col items-center justify-center
                transition-all duration-150 outline-none
                ${dim ? 'opacity-30' : ''}
                ${isHolding ? 'scale-95' : ''}
              `}
              style={{
                WebkitTapHighlightColor: 'transparent',
                touchAction: 'none',
                background: isHolding ? holdBg : restBg,
                border: `1px solid ${isHolding ? type.accent : `rgba(${type.rgb},0.40)`}`,
                boxShadow: isHolding
                  ? `0 0 44px rgba(${type.rgb},0.55), inset 0 -7px 0 rgba(0,0,0,0.28)`
                  : `0 0 0 1px rgba(${type.rgb},0.10), 0 12px 30px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.05)`,
              }}
            >
              {/* Progress ring */}
              <svg className="absolute top-0 right-0 bottom-0 left-0 w-full h-full -rotate-90 pointer-events-none" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="46" stroke="rgba(255,255,255,0.10)" strokeWidth="3" fill="none" />
                <circle
                  cx="50" cy="50" r="46"
                  className="transition-[stroke-dashoffset] duration-75"
                  stroke={isHolding ? '#ffffff' : type.accent}
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
                  <Icon
                    className="w-9 h-9 mb-1.5 drop-shadow-md transition-colors"
                    style={{ color: isHolding ? '#ffffff' : type.accent }}
                  />
                  <span
                    className="font-bold uppercase tracking-wider text-xs drop-shadow-md transition-colors"
                    style={{ color: isHolding ? '#ffffff' : 'rgba(255,255,255,0.92)' }}
                  >
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
