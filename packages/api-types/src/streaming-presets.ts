/**
 * Streaming presets — bundled channel catalogs.
 *
 * EMPTY BY DESIGN (2026-08-24). This file used to ship a
 * `public-broadcasters` catalog of NHK / France 24 / DW / Al Jazeera /
 * Bloomberg / Sky / CBS entries, each resolved to a YouTube
 * `embed/live_stream` URL, under a header asserting that those
 * broadcasters "explicitly invite free public + venue rebroadcast."
 *
 * That claim was never verified against any broadcaster's terms, and it
 * is contradicted by YouTube's own terms, which prohibit public
 * screening. A stream being publicly reachable — and technically
 * embeddable — is not a commercial public-performance license. Shipping
 * the list made the editor offer venue programming VenueOS has no right
 * to supply, in a product whose customers are the ones who would be
 * liable.
 *
 * The rest of the correction lives in `streaming.ts` (the
 * `public-broadcasters` provider is now `CLOSED`) and in
 * `StreamingService.listPresetChannels`, which returns `[]` for every
 * provider. This file keeps the `PresetChannel` shape so that DTO and
 * the `GET /streaming/providers/:id/channels` response stay stable for
 * saved clients, and keeps the catalog itself empty.
 *
 * To add a catalog back, you need BOTH: a supported playback path the
 * provider documents for commercial venues, AND written venue rights on
 * file. Adding rows without both re-creates the exact defect this file
 * exists to record. `apps/web/tools/check-integration-truth.cjs` fails
 * the build if rows appear here.
 *
 * The `presetEmbedUrl()` helper was removed with the catalog: its only
 * job was minting `youtube.com/embed/live_stream` URLs for venue
 * playback, which is the specific thing that must not happen.
 */

export interface PresetChannel {
  /** Stable id stored on StreamChannel.externalId. */
  id: string;
  title: string;
  description?: string;
  category: 'NEWS' | 'SPORTS' | 'MUSIC' | 'LIFESTYLE' | 'CULTURE';
  language: string;                     // 'en' / 'es' / 'fr' / etc.
  /** Direct HLS URL, only ever from a rights-verified provider feed. */
  hlsUrl?: string;
  /** Square or 16:9 thumbnail. */
  thumbnailUrl?: string;
  /** Whether the channel allows operator ad overlays per their contract. */
  allowAdOverlay: boolean;
}

/**
 * Intentionally empty — see the file header. No provider currently has
 * both a supported commercial playback path and verified venue rights.
 */
export const PUBLIC_BROADCASTER_CHANNELS: ReadonlyArray<PresetChannel> = [];
