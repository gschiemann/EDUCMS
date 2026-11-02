/** Hidden from new discovery until a free source permits public display.
 * Saved IDs and renderers remain intact for existing boards. */
export const HIDDEN_UNLICENSED_DATA_WIDGETS = new Set([
  "stock-ticker",
  "crypto-ticker",
  "departures-board",
  "flight-status-hero",
  // 2026-11-01 owner rule: no "enter it yourself" data boards. Newsroom /
  // Rotating Headlines (GDELT, RSS) cover news; the bound-game scoreboards
  // cover scores. Saved boards keep rendering.
  "news-headlines",
  "sports-scoreboard",
]);

/**
 * Hidden widgets that a PAID integration can bring back (2026-11-01,
 * integrations/live-data). Each returns to the picker only while
 * `GET /integrations/live-data/status` says its family has a key on this
 * deploy — and, once back, it is a live board, not an entry form.
 * `flight-status-hero` (one typed flight) and `news-headlines` stay hidden:
 * no integration feeds them.
 */
export const INTEGRATION_GATED_WIDGETS: Record<string, "stocks" | "crypto" | "flights" | "scores"> = {
  "stock-ticker": "stocks",
  "crypto-ticker": "crypto",
  "departures-board": "flights",
  "sports-scoreboard": "scores",
};

let enabledFamilies = new Set<string>();
let version = 0;
const listeners = new Set<() => void>();

/** Called with the families `/status` reports as enabled. */
export function setEnabledLiveDataFamilies(families: Iterable<string>): void {
  const next = new Set(families);
  if (next.size === enabledFamilies.size && Array.from(next).every((f) => enabledFamilies.has(f))) return;
  enabledFamilies = next;
  version += 1;
  listeners.forEach((l) => l());
}
export function liveDataDiscoveryVersion(): number {
  return version;
}
export function subscribeLiveDataDiscovery(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function enabledByIntegration(id: string): boolean {
  const family = INTEGRATION_GATED_WIDGETS[id];
  return !!family && enabledFamilies.has(family);
}

/** True when saved boards may still hold this variant but it has no live source. */
export const hasNoLiveDataSource = (id: string) => HIDDEN_UNLICENSED_DATA_WIDGETS.has(id) && !enabledByIntegration(id);
export const NO_LIVE_SOURCE_NOTICE = "This widget has no live data source.";
export const isWidgetDiscoverable = (id: string) =>
  !HIDDEN_UNLICENSED_DATA_WIDGETS.has(id) || enabledByIntegration(id);
