"use client";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useElementSize } from "./v2/_shared/useElementSize";
import { usePolledFeed } from "./use-live-feed";
import {
  NEWSROOM_PALETTES,
  NEWSROOM_SCOPES,
  balanceNews,
  newsroomScopes,
  type NewsArticle,
  type NewsResult,
  type NewsScope,
} from "./newsroom-model";
import { toCssTextStyle } from "./text-style-contract";
import "./newsroom.css";

const API_BASE = (
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080/api/v1"
).replace(/\/api\/v1\/?$/, "");
function useChannel(
  scope: NewsScope,
  active: boolean,
  location: string,
  sources: string,
  delay: number,
) {
  return usePolledFeed<NewsResult>(
    active,
    () =>
      `${API_BASE}/api/v1/feeds/news?scope=${scope}&location=${encodeURIComponent(location)}&sources=${encodeURIComponent(sources)}`,
    600000,
    3600000,
    45000,
    delay,
  );
}
function fieldStyle(config: Record<string, any>, field: string): CSSProperties {
  const {
    hidden,
    offsetX: _x,
    offsetY: _y,
    ...style
  } = toCssTextStyle(config._styles?.[field]);
  return {
    ...style,
    ...(hidden ? { visibility: "hidden" } : {}),
  } as CSSProperties;
}
function Story({
  item,
  lead,
  config,
}: {
  item: NewsArticle;
  lead?: boolean;
  config: Record<string, any>;
}) {
  return (
    <article className={`nr-story${lead ? " nr-lead" : ""}`}>
      <div className="nr-kicker">
        {NEWSROOM_SCOPES.find((s) => s[0] === item.scope)?.[1]}{" "}
        <span> / {item.publisher}</span>
      </div>
      <a
        href={item.link}
        target="_blank"
        rel="noopener noreferrer"
        className="nr-headline"
        data-field-jump="headline"
        style={fieldStyle(config, "headline")}
      >
        {item.title}
      </a>
      <div className="nr-indexed">
        Indexed{" "}
        {new Date(item.indexedAt).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        })}{" "}
        ·{" "}
        {new Date(item.indexedAt).toLocaleTimeString(undefined, {
          hour: "numeric",
          minute: "2-digit",
        })}
      </div>
    </article>
  );
}
export function NewsroomWidget({
  config = {},
  previewData,
}: {
  config?: Record<string, any>;
  /** Local review harness only, never read from saved zone config. */ previewData?: NewsResult[];
}) {
  const scopes = newsroomScopes(config.coverage);
  const location = String(config.newsLocation || "94583").trim();
  const sources = Array.isArray(config.publishers)
    ? config.publishers
        .filter(
          (s: unknown) =>
            typeof s === "string" && /^[a-z0-9.-]+$/.test(s as string),
        )
        .slice(0, 8)
        .sort()
        .join(",")
    : "";
  // Fixed hook order; stagger cold loads to respect GDELT's shared request pace.
  const local = useChannel(
    "local",
    !previewData && scopes.includes("local"),
    location,
    sources,
    0,
  );
  const national = useChannel(
    "national",
    !previewData && scopes.includes("national"),
    "",
    sources,
    7000,
  );
  const world = useChannel(
    "world",
    !previewData && scopes.includes("world"),
    "",
    sources,
    14000,
  );
  const feeds = [local, national, world];
  const data = (
    previewData || feeds.map((f) => f.data).filter((d): d is NewsResult => !!d)
  ).filter((d) => scopes.includes(d.scope));
  const items = balanceNews(data);
  const [index, setIndex] = useState(0);
  const seconds = Math.max(5, Math.min(120, Number(config.intervalSec) || 12));
  const banner = config.newsLayout === "banner";
  const identity = items.map((a) => a.link).join("|");
  useEffect(() => {
    setIndex(0);
    if (banner) return;
    const timer = setInterval(() => {
      if (!document.hidden) setIndex((i) => i + 1);
    }, seconds * 1000);
    return () => clearInterval(timer);
  }, [seconds, identity, banner]); // perf-allow: visible signage headline rotation, >=5s.
  const { ref, width, height } = useElementSize<HTMLDivElement>();
  const w = width || 1920,
    h = height || 1080;
  const portrait = h > w * 1.1;
  const requested =
    config.newsLayout in NEWSROOM_PALETTES
      ? (config.newsLayout as keyof typeof NEWSROOM_PALETTES)
      : "front-page";
  const layout =
    requested === "banner" ? "banner" : h < w / 4 ? "ribbon" : requested;
  const palette = NEWSROOM_PALETTES[layout];
  const font =
    Math.max(
      10,
      Math.min(
        w / (portrait ? 20 : 42),
        h /
          (portrait ? 55 : layout === "ribbon" || layout === "banner" ? 7 : 32),
      ),
    ) * Math.max(0.6, Math.min(1.6, Number(config.textScale) || 1));
  const base: CSSProperties = {
    width: "100%",
    height: "100%",
    fontSize: font,
    color: config.textColor || config.style?.textColor || palette.text,
    background: "transparent",
    fontFamily: config.style?.fontFamily || "Arial, sans-serif",
    "--nr-accent": config.accentColor || palette.accent,
  } as CSSProperties;
  const current = items.length ? items[index % items.length] : null;
  const following = Array.from(
    { length: Math.min(portrait ? 2 : 3, Math.max(0, items.length - 1)) },
    (_, i) => items[(index + i + 1) % items.length],
  );
  const loading =
    !previewData &&
    feeds.some((f, i) => scopes.includes(NEWSROOM_SCOPES[i][0]) && f.loading);
  const missing = scopes.filter(
    (scope) => !data.some((d) => d.scope === scope && d.items.length),
  );
  const anyError =
    !previewData &&
    feeds.some((f, i) => scopes.includes(NEWSROOM_SCOPES[i][0]) && f.error);
  const newestFetch = data.reduce(
    (last, d) => Math.max(last, Date.parse(d.fetchedAt) || 0),
    0,
  );
  const stale = data.some(
    (d) => d.stale || Date.now() - Date.parse(d.fetchedAt) > 20 * 60000,
  );
  const status = previewData
    ? "Captured preview · not live"
    : !scopes.length
      ? "Choose coverage"
      : anyError || stale
        ? "Updates delayed"
        : loading
          ? "Updating feeds"
          : missing.length || data.some((d) => d.limited)
            ? "Limited coverage"
            : "Updated";
  const place = data.find((d) => d.scope === "local")?.location || location;
  const scrollWindow = useRef<HTMLDivElement>(null);
  const scrollLine = useRef<HTMLDivElement>(null);
  const [crawl, setCrawl] = useState({ start: 0, end: -1000, seconds: 20 });
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const update = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", update);
    update();
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  useLayoutEffect(() => {
    if (!banner || !scrollWindow.current || !scrollLine.current) return;
    const start = 0,
      end = -(scrollLine.current.firstElementChild as HTMLElement)?.scrollWidth;
    const divisor =
      config.scrollSpeed === "slow"
        ? 22
        : config.scrollSpeed === "fast"
          ? 9
          : 14;
    setCrawl({
      start,
      end,
      seconds: Math.max(5, (start - end) / Math.max(25, w / divisor)),
    });
  }, [banner, identity, w, h, font, config.scrollSpeed, config._styles]);

  return (
    <div
      ref={ref}
      className={`newsroom nr-${layout}${portrait ? " nr-portrait" : ""}`}
      data-newsroom
      data-layout={layout}
      style={base}
    >
      <div
        aria-hidden
        className="nr-surface"
        style={{
          background:
            config.bgColor || config.style?.bgColor || palette.background,
          opacity:
            Math.max(
              0,
              Math.min(100, Number(config.backgroundOpacity ?? 100)),
            ) / 100,
        }}
      />
      <header className="nr-masthead">
        <div>
          <div className="nr-edition">
            {scopes.includes("local") ? place : "Newsroom"}{" "}
            <span> / {config.strapline ?? "Your world. In focus."}</span>
          </div>
          <div
            key={`${config.title ?? "The Daily Brief"}:${layout}`}
            className="nr-title"
            data-field="title"
            style={fieldStyle(config, "title")}
          >
            {config.title ?? "The Daily Brief"}
          </div>
          <a
            className="nr-compact-credit"
            href="https://www.gdeltproject.org/"
            target="_blank"
            rel="noopener noreferrer"
          >
            {status} · GDELT Project
          </a>
        </div>
        <div className="nr-status">
          {status}
          {newestFetch > 0 ? (
            <span>
              Fetched{" "}
              {new Date(newestFetch).toLocaleTimeString(undefined, {
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
          ) : null}
        </div>
      </header>
      {current ? (
        <main className="nr-content">
          {layout === "banner" ? (
            <div ref={scrollWindow} className="nr-scroll-window">
              <div
                key={identity}
                ref={scrollLine}
                className="nr-scroll-line"
                style={
                  {
                    "--nr-scroll-start": `${crawl.start}px`,
                    "--nr-scroll-end": `${crawl.end}px`,
                    animationDuration: `${crawl.seconds}s`,
                    animationPlayState: hidden ? "paused" : "running",
                  } as CSSProperties
                }
              >
                {[0, 1].map((copy) => (
                  <div
                    key={copy}
                    className="nr-scroll-group"
                    aria-hidden={copy === 1 ? true : undefined}
                  >
                    {(items.length >= 3
                      ? items
                      : Array.from(
                          { length: 3 },
                          (_, i) => items[i % items.length],
                        )
                    ).map((item, i) => (
                      <span
                        className="nr-scroll-story"
                        key={`${item.link}:${i}`}
                      >
                        <span className="nr-scroll-source">
                          {
                            NEWSROOM_SCOPES.find(
                              (s) => s[0] === item.scope,
                            )?.[1]
                          }{" "}
                          / {item.publisher}
                        </span>
                        <a
                          className="nr-headline"
                          data-field-jump="headline"
                          style={fieldStyle(config, "headline")}
                          href={item.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          tabIndex={copy === 1 ? -1 : undefined}
                        >
                          {item.title}
                        </a>
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ) : layout === "briefing" ? (
            <div className="nr-columns">
              {scopes.map((scope) => {
                const stories = items.filter((a) => a.scope === scope);
                const start = stories.length ? index % stories.length : 0;
                return (
                  <section className="nr-channel" key={scope}>
                    <h2>{NEWSROOM_SCOPES.find((s) => s[0] === scope)?.[1]}</h2>
                    {stories.length ? (
                      [
                        stories[start],
                        ...(stories.length > 1
                          ? [stories[(start + 1) % stories.length]]
                          : []),
                      ].map((a) => (
                        <Story key={a.link} item={a} config={config} />
                      ))
                    ) : (
                      <p className="nr-empty">
                        {loading
                          ? "Loading this edition…"
                          : "No recent stories available"}
                      </p>
                    )}
                  </section>
                );
              })}
            </div>
          ) : (
            <>
              <Story item={current} lead config={config} />
              {layout !== "ribbon" && following.length > 0 ? (
                <aside className="nr-secondary">
                  <div className="nr-section-label">Also in the briefing</div>
                  {following.map((a) => (
                    <Story key={a.link} item={a} config={config} />
                  ))}
                </aside>
              ) : null}
            </>
          )}
        </main>
      ) : (
        <main className="nr-empty" role="status">
          <div>
            {!scopes.length
              ? "Select local, national or international coverage."
              : loading
                ? "Gathering your headlines…"
                : "News temporarily unavailable"}
          </div>
          <p>
            {loading
              ? "The first edition can take a moment. Headlines refresh automatically."
              : "We’ll retry automatically. No sample headlines are shown as live news."}
          </p>
        </main>
      )}
      <footer className="nr-footer">
        <a
          href="https://www.gdeltproject.org/"
          target="_blank"
          rel="noopener noreferrer"
        >
          Data: GDELT Project · Publisher links credited
        </a>
        <span>
          {missing.length && current
            ? `Awaiting: ${missing.map((s) => NEWSROOM_SCOPES.find((v) => v[0] === s)?.[1]).join(", ")} · `
            : ""}
          {items.length
            ? `${(index % items.length) + 1} / ${items.length}`
            : ""}
          {items.length ? " · " : ""}Refreshes every 10 min
        </span>
      </footer>
    </div>
  );
}
