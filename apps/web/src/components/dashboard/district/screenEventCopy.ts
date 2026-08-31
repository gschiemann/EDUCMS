/**
 * screenEventCopy — one plain-English name per screen-history event.
 *
 * Extracted from ProofDrawer (2026-08-31) so the Network Atlas device drawer
 * reads the SAME words for the same event. Two copies of this map is how a
 * product ends up telling an operator two different stories about one row.
 *
 * Engineer-speak is banned on every surface that renders these: an operator
 * reading their own screen's history should never meet the wire vocabulary.
 */

import type { ScreenEventKind } from '@/hooks/use-api';

export const EVENT_COPY: Record<ScreenEventKind, string> = {
  'refresh-requested': 'Update sent to this screen',
  'auto-refresh-requested': 'VenueOS asked this screen to reload itself',
  'refresh-acked': 'Screen confirmed the update',
  'repair-required': 'Screen needs re-pairing',
  'credential-restored': 'Screen’s trust restored',
};

/** Never blank: an unrecognised kind still gets an honest, non-technical line. */
export function eventCopy(kind: ScreenEventKind): string {
  return EVENT_COPY[kind] ?? 'Something changed on this screen';
}
