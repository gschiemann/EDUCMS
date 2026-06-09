/**
 * Shared types for the Import 2.0 structured-parsing pipeline.
 *
 * A parser turns an uploaded document (PPTX / PDF) into one or more
 * `ParsedPage`s, each carrying real, editable builder zones. The
 * controller then persists each page as a Template whose TemplateZones
 * map 1:1 to `ParsedZone`s — TEXT widgets for text, IMAGE widgets for
 * pictures — so the result opens editable in the V2 builder exactly
 * like any other template (NOT a flattened picture).
 *
 * Coordinates are ALWAYS percentages (0–100) of the page canvas, the
 * same contract every TemplateZone uses. The parsers convert from the
 * document's native units (EMU for PPTX, PDF user-space points for
 * PDF) into those percentages so nothing downstream needs to know
 * about the source format.
 */

/** A picture extracted from a document, to be uploaded as an Asset. */
export interface ExtractedMedia {
  /** Stable per-document id the zone references (e.g. 'media-0'). */
  id: string;
  /** Raw bytes of the image. */
  data: Buffer;
  /** MIME type derived from the embedded part's extension / signature. */
  mimeType: string;
  /** Original filename inside the archive (sanitized), for the asset name. */
  name: string;
}

/** A single editable zone on a page — maps to one TemplateZone. */
export interface ParsedZone {
  /** Display name shown in the builder layer list. */
  name: string;
  /** Builder widget type. Import 2.0 emits only TEXT and IMAGE. */
  widgetType: 'TEXT' | 'IMAGE';
  /** %-of-canvas geometry (0–100), clamped to the canvas. */
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  /**
   * Widget defaultConfig. For TEXT this carries `content`, `fontSize`
   * (px), `fontFamily`, `color`, `alignment`, `bold`, `lineHeight` —
   * the exact keys TextWidget reads. For IMAGE it carries either a
   * resolved `assetUrl` (set by the controller after upload) or a
   * `mediaRef` placeholder the controller resolves.
   */
  defaultConfig: Record<string, unknown>;
  /**
   * When set, this IMAGE zone references an `ExtractedMedia.id`; the
   * controller uploads that media and rewrites defaultConfig.assetUrl
   * to the resulting Asset URL before persisting.
   */
  mediaRef?: string;
}

/** One page/slide → one Template. */
export interface ParsedPage {
  /** Suggested template name suffix, e.g. 'Slide 1' or 'Page 3'. */
  label: string;
  /** Canvas width in px (rounded). */
  screenWidth: number;
  /** Canvas height in px (rounded). */
  screenHeight: number;
  /** Optional page background color (hex), if the document declares one. */
  bgColor?: string;
  /** The editable zones, in paint order. */
  zones: ParsedZone[];
}

/** The full result of parsing a document. */
export interface ParsedDocument {
  pages: ParsedPage[];
  /** All pictures referenced by any page's zones (mediaRef). */
  media: ExtractedMedia[];
}
