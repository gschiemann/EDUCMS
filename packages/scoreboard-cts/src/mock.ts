/**
 * @cms/scoreboard-cts/mock — synthetic CTS feed for dev + tests.
 *
 * Used for three purposes:
 *
 *   1. Unit tests — push known byte sequences into the parser and
 *      verify the decoded CtsGameState.
 *   2. Local dev — wire a fake "console" into CtsBridge so the player
 *      page renders a live game without a USB-RS232 dongle attached.
 *   3. Game-day rehearsal — script a 4-quarter water polo match
 *      (clock counts down, periodic goals, periodic exclusions) so
 *      the operator can rehearse the show flow end-to-end.
 *
 * The mock emits the SAME bytes the real CTS console would put on the
 * wire. 2026-06-12 cutover: it now emits the REAL classic framing
 * (encodeClassicLine — validated against real console captures) on the
 * F872 water-polo channel layout, so the rehearsal exercises the exact
 * decoder a real console exercises. The public API keeps the historic
 * CTS_MODULE constants; pushModule() translates them to their F872
 * (channel, offset) targets internally.
 */

import { CTS_MODULE } from './types';
import { encodeClassicLine } from './classic';

/** Old module constant → REAL F872 (channel, cell-offset) target.
 *  Matches F872_WATER_POLO_MAP in grid.ts:
 *    clock=ch1 · period=ch2[0] · shot=ch9 · score=ch5 (home[0-1],
 *    away[2-3]) · ejects=ch4/3/11 (3 shared lines; side is venue-
 *    configured, so home/away slot N land on the same line) ·
 *    timeouts=ch12 (home) / ch6 (away).
 *  HORN has no classic-wire channel (it was an invention of the old
 *  synthetic framing) — horn pushes are dropped until a real capture
 *  tells us how the console signals it. */
const MODULE_TO_F872: Record<number, { channel: number; offset: number } | null> = {
  [CTS_MODULE.GAME_CLOCK]: { channel: 1, offset: 0 },
  [CTS_MODULE.PERIOD]: { channel: 2, offset: 0 },
  [CTS_MODULE.HOME_SCORE]: { channel: 5, offset: 0 },
  [CTS_MODULE.AWAY_SCORE]: { channel: 5, offset: 2 },
  [CTS_MODULE.HOME_SHOT_CLOCK]: { channel: 9, offset: 0 },
  [CTS_MODULE.AWAY_SHOT_CLOCK]: { channel: 9, offset: 0 },
  [CTS_MODULE.HOME_EXCL_1]: { channel: 4, offset: 0 },
  [CTS_MODULE.HOME_EXCL_2]: { channel: 3, offset: 0 },
  [CTS_MODULE.HOME_EXCL_3]: { channel: 11, offset: 0 },
  [CTS_MODULE.AWAY_EXCL_1]: { channel: 4, offset: 0 },
  [CTS_MODULE.AWAY_EXCL_2]: { channel: 3, offset: 0 },
  [CTS_MODULE.AWAY_EXCL_3]: { channel: 11, offset: 0 },
  [CTS_MODULE.HOME_TIMEOUTS]: { channel: 12, offset: 0 },
  [CTS_MODULE.AWAY_TIMEOUTS]: { channel: 6, offset: 0 },
  [CTS_MODULE.HORN]: null,
};

/**
 * Low-level: push a Uint8Array of bytes through whatever consumer
 * the caller specifies. The implementation is just `consumer(bytes)`
 * — exists so callers can pass a `parser.feed` reference, a
 * `CtsBridge.pushBytes` reference, or a test-only sink.
 */
export class MockCtsFeed {
  constructor(private readonly consumer: (bytes: Uint8Array) => void) {}

  /** Send raw bytes through the consumer. */
  pushBytes(bytes: Uint8Array): void {
    this.consumer(bytes);
  }

  /** Convenience: encode + send one module write in REAL classic framing.
   *  GAME_CLOCK inserts the display colon ("7:45") since the real wire
   *  carries the colon as a character cell; decimal points can't ride the
   *  classic wire, so sub-minute tenths are dropped (rehearsal-fidelity
   *  trade documented in classic.ts). */
  pushModule(module: number, chars: string[]): void {
    const target = MODULE_TO_F872[module];
    if (!target) return; // HORN / unknown — no classic-wire equivalent
    let text = chars.join('');
    if (module === CTS_MODULE.GAME_CLOCK && chars.length >= 4) {
      text = `${chars[0] ?? ' '}${chars[1] ?? ' '}:${chars[2] ?? ' '}${chars[3] ?? ' '}`;
    }
    this.consumer(encodeClassicLine(target.channel, text, target.offset));
  }

  /** Compose a full-state burst that initializes every relevant module. */
  pushInitialState(opts: {
    clock?: string; // e.g. "8:00"
    period?: number;
    homeScore?: number;
    awayScore?: number;
    homeTimeouts?: number;
    awayTimeouts?: number;
  } = {}): void {
    const {
      clock = '8:00',
      period = 1,
      homeScore = 0,
      awayScore = 0,
      homeTimeouts = 2,
      awayTimeouts = 2,
    } = opts;

    this.pushModule(CTS_MODULE.GAME_CLOCK, clockToDigits(clock));
    this.pushModule(CTS_MODULE.PERIOD, [String(period)]);
    this.pushModule(CTS_MODULE.HOME_SCORE, scoreDigits(homeScore));
    this.pushModule(CTS_MODULE.AWAY_SCORE, scoreDigits(awayScore));
    this.pushModule(CTS_MODULE.HOME_TIMEOUTS, [String(homeTimeouts)]);
    this.pushModule(CTS_MODULE.AWAY_TIMEOUTS, [String(awayTimeouts)]);
  }
}

/**
 * One step in a scripted game. Use with `scriptGame()` below.
 *
 * The script is async-iterable so the consumer can `for await` over
 * it with real-time pacing.
 */
export type GameScript =
  | { atMs: number; kind: 'setClock'; clock: string }
  | { atMs: number; kind: 'setPeriod'; period: number }
  | { atMs: number; kind: 'goal'; team: 'home' | 'away' }
  | {
      atMs: number;
      kind: 'exclusion';
      team: 'home' | 'away';
      jersey: number;
      seconds: number; // typically 20 in water polo
      slot?: 0 | 1 | 2;
    }
  | { atMs: number; kind: 'clearExclusion'; team: 'home' | 'away'; slot: 0 | 1 | 2 }
  | { atMs: number; kind: 'horn' }
  | { atMs: number; kind: 'timeout'; team: 'home' | 'away'; remaining: number };

/**
 * Run a scripted sequence of game events through a mock feed. Each
 * step is delayed by its `atMs` relative to the start of `scriptGame()`.
 *
 * The script keeps internal state (cumulative scores) so callers
 * only need to say "home goal at 1.2s" not "home score becomes 1."
 */
export async function scriptGame(
  feed: MockCtsFeed,
  script: GameScript[],
): Promise<void> {
  const sorted = [...script].sort((a, b) => a.atMs - b.atMs);
  let home = 0;
  let away = 0;
  const start = Date.now();
  for (const step of sorted) {
    const wait = step.atMs - (Date.now() - start);
    if (wait > 0) await sleep(wait);
    switch (step.kind) {
      case 'setClock':
        feed.pushModule(CTS_MODULE.GAME_CLOCK, clockToDigits(step.clock));
        break;
      case 'setPeriod':
        feed.pushModule(CTS_MODULE.PERIOD, [String(step.period)]);
        break;
      case 'goal':
        if (step.team === 'home') {
          home += 1;
          feed.pushModule(CTS_MODULE.HOME_SCORE, scoreDigits(home));
        } else {
          away += 1;
          feed.pushModule(CTS_MODULE.AWAY_SCORE, scoreDigits(away));
        }
        break;
      case 'exclusion': {
        const slot = step.slot ?? 0;
        const base =
          step.team === 'home'
            ? CTS_MODULE.HOME_EXCL_1
            : CTS_MODULE.AWAY_EXCL_1;
        feed.pushModule(base + slot, exclusionDigits(step.jersey, step.seconds));
        break;
      }
      case 'clearExclusion': {
        const base =
          step.team === 'home'
            ? CTS_MODULE.HOME_EXCL_1
            : CTS_MODULE.AWAY_EXCL_1;
        feed.pushModule(base + step.slot, ['0', '0', '0', '0', '0']);
        break;
      }
      case 'horn':
        // Any non-blank byte. We send a single '1' digit pattern.
        feed.pushModule(CTS_MODULE.HORN, ['1']);
        await sleep(150);
        // Auto-clear horn after 150ms — real consoles do roughly this.
        feed.pushModule(CTS_MODULE.HORN, [' ']);
        break;
      case 'timeout': {
        const mod =
          step.team === 'home'
            ? CTS_MODULE.HOME_TIMEOUTS
            : CTS_MODULE.AWAY_TIMEOUTS;
        feed.pushModule(mod, [String(step.remaining)]);
        break;
      }
    }
  }
}

// ─── helpers ──────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Convert a display clock like "8:00" / ":12.4" into the 5-byte
 * digit array the CTS GAME_CLOCK module expects.
 *
 * Output convention (matches the parser's formatClock decode):
 *   positions 0..1 = minutes (leading space if <10)
 *   positions 2..3 = seconds (always 2 digits)
 *   position  4    = tenths  (or blank in M:SS mode)
 */
export function clockToDigits(display: string): string[] {
  // Sub-minute form ":SS.t" or ":SS"
  const sub = /^:(\d{1,2})(?:\.(\d))?$/.exec(display);
  if (sub) {
    const ss = (sub[1] ?? '0').padStart(2, '0');
    const t = sub[2] ?? ' ';
    return [' ', ' ', ss[0] ?? '0', ss[1] ?? '0', t];
  }
  // M:SS form
  const mss = /^(\d{1,2}):(\d{2})$/.exec(display);
  if (mss) {
    const mm = (mss[1] ?? '0').padStart(2, ' ');
    const ss = mss[2] ?? '00';
    return [mm[0] ?? ' ', mm[1] ?? '0', ss[0] ?? '0', ss[1] ?? '0', ' '];
  }
  // Fallback: best-effort numeric parse.
  return [' ', ' ', ' ', ' ', ' '];
}

/**
 * Render a score number into 2 digit characters (water polo never
 * exceeds 2 digits in practice; the protocol carries 3 if needed).
 */
export function scoreDigits(n: number): string[] {
  const s = Math.max(0, Math.min(999, Math.floor(n))).toString();
  if (s.length === 1) return [' ', s];
  if (s.length === 2) return [s[0] ?? '0', s[1] ?? '0'];
  return [s[0] ?? '0', s[1] ?? '0', s[2] ?? '0'];
}

/**
 * Render an exclusion into 5 digit characters: 2 jersey + 3 seconds.
 * Water polo exclusions are 20s max, so the leading seconds digit
 * is usually 0. Jerseys are 1-99 (uniform rules).
 */
export function exclusionDigits(jersey: number, seconds: number): string[] {
  const j = Math.max(0, Math.min(99, Math.floor(jersey))).toString().padStart(2, ' ');
  const s = Math.max(0, Math.min(999, Math.floor(seconds))).toString().padStart(3, '0');
  return [j[0] ?? ' ', j[1] ?? '0', s[0] ?? '0', s[1] ?? '0', s[2] ?? '0'];
}

/**
 * A pre-canned 4-quarter water polo match used for player-page
 * rehearsals. Total runtime ~30 seconds for a quick visual sanity
 * check (compressed timescale).
 */
export const REHEARSAL_SCRIPT: GameScript[] = [
  { atMs: 0, kind: 'setClock', clock: '8:00' },
  { atMs: 200, kind: 'setPeriod', period: 1 },
  { atMs: 500, kind: 'setClock', clock: '7:45' },
  { atMs: 1500, kind: 'goal', team: 'home' },
  { atMs: 3000, kind: 'exclusion', team: 'away', jersey: 7, seconds: 20 },
  { atMs: 4000, kind: 'goal', team: 'home' },
  { atMs: 5000, kind: 'clearExclusion', team: 'away', slot: 0 },
  { atMs: 6000, kind: 'goal', team: 'away' },
  { atMs: 7000, kind: 'horn' },
  { atMs: 8000, kind: 'setPeriod', period: 2 },
  { atMs: 8500, kind: 'setClock', clock: '8:00' },
  { atMs: 10000, kind: 'goal', team: 'away' },
  { atMs: 12000, kind: 'goal', team: 'home' },
  { atMs: 14000, kind: 'timeout', team: 'home', remaining: 1 },
  { atMs: 16000, kind: 'setPeriod', period: 3 },
  { atMs: 18000, kind: 'goal', team: 'home' },
  { atMs: 20000, kind: 'goal', team: 'away' },
  { atMs: 22000, kind: 'exclusion', team: 'home', jersey: 11, seconds: 20 },
  { atMs: 23000, kind: 'exclusion', team: 'home', jersey: 4, seconds: 20, slot: 1 },
  { atMs: 24000, kind: 'goal', team: 'away' },
  { atMs: 26000, kind: 'setPeriod', period: 4 },
  { atMs: 28000, kind: 'setClock', clock: ':45.2' },
  { atMs: 29000, kind: 'goal', team: 'home' },
  { atMs: 30000, kind: 'horn' },
];
