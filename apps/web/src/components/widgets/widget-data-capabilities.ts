/** Data behavior is product metadata, not a decorative claim. Keep it shared
 * by discovery, the native editor and audit exports. Saved variant IDs stay stable. */
export interface WidgetDataCapability {
  mode: "automatic" | "feed" | "manual" | "connection";
  label: string;
  detail: string;
}
/** Shared mode inference keeps existing authored boards manual. */
export function isAutomaticPublicData(config: Record<string, any>): boolean {
 if(config.variant==='airport-conditions')return true;
 if(config.dataMode==='manual')return false;
 const automatic=config.dataMode==='automatic';
 switch(config.variant){
  case 'air-quality':return automatic||config.aqi==null;
  case 'transit-departures':return automatic||(!config.lines?.length&&!config.station&&!config.agency);
  case 'parking-availability':return automatic||(!config.lots?.length&&!config.facility);
  case 'traffic-cam':return automatic||(!config.cams?.length&&!config.city);
  default:return false;
 }
}
const MANUAL: Record<string, string> = {
  "sports-scoreboard":
    "Scores are entered here. For your live venue feed, use the connected scoreboard widgets.",
  "stock-ticker":
    "Quotes are entered here. Automatic market prices require a licensed data connection.",
  "crypto-ticker":
    "Prices are entered here. Automatic prices require a licensed data connection.",
  "news-headlines":
    "Headlines are entered here. Choose Newsroom or Rotating Headlines for automatic news.",
  "air-quality":
    "Readings are entered here. This board is not connected to an air-quality service or sensor.",
  "fx-rates":
    "Rates are entered here. This board is not connected to an exchange-rate service.",
  "traffic-cam":
    "Road conditions are entered here. This design does not include camera images or automatic traffic data.",
  "departures-board":
    "Departures are entered here. Automatic departures require a licensed flight-data connection.",
  "flight-status-hero":
    "Flight details are entered here. This is not live flight tracking; a flight-data connection is required for automatic updates.",
  "transit-departures":
    "Arrivals are entered here. Automatic arrivals require a transit-agency connection.",
  "parking-availability":
    "Space counts are entered here. Automatic availability requires a parking-system connection.",
};
export function widgetDataCapability(
  type: string,
  variant?: string,
  config?: Record<string, any>,
): WidgetDataCapability | undefined {
  if (variant === 'traffic-cam' && (config?.dataMode === 'automatic' || (config?.dataMode !== 'manual' && !config?.cams?.length && !config?.city))) return {mode:'automatic',label:'Automatic California road reports',detail:'Free California Highway Patrol incidents within 50 km. California only; no cameras, travel-time estimates or nationwide coverage. Source checked every minute.'};
  if (variant === 'air-quality' && (config?.dataMode === 'automatic' || (config?.dataMode !== 'manual' && config?.aqi == null))) return {mode:'automatic',label:'Automatic hourly air quality',detail:'Free EPA AirNow preliminary observations for a U.S. reporting area. Choose a city or ZIP. Pollutant values are AQI, not concentrations; source category colors are preserved.'};
  if (variant === 'parking-availability' && (config?.dataMode === 'automatic' || (config?.dataMode !== 'manual' && !config?.lots?.length && !config?.facility))) return {mode:'automatic',label:'Automatic parking reports',detail:'Free LADOT / LA ExpressPark street-meter states near a Los Angeles location. Reports older than 30 minutes are unknown. This is not a private-garage sensor connection.'};
  if (variant === 'airport-conditions') return {mode:'automatic',label:'Automatic airport conditions',detail:'Free FAA airport notices and delays. This is airport-wide information, not individual flight status; check the airline for your flight.'};
  if (variant === 'transit-departures' && (config?.dataMode === 'automatic' || (config?.dataMode !== 'manual' && !config?.lines?.length && !config?.station && !config?.agency))) return {mode:'automatic',label:'Automatic transit predictions',detail:'Free MassDOT / MBTA real-time predictions for Boston-area stations. Select a station. Unavailable predictions never become an invented arrival.'};
  if (
    variant === "fx-rates" &&
    (config?.dataMode === "automatic" ||
      (config?.dataMode !== "manual" && !config?.pairs?.length))
  )
    return {
      mode: "automatic",
      label: "Automatic daily rates",
      detail:
        "Calculated from ECB reference rates, updated each business day. The source data is available free from the ECB. Entered rates remain available in Manual mode.",
    };
  if (variant && MANUAL[variant])
    return {
      mode: "manual",
      label: "Manually updated",
      detail: MANUAL[variant],
    };
  if (variant === "world-clocks" || type === "CLOCK")
    return {
      mode: "automatic",
      label: "Automatic clock",
      detail: "Uses the screen’s current clock and selected time zone.",
    };
  if (type === "WEATHER")
    return {
      mode: "automatic",
      label: "Automatic weather",
      detail:
        variant === "weather-outlook"
          ? "U.S. forecast from the National Weather Service. Refreshes every 15 minutes; no key needed."
          : "Updates from the configured weather source. Set a location to show current conditions.",
    };
  if (variant === "rss-newsroom")
    return {
      mode: "automatic",
      label: "Automatic news",
      detail:
        "GDELT headline metadata. Refreshes every 10 minutes, with earlier retries during limited coverage. Some cities or selected outlets may have no matching stories.",
    };
  if (type === "RSS_FEED")
    return {
      mode: "feed",
      label: "News feed",
      detail:
        "Reads current items from the selected sources or your RSS URL. A feed must be available and permit your intended use.",
    };
  if (type === "CALENDAR")
    return {
      mode: "feed",
      label: "Calendar feed or entered events",
      detail:
        "An ICS feed updates automatically when configured. Events entered here are managed by you.",
    };
  if (type === "SOCIAL_FEED")
    return {
      mode: "connection",
      label: "Account connection",
      detail:
        "Choose a connected social account in Apps. A profile URL alone cannot load posts.",
    };
  if (type === "GOOGLE_REVIEWS")
    return {
      mode: "connection",
      label: "Places API connection",
      detail:
        "Loads relevant reviews through Google Places API (New), using an administrator-configured key. This is not a free connection by default; Google billing and quotas apply.",
    };
  return undefined;
}
/** Schema examples only. Never seed these into a saved screen as actual data. */
export const MANUAL_DATA_EDITOR_DEFAULTS: Record<
  string,
  Record<string, unknown>
> = {
  "stock-ticker": { symbols: [{ symbol: "", price: 0, change: 0, pct: 0 }] },
  "crypto-ticker": {
    coins: [{ name: "", symbol: "", price: 0, pct: 0, color: "#f7931a" }],
  },
  "news-headlines": {
    source: "",
    items: [{ cat: "", time: "", headline: "" }],
  },
  "fx-rates": { pairs: [{ code: "", name: "", flag: "", rate: 0, delta: 0 }] },
  "traffic-cam": { city: "", cams: [{ name: "", note: "", status: "" }] },
  "departures-board": {
    airport: "",
    flights: [
      { flight: "", time: "", dest: "", gate: "", status: "", note: "" },
    ],
  },
  "transit-departures": {
    station: "",
    agency: "",
    lines: [
      { line: "", color: "#475569", toward: "", platform: "", minutes: [] },
    ],
  },
  "parking-availability": {
    facility: "",
    lots: [{ name: "", note: "", total: 0, avail: 0, rate: "" }],
  },
};
