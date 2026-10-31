/** Hidden from new discovery until a free source permits public display.
 * Saved IDs and renderers remain intact for existing boards. */
export const HIDDEN_UNLICENSED_DATA_WIDGETS = new Set([
  "stock-ticker",
  "crypto-ticker",
  "departures-board",
  "flight-status-hero",
]);
export const isWidgetDiscoverable = (id: string) =>
  !HIDDEN_UNLICENSED_DATA_WIDGETS.has(id);
