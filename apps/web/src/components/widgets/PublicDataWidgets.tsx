"use client";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useRenderSurface } from "./render-surface";
import { useElementSize } from "./v2/_shared/useElementSize";
import { forecastTextStyle as fieldStyle } from "./forecast-appearance";
import {
  useAirQuality,
  useAirportConditions,
  useTransitArrivals,
  usePublicDataClock,
  useParkingReports,
  useRoadIncidents,
} from "./use-public-data";
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
export function clock(at: string) {
  const date = new Date(at);
  return Number.isFinite(date.getTime())
    ? date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : "";
}
export function Frame({
  config,
  title,
  location,
  credit,
  children,
  empty,
  setup = false,
}: {
  config: any;
  title: string;
  location: string;
  credit: ReactNode;
  children?: (size: {
    width: number;
    height: number;
    compact: boolean;
    font: number;
  }) => ReactNode;
  empty?: string;
  setup?: boolean;
}) {
  const surface = useRenderSurface();
  const { ref, width, height } = useElementSize<HTMLDivElement>();
  const w = width || 800,
    h = height || 400;
  const compact = config.dataLayout === "banner" || h < 190;
  const font = Math.max(12, Math.min(64, w / 19, h / (compact ? 8 : 14)));
  const bg = config.style?.bgColor ?? config.bgColor ?? "#10242e";
  const style: CSSProperties = {
    position: "relative",
    width: "100%",
    height: "100%",
    boxSizing: "border-box",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    padding: `${Math.max(8, Math.min(48, h * 0.07))}px ${Math.max(12, Math.min(80, w * 0.04, h * 0.14))}px`,
    borderRadius: config.style?.borderRadius ?? 16,
    backgroundColor: bg === "transparent" ? "transparent" : bg,
    backgroundImage:
      bg === "transparent"
        ? "none"
        : config.style?.bgImage
          ? `url(${JSON.stringify(config.style.bgImageUrl)})`
          : config.style?.bgGradient || "none",
    backgroundSize: "cover",
    color: config.style?.textColor || config.textColor || "#eff6f7",
    fontFamily: config.style?.fontFamily || "Inter, Arial, sans-serif",
    lineHeight: 1.25,
    fontSize: font,
    fontWeight: config.style?.fontWeight,
    textAlign: config.style?.textAlign,
  };
  if (setup && surface === "player")
    return <section ref={ref} data-public-data-widget="" style={style} />;
  return (
    <section
      ref={ref}
      data-public-data-widget=""
      data-layout={config.dataLayout || "auto"}
      style={style}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          flexWrap: "wrap",
          marginBottom: compact ? 4 : Math.max(10, h * 0.035),
          flexShrink: 0,
        }}
      >
        <div
          data-field="title"
          style={{
            fontSize: "1.3em",
            fontWeight: 700,
            marginRight: 12,
            ...fieldStyle(config, "title"),
          }}
        >
          {config.title ?? title}
        </div>
        <div
          data-field-jump="dataLocation"
          style={{ fontSize: ".88em", ...fieldStyle(config, "dataLocation") }}
        >
          {location}
        </div>
      </header>
      <div
        style={{
          flex: "1 1 0",
          minHeight: 0,
          position: "relative",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        {empty ? (
          <div
            role="status"
            style={{
              fontSize: "1em",
              textAlign: "center",
              ...fieldStyle(config, "dataDetails"),
            }}
          >
            {empty}
          </div>
        ) : (
          children?.({ width: w, height: h, compact, font })
        )}
      </div>
      <footer
        data-field-jump="dataSource"
        style={{
          flexShrink: 0,
          marginTop: compact ? 3 : Math.max(8, h * 0.025),
          fontSize: Math.max(10, font * 0.64),
          lineHeight: 1.3,
          ...fieldStyle(config, "dataSource"),
        }}
      >
        {credit}
      </footer>
    </section>
  );
}
/** One page clock for a board, not one timer per row. All notices remain reachable. */
export function Rows<T>({
  items,
  size,
  config,
  children,
}: {
  items: T[];
  size: { width: number; height: number; compact: boolean; font: number };
  config: any;
  children: (item: T) => ReactNode;
}) {
  const cards =
    !size.compact &&
    (config.dataLayout === "cards" ||
      (config.dataLayout === "auto" && size.width / size.height > 1.45));
  const preferredColumns = size.compact
    ? Math.min(2, items.length || 1)
    : cards && size.width > 520
      ? 2
      : 1;
  const preferredCapacity = Math.max(
    preferredColumns,
    Math.min(
      8,
      Math.floor((size.height * 0.58) / (size.font * (cards ? 4.8 : 3.5))) *
        preferredColumns,
    ),
  );
  const geometryKey = `${size.width}:${size.height}:${size.font}:${config.dataLayout}:${config.title}:${config.style?.fontFamily}:${JSON.stringify(config._styles || {})}`;
  const [fit, setFit] = useState({
    key: geometryKey,
    capacity: preferredCapacity,
  });
  const capacity = fit.key === geometryKey ? fit.capacity : preferredCapacity;
  const columns = Math.min(preferredColumns, capacity);
  const rowsRef = useRef<HTMLDivElement>(null);
  const pages = Math.max(1, Math.ceil(items.length / capacity));
  useLayoutEffect(() => {
    const node = rowsRef.current,
      parent = node?.parentElement;
    if (!node || !parent || !parent.clientHeight) return;
    const indicator = node.nextElementSibling as HTMLElement | null;
    const needed =
      node.scrollHeight + (indicator?.offsetHeight || 0) + (pages > 1 ? 3 : 0);
    if (needed > parent.clientHeight + 1 && capacity > 1)
      setFit({ key: geometryKey, capacity: Math.max(1, capacity - columns) });
  }, [geometryKey, capacity, columns, pages, items]);
  const [page, setPage] = useState(0);
  useEffect(() => {
    setPage(0);
    if (pages < 2) return;
    const timer = setInterval(() => {
      if (!document.hidden) setPage((p) => (p + 1) % pages);
    }, 10000);
    return () => clearInterval(timer);
  }, [pages, capacity]); // perf-allow: one visible ten-second page clock per public-data board.
  const shown = items.slice(
    (page % pages) * capacity,
    ((page % pages) + 1) * capacity,
  );
  return (
    <>
      <div
        ref={rowsRef}
        data-public-rows=""
        data-row-layout={size.compact ? "banner" : cards ? "cards" : "list"}
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${columns},minmax(0,1fr))`,
          minWidth: 0,
        }}
      >
        {shown.map((item, i) => (
          <article
            key={i}
            style={{
              minWidth: 0,
              overflow: "hidden",
              boxSizing: "border-box",
              padding: cards ? "0.6em" : size.compact ? "0.15em 0" : "0.35em 0",
              margin: cards ? "0.2em" : size.compact ? "0 0.6em 0 0" : 0,
              borderTop: cards ? "1px solid currentColor" : "0",
              borderLeft: cards ? "1px solid currentColor" : "0",
              borderRight: cards ? "1px solid currentColor" : "0",
              borderBottom: "1px solid currentColor",
              borderRadius: cards ? 10 : 0,
            }}
          >
            {children(item)}
          </article>
        ))}
      </div>
      {pages > 1 && (
        <div
          aria-label="Page"
          style={{ fontSize: ".6em", textAlign: "right", marginTop: 3 }}
        >
          {(page % pages) + 1} / {pages}
        </div>
      )}
    </>
  );
}
export const sourceLink = { color: "inherit" };
export function AirQualityLiveWidget({
  config = {},
}: {
  config?: any;
  live?: boolean;
}) {
  const location = String(config.location || config.zip || "").trim();
  const feed = useAirQuality(location, !config._thumb),
    now = usePublicDataClock(!config._thumb);
  const data = feed.data,
    observation =
      data?.observation &&
      now - Date.parse(data.observation.observedAt) <= 3 * 3600000
        ? data.observation
        : null;
  const empty = !location
    ? "Choose a U.S. city or ZIP"
    : feed.loading && !data
      ? "Loading air quality…"
      : !observation
        ? data?.reason || "Current air quality unavailable"
        : undefined;
  const credit = (
    <>
      Source:{" "}
      <a
        href="https://www.airnow.gov/"
        target="_blank"
        rel="noreferrer"
        style={sourceLink}
      >
        EPA AirNow
      </a>
      {observation
        ? ` · ${observation.agency} · Observed ${clock(observation.observedAt)}`
        : ""}{" "}
      · Preliminary data
    </>
  );
  return (
    <Frame
      config={config}
      setup={!location}
      title="Air quality"
      location={data?.area ? `${data.area}, ${data.state}` : location}
      credit={credit}
      empty={empty}
    >
      {(size) => {
        const o = observation!;
        const horizontal =
          size.compact ||
          (config.dataLayout !== "list" &&
            (config.dataLayout === "cards" || size.width / size.height > 1.4));
        return (
          <div
            data-air-quality-live=""
            style={{
              display: "flex",
              flexDirection: horizontal ? "row" : "column",
              alignItems: "center",
              justifyContent: "center",
              width: "100%",
              height: "100%",
            }}
          >
            <div
              style={{
                textAlign: "center",
                display: size.compact ? "flex" : "block",
                alignItems: "center",
                flexShrink: 0,
                marginRight: horizontal ? size.width * 0.055 : 0,
                marginBottom: horizontal ? 0 : size.height * 0.025,
              }}
            >
              <div
                style={{
                  fontSize: ".72em",
                  letterSpacing: ".12em",
                  marginRight: size.compact ? 12 : 0,
                }}
              >
                U.S. AQI
              </div>
              <div
                data-field-jump="dataValue"
                style={{
                  fontSize: Math.max(
                    24,
                    Math.min(
                      size.height * (size.compact ? 0.25 : 0.28),
                      size.width * 0.23,
                    ),
                  ),
                  fontWeight: 750,
                  lineHeight: 1.05,
                  ...fieldStyle(config, "dataValue"),
                }}
              >
                {o.aqi}
              </div>
              <div
                data-aqi-category=""
                style={{
                  display: "inline-block",
                  marginTop: size.compact ? 0 : 6,
                  marginLeft: size.compact ? 12 : 0,
                  background: o.color,
                  color: o.aqi <= 150 ? "#111111" : "#ffffff",
                  fontSize: size.compact ? ".7em" : ".9em",
                  fontWeight: 700,
                  borderRadius: 6,
                  padding: "4px 9px",
                  maxWidth: Math.max(100, size.width * 0.5),
                }}
              >
                {o.category}
              </div>
            </div>
            {!size.compact && (
              <div
                data-field-jump="dataDetails"
                style={{ minWidth: 0, ...fieldStyle(config, "dataDetails") }}
              >
                <div style={{ fontSize: ".75em", marginBottom: 8 }}>
                  Pollutant AQI
                </div>
                {o.pollutants.slice(0, 4).map((p) => (
                  <div
                    key={p.name}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginBottom: 6,
                      minWidth: Math.min(200, size.width * 0.55),
                    }}
                  >
                    <span style={{ marginRight: 24 }}>{p.name}</span>
                    <strong>{p.aqi}</strong>
                  </div>
                ))}
                <div style={{ fontSize: ".68em", marginTop: 8 }}>
                  {data?.matchedZip
                    ? `Reporting area for ${location}`
                    : `Nearest reporting area · ${data?.distanceKm} km away`}
                </div>
              </div>
            )}
          </div>
        );
      }}
    </Frame>
  );
}
export function AirportConditionsWidget({
  config = {},
}: {
  config?: any;
  live?: boolean;
}) {
  const airport = String(config.airport || "")
    .trim()
    .toUpperCase();
  const feed = useAirportConditions(airport, !config._thumb),
    now = usePublicDataClock(!config._thumb);
  const data =
    feed.data && now - Date.parse(feed.data.updatedAt) < 30 * 60000
      ? feed.data
      : null;
  return (
    <Frame
      config={config}
      title="Airport conditions"
      location={airport || "U.S. airports"}
      credit={
        <>
          Source:{" "}
          <a
            href="https://nasstatus.faa.gov/"
            target="_blank"
            rel="noreferrer"
            style={sourceLink}
          >
            FAA NAS Status
          </a>
          {data ? ` · Updated ${clock(data.updatedAt)}` : ""} · Airport notices;
          check your airline for flight status
        </>
      }
      empty={
        !data
          ? config._thumb
            ? "FAA airport notices"
            : feed.loading
              ? "Loading airport conditions…"
              : "FAA conditions temporarily unavailable"
          : undefined
      }
    >
      {(size) => {
        return data!.items.length ? (
          <Rows items={data!.items} size={size} config={config}>
            {(item) => (
              <>
                <div
                  data-field-jump="dataValue"
                  style={{
                    fontWeight: 700,
                    ...fieldStyle(config, "dataValue"),
                  }}
                >
                  {item.airport} · {item.type}
                  {item.average ? ` · ${item.average}` : ""}
                </div>
                <div
                  data-field-jump="dataDetails"
                  style={{
                    fontSize: ".82em",
                    lineHeight: 1.35,
                    marginTop: 4,
                    ...fieldStyle(config, "dataDetails"),
                  }}
                >
                  {item.reason}
                </div>
                {!size.compact && (item.maximum || item.end) && (
                  <div style={{ fontSize: ".7em", marginTop: 3 }}>
                    {item.maximum ? `Maximum delay: ${item.maximum}` : ""}
                    {item.end ? ` · Notice end: ${item.end}` : ""}
                  </div>
                )}
              </>
            )}
          </Rows>
        ) : (
          <div
            data-field-jump="dataDetails"
            style={{
              textAlign: "center",
              ...fieldStyle(config, "dataDetails"),
            }}
          >
            No FAA airport-wide disruptions listed
            {airport ? ` for ${airport}` : ""}.
          </div>
        );
      }}
    </Frame>
  );
}
export function TransitArrivalsLiveWidget({
  config = {},
}: {
  config?: any;
  live?: boolean;
}) {
  const station = String(config.stationId || "");
  const feed = useTransitArrivals(station, !config._thumb),
    now = usePublicDataClock(!config._thumb);
  const data =
    feed.data && now - Date.parse(feed.data.updatedAt) <= 120000
      ? feed.data
      : null;
  const empty = !station
    ? "Choose an MBTA station"
    : !data
      ? feed.loading
        ? "Loading arrivals…"
        : "Current predictions unavailable"
      : undefined;
  return (
    <Frame
      config={config}
      setup={!station}
      title="Next departures"
      location={data?.station || "MBTA · Boston area"}
      credit={
        <>
          Data:{" "}
          <a
            href="https://www.mbta.com/"
            target="_blank"
            rel="noreferrer"
            style={sourceLink}
          >
            MassDOT / MBTA
          </a>
          {data ? ` · Updated ${clock(data.updatedAt)}` : ""} · Estimates may
          change
        </>
      }
      empty={empty}
    >
      {(size) => {
        const items = data!.items.filter(
          (i) => Date.parse(i.time) >= now - 15000,
        );
        return items.length ? (
          <Rows items={items} size={size} config={config}>
            {(item) => (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  minWidth: 0,
                }}
              >
                <div style={{ minWidth: 0, marginRight: 12 }}>
                  <div
                    data-field-jump="dataDetails"
                    style={{
                      fontWeight: 650,
                      ...fieldStyle(config, "dataDetails"),
                    }}
                  >
                    {item.route} · {item.direction}
                  </div>
                  {!size.compact && (
                    <div style={{ fontSize: ".72em", marginTop: 3 }}>
                      {item.platform ? `Platform ${item.platform}` : ""}
                      {item.status ? ` ${item.status}` : ""}
                      {item.predictionKind === "schedule-estimate"
                        ? " · Schedule-based estimate"
                        : ""}
                    </div>
                  )}
                </div>
                <div
                  data-field-jump="dataValue"
                  style={{
                    fontSize: "1.45em",
                    fontWeight: 750,
                    whiteSpace: "nowrap",
                    ...fieldStyle(config, "dataValue"),
                  }}
                >
                  {Math.max(
                    0,
                    Math.ceil((Date.parse(item.time) - now) / 60000),
                  )}
                  <span style={{ fontSize: ".5em", marginLeft: 4 }}>min</span>
                </div>
              </div>
            )}
          </Rows>
        ) : (
          <div style={{ textAlign: "center" }}>
            No upcoming predictions for this station.
          </div>
        );
      }}
    </Frame>
  );
}

export function ParkingReportsLiveWidget({
  config = {},
}: {
  config?: any;
  live?: boolean;
}) {
  const location = String(config.location || "").trim(),
    feed = useParkingReports(location, !config._thumb),
    now = usePublicDataClock(!config._thumb);
  const data =
    feed.data && now - Date.parse(feed.data.fetchedAt) < 3 * 60000
      ? feed.data
      : null;
  const empty = !location
    ? "Choose a Los Angeles street location"
    : !data
      ? feed.loading
        ? "Loading parking reports…"
        : "Parking reports unavailable"
      : !data.supported
        ? data.reason
        : !data.items.length
          ? "No metered spaces reported within 1.5 km"
          : undefined;
  return (
    <Frame
      config={config}
      setup={!location}
      title="Parking nearby"
      location="Los Angeles street meters"
      credit={
        <>
          Data:{" "}
          <a
            href="https://data.lacity.org/d/e7h6-4a3e"
            target="_blank"
            rel="noreferrer"
            style={sourceLink}
          >
            LADOT / LA ExpressPark
          </a>{" "}
          · Last known sensor states; reports older than 30 min are unknown
          {data ? ` · Checked ${clock(data.fetchedAt)}` : ""}
        </>
      }
      empty={empty}
    >
      {(size) => {
        return (
          <Rows items={data!.items} size={size} config={config}>
            {(item) => (
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  minWidth: 0,
                }}
              >
                <div style={{ minWidth: 0, marginRight: 12 }}>
                  <div
                    data-field-jump="dataDetails"
                    style={{
                      fontSize: ".85em",
                      fontWeight: 650,
                      ...fieldStyle(config, "dataDetails"),
                    }}
                  >
                    {item.name}
                  </div>
                  {!size.compact && (
                    <div style={{ fontSize: ".66em", marginTop: 4 }}>
                      {item.distanceKm} km · {item.occupied} occupied ·{" "}
                      {item.unknown} unknown
                    </div>
                  )}
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div
                    data-field-jump="dataValue"
                    style={{
                      fontSize: "1.6em",
                      fontWeight: 750,
                      ...fieldStyle(config, "dataValue"),
                    }}
                  >
                    {item.vacant + item.occupied === 0 ? "—" : item.vacant}
                  </div>
                  <div style={{ fontSize: ".65em" }}>
                    {item.vacant + item.occupied === 0
                      ? "No recent readings"
                      : "reported vacant"}
                  </div>
                </div>
              </div>
            )}
          </Rows>
        );
      }}
    </Frame>
  );
}

export function RoadIncidentsLiveWidget({
  config = {},
}: {
  config?: any;
  live?: boolean;
}) {
  const location = String(config.location || "").trim(),
    feed = useRoadIncidents(location, !config._thumb),
    now = usePublicDataClock(!config._thumb);
  const data =
    feed.data && now - Date.parse(feed.data.fetchedAt) < 3 * 60000
      ? feed.data
      : null;
  const empty = !location
    ? "Choose a California city or ZIP"
    : !data
      ? feed.loading
        ? "Loading road reports…"
        : "Current road reports unavailable"
      : !data.supported
        ? data.reason
        : undefined;
  return (
    <Frame
      config={config}
      setup={!location}
      title="Road conditions"
      location={location ? `${location} · California` : "California"}
      credit={
        <>
          Source:{" "}
          <a
            href="https://cad.chp.ca.gov/traffic.aspx"
            target="_blank"
            rel="noreferrer"
            style={sourceLink}
          >
            California Highway Patrol
          </a>
          {data ? ` · Checked ${clock(data.fetchedAt)}` : ""} · Reported
          incidents within 50 km; not travel-time estimates
        </>
      }
      empty={empty}
    >
      {(size) =>
        data!.items.length ? (
          <Rows items={data!.items} size={size} config={config}>
            {(item) => (
              <>
                <div
                  data-field-jump="dataValue"
                  style={{
                    fontWeight: 700,
                    ...fieldStyle(config, "dataValue"),
                  }}
                >
                  {item.type} · {item.road}
                </div>
                <div
                  data-field-jump="dataDetails"
                  style={{
                    fontSize: ".8em",
                    marginTop: 4,
                    ...fieldStyle(config, "dataDetails"),
                  }}
                >
                  {item.area} · {item.distanceKm} km away
                </div>
              </>
            )}
          </Rows>
        ) : (
          <div style={{ textAlign: "center" }}>
            No listed CHP incidents with mapped locations within 50 km. This
            does not confirm clear roads.
          </div>
        )
      }
    </Frame>
  );
}
