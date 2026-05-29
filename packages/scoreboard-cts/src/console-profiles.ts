/**
 * @cms/scoreboard-cts/console-profiles — the registry that maps a
 * console *family* to its serial-port settings (so the bridge opens the
 * port correctly) and identifies which decoder to drive.
 *
 * This is the small "ScoreSource / consoleProfile registry" piece the
 * score-data-ingestion research called for
 * (docs/research/2026-05-29-sports-provenue-gap/03-score-data-ingestion.md
 * item 1): keyed by console family → { serial settings, parser }. CTS
 * and Daktronics drop in as registry entries; future consoles (OES
 * ISC9000, Electro-Mech) add a row here + a parser without touching the
 * bridge wiring.
 *
 * Pure data + types — no DOM, no parser instances. The bridge picks a
 * profile by id (query param / manifest config) and uses `.serial` to
 * open the Web Serial / native port and `.decoder` to choose the parser.
 */

/** Serial line settings — the shape Web Serial's `port.open()` wants. */
export interface SerialSettings {
  baudRate: number;
  dataBits: 7 | 8;
  stopBits: 1 | 2;
  parity: 'none' | 'even' | 'odd';
}

/** Which decoder a profile drives. */
export type ConsoleDecoder = 'cts' | 'daktronics';

/** A console profile id. Extend as new consoles are supported. */
export type ConsoleProfileId = 'cts-gen6' | 'daktronics-allsport';

export interface ConsoleProfile {
  id: ConsoleProfileId;
  /** Human label for the bridge panel. */
  label: string;
  /** Which decoder package entry handles this console's bytes. */
  decoder: ConsoleDecoder;
  /** Default serial settings for this console family. */
  serial: SerialSettings;
}

/**
 * The profile registry.
 *
 *   - cts-gen6           Colorado Time Systems System 6 / Gen 6.
 *                        RS-232 9600 / 8 / EVEN / 1 over a 1/4" jack.
 *                        Aquatics / water polo. (Existing path.)
 *   - daktronics-allsport
 *                        Daktronics All Sport 5000 / 5500 / 3000 Enhanced
 *                        RTD. RS-232 19200 / 8 / NONE / 1 via the Port
 *                        Expander. Football / basketball / baseball — the
 *                        most common HS console.
 */
export const CONSOLE_PROFILES: Record<ConsoleProfileId, ConsoleProfile> = {
  'cts-gen6': {
    id: 'cts-gen6',
    label: 'Colorado Time Systems (Gen 6)',
    decoder: 'cts',
    serial: { baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'even' },
  },
  'daktronics-allsport': {
    id: 'daktronics-allsport',
    label: 'Daktronics All Sport 5000',
    decoder: 'daktronics',
    serial: { baudRate: 19200, dataBits: 8, stopBits: 1, parity: 'none' },
  },
};

/** The default profile when none is specified — CTS, to preserve the
 *  pre-existing single-console behavior exactly. */
export const DEFAULT_CONSOLE_PROFILE: ConsoleProfileId = 'cts-gen6';

/** Resolve a profile id (e.g. from a query param) to its profile,
 *  falling back to the default for any unknown value. */
export function resolveConsoleProfile(id: string | null | undefined): ConsoleProfile {
  if (id && id in CONSOLE_PROFILES) {
    return CONSOLE_PROFILES[id as ConsoleProfileId];
  }
  return CONSOLE_PROFILES[DEFAULT_CONSOLE_PROFILE];
}
