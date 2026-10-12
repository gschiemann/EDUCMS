"use client";

import type { ReactNode } from "react";
import { normalizePhotoList, type PhotoCollageConfig, type PhotoDesignPhoto, type PhotoFit, type PhotoFrameConfig } from "../widgets/PhotoDesignWidgets";

export interface PhotoAssetPickerProps {
  label: string;
  value: string;
  onChange: (url: string) => void;
  photoIndex?: number;
}

export interface PhotoDesignFieldsProps {
  config: PhotoFrameConfig | PhotoCollageConfig | Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
  /** Render the existing asset library/picker here; users should never need to paste URLs. */
  renderAssetPicker?: (props: PhotoAssetPickerProps) => ReactNode;
  /** Inject the existing shared font selector instead of maintaining a second catalog. */
  renderFontPicker?: (props: { label: string; value: string; onChange: (font: string) => void }) => ReactNode;
  mode?: "frame" | "collage";
  frameShape?: "rounded" | "circle" | "arch";
}

const fieldStyle = { width: "100%", boxSizing: "border-box" as const, border: "1px solid #cbd5e1", borderRadius: 7, padding: "7px 8px", font: "inherit", fontSize: 12, color: "#172033", background: "white" };
const labelStyle = { display: "grid", gap: 4, minWidth: 0, color: "#475569", fontSize: 11, fontWeight: 650 };
const sectionStyle = { display: "grid", gap: 9, padding: "10px 0", borderBottom: "1px solid #e2e8f0" };

function NumericField({ label, value, min, max, step = 1, onChange, suffix }: { label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void; suffix?: string }) {
  return <label style={labelStyle}>{label}<span style={{ display: "flex", alignItems: "center", gap: 6 }}><input aria-label={label} type="number" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Math.min(max, Math.max(min, Number(event.target.value) || min)))} style={fieldStyle} />{suffix}</span></label>;
}

function FitSelect({ value, onChange, label = "Fit" }: { value?: string; onChange: (fit: PhotoFit) => void; label?: string }) {
  return <label style={labelStyle}>{label}<select aria-label={label} value={value === "contain" ? "contain" : "cover"} onChange={(event) => onChange(event.target.value as PhotoFit)} style={fieldStyle}><option value="cover">Fill frame</option><option value="contain">Fit whole photo</option></select></label>;
}

function ImagePicker({ label, value, onChange, photoIndex, renderAssetPicker }: PhotoAssetPickerProps & { renderAssetPicker?: PhotoDesignFieldsProps["renderAssetPicker"] }) {
  if (renderAssetPicker) return <>{renderAssetPicker({ label, value, onChange, photoIndex })}</>;
  return <div role="group" aria-label={label} style={{ display: "grid", gap: 4, color: "#475569", fontSize: 11, fontWeight: 650 }}>
    <span>{label}</span>
    <span style={{ fontSize: 11, fontWeight: 500, overflowWrap: "anywhere" }}>{value || "No photo selected"}</span>
    <span style={{ fontSize: 10, color: "#64748b", fontWeight: 400 }}>Connect the photo library picker in the editor to choose or replace this image.</span>
  </div>;
}

function FramingFields({ photo, onPatch, prefix = "Photo" }: { photo: PhotoDesignPhoto; onPatch: (patch: Partial<PhotoDesignPhoto>) => void; prefix?: string }) {
  return <div style={{ display: "grid", gap: 8 }}>
    <FitSelect value={photo.fit} onChange={(fit) => onPatch({ fit })} label={`${prefix} fit`} />
    <label style={labelStyle}>{prefix} horizontal framing <input aria-label={`${prefix} horizontal framing`} type="range" min={0} max={100} value={photo.focalX ?? 50} onChange={(event) => onPatch({ focalX: Number(event.target.value) })} /><span style={{ fontSize: 10, fontWeight: 400 }}>{photo.focalX ?? 50}%</span></label>
    <label style={labelStyle}>{prefix} vertical framing <input aria-label={`${prefix} vertical framing`} type="range" min={0} max={100} value={photo.focalY ?? 50} onChange={(event) => onPatch({ focalY: Number(event.target.value) })} /><span style={{ fontSize: 10, fontWeight: 400 }}>{photo.focalY ?? 50}%</span></label>
    <label style={labelStyle}>{prefix} zoom <input aria-label={`${prefix} zoom`} type="range" min={1} max={3} step={0.05} value={photo.zoom ?? 1} onChange={(event) => onPatch({ zoom: Number(event.target.value) })} /><span style={{ fontSize: 10, fontWeight: 400 }}>{(photo.zoom ?? 1).toFixed(2)}×</span></label>
    <button type="button" onClick={() => onPatch({ focalX: 50, focalY: 50, zoom: 1 })} style={{ justifySelf: "start", border: 0, background: "transparent", padding: "3px 0", color: "#4f46e5", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Reset framing</button>
  </div>;
}

function ColorField({ label, value, onChange, fallback }: { label: string; value?: string; fallback: string; onChange: (value: string) => void }) {
  const color = /^#[0-9a-f]{6}$/i.test(value || "") ? value! : fallback;
  return <label style={labelStyle}>{label}<span style={{ display: "flex", gap: 8, alignItems: "center" }}><input aria-label={label} type="color" value={color} onChange={(event) => onChange(event.target.value)} style={{ width: 34, height: 28, padding: 1, border: "1px solid #cbd5e1", borderRadius: 5 }} /><input aria-label={`${label} hex`} value={value || fallback} onChange={(event) => onChange(event.target.value)} style={fieldStyle} /></span></label>;
}

export function PhotoDesignFields({ config, onChange, renderAssetPicker, renderFontPicker, mode, frameShape }: PhotoDesignFieldsProps) {
  const c = config || {};
  const collageMode = mode === "collage" || (!mode && (Array.isArray((c as PhotoCollageConfig).photos) || Array.isArray((c as PhotoCollageConfig).urls)));
  if (!collageMode) {
    const frame = c as PhotoFrameConfig;
    const photo: PhotoDesignPhoto = {
      url: frame.assetUrl || frame.imageUrl || "",
      caption: frame.caption || "",
      fit: (frame.fit || frame.fitMode) === "contain" ? "contain" : "cover",
      focalX: frame.focalX ?? 50,
      focalY: frame.focalY ?? 50,
      zoom: frame.zoom ?? 1,
    };
    return <div style={{ display: "grid", gap: 1, minWidth: 0 }}>
      <section style={sectionStyle} aria-label="Photo source and framing">
        <ImagePicker label="Photo" value={photo.url} renderAssetPicker={renderAssetPicker} onChange={(url) => onChange({ assetUrl: url, imageUrl: url })} />
        <label style={labelStyle}>Caption<input aria-label="Photo caption" value={photo.caption} onChange={(event) => onChange({ caption: event.target.value })} style={fieldStyle} /></label>
        <FramingFields photo={photo} onPatch={(patch) => onChange(patch)} />
        {renderFontPicker && renderFontPicker({ label: "Caption font", value: frame.captionFont || "Inter, sans-serif", onChange: captionFont => onChange({ captionFont }) })}
        <NumericField label="Caption size" min={12} max={240} value={Number(frame.captionFontSize ?? 60)} suffix="px" onChange={captionFontSize => onChange({ captionFontSize })} />
      </section>
      <section style={sectionStyle} aria-label="Frame appearance">
        <label style={labelStyle}>Frame shape<select aria-label="Frame shape" value={frame.frameShape || frameShape || "rounded"} onChange={(event) => onChange({ frameShape: event.target.value })} style={fieldStyle}><option value="rounded">Rounded</option><option value="circle">Circle</option><option value="arch">Arch</option></select></label>
        <NumericField label="Border width" min={0} max={24} value={Number(frame.borderWidth ?? 0)} suffix="px" onChange={(borderWidth) => onChange({ borderWidth })} />
        <ColorField label="Border color" value={frame.borderColor} fallback="#d4af72" onChange={(borderColor) => onChange({ borderColor })} />
        <label style={labelStyle}>Opacity <input aria-label="Opacity" type="range" min={0} max={100} value={Number(frame.opacity ?? 100)} onChange={(event) => onChange({ opacity: Number(event.target.value) })} /><span style={{ fontSize: 10, fontWeight: 400 }}>{Number(frame.opacity ?? 100)}%</span></label>
      </section>
    </div>;
  }

  const collage = c as PhotoCollageConfig;
  const photos = normalizePhotoList(collage);
  const patchPhoto = (index: number, patch: Partial<PhotoDesignPhoto>) => {
    const next = photos.map((photo, photoIndex) => photoIndex === index ? { ...photo, ...patch } : photo);
    onChange({ photos: next });
  };
  const addPhoto = () => {
    if (photos.length < 4) onChange({ photos: [...photos, { url: "", caption: "", fit: "cover", focalX: 50, focalY: 50, zoom: 1 }] });
  };
  const movePhoto = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= photos.length) return;
    const next = [...photos];
    [next[index], next[target]] = [next[target], next[index]];
    onChange({ photos: next });
  };
  return <div style={{ display: "grid", gap: 1, minWidth: 0 }}>
    <section style={sectionStyle} aria-label="Collage layout">
      <label style={labelStyle}>Layout<select aria-label="Collage layout" value={collage.layout === "featured" || collage.layout === "grid" ? collage.layout : "pair"} onChange={(event) => onChange({ layout: event.target.value })} style={fieldStyle}><option value="pair">Photo pair</option><option value="featured">Featured photo</option><option value="grid">Photo grid</option></select></label>
      <NumericField label="Photo spacing" min={0} max={64} value={Number(collage.spacing ?? 12)} suffix="px" onChange={(spacing) => onChange({ spacing })} />
      <ColorField label="Collage background" value={collage.backgroundColor} fallback="#f3eee5" onChange={(backgroundColor) => onChange({ backgroundColor })} />
      <label style={labelStyle}>Caption font{renderFontPicker ? renderFontPicker({ label: "Caption font", value: collage.captionFont || "", onChange: (captionFont) => onChange({ captionFont }) }) : <input aria-label="Caption font" value={collage.captionFont || ""} onChange={(event) => onChange({ captionFont: event.target.value })} style={fieldStyle} />}</label>
      <NumericField label="Caption size" min={12} max={240} value={Number(collage.captionFontSize ?? 60)} suffix="px" onChange={captionFontSize => onChange({ captionFontSize })} />
      <ColorField label="Caption color" value={collage.captionColor} fallback="#ffffff" onChange={(captionColor) => onChange({ captionColor })} />
      <label style={{ display: "flex", alignItems: "center", gap: 8, color: "#475569", fontSize: 11, fontWeight: 650 }}><input type="checkbox" checked={collage.showCaptions !== false} onChange={(event) => onChange({ showCaptions: event.target.checked })} />Show captions</label>
      <div style={{ color: "#64748b", fontSize: 10 }} aria-live="polite">{photos.length} {photos.length === 1 ? "photo" : "photos"} shown together{photos.length > 4 ? ` · ${photos.length} saved photos are kept and editable` : ""}</div>
    </section>
    <section style={sectionStyle} aria-label="Collage photos">
      {photos.map((photo, index) => <fieldset key={`${index}:${photo.url}`} style={{ display: "grid", gap: 9, minWidth: 0, margin: 0, padding: "9px 0", border: 0, borderTop: "1px solid #e2e8f0" }}>
        <legend style={{ padding: 0, color: "#0f172a", fontSize: 12, fontWeight: 750 }}>Photo {index + 1}</legend>
        <ImagePicker label={`Photo ${index + 1} image`} value={photo.url} photoIndex={index} renderAssetPicker={renderAssetPicker} onChange={(url) => patchPhoto(index, { url })} />
        <label style={labelStyle}>Photo {index + 1} caption<input aria-label={`Photo ${index + 1} caption`} value={photo.caption || ""} onChange={(event) => patchPhoto(index, { caption: event.target.value })} style={fieldStyle} /></label>
        <FramingFields prefix={`Photo ${index + 1}`} photo={photo} onPatch={(patch) => patchPhoto(index, patch)} />
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" aria-label={`Move photo ${index + 1} earlier`} disabled={index === 0} onClick={() => movePhoto(index, -1)} style={actionStyle(index === 0)}>Move earlier</button>
          <button type="button" aria-label={`Move photo ${index + 1} later`} disabled={index === photos.length - 1} onClick={() => movePhoto(index, 1)} style={actionStyle(index === photos.length - 1)}>Move later</button>
          <button type="button" aria-label={`Remove photo ${index + 1}`} onClick={() => onChange({ photos: photos.filter((_, photoIndex) => photoIndex !== index) })} style={{ ...actionStyle(false), color: "#b91c1c" }}>Remove</button>
        </div>
      </fieldset>)}
      {photos.length < 4 ? <button type="button" onClick={addPhoto} style={{ ...actionStyle(false), justifySelf: "start", color: "#4338ca" }}>＋ Add photo ({photos.length}/4)</button> : <div style={{ color: "#64748b", fontSize: 10 }} aria-live="polite">New collages support up to four photos. All saved photos remain visible and editable.</div>}
      {photos.length === 0 && <div style={{ color: "#64748b", fontSize: 11 }}>Add up to four photos. They appear together in the canvas.</div>}
    </section>
  </div>;
}

function actionStyle(disabled: boolean) {
  return { border: "1px solid #cbd5e1", borderRadius: 6, background: disabled ? "#f8fafc" : "white", color: disabled ? "#94a3b8" : "#334155", padding: "5px 7px", fontSize: 10, fontWeight: 650, cursor: disabled ? "default" : "pointer" } as const;
}

export type { PhotoCollageConfig, PhotoDesignPhoto, PhotoFrameConfig };
