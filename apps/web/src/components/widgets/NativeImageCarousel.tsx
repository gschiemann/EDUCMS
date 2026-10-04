"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import { sceneCss } from './scene-css';

/** The IMAGE_CAROUSEL media renderer, shared by native zones and HTML boards. */
type NativeCarouselConfig = {
  urls: string[];
  intervalMs?: number;
  transition?: string;
  fitMode?: string;
  objectPosition?: string;
  alt?: string;
  paused?: boolean;
  showIndicators?: boolean;
  noEntrance?: boolean;
  onFirstImageReady?: () => void;
};

export function NativeImageCarousel({
  config,
}: {
  config: NativeCarouselConfig;
}) {
  return <ImageCarouselPlayback key={config.urls.join("\n")} config={config} />;
}

function ImageCarouselPlayback({ config }: { config: NativeCarouselConfig }) {
  const { urls } = config;
  const [frame, setFrame] = useState({ step: 0, previous: 0 });
  const interval = Math.max(1000, Number(config.intervalMs) || 5000);
  const sequence = urls.join("\n");
  const slideUrls = useMemo(
    () => (sequence ? sequence.split("\n") : []),
    [sequence],
  );
  const cache = useRef(new Map<string, Promise<boolean>>());
  const ready = useCallback((url: string) => {
    const cached = cache.current.get(url);
    if (cached) return cached;
    const loading = new Promise<boolean>((resolve) => {
      const image = new Image();
      image.onerror = () => resolve(false);
      image.onload = () => {
        // Loaded bytes alone are not a decoded frame on older devices.
        if (typeof image.decode === "function")
          image.decode().then(
            () => resolve(true),
            () => resolve(image.naturalWidth > 0),
          );
        else resolve(true);
      };
      image.src = url;
    });
    cache.current.set(url, loading);
    return loading;
  }, []);
  // Warm the first two slides only (2026-10-04). Decoding EVERY slide at mount
  // asked a 1–2 GB player for one full bitmap per photo at once (a 30-photo
  // carousel of 4K uploads is ~1 GB of decoded pixels). The timer below already
  // decodes the next slide before it flips to it, so nothing undecoded is shown.
  useEffect(() => {
    slideUrls.slice(0, 2).forEach((url) => {
      void ready(url);
    });
  }, [slideUrls, ready]);
  useEffect(() => {
    if (slideUrls.length < 2 || config.paused) return;
    let cancelled = false;
    let loading = false;
    const timer = setInterval(async () => {
      if (loading) return;
      loading = true;
      for (let offset = 1; offset < slideUrls.length; offset++) {
        const next = frame.step + offset;
        const decoded = await ready(slideUrls[next % slideUrls.length]);
        if (cancelled) return;
        if (decoded) {
          setFrame({ step: next, previous: frame.step });
          break;
        }
      }
      loading = false;
    }, interval);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [slideUrls, frame.step, interval, config.paused, ready]);

  if (!urls.length) return null;
  const step = frame.step;
  const index = step % urls.length;
  const previous = frame.previous % urls.length;
  const transition = config.transition || "fade";
  const fit =
    config.fitMode === "stretch" ? "fill" : config.fitMode || "contain";
  const imageStyle: CSSProperties = {
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    objectFit: fit as CSSProperties["objectFit"],
    objectPosition: config.objectPosition || "center",
  };
  const animated =
    transition !== "cut" &&
    transition !== "none" &&
    !(step === 0 && config.noEntrance);
  return (
    <div
      data-native-image-carousel
      data-carousel-index={index}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        overflow: "hidden",
      }}
    >
      <style>{sceneCss(`
        @keyframes cms-native-carousel-fade { from {opacity:0} to {opacity:1} }
        @keyframes cms-native-carousel-out { from {opacity:1} to {opacity:0} }
        @keyframes cms-native-carousel-slide-left { from {transform:translateX(100%);opacity:0} to {transform:none;opacity:1} }
        @keyframes cms-native-carousel-slide-right { from {transform:translateX(-100%);opacity:0} to {transform:none;opacity:1} }
        @keyframes cms-native-carousel-slide-up { from {transform:translateY(100%);opacity:0} to {transform:none;opacity:1} }
        @keyframes cms-native-carousel-zoom { from {transform:scale(.92);opacity:0} to {transform:none;opacity:1} }
        @media (prefers-reduced-motion:reduce) { [data-native-image-carousel] img { animation:none !important; } }
      `)}</style>
      {/* The outgoing image remains underneath so fade is a crossfade. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={`previous:${step}`}
        src={urls[previous]}
        alt=""
        aria-hidden="true"
        style={{
          ...imageStyle,
          opacity: 0,
          ...(step > 0 && animated
            ? {
                animation:
                  "cms-native-carousel-out 600ms cubic-bezier(.22,1,.36,1) both",
              }
            : {}),
        }}
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={`${sequence}:${step}`}
        src={urls[index]}
        alt={config.alt || ""}
        onLoad={step === 0 ? config.onFirstImageReady : undefined}
        style={{
          ...imageStyle,
          ...(animated
            ? {
                animation: `cms-native-carousel-${transition === "slide" ? "slide-left" : transition} 600ms cubic-bezier(.22,1,.36,1) both`,
              }
            : {}),
        }}
      />
      {config.showIndicators !== false && urls.length > 1 && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            bottom: "5%",
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
          }}
        >
          {urls.map((_, i) => (
            <div
              key={i}
              style={{
                width: 6,
                height: 6,
                marginLeft: i === 0 ? 0 : 4,
                borderRadius: 99,
                background: i === index ? "white" : "rgba(255,255,255,.4)",
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
