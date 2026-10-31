"use client";
import { useEffect, useState, type CSSProperties } from "react";
import { forecastGeometry } from "./forecast-responsive";
import { useElementSize } from "./v2/_shared/useElementSize";
import {
  Cloud,
  CloudRain,
  CloudSnow,
  CloudSun,
  CloudLightning,
  Sun,
  Wind,
} from "lucide-react";
import { usePolledFeed } from "./use-live-feed";
import { useRenderSurface } from "./render-surface";
import { SampleStamp } from "./v2/_shared/live-data-truth";
import {
  forecastIsTransparent,
  forecastLayout,
  forecastOpacity,
  forecastTextStyle,
} from "./forecast-appearance";
import "./forecast-weather.css";

interface Day {
  date: string;
  high: number;
  low: number | null;
  condition: string;
  rain: number | null;
}
interface Forecast {
  location: string;
  days: Day[];
  fetchedAt: string;
  source: string;
  geocoded: boolean;
}
const API = (
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080/api/v1"
).replace(/\/$/, "");
export const forecastDayCount = (value: unknown) =>
  Math.max(2, Math.min(5, Math.round(Number(value) || 5)));
function weatherIcon(condition: string) {
  if (/thunder|storm/i.test(condition)) return CloudLightning;
  if (/snow|ice|sleet/i.test(condition)) return CloudSnow;
  if (/rain|shower|drizzle/i.test(condition)) return CloudRain;
  if (/partly|mostly sunny/i.test(condition)) return CloudSun;
  if (/cloud|fog/i.test(condition)) return Cloud;
  if (/wind/i.test(condition)) return Wind;
  return Sun;
}
export function ForecastWeatherWidget({
  config = {},
}: {
  config?: Record<string, any>;
}) {
  const count = forecastDayCount(config.forecastDays);
  const location = String(config.location || config.zipCode || "").trim();
  const metric = ["metric", "celsius", "c"].includes(
    String(config.units || "").toLowerCase(),
  );
  const url = `${API}/feeds/forecast?location=${encodeURIComponent(location)}&units=${metric ? "metric" : "imperial"}`;
  const { data, loading, error } = usePolledFeed<Forecast>(
    !!location,
    () => url,
    15 * 60 * 1000,
    60 * 60 * 1000,
  );
  const player = useRenderSurface() === "player";
  const { ref: root, width, height } = useElementSize<HTMLDivElement>();
  const w = width || 1000,
    h = height || 400;
  const layout = forecastLayout(config.forecastLayout, w / h);
  const transparent = forecastIsTransparent(config);
  const sample = !data && !player;
  const samples: Day[] = Array.from({ length: count }, (_, i) => ({
    date: new Date(Date.UTC(2026, 0, 5 + i)).toISOString().slice(0, 10),
    high: metric ? 23 + i : 74 + i,
    low: metric ? 16 + i : 60 + i,
    condition: i % 2 ? "Partly cloudy" : "Sunny",
    rain: i % 2 ? 20 : 0,
  }));
  const days = data?.days.slice(0, count) || (sample ? samples : []);
  const geometry = forecastGeometry(w, h, days.length || count, layout);
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(days.length / geometry.capacity));
  useEffect(() => {
    setPage(0);
    if (pageCount <= 1) return;
    const timer = setInterval(() => {
      if (!document.hidden) setPage((i) => (i + 1) % pageCount);
    }, 8000);
    return () => clearInterval(timer);
  }, [pageCount, count, location]); // perf-allow: visible, 8-second forecast page rotation only when necessary.
  const start = (page % pageCount) * geometry.capacity;
  const shown = days.slice(start, start + geometry.capacity);
  const cols = Math.min(geometry.columns, shown.length || 1);
  const rows = Math.ceil((shown.length || 1) / cols);
  const textScale =
    typeof config.forecastTextScale === "number"
      ? Math.max(0.6, Math.min(1.8, config.forecastTextScale))
      : 1;
  const font = geometry.font * textScale;
  const bg = config.bgColor ?? config.style?.bgColor ?? "#102b3c";
  const ink = config.textColor ?? config.style?.textColor ?? "#f1f7f9";
  const details = config.forecastDetailColor || "inherit";
  const heading = config.forecastHeading ?? `${count}-day outlook`;
  const place =
    config.forecastLocationLabel ||
    data?.location ||
    location ||
    "Local forecast";
  const field = (name: string) => forecastTextStyle(config, name);
  const rootStyle = {
    fontSize: font,
    padding: geometry.padding,
    "--fw-small": `${Math.max(12, font * 0.76)}px`,
    "--fw-caption": `${Math.max(11, font * 0.68)}px`,
    "--fw-footer-size": `${Math.max(10, font * 0.54)}px`,
    color: ink,
    fontFamily:
      config.forecastFontFamily ||
      config.style?.fontFamily ||
      "Inter, Arial, sans-serif",
    "--fw-accent": config.accentColor || "#8ec9e4",
    "--fw-details": details,
    "--fw-detail-opacity": config.forecastDetailColor ? 1 : 0.65,
  } as CSSProperties;
  return (
    <div
      ref={root}
      data-weather-outlook
      data-days={count}
      data-layout={layout}
      data-transparent={transparent}
      data-presentation={
        geometry.micro
          ? "micro"
          : geometry.list
            ? "rows"
            : geometry.compact
              ? "compact"
              : "cards"
      }
      data-page={(page % pageCount) + 1}
      data-page-count={pageCount}
      className={`forecast-outlook fw-${layout}${w < h ? " fw-portrait" : ""}`}
      style={rootStyle}
    >
      <div
        aria-hidden
        className="fw-surface"
        style={{
          background: bg,
          opacity: transparent
            ? 0
            : forecastOpacity(config.forecastBackgroundOpacity, 1),
        }}
      />
      <header className="fw-header">
        <div className="fw-heading-group">
          <div
            key={`heading:${heading}:${layout}`}
            className="fw-heading"
            data-field="forecastHeading"
            style={field("forecastHeading")}
          >
            {heading}
          </div>
          <div
            key={`place:${place}:${layout}`}
            className="fw-location"
            data-field="forecastLocationLabel"
            style={field("forecastLocationLabel")}
          >
            {place}
          </div>
        </div>
        <span
          className="fw-units"
          data-field-jump="forecastDetails"
          style={field("forecastDetails")}
        >
          {metric ? "°C" : "°F"}
        </span>
      </header>
      {days.length ? (
        <div
          data-forecast-grid
          className="fw-grid"
          style={{
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
            width: `${(100 * cols) / geometry.columns}%`,
            justifySelf: "center",
          }}
        >
          {shown.map((d, i) => {
            const Icon = weatherIcon(d.condition);
            return (
              <article
                key={d.date}
                data-forecast-day
                className="fw-day"
                style={{
                  gridColumn:
                    cols > 1 &&
                    shown.length % cols === 1 &&
                    i === shown.length - 1
                      ? `span ${cols}`
                      : undefined,
                  width:
                    cols > 1 &&
                    shown.length % cols === 1 &&
                    i === shown.length - 1
                      ? `calc(${100 / cols}% - 0.5em)`
                      : undefined,
                  justifySelf: "center",
                }}
              >
                <div
                  aria-hidden
                  className="fw-card-surface"
                  style={{
                    background: config.forecastCardColor || "#ffffff",
                    opacity: transparent
                      ? 0
                      : forecastOpacity(config.forecastCardOpacity, 0.05),
                  }}
                />
                <div className="fw-day-content">
                  <div className="fw-day-name">
                    <span
                      data-field-jump="forecastDay"
                      style={field("forecastDay")}
                    >
                      {sample
                        ? ["Mon", "Tue", "Wed", "Thu", "Fri"][start + i]
                        : new Date(d.date + "T12:00:00Z").toLocaleDateString(
                            undefined,
                            { weekday: "short", timeZone: "UTC" },
                          )}
                    </span>
                    <div
                      className="fw-date"
                      data-field-jump="forecastDate"
                      style={field("forecastDate")}
                    >
                      {sample
                        ? "Sample"
                        : new Date(d.date + "T12:00:00Z").toLocaleDateString(
                            undefined,
                            { month: "short", day: "numeric", timeZone: "UTC" },
                          )}
                    </div>
                  </div>
                  <Icon
                    aria-hidden
                    className="fw-icon"
                    style={{ color: config.forecastIconColor || "#b3dcf0" }}
                    strokeWidth={1.3}
                  />
                  <div className="fw-temperatures">
                    <div className="fw-degrees">
                      <span
                        className="fw-high"
                        data-field-jump="forecastHigh"
                        style={{
                          color: config.forecastHighColor || "inherit",
                          ...field("forecastHigh"),
                        }}
                      >
                        {d.high}°
                      </span>
                      <span
                        className="fw-low"
                        data-field-jump="forecastLow"
                        style={{
                          color: config.forecastLowColor || "inherit",
                          opacity: config.forecastLowColor ? 1 : 0.6,
                          ...field("forecastLow"),
                        }}
                      >
                        {d.low == null ? "—" : `${d.low}°`}
                      </span>
                    </div>
                    <div
                      className="fw-details"
                      data-field-jump="forecastDetails"
                      style={field("forecastDetails")}
                    >
                      High / Low{d.rain != null ? ` · ${d.rain}% rain` : ""}
                    </div>
                  </div>
                  <div
                    className="fw-condition"
                    data-field-jump="forecastCondition"
                    style={field("forecastCondition")}
                  >
                    {d.condition}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div role="status" className="fw-status">
          {!location
            ? "Set a U.S. city or ZIP code"
            : loading
              ? "Loading forecast…"
              : "Forecast temporarily unavailable"}
        </div>
      )}
      <footer
        className="fw-footer"
        data-field-jump="forecastFooter"
        style={field("forecastFooter")}
      >
        <a
          href="https://www.weather.gov/"
          target="_blank"
          rel="noopener noreferrer"
        >
          {geometry.micro ? "NWS" : "National Weather Service"}
        </a>
        {data?.geocoded && (
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noopener noreferrer"
          >
            {geometry.micro ? "© OSM" : "© OpenStreetMap contributors"}
          </a>
        )}
        {data && (
          <span className="fw-refreshed">
            {error ? "Refresh delayed · " : ""}Refreshed{" "}
            {new Date(data.fetchedAt).toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>
        )}
        {pageCount > 1 && (
          <span
            className="fw-page-label"
            aria-label={`Forecast page ${(page % pageCount) + 1} of ${pageCount}`}
          >
            {(page % pageCount) + 1} / {pageCount}
          </span>
        )}
      </footer>
      {sample && <SampleStamp />}
    </div>
  );
}
