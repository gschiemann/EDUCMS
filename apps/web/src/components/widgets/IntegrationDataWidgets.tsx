"use client";
/**
 * Live boards for the paid data families — traffic (TomTom), flights
 * (AeroDataBox), scores (TheSportsDB), stocks (Twelve Data), crypto
 * (CoinGecko). Each is dormant until the deploy has that provider's key:
 * the API answers `{ enabled:false }` and the board falls back to its
 * original (manual) renderer, exactly as before this file existed.
 *
 * They share `Frame` / `Rows` with the free public-data boards, so every one
 * carries the same native customisation: layout (auto / cards / list /
 * banner), background, text colour, font family and per-area text styles
 * (`title`, `dataLocation`, `dataValue`, `dataDetails`, `dataSource`).
 *
 * Taurus (Chromium 83): no `inset`, no flex `gap` — spacing is margins, and
 * nothing positions all four sides in one style object.
 *
 * Copy states what the evidence proves: every board shows its source and the
 * time OUR server last called it ("Checked 2:14 PM"), never an invented
 * "live" badge.
 */
import type { ReactNode } from "react";
import { useRenderSurface } from "./render-surface";
import { forecastTextStyle as fieldStyle } from "./forecast-appearance";
import { Frame, Rows, clock, sourceLink } from "./PublicDataWidgets";
import {
  useLiveData,
  type CoinRow,
  type FlightRow,
  type LiveAnswer,
  type QuoteRow,
  type ScoreRow,
  type TrafficItem,
} from "@/lib/live-data/live-data-client";

/** Widget zone config — free-form JSON authored in the builder. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cfg = Record<string, any>;

export const DEFAULT_STOCK_SYMBOLS = "AAPL,MSFT,NVDA,AMZN";
export const DEFAULT_CRYPTO_COINS = "bitcoin,ethereum,solana";

const q = encodeURIComponent;

function Credit({ data, extra }: { data: LiveAnswer<unknown> | null; extra?: string }) {
  if (!data?.source) return <>Loading…</>;
  return (
    <>
      Data provided by{" "}
      <a href={data.sourceUrl} target="_blank" rel="noreferrer" style={sourceLink}>
        {data.source}
      </a>
      {data.fetchedAt ? ` · Checked ${clock(data.fetchedAt)}` : ""}
      {extra ? ` · ${extra}` : ""}
    </>
  );
}

/**
 * Render the live board when the family is enabled, otherwise the original
 * renderer. While the first answer is in flight the live frame shows a
 * loading line (a dormant deploy answers instantly with `enabled:false`).
 */
function LiveOrFallback<T>({
  path,
  intervalMs,
  fallback,
  children,
}: {
  path: string | null;
  intervalMs: number;
  fallback: ReactNode;
  children: (data: LiveAnswer<T> | null, loading: boolean) => ReactNode;
}) {
  const { data, loading } = useLiveData<T>(path, intervalMs);
  // The original renderer keeps the zone until the API has said, for this
  // query, that the family is live: no query (a thumbnail, nothing chosen
  // yet), a dormant deploy, or a first request still in flight / failed.
  // Once live, a later failure keeps the last good answer (see useLiveData).
  if (path === null || !data || !data.enabled) return <>{fallback}</>;
  return <>{children(data, loading)}</>;
}

const signed = (n: number, digits = 2) => `${n >= 0 ? "+" : ""}${n.toFixed(digits)}`;
const upColor = (config: Cfg) => config.upColor || "#22c55e";
const downColor = (config: Cfg) => config.downColor || "#ef4444";

// ── Stocks ──────────────────────────────────────────────────────────────

export function StocksLiveWidget({ config = {}, fallback }: { config?: Cfg; fallback: ReactNode }) {
  const symbols = String(config.symbolList || DEFAULT_STOCK_SYMBOLS).toUpperCase();
  const path = config._thumb ? null : `/stocks?symbols=${q(symbols)}`;
  return (
    <LiveOrFallback<QuoteRow> path={path} intervalMs={60_000} fallback={fallback}>
      {(data, loading) => {
        const items = data?.items ?? [];
        const anyOpen = items.some((i) => i.marketOpen);
        return (
          <Frame
            config={config}
            title="Markets"
            location={symbols.split(",").length > 4 ? "" : symbols.replace(/,/g, " · ")}
            credit={<Credit data={data} extra={items.length ? (anyOpen ? "Market open" : "Market closed · last close") : undefined} />}
            empty={!data ? (loading ? "Loading quotes…" : "Quotes unavailable right now") : items.length ? undefined : "No quotes for those symbols"}
          >
            {(size) => (
              <Rows items={items} size={size} config={config}>
                {(s) => (
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap" }}>
                    <div data-field-jump="dataValue" style={{ fontWeight: 800, marginRight: "0.6em", ...fieldStyle(config, "dataValue") }}>
                      {s.symbol}
                      <span style={{ fontWeight: 700, marginLeft: "0.5em" }}>{s.price.toFixed(2)}</span>
                    </div>
                    <div data-field-jump="dataDetails" style={{ fontSize: ".85em", fontWeight: 700, color: s.change >= 0 ? upColor(config) : downColor(config), ...fieldStyle(config, "dataDetails") }}>
                      {s.change >= 0 ? "▲" : "▼"} {signed(s.change)} ({signed(s.pct)}%)
                    </div>
                  </div>
                )}
              </Rows>
            )}
          </Frame>
        );
      }}
    </LiveOrFallback>
  );
}

// ── Crypto ──────────────────────────────────────────────────────────────

const CURRENCY_SIGN: Record<string, string> = { usd: "$", eur: "€", gbp: "£", cad: "C$" };

export function CryptoLiveWidget({ config = {}, fallback }: { config?: Cfg; fallback: ReactNode }) {
  const coins = String(config.coinList || DEFAULT_CRYPTO_COINS).toLowerCase();
  const currency = String(config.currency || "usd").toLowerCase();
  const path = config._thumb ? null : `/crypto?coins=${q(coins)}&currency=${q(currency)}`;
  const sign = CURRENCY_SIGN[currency] ?? "";
  return (
    <LiveOrFallback<CoinRow> path={path} intervalMs={120_000} fallback={fallback}>
      {(data, loading) => {
        const items = data?.items ?? [];
        return (
          <Frame
            config={config}
            title="Crypto · 24h"
            location={currency.toUpperCase()}
            credit={<Credit data={data} />}
            empty={!data ? (loading ? "Loading prices…" : "Prices unavailable right now") : items.length ? undefined : "None of those coins are in the top 250"}
          >
            {(size) => (
              <Rows items={items} size={size} config={config}>
                {(c) => (
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap" }}>
                    <div data-field-jump="dataValue" style={{ fontWeight: 800, marginRight: "0.6em", ...fieldStyle(config, "dataValue") }}>
                      {c.name} <span style={{ opacity: 0.75, fontWeight: 600 }}>{c.symbol}</span>
                      <span style={{ marginLeft: "0.5em" }}>
                        {sign}
                        {c.price.toLocaleString(undefined, { maximumFractionDigits: c.price >= 100 ? 0 : c.price >= 1 ? 2 : 6 })}
                      </span>
                    </div>
                    <div data-field-jump="dataDetails" style={{ fontSize: ".85em", fontWeight: 700, color: c.pct24h >= 0 ? upColor(config) : downColor(config), ...fieldStyle(config, "dataDetails") }}>
                      {signed(c.pct24h)}%
                    </div>
                  </div>
                )}
              </Rows>
            )}
          </Frame>
        );
      }}
    </LiveOrFallback>
  );
}

// ── Flights ─────────────────────────────────────────────────────────────

const FLIGHT_STATUS_COLOR: Record<string, string> = {
  BOARDING: "#22c55e",
  "GATE CLOSED": "#f59e0b",
  DELAYED: "#f59e0b",
  CANCELLED: "#ef4444",
  DIVERTED: "#ef4444",
};

export function FlightsLiveWidget({ config = {}, fallback }: { config?: Cfg; fallback: ReactNode }) {
  const surface = useRenderSurface();
  const airport = String(config.airportCode || "").trim().toUpperCase();
  const direction = config.direction === "arrivals" ? "arrivals" : "departures";
  const valid = /^[A-Z]{3}$/.test(airport);
  const path = config._thumb || !valid ? null : `/flights?airport=${q(airport)}&direction=${direction}`;
  // No airport yet: a dormant deploy cannot be told apart from an enabled one
  // without a query, so the original board keeps the zone (and the editor's
  // Data field asks for the code).
  if (!valid) return <>{fallback}</>;
  return (
    <LiveOrFallback<FlightRow> path={path} intervalMs={120_000} fallback={fallback}>
      {(data, loading) => {
        const items = data?.items ?? [];
        return (
          <Frame
            config={config}
            setup={!valid}
            title={direction === "arrivals" ? "Arrivals" : "Departures"}
            location={valid ? airport : ""}
            credit={<Credit data={data} extra="Airport local time · check with your airline" />}
            empty={
              !valid
                ? surface === "player"
                  ? undefined
                  : "Enter a three-letter airport code"
                : !data
                  ? loading
                    ? "Loading flights…"
                    : "Flight information unavailable right now"
                  : items.length
                    ? undefined
                    : "No scheduled flights in the next six hours"
            }
          >
            {(size) => (
              <Rows items={items} size={size} config={config}>
                {(f) => (
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap" }}>
                    <div data-field-jump="dataValue" style={{ fontWeight: 700, marginRight: "0.6em", minWidth: 0, ...fieldStyle(config, "dataValue") }}>
                      <span style={{ fontWeight: 800, marginRight: "0.5em" }}>{f.revised || f.time}</span>
                      {f.place || f.placeCode}
                      <span style={{ opacity: 0.75, marginLeft: "0.5em" }}>{f.flight}</span>
                    </div>
                    <div data-field-jump="dataDetails" style={{ fontSize: ".8em", fontWeight: 700, ...fieldStyle(config, "dataDetails") }}>
                      {f.gate ? <span style={{ marginRight: "0.6em" }}>Gate {f.gate}</span> : null}
                      <span style={{ color: FLIGHT_STATUS_COLOR[f.status] }}>
                        {f.status}
                        {f.revised && f.status !== "CANCELLED" ? ` · was ${f.time}` : ""}
                      </span>
                    </div>
                  </div>
                )}
              </Rows>
            )}
          </Frame>
        );
      }}
    </LiveOrFallback>
  );
}

// ── Scores ──────────────────────────────────────────────────────────────

function startLabel(iso: string, timezone?: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  try {
    return d.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit", ...(timezone ? { timeZone: timezone } : {}) });
  } catch {
    return d.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
  }
}

export function ScoresLiveWidget({ config = {}, fallback }: { config?: Cfg; fallback: ReactNode }) {
  const surface = useRenderSurface();
  const league = String(config.leagueId || "").trim();
  const valid = /^\d{3,6}$/.test(league);
  const team = String(config.teamFilter || "").trim().toLowerCase();
  const path = config._thumb || !valid ? null : `/scores?league=${q(league)}`;
  if (!valid) return <>{fallback}</>;
  return (
    <LiveOrFallback<ScoreRow> path={path} intervalMs={60_000} fallback={fallback}>
      {(data, loading) => {
        const all = data?.items ?? [];
        const items = team ? all.filter((g) => `${g.home.name} ${g.away.name}`.toLowerCase().includes(team)) : all;
        const leagueName = typeof data?.league === "string" ? data.league : "";
        return (
          <Frame
            config={config}
            setup={!valid}
            title="Scores"
            location={leagueName}
            credit={<Credit data={data} extra="Live scores refresh about every 2 minutes" />}
            empty={
              !valid
                ? surface === "player"
                  ? undefined
                  : "Choose a league"
                : !data
                  ? loading
                    ? "Loading scores…"
                    : "Scores unavailable right now"
                  : items.length
                    ? undefined
                    : "No recent or upcoming games"
            }
          >
            {(size) => (
              <Rows items={items} size={size} config={config}>
                {(g) => (
                  <div>
                    <div data-field-jump="dataDetails" style={{ fontSize: ".75em", fontWeight: 700, letterSpacing: ".04em", ...fieldStyle(config, "dataDetails") }}>
                      {g.state === "live"
                        ? `${g.period}${g.clock ? ` · ${g.clock}` : ""}`.toUpperCase()
                        : g.state === "final"
                          ? "FINAL"
                          : startLabel(g.startsAt, config.timezone)}
                    </div>
                    {[g.away, g.home].map((t, i) => (
                      <div key={i} data-field-jump="dataValue" style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, ...fieldStyle(config, "dataValue") }}>
                        <span style={{ marginRight: "0.6em", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</span>
                        <span style={{ fontWeight: 800 }}>{t.score ?? ""}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Rows>
            )}
          </Frame>
        );
      }}
    </LiveOrFallback>
  );
}

// ── Traffic ─────────────────────────────────────────────────────────────

const SEVERITY_COLOR: Record<string, string> = { major: "#ef4444", closure: "#ef4444", moderate: "#f59e0b" };

export function TrafficLiveWidget({ config = {}, fallback }: { config?: Cfg; fallback: ReactNode }) {
  const surface = useRenderSurface();
  const location = String(config.location || "").trim();
  const radius = Math.max(5, Math.min(50, Number(config.radiusKm) || 25));
  const path = config._thumb || !location ? null : `/traffic?location=${q(location)}&radiusKm=${radius}`;
  // No location yet: the free CHP board owns the setup copy.
  if (!location) return <>{fallback}</>;
  return (
    <LiveOrFallback<TrafficItem> path={path} intervalMs={120_000} fallback={fallback}>
      {(data, loading) => {
        const items = data?.items ?? [];
        return (
          <Frame
            config={config}
            title="Road conditions"
            location={location}
            credit={<Credit data={data} extra={`Reported incidents within ${radius} km`} />}
            empty={!data ? (loading ? "Loading road reports…" : surface === "player" ? "Road reports unavailable right now" : "Road reports unavailable right now") : undefined}
          >
            {(size) =>
              items.length ? (
                <Rows items={items} size={size} config={config}>
                  {(i) => (
                    <>
                      <div data-field-jump="dataValue" style={{ fontWeight: 700, ...fieldStyle(config, "dataValue") }}>
                        <span style={{ color: SEVERITY_COLOR[i.severity] }}>{i.type}</span> · {i.road}
                      </div>
                      <div data-field-jump="dataDetails" style={{ fontSize: ".8em", marginTop: 4, ...fieldStyle(config, "dataDetails") }}>
                        {i.area ? `${i.area} · ` : ""}
                        {i.delayMin ? `+${i.delayMin} min · ` : ""}
                        {i.distanceKm} km away
                      </div>
                    </>
                  )}
                </Rows>
              ) : (
                <div style={{ textAlign: "center" }}>No reported incidents within {radius} km. This does not confirm clear roads.</div>
              )
            }
          </Frame>
        );
      }}
    </LiveOrFallback>
  );
}

// ── Mode inference (shared with the editor) ─────────────────────────────

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
