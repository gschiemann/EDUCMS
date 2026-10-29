"use client";
import { useEffect, useState, type ReactNode } from "react";
import { fetchWeather } from "./weather-api";

/** All current-weather looks share this source credit. It is kept outside
 * authored content so it cannot cover temperatures or disappear in a theme. */
export function CurrentWeatherBoundary({
  config,
  frozen,
  children,
}: {
  config: any;
  frozen?: boolean;
  children: ReactNode;
}) {
  const place = String(
    config.location || config.zipCode || config.weatherLocation || "",
  ).trim();
  const metric = ["metric", "celsius", "c"].includes(
    String(config.units || config.weatherUnits || "").toLowerCase(),
  );
  const key = `${place}|${metric}`;
  const [reading, setReading] = useState<{
    key: string;
    geocoded: boolean;
    fetchedAt: number;
  } | null>(null);
  const entered = [
    "tempF",
    "staticTemp",
    "staticDesc",
    "staticIcon",
    "condition",
    "high",
    "low",
    "weatherTemp",
    "weather.temp",
    "weather.high",
    "weather.v",
    "meta.temp.value",
  ].some((k) => config[k] !== undefined && config[k] !== "");
  useEffect(() => {
    if (frozen || !place) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let goodAt = 0;
    const refresh = async () => {
      if (cancelled) return;
      if (document.hidden) {
        timer = setTimeout(refresh, 60000);
        return;
      }
      const data = await fetchWeather(place, metric);
      if (cancelled) return;
      if (data) {
        goodAt = Date.now();
        setReading({ key, geocoded: !!data.geocoded, fetchedAt: goodAt });
      } else if (Date.now() - goodAt > 3600000) setReading(null);
      timer = setTimeout(refresh, data ? 900000 : 60000);
    };
    timer = setTimeout(refresh, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [frozen, place, metric, key]);
  const source =
    reading?.key === key && Date.now() - reading.fetchedAt <= 3600000
      ? reading
      : null;
  if (frozen) return <>{children}</>;
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "relative",
          flex: "1 1 0",
          minHeight: 0,
          width: "100%",
        }}
      >
        {children}
      </div>
      <div
        data-current-weather-credit=""
        style={{
          flex: "0 0 auto",
          font: "12px/1.35 Arial, sans-serif",
          padding: "2px 5px",
          textAlign: "center",
          background: config.bgColor ?? config.style?.bgColor ?? 'rgba(0,0,0,.72)',
          color: config.bgColor != null || config.style?.bgColor != null ? config.textColor || config.style?.textColor || '#fff' : '#fff',
        }}
      >
        {source ? (
          <>
            <a
              href="https://www.met.no/en"
              target="_blank"
              rel="noreferrer"
              style={{ color: "inherit" }}
            >
              MET Norway
            </a>{" "}
            forecast ·{" "}
            <a
              href="https://creativecommons.org/licenses/by/4.0/"
              target="_blank"
              rel="noreferrer"
              style={{ color: "inherit" }}
            >
              CC BY 4.0
            </a>{" "}
            · rounded / converted{source.geocoded && <> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" style={{color:'inherit'}}>© OpenStreetMap</a></>}
            {entered ? " · entered overrides" : ""}
          </>
        ) : entered ? (
          "Manually entered weather"
        ) : place ? (
          "Weather forecast unavailable"
        ) : (
          "Set a weather location"
        )}
      </div>
    </div>
  );
}
export function hasCurrentWeather(type: string, config: any) {
  if (type === "WEATHER")
    return (
      config.variant !== "weather-outlook" &&
      !(Number(config.forecastDays) >= 2)
    );
  return /^(?:MS_|HS_|ANIMATED_WELCOME)/.test(type);
}
