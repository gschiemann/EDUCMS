/**
 * @cms/scoreboard-cts — scoreboard-console serial-protocol decoders +
 * browser-side helpers for VenueOS Sprint 13.
 *
 * Despite the name, this package now hosts TWO console decoders:
 *
 *   - **CTS** (the package's original namesake) — Colorado Time Systems
 *     System 6 / Gen 6. Aquatics / water polo. RS-232 9600/8/E/1.
 *     Exported from the package root (CtsParser, MockCtsFeed, …).
 *
 *   - **Daktronics** — All Sport 5000 / 5500 / 3000 "Enhanced RTD".
 *     The most common HS football / basketball / baseball console.
 *     RS-232 19200/8/N/1. Exported under the same root
 *     (DaktronicsParser, MockDaktronicsFeed, …) and re-exported via the
 *     `@cms/scoreboard-cts/daktronics` subpath.
 *
 * A `consoleProfile` registry (`CONSOLE_PROFILES`) maps each console
 * family to its serial settings + decoder so the player-side bridge can
 * pick one at runtime.
 *
 * Browser-safe: no Node-only APIs (no `fs`, no `node:crypto`, no
 * `Buffer`). Targets ES2020 — works in every modern browser. The Web
 * Serial API itself is Chrome 89+ (the player runs on a Beelink Mini
 * PC, so this is fine; do NOT use this package on a NovaStar Taurus
 * Chromium-83 player).
 */

export * from './types';
export { CtsParser, decodeDataByte, decodeDataByteWithDp, encodeChar, encodePacket } from './parser';
export {
  MockCtsFeed,
  scriptGame,
  REHEARSAL_SCRIPT,
  clockToDigits,
  scoreDigits,
  exclusionDigits,
} from './mock';
export type { GameScript } from './mock';

// ── Daktronics All Sport 5000 Enhanced RTD decoder ──────────────────
export {
  DaktronicsParser,
  MockDaktronicsFeed,
  encodeRtdPacket,
  encodeField,
  justifyField,
  DAKTRONICS_OFFSETS,
  RTD_BUFFER_SIZE,
  UNVERIFIED_OFFSETS,
  RTD,
  RTD_FIELD_PREFIX,
} from './daktronics';
export type {
  DaktronicsParserOptions,
  DaktronicsSnapshot,
  DaktronicsSport,
  DaktronicsFootball,
  DaktronicsBasketball,
  DaktronicsBaseball,
  DaktronicsUpdateListener,
  FieldDef as DaktronicsFieldDef,
  Justify as DaktronicsJustify,
} from './daktronics';

// ── Console profile registry (serial settings + decoder selection) ──
export {
  CONSOLE_PROFILES,
  DEFAULT_CONSOLE_PROFILE,
  resolveConsoleProfile,
} from './console-profiles';
export type {
  ConsoleProfile,
  ConsoleProfileId,
  ConsoleDecoder,
  SerialSettings,
} from './console-profiles';
