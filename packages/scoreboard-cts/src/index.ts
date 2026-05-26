/**
 * @cms/scoreboard-cts — Colorado Time Systems (CTS) System 6 / Gen 6
 * scoreboard protocol decoder + browser-side helpers.
 *
 * Used by the player page (apps/web/src/components/player/CtsBridge)
 * to convert raw bytes off a USB-RS232 dongle into a live game-state
 * stream that the scoreboard widgets render.
 *
 * Browser-safe: no Node-only APIs (no `fs`, no `node:crypto`, no
 * `Buffer`). Targets ES2020 — works in every modern browser. Web
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
