"use client";

import { ShieldAlert, Loader2, AlertTriangle, CheckCircle2, Flame, LogIn, Hand, Lock, HeartPulse, CloudLightning, ShieldOff, Volume2, VolumeX } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { broadcastEmergency } from '@/actions/trigger-emergency';
// LIFE-SAFETY (2026-05-23 launch audit P0 #1): use the centralized
// helper so a missing NEXT_PUBLIC_API_URL surfaces a loud warning AND
// the page can detect the misconfiguration to show an explicit error
// instead of silently failing the 5s all-clear poll.
import { warnIfMisconfigured, isLikelyMisconfigured } from '@/lib/api-url';
// 2026-11-14 — the credential is resolved in the BACKGROUND from the first
// frame: the tab's session, else the remembered session (the HttpOnly cookie),
// and only when the browser has neither, sign-in. This page used to redirect
// to /login on a missing token or a 401 without trying the restore. The
// session check is still the bounded /users/me read (6 s, LIFE-SAFETY
// 2026-06-16) — it moved into the hook. See @/lib/panic-auth for the rules.
import { usePanicAuth } from './usePanicAuth';
import { failedStatusOf, type PanicCredential } from '@/lib/panic-auth';
// 2026-11-14 — panic phones: this phone's own credential (HttpOnly cookie,
// read only by /api/panic/*). It sends and reads; it never ends an alert.
import { hasPanicMarker, panicActive, panicEnd, panicEnroll, panicTargets, panicTrigger } from '@/lib/panic-device-client';

// Who may trigger: role OR the delegated `canTriggerPanic` flag. This page's
// own local copy of that rule moved to @/lib/emergency-capability on
// 2026-09-01 — it was the ONLY correct copy of three, and the mobile design
// package §10 requires every emergency ENTRY POINT to use the same one so a
// delegated staffer can actually find the surface they are authorized for.
import { hasPanicAuthority } from '@/lib/emergency-capability';
// Emergency announcements are SILENT by default (§M17). The header carries a
// labeled control that says, in words, that turning voice on lets this phone
// make sound.
import {
  isEmergencyVoiceEnabled,
  setEmergencyVoiceEnabled,
  speakEmergencyIfEnabled,
} from '@/lib/emergency-voice';
// 2026-10-05 — alert targeting: "all screens, a group, or single screens".
// All screens stays the default (zero extra taps); "Choose screens" picks
// ONE group or ONE screen. Live alerts are listed with their targets and
// each one is ended on its own.
import { allClearEmergency } from '@/actions/trigger-emergency';
import { fetchActiveAlerts, fetchEmergencyTargets } from '@/lib/emergency-api';
import {
  DEFAULT_EMERGENCY_MODE,
  activeAlertLabel,
  allClearScopeOf,
  allScreensTarget,
  isAllScreens,
  isSameAlert,
  listsSeveralTenantAlerts,
  targetChipLabel,
  targetSummary,
  typeIdOf,
  type ActiveAlert,
  type EmergencyMode,
  type EmergencyTarget,
  type EmergencyTargets,
} from '@/lib/emergency-target';
import { EmergencyTargetBar } from '@/components/emergency/EmergencyTargetBar';
// 2026-10-10 — LIVE | DRILL. Local state, LIVE on every open, never persisted.
import { LiveDrillSwitch } from '@/components/emergency/LiveDrillSwitch';
import { EmergencyTargetPicker } from '@/components/emergency/EmergencyTargetPicker';
import { PanicActiveAlertsSheet } from '@/components/emergency/PanicActiveAlertsSheet';
import { appConfirm } from '@/components/ui/app-dialog';
import { usePanicLayout, type PanicLayout } from '@/hooks/use-panic-layout';

// 2026-05-03 BUG FIX (cycle 1 emergency BUG-001) — was 1500ms, but
// apps/api/src/emergency/CLAUDE.md "Key Safeguards #5: Hold-to-Trigger UX" requires
// 3 seconds to prevent accidental taps. Life-safety regression
// restored. The animated progress ring matches this duration.
const HOLD_DURATION_MS = 3000;

// 2026-11-14 — a press made while the sign-in check is still running waits
// for it, at most this long after the 3 s hold completes, then sends. Long
// enough for a slow cellular restore (the check started when the page
// opened, so it has had the hold's 3 s already); short enough that a hung
// network turns into "NOT sent — notify security manually" while the person
// can still act on it. Never a silent drop: the outcome is always shown.
const PRESS_AUTH_WAIT_MS = 6000;

/** Where every sign-in from this page goes — back here, with the reason shown. */
const PANIC_SIGN_IN_URL = '/login?redirect=/panic&reason=panic';
/** A FRESH sign-in (the login page does not skip it for a signed-in browser) — what keeping a phone ready needs. */
const PANIC_ENROLL_SIGN_IN_URL = '/login?redirect=/panic&reason=panic-enroll';

/**
 * The two reads, by credential: a dashboard session calls the API with its
 * bearer; a panic phone calls its own origin's /api/panic/*. Errors carry
 * "failed: <status>" either way, so the 401 handling below is one path.
 */
async function readActive(c: PanicCredential): Promise<ActiveAlert[]> {
  if (c.kind === 'session') return fetchActiveAlerts(c.token, 4000);
  const r = await panicActive();
  if (!r.ok) throw new Error(`/api/panic/active failed: ${r.outcome === 'refused' ? 401 : r.status || 503}`);
  return Array.isArray(r.body?.alerts) ? (r.body.alerts as ActiveAlert[]) : [];
}
async function readTargets(c: PanicCredential): Promise<EmergencyTargets> {
  if (c.kind === 'session') return fetchEmergencyTargets(c.token);
  const r = await panicTargets();
  if (!r.ok) throw new Error(`/api/panic/targets failed: ${r.outcome === 'refused' ? 401 : r.status || 503}`);
  return r.body as EmergencyTargets;
}

// Full SRP — same id strings + order as the dashboard EmergencyTriggerModal.
// 2026-06-15 redesign: dropped the six fully-saturated rainbow circles for the
// VenueOS premium-dark control board. Each type keeps its semantic SRP color
// (life-safety meaning is preserved + the page still reads as "emergency"),
// but renders as a dark-glass control with that color as a GLOW ACCENT at rest
// that fully ignites to a solid fill on hold. `accent` = the live color, `dark`
// = the bottom of the hold-fill gradient, `rgb` = the same color as a raw
// triplet for rgba() glow/tint composition in inline styles (Tailwind can't
// build class names from runtime values, so the per-type look is inline).
//
// i18n (X7, 2026-08-25): the display NAME moved out of this module-level
// table into the catalog (`emergency.types.<id>.name`) so it follows the
// operator's language — `id` is the lookup key and stays a stable English
// identifier (it is also the wire value sent to /emergency/trigger).
const TYPES = [
  { id: 'hold',     icon: Hand,           accent: '#f5a623', dark: '#b9791a', rgb: '245,166,35'  },
  { id: 'secure',   icon: Lock,           accent: '#3b82f6', dark: '#1d4ed8', rgb: '59,130,246'  },
  { id: 'lockdown', icon: ShieldAlert,    accent: '#ef4444', dark: '#b91c1c', rgb: '239,68,68'   },
  { id: 'evacuate', icon: Flame,          accent: '#f97316', dark: '#c2410c', rgb: '249,115,22'  },
  { id: 'weather',  icon: CloudLightning, accent: '#22d3ee', dark: '#0e7490', rgb: '34,211,238'  },
  { id: 'medical',  icon: HeartPulse,     accent: '#10b981', dark: '#047857', rgb: '16,185,129'  },
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

// ── The idle panel's four shapes (2026-11-23; see @/hooks/use-panic-layout) ──
// Every class string is a module-level literal so Tailwind sees it whole. The
// TALL strings are the panel's classes from before this change, character for
// character; 800 px and taller renders exactly what it did.
//
// DENSE (compact and both landscapes): spacing only, nothing hidden. About
// 296.5 px of stack with the alert line at 390 wide (331.9 before), 242.5
// without (275.9).
const HEADER_CLS = 'flex justify-between items-center gap-3 px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-3';
const HEADER_DENSE_CLS = 'flex justify-between items-center gap-3 px-5 pt-[max(0.5rem,env(safe-area-inset-top))] pb-1';
const AUTH_LINE_CLS = 'mx-5 mb-1 flex items-center justify-center gap-2 rounded-xl bg-white/[0.04] ring-1 ring-white/10 px-3 py-2 text-[11px] font-semibold text-white/75';
const AUTH_LINE_DENSE_CLS = 'mx-5 mb-1 flex items-center justify-center gap-2 rounded-xl bg-white/[0.04] ring-1 ring-white/10 px-3 py-1 text-[11px] font-semibold text-white/75';
const TITLE_CLS = 'px-5 pb-2 text-center';
const TITLE_DENSE_CLS = 'px-5 pb-1 text-center';
const H1_CLS = 'text-[1.35rem] font-black tracking-tight text-white';
const H1_DENSE_CLS = 'text-[1.35rem] font-black tracking-tight text-white leading-tight';
const HOLD_HINT_CLS = 'text-[11px] mt-1';
const HOLD_HINT_DENSE_CLS = 'text-[11px] mt-0.5';
const CONTROLS_CLS = 'px-5 pb-1 space-y-2';
const CONTROLS_DENSE_CLS = 'px-5 pb-1 space-y-1.5';
// THE GRID: the same element in the same slot in every shape; only its class
// and style change. Each button is `h-full` (its row) capped by
// `--panic-btn-max` (its column, from the viewport width, and 156 px), so it
// is min(row, column, 156) and round. Longhand sides only, never `inset`.
const GRID_CLS = 'flex-1 min-h-0 grid grid-cols-2 grid-rows-3 gap-x-5 gap-y-4 px-5 pt-2 pb-[max(1.5rem,env(safe-area-inset-bottom))] place-items-center';
const GRID_COMPACT_CLS = 'flex-1 min-h-0 grid grid-cols-3 grid-rows-2 gap-x-4 gap-y-3 px-3 pt-1 pb-[max(0.75rem,env(safe-area-inset-bottom))] place-items-center';
const GRID_COMPACT_STYLE = { '--panic-btn-max': 'min(156px, calc((100vw - 3.5rem) / 3))' } as React.CSSProperties;
// Landscape: the grid is `fixed` to the right of the status column, out of
// the root's flow, so the column can scroll (to the card) while the buttons
// never move. 3 × 2 fills by row: Hold / Secure / Lockdown on top, Fire /
// Evacuate / Shelter / Medical below (the SRP reading order, and DOM order).
const GRID_LAND3X2_CLS = 'fixed top-0 right-0 bottom-0 grid grid-cols-3 grid-rows-2 gap-x-4 gap-y-4 pl-2 pr-[max(1.25rem,env(safe-area-inset-right))] pt-[max(0.5rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))] place-items-center';
const GRID_LAND3X2_STYLE = {
  left: 'var(--panic-status-w)',
  '--panic-btn-max': 'min(156px, calc((100vw - var(--panic-status-w) - 0.5rem - max(1.25rem, env(safe-area-inset-right)) - 2rem) / 3))',
} as React.CSSProperties;
const GRID_LAND2X3_CLS = 'fixed top-0 right-0 bottom-0 grid grid-cols-2 grid-rows-3 gap-x-4 gap-y-4 pl-2 pr-[max(1.25rem,env(safe-area-inset-right))] pt-[max(0.5rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))] place-items-center';
const GRID_LAND2X3_STYLE = {
  left: 'var(--panic-status-w)',
  '--panic-btn-max': 'min(156px, calc((100vw - var(--panic-status-w) - 0.5rem - max(1.25rem, env(safe-area-inset-right)) - 1rem) / 2))',
} as React.CSSProperties;
// Landscape root: its own flow is the status column, 340–400 px wide (the
// right padding gives the rest of the width to the fixed grid). NEVER add
// transform, filter, will-change or contain to the root: any of them makes
// it the containing block of the `fixed` grid, which would then scroll with
// the status column.
const LAND_ROOT_STYLE = {
  ...PAGE_STYLE,
  '--panic-status-w': 'clamp(340px, 40vw, 400px)',
  paddingRight: 'calc(100% - var(--panic-status-w))',
} as React.CSSProperties;
const GRID_BY_LAYOUT: Record<PanicLayout, { className: string; style: React.CSSProperties | undefined }> = {
  tall: { className: GRID_CLS, style: undefined },
  compact: { className: GRID_COMPACT_CLS, style: GRID_COMPACT_STYLE },
  land3x2: { className: GRID_LAND3X2_CLS, style: GRID_LAND3X2_STYLE },
  land2x3: { className: GRID_LAND2X3_CLS, style: GRID_LAND2X3_STYLE },
};

export default function MobilePanicPage() {
  const router = useRouter();
  // i18n (X7, 2026-08-25): every operator-visible string here — including
  // the aria-live announcements a screen reader speaks — resolves through
  // the catalog. `type.id` stays English (wire value + lookup key).
  const t = useTranslations();
  const typeName = (id: string) => t(`emergency.types.${id}.name`);
  // 2026-11-14 — who this phone sends as, resolved in the background. The
  // grid is shown from the first frame (`phase` starts at 'idle'); a press
  // made before the check finishes waits for it (see fireEmergency).
  const { state: authState, auth } = usePanicAuth();
  const credential: PanicCredential | null = authState.status === 'ready' ? authState.credential : null;
  const verifiedUser: any = credential?.user ?? null;
  const verifiedToken: string | null = credential?.token ?? null;
  // LIFE-SAFETY (2026-05-23 launch audit P0 #1): on a forgotten-env
  // deploy the page would silently fall back to localhost; surface
  // it instead so the operator knows their alert path is broken.
  const [phase, setPhase] = useState<'idle' | 'triggering' | 'triggered' | 'error' | 'unauthorized' | 'misconfigured'>('idle');
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

  // Spoken announcements — OFF unless this browser opted in (§M17). Read
  // AFTER mount, never during render: localStorage does not exist on the
  // server and a render-time read would hydration-mismatch the header.
  const [voiceOn, setVoiceOn] = useState(false);
  useEffect(() => { setVoiceOn(isEmergencyVoiceEnabled()); }, []);
  const toggleVoice = () => {
    const next = !voiceOn;
    setVoiceOn(next);
    setEmergencyVoiceEnabled(next);
    // Confirm the new setting in the medium it controls — turning voice ON
    // should immediately demonstrate that this device will now make sound.
    if (next) speakEmergencyIfEnabled(t('emergency.panic.voiceOnConfirm'));
  };

  const holdTimerRef = useRef<NodeJS.Timeout | null>(null);
  const progressTimerRef = useRef<NodeJS.Timeout | null>(null);

  // ── WHERE the alert goes (alert targeting, 2026-10-05) ────────────────
  // `chosenTarget` null = All screens, the default and the only target this
  // page had before. The list behind "Choose screens" is read once after
  // sign-in (never polled) and is never on the trigger's critical path: if it
  // fails, All screens still sends — only its count is missing.
  const [targets, setTargets] = useState<EmergencyTargets | null>(null);
  const [targetsStatus, setTargetsStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [chosenTarget, setChosenTarget] = useState<EmergencyTarget | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // ── LIVE or DRILL (2026-10-10) ─────────────────────────────────────────
  // `useState(DEFAULT_EMERGENCY_MODE)`: this page opens in LIVE every time.
  // The mode is captured when a hold STARTS (like the target) and goes back
  // to LIVE after a drill is sent — the next press is the real thing unless
  // the operator flips it again. Drill = indigo chrome + "DRILL" on every
  // button; the 3-second hold is the same.
  const [mode, setMode] = useState<EmergencyMode>(DEFAULT_EMERGENCY_MODE);
  const isDrill = mode === 'drill';
  // Live alerts (each with its target) — from the 5 s poll below, which used
  // to read only the tenant-wide status and so could not see, or wait on, a
  // group / one-screen alert.
  const [activeAlerts, setActiveAlerts] = useState<ActiveAlert[] | null>(null);
  const [alertsSheetOpen, setAlertsSheetOpen] = useState(false);
  // The alert this page just sent: what the "Broadcasted" screen describes and
  // waits on. A ref copy for the poll, which must not restart when it changes.
  const [sentAlert, setSentAlert] = useState<{ overrideId?: string; target: EmergencyTarget; isDrill?: boolean } | null>(null);
  const firedRef = useRef<{ overrideId?: string; target: EmergencyTarget; isDrill?: boolean } | null>(null);
  // The overrideId of an "All screens" alert sent from this page, so its
  // all-clear pairs with the trigger in the audit log. Since EMG-01 the
  // active list carries the tenant-wide alert's own id, which wins; this is
  // the fallback for an alert raised before that (its entry's id is null).
  // Same chain-of-custody rule as the dashboard overlay (P2 #3).
  const tenantOverrideIdRef = useRef<string | undefined>(undefined);

  const allScreens = allScreensTarget(verifiedUser?.tenantId ?? '', targets?.allScreensCount ?? null);
  const target: EmergencyTarget = chosenTarget ?? allScreens;
  // EMG-01 review round 2 — a tenant-wide entry is keyed by its tenant AND its
  // id, so two entries never share a key even if a server lists one alert on
  // two tenants (the sheet's list key and its selection).
  const alertKey = (a: ActiveAlert) =>
    a.scopeType === 'tenant' ? `tenant:${a.scopeId}:${a.alertId ?? ''}` : a.alertId ?? `${a.scopeType}:${a.scopeId}`;
  // Review round 2 — the alert a 409 ALERT_CHANGED said is live now, and the
  // id it replaced. If the list cannot be re-read, the sheet would otherwise
  // keep offering the replaced alert and every hold would get another 409. A
  // fresh hold on that entry ends the alert the message named instead.
  const supersededRef = useRef<{ tenantId: string; replacedId: string; alertId: string; isDrill: boolean } | null>(null);
  const alertTypeName = (apiType: string | null) => {
    const id = typeIdOf(apiType);
    return id ? typeName(id) : (apiType || t('emergency.active'));
  };
  // EMG-01 review round 3 — with two tenant-wide alerts listed (the
  // district's and a school's own), each is named by its location.
  const nameLocation = listsSeveralTenantAlerts(activeAlerts ?? []);
  const alertLabel = (a: ActiveAlert) => activeAlertLabel(t, alertTypeName(a.type), a, { nameLocation });

  // A11y audit (2026-05-25): update the live region so a screen reader
  // follows the trigger lifecycle.
  //
  // SILENT BY DEFAULT (2026-09-01, mobile design package §M17 "Do not speak
  // aloud by default" + §15 "do not duplicate [SR announcements] with forced
  // text-to-speech"). The live region below is untouched — it is the actual
  // ADA Title II / Section 504 mechanism, and with speech off a screen-reader
  // user gets exactly the same assertive announcement, once instead of twice.
  // The spoken utterance is now opt-in per browser, because a phone that says
  // "Holding lockdown alert…" out loud from a pocket can be the wrong thing
  // during the exact event this page exists for. See @/lib/emergency-voice.
  const announce = (text: string) => {
    setAnnouncement(text);
    speakEmergencyIfEnabled(text);
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
    if (!credential || !verifiedUser?.tenantId) return;
    const readWith = credential;

    let cancelled = false;
    const check = async () => {
      try {
        // 2026-10-05 — reads every live alert WITH its target, not just the
        // tenant-wide status: a group / one-screen alert never touches
        // `tenantStatus`, so the old read would have flashed "All Clear" the
        // moment a targeted alert was sent. 4s < the 5s poll interval, so a
        // stalled poll is aborted before the next one fires — no pile-up of
        // hung requests.
        const alerts = await readActive(readWith);
        if (cancelled) return;
        setActiveAlerts(alerts);
        const sent = firedRef.current;
        const stillOn = sent ? alerts.some((a) => isSameAlert(a, sent)) : true;
        if (!stillOn && phase === 'triggered') {
          // Admin cleared it. Flash All Clear, then return to idle so
          // staff can re-fire if they need to.
          setJustCleared(true);
          announce(t('emergency.panic.annAllClear'));
          setTimeout(() => {
            if (cancelled) return;
            setPhase('idle');
            setFiredType(null);
            setSentAlert(null);
            firedRef.current = null;
            setJustCleared(false);
          }, 2500);
        }
      } catch (err) {
        // Network blip — next tick retries. A 401 is different: the hour-long
        // access token lapsed while this page sat open, and every later tick
        // would fail the same way, so the "All Clear" would never show. One
        // remembered-session restore (single-flight; the next tick uses the
        // new token). Never a redirect from here.
        if (!cancelled && failedStatusOf(err instanceof Error ? err.message : '') === 401) void auth.recover();
      }
    };
    check();
    // Renamed from `t` (2026-08-25): `t` is now the translator in the
    // component scope and this local would shadow it inside the effect.
    // Same interval, same cadence, same cleanup.
    const poll = setInterval(check, 5000);
    return () => { cancelled = true; clearInterval(poll); };
    // `t` is deliberately NOT a dependency (i18n X7, 2026-08-25). It is only
    // read inside `check()` at announce time, so it always sees the current
    // translator; adding it would tear down and restart the 5s all-clear poll
    // every time the operator switches language. Dep array unchanged.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, credential, verifiedUser?.tenantId]);

  // The groups and screens behind "Choose screens" — read ONCE per signed-in
  // session (and on Retry), never polled.
  const loadTargets = async (c: PanicCredential) => {
    setTargetsStatus('loading');
    try {
      setTargets(await readTargets(c));
      setTargetsStatus('ready');
    } catch (err) {
      setTargetsStatus('error');
      // A lapsed token: one restore; the new credential re-runs this read.
      if (failedStatusOf(err instanceof Error ? err.message : '') === 401) void auth.recover();
    }
  };
  const authorized = hasPanicAuthority(verifiedUser);
  useEffect(() => {
    if (!credential || !verifiedUser?.tenantId || !authorized) return;
    void loadTargets(credential);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [credential, verifiedUser?.tenantId, authorized]);

  /** End exactly one live alert. Resolves with the server's verdict. */
  const endAlert = async (alert: ActiveAlert): Promise<{ ok: boolean; error?: string }> => {
    // A panic phone can raise, never release: ending an alert needs a full sign-in.
    if (credential?.kind === 'device') return { ok: false, error: t('emergency.panic.endNeedsSignIn') };
    if (!verifiedToken || !verifiedUser?.tenantId) return { ok: false, error: t('emergency.panic.errNoToken') };
    const sup = supersededRef.current;
    // The id this entry names for a session of tenant `tenantId`, before any
    // aim. Review round 3 — computed from the SAME tenant the request is sent
    // under: after a 401 the resend may run under a restored session of
    // another tenant, and the aim and the 409 bookkeeping below must follow
    // the id that request actually named, never the first session's.
    const namedFor = (tenantId: string) =>
      alert.alertId ??
      (alert.scopeType === 'tenant' && alert.scopeId === tenantId ? tenantOverrideIdRef.current : undefined);
    /** What the request whose answer is in `result` named, before any aim. */
    let named: string | undefined;
    const clearWith = (token: string, tenantId: string) => {
      named = namedFor(tenantId);
      const aimed =
        sup && alert.scopeType === 'tenant' && alert.scopeId === sup.tenantId && named === sup.replacedId ? sup : null;
      return allClearEmergency({
        // The tenant-wide entry's scopeId IS the tenant to clear.
        schoolId: alert.scopeType === 'tenant' ? alert.scopeId : tenantId,
        token,
        overrideId: aimed ? aimed.alertId : named,
        // Its own scope — or, if that target was deleted mid-alert, the scope
        // the server says still reaches it.
        ...allClearScopeOf(alert),
        // Ending a DRILL may end drill state only — never a live alert that
        // replaced it between this list's reads.
        ...((aimed ? aimed.isDrill : alert.isDrill === true) ? { isDrill: true } : {}),
      });
    };
    let result = await clearWith(verifiedToken, verifiedUser.tenantId);
    // 2026-11-14 — a 401 is refused before the server does anything, so one
    // remembered-session restore and one resend can never clear twice.
    if (!result?.success && failedStatusOf(result?.error) === 401) {
      const next = await auth.recover();
      // Only a dashboard session may end an alert — never a panic phone.
      if (next?.kind === 'session') result = await clearWith(next.token, next.user.tenantId);
    }
    if (!result?.success && result?.code === 'ALERT_CHANGED') {
      // EMG-01 (2026-11-21) — a newer alert replaced the one this all-clear
      // named, and the server cleared NOTHING. Re-read the list so the sheet
      // shows the alert that is live now; ending it takes its own hold.
      if (alert.scopeType === 'tenant') tenantOverrideIdRef.current = undefined;
      const current = result.currentAlert ?? null;
      // Keyed on what this entry names (before any aim), so a third alert
      // replacing the one aimed at moves the aim on, never back.
      const replacedId = named;
      supersededRef.current =
        current && replacedId && replacedId !== current.alertId && alert.scopeType === 'tenant'
          ? { tenantId: alert.scopeId, replacedId, alertId: current.alertId, isDrill: current.isDrill === true }
          : null;
      let fresh: ActiveAlert[] | null = null;
      try { if (credential) { fresh = await readActive(credential); setActiveAlerts(fresh); } } catch { /* next poll */ }
      // The re-read failed: show the alert the 409 named in place of the one
      // it replaced, so the sheet matches the message (the next poll that
      // succeeds replaces it).
      const supNow = supersededRef.current;
      if (!fresh && supNow && current) {
        setActiveAlerts((prev) =>
          prev
            ? prev.map((a) =>
                a.scopeType === 'tenant' && a.scopeId === supNow.tenantId && a.alertId === supNow.replacedId
                  ? { ...a, alertId: current.alertId, type: current.type ?? a.type, isDrill: current.isDrill === true }
                  : a,
              )
            : prev,
        );
      }
      // The 409 names the newer alert's type; if it did not, the list just
      // re-read does (the same target's entry).
      const newerType =
        result.currentAlertType ??
        fresh?.find((a) => a.scopeType === alert.scopeType && a.scopeId === alert.scopeId)?.type ??
        null;
      return { ok: false, error: t('emergency.panic.alertChanged', { type: alertTypeName(newerType) }) };
    }
    if (!result?.success) {
      const raw = result?.error || '';
      if (raw.includes('401') || raw.includes('403')) return { ok: false, error: t('emergency.panic.errNoAuthority') };
      if (raw.toLowerCase().includes('network') || raw.toLowerCase().includes('fetch')) return { ok: false, error: t('emergency.panic.errNetwork') };
      return { ok: false, error: raw || t('emergency.panic.errGeneric') };
    }
    if (alert.scopeType === 'tenant') tenantOverrideIdRef.current = undefined;
    supersededRef.current = null;
    // Re-read now so the list (and the lock it describes) updates at once.
    try { if (credential) setActiveAlerts(await readActive(credential)); } catch { /* next poll */ }
    return { ok: true };
  };

  // LIFE-SAFETY (audit P0 #1): if the deploy is missing NEXT_PUBLIC_API_URL
  // the alert path is broken end-to-end. Surface a hard error instead of
  // letting the page act as if it's working.
  useEffect(() => {
    warnIfMisconfigured();
    if (isLikelyMisconfigured()) setPhase('misconfigured');
  }, []);

  // LIFE-SAFETY: the authority gate still comes from the LIVE /users/me row
  // (or the restore's own answer) — a user without authority is shown the
  // "no trigger authority" screen as soon as that is known, and a press made
  // before it is known is never sent (fireEmergency). 2026-11-14: what changed
  // is that nothing here redirects any more; `usePanicAuth` decides between
  // the session, the remembered session and sign-in, in that order.
  const lacksAuthority = authState.status === 'ready' && !hasPanicAuthority(authState.credential.user);

  // ── KEEP THIS PHONE READY (2026-11-14, panic phones) ──────────────────
  // Offered once a person with authority is signed in on this phone with a
  // dashboard session and the phone is not yet ready. One tap mints the
  // panic credential (the API asks for a sign-in in the last 15 minutes; an
  // older one is sent through a fresh sign-in first). Never automatic.
  const [phoneReady, setPhoneReady] = useState(false);
  useEffect(() => { setPhoneReady(hasPanicMarker()); }, [authState]);
  const [enrollState, setEnrollState] = useState<'idle' | 'working' | 'done' | 'stale' | 'unavailable' | 'failed' | 'dismissed'>('idle');
  const keepPhoneReady = async () => {
    if (credential?.kind !== 'session') return;
    setEnrollState('working');
    const r = await panicEnroll(credential.token);
    if (r.ok && r.body?.enrolled) {
      setEnrollState('done');
      setPhoneReady(true);
      announce(t('emergency.panic.keepReadyDone'));
      return;
    }
    const reason = !r.ok ? r.body?.reason : null;
    setEnrollState(reason === 'stale-login' ? 'stale' : reason === 'unavailable' ? 'unavailable' : 'failed');
  };
  const turnOffThisPhone = async () => {
    const ok = await appConfirm({
      title: t('emergency.panic.turnOffTitle'),
      message: t('emergency.panic.turnOffMessage'),
      confirmLabel: t('emergency.panic.turnOffConfirm'),
    });
    if (!ok) return;
    await panicEnd();
    setPhoneReady(false);
    setEnrollState('idle');
    void auth.resolve();
  };
  // 2026-11-23 — on a short screen (under 800 px tall: a phone browser with
  // its toolbars, an installed app on a small phone, a short laptop window)
  // the six trigger buttons own the space and the panic-phone row moves
  // below them; on a phone held sideways the buttons get their own area to
  // the right of a status column. See the idle return and
  // @/hooks/use-panic-layout.
  const layout = usePanicLayout();
  const dense = layout !== 'tall';
  const landscape = layout === 'land2x3' || layout === 'land3x2';
  // The panic-phone row sits before the grid where it does not take the
  // buttons' height: 800 px and taller (as always), and in landscape, where
  // that slot is in the status column.
  const rowAbove = layout === 'tall' || landscape;
  const announcedReadyRef = useRef(false);
  useEffect(() => {
    if (authState.status !== 'ready' || announcedReadyRef.current) return;
    if (!hasPanicAuthority(authState.credential.user)) return;
    announcedReadyRef.current = true;
    announce(t('emergency.panic.annReady'));
    // `t` is deliberately NOT a dependency (i18n X7, 2026-08-25): it is only
    // read to build the "panel ready" announcement, once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authState]);

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
    // The target AND the mode are fixed when the hold STARTS: what the
    // operator saw on the "Send to" line and the LIVE | DRILL switch is what
    // is sent, whatever happens in the next 3 s.
    const sendTarget = target;
    const sendMode = mode;
    const type = TYPES.find((ty) => ty.id === typeId);
    if (type) {
      announce(
        sendMode === 'drill'
          ? t('emergency.drill.announceHolding', { type: typeName(type.id), target: targetChipLabel(t, sendTarget) })
          : t('emergency.target.announceHolding', { type: typeName(type.id), target: targetChipLabel(t, sendTarget) }),
      );
    }
    progressTimerRef.current = setInterval(() => {
      const pct = Math.min(((Date.now() - startTime) / HOLD_DURATION_MS) * 100, 100);
      setProgress(pct);
    }, 50);
    holdTimerRef.current = setTimeout(() => fireEmergency(typeId, sendTarget, sendMode), HOLD_DURATION_MS);
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

  const fireEmergency = async (typeId: string, sendTarget: EmergencyTarget, sendMode: EmergencyMode = 'live') => {
    clearHold();
    setPhase('triggering');
    setFiredType(typeId);
    const drill = sendMode === 'drill';
    const summary = targetSummary(t, typeName(typeId), sendTarget);
    announce(drill ? t('emergency.drill.announceSending', { summary }) : t('emergency.target.announceSending', { summary }));
    try {
      // 2026-11-14 — NEVER SEND WITHOUT A CREDENTIAL, NEVER DROP THE PRESS. A
      // hold that completes while the sign-in check is still running waits
      // for it (bounded), then sends. If there is no credential to send with,
      // the failure screen says the alert was NOT sent — it never looks sent.
      const press = await auth.credentialForPress(PRESS_AUTH_WAIT_MS);
      if (!press.credential) {
        throw new Error(
          press.reason === 'signin'
            ? t('emergency.panic.errSignInNeeded')
            : press.reason === 'timeout'
              ? t('emergency.panic.errSignInTimeout')
              : t('emergency.panic.errNetwork'),
        );
      }
      let cred = press.credential;
      // LIFE-SAFETY: the authority gate holds for a press made before it was
      // known — an account without authority is shown that, never a send.
      if (!hasPanicAuthority(cred.user)) {
        setPhase('unauthorized');
        announce(t('emergency.panic.noAuthorityLead'));
        return;
      }
      if (!cred.user?.tenantId) throw new Error(t('emergency.panic.errNoSchool'));
      const send = async (c: PanicCredential) => {
        if (c.kind === 'device') {
          // 2026-11-14 — sent with this phone's panic credential: the same
          // type / drill / target, through /api/panic/trigger. Mapped onto the
          // server action's result shape so every error path below is shared.
          const r = await panicTrigger({
            type: typeId,
            ...(drill ? { isDrill: true as const } : {}),
            ...(isAllScreens(sendTarget) ? {} : { target: { scopeType: sendTarget.scopeType as 'group' | 'device', scopeId: sendTarget.scopeId } }),
          });
          if (r.ok) {
            return {
              success: true,
              overrideId: typeof r.body?.overrideId === 'string' ? r.body.overrideId : undefined,
              ...(typeof r.body?.affectedScreenCount === 'number' ? { affectedScreenCount: r.body.affectedScreenCount } : {}),
            };
          }
          if (r.status === 0) return { success: false, error: 'Network error reaching the server (fetch)' };
          const status = r.outcome === 'refused' ? 401 : r.status;
          return {
            success: false,
            error: `Emergency broadcast failed: ${status}${r.body?.message ? ` — ${r.body.message}` : ''}`,
            ...(typeof r.body?.code === 'string' ? { code: r.body.code } : {}),
          };
        }
        return broadcastEmergency({
          schoolId: c.user.tenantId,
          type: typeId,
          triggeredBy: c.user.id || 'unknown',
          token: c.token,
          // All screens sends NO target — the exact request this page has
          // always sent. Only a chosen group / screen adds one.
          ...(isAllScreens(sendTarget)
            ? {}
            : { target: { scopeType: sendTarget.scopeType as 'group' | 'device', scopeId: sendTarget.scopeId } }),
          // A drill adds exactly one key; LIVE adds nothing.
          ...(drill ? { isDrill: true } : {}),
        });
      };
      let result: { success: boolean; error?: string; code?: string; overrideId?: string; affectedScreenCount?: number } = await send(cred);
      if (result?.error && failedStatusOf(result.error) === 401) {
        // The session lapsed between the check and the press. A 401 is
        // refused before the server does anything, so one remembered-session
        // restore and ONE resend can never send the alert twice.
        const next = await auth.recover();
        if (next) {
          if (!hasPanicAuthority(next.user)) {
            setPhase('unauthorized');
            announce(t('emergency.panic.noAuthorityLead'));
            return;
          }
          cred = next;
          result = await send(next);
        }
      }
      if (result?.error) {
        // A drill refused because a live alert is on (409): say so in plain
        // words rather than "could not reach the server".
        if (result.code === 'EMERGENCY_DRILL_BLOCKED_BY_LIVE_ALERT' || result.error.includes('409')) {
          throw new Error(t('emergency.drill.blocked'));
        }
        // LIFE-SAFETY (audit P1 #7): differentiate auth vs network vs
        // server errors. Previously every 4xx/5xx collapsed to "Session
        // expired" which misroutes the operator during a real incident.
        // A 401 that survived the restore = signed out; a 403 = no authority.
        if (failedStatusOf(result.error) === 401) {
          throw new Error(t('emergency.panic.errSignInNeeded'));
        }
        if (result.error.includes('401') || result.error.includes('403')) {
          throw new Error(t('emergency.panic.errNoAuthority'));
        }
        if (result.error.toLowerCase().includes('network') || result.error.toLowerCase().includes('fetch')) {
          throw new Error(t('emergency.panic.errNetwork'));
        }
        throw new Error(result.error);
      }
      // "All screens" is the sender's own tenant. The target captured when
      // the hold started may predate knowing who is signed in, and the poll
      // below matches a tenant-wide alert by that id.
      const sentTarget: EmergencyTarget = isAllScreens(sendTarget)
        ? allScreensTarget(cred.user.tenantId, sendTarget.screenCount ?? null)
        : sendTarget;
      // What the "Broadcasted" screen describes and the poll waits on. The
      // server's own count wins when it reports one (whole displays counted).
      const sent = {
        overrideId: result?.overrideId,
        target:
          typeof result?.affectedScreenCount === 'number'
            ? { ...sentTarget, screenCount: result.affectedScreenCount }
            : sentTarget,
        isDrill: drill,
      };
      if (isAllScreens(sendTarget)) tenantOverrideIdRef.current = result?.overrideId;
      firedRef.current = sent;
      setSentAlert(sent);
      // The NEXT alert starts from All screens again. Under stress nobody
      // re-reads the "Send to" line; if the next press is an escalation, the
      // whole building is the safe direction to be wrong in — never one room.
      setChosenTarget(null);
      // …and from LIVE again, for the same reason: a drill is the exception
      // the operator asked for once, never a state this phone remembers.
      setMode(DEFAULT_EMERGENCY_MODE);
      setPhase('triggered');
      announce(
        drill
          ? t('emergency.drill.announceSent', { summary: targetSummary(t, typeName(typeId), sent.target) })
          : t('emergency.target.announceSent', { summary: targetSummary(t, typeName(typeId), sent.target) }),
      );
    } catch (e: any) {
      console.error('[PANIC] Emergency trigger failed:', e);
      const msg = e.message || t('emergency.panic.errGeneric');
      setErrorMsg(msg);
      setPhase('error');
      announce(t('emergency.target.announceFailed', { summary, error: msg }));
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
        <h1 className="text-2xl font-black mb-2 uppercase tracking-tight text-center" style={{ color: '#f87171' }}>{t('emergency.panic.notConfiguredTitle')}</h1>
        <p className="text-white/80 mb-3 max-w-[300px] text-center text-sm font-bold">
          {t('emergency.panic.notConfiguredLead')}
        </p>
        <p className="text-white/65 mb-8 max-w-[300px] text-center text-xs leading-relaxed">
          {t('emergency.panic.notConfiguredBody')}
        </p>
      </div>
    );
  }

  // 2026-11-14 — SIGN-IN, ONLY WHEN THERE IS NOTHING TO RESTORE. Reached only
  // after the remembered session was tried and this browser has none (no
  // cookie, or the API refused it) — never on a network failure, never while
  // the check is still running. It says what it is for, and what to do in an
  // emergency right now, before it asks for a password.
  if (phase === 'idle' && authState.status === 'signin') {
    return (
      <div className={`${PAGE_CLS} items-center justify-center p-6`} style={PAGE_STYLE} data-testid="panic-sign-in">
        {LiveRegion}
        <div className="relative mb-6 flex items-center justify-center">
          <span
            className="absolute h-24 w-24 rounded-3xl"
            style={{ background: 'rgba(239,68,68,0.10)', boxShadow: '0 0 48px rgba(239,68,68,0.28)' }}
          />
          <ShieldAlert className="relative w-12 h-12" style={{ color: '#f87171' }} />
        </div>
        <h1 className="text-2xl font-black mb-2 tracking-tight text-center text-white">{t('emergency.panic.signInTitle')}</h1>
        <p className="text-white/80 mb-3 max-w-[300px] text-center text-sm font-bold">
          {t('emergency.panic.signInLead')}
        </p>
        <p className="text-white/65 mb-8 max-w-[300px] text-center text-xs leading-relaxed">
          {t('emergency.panic.signInBody')}
        </p>
        <button
          type="button"
          onClick={() => router.push(PANIC_SIGN_IN_URL)}
          data-testid="panic-sign-in-button"
          className="w-full max-w-xs px-8 py-3 rounded-2xl font-bold uppercase tracking-wider text-sm flex items-center justify-center gap-2 min-h-[52px] text-white transition-transform active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          style={{ background: 'linear-gradient(160deg, #ef4444, #b91c1c)', boxShadow: '0 0 32px rgba(239,68,68,0.35)' }}
        >
          <LogIn className="w-4 h-4" /> {t('emergency.panic.signInButton')}
        </button>
      </div>
    );
  }

  // LIFE-SAFETY (audit P0 #3): user is authenticated but lacks the
  // capability to trigger emergencies. Show that explicitly so they
  // know not to rely on this surface during a real incident.
  if (phase === 'unauthorized' || (phase === 'idle' && lacksAuthority)) {
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
        <h1 className="text-2xl font-black mb-2 uppercase tracking-tight text-center" style={{ color: '#fbbf24' }}>{t('emergency.panic.noAuthorityTitle')}</h1>
        <p className="text-white/80 mb-3 max-w-[300px] text-center text-sm font-bold">
          {t('emergency.panic.noAuthorityLead')}
        </p>
        <p className="text-white/65 mb-8 max-w-[300px] text-center text-xs leading-relaxed">
          {t('emergency.panic.noAuthorityBody')}
        </p>
        <button
          onClick={() => router.push(PANIC_SIGN_IN_URL)}
          className="px-8 py-3 rounded-2xl font-bold uppercase tracking-wider text-sm flex items-center justify-center gap-2 min-h-[48px] bg-white/[0.04] border border-white/10 text-white/85 active:bg-white/[0.08] transition-colors"
        >
          <LogIn className="w-4 h-4" /> {t('emergency.panic.switchAccount')}
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
        <h1 className="text-3xl font-black mb-2 tracking-tight" style={{ color: '#f87171' }}>{t('emergency.panic.failedTitle')}</h1>
        {/* LIFE-SAFETY (audit P1 #7): error copy now spells out the
            "alert was NOT broadcast — notify security manually" guidance
            explicitly, then surfaces the technical reason. */}
        <p className="text-white/80 mb-3 max-w-[300px] text-center text-sm font-bold">
          {t('emergency.panic.failedLead')}
        </p>
        <p className="text-white/65 mb-6 max-w-[300px] text-center text-xs leading-relaxed">
          {t('emergency.panic.failedBody')}
        </p>
        <p className="text-white/55 mb-8 max-w-[280px] text-center text-xs italic">{errorMsg}</p>
        <div className="flex flex-col gap-3 w-full max-w-xs">
          <button
            onClick={() => { setPhase('idle'); setErrorMsg(''); setFiredType(null); }}
            className="px-8 py-3 rounded-2xl font-bold uppercase tracking-wider text-sm min-h-[48px] text-white transition-transform active:scale-[0.98]"
            style={{ background: 'linear-gradient(160deg, #ef4444, #b91c1c)', boxShadow: '0 0 32px rgba(239,68,68,0.35)' }}
          >
            {t('emergency.panic.tryAgain')}
          </button>
          <button
            onClick={() => router.push(PANIC_SIGN_IN_URL)}
            className="px-8 py-3 rounded-2xl font-bold uppercase tracking-wider text-sm flex items-center justify-center gap-2 min-h-[48px] bg-white/[0.04] border border-white/10 text-white/85 active:bg-white/[0.08] transition-colors"
          >
            <LogIn className="w-4 h-4" /> {t('emergency.panic.reLogin')}
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'triggered') {
    const fired = TYPES.find((ty) => ty.id === firedType) || TYPES[2];
    const sent = sentAlert;

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
          <h1 className="text-3xl font-black mb-2 uppercase tracking-tight text-center" style={{ color: '#34d399' }}>{t('emergency.panic.allClearTitle')}</h1>
          <p className="text-white/65 max-w-[260px] mx-auto text-center text-sm leading-relaxed">
            {t('emergency.panic.allClearBody', { type: typeName(fired.id).toLowerCase() })}
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
        {sent?.isDrill && (
          <span
            className="mb-3 px-3 py-1 rounded-full text-[11px] font-black tracking-[0.22em] uppercase"
            style={{ background: '#4f46e5', color: '#fff' }}
            data-testid="panic-drill-badge"
          >
            {t('emergency.drill.modeBadge')}
          </span>
        )}
        <h1 className="text-3xl font-black mb-2 uppercase tracking-tight text-center" style={{ color: fired.accent }}>
          {typeName(fired.id)}<br/>{sent?.isDrill ? t('emergency.drill.broadcasted') : t('emergency.panic.broadcasted')}
        </h1>
        {/* WHERE it went, in plain words — "Lockdown on all 24 screens" /
            "Lockdown on 1 screen — Lobby" (alert targeting, 2026-10-05). */}
        <p className="text-white/80 mb-3 max-w-[300px] mx-auto text-center text-base font-semibold leading-snug" data-testid="panic-sent-summary">
          {targetSummary(t, typeName(fired.id), sent?.target ?? allScreens)}
        </p>
        <p className="text-white/55 mb-8 max-w-[280px] mx-auto text-center text-sm leading-relaxed">
          {t('emergency.target.waitingForClear')}
        </p>
        {/* Back to the panel: this alert stays on (listed there with its own
            all-clear) and another alert can go to another target. */}
        <button
          type="button"
          onClick={() => {
            setPhase('idle');
            setFiredType(null);
            setSentAlert(null);
            firedRef.current = null;
          }}
          className="px-8 min-h-[48px] rounded-2xl font-bold uppercase tracking-wider text-sm bg-white/[0.06] border border-white/15 text-white/90 active:bg-white/[0.12] focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          data-testid="panic-back-to-panel"
        >
          {t('emergency.target.backToPanel')}
        </button>
      </div>
    );
  }

  // 2026-11-14 — panic phones: what this phone holds, in one line.
  const phoneReadyRow = credential?.kind === 'device' && (
    <div data-testid="panic-phone-ready" className="mx-5 mb-1 flex items-center justify-between gap-2 rounded-xl bg-emerald-500/10 ring-1 ring-emerald-400/30 px-3 py-1.5 text-[11px] font-semibold text-emerald-100">
      <span className="min-w-0 truncate">{t('emergency.panic.phoneReady', { label: credential.deviceLabel })}</span>
      <button type="button" onClick={() => void turnOffThisPhone()} className="shrink-0 min-h-[36px] px-2 rounded-lg text-emerald-200 underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60" data-testid="panic-phone-turn-off">
        {t('emergency.panic.turnOff')}
      </button>
    </div>
  );
  const keepReadyRow = credential?.kind === 'session' && hasPanicAuthority(verifiedUser) && !phoneReady && enrollState !== 'dismissed' && phase === 'idle' && (
    <div data-testid="panic-keep-ready" className="mx-5 mb-1 rounded-xl bg-white/[0.05] ring-1 ring-white/15 px-3 py-2 text-[12px] text-white/85">
      {enrollState === 'stale' ? (
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0">{t('emergency.panic.keepReadyStale')}</span>
          <button type="button" onClick={() => router.push(PANIC_ENROLL_SIGN_IN_URL)} className="shrink-0 min-h-[36px] px-3 rounded-lg bg-white/10 font-bold">{t('emergency.panic.signInButton')}</button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0">
            {enrollState === 'unavailable'
              ? t('emergency.panic.keepReadyUnavailable')
              : enrollState === 'failed'
                ? t('emergency.panic.keepReadyFailed')
                : t('emergency.panic.keepReadyBody')}
          </span>
          <span className="shrink-0 flex items-center">
            <button
              type="button"
              onClick={() => void keepPhoneReady()}
              disabled={enrollState === 'working'}
              data-testid="panic-keep-ready-button"
              className="min-h-[36px] px-3 rounded-lg bg-red-600 text-white font-bold disabled:opacity-60"
            >
              {enrollState === 'working' ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : t('emergency.panic.keepReadyButton')}
            </button>
            <button type="button" onClick={() => setEnrollState('dismissed')} aria-label={t('emergency.panic.keepReadyDismiss')} className="ml-1 min-h-[36px] px-2 text-white/60">×</button>
          </span>
        </div>
      )}
    </div>
  );

  // Main grid — 6 dark-glass controls, 2 rows × 3 columns, each press-and-hold
  // triggers. Premium-dark VenueOS board: each control keeps its semantic SRP
  // color as a glow accent at rest, then fully ignites to a solid fill on hold.
  //
  // 2026-11-23 — SHORT SCREENS: THE BUTTONS OWN THE SPACE. The grid is
  // `flex-1 min-h-0` and each button is sized by its row, so a row placed
  // above the grid is paid for by the buttons: at 390 × 664 the keep-ready
  // card cut them from 89 px to 65 px (the 2026-11-16 train, red in
  // emergency-targeting.spec.ts ever since). Under 800 px tall the phone row
  // is rendered AFTER the grid, positioned at the bottom edge of the screen
  // (`top-full`), out of the flex column: the header-to-grid panel is laid
  // out exactly as if the row were not there, and the row is one short scroll
  // away (the root scrolls; DOM, reading and focus order follow). There is no
  // size floor: on a shorter screen the buttons shrink with their rows, as
  // they always did, and never move below the fold.
  //   The grid keeps the SAME place in the tree in every layout, so a layout
  // change during a hold (a rotation crossing 800 px) updates the pressed
  // button in place and never remounts it under the finger.
  //   800 px and taller: the DOM and classes are exactly what they were.
  //
  // 2026-11-23 — UNDER 800 px AND PHONE LANDSCAPE (@/hooks/use-panic-layout).
  // The stack above the grid was ~330 px; on a phone held sideways (390 px
  // tall) that left the rows nothing and the buttons measured about 2 px.
  //   compact (under 800 px, not phone landscape): the same stack with less
  // spacing (nothing hidden) and the grid three across, so every button is
  // the column's width (111 px at 390 wide) down to about 547 px tall.
  //   landscape: the root's own flow becomes a status column on the left
  // (header, title, LIVE | DRILL, alert line, "Send to", then the phone row);
  // the grid is `fixed` in the rest of the width, so the column can scroll to
  // the card while the buttons never move. The buttons' size does not depend
  // on anything in the column.
  //   Every change between shapes is a class or style change on the same
  // elements; only the phone row moves between its two slots.
  const grid = GRID_BY_LAYOUT[layout];
  return (
    <div className={dense ? `${PAGE_CLS} overflow-y-auto` : PAGE_CLS} style={landscape ? LAND_ROOT_STYLE : PAGE_STYLE}>
      {LiveRegion}
      {/* Header — brand mark + authorized identity pill */}
      {/* `gap-3` + a non-shrinking brand block: at 390px the three header
          items have zero free space between them, so the wordmark ran straight
          into the Silent pill. The email chip is the one that gives (truncate). */}
      <div className={dense ? HEADER_DENSE_CLS : HEADER_CLS}>
        <div className="flex items-center gap-2.5 shrink-0">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.05] ring-1 ring-white/10">
            <ShieldAlert className="w-[18px] h-[18px] text-white/80" />
          </span>
          <span className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/55">VenueOS</span>
        </div>
        <div className="flex items-center gap-2 min-w-0">
          {/* Silent status (§M17: "Silent status: Silent by default"). The
              label states, in words, what turning it on does to this device —
              a speaker icon alone would not. */}
          <button
            type="button"
            onClick={toggleVoice}
            aria-pressed={voiceOn}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-white/[0.04] ring-1 ring-white/10 px-2.5 min-h-[44px] text-white/70 hover:text-white hover:bg-white/[0.08] transition-colors focus:outline-none focus:ring-2 focus:ring-white/40"
          >
            {voiceOn
              ? <Volume2 className="w-4 h-4 shrink-0" aria-hidden />
              : <VolumeX className="w-4 h-4 shrink-0" aria-hidden />}
            <span className="text-[10px] font-bold uppercase tracking-widest">
              {voiceOn ? t('emergency.panic.voiceOn') : t('emergency.panic.voiceOff')}
            </span>
          </button>
          {/* Copy claims only what is known (2026-11-14): "AUTHORIZED" only
              once a credential is in hand, "Checking sign-in…" before. */}
          <span
            className="text-[10px] font-semibold uppercase tracking-widest truncate text-right text-white/60 rounded-full bg-white/[0.04] ring-1 ring-white/10 px-3 py-1.5"
            data-testid="panic-identity"
          >
            {verifiedUser?.email || (credential ? t('emergency.panic.authorized') : t('emergency.panic.checkingSignIn'))}
          </span>
        </div>
      </div>
      {/* The one sentence that makes the control above honest. */}
      <p className="px-5 -mt-1 pb-1 text-right text-[10px] text-white/40">
        {voiceOn ? t('emergency.panic.voiceOnHint') : t('emergency.panic.voiceOffHint')}
      </p>
      {/* 2026-11-14 — the grid is live while sign-in is still being checked
          (or could not be checked). Say so in one line: a press now waits for
          the check and then sends; nothing is pretended. */}
      {(authState.status === 'resolving' || authState.status === 'unreachable') && (
        <p
          role="status"
          data-testid="panic-auth-status"
          className={dense ? AUTH_LINE_DENSE_CLS : AUTH_LINE_CLS}
        >
          {authState.status === 'resolving' ? (
            <><Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" aria-hidden /> {t('emergency.panic.checkingSignInHint')}</>
          ) : (
            <><AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-300" aria-hidden /> {t('emergency.panic.unreachableHint')}</>
          )}
        </p>
      )}

      <div className={dense ? TITLE_DENSE_CLS : TITLE_CLS}>
        <h1 className={dense ? H1_DENSE_CLS : H1_CLS} data-testid="panic-title">
          {isDrill ? t('emergency.drill.panicTitle') : t('emergency.panic.title')}
        </h1>
        {/* 2026-05-03 BUG FIX (cycle 4 emergency-BUG-013) — copy used to
            say "1.5 seconds" but HOLD_DURATION_MS is 3000 (cycle-1 fix
            restoring the apps/api/src/emergency/CLAUDE.md "Key Safeguards #5" 3-second hold).
            Updated to match actual timer so operators see truthful UX. */}
        <p className={`${dense ? HOLD_HINT_DENSE_CLS : HOLD_HINT_CLS} ${isDrill ? 'text-indigo-200 font-semibold' : 'text-white/60'}`} data-testid="panic-hold-hint">
          {isDrill ? t('emergency.drill.panicHint') : t('emergency.panic.holdHint')}
        </p>
      </div>

      <div className={dense ? CONTROLS_DENSE_CLS : CONTROLS_CLS}>
        {/* LIVE | DRILL (2026-10-10). LIVE on every open; back to LIVE after
            a drill is sent. Locked while a send is in flight. */}
        <LiveDrillSwitch
          mode={mode}
          size="compact"
          disabled={phase === 'triggering'}
          onChange={(next) => {
            setMode(next);
            announce(next === 'drill' ? t('emergency.drill.announceModeDrill') : t('emergency.drill.announceModeLive'));
          }}
        />
        {/* LIVE ALERTS (alert targeting, 2026-10-05) — one compact line, so
            the trigger grid keeps its size however many are on. Tapping it
            opens the list, where each alert has its own all-clear. */}
        {activeAlerts && activeAlerts.length > 0 && (
          <button
            type="button"
            onClick={() => setAlertsSheetOpen(true)}
            disabled={phase === 'triggering'}
            data-testid="panic-active-alerts"
            className="w-full min-h-[48px] px-3 rounded-2xl flex items-center gap-2 text-left border disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            style={{ background: 'rgba(239,68,68,0.14)', borderColor: 'rgba(248,113,113,0.55)' }}
          >
            <span className="w-2.5 h-2.5 shrink-0 rounded-full bg-red-400 motion-safe:animate-pulse" aria-hidden />
            <span className="flex-1 min-w-0 text-[13px] font-semibold text-white truncate">
              {activeAlerts.length === 1
                ? alertLabel(activeAlerts[0])
                : t('emergency.target.activeCount', { count: activeAlerts.length })}
            </span>
            <span className="shrink-0 text-[11px] font-bold uppercase tracking-wider text-red-100">
              {activeAlerts.length === 1 ? t('emergency.target.endAlert') : t('emergency.target.viewAlerts')}
            </span>
          </button>
        )}
        {/* WHERE: All screens by default — zero extra taps; "Choose screens"
            picks one group or one screen. Locked while a send is in flight. */}
        <EmergencyTargetBar
          target={target}
          disabled={phase === 'triggering'}
          onChoose={() => setPickerOpen(true)}
          onReset={() => {
            setChosenTarget(null);
            announce(t('emergency.target.announceTargetSet', { target: targetChipLabel(t, allScreens) }));
          }}
        />
      </div>

      {/* 800 px and taller: the panic-phone row above the grid, as before.
          Landscape: the same slot, which is the end of the status column. */}
      {rowAbove && phoneReadyRow}
      {rowAbove && keepReadyRow}
      {/* 2x3 grid — generous spacing so adjacent buttons aren't easy to fat-finger
          (3 × 2 under 800 px and in wide landscape; see GRID_BY_LAYOUT) */}
      <div className={grid.className} style={grid.style}>
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
              aria-label={isDrill ? t('emergency.drill.buttonAria', { type: typeName(type.id) }) : t('emergency.panic.buttonAria', { type: typeName(type.id) })}
              data-mode={mode}
              disabled={phase === 'triggering'}
              // Sized by the ROW, capped at 156 px (2026-10-05): the target line
              // above takes height, and on a phone browser (address bar showing)
              // a width-sized circle taller than its row overlapped the next
              // button — exactly what the generous gap exists to prevent. In the
              // installed app at 390×844 this still renders 156 px, as before.
              //   2026-11-23: under 800 px and in landscape the cap is
              // --panic-btn-max (the column's width, at most 156 px), so the
              // button is min(row, column, 156) and stays round; max-w-full
              // stays as the never-overlap safety net.
              className={`relative aspect-square h-full ${layout === 'tall' ? 'max-h-[156px]' : 'max-h-[var(--panic-btn-max)]'} max-w-full rounded-full flex flex-col items-center justify-center
                transition-all duration-150 outline-none
                ${dim ? 'opacity-30' : ''}
                ${isHolding ? 'scale-95' : ''}
              `}
              style={{
                WebkitTapHighlightColor: 'transparent',
                touchAction: 'none',
                background: isHolding ? holdBg : restBg,
                // Drill: an indigo ring replaces the type's colour ring so the
                // whole grid visibly changes mode; the type colour stays as the
                // icon/glow so Hold is still Hold.
                border: `1px solid ${isHolding ? type.accent : isDrill ? 'rgba(129,140,248,0.75)' : `rgba(${type.rgb},0.40)`}`,
                boxShadow: isHolding
                  ? `0 0 44px rgba(${type.rgb},0.55), inset 0 -7px 0 rgba(0,0,0,0.28)`
                  : isDrill
                    ? `0 0 0 2px rgba(99,102,241,0.45), 0 12px 30px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.05)`
                    : `0 0 0 1px rgba(${type.rgb},0.10), 0 12px 30px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.05)`,
              }}
            >
              {isDrill && !isTriggering && (
                <span
                  className="absolute top-2 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded text-[9px] font-black tracking-[0.2em] uppercase"
                  style={{ background: '#4f46e5', color: '#fff' }}
                  aria-hidden
                >
                  {t('emergency.drill.drill')}
                </span>
              )}
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
                    {isHolding ? t('emergency.panic.holding') : typeName(type.id)}
                  </span>
                </>
              )}
            </button>
          );
        })}
      </div>
      {/* Under 800 px (not phone landscape): the panic-phone row, below the
          buttons (rendered only when a row will show, so it never takes
          space for nothing). */}
      {layout === 'compact' && (phoneReadyRow || keepReadyRow) && (
        <div className="absolute top-full left-0 right-0 pb-[max(1rem,env(safe-area-inset-bottom))]" data-testid="panic-phone-row-below">
          {phoneReadyRow}
          {keepReadyRow}
        </div>
      )}

      <EmergencyTargetPicker
        open={pickerOpen}
        targets={targets}
        status={targetsStatus}
        selected={target}
        allScreens={allScreens}
        onSelect={(next) => {
          setChosenTarget(isAllScreens(next) ? null : next);
          announce(t('emergency.target.announceTargetSet', { target: targetChipLabel(t, next) }));
        }}
        onClose={() => setPickerOpen(false)}
        onRetry={() => { if (credential) void loadTargets(credential); }}
      />
      {alertsSheetOpen && (
        <PanicActiveAlertsSheet
          alerts={activeAlerts ?? []}
          labelOf={alertLabel}
          keyOf={alertKey}
          onEnd={endAlert}
          endBlocked={credential?.kind === 'device' ? { message: t('emergency.panic.endNeedsSignIn'), signInLabel: t('emergency.panic.signInButton'), onSignIn: () => router.push(PANIC_SIGN_IN_URL) } : undefined}
          onClose={() => setAlertsSheetOpen(false)}
          announce={announce}
        />
      )}
    </div>
  );
}
