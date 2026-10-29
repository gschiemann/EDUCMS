"use client";
import type { ComponentType, CSSProperties } from "react";
import { useLiveIcsFeed } from "./use-live-feed";
import { useRenderSurface } from "./render-surface";
import { SampleStamp, ManualDataStamp } from "./v2/_shared/live-data-truth";
import type { CalendarFeedEvent } from "./feed-types";
export function calendarDisplayEvents(events: CalendarFeedEvent[]) {
  return events
    .filter(
      (event) =>
        event &&
        typeof event.title === "string" &&
        event.title.trim() &&
        Number.isFinite(Date.parse(event.start)),
    )
    .map((event) => ({
      ...event,
      date: new Date(event.start).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      }),
      time: event.allDay
        ? "All day"
        : new Date(event.start).toLocaleTimeString(undefined, {
            hour: "numeric",
            minute: "2-digit",
          }),
      location: event.location || "",
      tag: "",
    }));
}
/** Share the real ICS transport with every calendar look. A theme must never
 * hide a feed URL or replace an empty feed with its own invented events. */
export function withCalendarFeed<P extends { config?: any }>(
  Component: ComponentType<P>,
): ComponentType<P> {
  function ConnectedCalendar(props: P) {
    const config = props.config || {};
    const url = typeof config.feedUrl === "string" ? config.feedUrl.trim() : "";
    const feed = useLiveIcsFeed(url || undefined);
    const player = useRenderSurface() === "player";
    const manual = Array.isArray(config.events)
      ? config.events.filter(
          (e: any) =>
            e && typeof e === "object" && String(e.title || "").trim(),
        )
      : [];
    const incoming =
      url && feed.events ? calendarDisplayEvents(feed.events) : [];
    const seen = new Set<string>();
    const events = [...manual, ...incoming].filter((e: any) => {
      const key = [e.title, e.start || e.date, e.time].join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const sample = !url && !manual.length && !player;
    const status = url
      ? feed.error
        ? "Calendar refresh delayed"
        : feed.loading
          ? "Connecting calendar…"
          : "Connected calendar"
      : "Manually updated";
    const frame: CSSProperties = {
      width: "100%",
      height: "100%",
      position: "relative",
      overflow: "hidden",
    };
    if (!events.length && !sample)
      return (
        <div
          data-calendar-feed-state="empty"
          role="status"
          style={{
            ...frame,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: config.style?.bgColor || "transparent",
            color: config.style?.textColor || "inherit",
            fontSize: "1em",
            padding: "5%",
            boxSizing: "border-box",
            textAlign: "center",
          }}
        >
          {!url
            ? "Add events or connect an ICS calendar"
            : feed.loading
              ? "Loading calendar…"
              : feed.error
                ? "Calendar temporarily unavailable"
                : "No upcoming events"}
        </div>
      );
    const next = sample ? config : { ...config, feedUrl: "", events };
    return (
      <div
        style={frame}
        data-calendar-feed-state={
          url ? "connected" : sample ? "sample" : "manual"
        }
      >
        <Component {...props} config={next} />
        {sample ? (
          <SampleStamp />
        ) : url ? (
          <div
            data-calendar-feed-credit=""
            style={{
              position: "absolute",
              bottom: 4,
              right: 6,
              fontFamily: "Arial, sans-serif",
              fontSize: 11,
              lineHeight: 1.2,
              padding: "2px 6px",
              background: "rgba(0,0,0,.7)",
              color: "#ffffff",
              pointerEvents: "none",
            }}
          >
            {status}
          </div>
        ) : (
          <ManualDataStamp height={480} />
        )}
      </div>
    );
  }
  ConnectedCalendar.displayName = `CalendarFeed(${Component.displayName || Component.name || "Design"})`;
  return ConnectedCalendar;
}
