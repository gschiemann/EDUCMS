'use client';

/**
 * ScreenDisplayControls — the per-screen display panel inside the gear
 * popover on /[schoolId]/screens.
 *
 * It replaces the "More coming soon — restart, orientation, cache clear."
 * footer stub that sat here since Sprint 11. Per CLAUDE.md §20, a stub is
 * not allowed to become a button that lies; so every control below is
 * gated on what THIS screen's probe actually reported
 * (see ./display-capabilities.ts for the resolver + the reasoning).
 *
 * The four honesty rules this component implements:
 *  1. No verdict yet → no controls at all, just an explainer. "Not
 *     reported" is never rendered as "unsupported" (tri-state discipline,
 *     copied from the APK-push row's upToDate === null branch).
 *  2. `brightness: software-dim` still gets a slider — the player's
 *     SoftwareDimProvider genuinely works — but the copy says out loud
 *     that it dims the image, not the backlight, so the panel keeps
 *     drawing full power. Same for `screenBlank: none`.
 *  3. `volume: none` / `reboot: none` have NO software floor, so no
 *     control renders. Reboot additionally explains WHY (the probe's
 *     deviceOwnerPath) instead of silently vanishing.
 *  4. We show what we SENT, never a fabricated device state. There is no
 *     "Blanking…" progress bar, because nothing on the wire tells us the
 *     panel went dark.
 *
 * Safety: brightness is floored at MIN_SAFE_BRIGHTNESS (a remote 0% on a
 * screen nobody can reach is a truck roll) and BLANK always carries a
 * dead-man revert so a forgotten click can't strand a screen dark. A
 * permanent nightly off is the schedule editor's job, not this button's.
 *
 * ── 2026-08-13 remediation, and the places rule 1 above now bends ──
 *
 * CONTRACT C4 (lead), corrected. "Fail-OPEN for recovery, fail-CLOSED for
 * risk" is per-ACTION, not per-PAIR — and the first cut of this panel got
 * that wrong by shipping Blank and Wake as one indivisible row on a screen
 * that has never reported. The API refuses BLANK on a null verdict
 * (DISPLAY_CAPABILITIES_UNKNOWN: "Blanking stays disabled until it does —
 * Wake still works"), and EVERY screen in the pilot has a null verdict today
 * because the self-report ships in this same wave and no field APK carries
 * it. So that Blank button was not an edge case, it was a control with a
 * 100% failure rate on the entire fleet.
 *
 * What an unreported screen now gets is exactly the set of actions the
 * server's own gate accepts on a null verdict, and nothing else:
 *   • WAKE            — can only ever make a dark screen visible.
 *   • SET_BRIGHTNESS  — at or above RECOVERY_MIN_BRIGHTNESS, i.e. raises
 *                       only; the slider's `min` IS that floor, so its
 *                       whole travel is acceptable to the API.
 *   • the on/off schedule — a screen paired an hour ago should still be
 *                       givable a nightly off before its first probe lands.
 * BLANK, volume and reboot render as explainer TEXT that says the screen
 * has not reported yet — never as a dead control.
 *
 * NO DEVICE OWNER (product decision, 2026-08-13). We are not provisioning
 * the APK as Android device owner, so on today's real fleet `reboot`
 * resolves to 'none' on every box and this panel renders NO restart button —
 * only the one-line explainer. The button path stays for a future
 * manufacturer-preinstalled (platform-signed) build, and the render tests
 * cover BOTH shapes so the reboot-absent layout can't rot unnoticed.
 *
 * ── THE BLANK/POWER SPLIT (live field incident, 2026-08-25) ──────────
 *
 * Operator contract, verbatim: *"wake and blank should just do that and turn
 * on and off should do that, keep them separate and make them work perfectly
 * on all our models."*
 *
 * A remote BLANK reached the APK, which took an Android device-admin lock,
 * which latched a Goodview G43 and a Mobile A-Frame into a VENDOR standby:
 * glass dark, IR remote and physical power button both dead, WAKE delivered
 * and useless, mains power-cycle required — and the A-Frame then woke ITSELF
 * back up minutes later, unprompted. An L55VEC with a byte-identical verdict
 * recovered normally. Vendor firmware owned that state, in both directions,
 * and nothing the probe reports predicted which panel would do which.
 *
 * So this panel now shows TWO rows where it used to show one:
 *
 *   Blank / Wake  — SOFT and universal. The player covers its own viewport
 *                   with black; no bridge call, no hardware, no verdict
 *                   consulted. Renders on EVERY screen including one that
 *                   has never reported and a browser player. No dead-man
 *                   revert any more: a soft blank cannot strand anything,
 *                   and "blank should just do that" means it holds until
 *                   Wake (or a reload, or an emergency).
 *   Panel power   — HARD, and STATE-AWARE (2026-08-25, second pass). It
 *                   offers the ONE verb that matches the glass: "Turn panel
 *                   off" while the screen is provably painting (and only on
 *                   a mechanism proven to round-trip), "Turn panel on" while
 *                   it is not, and neither when we cannot tell. Showing both
 *                   at once was the defect the operator caught — an online,
 *                   actively-painting screen offering him "Turn panel on".
 *                   See `panelPowerOffer` in ./display-capabilities.ts.
 *
 * ── AND BRIGHTNESS SPLIT THE SAME WAY (2026-08-25, later) ─────────────
 *
 * The slider worked on two field panels and was dead on two. Each panel's
 * probe says why: a WRITABLE `/sys/class/backlight/*` node resolves
 * `sysfs-backlight` and works; a non-writable one falls through to
 * `settings`, whose write succeeds while the vendor firmware ignores it. So
 * the API now dispatches SET_BRIGHTNESS soft on any unproven mechanism and
 * the player dims its own picture — which is why `settings` reads
 * "image only" here now. The slider itself is unchanged and renders on every
 * screen exactly as before; only the copy and the executor moved.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Volume2,
  VolumeX,
  Sun,
  Moon,
  Monitor,
  Power,
  CalendarClock,
  Info,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { appConfirm, appPrompt } from '@/components/ui/app-dialog';
import {
  useDisplayControl,
  DISPLAY_CONTROL_TIMEOUT_MS,
  type DisplayActionType,
} from '@/hooks/use-api';
import {
  resolveDisplayControls,
  clampBrightness,
  clampVolume,
  derivePanelPowerState,
  nativeHardOff,
} from './display-capabilities';
import { deriveRenderTrustGrade } from './renderTrust';
import {
  CONFIRM_WINDOW_MS,
  deriveSleepAwakeState,
  nativeReportAsleep,
  type SleepAwakeTarget,
} from './sleep-awake';
import { ScreenDeviceSettings } from './ScreenDeviceSettings';

/** The literal the operator must type to confirm a remote reboot. */
const REBOOT_TOKEN = 'REBOOT';

function ago(ts: string | null | undefined): string | null {
  if (!ts) return null;
  const ms = Date.now() - new Date(ts).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

/**
 * Slider row. `reported` is the device's own last-known level when the API
 * echoes one; when it doesn't, the readout shows "—" rather than implying
 * the hardware is where the thumb happens to be.
 *
 * The thumb still has to sit SOMEWHERE, and the old `Math.max(min, 50)`
 * parked it dead-centre on a screen that might be running at 100% — an
 * operator who grabbed it for a small trim sent an absolute 49% and halved
 * the panel. `unknownPark` is the honest resting position per axis, and it
 * follows the same asymmetry the clamps do: **silence is recoverable,
 * darkness is not.** Volume parks at its minimum, brightness parks at 100,
 * so a blind nudge in either direction can only move toward a state the
 * operator can see and undo. The `unknownHint` line says out loud that the
 * slider sets an absolute value rather than adjusting from a known one.
 */
function LevelRow({
  icon,
  label,
  note,
  min,
  reported,
  unknownPark,
  unknownHint,
  disabled,
  onCommit,
  accentClass,
}: {
  icon: React.ReactNode;
  label: string;
  note: string | null;
  min: number;
  reported: number | null;
  /** Where the thumb rests when the device has never echoed a level. */
  unknownPark: number;
  /** Shown only while the level is genuinely unknown. */
  unknownHint: string;
  disabled: boolean;
  onCommit: (percent: number) => void;
  accentClass: string;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  const lastSent = useRef<number | null>(null);
  const unknown = draft === null && reported === null;
  const shown = draft ?? reported ?? unknownPark;

  const commit = () => {
    if (draft === null) return;
    if (lastSent.current === draft) return;
    lastSent.current = draft;
    onCommit(draft);
  };

  return (
    <div className="px-3.5 py-2.5 border-t border-slate-100">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-[11px] font-bold text-slate-700">
          {icon}
          {label}
        </span>
        <span className="text-[10px] font-mono text-slate-500 tabular-nums">
          {draft !== null
            ? `${draft}% · sent`
            : reported !== null
              ? `${reported}%`
              : '—'}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={100}
        step={1}
        value={shown}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => setDraft(Number(e.target.value))}
        // stopPropagation mirrors the LED-canvas buttons a few rows up:
        // the popover closes on a document-level pointerdown, and a drag
        // that starts on this thumb must never be mistaken for one.
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={commit}
        onTouchEnd={commit}
        onKeyUp={commit}
        onBlur={commit}
        className={`w-full mt-1.5 ${accentClass} ${unknown ? 'opacity-60' : ''} disabled:opacity-40 disabled:cursor-not-allowed`}
      />
      {unknown && (
        <p className="text-[10px] text-amber-600 leading-snug mt-1">{unknownHint}</p>
      )}
      {note && <p className="text-[10px] text-slate-400 leading-snug mt-1">{note}</p>}
    </div>
  );
}

/**
 * The slice of the screen row this panel reads. Structural, so the page's
 * loosely-typed `screen` object still satisfies it — but narrow enough that
 * a rename on the API side shows up here as a type error instead of a
 * silently-undefined capability (which would render as "not reported").
 */
export interface DisplayControlScreen {
  id: string;
  name?: string | null;
  /** Last probe verdict — Prisma Json, so genuinely unknown until parsed. */
  displayCapabilities?: unknown;
  displayCapabilitiesAt?: string | null;
  /** Device-echoed levels, when the API has them. Absent = unknown. */
  displayState?: { volumePercent?: number; brightnessPercent?: number } | null;
  /**
   * ── PANEL-STATE SIGNALS (2026-08-25) ───────────────────────────────
   *
   * All four already ride every `GET /screens` row and the parent already
   * passes the whole screen object, so this is a widening of the type, not
   * new data: no poll, no endpoint, no schema. They exist here so the power
   * row can offer the verb that matches the glass instead of always
   * offering "Turn panel on" to a screen that is visibly painting.
   */
  status?: string | null;
  renderHealth?: 'OK' | 'STALE' | 'UNKNOWN' | null;
  renderStale?: boolean | null;
  lastRenderedAt?: string | null;
  /**
   * The native heartbeat's report (2026-10-31). `sleep.vb.off` says the
   * vendor backlight is off by our hand — on a GUQ the page keeps painting
   * behind it, so render proof alone offered "Turn panel off" to a dark panel.
   */
  nativeRuntimeReport?: unknown;
  nativeRuntimeReportAt?: string | null;
}

export function ScreenDisplayControls({
  screen,
  readOnly,
  onOpenSchedule,
  browserPlayer,
}: {
  screen: DisplayControlScreen;
  /** RESTRICTED_VIEWER — read-only, every control inert. */
  readOnly?: boolean;
  /** Opens the schedule modal (the parent closes the popover first). */
  onOpenSchedule: () => void;
  /**
   * 2026-08-24 settings-menu cleanup — the parent knows this screen runs in
   * a plain browser (non-Android osInfo / 'web' hardware bucket), where no
   * native bridge will EVER report capabilities or act on a command. The
   * unreported-branch recovery controls (Wake, brightness raise, on/off
   * schedule) are honest offers on a silent Android box, but on a browser
   * player they are dead buttons — every one fails 100% of the time. When
   * true AND nothing has reported, collapse to a one-line explanation.
   * A capability report, if one ever arrives, overrides this hint.
   */
  browserPlayer?: boolean;
}) {
  const t = useTranslations();
  const control = useDisplayControl();
  const caps = resolveDisplayControls(screen?.displayCapabilities);
  const reportedAt = ago(screen?.displayCapabilitiesAt);
  // `tone` (2026-08-25) splits the two very different ways an action can come
  // back undelivered. 'fail' is a real outage (fan-out down, publish threw) —
  // rose, alarm-shaped. 'note' is the per-screen `no_push_socket` case: the
  // command was refused nothing, the screen simply has no live connection to
  // push it down. That is an EXPLANATION, and dressing it in the same red as
  // a server outage would be its own small lie — plus alarm fatigue is
  // already a live problem on this page (the render-proof chip was graded
  // down for crying wolf the same night). Defaults to the old two-state
  // behaviour when omitted.
  const [status, setStatus] = useState<{
    ok: boolean;
    msg: string;
    tone?: 'fail' | 'note';
  } | null>(null);
  // Which action is in flight — the shared mutation's isPending can't tell
  // Blank from Wake, and a spinner on the wrong button is its own small lie.
  //
  // It is also, deliberately, NOT a global lock any more. WAKE used to be
  // disabled while a BLANK was in flight; combined with an apiFetch that had
  // no timeout, a wedged API left the screen dark AND the only control that
  // recovers it greyed out indefinitely. A control must never be gated by
  // the action it recovers from. (The 12 s abort in useDisplayControl is the
  // other half of that fix.)
  const [busy, setBusy] = useState<DisplayActionType | null>(null);
  /**
   * The RECOVERY verbs stay live no matter what else is running — a control
   * must never be gated by the action it recovers from. WAKE undoes BLANK;
   * POWER_ON undoes POWER_OFF (added with the 2026-08-25 split, for exactly
   * the same reason: an in-flight POWER_OFF must not grey out the only
   * control that brings the panel back).
   */
  const RECOVERY_ACTIONS: readonly DisplayActionType[] = ['WAKE', 'POWER_ON'];
  const lockedBy = (action: DisplayActionType) =>
    busy !== null && !RECOVERY_ACTIONS.includes(action) ? true : busy === action;

  // Device-echoed levels when the API provides them; otherwise unknown.
  const ds = screen?.displayState ?? null;
  const reportedVolume = typeof ds?.volumePercent === 'number' ? ds.volumePercent : null;
  const reportedBrightness =
    typeof ds?.brightnessPercent === 'number' ? ds.brightnessPercent : null;

  // Is the glass actually lit? Derived from the render proof the fleet list
  // already carries — the same classifier the Screens list chip uses, so the
  // popover can never contradict the row it opened from.
  const panelState = derivePanelPowerState(
    deriveRenderTrustGrade({
      status: screen?.status,
      renderHealth: screen?.renderHealth,
      renderStale: screen?.renderStale,
      lastRenderedAtMs: screen?.lastRenderedAt
        ? new Date(screen.lastRenderedAt).getTime()
        : null,
    }),
  );
  // Sleep / Awake — ONE pair, whatever mechanism sits behind it. The state
  // is derived by the pure `deriveSleepAwakeState` (sleep-awake.ts) from the
  // same evidence `panelPowerOffer` used: native sleep report, render proof,
  // and the last command the API accepted.
  const [lastCommand, setLastCommand] = useState<{ target: SleepAwakeTarget; at: number } | null>(
    null,
  );
  const [inFlight, setInFlight] = useState<SleepAwakeTarget | null>(null);
  // One timeout per command, to re-render when the 30 s confirm window ends.
  // No interval: nothing runs unless a command was just sent.
  const [, setTick] = useState(0);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
    },
    [],
  );
  const nowMs = Date.now();
  const sleepAwake = deriveSleepAwakeState({
    panelState,
    hardOff: nativeHardOff(screen?.nativeRuntimeReport, screen?.nativeRuntimeReportAt, nowMs),
    reportAsleep: nativeReportAsleep(screen?.nativeRuntimeReport, screen?.nativeRuntimeReportAt, nowMs),
    lastCommand,
    inFlight,
    now: nowMs,
  });

  const send = async (
    action: DisplayActionType,
    opts: { percent?: number; revertAfterMs?: number; okMsg: string; quiet?: boolean },
  ): Promise<boolean> => {
    setBusy(action);
    setStatus(null);
    try {
      const res = await control.mutateAsync({
        screenId: screen.id,
        action,
        percent: opts.percent,
        revertAfterMs: opts.revertAfterMs,
      });
      // DELIVERY HONESTY. `success:true` only means the API accepted and
      // audited the action; `delivered` is the field that says it provably
      // left the process toward the screen. When Redis is down (a supported
      // deploy state — CLAUDE.md: "Redis missing → API boots anyway") the
      // fan-out reaches only screens socketed to THIS replica, and there is
      // no manifest backstop for immediate actions. Painting the emerald
      // "sent" row there tells an operator a dark screen was woken when it
      // was not — the one lie this panel must never tell.
      //
      // Strict `=== false`: an API build that predates the field returns it
      // as undefined, and "the server didn't tell us" must not be rendered
      // as "we know it failed". Only an explicit false is a failure.
      if (res?.delivered === false) {
        // TWO DIFFERENT SENTENCES (2026-08-25). Until tonight `delivered`
        // was graded off the Redis fan-out alone — a fact about the SERVER —
        // so a panel living on the HTTP-poll tier (venue proxy blocking
        // WS/SSE) got a green "sent" row for a command it never received.
        // The API now grades per-screen and says WHY, so this row can too:
        //
        //   no_push_socket → not an outage. Nothing is broken server-side;
        //     this one screen has no live realtime connection right now, so
        //     an INSTANT command has no path down to it. It is stated as an
        //     explanation, and it is honest about the consequence: display
        //     actions are immediate-only — the manifest carries schedules,
        //     never immediate actions, and neither the WS gateway nor SSE
        //     replays a missed frame — so nothing is queued and the operator
        //     must retry once the screen reconnects. Promising an automatic
        //     "it'll pick this up on its next poll" would be a fresh lie in
        //     the middle of fixing one.
        //
        //   everything else → a genuine transport failure; keep the alarm.
        const noSocket = res?.deliveryReason === 'no_push_socket';
        setStatus({
          ok: false,
          tone: noSocket ? 'note' : 'fail',
          msg: noSocket
            ? t('screens.display.noPushSocket')
            : t('screens.display.notDelivered'),
        });
        return false;
      }
      if (!opts.quiet) setStatus({ ok: true, msg: opts.okMsg });
      return true;
    } catch (e) {
      // THE TIMEOUT IS NOT A FAILURE — it is an UNKNOWN, and those are not
      // the same sentence to someone standing under a dark screen.
      //
      // `useDisplayControl` aborts a POST that hangs past
      // DISPLAY_CONTROL_TIMEOUT_MS, which unwedges the button (see the
      // `lockedBy` note above). But the raw rejection is a DOMException whose
      // message is browser jargon — Chrome says "The user aborted a request",
      // WebKit says "Fetch is aborted" — and rendering that verbatim told the
      // operator the browser had cancelled something, when what actually
      // happened is: we do not know whether the screen got the command. After
      // a BLANK that distinction IS the recovery decision, so it gets its own
      // copy that names Wake instead of leaving the operator to guess.
      const name = (e as { name?: unknown } | null)?.name;
      const timedOut = name === 'AbortError' || name === 'TimeoutError';
      setStatus({
        ok: false,
        msg: timedOut
          ? t('screens.display.sendTimedOut', {
              seconds: Math.round(DISPLAY_CONTROL_TIMEOUT_MS / 1000),
            })
          : (e instanceof Error && e.message) || t('screens.display.sendFailed'),
      });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const confirmReboot = async () => {
    const ok = await appConfirm({
      title: t('screens.display.rebootConfirmTitle'),
      message: t('screens.display.rebootConfirmBody', { name: screen?.name ?? '' }),
      tone: 'danger',
      confirmLabel: t('screens.display.rebootContinue'),
    });
    if (!ok) return;
    const typed = await appPrompt({
      title: t('screens.display.rebootTypeTitle', { token: REBOOT_TOKEN }),
      message: t('screens.display.rebootTypeBody', { token: REBOOT_TOKEN }),
      placeholder: REBOOT_TOKEN,
    });
    if (typed?.trim().toUpperCase() !== REBOOT_TOKEN) return;
    await send('REBOOT', { okMsg: t('screens.display.rebootSent') });
  };

  /**
   * Sleep / Awake. The operator picks a STATE; we pick the mechanism.
   *   Sleep -> the panel's own power-off where this hardware proves one
   *            (vendor standby / backlight), otherwise the soft blank.
   *   Awake -> undo whichever of those is active: the hard power-on where
   *            offered, then the soft wake. Recovery is never gated.
   * No confirmation dialog: Awake is always one tap away, on every screen.
   */
  const runPower = async (target: SleepAwakeTarget) => {
    setInFlight(target);
    try {
      let ok: boolean;
      if (target === 'sleep') {
        ok = await send(caps.power.off.available ? 'POWER_OFF' : 'BLANK', {
          okMsg: t('screens.display.sleepSent'),
        });
      } else {
        const hard = caps.power.on.available ? await send('POWER_ON', { okMsg: '', quiet: true }) : true;
        ok = hard && (await send('WAKE', { okMsg: t('screens.display.awakeSent') }));
      }
      if (ok) {
        setLastCommand({ target, at: Date.now() });
        if (confirmTimer.current) clearTimeout(confirmTimer.current);
        confirmTimer.current = setTimeout(() => setTick((n) => n + 1), CONFIRM_WINDOW_MS + 250);
      }
    } finally {
      setInFlight(null);
    }
  };

  const header = (
    <div className="px-3.5 pt-3 pb-1 flex items-baseline justify-between gap-2 border-t border-slate-100">
      <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500">
        {t('screens.display.title')}
      </span>
      {reportedAt && (
        <span className="text-[9px] text-slate-400">
          {t('screens.display.checkedAgo', { ago: reportedAt })}
        </span>
      )}
    </div>
  );

  const disabled = !!readOnly;

  // Brightness. Rendered in BOTH layouts, because a raise is a recovery
  // action the API accepts on a screen that has never reported — the only
  // difference is the floor (and therefore what the slider can even express)
  // and the copy. `caps.brightness.floor` is the API's own gate value, so
  // every position on this track is a request the server will take.
  const brightnessRow = caps.brightness.available && (
    <LevelRow
      icon={<Sun className="w-3.5 h-3.5 text-slate-400" />}
      label={
        caps.brightness.softwareOnly
          ? t('screens.display.brightnessSoftwareLabel')
          : t('screens.display.brightness')
      }
      // `min` is passed to every brightness note; only the recovery-only
      // copy interpolates it, and next-intl ignores unused values.
      note={caps.brightness.noteKey ? t(caps.brightness.noteKey, { min: caps.brightness.floor }) : null}
      min={caps.brightness.floor}
      reported={reportedBrightness}
      unknownPark={100}
      unknownHint={t('screens.display.levelUnknown')}
      disabled={disabled || lockedBy('SET_BRIGHTNESS')}
      accentClass="accent-amber-500"
      onCommit={(p) => {
        const pct = clampBrightness(p, caps.brightness.floor);
        send('SET_BRIGHTNESS', {
          percent: pct,
          okMsg: t('screens.display.brightnessSent', { percent: pct }),
        });
      }}
    />
  );

  // ── Sleep / Awake — the ONE power control, on every screen ───────────
  // Highlight = the screen's current state (sleep-awake.ts). Neither is lit
  // when the state is unknown. The pressed button spins until the screen's
  // own report agrees; after 30 s without it we say so plainly.
  const stateLabel =
    sleepAwake.current === 'sleep'
      ? t('screens.display.stateSleeping')
      : sleepAwake.current === 'awake'
        ? t('screens.display.stateAwake')
        : t('screens.display.stateUnknown');
  const powerButton = (target: SleepAwakeTarget) => {
    const isCurrent = sleepAwake.current === target;
    const isPending = sleepAwake.pending === target;
    // Awake is a recovery verb: never locked by another action (see lockedBy).
    const locked = target === 'sleep' ? inFlight !== null || busy !== null : inFlight === 'awake';
    const Icon = target === 'sleep' ? Moon : Monitor;
    return (
      <button
        type="button"
        data-testid={`power-${target}`}
        aria-pressed={isCurrent}
        aria-busy={isPending}
        disabled={disabled || locked}
        onClick={(e) => {
          e.stopPropagation();
          void runPower(target);
        }}
        className={`flex-1 min-h-11 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 disabled:opacity-40 disabled:cursor-not-allowed ${
          isCurrent
            ? target === 'sleep'
              ? 'border-slate-800 bg-slate-800 text-white shadow-sm'
              : 'border-emerald-600 bg-emerald-600 text-white shadow-sm'
            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300'
        }`}
      >
        {isPending ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Icon className="w-4 h-4" />
        )}
        {target === 'sleep' ? t('screens.display.sleepLabel') : t('screens.display.awakeLabel')}
      </button>
    );
  };
  const sleepAwakeRow = (
    <div className="px-3.5 py-2.5 border-t border-slate-100">
      <div className="flex items-baseline justify-between gap-2 mb-1.5">
        <span className="text-[11px] font-bold text-slate-700">
          {t('screens.display.powerLabel')}
        </span>
        <span
          data-testid="power-state"
          className={`text-[11px] font-semibold ${
            sleepAwake.current === 'unknown' ? 'text-slate-400' : 'text-slate-600'
          }`}
        >
          {stateLabel}
        </span>
      </div>
      <div className="flex items-center gap-2" role="group" aria-label={t('screens.display.powerLabel')}>
        {powerButton('sleep')}
        {powerButton('awake')}
      </div>
      <p className="text-[10px] text-slate-500 leading-snug mt-1.5" aria-live="polite">
        {sleepAwake.pending
          ? sleepAwake.pending === 'sleep'
            ? t('screens.display.pendingSleep')
            : t('screens.display.pendingAwake')
          : sleepAwake.unconfirmed
            ? sleepAwake.unconfirmed === 'sleep'
              ? t('screens.display.unconfirmedSleep')
              : t('screens.display.unconfirmedAwake')
            : t('screens.display.sleepAwakeHint')}
      </p>
    </div>
  );

  const scheduleRow = (
    <button
      type="button"
      onClick={onOpenSchedule}
      className="w-full flex items-center gap-3 px-3.5 py-3 text-left text-xs font-semibold text-slate-700 hover:bg-white border-t border-slate-100 transition-colors"
    >
      <CalendarClock className="w-4 h-4 text-slate-400 shrink-0" />
      <span className="flex-1 min-w-0">
        <span className="block">{t('screens.display.scheduleRow')}</span>
        <span className="block text-[10px] font-normal text-slate-400 mt-0.5">
          {t('screens.display.scheduleRowSub')}
        </span>
      </span>
    </button>
  );

  // Result of the last command. "Sent" — not "done": the wire tells us the
  // API accepted it, nothing more.
  const statusRow = status && (
    <div
      className={`px-3.5 py-2 flex items-start gap-1.5 text-[10px] leading-snug border-t ${
        status.ok
          ? 'text-emerald-700 bg-emerald-50/60 border-emerald-100'
          : status.tone === 'note'
            ? // "This screen has no live connection" — a condition to explain,
              // not an outage to alarm about. Slate, not rose.
              'text-slate-600 bg-slate-50 border-slate-200'
            : 'text-rose-700 bg-rose-50/60 border-rose-100'
      }`}
      role="status"
    >
      {status.ok ? (
        <CheckCircle2 className="w-3 h-3 shrink-0 mt-0.5" />
      ) : status.tone === 'note' ? (
        <Info className="w-3 h-3 shrink-0 mt-0.5" />
      ) : (
        <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
      )}
      <span className="min-w-0">{status.msg}</span>
    </div>
  );

  // ── Browser player, nothing reported ────────────────────────────────
  // The explainer stays: remote power, brightness and on/off schedules all
  // need the native bridge, and this screen will never have one.
  //
  // But Blank / Wake now DO work here (2026-08-25). The soft blank is drawn
  // by the player page itself, so a browser player blanks and wakes exactly
  // like a Goodview panel — this is the first control in this panel that is
  // genuinely bridge-free, and withholding it would be the mirror image of
  // the "dead button" mistake this branch was created to fix.
  if (browserPlayer && !caps.reported) {
    return (
      <div className="bg-slate-50/60">
        {header}
        <div className="px-3.5 pb-3 pt-1 flex items-start gap-2">
          <Info className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
          <p className="text-[10px] text-slate-500 leading-snug">
            {t('screens.display.browserPlayer')}
          </p>
        </div>
        {sleepAwakeRow}
        {statusRow}
      </div>
    );
  }

  // ── Nothing reported yet ────────────────────────────────────────────
  // Explainer + EXACTLY the actions the server gate accepts on a null
  // verdict: Blank, Wake, a brightness raise, and the schedule. Volume,
  // Reboot and panel POWER are withheld — the API refuses all three here, so
  // a button for any of them would fail 100% of the time.
  //
  // Blank JOINED this list on 2026-08-25 and that is the point of the split:
  // it is soft now, so it works on an unprobed screen exactly as well as on
  // a probed one. `powerRow` renders as its explainer sentence, which is
  // where the old "blanking stays disabled until it reports" line went.
  if (!caps.reported) {
    return (
      <div className="bg-slate-50/60">
        {header}
        <div className="px-3.5 pb-3 pt-1 flex items-start gap-2">
          <Info className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
          <p className="text-[10px] text-slate-500 leading-snug">
            {t('screens.display.notReported')}
          </p>
        </div>
        {brightnessRow}
        {sleepAwakeRow}
        {scheduleRow}
        {statusRow}
        {/* 2026-10-18 — basic Android settings: their own report, so they
            do not wait on this panel's display verdict. */}
        <ScreenDeviceSettings screenId={screen.id} readOnly={disabled} />
      </div>
    );
  }

  return (
    <div className="bg-slate-50/60">
      {header}

      {/* ── Volume ─────────────────────────────────────────────── */}
      {caps.volume.available ? (
        <LevelRow
          icon={<Volume2 className="w-3.5 h-3.5 text-slate-400" />}
          label={t('screens.display.volume')}
          note={caps.volume.noteKey ? t(caps.volume.noteKey) : null}
          min={0}
          reported={reportedVolume}
          unknownPark={0}
          unknownHint={t('screens.display.levelUnknown')}
          disabled={disabled || lockedBy('SET_VOLUME')}
          accentClass="accent-indigo-600"
          onCommit={(p) =>
            send('SET_VOLUME', {
              percent: clampVolume(p),
              okMsg: t('screens.display.volumeSent', { percent: clampVolume(p) }),
            })
          }
        />
      ) : (
        caps.volume.noteKey && (
          <div className="px-3.5 py-2.5 border-t border-slate-100 flex items-start gap-2">
            <VolumeX className="w-3.5 h-3.5 text-slate-300 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="text-[11px] font-bold text-slate-400">
                {t('screens.display.volume')}
              </div>
              <p className="text-[10px] text-slate-400 leading-snug">{t(caps.volume.noteKey)}</p>
            </div>
          </div>
        )
      )}

      {/* ── Brightness ─────────────────────────────────────────── */}
      {brightnessRow}

      {/* ── Blank / Wake — SOFT, always available (2026-08-25) ──── */}
      {sleepAwakeRow}

      {/* ── Panel power — HARD, allowlisted (2026-08-25) ────────── */}

      {/* ── Reboot ─────────────────────────────────────────────── */}
      {/* NOTE: on today's fleet this ALWAYS takes the `else` branch — we do
          not hold device owner, so the probe reports reboot:'none'. The
          else branch is a single explanatory row, not an empty section and
          not a dangling divider (the divider belongs to the row). */}
      {caps.reboot.available ? (
        <div className="px-3.5 py-2.5 border-t border-slate-100">
          <button
            type="button"
            disabled={disabled || lockedBy('REBOOT')}
            onClick={(e) => {
              e.stopPropagation();
              void confirmReboot();
            }}
            // Fixed rose, not brand color: a destructive control must read
            // as danger on a tenant whose brand primary happens to be mint.
            className="w-full flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg border border-rose-200 bg-white text-[11px] font-bold text-rose-600 hover:bg-rose-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {busy === 'REBOOT' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Power className="w-3.5 h-3.5" />
            )}
            {t('screens.display.reboot')}
          </button>
          <p className="text-[10px] text-slate-400 leading-snug mt-1">
            {t('screens.display.rebootHint')}
          </p>
        </div>
      ) : (
        // reboot: 'none' — per the spec there is NO button here at all. The
        // line below is text, and it tells the operator what would unlock it
        // instead of leaving a silent hole where a control used to be.
        caps.reboot.noteKey && (
          <div className="px-3.5 py-2.5 border-t border-slate-100 flex items-start gap-2">
            <Power className="w-3.5 h-3.5 text-slate-300 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="text-[11px] font-bold text-slate-400">
                {t('screens.display.reboot')}
              </div>
              <p className="text-[10px] text-slate-400 leading-snug">{t(caps.reboot.noteKey)}</p>
            </div>
          </div>
        )
      )}

      {/* ── On/off schedule ────────────────────────────────────── */}
      {scheduleRow}

      {statusRow}

      {/* ── Android settings (2026-10-18) — collapsed until opened ── */}
      <ScreenDeviceSettings screenId={screen.id} readOnly={disabled} />
    </div>
  );
}
