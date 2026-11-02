/**
 * Light-weight constants + mode inference shared by the editor and the live
 * data widgets. Kept free of React/widget imports so the builder panel can
 * use them without pulling the (lazy) live-data renderers into its chunk.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cfg = Record<string, any>;

export const PUBLIC_DATA_TEXT_AREAS: [string, string][] = [
  ["title", "Heading"],
  ["dataLocation", "Location / station"],
  ["dataValue", "Main values"],
  ["dataDetails", "Details"],
  ["dataSource", "Source and time"],
];
export const PUBLIC_DATA_LAYOUTS: [string, string][] = [
  ["auto", "Automatic"],
  ["cards", "Cards"],
  ["list", "List"],
  ["banner", "Horizontal banner"],
];
export const DEFAULT_STOCK_SYMBOLS = "AAPL,MSFT,NVDA,AMZN";
export const DEFAULT_CRYPTO_COINS = "bitcoin,ethereum,solana";

/** Live when the operator chose it, or when nothing manual was ever entered. */
export function isIntegrationAutomatic(variant: string | undefined, config: Cfg = {}): boolean {
  if (config.dataMode === "manual") return false;
  if (config.dataMode === "automatic") return true;
  switch (variant) {
    case "stock-ticker":
      return !(Array.isArray(config.symbols) && config.symbols.length);
    case "crypto-ticker":
      return !(Array.isArray(config.coins) && config.coins.length);
    case "departures-board":
      return !(Array.isArray(config.flights) && config.flights.length);
    case "sports-scoreboard":
      return !(Array.isArray(config.games) && config.games.length);
    default:
      return false;
  }
}
