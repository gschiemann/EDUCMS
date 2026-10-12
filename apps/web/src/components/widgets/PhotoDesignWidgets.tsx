"use client";

import { useState, type CSSProperties } from "react";
import type { ThemeWidgetProps } from "./themes/registry";

export type PhotoFit = "cover" | "contain";

export interface PhotoDesignPhoto {
  url: string;
  caption?: string;
  focalX?: number;
  focalY?: number;
  zoom?: number;
  fit?: PhotoFit;
}

export interface PhotoFrameConfig {
  frameShape?: "rounded" | "circle" | "arch";
  assetUrl?: string;
  imageUrl?: string;
  fit?: PhotoFit | string;
  fitMode?: PhotoFit | string;
  borderRadius?: number | string;
  borderWidth?: number;
  borderColor?: string;
  opacity?: number;
  focalX?: number;
  focalY?: number;
  zoom?: number;
  caption?: string;
}

export interface PhotoCollageConfig {
  photos?: PhotoDesignPhoto[];
  urls?: string[];
  layout?: "pair" | "featured" | "grid" | string;
  spacing?: number;
  backgroundColor?: string;
  showCaptions?: boolean;
  captionFont?: string;
  captionColor?: string;
}

const clamp = (value: unknown, min: number, max: number, fallback: number) => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};

/** Preserve every saved entry; legacy carousel URLs are promoted in order. */
export function normalizePhotoList(config: PhotoCollageConfig): PhotoDesignPhoto[] {
  const configured = Array.isArray(config.photos) ? config.photos : [];
  const legacy = Array.isArray(config.urls) ? config.urls : [];
  const count = Math.max(configured.length, legacy.length);
  return Array.from({ length: count }, (_, index) => {
    const photo = configured[index];
    const fallbackUrl = legacy[index];
    if (typeof photo === "string") return { url: photo };
    return {
      ...(photo || {}),
      url: typeof photo?.url === "string" && photo.url ? photo.url : (fallbackUrl || ""),
      focalX: clamp(photo?.focalX, 0, 100, 50),
      focalY: clamp(photo?.focalY, 0, 100, 50),
      zoom: clamp(photo?.zoom, 1, 3, 1),
      fit: photo?.fit === "contain" ? "contain" : "cover",
    };
  });
}

function Placeholder({ label = "Add a photo" }: { label?: string }) {
  return (
    <div
      aria-label={label}
      role="img"
      style={{
        width: "100%",
        height: "100%",
        minHeight: 56,
        display: "grid",
        placeItems: "center",
        color: "#64748b",
        background: "linear-gradient(145deg, #eef2f7, #dce4ee)",
        overflow: "hidden",
      }}
    >
      <svg aria-hidden="true" width="40" height="34" viewBox="0 0 40 34" fill="none">
        <rect x="2" y="2" width="36" height="30" rx="5" stroke="currentColor" strokeWidth="2" />
        <circle cx="13" cy="12" r="3" fill="currentColor" />
        <path d="m5 28 10-9 6 5 5-4 9 8" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      </svg>
      <span style={{ font: "600 11px/1.2 system-ui, sans-serif", marginTop: 5 }}>{label}</span>
    </div>
  );
}

function PhotoSurface({
  photo,
  alt,
  showCaption = true,
  captionColor = "#fff",
  captionFont,
}: {
  photo: PhotoDesignPhoto;
  alt: string;
  showCaption?: boolean;
  captionColor?: string;
  captionFont?: string;
}) {
  const [failedUrl, setFailedUrl] = useState("");
  const src = photo.url || "";
  const valid = src.length > 0 && failedUrl !== src;
  const fit = photo.fit === "contain" ? "contain" : "cover";
  const x = clamp(photo.focalX, 0, 100, 50);
  const y = clamp(photo.focalY, 0, 100, 50);
  const zoom = clamp(photo.zoom, 1, 3, 1);
  return (
    <div style={{ position: "relative", width: "100%", height: "100%", minHeight: 0, overflow: "hidden", background: "#e2e8f0" }}>
      {valid ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          onError={() => setFailedUrl(src)}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            objectFit: fit,
            objectPosition: `${x}% ${y}%`,
            transform: `scale(${zoom})`,
            transformOrigin: `${x}% ${y}%`,
            display: "block",
          }}
        />
      ) : <Placeholder label={src ? "Photo unavailable" : "Add a photo"} />}
      {showCaption && photo.caption?.trim() && (
        <div
          style={{
            position: "absolute",
            right: 0,
            bottom: 0,
            left: 0,
            padding: "0.65em 0.8em",
            color: captionColor,
            fontFamily: captionFont || "inherit",
            fontSize: "clamp(12px, 1.7em, 30px)",
            lineHeight: 1.2,
            fontWeight: 650,
            overflowWrap: "anywhere",
            background: "linear-gradient(transparent, rgba(8, 15, 26, .82))",
            textShadow: "0 1px 3px rgba(0,0,0,.7)",
          }}
        >
          {photo.caption}
        </div>
      )}
    </div>
  );
}

function FrameWidget({ config, shape = "rounded" }: ThemeWidgetProps & { shape?: "rounded" | "circle" | "arch" }) {
  const c: PhotoFrameConfig = config || {};
  const configuredShape = (config as PhotoFrameConfig | undefined)?.frameShape;
  if (configuredShape === "rounded" || configuredShape === "circle" || configuredShape === "arch") shape = configuredShape;
  const src = c.assetUrl || c.imageUrl || "";
  const numericRadius = clamp(c.borderRadius, 0, 1000, shape === "rounded" ? 20 : 0);
  const radius = shape === "circle" ? "50%" : shape === "arch" ? "50% 50% 8px 8px" : typeof c.borderRadius === "string" ? c.borderRadius : `${numericRadius}px`;
  const width = clamp(c.borderWidth, 0, 24, 6);
  const opacity = clamp(c.opacity, 0, 100, 100) / 100;
  const focalX = clamp(c.focalX, 0, 100, 50);
  const focalY = clamp(c.focalY, 0, 100, 50);
  const zoom = clamp(c.zoom, 1, 3, 1);
  const photo: PhotoDesignPhoto = {
    url: src,
    caption: c.caption,
    focalX,
    focalY,
    zoom,
    fit: c.fit === "contain" || c.fitMode === "contain" ? "contain" : "cover",
  };
  const style: CSSProperties = {
    width: "100%",
    height: "100%",
    minWidth: 0,
    minHeight: 0,
    padding: width,
    opacity,
    borderRadius: radius,
    border: `${width}px solid ${c.borderColor || "#d4af72"}`,
    background: "#f7f1e7",
    boxShadow: "0 10px 26px rgba(27, 31, 39, .2), inset 0 0 0 1px rgba(255,255,255,.85)",
    boxSizing: "border-box",
    overflow: "hidden",
  };
  return (
    <div data-photo-frame={shape} style={style}>
      <div style={{ width: "100%", height: "100%", overflow: "hidden", borderRadius: `max(0px, calc(${typeof radius === "number" ? `${radius}px` : radius} - ${width}px))` }}>
        <PhotoSurface photo={photo} alt={c.caption || "Framed photo"} />
      </div>
    </div>
  );
}

export function PhotoFrameWidget(props: ThemeWidgetProps) {
  return <FrameWidget {...props} />;
}

export function PhotoFrameCircleWidget(props: ThemeWidgetProps) {
  return <FrameWidget {...props} shape="circle" />;
}

export function PhotoFrameArchWidget(props: ThemeWidgetProps) {
  return <FrameWidget {...props} shape="arch" />;
}

export function PhotoCollageWidget({ config }: ThemeWidgetProps) {
  const c: PhotoCollageConfig = config || {};
  const photos = normalizePhotoList(c);
  const layout = c.layout === "featured" || c.layout === "grid" ? c.layout : "pair";
  const gap = clamp(c.spacing, 0, 64, 12);
  const base: CSSProperties = {
    display: "grid",
    width: "100%",
    height: "100%",
    minWidth: 0,
    minHeight: 0,
    boxSizing: "border-box",
    gap,
    padding: gap,
    overflow: "hidden",
    background: c.backgroundColor || "#f3eee5",
  };
  let gridStyle: CSSProperties = { ...base, gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gridTemplateRows: "repeat(auto-fit, minmax(0, 1fr))" };
  let featureIndex = -1;
  if (layout === "featured" && photos.length > 1) {
    featureIndex = 0;
    gridStyle = { ...base, gridTemplateColumns: "minmax(0, 1.25fr) minmax(0, 1fr)", gridTemplateRows: `repeat(${Math.max(1, Math.ceil((photos.length - 1) / 2))}, minmax(0, 1fr))` };
  } else if (layout === "grid") {
    gridStyle = { ...base, gridTemplateColumns: "repeat(auto-fit, minmax(min(44%, 180px), 1fr))", gridTemplateRows: "repeat(auto-fit, minmax(0, 1fr))" };
  }
  return (
    <div data-photo-collage data-layout={layout} data-photo-count={photos.length} style={gridStyle}>
      {photos.length === 0 ? (
        <div style={{ gridColumn: "1 / -1", minHeight: 0, overflow: "hidden", borderRadius: 10 }}><Placeholder label="Add photos to build a collage" /></div>
      ) : photos.map((photo, index) => (
        <div
          key={`${index}:${photo.url}`}
          data-photo-index={index}
          style={{
            minWidth: 0,
            minHeight: 0,
            overflow: "hidden",
            borderRadius: 7,
            background: "#e2e8f0",
            boxShadow: "0 3px 12px rgba(18, 25, 38, .14)",
            ...(index === featureIndex ? { gridRow: "1 / span 2" } : {}),
          }}
        >
          <PhotoSurface photo={photo} alt={photo.caption || `Collage photo ${index + 1}`} showCaption={c.showCaptions !== false} captionColor={c.captionColor || "#fff"} captionFont={c.captionFont} />
        </div>
      ))}
    </div>
  );
}
