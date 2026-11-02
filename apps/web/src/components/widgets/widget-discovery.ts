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
/** True when saved boards may still hold this variant but it has no live source. */
export const hasNoLiveDataSource = (id: string) => HIDDEN_UNLICENSED_DATA_WIDGETS.has(id);
export const NO_LIVE_SOURCE_NOTICE = "This widget has no live data source.";
export const isWidgetDiscoverable = (id: string) =>
  !HIDDEN_UNLICENSED_DATA_WIDGETS.has(id);
