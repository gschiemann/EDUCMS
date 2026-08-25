/**
 * Legacy FAST channel lookup.
 *
 * The old catalog contained reverse-engineered Pluto stitch URLs and
 * formula-generated Xumo playlist URLs. A reachable URL is not a grant of
 * commercial public-performance rights, and Xumo's current terms expressly
 * prohibit public/commercial performance. These lists are intentionally empty
 * until a provider supplies VenueOS with a written commercial distribution
 * agreement and a supported playback API.
 *
 * The lookup shape remains for saved templates. Legacy Pluto/Xumo selections
 * now fail honestly with "channel not found" instead of attempting an
 * unauthorized or invented feed.
 */

export interface FastChannel {
  id: string;
  name: string;
  category?: string;
  hlsUrl: string;
  logo?: string;
  placeholder?: boolean;
}

export const FAST_CHANNELS: Record<string, FastChannel[]> = {
  pluto: [],
  xumo: [],
};

export function findFastChannel(provider: string, channelId: string): FastChannel | undefined {
  const catalog = FAST_CHANNELS[provider];
  if (!catalog) return undefined;
  return catalog.find((channel) => channel.id === channelId);
}
