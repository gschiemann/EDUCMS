/**
 * PPTX parser — the HIGH-FIDELITY Import 2.0 path.
 *
 * A .pptx is a ZIP of XML (OOXML / PresentationML). Every shape carries
 * an EXPLICIT position + size in EMU, and text runs carry font size,
 * color, bold, and alignment. We map each slide to a `ParsedPage` whose
 * zones are real, editable builder zones:
 *   - text boxes  → TEXT  widgets (content + fontSize + color + weight
 *                   + alignment, positioned by % of the slide canvas)
 *   - pictures    → IMAGE widgets (the embedded ppt/media/* bytes get
 *                   uploaded as Assets by the controller; the zone is
 *                   positioned by %)
 *
 * Dependencies: jszip (already a project dep) to read the archive,
 * fast-xml-parser to parse the XML. Everything here is pure aside from
 * the unzip — no network, no disk writes — so the controller can wrap
 * it in try/catch and fall back to the legacy single-IMAGE template if
 * anything throws.
 *
 * This is intentionally tolerant: PowerPoint, Google Slides exports,
 * Keynote exports, and Canva PPTX downloads all differ in which
 * optional elements they emit. We read what's present and skip what
 * isn't, never throwing on a missing optional node.
 */

import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import type {
  ExtractedMedia,
  ParsedDocument,
  ParsedPage,
  ParsedZone,
} from './types';
import {
  emuToPx,
  ooxmlColorToHex,
  pptSzToFontSizePx,
  pxRectToPercent,
} from './units';

// Hard caps so a pathological deck can't exhaust memory / create
// thousands of zones. The controller enforces the same per-page zone
// cap; this is defense-in-depth at the parser boundary.
const MAX_SLIDES = 60;
const MAX_ZONES_PER_SLIDE = 80;
const MAX_TEXT_LEN = 5000; // per text zone, sanitized

/**
 * ACTUAL decompressed media bytes we will hold at once, and how many parts.
 *
 * 2026-09-15 — the declared-size guard below sums `uncompressedSize` from the
 * central directory, and its own comment named the hole it left: "a liar-zip
 * that under-declares its sizes is a deeper attack — a per-part streaming cap
 * is the follow-up." This is that follow-up, and it closes a measured path,
 * not a theoretical one: an upload well under 1MB that PASSES the declared
 * guard was measured inflating to hundreds of MB of live Buffers inside the
 * API process. Buffer bytes are EXTERNAL memory, so a heap ceiling never sees
 * them (heapUsed stayed at 7.5MB while RSS reached 590MB) — only the container
 * OOM killer fires, and `railway.json` runs this API at `numReplicas: 1`, so
 * that kill takes `/emergency/trigger` with it.
 *
 * 64MB of imagery is far more than any real deck carries (a 40-slide deck of
 * full-bleed photos is ~20MB), and the cap is measured on bytes we actually
 * inflated, so it holds regardless of what the archive claims.
 */
const MAX_MEDIA_BYTES = 64 * 1024 * 1024;
const MAX_MEDIA_PARTS = 300;

// Default 16:9 1080p slide if presentation.xml omits the size.
const DEFAULT_SLIDE_W_EMU = 12192000; // 13.333in
const DEFAULT_SLIDE_H_EMU = 6858000; // 7.5in

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // Keep arrays predictable: shapes/runs/paragraphs that appear once
  // would otherwise be a single object. We normalize with asArray().
  isArray: () => false,
  // Text content of <a:t> lands on the special key below.
  textNodeName: '#text',
  // Do NOT auto-trim — we want to preserve intentional spacing inside
  // a run, but we DO sanitize control chars later.
  trimValues: false,
  parseAttributeValue: false,
  processEntities: true,
});

/** Coerce a fast-xml-parser node into an array (it collapses singletons). */
function asArray<T = any>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

// Matches every C0 control char (NUL + \x01–\x1f) except \t \n \r — we
// strip these from extracted document text before it ever reaches the DB.
// eslint-disable-next-line no-control-regex
const PPTX_CONTROL_CHARS = /[\x00-\x08\x0b\x0c\x0e-\x1f]/g;
/** Strip control chars + cap length on extracted text (no raw doc text → DB). */
function sanitizeText(raw: string): string {
  return String(raw).replace(PPTX_CONTROL_CHARS, '').slice(0, MAX_TEXT_LEN);
}

/** Map a media filename extension to a serveable image MIME, or null. */
function mediaMime(name: string): string | null {
  const ext = name.toLowerCase().split('.').pop() || '';
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'bmp':
      return 'image/bmp';
    // emf/wmf/tiff/svg are NOT browser-serveable in our player → skip.
    default:
      return null;
  }
}

interface SlideRel {
  /** rId → media zip path (e.g. 'ppt/media/image1.png'). */
  media: Map<string, string>;
}

/** Parse a *.rels file → rId → target (resolved relative to ppt/). */
function parseSlideRels(relsXml: string | undefined): SlideRel {
  const media = new Map<string, string>();
  if (!relsXml) return { media };
  let doc: any;
  try {
    doc = xml.parse(relsXml);
  } catch {
    return { media };
  }
  const rels = asArray(doc?.Relationships?.Relationship);
  for (const r of rels) {
    const id = r?.['@_Id'];
    const target = r?.['@_Target'];
    const type = String(r?.['@_Type'] || '');
    if (!id || !target) continue;
    if (type.endsWith('/image') || /\/media\//.test(String(target))) {
      // Targets are relative to the slide part (ppt/slides/), e.g.
      // "../media/image1.png" → "ppt/media/image1.png".
      const resolved = String(target)
        .replace(/^\.\.\//, 'ppt/')
        .replace(/^\//, '');
      const finalPath = resolved.startsWith('ppt/')
        ? resolved
        : `ppt/slides/${resolved}`;
      media.set(String(id), finalPath);
    }
  }
  return { media };
}

/** Extract the `<a:off>`/`<a:ext>` rectangle (EMU) from a shape's spPr. */
function readXfrm(
  spPr: any,
): { x: number; y: number; cx: number; cy: number } | null {
  const xfrm = spPr?.['a:xfrm'];
  if (!xfrm) return null;
  const off = xfrm['a:off'];
  const ext = xfrm['a:ext'];
  if (!off || !ext) return null;
  const x = Number(off['@_x']);
  const y = Number(off['@_y']);
  const cx = Number(ext['@_cx']);
  const cy = Number(ext['@_cy']);
  if (![x, y, cx, cy].every((n) => Number.isFinite(n))) return null;
  return { x, y, cx, cy };
}

/**
 * Pull the visible text + dominant run style out of a `<p:txBody>`.
 * Joins paragraphs with newlines; takes the first run's size/color/bold
 * as the representative style for the whole text box (a TEXT zone has
 * one style — good enough for an editable starting point the operator
 * then refines).
 */
function readTextBody(txBody: any): {
  text: string;
  fontSizePx: number;
  color: string | null;
  bold: boolean;
  alignment: 'left' | 'center' | 'right';
  fontFamily: string | null;
} | null {
  if (!txBody) return null;
  const paras = asArray(txBody['a:p']);
  const lines: string[] = [];
  let firstSz: number | undefined;
  let firstColor: string | null = null;
  let firstBold = false;
  let firstFont: string | null = null;
  let firstAlgn: string | undefined;

  for (const p of paras) {
    const runs = asArray(p['a:r']);
    const lineParts: string[] = [];
    // Paragraph alignment lives on a:pPr@algn (ctr|l|r|just).
    const algn = p['a:pPr']?.['@_algn'];
    if (firstAlgn === undefined && typeof algn === 'string') firstAlgn = algn;

    for (const r of runs) {
      const t = r['a:t'];
      const text = typeof t === 'object' && t ? t['#text'] : t;
      if (text != null && String(text).length) lineParts.push(String(text));
      const rPr = r['a:rPr'];
      if (rPr && firstSz === undefined) {
        const sz = Number(rPr['@_sz']);
        if (Number.isFinite(sz)) firstSz = sz;
        if (rPr['@_b'] === '1' || rPr['@_b'] === 1 || rPr['@_b'] === 'true')
          firstBold = true;
        const clr = rPr['a:solidFill']?.['a:srgbClr']?.['@_val'];
        if (clr) firstColor = ooxmlColorToHex(clr);
        const font = rPr['a:latin']?.['@_typeface'];
        if (typeof font === 'string' && font && !/^\+/.test(font))
          firstFont = font;
      }
    }
    // A field (date/slide#) lives in <a:fld><a:t>; capture as text too.
    for (const fld of asArray(p['a:fld'])) {
      const t = fld['a:t'];
      const text = typeof t === 'object' && t ? t['#text'] : t;
      if (text != null && String(text).length) lineParts.push(String(text));
    }
    lines.push(lineParts.join(''));
  }

  const text = sanitizeText(lines.join('\n').replace(/\n{3,}/g, '\n\n')).trim();
  if (!text) return null;

  const alignment: 'left' | 'center' | 'right' =
    firstAlgn === 'ctr' ? 'center' : firstAlgn === 'r' ? 'right' : 'left';

  return {
    text,
    fontSizePx: pptSzToFontSizePx(firstSz),
    color: firstColor,
    bold: firstBold,
    alignment,
    fontFamily: firstFont,
  };
}

/**
 * Walk a slide's shape tree (recursing into group shapes `<p:grpSp>`)
 * and emit zones. Pictures resolve their media via the slide rels.
 */
function walkShapes(
  node: any,
  rels: SlideRel,
  canvasWpx: number,
  canvasHpx: number,
  out: { zones: ParsedZone[]; mediaRefsUsed: Set<string> },
  mediaPathToId: Map<string, string>,
): void {
  if (!node || out.zones.length >= MAX_ZONES_PER_SLIDE) return;

  // Text / placeholder shapes: <p:sp>
  for (const sp of asArray(node['p:sp'])) {
    if (out.zones.length >= MAX_ZONES_PER_SLIDE) break;
    const rect = readXfrm(sp['p:spPr']);
    const body = readTextBody(sp['p:txBody']);
    if (!rect || !body) continue;
    const pct = pxRectToPercent(
      emuToPx(rect.x),
      emuToPx(rect.y),
      emuToPx(rect.cx),
      emuToPx(rect.cy),
      canvasWpx,
      canvasHpx,
    );
    if (!pct) continue;
    const cfg: Record<string, unknown> = {
      content: body.text,
      fontSize: body.fontSizePx,
      alignment: body.alignment,
      bold: body.bold,
    };
    if (body.color) cfg.color = body.color;
    if (body.fontFamily) cfg.fontFamily = body.fontFamily;
    out.zones.push({
      name: body.text.slice(0, 40) || 'Text',
      widgetType: 'TEXT',
      ...pct,
      zIndex: out.zones.length + 1,
      defaultConfig: cfg,
    });
  }

  // Pictures: <p:pic>
  for (const pic of asArray(node['p:pic'])) {
    if (out.zones.length >= MAX_ZONES_PER_SLIDE) break;
    const rect = readXfrm(pic['p:spPr']);
    if (!rect) continue;
    const embed =
      pic['p:blipFill']?.['a:blip']?.['@_r:embed'] ??
      pic['p:blipFill']?.['a:blip']?.['@_embed'];
    if (!embed) continue;
    const mediaPath = rels.media.get(String(embed));
    if (!mediaPath) continue;
    const mediaId = mediaPathToId.get(mediaPath);
    if (!mediaId) continue; // unserveable format (emf/wmf) — skip the zone
    const pct = pxRectToPercent(
      emuToPx(rect.x),
      emuToPx(rect.y),
      emuToPx(rect.cx),
      emuToPx(rect.cy),
      canvasWpx,
      canvasHpx,
    );
    if (!pct) continue;
    out.mediaRefsUsed.add(mediaId);
    out.zones.push({
      name: 'Image',
      widgetType: 'IMAGE',
      ...pct,
      zIndex: out.zones.length + 1,
      defaultConfig: { fit: 'contain' },
      mediaRef: mediaId,
    });
  }

  // Recurse into group shapes. NOTE: child offsets inside a group are
  // in the group's child coordinate space; for a pragmatic v1 we read
  // the children's own xfrm against the slide canvas (most exporters
  // flatten groups, and a slightly-off group child is still an editable
  // zone the operator can nudge — far better than a flat image).
  for (const grp of asArray(node['p:grpSp'])) {
    walkShapes(grp, rels, canvasWpx, canvasHpx, out, mediaPathToId);
  }
}

/**
 * Parse a PPTX buffer into a ParsedDocument (one ParsedPage per slide).
 * Throws on a non-PPTX / corrupt archive so the controller falls back.
 * Returns a document with `pages.length === 0` ONLY if the archive had
 * no slides — the controller treats empty as "nothing usable" and also
 * falls back, so import is never worse than the legacy single-image.
 */
export async function parsePptx(buffer: Buffer): Promise<ParsedDocument> {
  const zip = await JSZip.loadAsync(buffer);

  // 2026-06-09 Fable audit — decompression-bomb guard. MAX_BYTES (in the
  // controller) caps the COMPRESSED upload (~50MB), but JSZip inflates slide
  // XML + every media part unbounded below, so a crafted ~50MB archive can
  // expand to GBs and OOM the shared API process. Sum the declared
  // uncompressed sizes from the central directory and reject BEFORE any
  // .async() decompression. (Catches the standard high-ratio bomb; a liar-zip
  // that under-declares its sizes is a deeper attack — a per-part streaming
  // cap is the follow-up. Import is ADMIN/CONTRIBUTOR-gated, not anonymous.)
  // On throw the controller falls back to the legacy single-IMAGE template.
  const MAX_UNCOMPRESSED_BYTES = 250 * 1024 * 1024; // 250MB inflated ceiling
  let totalUncompressed = 0;
  for (const f of Object.values(zip.files)) {
    const sz = (f as any)?._data?.uncompressedSize;
    if (typeof sz === 'number' && sz > 0) totalUncompressed += sz;
    if (totalUncompressed > MAX_UNCOMPRESSED_BYTES) {
      throw new Error(
        `PPTX uncompressed size exceeds ${Math.round(MAX_UNCOMPRESSED_BYTES / (1024 * 1024))}MB (decompression-bomb guard)`,
      );
    }
  }

  // 1. Slide dimensions from presentation.xml.
  let slideWEmu = DEFAULT_SLIDE_W_EMU;
  let slideHEmu = DEFAULT_SLIDE_H_EMU;
  const presFile = zip.file('ppt/presentation.xml');
  if (presFile) {
    const presXml = await presFile.async('string');
    try {
      const pres = xml.parse(presXml);
      const sz = pres?.['p:presentation']?.['p:sldSz'];
      const cx = Number(sz?.['@_cx']);
      const cy = Number(sz?.['@_cy']);
      if (Number.isFinite(cx) && cx > 0) slideWEmu = cx;
      if (Number.isFinite(cy) && cy > 0) slideHEmu = cy;
    } catch {
      /* keep defaults */
    }
  }
  const canvasWpx = Math.round(emuToPx(slideWEmu));
  const canvasHpx = Math.round(emuToPx(slideHEmu));

  // 2. Determine slide ORDER from presentation rels. Falls back to a
  //    natural sort of slideN.xml filenames if rels are unreadable.
  const slidePaths = await orderedSlidePaths(zip);
  if (slidePaths.length === 0) return { pages: [], media: [] };

  // 3. First pass: collect every serveable media part referenced by any
  //    slide, assigning each a stable id. We index the media GLOBALLY
  //    (deduped by zip path) so a logo reused on 10 slides uploads once.
  const allMediaPaths = new Set<string>();
  const slideRelsCache = new Map<string, SlideRel>();
  for (const sp of slidePaths) {
    const relsPath = sp.replace(
      /slides\/([^/]+)\.xml$/,
      'slides/_rels/$1.xml.rels',
    );
    const relsXml = await zip.file(relsPath)?.async('string');
    const rels = parseSlideRels(relsXml);
    slideRelsCache.set(sp, rels);
    for (const p of rels.media.values()) allMediaPaths.add(p);
  }

  const media: ExtractedMedia[] = [];
  const mediaPathToId = new Map<string, string>();
  let mediaIdx = 0;
  let mediaBytes = 0;
  for (const path of allMediaPaths) {
    const mime = mediaMime(path);
    if (!mime) continue; // skip emf/wmf/etc — zone gets dropped later
    const f = zip.file(path);
    if (!f) continue;
    if (media.length >= MAX_MEDIA_PARTS) {
      throw new Error(
        `PPTX embeds more than ${MAX_MEDIA_PARTS} images (resource guard)`,
      );
    }
    const data = await f.async('nodebuffer');
    if (!data || data.length === 0) continue;
    // Measured on the bytes we actually inflated — the declared-size guard
    // above cannot be trusted for this (see MAX_MEDIA_BYTES).
    mediaBytes += data.length;
    if (mediaBytes > MAX_MEDIA_BYTES) {
      throw new Error(
        `PPTX embedded images exceed ${Math.round(MAX_MEDIA_BYTES / (1024 * 1024))}MB once decompressed (resource guard)`,
      );
    }
    const id = `media-${mediaIdx++}`;
    mediaPathToId.set(path, id);
    media.push({
      id,
      data,
      mimeType: mime,
      name: path.split('/').pop() || `${id}`,
    });
  }

  // 4. Build a page per slide.
  const pages: ParsedPage[] = [];
  let slideNum = 0;
  for (const sp of slidePaths) {
    slideNum++;
    if (slideNum > MAX_SLIDES) break;
    const slideXml = await zip.file(sp)?.async('string');
    if (!slideXml) continue;
    let doc: any;
    try {
      doc = xml.parse(slideXml);
    } catch {
      continue; // skip an unparseable slide rather than fail the whole import
    }
    // Shape tree root: p:sld → p:cSld → p:spTree.
    const spTree = doc?.['p:sld']?.['p:cSld']?.['p:spTree'];
    if (!spTree) continue;
    const rels = slideRelsCache.get(sp) ?? { media: new Map() };
    const acc = { zones: [] as ParsedZone[], mediaRefsUsed: new Set<string>() };
    walkShapes(spTree, rels, canvasWpx, canvasHpx, acc, mediaPathToId);

    // Slide background color (optional): p:cSld/p:bg/p:bgPr/a:solidFill.
    const bgClr =
      doc?.['p:sld']?.['p:cSld']?.['p:bg']?.['p:bgPr']?.['a:solidFill']?.[
        'a:srgbClr'
      ]?.['@_val'];
    const bgColor = ooxmlColorToHex(bgClr) ?? undefined;

    pages.push({
      label: `Slide ${slideNum}`,
      screenWidth: canvasWpx,
      screenHeight: canvasHpx,
      bgColor,
      zones: acc.zones,
    });
  }

  // 5. Prune media that ended up referenced by no surviving page zone
  //    (e.g. all referencing slides were skipped). Keeps the upload set
  //    tight so we never upload an orphan image.
  const usedMediaIds = new Set<string>();
  for (const page of pages) {
    for (const z of page.zones) {
      if (z.mediaRef) usedMediaIds.add(z.mediaRef);
    }
  }
  const prunedMedia = media.filter((m) => usedMediaIds.has(m.id));

  return { pages, media: prunedMedia };
}

/**
 * Resolve slide parts in presentation order. PowerPoint stores the
 * order in ppt/_rels/presentation.xml.rels (sldId → rId → target); we
 * read it, and fall back to a natural sort of the slide filenames when
 * the rels are missing/unreadable so a hand-built archive still works.
 */
async function orderedSlidePaths(zip: JSZip): Promise<string[]> {
  const allSlides = Object.keys(zip.files).filter((n) =>
    /^ppt\/slides\/slide\d+\.xml$/.test(n),
  );
  if (allSlides.length === 0) return [];

  const presRels = await zip
    .file('ppt/_rels/presentation.xml.rels')
    ?.async('string');
  const presXml = await zip.file('ppt/presentation.xml')?.async('string');
  if (presRels && presXml) {
    try {
      const relsDoc = xml.parse(presRels);
      const rIdToTarget = new Map<string, string>();
      for (const r of asArray(relsDoc?.Relationships?.Relationship)) {
        const id = r?.['@_Id'];
        const target = r?.['@_Target'];
        const type = String(r?.['@_Type'] || '');
        if (id && target && type.endsWith('/slide')) {
          const resolved = `ppt/${String(target)
            .replace(/^\.\.\//, '')
            .replace(/^\//, '')}`.replace('ppt/ppt/', 'ppt/');
          rIdToTarget.set(String(id), resolved);
        }
      }
      const presDoc = xml.parse(presXml);
      const sldIds = asArray(
        presDoc?.['p:presentation']?.['p:sldIdLst']?.['p:sldId'],
      );
      const ordered: string[] = [];
      for (const s of sldIds) {
        const rid = s?.['@_r:id'] ?? s?.['@_id'];
        const target = rid != null ? rIdToTarget.get(String(rid)) : undefined;
        if (target && allSlides.includes(target)) ordered.push(target);
      }
      if (ordered.length > 0) return ordered;
    } catch {
      /* fall through to natural sort */
    }
  }

  // Natural sort: slide2.xml before slide10.xml.
  return allSlides.sort((a, b) => {
    const na = Number(a.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
    const nb = Number(b.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
    return na - nb;
  });
}

// Re-export the cap so the controller and tests share one source of truth.
export { MAX_ZONES_PER_SLIDE, MAX_SLIDES };
