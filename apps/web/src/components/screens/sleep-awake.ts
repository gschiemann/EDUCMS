/**
 * Sleep / Awake — the ONE pair of power buttons on a screen, and which of the
 * two is highlighted right now. Pure: no React, no clock of its own.
 *
 * Evidence, in the order it is trusted (the same evidence `panelPowerOffer`
 * reads — display-capabilities.ts):
 *   1. the native sleep report (`sleep.vb.off`, Android `interactive:false`)
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
  i: Pick<SleepAwakeInput, 'panelState' | 'hardOff' | 'reportAsleep'>,
): SleepAwakeCurrent {
  if (i.hardOff || i.reportAsleep) return 'sleep';
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
