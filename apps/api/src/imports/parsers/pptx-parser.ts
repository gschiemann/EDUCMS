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
 * fast-xml-parser to parse the XML (via ./ooxml, which gives us an
 * ORDER-PRESERVING view). Everything here is pure aside from the unzip
 * — no network, no disk writes.
 *
 * This is intentionally tolerant: PowerPoint, Google Slides exports,
 * Keynote exports, and Canva PPTX downloads all differ in which
 * optional elements they emit. We read what's present and skip what
 * isn't, never throwing on a missing optional node — but every skip is
 * now RECORDED as a typed warning instead of vanishing (see ./types).
 *
 * ── What the 2026-09-15 audit found here, and what changed ───────────
 *
 *  1. `00123` arrived as the number `123`. Fixed in ./ooxml by turning
 *     tag-value coercion off; asserted on exact string content.
 *  2. Backgrounds were read only from a literal `p:cSld/p:bg/p:bgPr/
 *     a:solidFill/a:srgbClr`. PowerPoint, Slides and Canva emit `p:bgRef`
 *     or `a:schemeClr`, so a dark deck (whose text colour WAS extracted)
 *     imported as white-on-white. Now resolved through the theme, the
 *     master's colour map, and slide → layout → master inheritance.
 *  3. All text shapes were walked, then all pictures — so a photo that
 *     belongs behind a headline landed on top of it. Now a single
 *     document-order walk.
 *  4. Group transforms (`chOff`/`chExt` vs `off`/`ext`) were ignored, so
 *     a grouped child rendered at its LOCAL position. Now composed
 *     through arbitrarily nested groups.
 *  5. A placeholder with no transform of its own was skipped entirely.
 *     Now it inherits geometry from the slide layout, then the master.
 *  6. Slides past the cap disappeared silently. Now every source slide
 *     gets a `ParsedPage` with a disposition, and the true slide count
 *     rides on the document.
 */

import JSZip from 'jszip';
import {
  type ExtractedMedia,
  type ParsedDocument,
  type ParsedPage,
  type ParsedZone,
  MAX_ACCOUNTED_PAGES,
  WarningSink,
  gradeDisposition,
} from './types';
import {
  emuToPx,
  ooxmlColorToHex,
  pptSzToFontSizePx,
  pxRectToPercent,
} from './units';
import {
  type ColorContext,
  type ColorMap,
  type OoxmlTheme,
  type OrderedNode,
  asArray,
  orderedToMap,
  parseXml,
  pathByTag,
  readColorMap,
  readTheme,
  resolveColorNode,
} from './ooxml';

// Hard caps so a pathological deck can't exhaust memory / create
// thousands of zones. The controller enforces the same per-page zone
// cap; this is defense-in-depth at the parser boundary.
const MAX_SLIDES = 60;
const MAX_ZONES_PER_SLIDE = 80;
const MAX_TEXT_LEN = 5000; // per text zone, sanitized

/**
 * How deep a group nest the walker will follow.
 *
 * The zone cap bounds how WIDE a slide can be; this bounds how DEEP.
 * `<p:grpSp>` nests arbitrarily in the schema and the walk is recursive,
 * so a crafted slide is the only thing standing between deep nesting and
 * a stack overflow inside the process that also publishes lockdown
 * alerts. PowerPoint's own UI cannot produce more than a handful of
 * levels, so 24 costs nothing real.
 *
 * MEASURED, not assumed: fast-xml-parser v5 refuses at ~100 levels with
 * "Maximum nested tags exceeded", which `parsePptx` catches and grades
 * PAGE_UNREADABLE. So the XML layer is the outer bound and this is the
 * inner one — the band between them (25–99) is where this guard actually
 * speaks, and both halves are covered by tests.
 */
const MAX_GROUP_DEPTH = 24;

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
 *
 * ⛔ DO NOT WEAKEN OR REMOVE. Both bounds are load-bearing.
 */
const MAX_MEDIA_BYTES = 64 * 1024 * 1024;
const MAX_MEDIA_PARTS = 300;

// Default 16:9 1080p slide if presentation.xml omits the size.
const DEFAULT_SLIDE_W_EMU = 12192000; // 13.333in
const DEFAULT_SLIDE_H_EMU = 6858000; // 7.5in

// Matches every C0 control char (NUL + \x01–\x1f) except \t \n \r — we
// strip these from extracted document text before it ever reaches the DB.
// eslint-disable-next-line no-control-regex
const PPTX_CONTROL_CHARS = /[\x00-\x08\x0b\x0c\x0e-\x1f]/g;

/**
 * Strip control chars + cap length on extracted text (no raw doc text → DB).
 * Reports whether the cap actually bit, so the caller can warn instead of
 * silently handing back a half sentence.
 */
function sanitizeText(raw: string): { text: string; truncated: boolean } {
  const cleaned = String(raw).replace(PPTX_CONTROL_CHARS, '');
  return cleaned.length > MAX_TEXT_LEN
    ? { text: cleaned.slice(0, MAX_TEXT_LEN), truncated: true }
    : { text: cleaned, truncated: false };
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

interface PartRels {
  /** rId → media zip path (e.g. 'ppt/media/image1.png'). */
  media: Map<string, string>;
  /** rId → any target, resolved to a package path. */
  targets: Map<string, string>;
  /** Relationship type suffix (e.g. 'slideLayout') → package path. */
  byType: Map<string, string>;
}

const EMPTY_RELS: PartRels = {
  media: new Map(),
  targets: new Map(),
  byType: new Map(),
};

/**
 * Resolve a relationship target against the part that declares it.
 * `../media/image1.png` inside `ppt/slides/_rels/slide1.xml.rels`
 * belongs to `ppt/slides/`, so it resolves to `ppt/media/image1.png`.
 */
function resolveRelTarget(ownerDir: string, target: string): string {
  const raw = String(target).replace(/^\//, '');
  const segments = `${ownerDir}/${raw}`.split('/');
  const stack: string[] = [];
  for (const seg of segments) {
    if (!seg || seg === '.') continue;
    if (seg === '..') stack.pop();
    else stack.push(seg);
  }
  return stack.join('/');
}

/** Parse a *.rels file for a part living in `ownerDir`. */
function parseRels(relsXml: string | undefined, ownerDir: string): PartRels {
  const rels: PartRels = {
    media: new Map(),
    targets: new Map(),
    byType: new Map(),
  };
  if (!relsXml) return rels;
  let doc: any;
  try {
    doc = parseXml(relsXml).map;
  } catch {
    return rels;
  }
  for (const r of asArray(doc?.Relationships?.Relationship)) {
    const id = r?.['@_Id'];
    const target = r?.['@_Target'];
    const type = String(r?.['@_Type'] || '');
    if (!id || !target) continue;
    // An external relationship points outside the package; we cannot
    // read its bytes, so it is not a media candidate.
    if (String(r?.['@_TargetMode'] || '') === 'External') continue;
    const resolved = resolveRelTarget(ownerDir, String(target));
    rels.targets.set(String(id), resolved);
    const kind = type.split('/').pop() || '';
    if (kind && !rels.byType.has(kind)) rels.byType.set(kind, resolved);
    if (type.endsWith('/image') || /\/media\//.test(String(target))) {
      rels.media.set(String(id), resolved);
    }
  }
  return rels;
}

/** The `<a:off>`/`<a:ext>` rectangle (EMU) plus rotation, from an xfrm map. */
interface Xfrm {
  x: number;
  y: number;
  cx: number;
  cy: number;
  rot: number;
  chOffX: number;
  chOffY: number;
  chExtCx: number;
  chExtCy: number;
  hasChild: boolean;
}

function readXfrmNode(xfrm: any): Xfrm | null {
  if (!xfrm || typeof xfrm !== 'object') return null;
  const off = xfrm['a:off'];
  const ext = xfrm['a:ext'];
  if (!off || !ext) return null;
  const x = Number(off['@_x']);
  const y = Number(off['@_y']);
  const cx = Number(ext['@_cx']);
  const cy = Number(ext['@_cy']);
  if (![x, y, cx, cy].every((n) => Number.isFinite(n))) return null;
  const rotRaw = Number(xfrm['@_rot']);
  // OOXML rotation is in 60000ths of a degree.
  const rot = Number.isFinite(rotRaw) ? rotRaw / 60000 : 0;

  const chOff = xfrm['a:chOff'];
  const chExt = xfrm['a:chExt'];
  const chOffX = Number(chOff?.['@_x']);
  const chOffY = Number(chOff?.['@_y']);
  const chExtCx = Number(chExt?.['@_cx']);
  const chExtCy = Number(chExt?.['@_cy']);
  const hasChild = [chOffX, chOffY, chExtCx, chExtCy].every((n) =>
    Number.isFinite(n),
  );

  return {
    x,
    y,
    cx,
    cy,
    rot,
    chOffX: hasChild ? chOffX : 0,
    chOffY: hasChild ? chOffY : 0,
    chExtCx: hasChild ? chExtCx : cx,
    chExtCy: hasChild ? chExtCy : cy,
    hasChild,
  };
}

/** Extract the `<a:off>`/`<a:ext>` rectangle (EMU) from a shape's spPr. */
function readXfrm(spPr: any): Xfrm | null {
  return readXfrmNode(spPr?.['a:xfrm']);
}

/**
 * A cumulative group transform: `X = x * kx + dx` in slide EMU space.
 *
 * A `<p:grpSp>`'s `<a:xfrm>` says where the group sits on the slide
 * (`a:off` / `a:ext`) AND what coordinate space its children are
 * authored in (`a:chOff` / `a:chExt`). The child's own `a:off` is in
 * that CHILD space. Ignoring the mapping — which the old parser did,
 * on purpose, with a comment calling it "pragmatic" — puts a grouped
 * child wherever it happened to sit inside the group, usually the
 * top-left corner of the slide.
 */
interface GroupTransform {
  kx: number;
  ky: number;
  dx: number;
  dy: number;
}

const IDENTITY: GroupTransform = { kx: 1, ky: 1, dx: 0, dy: 0 };

/** Compose a group's own local→parent map onto the parent transform. */
function composeGroup(parent: GroupTransform, g: Xfrm): GroupTransform {
  const sx = g.chExtCx > 0 ? g.cx / g.chExtCx : 1;
  const sy = g.chExtCy > 0 ? g.cy / g.chExtCy : 1;
  // Local → parent: X = g.x + (x - g.chOffX) * sx
  const localKx = sx;
  const localDx = g.x - g.chOffX * sx;
  const localKy = sy;
  const localDy = g.y - g.chOffY * sy;
  // Then parent: X' = parent.kx * X + parent.dx
  return {
    kx: parent.kx * localKx,
    ky: parent.ky * localKy,
    dx: parent.kx * localDx + parent.dx,
    dy: parent.ky * localDy + parent.dy,
  };
}

/** Apply a cumulative group transform to a child rectangle (EMU). */
function applyTransform(
  rect: Xfrm,
  t: GroupTransform,
): { x: number; y: number; cx: number; cy: number } {
  return {
    x: rect.x * t.kx + t.dx,
    y: rect.y * t.ky + t.dy,
    cx: rect.cx * t.kx,
    cy: rect.cy * t.ky,
  };
}

interface TextBody {
  text: string;
  fontSizePx: number;
  color: string | null;
  bold: boolean;
  alignment: 'left' | 'center' | 'right';
  fontFamily: string | null;
  truncated: boolean;
  /** A run colour was declared but could not be resolved to a hex. */
  colorUnresolved: boolean;
  /** A theme font reference (`+mj-lt`) could not be resolved. */
  fontUnresolved: boolean;
}

/**
 * Pull the visible text + dominant run style out of a `<p:txBody>`.
 * Joins paragraphs with newlines; takes the first run's size/color/bold
 * as the representative style for the whole text box (a TEXT zone has
 * one style — good enough for an editable starting point the operator
 * then refines).
 */
function readTextBody(
  txBody: any,
  ctx: ColorContext,
  theme?: OoxmlTheme,
  inherited?: PlaceholderDefaults,
): TextBody | null {
  if (!txBody) return null;
  const paras = asArray(txBody['a:p']);
  const lines: string[] = [];
  let firstSz: number | undefined;
  let firstColor: string | null = null;
  // undefined = the run said nothing, so the placeholder may speak.
  let firstBold: boolean | undefined;
  let firstFont: string | null = null;
  let firstAlgn: string | undefined;
  let colorUnresolved = false;
  let fontUnresolved = false;

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
        // `b="0"` is a real answer — it means "not bold, whatever the
        // layout says" — so record the absence separately from a run
        // that never mentions weight at all.
        if (rPr['@_b'] !== undefined) firstBold = isTruthyAttr(rPr['@_b']);
        const fill = rPr['a:solidFill'];
        if (fill) {
          // Resolve srgb AND scheme colours — a themed deck writes its
          // body text as <a:schemeClr val="lt1"/>, and reading only the
          // literal case is half of the white-on-white failure.
          firstColor = resolveColorNode(fill, ctx);
          if (!firstColor) colorUnresolved = true;
        }
        const font = rPr['a:latin']?.['@_typeface'];
        if (typeof font === 'string' && font) {
          if (font.startsWith('+')) {
            // `+mj-lt` / `+mn-lt` are theme font references.
            const resolved = font.startsWith('+mj')
              ? theme?.majorFont
              : theme?.minorFont;
            if (resolved) firstFont = resolved;
            else fontUnresolved = true;
          } else {
            firstFont = font;
          }
        }
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

  const sanitized = sanitizeText(lines.join('\n').replace(/\n{3,}/g, '\n\n'));
  const text = sanitized.text.trim();
  if (!text) return null;

  // Anything the runs left unsaid comes from the placeholder the shape
  // inherits — layout, then master, then the master's text styles. This
  // runs AFTER the run walk and only fills gaps, so a run that states a
  // property still wins and nothing that worked before changes.
  const fallback = inherited?.defRPr;
  if (fallback) {
    if (firstSz === undefined) {
      const sz = Number(fallback['@_sz']);
      if (Number.isFinite(sz)) firstSz = sz;
    }
    if (firstBold === undefined && fallback['@_b'] !== undefined)
      firstBold = isTruthyAttr(fallback['@_b']);
    if (firstColor === null && !colorUnresolved) {
      const fill = fallback['a:solidFill'];
      if (fill) {
        firstColor = resolveColorNode(fill, ctx);
        if (!firstColor) colorUnresolved = true;
      }
    }
    if (firstFont === null && !fontUnresolved) {
      const font = fallback['a:latin']?.['@_typeface'];
      if (typeof font === 'string' && font) {
        if (font.startsWith('+')) {
          const resolved = font.startsWith('+mj')
            ? theme?.majorFont
            : theme?.minorFont;
          if (resolved) firstFont = resolved;
          else fontUnresolved = true;
        } else {
          firstFont = font;
        }
      }
    }
  }
  if (firstAlgn === undefined && typeof inherited?.algn === 'string')
    firstAlgn = inherited.algn;

  const alignment: 'left' | 'center' | 'right' =
    firstAlgn === 'ctr' ? 'center' : firstAlgn === 'r' ? 'right' : 'left';

  return {
    text,
    fontSizePx: pptSzToFontSizePx(firstSz),
    color: firstColor,
    bold: firstBold === true,
    alignment,
    fontFamily: firstFont,
    truncated: sanitized.truncated,
    colorUnresolved,
    fontUnresolved,
  };
}

/** OOXML booleans arrive as `1`/`0`/`true`/`false`, string or number. */
function isTruthyAttr(v: unknown): boolean {
  return v === '1' || v === 1 || v === 'true' || v === true;
}

// ─── Placeholder geometry inheritance ─────────────────────────────────

/**
 * A layout/master placeholder's geometry, keyed so a slide shape can
 * find its parent. PowerPoint matches on `idx` when both carry one,
 * otherwise on `type` (with `ctrTitle` ≡ `title`, and an absent type
 * meaning `body`).
 */
/**
 * What a slide inherits from its layout/master placeholder. Geometry was
 * always read here; the TEXT defaults were not, and that is where a
 * themed deck keeps almost everything about how its words look.
 *
 * PowerPoint writes a title run as `<a:r><a:t>…</a:t></a:r>` with no
 * `a:rPr` at all and lets the layout's `a:lstStyle/a:lvl1pPr/a:defRPr`
 * (then the master's `p:txStyles`) supply size, colour, weight and face.
 * Reading only the run is how a 44pt bold centred white title arrived as
 * 24pt, left, not bold, no colour — measured, not assumed.
 */
interface PlaceholderDefaults {
  xfrm: Xfrm | null;
  /** `a:lvl1pPr/@algn` — paragraph alignment the placeholder declares. */
  algn?: string;
  /** `a:lvl1pPr/a:defRPr` — the default run properties node. */
  defRPr?: any;
}

type PlaceholderIndex = Map<string, PlaceholderDefaults>;

/** The `a:lvl1pPr` of a `p:txBody`'s list style, if it declares one. */
function lvl1Props(txBody: any): any {
  return txBody?.['a:lstStyle']?.['a:lvl1pPr'] ?? null;
}

function placeholderKeys(ph: any): string[] {
  const idx = ph?.['@_idx'];
  const rawType = ph?.['@_type'];
  const type =
    typeof rawType === 'string' && rawType
      ? rawType === 'ctrTitle'
        ? 'title'
        : rawType
      : 'body';
  const keys: string[] = [];
  if (idx != null && String(idx) !== '') keys.push(`idx:${String(idx)}`);
  keys.push(`type:${type}`);
  return keys;
}

/**
 * Index every placeholder in a layout/master shape tree by its keys.
 *
 * A placeholder that declares text defaults but no `a:xfrm` is kept —
 * it used to be skipped outright, which threw away the list style of
 * every layout that positions by inheritance. Fields merge first-wins
 * PER FIELD, so a geometry-only entry can never shadow the text
 * defaults of a later one with the same key, or the reverse.
 */
function indexPlaceholders(spTreeMap: any): PlaceholderIndex {
  const out: PlaceholderIndex = new Map();
  if (!spTreeMap) return out;
  const visit = (node: any) => {
    for (const sp of asArray(node?.['p:sp'])) {
      const ph = sp?.['p:nvSpPr']?.['p:nvPr']?.['p:ph'];
      if (!ph) continue;
      const rect = readXfrm(sp['p:spPr']);
      const lvl1 = lvl1Props(sp['p:txBody']);
      const algn = lvl1?.['@_algn'];
      const defRPr = lvl1?.['a:defRPr'];
      if (!rect && !algn && !defRPr) continue;
      for (const key of placeholderKeys(ph)) {
        const at = out.get(key);
        if (!at) {
          out.set(key, {
            xfrm: rect,
            ...(typeof algn === 'string' && algn ? { algn } : {}),
            ...(defRPr ? { defRPr } : {}),
          });
          continue;
        }
        if (!at.xfrm && rect) at.xfrm = rect;
        if (at.algn === undefined && typeof algn === 'string' && algn)
          at.algn = algn;
        if (at.defRPr === undefined && defRPr) at.defRPr = defRPr;
      }
    }
    for (const grp of asArray(node?.['p:grpSp'])) visit(grp);
  };
  visit(spTreeMap);
  return out;
}

/**
 * Merge what a placeholder inherits, in PowerPoint's own order: the
 * layout first, then the master, then the master's `p:txStyles` for the
 * placeholder's family. Each FIELD resolves independently — a layout
 * that only moves the box still inherits the master's type size.
 */
function inheritedPlaceholder(
  ph: any,
  layout: PlaceholderIndex | undefined,
  master: PlaceholderIndex | undefined,
  masterTextStyles?: MasterTextStyles,
): PlaceholderDefaults {
  const merged: PlaceholderDefaults = { xfrm: null };
  if (!ph) return merged;
  const keys = placeholderKeys(ph);
  const take = (from: PlaceholderIndex | undefined) => {
    if (!from) return;
    for (const key of keys) {
      const at = from.get(key);
      if (!at) continue;
      if (!merged.xfrm && at.xfrm) merged.xfrm = at.xfrm;
      if (merged.algn === undefined && at.algn !== undefined)
        merged.algn = at.algn;
      if (merged.defRPr === undefined && at.defRPr !== undefined)
        merged.defRPr = at.defRPr;
    }
  };
  take(layout);
  take(master);
  const family = masterTextStyles?.[placeholderFamily(ph)];
  if (family) {
    if (merged.algn === undefined && family.algn !== undefined)
      merged.algn = family.algn;
    if (merged.defRPr === undefined && family.defRPr !== undefined)
      merged.defRPr = family.defRPr;
  }
  return merged;
}

/** Which `p:txStyles` family a placeholder draws its defaults from. */
function placeholderFamily(ph: any): keyof MasterTextStyles {
  const raw = ph?.['@_type'];
  const type = typeof raw === 'string' && raw ? raw : 'body';
  if (type === 'title' || type === 'ctrTitle') return 'title';
  if (type === 'body' || type === 'subTitle' || type === 'obj') return 'body';
  return 'other';
}

/** The master's three document-wide text styles, lvl1 only. */
export interface MasterTextStyles {
  title?: { algn?: string; defRPr?: any };
  body?: { algn?: string; defRPr?: any };
  other?: { algn?: string; defRPr?: any };
}

/** Read `p:txStyles` off a parsed slide master. */
function readMasterTextStyles(masterMap: any): MasterTextStyles {
  const styles = masterMap?.['p:sldMaster']?.['p:txStyles'];
  if (!styles || typeof styles !== 'object') return {};
  const one = (node: any) => {
    const lvl1 = node?.['a:lvl1pPr'];
    if (!lvl1) return undefined;
    const algn = lvl1['@_algn'];
    const defRPr = lvl1['a:defRPr'];
    if (!algn && !defRPr) return undefined;
    return {
      ...(typeof algn === 'string' && algn ? { algn } : {}),
      ...(defRPr ? { defRPr } : {}),
    };
  };
  const out: MasterTextStyles = {};
  const title = one(styles['p:titleStyle']);
  const body = one(styles['p:bodyStyle']);
  const other = one(styles['p:otherStyle']);
  if (title) out.title = title;
  if (body) out.body = body;
  if (other) out.other = other;
  return out;
}

// ─── Shape walk ───────────────────────────────────────────────────────

interface WalkContext {
  canvasWpx: number;
  canvasHpx: number;
  mediaByRelId: Map<string, string>;
  mediaPathToId: Map<string, string>;
  layoutPlaceholders?: PlaceholderIndex;
  masterPlaceholders?: PlaceholderIndex;
  masterTextStyles?: MasterTextStyles;
  colorContext: ColorContext;
  theme?: OoxmlTheme;
  sourcePage: number;
  warn: WarningSink;
}

interface WalkAccumulator {
  zones: ParsedZone[];
  truncated: boolean;
}

/** Human label for a `<p:graphicFrame>` so the warning says what was lost. */
function graphicFrameKind(frameMap: any): string {
  const data = frameMap?.['a:graphic']?.['a:graphicData'];
  const uri = String(data?.['@_uri'] || '');
  if (data?.['a:tbl'] || /table/i.test(uri)) return 'table';
  if (/chart/i.test(uri)) return 'chart';
  if (/diagram|smartArt/i.test(uri)) return 'SmartArt diagram';
  if (/ole/i.test(uri)) return 'embedded object';
  return 'graphic frame';
}

/**
 * Walk a slide's shape tree IN DOCUMENT ORDER, recursing into group
 * shapes and composing their coordinate transforms, emitting zones.
 *
 * Document order IS paint order in OOXML: the first child paints first
 * and everything after it paints on top. Preserving it is the whole
 * point — the previous walker drew every `<p:sp>` then every `<p:pic>`,
 * which inverted any deck whose background photo precedes its headline.
 */
function walkShapes(
  children: ReadonlyArray<OrderedNode>,
  transform: GroupTransform,
  ctx: WalkContext,
  acc: WalkAccumulator,
  depth = 0,
): void {
  if (depth > MAX_GROUP_DEPTH) {
    ctx.warn.add(
      'SHAPE_UNSUPPORTED',
      `Groups on slide ${ctx.sourcePage} are nested more than ${MAX_GROUP_DEPTH} deep; the innermost content was not imported.`,
      ctx.sourcePage,
    );
    return;
  }
  for (const child of children) {
    if (acc.zones.length >= MAX_ZONES_PER_SLIDE) {
      acc.truncated = true;
      return;
    }

    switch (child.tag) {
      case 'p:sp':
        emitShapeZone(child, transform, ctx, acc);
        break;
      case 'p:pic':
        emitPictureZone(child, transform, ctx, acc);
        break;
      case 'p:grpSp': {
        const map = orderedToMap(child.children);
        const grpXfrm = readXfrmNode(map?.['p:grpSpPr']?.['a:xfrm']);
        const next = grpXfrm ? composeGroup(transform, grpXfrm) : transform;
        if (grpXfrm && Math.abs(grpXfrm.rot) > 0.5) {
          ctx.warn.add(
            'SHAPE_ROTATION_IGNORED',
            `A rotated group was flattened to an upright box on slide ${ctx.sourcePage}.`,
            ctx.sourcePage,
          );
        }
        walkShapes(child.children, next, ctx, acc, depth + 1);
        break;
      }
      case 'p:graphicFrame': {
        const kind = graphicFrameKind(orderedToMap(child.children));
        ctx.warn.add(
          'SHAPE_UNSUPPORTED',
          `A ${kind} on slide ${ctx.sourcePage} could not be converted to an editable zone.`,
          ctx.sourcePage,
        );
        break;
      }
      case 'p:cxnSp':
        ctx.warn.add(
          'SHAPE_UNSUPPORTED',
          `A connector/line on slide ${ctx.sourcePage} could not be converted to an editable zone.`,
          ctx.sourcePage,
        );
        break;
      default:
        break;
    }
  }
}

function emitShapeZone(
  node: OrderedNode,
  transform: GroupTransform,
  ctx: WalkContext,
  acc: WalkAccumulator,
): void {
  const sp = orderedToMap(node.children);
  const ph = sp?.['p:nvSpPr']?.['p:nvPr']?.['p:ph'];
  // A placeholder with no transform of its own INHERITS from the slide
  // layout, then the master. Skipping it (the old behaviour) deleted the
  // title off every deck that uses a layout, which is most of them.
  const own = readXfrm(sp?.['p:spPr']);
  const inherited = inheritedPlaceholder(
    ph,
    ctx.layoutPlaceholders,
    ctx.masterPlaceholders,
    ctx.masterTextStyles,
  );
  const rect = own ?? inherited.xfrm;
  const body = readTextBody(
    sp?.['p:txBody'],
    ctx.colorContext,
    ctx.theme,
    inherited,
  );

  if (!body) {
    // A shape with geometry and no text is decoration (a filled
    // rectangle, an arrow). We cannot make it an editable zone, but it
    // is a real thing the operator will notice missing.
    if (rect) {
      ctx.warn.add(
        'SHAPE_UNSUPPORTED',
        `A shape with no text on slide ${ctx.sourcePage} was not imported (only text and pictures become editable zones).`,
        ctx.sourcePage,
      );
    }
    return;
  }

  if (!rect) {
    ctx.warn.add(
      'SHAPE_UNSUPPORTED',
      `A text box on slide ${ctx.sourcePage} has no position we could resolve and was not imported.`,
      ctx.sourcePage,
    );
    return;
  }

  if (Math.abs(rect.rot) > 0.5) {
    ctx.warn.add(
      'SHAPE_ROTATION_IGNORED',
      `Rotated text on slide ${ctx.sourcePage} was imported upright.`,
      ctx.sourcePage,
    );
  }
  if (body.truncated) {
    ctx.warn.add(
      'TEXT_TRUNCATED',
      `A text box on slide ${ctx.sourcePage} was longer than ${MAX_TEXT_LEN} characters and was cut short.`,
      ctx.sourcePage,
    );
  }
  if (body.colorUnresolved) {
    ctx.warn.add(
      'COLOR_UNRESOLVED',
      `A text colour on slide ${ctx.sourcePage} could not be resolved; the template default is used.`,
      ctx.sourcePage,
    );
  }
  if (body.fontUnresolved) {
    ctx.warn.add(
      'FONT_SUBSTITUTED',
      `A theme font on slide ${ctx.sourcePage} could not be resolved; the template default is used.`,
      ctx.sourcePage,
    );
  }

  const abs = applyTransform(rect, transform);
  const pct = pxRectToPercent(
    emuToPx(abs.x),
    emuToPx(abs.y),
    emuToPx(abs.cx),
    emuToPx(abs.cy),
    ctx.canvasWpx,
    ctx.canvasHpx,
  );
  if (!pct) return;

  const cfg: Record<string, unknown> = {
    content: body.text,
    fontSize: body.fontSizePx,
    alignment: body.alignment,
    bold: body.bold,
  };
  if (body.color) cfg.color = body.color;
  if (body.fontFamily) cfg.fontFamily = body.fontFamily;

  acc.zones.push({
    name: body.text.slice(0, 40) || 'Text',
    widgetType: 'TEXT',
    ...pct,
    zIndex: acc.zones.length + 1,
    defaultConfig: cfg,
  });
}

function emitPictureZone(
  node: OrderedNode,
  transform: GroupTransform,
  ctx: WalkContext,
  acc: WalkAccumulator,
): void {
  const pic = orderedToMap(node.children);
  const rect = readXfrm(pic?.['p:spPr']);
  if (!rect) return;
  const embed =
    pic?.['p:blipFill']?.['a:blip']?.['@_r:embed'] ??
    pic?.['p:blipFill']?.['a:blip']?.['@_embed'];
  if (!embed) return;
  const mediaPath = ctx.mediaByRelId.get(String(embed));
  if (!mediaPath) {
    ctx.warn.add(
      'MEDIA_UNRESOLVED',
      `A picture on slide ${ctx.sourcePage} points at a part that is not in the file and was not imported.`,
      ctx.sourcePage,
    );
    return;
  }
  const mediaId = ctx.mediaPathToId.get(mediaPath);
  if (!mediaId) {
    ctx.warn.add(
      'MEDIA_UNSUPPORTED',
      `A picture on slide ${ctx.sourcePage} is in a format screens cannot display (${mediaPath.split('.').pop()?.toLowerCase() || 'unknown'}) and was not imported.`,
      ctx.sourcePage,
    );
    return;
  }

  if (Math.abs(rect.rot) > 0.5) {
    ctx.warn.add(
      'SHAPE_ROTATION_IGNORED',
      `A rotated picture on slide ${ctx.sourcePage} was imported upright.`,
      ctx.sourcePage,
    );
  }
  // <a:srcRect> is a crop. We show the whole image, so say so.
  if (pic?.['p:blipFill']?.['a:srcRect']) {
    ctx.warn.add(
      'SHAPE_UNSUPPORTED',
      `A cropped picture on slide ${ctx.sourcePage} was imported uncropped.`,
      ctx.sourcePage,
    );
  }

  const abs = applyTransform(rect, transform);
  const pct = pxRectToPercent(
    emuToPx(abs.x),
    emuToPx(abs.y),
    emuToPx(abs.cx),
    emuToPx(abs.cy),
    ctx.canvasWpx,
    ctx.canvasHpx,
  );
  if (!pct) return;

  acc.zones.push({
    name: 'Image',
    widgetType: 'IMAGE',
    ...pct,
    zIndex: acc.zones.length + 1,
    defaultConfig: { fit: 'contain' },
    mediaRef: mediaId,
  });
}

// ─── Backgrounds ──────────────────────────────────────────────────────

/**
 * Resolve a `<p:bg>` node to a hex colour.
 *
 * Handles the three shapes real exporters emit:
 *   - `<p:bgPr><a:solidFill>` with `a:srgbClr` OR `a:schemeClr`
 *   - `<p:bgPr><a:gradFill>` — approximated with its first stop
 *   - `<p:bgRef idx="1001"><a:schemeClr val="dk2"/></p:bgRef>`, the
 *     theme-referenced form PowerPoint writes by default. `idx` selects
 *     a fill style from the theme whose colour IS the referenced one
 *     (`phClr`), so the referenced colour is the answer.
 */
function resolveBackground(
  bg: any,
  ctx: ColorContext,
  warn: WarningSink,
  sourcePage: number,
): string | null {
  if (!bg || typeof bg !== 'object') return null;

  const bgPr = bg['p:bgPr'];
  if (bgPr && typeof bgPr === 'object') {
    const solid = bgPr['a:solidFill'];
    if (solid) {
      const hex = resolveColorNode(solid, ctx);
      if (hex) return hex;
      warn.add(
        'COLOR_UNRESOLVED',
        `The background colour of slide ${sourcePage} could not be resolved; the template default is used.`,
        sourcePage,
      );
      return null;
    }
    const grad = bgPr['a:gradFill'];
    if (grad) {
      const stops = asArray(grad['a:gsLst']?.['a:gs']);
      for (const stop of stops) {
        const hex = resolveColorNode(stop, ctx);
        if (hex) {
          warn.add(
            'COLOR_APPROXIMATED',
            `The gradient background of slide ${sourcePage} was imported as its first colour.`,
            sourcePage,
          );
          return hex;
        }
      }
      return null;
    }
    if (bgPr['a:blipFill'] || bgPr['a:pattFill']) {
      warn.add(
        'BACKGROUND_UNSUPPORTED',
        `The picture or pattern background of slide ${sourcePage} was not imported.`,
        sourcePage,
      );
      return null;
    }
  }

  const bgRef = bg['p:bgRef'];
  if (bgRef && typeof bgRef === 'object') {
    const hex = resolveColorNode(bgRef, ctx);
    if (hex) return hex;
    warn.add(
      'COLOR_UNRESOLVED',
      `The theme background of slide ${sourcePage} could not be resolved; the template default is used.`,
      sourcePage,
    );
  }
  return null;
}

// ─── Entry point ──────────────────────────────────────────────────────

/**
 * Parse a PPTX buffer into a ParsedDocument (one ParsedPage per SOURCE
 * slide, including slides that produced nothing and slides a cap
 * excluded). Throws on a non-PPTX / corrupt archive, and on a resource
 * guard, so the caller can reject the upload rather than pretend.
 */
export async function parsePptx(buffer: Buffer): Promise<ParsedDocument> {
  const zip = await JSZip.loadAsync(buffer);
  const warn = new WarningSink();

  // 2026-06-09 Fable audit — decompression-bomb guard. MAX_BYTES (in the
  // controller) caps the COMPRESSED upload (~50MB), but JSZip inflates slide
  // XML + every media part unbounded below, so a crafted ~50MB archive can
  // expand to GBs and OOM the shared API process. Sum the declared
  // uncompressed sizes from the central directory and reject BEFORE any
  // .async() decompression. (Catches the standard high-ratio bomb; the
  // liar-zip case is caught by MAX_MEDIA_BYTES on actually-inflated bytes.)
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
      const pres = parseXml(presXml).map;
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
  const sourcePageCount = slidePaths.length;
  if (sourcePageCount === 0) {
    return { pages: [], media: [], sourcePageCount: 0, warnings: warn.list() };
  }

  // 3. First pass: collect every serveable media part referenced by any
  //    slide, assigning each a stable id. We index the media GLOBALLY
  //    (deduped by zip path) so a logo reused on 10 slides uploads once.
  const allMediaPaths = new Set<string>();
  const slideRelsCache = new Map<string, PartRels>();
  for (const sp of slidePaths) {
    const rels = await readRelsFor(zip, sp);
    slideRelsCache.set(sp, rels);
    for (const p of rels.media.values()) allMediaPaths.add(p);
  }

  const media: ExtractedMedia[] = [];
  const mediaPathToId = new Map<string, string>();
  let mediaIdx = 0;
  let mediaBytes = 0;
  for (const path of allMediaPaths) {
    const mime = mediaMime(path);
    if (!mime) continue; // emf/wmf/etc — the zone warns when it can't resolve
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

  // 4. Build a page per SOURCE slide — including the ones a cap excludes.
  const pages: ParsedPage[] = [];
  const layoutCache = new Map<string, LayoutChain>();

  for (let index = 0; index < slidePaths.length; index++) {
    const sourcePage = index + 1;
    if (pages.length >= MAX_ACCOUNTED_PAGES) break;

    if (sourcePage > MAX_SLIDES) {
      pages.push({
        sourcePage,
        label: `Slide ${sourcePage}`,
        screenWidth: canvasWpx,
        screenHeight: canvasHpx,
        zones: [],
        disposition: 'excluded-by-limit',
        warnings: [],
      });
      continue;
    }

    const sp = slidePaths[index];
    const pageWarn = new WarningSink(40);
    const slideXml = await zip.file(sp)?.async('string');
    let slideDoc: { ordered: OrderedNode[]; map: any } | null = null;
    if (slideXml) {
      try {
        slideDoc = parseXml(slideXml);
      } catch {
        slideDoc = null;
      }
    }

    if (!slideDoc) {
      pageWarn.add(
        'PAGE_UNREADABLE',
        `Slide ${sourcePage} could not be read and was not imported.`,
        sourcePage,
      );
      pages.push({
        sourcePage,
        label: `Slide ${sourcePage}`,
        screenWidth: canvasWpx,
        screenHeight: canvasHpx,
        zones: [],
        disposition: 'empty',
        warnings: pageWarn.list(),
      });
      continue;
    }

    const rels = slideRelsCache.get(sp) ?? EMPTY_RELS;
    const chain = await resolveLayoutChain(zip, rels, layoutCache);
    const colorContext: ColorContext = {
      theme: chain.theme,
      colorMap: chain.colorMap,
    };

    const spTreeOrdered = pathByTag(
      slideDoc.ordered,
      'p:sld',
      'p:cSld',
      'p:spTree',
    );
    const acc: WalkAccumulator = { zones: [], truncated: false };
    if (spTreeOrdered) {
      walkShapes(
        spTreeOrdered.children,
        IDENTITY,
        {
          canvasWpx,
          canvasHpx,
          mediaByRelId: rels.media,
          mediaPathToId,
          layoutPlaceholders: chain.layoutPlaceholders,
          masterPlaceholders: chain.masterPlaceholders,
          masterTextStyles: chain.masterTextStyles,
          colorContext,
          theme: chain.theme,
          sourcePage,
          warn: pageWarn,
        },
        acc,
      );
    }

    if (acc.truncated) {
      pageWarn.add(
        'ZONES_TRUNCATED',
        `Slide ${sourcePage} has more than ${MAX_ZONES_PER_SLIDE} elements; the rest were not imported.`,
        sourcePage,
      );
    }

    // Background: slide → layout → master, each resolved through the
    // theme and the master's colour map.
    const slideBg = slideDoc.map?.['p:sld']?.['p:cSld']?.['p:bg'];
    const bgColor =
      resolveBackground(slideBg, colorContext, pageWarn, sourcePage) ??
      resolveBackground(chain.layoutBg, colorContext, pageWarn, sourcePage) ??
      resolveBackground(chain.masterBg, colorContext, pageWarn, sourcePage) ??
      // Last resort: the old literal read, so a hand-built archive with
      // an odd namespace still gets its colour.
      ooxmlColorToHex(
        slideBg?.['p:bgPr']?.['a:solidFill']?.['a:srgbClr']?.['@_val'],
      ) ??
      undefined;

    if (acc.zones.length === 0) {
      pageWarn.add(
        'PAGE_EMPTY',
        `Slide ${sourcePage} has nothing we can turn into an editable element.`,
        sourcePage,
      );
    }

    const warnings = pageWarn.list();
    pages.push({
      sourcePage,
      label: `Slide ${sourcePage}`,
      screenWidth: canvasWpx,
      screenHeight: canvasHpx,
      ...(bgColor ? { bgColor } : {}),
      zones: acc.zones,
      disposition: gradeDisposition(acc.zones.length, warnings),
      warnings,
    });
  }

  if (sourcePageCount > MAX_SLIDES) {
    warn.add(
      'PAGES_TRUNCATED',
      `This deck has ${sourcePageCount} slides; only the first ${MAX_SLIDES} were converted.`,
    );
  }
  if (sourcePageCount > MAX_ACCOUNTED_PAGES) {
    warn.add(
      'PAGES_TRUNCATED',
      `Only the first ${MAX_ACCOUNTED_PAGES} slides are listed individually.`,
    );
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

  return {
    pages,
    media: prunedMedia,
    sourcePageCount,
    warnings: warn.list(),
  };
}

// ─── Layout / master / theme chain ────────────────────────────────────

interface LayoutChain {
  layoutPlaceholders?: PlaceholderIndex;
  masterPlaceholders?: PlaceholderIndex;
  masterTextStyles?: MasterTextStyles;
  layoutBg?: any;
  masterBg?: any;
  theme?: OoxmlTheme;
  colorMap?: ColorMap;
}

const EMPTY_CHAIN: LayoutChain = {};

/** Read + parse the .rels for a package part, if present. */
async function readRelsFor(zip: JSZip, partPath: string): Promise<PartRels> {
  const dir = partPath.split('/').slice(0, -1).join('/');
  const file = partPath.split('/').pop() || '';
  const relsPath = `${dir}/_rels/${file}.rels`;
  const relsXml = await zip.file(relsPath)?.async('string');
  return parseRels(relsXml, dir);
}

/**
 * Resolve a slide's layout → master → theme, caching per layout path so
 * a 60-slide deck parses each layout once.
 */
async function resolveLayoutChain(
  zip: JSZip,
  slideRels: PartRels,
  cache: Map<string, LayoutChain>,
): Promise<LayoutChain> {
  const layoutPath = slideRels.byType.get('slideLayout');
  if (!layoutPath) return EMPTY_CHAIN;
  const cached = cache.get(layoutPath);
  if (cached) return cached;

  const chain: LayoutChain = {};
  try {
    const layoutXml = await zip.file(layoutPath)?.async('string');
    if (layoutXml) {
      const layout = parseXml(layoutXml).map;
      const cSld = layout?.['p:sldLayout']?.['p:cSld'];
      chain.layoutPlaceholders = indexPlaceholders(cSld?.['p:spTree']);
      chain.layoutBg = cSld?.['p:bg'];
    }

    const layoutRels = await readRelsFor(zip, layoutPath);
    const masterPath = layoutRels.byType.get('slideMaster');
    if (masterPath) {
      const masterXml = await zip.file(masterPath)?.async('string');
      if (masterXml) {
        const master = parseXml(masterXml).map;
        const cSld = master?.['p:sldMaster']?.['p:cSld'];
        chain.masterPlaceholders = indexPlaceholders(cSld?.['p:spTree']);
        chain.masterBg = cSld?.['p:bg'];
        chain.colorMap = readColorMap(master);
        chain.masterTextStyles = readMasterTextStyles(master);
      }
      const masterRels = await readRelsFor(zip, masterPath);
      const themePath = masterRels.byType.get('theme');
      if (themePath) {
        const themeXml = await zip.file(themePath)?.async('string');
        if (themeXml) chain.theme = readTheme(parseXml(themeXml).map);
      }
    }
  } catch {
    // A malformed layout/master/theme must never fail the import; the
    // slide simply loses the inheritance it would have gained.
  }

  cache.set(layoutPath, chain);
  return chain;
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
      const relsDoc = parseXml(presRels).map;
      const rIdToTarget = new Map<string, string>();
      for (const r of asArray(relsDoc?.Relationships?.Relationship)) {
        const id = r?.['@_Id'];
        const target = r?.['@_Target'];
        const type = String(r?.['@_Type'] || '');
        if (id && target && type.endsWith('/slide')) {
          rIdToTarget.set(String(id), resolveRelTarget('ppt', String(target)));
        }
      }
      const presDoc = parseXml(presXml).map;
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

// Re-export the caps so the controller and tests share one source of truth.
export { MAX_ZONES_PER_SLIDE, MAX_SLIDES, MAX_TEXT_LEN };

// Exported for unit tests — pure helpers with no PPTX I/O.
export const __testables = {
  composeGroup,
  applyTransform,
  resolveBackground,
  indexPlaceholders,
  inheritedPlaceholder,
  readMasterTextStyles,
  resolveRelTarget,
  IDENTITY,
};
