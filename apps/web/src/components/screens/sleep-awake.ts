/**
 * Sleep / Awake — the ONE pair of power buttons on a screen, and which of the
 * two is highlighted right now. Pure: no React, no clock of its own.
 *
 * Evidence, in the order it is trusted (the same evidence `panelPowerOffer`
 * reads — display-capabilities.ts):
 *   1. the native sleep report (`sleep.vb.off`, Android `interactive:false`),
 *      and the web player's own soft-blank report (`softBlankAt`, 2026-11-02 —
 *      a soft BLANK keeps painting under a black overlay, so render proof
 *      alone reads it as awake)
 *   2. render proof (`derivePanelPowerState`): painting → awake, not painting → sleeping
 *   3. the last command the API accepted — only while we wait for 1 and 2 to
 *      catch up, never as proof of the glass by itself
 *
 * We never claim a change the screen has not reported: after a command the
 * pressed button shows PENDING until the evidence agrees, and after
 * CONFIRM_WINDOW_MS without agreement the row says it is unconfirmed.
 */
import type { PanelPowerState } from './display-capabilities';

export type SleepAwakeTarget = 'sleep' | 'awake';
export type SleepAwakeCurrent = SleepAwakeTarget | 'unknown';

/** How long we wait for the screen's report to confirm a command. */
export const CONFIRM_WINDOW_MS = 30_000;
/** After this a command is history, not news — it stops explaining the row. */
export const COMMAND_RELEVANCE_MS = 10 * 60_000;

export interface SleepAwakeInput {
  panelState: PanelPowerState;
  /** Native report says the backlight is off by our hand (`nativeHardOff`). */
  hardOff: boolean;
  /** Native report says Android is not interactive (recent report only). */
  reportAsleep?: boolean;
  /** The web player reports its soft BLANK overlay on the glass (fresh only — `softBlankFresh`). */
  softBlank?: boolean;
  /** Last command the API accepted this session. */
  lastCommand: { target: SleepAwakeTarget; at: number } | null;
  /** A command currently on the wire. */
  inFlight: SleepAwakeTarget | null;
  now: number;
}

export interface SleepAwakeState {
  /** Which button is highlighted. 'unknown' highlights neither. */
  current: SleepAwakeCurrent;
  /** Which button shows the pending spinner. */
  pending: SleepAwakeTarget | null;
  /** A command was accepted but the screen never confirmed it in time. */
  unconfirmed: SleepAwakeTarget | null;
}

export function observedState(
  i: Pick<SleepAwakeInput, 'panelState' | 'hardOff' | 'reportAsleep' | 'softBlank'>,
): SleepAwakeCurrent {
  if (i.hardOff || i.reportAsleep || i.softBlank) return 'sleep';
  if (i.panelState === 'on') return 'awake';
  if (i.panelState === 'dark') return 'sleep';
  return 'unknown';
}

export function deriveSleepAwakeState(i: SleepAwakeInput): SleepAwakeState {
  const observed = observedState(i);
  if (i.inFlight) return { current: observed, pending: i.inFlight, unconfirmed: null };

  const cmd = i.lastCommand;
  if (!cmd) return { current: observed, pending: null, unconfirmed: null };
  const age = i.now - cmd.at;
  if (age > COMMAND_RELEVANCE_MS) return { current: observed, pending: null, unconfirmed: null };
  if (observed === cmd.target) return { current: observed, pending: null, unconfirmed: null };
  if (age < CONFIRM_WINDOW_MS) return { current: observed, pending: cmd.target, unconfirmed: null };
  return { current: observed, pending: null, unconfirmed: cmd.target };
}

/** A soft-blank report older than this says nothing about now. */
export const SOFT_BLANK_FRESH_MS = 10 * 60_000;

/**
 * The web player says its soft BLANK overlay is on the glass (2026-11-02).
 * `softBlankAt` is re-stamped by every report while the overlay is up and
 * cleared by the first report after it comes down (WAKE, POWER_ON, a schedule
 * switch-on, a reload). A stamp older than 10 minutes means the screen stopped
 * reporting — stale, so it says nothing. An emergency overlay is never one.
 */
export function softBlankFresh(softBlankAt: string | null | undefined, nowMs: number): boolean {
  const at = softBlankAt ? Date.parse(softBlankAt) : NaN;
  if (!Number.isFinite(at)) return false;
  return nowMs - at <= SOFT_BLANK_FRESH_MS;
}

/** `interactive:false` from a native report no older than 10 minutes. */
export function nativeReportAsleep(
  report: unknown,
  reportAt: string | null | undefined,
  nowMs: number,
): boolean {
  if (!report || typeof report !== 'object') return false;
  const at = reportAt ? Date.parse(reportAt) : NaN;
  if (!Number.isFinite(at) || nowMs - at > 10 * 60_000) return false;
  return (report as { interactive?: unknown }).interactive === false;
}
