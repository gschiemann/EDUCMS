"use client";

/**
 * ScreenSettingsSections — the per-screen "Full settings" body, mounted by
 * the v3 drawer. (Extracted 2026-09-01 from the classic Screens page, which
 * was retired 2026-09-14; its gear/popover wrappers went with it.) Operator report that forced
 * the move: *"when i go to the screens menu and then hit the 3 dots and select
 * full settings, it reverts the entire screen back to the classic layout and it
 * pulls up the menu but moves it to the top of the screen instead of it being
 * next to the actual screen im working on....just a fucking mess"*.
 *
 * Two things were wrong and both are fixed here:
 *
 * 1. **The v3 Screens page had to hand the operator over to the classic page**
 *    to show this popover (a `classicOnce` hop plus a `?screen=` handoff). The
 *    whole surface changed underneath them. This module is the fix: ONE
 *    implementation, mounted by BOTH pages, so "Full settings" never swaps the
 *    page again.
 *
 * 2. **The anchor was measured before the scroll landed.** The old code called
 *    `setOpen(true)` and `scrollIntoView({ behavior: 'smooth' })` in the same
 *    tick, then measured the trigger's `getBoundingClientRect()` in the very
 *    next effect — i.e. while the row was still wherever it had been, possibly
 *    far outside the viewport. `clampPopoverAnchor` faithfully clamped that
 *    off-screen rect and parked the panel away from its row.
 *    `ScreenSettingsPopover` below never measures a rect it has not first
 *    proven is on screen: it scrolls with `behavior: 'auto'` (instant — the
 *    layout is final on return, with no animation to wait out), measures, then
 *    re-measures on the next animation frame and on any `scrollend`, and keeps
 *    the live scroll/resize re-measure that already existed.
 *
 * ── Structure ──────────────────────────────────────────────────────────
 *   ScreenSettingsPopover — controlled, trigger-less. Anchors to whatever
 *     element `getAnchorEl()` returns and calls `onClose()` on Esc /
 *     outside-pointerdown / the in-panel X. Portalled to `document.body` so no
 *     ancestor's `overflow:hidden` can clip it.
 *
 * Dashboard surface (not player/widget), so nothing here is under the
 * Chromium-83 rules — but per CLAUDE.md habit there is no `inset` shorthand and
 * no `inset-*` Tailwind utility in this file, and no `backdrop-blur` (this can
 * mount over always-visible chrome on a phone).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import {
  AlertCircle, Check, CheckCircle2, ChevronDown, Copy, ExternalLink, Loader2,
  RefreshCw, Settings, WifiOff, X,
} from 'lucide-react';
import {
  useHardwareCatalog, useLatestPlayerVersion, useScreenDeviceInventory,
  useSetScreenCanvas, useSetScreenConsoleProfile, useSetScreenHardwareModel,
  useSetScreenOrientation, useSetScreenSyncOffset, useSyncTrimSuggestions,
  useTenantPosterStandard,
} from '@/hooks/use-api';
import { ScreenDisplayControls } from '@/components/screens/ScreenDisplayControls';
import { ScreenSetupSection } from '@/components/screens/ScreenSetupSection';
import { clampPopoverAnchor } from '@/lib/clamp-popover-anchor';

/**
 * Is an installed APK at or past the latest published one?
 *
 * Compares semver-ish strings — strips a leading `v` and compares numeric
 * dotted segments, so `1.1.11` beats `1.1.9` (a plain string compare does not).
 *
 * Returns `null` for UNKNOWN whenever either side is missing. That third state
 * is load-bearing: a device that has never reported a version, and an API that
 * does not advertise a latest version for that component, must both read as "we
 * do not know" — never as "up to date" (which would hide a real update) and
 * never as "stale" (which would nag every screen in the fleet).
 */
export function compareInstalledVersion(
  installed: string | null | undefined,
  latest: string | null | undefined,
): boolean | null {
  if (!installed || !latest) return null;
  const norm = (v: string) => v.trim().replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const a = norm(installed);
  const b = norm(latest);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x < y) return false;
    if (x > y) return true;
  }
  return true;
}

/**
 * Per-screen APK push tracking, shared by both Screens surfaces.
 *
 * `ScreenSettingsPopover` reads `pushState` to tell the operator whether a push
 * actually took (a `playerVersion` different from the one recorded at push time
 * is the ONLY real proof). Both pages need the same record keyed the same way,
 * so it lives here rather than being re-declared per page.
 */
export function useApkPushState() {
  const [pushState, setPushState] =
    useState<Record<string, { at: number; priorVersion: string | null }>>({});
  const markPushed = useCallback((screenId: string, priorVersion: string | null) => {
    setPushState((s) => ({ ...s, [screenId]: { at: Date.now(), priorVersion: priorVersion ?? null } }));
  }, []);
  return { pushState, markPushed };
}

/**
 * Compact "time ago" formatter, e.g. "12s", "5m", "3h", "2d". Used on the
 * Screens list to replace the old "8:42:11 AM" (time-only, no date). The
 * caller is expected to also set a full-datetime tooltip so nothing is
 * lost — the chip is for at-a-glance, the tooltip is for forensics.
 */
export function timeAgo(ts: string | number | Date): string {
  const then = typeof ts === 'string' || typeof ts === 'number' ? new Date(ts) : ts;
  const sec = Math.max(0, Math.floor((Date.now() - then.getTime()) / 1000));
  if (sec < 45) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  // Older than a week: show MMM dd.
  return then.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ─────────────────────────────────────────────────────────────────────
// 2026-08-24 — per-screen settings menu, cleaned up. Operator: "we have
// so many settings you need to scroll to use them, it doesnt even say
// the name of the screen you are looking at in the settings, there are
// LED poster settings in standard LCD screens, the controller type
// should auto detect and not have a drop down".
//
// Shape of the menu now: identity header (screen name + detected
// hardware) → two quick actions → only the settings that apply to THIS
// screen's hardware (each section below gates itself off the detected
// model and returns null when it doesn't apply) → one collapsed
// "Device details" drawer holding every read-only diagnostic plus the
// hardware-correction escape hatch. The hardware DROPDOWN is gone from
// the face of the menu: the server already auto-detects the model from
// the player's own check-in (apps/api/src/screens/hardware-detect.ts,
// back-filled on /register) — the dashboard shows the answer instead
// of asking the question.
// ─────────────────────────────────────────────────────────────────────

/** Shared section label so the menu reads as one system. */
function MenuSectionLabel({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400" title={hint}>
      {children}
    </div>
  );
}

/**
 * Orientation — one-tap segmented chips instead of the old <select>.
 * Auto listed first because it IS the default (966780af): the player's
 * sensor / native-resolution heuristic decides, and the other two are
 * explicit overrides for sideways mounts. Same mutation + ~10s
 * signed-WS convergence as before. stopPropagation + no
 * disabled-while-pending: the defenses the LED canvas buttons earned
 * on 2026-05-26 ("its stuck on 1 now and i cant switch it") — a hung
 * first request must not wedge the control.
 */
/* readOnly (2026-09-01): these sections moved onto the v3 drawer's Settings
 * tab, whose own controls were permission-gated. Without the same gate a
 * CONTRIBUTOR would see every button live and collect a 403 on click — the
 * exact failure the drawer's gating comment describes. Driven by
 * `displayReadOnly`, which both surfaces already compute from the same role
 * check. */
function OrientationSection({ screen, readOnly }: { screen: any; readOnly?: boolean }) {
  const t = useTranslations();
  const setOrientation = useSetScreenOrientation();
  const current: string = screen?.orientation || 'AUTO';
  const options: Array<{ v: 'AUTO' | 'LANDSCAPE' | 'PORTRAIT'; label: string; hint: string }> = [
    { v: 'AUTO', label: 'Auto', hint: `${t('screens.autoSensor')} — the player works out which way the panel faces. Right for almost every screen.` },
    { v: 'LANDSCAPE', label: t('screens.landscape'), hint: 'Force landscape.' },
    { v: 'PORTRAIT', label: t('screens.portrait'), hint: 'Force portrait — for sideways-mounted panels.' },
  ];
  return (
    <div className="px-3.5 py-2.5 border-b border-slate-100">
      <MenuSectionLabel hint="Takes effect on the device within ~10 seconds via signed push.">
        {t('screens.orientation')}
      </MenuSectionLabel>
      <div className="flex items-center gap-1 mt-1.5">
        {options.map((o) => (
          <button
            disabled={readOnly}
            key={o.v}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (o.v === current) return;
              setOrientation.mutate({ id: screen.id, orientation: o.v });
            }}
            title={o.hint}
            aria-pressed={o.v === current}
            className={`flex-1 px-2 py-1.5 rounded-lg text-[11px] font-bold border transition-colors ${
              o.v === current
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-indigo-50 hover:border-indigo-200'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      {(setOrientation.isPending || setOrientation.isError) && (
        <div className="text-[10px] text-slate-400 mt-1">
          {setOrientation.isPending ? 'Saving…' : 'Could not save — tap again.'}
        </div>
      )}
    </div>
  );
}

/**
 * Hardware that actually drives a multi-panel LED canvas (the player
 * IS the LED controller and needs the panel count to size its render
 * surface). Same rule + id list as KioskSplash's LED banner
 * (isLedCanvasHardware) — source of truth for the ids:
 * packages/api-types/src/hardware-models.ts.
 */
const LED_CANVAS_HARDWARE = ['novastar-taurus', 'goodview-ecbox3576'];

/**
 * LED canvas — poster size × how many are chained.
 *
 * ONLY rendered on LED-canvas hardware. Every other model — EP6N / Pi /
 * generic Android / browser — renders at native resolution, so this
 * section was pure noise there (operator, 2026-08-24: "there are LED
 * poster settings in standard LCD screens"). Escape hatch: if an
 * override IS set (canvasW/H non-null) the section renders regardless
 * of the detected model, so a mis-detected screen can always see and
 * clear its override.
 *
 * 2026-09-01 — this used to hard-code "panels of 320×1080", which is only
 * the 1.86 mm poster. A NovaStar TB poster cannot report its own LED module
 * size, and the fleet also runs 1.56 mm (~360×1200), so the size now comes
 * from the tenant standard (Settings → LED posters) with a "Custom" escape
 * for a one-off. The saved canvas is still just `size.w × panels` by
 * `size.h` through the same `useSetScreenCanvas` — no API change.
 */
function LedCanvasSection({ screen, readOnly }: { screen: any; readOnly?: boolean }) {
  const setCanvas = useSetScreenCanvas();
  const standard = useTenantPosterStandard();
  const currentCanvasW: number | null = typeof screen?.canvasW === 'number' ? screen.canvasW : null;
  const currentCanvasH: number | null = typeof screen?.canvasH === 'number' ? screen.canvasH : null;

  const [customOn, setCustomOn] = useState(false);
  const [customW, setCustomW] = useState('');
  const [customH, setCustomH] = useState('');

  // Seed ONCE, and only after the tenant standard has actually loaded — a
  // stored canvas that does not divide by the standard is a one-off poster,
  // so the section opens on Custom showing the real numbers instead of
  // silently mis-describing the screen as N standard posters.
  //
  // The seed is deliberately unambiguous rather than clever: it does not try
  // to factor a stored width back into (size × panels), because many
  // factorings fit. It shows the exact canvas as one poster; picking a panel
  // count from there re-derives normally against whatever size is on screen.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || standard.isLoading) return;
    seeded.current = true;
    if (currentCanvasW === null || currentCanvasH === null) return;
    const n = currentCanvasH === standard.h && currentCanvasW % standard.w === 0
      ? currentCanvasW / standard.w
      : 0;
    if (n >= 1 && n <= 6) return; // it IS a chain of standard posters
    setCustomOn(true);
    setCustomW(String(currentCanvasW));
    setCustomH(String(currentCanvasH));
  }, [standard.isLoading, standard.w, standard.h, currentCanvasW, currentCanvasH]);

  // The size a panel button will multiply. Custom only counts once both
  // fields hold a sane whole number — an incomplete custom size must never
  // be silently paired with half of the standard.
  const cw = Number(customW);
  const ch = Number(customH);
  const customValid =
    Number.isInteger(cw) && Number.isInteger(ch) &&
    cw >= 32 && cw <= 8192 && ch >= 32 && ch <= 8192;
  const size = customOn && customValid ? { w: cw, h: ch } : { w: standard.w, h: standard.h };
  const sizeReady = !customOn || customValid;

  const currentPanelN: number | null =
    currentCanvasW !== null && currentCanvasH === size.h && currentCanvasW % size.w === 0
      ? currentCanvasW / size.w
      : null;
  const isLedHardware = LED_CANVAS_HARDWARE.includes(screen?.hardwareModel);
  const hasOverride = currentCanvasW !== null || currentCanvasH !== null;
  if (!isLedHardware && !hasOverride) return null;

  const isOff = currentCanvasW === null && currentCanvasH === null;

  return (
    <div className="px-3.5 py-2.5 border-b border-slate-100" data-testid="led-canvas-section">
      <MenuSectionLabel hint="The poster's module size, times how many are chained on this controller. The player sizes its canvas to match. Off = the controller's own viewport.">
        LED canvas
      </MenuSectionLabel>

      {/* Poster size — the tenant standard, or a one-off for this screen. */}
      <div className="flex items-center gap-1 mt-1.5 flex-wrap">
        <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mr-0.5">Poster</span>
        <button
          type="button"
          disabled={readOnly}
          onClick={(e) => { e.stopPropagation(); setCustomOn(false); }}
          aria-pressed={!customOn}
          className={`px-2 py-0.5 rounded text-[10px] font-bold border transition-colors ${
            !customOn
              ? 'bg-indigo-600 text-white border-indigo-600'
              : 'bg-white text-slate-600 border-slate-200 hover:bg-indigo-50 hover:border-indigo-200'
          }`}
          title={
            standard.isDefault
              ? `The built-in standard poster (${standard.w}×${standard.h}). Change it for every screen in Settings → LED posters.`
              : `Your organization's standard poster (${standard.w}×${standard.h}), set in Settings → LED posters.`
          }
        >
          Standard {standard.w}×{standard.h}
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setCustomOn(true);
            if (!customW) setCustomW(String(standard.w));
            if (!customH) setCustomH(String(standard.h));
          }}
          disabled={readOnly}
          aria-pressed={customOn}
          className={`px-2 py-0.5 rounded text-[10px] font-bold border transition-colors ${
            customOn
              ? 'bg-indigo-600 text-white border-indigo-600'
              : 'bg-white text-slate-600 border-slate-200 hover:bg-indigo-50 hover:border-indigo-200'
          }`}
          title="A one-off poster size for this screen only. Does not change the organization standard."
        >
          Custom
        </button>
        {customOn && (
          <span className="flex items-center gap-1">
            <input
              type="number" inputMode="numeric" min={32} max={8192}
              aria-label="Custom poster width"
              value={customW}
              disabled={readOnly}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setCustomW(e.target.value)}
              className="w-14 px-1 py-0.5 text-[10px] font-mono text-slate-700 bg-white border border-slate-200 rounded"
            />
            <span className="text-[10px] text-slate-300">×</span>
            <input
              type="number" inputMode="numeric" min={32} max={8192}
              aria-label="Custom poster height"
              value={customH}
              disabled={readOnly}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setCustomH(e.target.value)}
              className="w-14 px-1 py-0.5 text-[10px] font-mono text-slate-700 bg-white border border-slate-200 rounded"
            />
          </span>
        )}
      </div>

      {/* How many of them are chained. */}
      <div className="flex items-center gap-1 mt-1.5 flex-wrap">
        <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mr-0.5">Panels</span>
        <button
          disabled={readOnly}
          type="button"
          onClick={(e) => {
            // stopPropagation + no disabled-while-pending — see the
            // 2026-05-26 "its stuck on 1" incident: the popover's
            // document-level outside-handler must not see this click,
            // and a hung first request must not wedge the buttons.
            e.stopPropagation();
            if (isOff) return;
            setCanvas.mutate({ id: screen.id, canvasW: null, canvasH: null });
          }}
          aria-pressed={isOff}
          className={`px-2 py-0.5 rounded text-[10px] font-bold border transition-colors ${
            isOff
              ? 'bg-slate-700 text-white border-slate-700'
              : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
          }`}
          title="Automatic — a single standard poster, or the chain width set in ViPlex."
        >
          Off
        </button>
        {[1, 2, 3, 4, 5, 6].map((n) => {
          const w = size.w * n;
          const h = size.h;
          const active = currentPanelN === n;
          return (
            <button
              key={n}
              type="button"
              // Disabled while read-only, or while the custom size is
              // incomplete — never while a save is in flight (that is the
              // wedge the 2026-05-26 incident bought).
              disabled={readOnly || !sizeReady}
              onClick={(e) => {
                e.stopPropagation();
                if (active || !sizeReady) return;
                setCanvas.mutate({ id: screen.id, canvasW: w, canvasH: h });
              }}
              className={`px-2 py-0.5 rounded text-[10px] font-bold border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                active
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-indigo-50 hover:border-indigo-200'
              }`}
              title={`${n} poster${n === 1 ? '' : 's'} = ${w}×${h}`}
            >
              {n}
            </button>
          );
        })}
      </div>

      {/* The arithmetic, then what the server actually holds. Two separate
          facts — the selection on screen is not proof of the stored value. */}
      <div className="text-[10px] text-slate-500 mt-1.5 flex flex-wrap items-center gap-x-2">
        {!sizeReady ? (
          <span className="text-amber-600">Enter a poster size between 32 and 8192.</span>
        ) : currentPanelN !== null ? (
          <span className="font-mono">
            {currentPanelN} × {size.w}×{size.h} = {size.w * currentPanelN}×{size.h}
          </span>
        ) : (
          <span>Automatic — a single standard poster, or the chain width set in ViPlex.</span>
        )}
        <span className="text-slate-400 font-mono">
          Screen: {currentCanvasW !== null && currentCanvasH !== null
            ? `${currentCanvasW}×${currentCanvasH}`
            : 'automatic'}
          {setCanvas.isPending && ' · saving…'}
          {setCanvas.isError && ' · error'}
        </span>
      </div>

      {!isLedHardware && hasOverride && (
        <div className="text-[10px] text-amber-600 mt-1">
          Canvas override set on non-LED hardware — "Off" clears it.
        </div>
      )}
    </div>
  );
}

/**
 * Scoreboard console — which timing console feeds this screen over
 * serial (water-polo pilot, 2026-06-01). Persists
 * Screen.config.consoleProfile → manifest → CtsBridge. Only meaningful
 * on hardware WITH a serial path (EP6N dual RS232, ECBox RS232) — on
 * everything else (LCD TVs, browser players, Taurus) it was a
 * confusing dropdown about a port that doesn't exist. Gated on the
 * detected model's serial capability; escape hatch: renders whenever a
 * profile is already set so existing config can be seen + cleared.
 */
function ConsoleSection({ screen, readOnly }: { screen: any; readOnly?: boolean }) {
  const catalogQ = useHardwareCatalog();
  const setConsole = useSetScreenConsoleProfile();
  // Options kept in sync with the package's ConsoleProfileId + the
  // manifest allow-list; inlined so the dashboard route doesn't pull
  // the player-oriented @cms/scoreboard-cts runtime into its bundle.
  const CONSOLE_OPTIONS: Array<{ id: string; label: string; group: string; help: string; provisional?: boolean }> = [
    { id: 'cts-gen6', label: 'CTS Gen 6 / System 6', group: 'Colorado Time Systems', help: 'Wired RS-232 (1/4" jack) → native serial port.' },
    { id: 'cts-gen7', label: 'CTS Gen 7 (RS-232 output)', group: 'Colorado Time Systems', help: 'Gen 7 via its RS-232 output (legacy CTS protocol — same as Gen 6). Its RS-485 "Gen7/WA-2" output is a different protocol, not decoded yet.' },
    { id: 'cts-wttc', label: 'CTS Wireless Tabletop (WTTC)', group: 'Colorado Time Systems', help: 'USB-B → FTDI USB-serial adapter (/dev/ttyUSB0). Byte format pending a live capture.', provisional: true },
    { id: 'daktronics-allsport', label: 'Daktronics All Sport 5000', group: 'Daktronics', help: 'Enhanced RTD over RS-232. Byte offsets pending a real-hardware capture — playClock/possession unconfirmed.', provisional: true },
  ];
  const CONSOLE_GROUPS = Array.from(new Set(CONSOLE_OPTIONS.map((o) => o.group)));
  const currentConsole: string =
    (screen?.config && typeof screen.config === 'object' && typeof (screen.config as any).consoleProfile === 'string')
      ? (screen.config as any).consoleProfile
      : '';
  const model = (catalogQ.data?.models ?? []).find((m) => m.id === (screen?.hardwareModel ?? 'unknown')) ?? null;
  const caps = model?.caps;
  const hasSerial = !!caps && (caps.serialPorts >= 1 || caps.rs485);
  if (!hasSerial && !currentConsole) return null;
  return (
    <div className="px-3.5 py-2.5 border-b border-slate-100">
      <MenuSectionLabel hint="Which scoreboard timing console feeds this screen. Drives the serial settings + the port the player opens.">
        Scoreboard console
      </MenuSectionLabel>
      <select
        value={currentConsole || '__none__'}
        disabled={readOnly || setConsole.isPending}
        onChange={(e) => {
          const next = e.target.value;
          const payload = next === '__none__' ? null : next;
          if ((payload ?? '') === currentConsole) return;
          setConsole.mutate({ id: screen.id, consoleProfile: payload });
        }}
        className="mt-1.5 w-full text-[11px] font-medium text-slate-700 bg-white border border-slate-200 rounded px-1.5 py-1 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <option value="__none__">Not set (defaults to CTS Gen 6)</option>
        {CONSOLE_GROUPS.map((g) => (
          <optgroup key={g} label={g}>
            {CONSOLE_OPTIONS.filter((o) => o.group === g).map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </optgroup>
        ))}
      </select>
      {(() => {
        const sel = CONSOLE_OPTIONS.find((o) => o.id === currentConsole);
        return sel ? (
          <div className="text-[10px] text-slate-500 mt-1">
            {sel.help}
            {sel.provisional && (
              <span className="ml-1 inline-block rounded bg-amber-100 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-700">
                capture pending
              </span>
            )}
          </div>
        ) : null;
      })()}
    </div>
  );
}

/**
 * Frame-locked sync latency trim (2026-07-28) — logic unchanged, now
 * its own section. Parent mounts it only when the group has
 * syncMode='locked'. Mixed display models add different FIXED pipeline
 * delays (TV motion smoothing alone is 30-80ms) that no clock can see
 * — this is the AVR lip-sync knob: point a phone camera at both
 * screens, nudge until the flips align. Positive = this screen flips
 * EARLIER (compensates a slow display).
 */
function SyncTrimSection({ screen, readOnly }: { screen: any; readOnly?: boolean }) {
  const setSyncOffset = useSetScreenSyncOffset();
  // Tier-2: fleet-learned starting trim for this screen's hardware
  // model. Mounted-only-when-locked, so the query is always enabled.
  const trimSuggestions = useSyncTrimSuggestions(true);
  const modelSuggestion = (() => {
    if (!screen?.hardwareModel) return null;
    const s = trimSuggestions.data?.suggestions?.find(
      (x) => x.hardwareModel === screen.hardwareModel,
    );
    // Only worth surfacing when the fleet actually learned something
    // (≥3 samples, ≥10ms magnitude) and this screen is still untrimmed.
    if (!s || s.sampleCount < 3 || Math.abs(s.medianTrimMs) < 10) return null;
    if ((screen?.syncOffsetMs ?? 0) !== 0) return null;
    return s;
  })();
  return (
    <div className="px-3.5 py-2.5 border-b border-slate-100">
      <MenuSectionLabel hint="Nudge when this display flips relative to its frame-locked group. Positive = flip earlier (compensates a slow display).">
        Sync trim
      </MenuSectionLabel>
      {/* 2026-08-25 — operator: "it wasnt obvious thats what it was for,
          just a random button with sync." The hint above is hover-only
          (invisible on touch); the one-liner below is VISIBLE and says the
          job in plain words. Shows only because this screen's group has
          frame-locked sync on. */}
      <p className="text-[10px] text-slate-400 mt-0.5 leading-snug">
        Keeps this screen changing slides in perfect step with its group.
        If it flips a beat ahead or behind the screens next to it, nudge
        by a few ms until they match.
      </p>
      <div className="flex items-center flex-wrap gap-1 mt-1.5">
        {[-25, -5, +5, +25].map((step) => (
          <button
            disabled={readOnly}
            key={step}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              const cur = typeof screen?.syncOffsetMs === 'number' ? screen.syncOffsetMs : 0;
              const next = Math.max(-2000, Math.min(2000, cur + step));
              if (next !== cur) setSyncOffset.mutate({ id: screen.id, syncOffsetMs: next });
            }}
            className="px-2 py-0.5 rounded text-[10px] font-bold border bg-white text-slate-600 border-slate-200 hover:bg-indigo-50 hover:border-indigo-200 transition-colors"
            title={`${step > 0 ? 'Flip this screen ' + step + 'ms earlier (display is slow)' : 'Flip this screen ' + -step + 'ms later (display is fast)'}`}
          >
            {step > 0 ? `+${step}` : step}
          </button>
        ))}
        <button
          disabled={readOnly}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if ((screen?.syncOffsetMs ?? 0) !== 0) setSyncOffset.mutate({ id: screen.id, syncOffsetMs: null });
          }}
          className="px-2 py-0.5 rounded text-[10px] font-bold border bg-white text-slate-500 border-slate-200 hover:bg-slate-50 transition-colors"
          title="Clear the trim back to 0ms"
        >
          Reset
        </button>
        <span className="text-[10px] text-slate-400 ml-1 font-mono">
          {(screen?.syncOffsetMs ?? 0)}ms
          {setSyncOffset.isPending && ' · saving…'}
          {setSyncOffset.isError && ' · error'}
        </span>
      </div>
      {/* Tier-2 — fleet-learned preset: other venues already trimmed
          this display model; offer their median as a one-tap start. */}
      {modelSuggestion && (
        <button
          disabled={readOnly}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setSyncOffset.mutate({ id: screen.id, syncOffsetMs: modelSuggestion.medianTrimMs });
          }}
          className="mt-1 px-2 py-0.5 rounded text-[10px] font-bold border bg-indigo-50 text-indigo-600 border-indigo-200 hover:bg-indigo-100 transition-colors"
          title={`Learned across the fleet: ${modelSuggestion.sampleCount} screens of this model (${screen.hardwareModel}) run a median trim of ${modelSuggestion.medianTrimMs > 0 ? '+' : ''}${modelSuggestion.medianTrimMs}ms. Apply it as a starting point, then fine-tune by eye or camera.`}
        >
          Model preset: {modelSuggestion.medianTrimMs > 0 ? '+' : ''}{modelSuggestion.medianTrimMs}ms · Apply
        </button>
      )}
    </div>
  );
}

/**
 * Hardware identity — READ-ONLY by default. The server auto-detects
 * the model from the player's own check-in (hardware-detect.ts,
 * back-filled on /register), so the operator is shown the answer, not
 * asked the question (2026-08-24: "the controller type should auto
 * detect and not have a drop down"). "Change" reveals the catalog
 * select for the one case detection gets it wrong or comes back
 * unknown — a value picked there is a manual override the server
 * never overwrites (inferIfUnknown only fills a null column).
 */
function HardwareIdentityBlock({ screen }: { screen: any }) {
  const catalogQ = useHardwareCatalog();
  const setHardware = useSetScreenHardwareModel();
  const [editing, setEditing] = useState(false);
  const currentModelId: string = screen?.hardwareModel ?? 'unknown';
  const catalogModels = catalogQ.data?.models ?? [];
  const current = catalogModels.find((m) => m.id === currentModelId) ?? null;
  const known = !!current && current.id !== 'unknown';
  const caps = known ? current!.caps : undefined;
  // Only the trues show — accuracy beats noise.
  const badges: { label: string }[] = [];
  if (caps) {
    if (caps.serialPorts >= 2) badges.push({ label: 'Dual RS232' });
    else if (caps.serialPorts >= 1) badges.push({ label: 'RS232' });
    if (caps.rs485) badges.push({ label: 'RS485' });
    if (caps.gpioIn > 0 || caps.gpioOut > 0) {
      badges.push({ label: `GPIO ${caps.gpioIn}in/${caps.gpioOut}out` });
    }
    if (caps.hdmiIn) badges.push({ label: 'HDMI IN' });
    if (caps.rj45Out) badges.push({ label: 'RJ45 passthrough' });
    if (caps.powerOutVolts != null) badges.push({ label: `${caps.powerOutVolts}V aux out` });
    if (caps.npuTops > 0) badges.push({ label: `${caps.npuTops} TOPS NPU` });
    if (caps.decode4k) badges.push({ label: '4K decode' });
    if (caps.fanless) badges.push({ label: 'Fanless' });
    if (caps.duty247Rated) badges.push({ label: '24/7 rated' });
  }

  return (
    <div className="px-3.5 py-3 border-t border-slate-100">
      <div className="flex items-center justify-between gap-2">
        <MenuSectionLabel hint="Detected automatically from the player's check-in. Change it only if the detection is wrong.">
          Hardware
        </MenuSectionLabel>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setEditing((v) => !v); }}
          className="text-[10px] font-semibold text-slate-400 hover:text-slate-700 px-1.5 py-0.5 rounded hover:bg-slate-100 transition-colors"
          title="Override the auto-detected hardware model"
        >
          {editing ? 'Done' : 'Change'}
        </button>
      </div>
      <div className="text-[11px] font-medium text-slate-700 mt-1">
        {known
          ? current!.name
          : <span className="text-slate-400">Not detected — the player reports it on its next check-in</span>}
        {setHardware.isPending && <span className="text-slate-400"> · saving…</span>}
      </div>
      {known && current!.socOs && (
        <div className="text-[10px] text-slate-500 mt-0.5" title={current!.socOs}>{current!.socOs}</div>
      )}
      {editing && (
        <select
          value={currentModelId}
          disabled={setHardware.isPending || catalogQ.isLoading}
          onChange={(e) => {
            const next = e.target.value;
            if (next === currentModelId) return;
            // Picking "unknown" stores 'unknown'; the "Unassigned"
            // sentinel ('__clear__') sends null to clear the column —
            // which re-arms server auto-detect on the next check-in.
            const payload = next === '__clear__' ? null : next;
            setHardware.mutate({ id: screen.id, hardwareModel: payload });
            setEditing(false);
          }}
          className="mt-1.5 w-full text-[11px] font-medium text-slate-700 bg-white border border-slate-200 rounded px-1.5 py-1 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <option value="__clear__">Unassigned (re-detect on next check-in)</option>
          {catalogModels.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      )}
      {badges.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {badges.map((b) => (
            <span
              key={b.label}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-100"
            >
              <CheckCircle2 className="w-2.5 h-2.5" />
              {b.label}
            </span>
          ))}
        </div>
      )}
      {/* CLAUDE.md rule #10 — Chromium 83 warning. Only fires for
          hardware whose minimum WebView is ≤ 83 (today: Taurus). */}
      {caps && caps.chromiumMin <= 83 && (
        <div
          className="flex items-start gap-2 px-2 py-1.5 rounded border border-amber-200 bg-amber-50 mt-1.5"
          title="This hardware ships an older Chromium that does not support modern CSS shorthand."
        >
          <AlertCircle className="w-3.5 h-3.5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="text-[10px] text-amber-800 leading-snug">
            <span className="font-bold">Chromium {caps.chromiumMin} device.</span>
            {' '}Uses long-hand CSS per CLAUDE.md rule #10
            (no <code className="font-mono bg-amber-100 px-1 rounded">inset</code> shorthand,
            no flex <code className="font-mono bg-amber-100 px-1 rounded">gap</code>).
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Device details — every read-only diagnostic in one drawer, collapsed
 * by default so the menu's face stays short. Rolls up the fields
 * already on the Screen payload (no new endpoint): OS / push channel /
 * APK versions / cache / OTA / location, plus hardware identity and
 * the device fingerprint. Operators only come here when support asks.
 */
function DeviceDetails({ screen }: { screen: any }) {
  // Lazy by construction: DeviceDetails only mounts while the drawer is
  // open, so this fetch fires exactly when an operator actually looks.
  const inventoryQ = useScreenDeviceInventory(screen?.id ?? '', true);
  const inv: any = inventoryQ.data?.report ?? null;
  const ownerPkg: string | null =
    typeof inv?.admin?.deviceOwnerPackage === 'string' && inv.admin.deviceOwnerPackage
      ? inv.admin.deviceOwnerPackage
      : null;
  // Probe shape: { enumerable, visibleCount, candidates: string[] } —
  // candidates are plain package names matching the vendor prefixes.
  const vendorPkgs: string[] = Array.isArray(inv?.vendorPackages?.candidates)
    ? inv.vendorPackages.candidates.filter((p: unknown) => typeof p === 'string')
    : [];
  const cache: any = screen?.lastCacheReport || null;
  const cacheLine = cache
    ? `${cache.totalAssets ?? '?'} assets · ${cache.totalBytes != null ? Math.round(cache.totalBytes / 1024 / 1024) + ' MB' : '? size'}`
    : 'not reported';
  const emergencyLine = cache?.emergency?.count != null
    ? `${cache.emergency.count} emergency assets`
    : 'no emergency report';

  const otaState: string | null = screen?.lastOtaState ?? null;
  const otaMsg: string | null = screen?.lastOtaMessage ?? null;
  const otaAt: string | null = screen?.lastOtaAt ?? null;
  const otaProg: number | null = screen?.lastOtaProgress ?? null;

  const playerV: string | null = screen?.playerVersion ?? null;
  const playerVAt: string | null = screen?.playerVersionAt ?? null;
  const managerV: string | null = screen?.managerVersion ?? null;
  const managerVAt: string | null = screen?.managerVersionAt ?? null;

  const row = (label: string, value: React.ReactNode, mono = false) => (
    <div className="flex flex-col min-w-0">
      <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">{label}</div>
      <div className={`text-[11px] text-slate-700 truncate ${mono ? 'font-mono' : 'font-medium'}`} title={typeof value === 'string' ? value : undefined}>
        {value || <span className="text-slate-300">—</span>}
      </div>
    </div>
  );

  return (
    <div className="bg-slate-50/40">
      <div className="px-3.5 py-3">
        <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
          {row('OS', screen?.osInfo)}
          {row('Browser', screen?.browserInfo)}
          {/* Classic's row showed the IP; nothing in v3 did (2026-09-14 audit). */}
          {row('IP address', (screen as any)?.ipAddress)}
          {/* 2026-07-31 — push-channel health (see the poll-only chip). */}
          {row('Push channel', (screen as any)?.pushChannel === 'live'
            ? 'Live (instant commands)'
            : (screen as any)?.pushChannel === 'stale'
              ? 'Down — polling only'
              : 'Unknown')}
          {/* 2026-08-24 — from the persisted device inventory. Which app
              holds device OWNER decides what a provisioning ceremony would
              have to displace; the vendor-app list is the recipe-authoring
              evidence. Rows render only once a probe has reported. */}
          {inv && row(
            'Device owner',
            ownerPkg
              ? <span className="font-mono" title={ownerPkg}>{ownerPkg}</span>
              : 'None',
          )}
          {inv && vendorPkgs.length > 0 && row(
            'Vendor apps',
            <span title={vendorPkgs.join('\n')}>
              {vendorPkgs.length} detected
            </span>,
          )}
          {row(
            'Player APK',
            playerV ? (
              <>
                <span className="font-mono">v{playerV}</span>
                {playerVAt && <span className="text-slate-400"> · {timeAgo(playerVAt)}</span>}
              </>
            ) : null,
          )}
          {row(
            'Manager APK',
            managerV ? (
              <>
                <span className="font-mono">v{managerV}</span>
                {managerVAt && <span className="text-slate-400"> · {timeAgo(managerVAt)}</span>}
              </>
            ) : null,
          )}
          {row('Cache', cacheLine)}
          {row('Emergency cache', emergencyLine)}
          {row(
            'Last OTA',
            otaState ? (
              <span className="flex flex-col">
                {/* 2026-08-14 — UP_TO_DATE is the terminal state of a healthy
                    check. Green + plain English; every other state stays on
                    the raw token so an unfamiliar one is never disguised as
                    normal. */}
                <span className={`font-semibold ${otaState === 'UP_TO_DATE' ? 'text-emerald-700' : otaState === 'RELAUNCH_BLOCKED' ? 'text-amber-700' : otaState === 'ERROR' ? 'text-rose-700' : ''}`}>
                  {/* 2026-09-01 — RELAUNCH_BLOCKED: the install LANDED but
                      Android refused the background relaunch (no HOME / no
                      overlay grant / OEM device owner). Amber, not rose:
                      nothing failed, a person is needed. The device's own
                      message (naming the missing grant) renders below. */}
                  {otaState === 'UP_TO_DATE' ? 'Up to date' : otaState === 'RELAUNCH_BLOCKED' ? 'Installed — needs a tap' : otaState}
                  {otaProg != null && otaProg < 100 ? ` ${otaProg}%` : ''}
                </span>
                {otaMsg && <span className="text-[10px] text-slate-500 truncate" title={otaMsg}>{otaMsg}</span>}
                {otaAt && <span className="text-[10px] text-slate-400">{timeAgo(otaAt)}</span>}
              </span>
            ) : null,
          )}
          {row(
            'Location',
            screen?.address
              ? <span title={`${screen.latitude}, ${screen.longitude}`}>{screen.address}</span>
              : screen?.latitude != null
                ? <span className="font-mono">{Number(screen.latitude).toFixed(3)}, {Number(screen.longitude).toFixed(3)}</span>
                : null,
          )}
        </div>
      </div>
      <HardwareIdentityBlock screen={screen} />
      <DeviceFingerprintRow fingerprint={(screen as any).deviceFingerprint || ''} />
    </div>
  );
}

function DeviceFingerprintRow({ fingerprint }: { fingerprint: string }) {
  const t = useTranslations();
  const [copied, setCopied] = useState(false);

  if (!fingerprint) {
    return (
      <div className="px-3.5 py-2.5 border-t border-slate-100 bg-slate-50/40">
        <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-1">
          Device fingerprint
        </div>
        <div className="text-[10px] text-slate-400 italic">
          Not yet reported — kiosk has not registered.
        </div>
      </div>
    );
  }

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(fingerprint);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Some browsers / iframes block clipboard. Fall back to a
      // text-area-and-execCommand selection so the operator can at
      // least Ctrl+C from a focused field.
      const ta = document.createElement('textarea');
      ta.value = fingerprint;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try { document.execCommand('copy'); setCopied(true); window.setTimeout(() => setCopied(false), 1600); } catch {}
      document.body.removeChild(ta);
    }
  };

  return (
    <div className="px-3.5 py-2.5 border-t border-slate-100 bg-slate-50/40">
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">
          Device fingerprint
        </div>
        <button
          type="button"
          onClick={handleCopy}
          title={copied ? 'Copied!' : 'Copy fingerprint to clipboard'}
          aria-label={copied ? 'Copied' : 'Copy device fingerprint'}
          className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500 hover:text-slate-800 px-1.5 py-0.5 rounded hover:bg-slate-100 transition-colors"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-emerald-600" />
              <span className="text-emerald-700">{t('screens.copied')}</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              <span>{t('screens.copy')}</span>
            </>
          )}
        </button>
      </div>
      <div className="font-mono text-[10px] text-slate-700 break-all leading-tight select-all">
        {fingerprint}
      </div>
    </div>
  );
}

/**
 * Per-screen settings popover — anchored off the control that opened it (the
 * v3 row's ⋮ kebab or the v3 detail drawer's
 * "Full settings" row). First occupant is "Push APK update" with real feedback
 * about whether the push actually took effect; the component is
 * structured so more settings (restart, orientation, brightness, cache
 * clear, etc.) can slot in as menu items without reshuffling layout.
 *
 * Feedback logic:
 *   - just clicked Push       → "Waiting for kiosk response…" (spinner)
 *   - kiosk reported new ver  → "Updated to vN.M.P ✓" (emerald)
 *   - >90s with no version    → "No response — check Install
 *                                 permissions on the device"
 *   - currently up to date    → quiet success chip
 *
 * Portalled to `document.body` and viewport-anchored, so it stays glued to the
 * row even when the Screens list scrolls and no ancestor's `overflow:hidden`
 * (the group card's rounded clip, the `divide-y` wrapper) can trim it.
 */
export interface ScreenSettingsContentProps {
  screen: any;
  pushState: { at: number; priorVersion: string | null } | undefined;
  pending: boolean;
  onPushApk: () => void;
  onRefreshWeb: () => void;
  refreshWebPending: boolean;
  previewHref: string;
  /** 2026-07-28 — parent group has frame-locked sync ON (shows the trim UI). */
  groupSyncLocked?: boolean;
  /** 2026-08-13 — opens the per-screen on/off schedule editor (page owns it). */
  onOpenDisplaySchedule: () => void;
  /**
   * The signed-in role cannot drive display control — panel renders but
   * every control is inert.
   *
   * This used to be `isViewer` (RESTRICTED_VIEWER only), which meant a
   * CONTRIBUTOR — a role the API's `@RequireRoles(SUPER_ADMIN,
   * DISTRICT_ADMIN, SCHOOL_ADMIN)` structurally forbids — got a fully
   * enabled panel including the rose Restart button, and only found out at
   * the 403. The page now derives it from the same role set the API uses.
   */
  displayReadOnly?: boolean;
  /**
   * The FULL screen row for this id when the list we're rendering from is
   * the group payload, whose `select` whitelist omits displayCapabilities.
   * Without it a grouped screen reads "not reported yet" forever in the
   * primary layout while the identical ungrouped screen shows controls.
   */
  capabilitySource?: {
    displayCapabilities?: unknown;
    displayCapabilitiesAt?: string | null;
    // 2026-08-24 settings-menu cleanup — the menu also reads these two
    // through the same full-row fallback: `config` (consoleProfile) is a
    // JSON blob the group select deliberately keeps off the 10s-refetch
    // payload, and `hardwareModel` doubles up here so pre-existing group
    // payloads (older API) still gate correctly.
    hardwareModel?: string | null;
    config?: unknown;
  } | null;
}

/**
 * Every per-screen setting, with no chrome of its own.
 *
 * Extracted 2026-09-01 so there is exactly ONE list of screen settings.
 * Operator: "this menu is almost the same as clicking open all settings ...
 * just integrate the all settings page into the actions tab and call it
 * settings instead ... just dont miss any settings." Two hand-maintained
 * copies is precisely how a setting goes missing, so the v3 drawer's Settings
 * tab and the classic page's gear popover render THIS — the same component,
 * the same order, the same hardware gating. Adding a setting here reaches both
 * surfaces; there is no second place to remember.
 *
 * It owns no positioning, no portal and no dismissal: whatever renders it
 * decides how it is presented.
 */
export function ScreenSettingsSections({
  screen,
  pushState,
  pending,
  onPushApk,
  onRefreshWeb,
  refreshWebPending,
  previewHref,
  groupSyncLocked,
  onOpenDisplaySchedule,
  displayReadOnly,
  capabilitySource,
  showIdentityHeader = false,
  showQuickActions = true,
  onClose,
}: ScreenSettingsContentProps & {
  /** Preview + Refresh. The drawer offers both in its own Safe section with
   *  fuller copy, so it turns these off rather than showing them twice. */
  showQuickActions?: boolean;
  /** The popover draws its own name/status header with a close X. The drawer
   *  already has one above the tabs, so it renders the sections alone. */
  showIdentityHeader?: boolean;
  onClose?: () => void;
}) {
  const t = useTranslations();
  // The panel's own SETUP telemetry. This component only mounts while an
  // operator is actually looking, so the read fires then — never polled.
  const setupInventoryQ = useScreenDeviceInventory(screen?.id ?? '', true);
  // Device details collapsed by default so the face stays short
  // (2026-08-24: "so many settings you need to scroll").
  const [detailsOpen, setDetailsOpen] = useState(false);

  const currentVersion: string | null = (screen as any).playerVersion ?? null;
  // Latest published APK — fetched on demand when the menu opens, so a
  // closed menu costs nothing. Cached 10min in React Query.
  const { data: latestVersionInfo } = useLatestPlayerVersion();
  const latestVersion: string | null = latestVersionInfo?.versionName ?? null;
  const upToDate = compareInstalledVersion(currentVersion, latestVersion);
  /**
   * The COMPANION Manager APK (2026-09-01 — operator: *"from the dashboard, if
   * the player is on the latest version but the manager is not, there is no way
   * to push the updated manager"*).
   *
   * The push row used to grade the Player alone, so a screen whose Player was
   * current showed a quiet green chip and NO button — even when its Manager was
   * releases behind. `onPushApk` is still the transport (it sends
   * CHECK_FOR_UPDATES, which the APK turns into a Manager upgrade with content
   * held); the only thing that was missing was a reason to offer it.
   *
   * `managerUpToDate` is `null` — UNKNOWN, behaviour unchanged — whenever
   * either side is missing, which includes an API that does not yet advertise
   * `managerVersionName`. Silence beats a guess in both directions.
   */
  const currentManagerVersion: string | null = (screen as any).managerVersion ?? null;
  const latestManagerVersion: string | null = latestVersionInfo?.managerVersionName ?? null;
  const managerUpToDate = compareInstalledVersion(currentManagerVersion, latestManagerVersion);
  /** Known-stale, not merely unknown — the ONLY state that re-offers the push. */
  const managerStale = managerUpToDate === false;
  // Signing cutover (2026-08-03): a `-debug` install can NEVER take a
  // v1.1.0+ OTA — package id AND signing key changed, Android refuses
  // both transitions. The server already answers these screens with
  // uptoDate+needsManualReinstall; this mirrors that verdict in the UI
  // so pushing isn't offered where it cannot work, and the fleet list
  // doubles as the reinstall-tour checklist.
  const needsReinstall = (() => {
    if (!currentVersion || !latestVersion) return false;
    if (!/-debug$/i.test(currentVersion.trim())) return false;
    const l = latestVersion.trim().replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
    return (l[0] ?? 0) > 1 || ((l[0] ?? 0) === 1 && (l[1] ?? 0) >= 1); // latest >= 1.1.0
  })();
  const pushed = !!pushState;
  const pushedMsAgo = pushState ? Date.now() - pushState.at : 0;
  const updatedSincePush = !!(pushState && currentVersion && currentVersion !== (pushState.priorVersion ?? null));
  // APK install end-to-end (WS hop + download + Android install prompt
  // + replace + restart + first heartbeat after restart) takes 1-3 min
  // on a fast network, longer on Wi-Fi behind a school firewall.
  // 90s was too aggressive — operator was seeing "no response" before
  // the install even finished. Bumped to 5 min. Stages give the
  // operator real signal during the wait instead of one big "Waiting…".
  // 2026-04-28 — bumped 5 min → 35 min to match the 30-min Manager
  // periodic OTA cadence (UX audit P0-I). Previous 5-min wall-clock
  // timeout fired before the periodic worker could even attempt
  // installation, causing every WS-failed push to show "Failed" even
  // though the next 30-min tick would succeed. The button stays
  // disabled during this window; lastOtaState surfacing (above)
  // gives device-truth signal in the meantime.
  const PUSH_TIMEOUT_MS = 35 * 60_000;
  const stillWaiting = pushed && !updatedSincePush && pushedMsAgo < PUSH_TIMEOUT_MS;
  const timedOut = pushed && !updatedSincePush && pushedMsAgo >= PUSH_TIMEOUT_MS;
  // HONESTY FIX (2026-04-27): the previous stage machine showed
  // sending → downloading → installing → restarting purely off a
  // stopwatch (`pushedMsAgo`). We had ZERO real signal from the kiosk
  // for any of those phases — the screen could be powered off and the
  // dashboard would still march through "downloading…installing…" then
  // declare "no response." Operator caught us lying when v1.0.9's OTA
  // worker was silently no-op'ing because SharedPreferences for
  // `api_root` were never written by the JS bridge (this is fixed in
  // v1.0.11 — until then the worker exits on launch).
  //
  // We only have TWO real signals from the kiosk:
  //   1. pushedMsAgo  — time since the operator clicked Push
  //   2. currentVersion — versionName the kiosk reports via heartbeat
  // So that's all we surface. `stage` is now one of:
  //   idle      | not pushed
  //   pending   | pushed, no new version yet (single honest "waiting")
  //   installed | heartbeat reports new versionName
  //   timeout   | 5 min elapsed without a version change
  // No fake intermediate steps. v1.0.11 will add real per-phase device
  // reporting (POST /api/v1/screens/:id/ota-state CHECKING|DOWNLOADING|
  // VERIFYING|INSTALLING|ERROR) and we'll surface those as honest
  // sub-states only AFTER the kiosk has actually told us each phase
  // started. See todo: "Replace dashboard's optimistic OTA timeline
  // with real device-reported state".
  const stage: 'idle' | 'pending' | 'installed' | 'timeout' = !pushed
    ? 'idle'
    : updatedSincePush
    ? 'installed'
    : pushedMsAgo >= PUSH_TIMEOUT_MS
    ? 'timeout'
    : 'pending';

  // ── 2026-08-24 settings-menu cleanup ──────────────────────────────
  // Merged row: group rows come from the screen-groups select
  // whitelist, which deliberately omits the big JSON columns
  // (displayCapabilities, config). The page passes the full
  // GET /screens row as `capabilitySource`; take the whitelisted-away
  // fields from there so grouped and ungrouped screens render the
  // same menu.
  const fullRow: any = capabilitySource ?? null;
  const s: any = fullRow
    ? {
        ...screen,
        displayCapabilities: fullRow.displayCapabilities,
        displayCapabilitiesAt: fullRow.displayCapabilitiesAt,
        hardwareModel: (screen as any).hardwareModel ?? fullRow.hardwareModel ?? null,
        config: (screen as any).config ?? fullRow.config ?? null,
      }
    : screen;

  // What KIND of player is this? Drives which sections exist at all —
  // a browser player has no APK to push and no native bridge to
  // power-control, so those sections were dead weight there ("every
  // setting needs to make sense").
  const osInfoLc = String(s?.osInfo || '').toLowerCase();
  const isAndroidPlayer = osInfoLc.includes('android') || !!s?.playerVersion;
  const isBrowserPlayer =
    !isAndroidPlayer &&
    (s?.hardwareModel === 'web' || (!!osInfoLc && !osInfoLc.includes('android')));

  // Detected hardware name for the identity header. Session-cached
  // catalog query — N rows share one fetch.
  const catalogQ = useHardwareCatalog();
  const detectedModel =
    (catalogQ.data?.models ?? []).find((m) => m.id === (s?.hardwareModel ?? 'unknown')) ?? null;
  const detectedName = detectedModel && detectedModel.id !== 'unknown' ? detectedModel.name : null;

  return (
    <>
      {/* Identity header — the operator must always know WHICH
          screen they're configuring (2026-08-24: "it doesnt even
          say the name of the screen you are looking at"). Sticky
          so the name stays put if the menu ever scrolls; also
          carries the X, which guarantees the popover is
          dismissable on touch (iOS tap-outside via document
          events is unreliable). */}
      {showIdentityHeader && (
          <div className="sticky top-0 z-10 bg-white border-b border-slate-100 px-3.5 py-2.5">
            <div className="flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  s.status === 'ONLINE' ? 'bg-emerald-500' : s.status === 'PENDING' ? 'bg-amber-400' : 'bg-slate-300'
                }`}
                title={s.status === 'ONLINE' ? t('screens.statusOnline') : s.status === 'PENDING' ? t('screens.statusPending') : t('screens.statusOffline')}
              />
              <span className="flex-1 min-w-0 text-[13px] font-bold text-slate-800 truncate" title={s.name}>
                {s.name || 'Screen'}
              </span>
              <button
                type="button"
                onClick={() => onClose?.()}
                aria-label={t('screens.closeSettings')}
                className="p-1 -mr-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 active:bg-slate-200 shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {/* Auto-detected hardware identity — the answer, not a
                dropdown ("the controller type should auto detect").
                Correction lives under Device details → Change. */}
            <div className="text-[10px] text-slate-400 font-medium mt-0.5 truncate">
              {detectedName ?? (isBrowserPlayer ? 'Browser player' : isAndroidPlayer ? 'Android player' : 'Player')}
              {s.resolution ? ` · ${s.resolution}` : ''}
            </div>
          </div>
      )}
          {/* Quick actions — the two things operators actually reach
              for. Everything else is a setting, below. */}
          {showQuickActions && (
            <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-slate-100">
              <a
                href={previewHref}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => onClose?.()}
                title="Open this screen's player in a browser tab"
                className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg border border-slate-200 bg-white text-[11px] font-bold text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
                Preview
              </a>
              <button
                type="button"
                onClick={() => { onClose?.(); onRefreshWeb(); }}
                disabled={refreshWebPending}
                title="Reload the player page on the device — picks up any deployed fix. Not an APK update."
                className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg border border-slate-200 bg-white text-[11px] font-bold text-slate-700 hover:bg-slate-50 hover:border-slate-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${refreshWebPending ? 'animate-spin text-indigo-500' : 'text-slate-400'}`} />
                {refreshWebPending ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>
          )}

          {/* Player app (APK) — Android players ONLY. A browser player
              has no APK, so the old always-on version strip + push
              button were noise there ("every setting needs to make
              sense"). Up to date + nothing in flight = one quiet
              line, no button (the old button was disabled anyway).

              2026-09-01 — …UNLESS the companion Manager is known-stale. A
              current Player is not "nothing to do" when the other half of the
              pair is behind, and this quiet chip was the whole reason there
              was "no way to push the updated manager": it stood in front of
              the button. `managerStale` is only ever true when BOTH versions
              are known, so an API that doesn't advertise the Manager version
              leaves this branch exactly as it was. */}
          {isAndroidPlayer && upToDate === true && !pushed && !managerStale && (
            <div
              className="flex items-center gap-2 px-3.5 py-2.5 border-b border-slate-100"
              title={`Latest published APK is v${latestVersion}. Updates are manual — push from here when one is available.`}
            >
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span className="text-[11px] font-semibold text-emerald-700">
                Player app v{currentVersion} — up to date
              </span>
            </div>
          )}
          {/* One row for everything else:
                IDLE → "Push update to v1.0.8" (or "Install Player")
                IN-FLIGHT → label morphs through the device-truth OTA
                       stages. Disabled so it can't be re-clicked
                       mid-push, but still visible as a single source
                       of truth. */}
          {isAndroidPlayer && !(upToDate === true && !pushed && !managerStale) && (() => {
            // 2026-04-28 (UX audit P0-C + I) — surface the device-truth
            // signals the kiosk has been writing to lastOtaState all
            // along. The dashboard previously ignored them entirely
            // and ran a 5-min wall-clock timeout, lying to operators
            // every push because the periodic worker is on a 30-min
            // cadence. Now: device-truth wins. Wall-clock falls back
            // only when the device is silent.
            const otaState: string | null = (screen as any)?.lastOtaState ?? null;
            const otaProgress: number | null = (screen as any)?.lastOtaProgress ?? null;
            const otaMessage: string | null = (screen as any)?.lastOtaMessage ?? null;
            const otaAt: string | null = (screen as any)?.lastOtaAt ?? null;
            const otaAtMs = otaAt ? new Date(otaAt).getTime() : 0;
            const pushAtMs = pushed ? pushState.at : 0;
            // Only trust device state newer than this push. Otherwise
            // we'd show stale state from a previous OTA cycle.
            const deviceTruth = pushAtMs > 0 && otaAtMs > pushAtMs ? otaState : null;

            const isInFlight = pushed && !updatedSincePush;
            const TIMEOUT_MS = 35 * 60_000;  // matches periodic worker cadence
            const isTimedOut = isInFlight && pushedMsAgo > TIMEOUT_MS;

            // Cutover screens get an explainer, not a push button — the
            // server would answer any push with needsManualReinstall, and
            // Android would refuse the install even if it didn't.
            if (needsReinstall && !isInFlight) {
              return (
                <div className="w-full flex items-start gap-3 px-3.5 py-3 text-left text-xs border-b border-slate-100 bg-rose-50/40">
                  <WifiOff className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <span className="flex-1 min-w-0">
                    <span className="block text-rose-700 font-bold">
                      OTA can’t cross the v1.1.0 signing change
                    </span>
                    <span className="block text-[10px] font-normal text-slate-500 mt-0.5">
                      Visit the screen: install the v1.1.0+ APK, re-pair it, then uninstall
                      the old app. Runbook: apps/player/RELEASE_SIGNING.md
                    </span>
                  </span>
                </div>
              );
            }

            // Effective stage — device truth first, wall-clock only as a
            // last resort.
            // 2026-08-14 — `uptodate` is a TERMINAL SUCCESS stage, not a
            // fault. Before the player reported it, a healthy up-to-date
            // kiosk answered a push with CHECKING and then went silent
            // forever, so this machine sat on 'pending' (spinner) for the
            // full 35 min and then fell into 'timeout' — amber warning
            // chrome on a screen that did exactly the right thing. It must
            // be matched BEFORE the isTimedOut/isInFlight fallbacks so a
            // healthy screen never renders as a warning.
            const effectiveStage: 'idle' | 'pending' | 'checking' | 'downloading' | 'verifying' | 'installing' | 'installed' | 'uptodate' | 'error' | 'timeout' | 'relaunch-blocked' =
              stage === 'installed' || updatedSincePush ? 'installed' :
              deviceTruth === 'INSTALLED' ? 'installed' :
              // 2026-09-01 — install landed, Android blocked the background
              // relaunch (BAL: no HOME / no overlay / OEM device owner).
              // Matched AFTER `updatedSincePush`: a reported version bump
              // proves the new build is RUNNING (someone tapped it), and
              // that green truth outranks this stale amber one.
              deviceTruth === 'RELAUNCH_BLOCKED' ? 'relaunch-blocked' :
              deviceTruth === 'ERROR' ? 'error' :
              deviceTruth === 'INSTALLING' ? 'installing' :
              deviceTruth === 'VERIFYING' ? 'verifying' :
              deviceTruth === 'DOWNLOADING' ? 'downloading' :
              deviceTruth === 'UP_TO_DATE' ? 'uptodate' :
              deviceTruth === 'CHECKING' ? 'checking' :
              isTimedOut ? 'timeout' :
              isInFlight ? 'pending' :
              'idle';

            const stageIcon: React.ReactNode =
              effectiveStage === 'installed' ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> :
              effectiveStage === 'uptodate'  ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> :
              effectiveStage === 'relaunch-blocked' ? <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" /> :
              effectiveStage === 'error'     ? <WifiOff className="w-4 h-4 text-rose-600 shrink-0" /> :
              effectiveStage === 'timeout'   ? <WifiOff className="w-4 h-4 text-amber-600 shrink-0" /> :
              ['pending', 'checking', 'downloading', 'verifying', 'installing'].includes(effectiveStage)
                ? <Loader2 className="w-4 h-4 text-indigo-500 shrink-0 animate-spin" />
                : <RefreshCw className={`w-4 h-4 shrink-0 ${upToDate === false ? 'text-amber-500' : 'text-indigo-500'}`} />;

            const pendingSecs = Math.floor(pushedMsAgo / 1000);
            const pendingHumanAgo = pendingSecs < 60
              ? `${pendingSecs}s ago`
              : `${Math.floor(pendingSecs / 60)}m ${pendingSecs % 60}s ago`;
            const timeoutCopy =
              upToDate === true
                ? `No version change after 35 min — kiosk was already on the latest.`
                : `No update after 35 min. Power-cycle the screen, check "Install unknown apps" permission, or sideload via ViPlex.`;

            const stageLabel =
              effectiveStage === 'installed'   ? `Kiosk installed v${currentVersion} ✓` :
              effectiveStage === 'uptodate'    ? `Kiosk checked in — already on v${currentVersion || latestVersion || '?'} ✓` :
              effectiveStage === 'relaunch-blocked' ? `Installed — kiosk needs a tap to relaunch` :
              effectiveStage === 'error'       ? `Install error: ${otaMessage || 'unknown error'}` :
              effectiveStage === 'installing'  ? `Installing on kiosk... ${otaMessage || ''}` :
              effectiveStage === 'verifying'   ? `Verifying APK signature on kiosk...` :
              effectiveStage === 'downloading' ? `Downloading on kiosk${otaProgress !== null ? ` (${otaProgress}%)` : '...'}` :
              effectiveStage === 'checking'    ? `Kiosk acknowledged push, checking server...` :
              effectiveStage === 'timeout'     ? timeoutCopy :
              effectiveStage === 'pending'     ? `Update sent ${pendingHumanAgo} — waiting for kiosk (≤ 35 min via periodic check)` :
              // Player current, companion Manager behind. Named for the app
              // that actually needs the push, so the operator is not told "on
              // latest" about the thing that isn't.
              upToDate === true && managerStale ? `Push update — Manager v${latestManagerVersion} available` :
              upToDate === true && !pushed     ? 'On latest — push anyway' :
              upToDate === false               ? `Push update to v${latestVersion}` :
                                                 'Push update to this screen';
            const stageColor =
              effectiveStage === 'installed' ? 'text-emerald-700 font-bold' :
              // Terminal SUCCESS — must be green, never the amber/rose
              // in-flight-or-broken chrome.
              effectiveStage === 'uptodate'  ? 'text-emerald-700 font-bold' :
              effectiveStage === 'relaunch-blocked' ? 'text-amber-700 font-bold' :
              effectiveStage === 'error'     ? 'text-rose-700 font-bold' :
              effectiveStage === 'timeout'   ? 'text-amber-700 font-bold' :
              isInFlight                     ? 'text-indigo-700 font-bold' :
                                                 'text-slate-700 font-semibold';
            // Sub-line — surface real device telemetry when in-flight.
            const subline =
              effectiveStage === 'uptodate'
                ? `Kiosk answered the push at ${otaAt ? new Date(otaAt).toLocaleTimeString() : 'check-in'} — nothing newer to install`
                : effectiveStage === 'relaunch-blocked'
                  // The device's own report names the missing grant; fall
                  // back to the generic remedy if the message got lost.
                  ? (otaMessage || 'Android blocked the auto-relaunch — open the player once on the panel, or grant “Display over other apps” in setup')
                : isInFlight
                  ? (deviceTruth
                      ? `Kiosk last reported ${deviceTruth} ${otaAt ? new Date(otaAt).toLocaleTimeString() : ''}`
                      : `If WS push didn’t reach kiosk, periodic check installs within 30 min`)
                  // Idle — the compact row replaced the old
                  // current→latest strip, so carry the installed
                  // version here where the decision is being made.
                  // When it is the MANAGER that is behind, say which app is
                  // current and which is not — "v1.1.11 installed" alone would
                  // read as an argument against pressing the button.
                  : upToDate === true && managerStale
                    ? `Player v${currentVersion} is current · Manager v${currentManagerVersion} → v${latestManagerVersion}`
                    : `${currentVersion ? `v${currentVersion} installed` : 'No Player version reported yet'} — updates are manual-only`;
            return (
              <button
                type="button"
                data-testid="apk-push"
                onClick={onPushApk}
                disabled={displayReadOnly || pending || stillWaiting || (upToDate === true && !pushed && !managerStale)}
                className="w-full flex items-center gap-3 px-3.5 py-3 text-left text-xs hover:bg-slate-50 disabled:opacity-80 disabled:cursor-not-allowed border-b border-slate-100"
                title={upToDate === true && managerStale
                  ? `This screen's player app is already on v${currentVersion} — only the companion Manager app (v${currentManagerVersion} → v${latestManagerVersion}) will update. Content keeps playing; the Manager upgrade is held until the player is idle.`
                  : upToDate === true && !pushed
                    ? 'Already on the latest version'
                    : 'Tells this kiosk to download + install the latest APK on its next check-in'}
              >
                {stageIcon}
                <span className="flex-1 min-w-0">
                  <span className={`block ${stageColor}`}>{stageLabel}</span>
                  {subline && (
                    <span className="block text-[10px] font-normal text-slate-400 mt-0.5">{subline}</span>
                  )}
                </span>
              </button>
            );
          })()}

          {/* ── Settings that apply to THIS screen ─────────────────
              Each section below gates itself off the detected
              hardware and renders null when it doesn't apply, so a
              standard LCD never sees LED-canvas or serial-console
              controls (2026-08-24: "there are LED poster settings in
              standard LCD screens"). */}
          <OrientationSection screen={s} readOnly={displayReadOnly} />
          <LedCanvasSection screen={s} readOnly={displayReadOnly} />
          <ConsoleSection screen={s} readOnly={displayReadOnly} />
          {groupSyncLocked && <SyncTrimSection screen={s} readOnly={displayReadOnly} />}

          {/* 2026-08-13 — volume / brightness / blank / reboot, each
              rendered only when this screen's own probe verdict says
              the hardware can do it. Browser players collapse to one
              honest line (no bridge → no report, no command lands).
              Opening the schedule editor closes the popover first —
              the popover dismisses on a document-level pointerdown
              and would otherwise fight the modal. */}
          <ScreenDisplayControls
            screen={s}
            readOnly={displayReadOnly}
            browserPlayer={isBrowserPlayer}
            onOpenSchedule={() => { onClose?.(); onOpenDisplaySchedule(); }}
          />

          {/* 2026-08-25 (v1.1.6) — first-boot permission state + the
              cable-free way back into it. Renders NOTHING when this panel
              has never reported a `setup` block (older APK / never probed),
              because "we do not know" must never look like "nothing is
              outstanding". See ScreenSetupSection. */}
          <ScreenSetupSection
            screen={s}
            inventoryReport={setupInventoryQ.data?.report ?? null}
            readOnly={displayReadOnly}
          />

          {/* Device details — every read-only diagnostic (OS, APK
              versions, cache, OTA history, location, fingerprint,
              hardware identity + correction), collapsed by default so
              the menu's face stays short. */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setDetailsOpen((v) => !v); }}
            aria-expanded={detailsOpen}
            className="w-full flex items-center justify-between px-3.5 py-2.5 text-left hover:bg-slate-50 border-t border-slate-100 transition-colors"
          >
            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Device details</span>
            <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${detailsOpen ? 'rotate-180' : ''}`} />
          </button>
          {detailsOpen && <DeviceDetails screen={s} />}
    </>
  );
}

export interface ScreenSettingsPopoverProps extends ScreenSettingsContentProps {
  /**
   * The element the panel anchors to — resolved LAZILY, never passed as a
   * prop value.
   *
   * Why a function: the v3 surface opens this popover in the same commit that
   * expands the group holding the row (a `?screen=` deep link), so at RENDER
   * time the row's ⋮ button may not exist yet. Ref callbacks run during commit,
   * before effects, so reading through a getter inside the effect always sees
   * the mounted element. A resolver also lets the caller fall back between
   * anchors (kebab → row) without this component knowing about either.
   */
  getAnchorEl: () => HTMLElement | null;
  /** Esc, an outside pointerdown, or the in-panel X. */
  onClose: () => void;
  /**
   * The popover was opened PROGRAMMATICALLY (a deep link, or the detail
   * drawer's "Full settings"), so the operator has not just looked at the row
   * — centre it. A direct click on a visible trigger leaves this false and the
   * page does not jump; the visibility guard below still rescues a trigger
   * that is off-screen.
   */
  scrollAnchorIntoView?: boolean;
}
