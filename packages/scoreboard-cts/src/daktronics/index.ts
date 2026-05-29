/**
 * @cms/scoreboard-cts/daktronics — public surface for the Daktronics
 * All Sport 5000 / 5500 / 3000 Enhanced RTD decoder.
 *
 * Sibling of the CTS decoder in the same package. Re-exported from the
 * package root so consumers import either decoder from
 * `@cms/scoreboard-cts`.
 */

export * from './types';
export { DaktronicsParser, type DaktronicsParserOptions } from './parser';
export {
  DAKTRONICS_OFFSETS,
  RTD_BUFFER_SIZE,
  UNVERIFIED_OFFSETS,
  type FieldDef,
  type Justify,
  type CommonFields,
  type FootballFields,
  type BasketballFields,
  type BaseballFields,
} from './offsets';
export {
  MockDaktronicsFeed,
  encodeRtdPacket,
  encodeField,
  justifyField,
} from './mock';
