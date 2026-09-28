/**
 * K12-F32 — what the Scoreboard console setup card says, as a pure function
 * of the server's view, the game's stats and the SERVER clock (K12-F40: every
 * stamp here is server time, so a laptop clock that is off cannot change the
 * answer).
 *
 * The card walks an operator through: pick the console model and the screen
 * wired to it → the box starts reading → a PREVIEW of what the console sends
 * → confirm → live, with honest health after that. Each state says what the
 * evidence proves (Player Reliability rule 10): "the port is open but nothing
 * decodes", never "connected" because a box is merely online.
 */
import type { ScoreboardConsoleView } from '@/hooks/use-api';
import { computeCtsStatus } from '@/lib/cts-merge';

/** A link report older than this means the box is not reporting. */
export const CONSOLE_LINK_STALE_MS = 20_000;
/** A preview older than this is not shown as current (the box stopped). */
export const CONSOLE_PREVIEW_STALE_MS = 60_000;

type Preview = NonNullable<ScoreboardConsoleView['preview']>;
type LinkStatus = NonNullable<ScoreboardConsoleView['link']>['status'];

export type ScoreboardConsoleState =
  | { kind: 'loading' }
  | { kind: 'unsupported'; sportName: string }
  | { kind: 'final' }
  | { kind: 'unbound' }
  | { kind: 'model-mismatch'; screenName: string; supportedSportNames: string[]; sportName: string }
  | { kind: 'box-offline'; screenName: string }
  | { kind: 'waiting-box'; screenName: string }
  | { kind: 'port-closed'; screenName: string; needsClick: boolean }
  | { kind: 'no-frames'; screenName: string; bytes: number }
  | { kind: 'preview'; screenName: string; preview: Preview; ageMs: number }
  | { kind: 'live'; screenName: string; ageMs: number }
  | { kind: 'live-stale'; screenName: string; ageMs: number | null; linkStatus: LinkStatus | null };

function age(iso: string | null | undefined, now: number): number | null {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? Math.max(0, now - t) : null;
}

export function scoreboardConsoleState(
  view: ScoreboardConsoleView | undefined,
  stats: unknown,
  serverNow: number,
): ScoreboardConsoleState {
  if (!view) return { kind: 'loading' };
  const b = view.binding;
  if (!b) {
    if (!view.supported) return { kind: 'unsupported', sportName: view.sportName };
    return view.final ? { kind: 'final' } : { kind: 'unbound' };
  }
  const screenName = b.screenName;
  if (!b.decoderSport) {
    return {
      kind: 'model-mismatch',
      screenName,
      supportedSportNames: b.supportedSportNames,
      sportName: view.sportName,
    };
  }
  const linkAge = age(view.link?.reportedAt, serverNow);
  const link = view.link && linkAge !== null && linkAge < CONSOLE_LINK_STALE_MS ? view.link : null;

  if (b.confirmedAt) {
    // After confirmation the game's own record is the evidence: the same
    // freshness window every board uses to decide whether the console leads.
    const cts = computeCtsStatus(stats, serverNow);
    if (cts.kind === 'fresh') return { kind: 'live', screenName, ageMs: cts.ageMs ?? 0 };
    return { kind: 'live-stale', screenName, ageMs: cts.ageMs, linkStatus: link?.status ?? null };
  }

  const previewAge = age(view.preview?.receivedAt, serverNow);
  if (view.preview && previewAge !== null && previewAge < CONSOLE_PREVIEW_STALE_MS) {
    return { kind: 'preview', screenName, preview: view.preview, ageMs: previewAge };
  }
  if (link) {
    if (link.status !== 'connected') {
      // A Web Serial box needs one click the first time (the browser asks
      // which port); a box with a native serial port opens it on its own.
      return { kind: 'port-closed', screenName, needsClick: !link.native && link.status !== 'connecting' };
    }
    return { kind: 'no-frames', screenName, bytes: link.bytes };
  }
  return b.screenOnline ? { kind: 'waiting-box', screenName } : { kind: 'box-offline', screenName };
}
