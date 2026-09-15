/**
 * OOXML plumbing shared by the PPTX path: an ORDER-PRESERVING XML view,
 * and the theme / colour-map resolution real decks actually need.
 *
 * ── Why the dual view ────────────────────────────────────────────────
 *
 * fast-xml-parser's default (map) output is convenient — `node['a:off']
 * ['@_x']` — but it GROUPS children by tag name, so a slide whose shape
 * tree is `<pic/><sp/><pic/>` comes back as `{ 'p:pic': [a, c], 'p:sp': b }`
 * and the document order is gone. The old walker leaned on that: it drew
 * every text shape, then every picture, so a photo that belongs BEHIND a
 * headline landed on top of it (audit finding, reproduced).
 *
 * `preserveOrder: true` keeps the order but changes every accessor in the
 * file. So we parse ONCE with `preserveOrder`, keep the ordered tree for
 * the shape walk, and convert to the familiar map shape on demand with
 * `orderedToMap` — which reproduces the default parser's output exactly
 * (there is a test asserting deep equality between the two on real slide
 * XML, so this equivalence is proved, not assumed).
 *
 * ── Why the theme resolution ─────────────────────────────────────────
 *
 * A slide background is almost never a literal `<a:srgbClr>`. PowerPoint,
 * Google Slides and Canva all emit `<p:bgRef>` into the theme, or
 * `<a:schemeClr val="dk2"/>`. Reading only the literal case meant a real
 * dark-themed deck imported as its (correctly extracted) WHITE text on the
 * default WHITE canvas — invisible. Resolving scheme colours against the
 * theme, through the slide master's colour map, is what makes an ordinary
 * exported deck arrive looking like itself.
 *
 * Pure and side-effect free: no network, no disk, no DB.
 */

import { XMLParser } from 'fast-xml-parser';

const PARSER_OPTIONS = {
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
  /**
   * 2026-09-15 — THE LEADING-ZERO FIX. Without this, fast-xml-parser
   * coerces a numeric-looking TEXT NODE, so a slide reading `00123`
   * arrives as the number `123`: room numbers, bus routes, student IDs
   * and product codes all change meaning on the way in. Geometry is read
   * from ATTRIBUTES and is explicitly `Number(...)`-cast at every site,
   * so turning tag-value coercion off costs nothing and fixes the text.
   */
  parseTagValue: false,
  processEntities: true,
} as const;

/** Order-preserving parser: children stay in document order. */
const orderedXml = new XMLParser({ ...PARSER_OPTIONS, preserveOrder: true });

/** One element in the order-preserving tree. */
export interface OrderedNode {
  /** The element's tag name. `'#text'` for a text node. */
  tag: string;
  /** Child elements, in document order. Empty for a leaf/self-closing tag. */
  children: OrderedNode[];
  /** Attributes, `@_`-prefixed, or undefined when the element has none. */
  attrs?: Record<string, string>;
  /** Text payload, for `tag === '#text'` only. */
  text?: string;
}

/** Coerce a fast-xml-parser node into an array (it collapses singletons). */
export function asArray<T = any>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

/** Normalise fast-xml-parser's `preserveOrder` output into OrderedNodes. */
function toOrderedNodes(raw: any[]): OrderedNode[] {
  const out: OrderedNode[] = [];
  for (const entry of raw ?? []) {
    if (!entry || typeof entry !== 'object') continue;
    const attrs = entry[':@'] as Record<string, string> | undefined;
    for (const key of Object.keys(entry)) {
      if (key === ':@') continue;
      if (key === '#text') {
        out.push({ tag: '#text', children: [], text: String(entry[key]) });
        continue;
      }
      const kids = entry[key];
      out.push({
        tag: key,
        children: toOrderedNodes(Array.isArray(kids) ? kids : []),
        ...(attrs ? { attrs } : {}),
      });
    }
  }
  return out;
}

/**
 * Convert ordered children back into fast-xml-parser's DEFAULT (map)
 * shape, so every existing map-style accessor keeps working unchanged.
 * Repeats collapse to arrays, attributes merge onto the node, and a
 * text-only element collapses to its string — exactly as the default
 * parser does.
 */
export function orderedToMap(children: ReadonlyArray<OrderedNode>): any {
  const map: any = {};
  let text = '';
  let sawText = false;

  for (const child of children) {
    if (child.tag === '#text') {
      text += child.text ?? '';
      sawText = true;
      continue;
    }
    const inner = orderedToMap(child.children);
    const innerKeys = Object.keys(inner);
    let value: any;
    if (innerKeys.length === 1 && innerKeys[0] === '#text' && !child.attrs) {
      value = inner['#text'];
    } else if (innerKeys.length === 0 && !child.attrs) {
      value = '';
    } else {
      value = child.attrs ? { ...inner, ...child.attrs } : inner;
    }
    if (child.tag in map) {
      map[child.tag] = [...asArray(map[child.tag]), value];
    } else {
      map[child.tag] = value;
    }
  }

  if (sawText) map['#text'] = text;
  return map;
}

/** Both views of one parse: ordered children plus the map shape. */
export interface ParsedXml {
  /** Document-order children of the (virtual) document root. */
  ordered: OrderedNode[];
  /** The familiar `doc['p:sld']['p:cSld']` map shape. */
  map: any;
}

/**
 * Parse an OOXML part once, returning both views. Throws only if the
 * XML is unparseable; callers decide what to do about that.
 */
export function parseXml(source: string): ParsedXml {
  const ordered = toOrderedNodes(orderedXml.parse(source) as any[]);
  return { ordered, map: orderedToMap(ordered) };
}

/** First ordered child with this tag, or undefined. */
export function childByTag(
  nodes: ReadonlyArray<OrderedNode> | undefined,
  tag: string,
): OrderedNode | undefined {
  return nodes?.find((n) => n.tag === tag);
}

/** Walk a tag path through the ordered tree, e.g. `'p:sld','p:cSld'`. */
export function pathByTag(
  nodes: ReadonlyArray<OrderedNode> | undefined,
  ...tags: string[]
): OrderedNode | undefined {
  let cursor = childByTag(nodes, tags[0]);
  for (let i = 1; i < tags.length && cursor; i++) {
    cursor = childByTag(cursor.children, tags[i]);
  }
  return cursor;
}

// ─── Colour maths ─────────────────────────────────────────────────────

/** `#rrggbb` → `{r,g,b}` 0–255, or null. */
export function hexToRgb(
  hex: string,
): { r: number; g: number; b: number } | null {
  const s = hex.replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
  return {
    r: parseInt(s.slice(0, 2), 16),
    g: parseInt(s.slice(2, 4), 16),
    b: parseInt(s.slice(4, 6), 16),
  };
}

/** `{r,g,b}` 0–255 → `#rrggbb`. */
export function rgbToHex(r: number, g: number, b: number): string {
  const to = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

function rgbToHsl(r: number, g: number, b: number) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return { h, s, l };
}

function hslToRgb(h: number, s: number, l: number) {
  if (s === 0) {
    const v = l * 255;
    return { r: v, g: v, b: v };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return {
    r: hue(h + 1 / 3) * 255,
    g: hue(h) * 255,
    b: hue(h - 1 / 3) * 255,
  };
}

/**
 * The `<a:schemeClr>` / `<a:srgbClr>` child transforms real exporters
 * emit. Values are OOXML per-mille (`val="60000"` = 60%).
 *
 * `shade`/`tint` are the DrawingML linear RGB transforms; `lumMod`/
 * `lumOff` modulate/offset HSL lightness, which is how PowerPoint's
 * "Darker 25%" / "Lighter 40%" theme variants are stored — and those
 * variants are exactly what a themed deck uses for its background.
 */
export interface ColorTransforms {
  shade?: number;
  tint?: number;
  lumMod?: number;
  lumOff?: number;
}

/** Apply DrawingML colour transforms to a `#rrggbb` base. */
export function applyColorTransforms(hex: string, t: ColorTransforms): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  let { r, g, b } = rgb;

  if (typeof t.shade === 'number' && t.shade >= 0) {
    const k = t.shade;
    r *= k;
    g *= k;
    b *= k;
  }
  if (typeof t.tint === 'number' && t.tint >= 0) {
    const k = t.tint;
    r = r * k + 255 * (1 - k);
    g = g * k + 255 * (1 - k);
    b = b * k + 255 * (1 - k);
  }
  if (typeof t.lumMod === 'number' || typeof t.lumOff === 'number') {
    const hsl = rgbToHsl(r, g, b);
    let l = hsl.l;
    if (typeof t.lumMod === 'number') l *= t.lumMod;
    if (typeof t.lumOff === 'number') l += t.lumOff;
    l = Math.max(0, Math.min(1, l));
    const back = hslToRgb(hsl.h, hsl.s, l);
    r = back.r;
    g = back.g;
    b = back.b;
  }
  return rgbToHex(r, g, b);
}

/** Read a per-mille child transform (`<a:lumMod val="60000"/>`) as 0–n. */
function perMille(node: any, tag: string): number | undefined {
  const raw = node?.[tag]?.['@_val'];
  if (raw == null) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  return n / 100000;
}

function readTransforms(node: any): ColorTransforms {
  return {
    shade: perMille(node, 'a:shade'),
    tint: perMille(node, 'a:tint'),
    lumMod: perMille(node, 'a:lumMod'),
    lumOff: perMille(node, 'a:lumOff'),
  };
}

// ─── Theme ────────────────────────────────────────────────────────────

/** The parts of a theme this converter uses. */
export interface OoxmlTheme {
  /** Scheme slot (`dk1`, `accent1`, …) → `#rrggbb`. */
  colors: Record<string, string>;
  /** Major (headings) latin typeface, if declared. */
  majorFont?: string;
  /** Minor (body) latin typeface, if declared. */
  minorFont?: string;
}

const SCHEME_SLOTS = [
  'dk1',
  'lt1',
  'dk2',
  'lt2',
  'accent1',
  'accent2',
  'accent3',
  'accent4',
  'accent5',
  'accent6',
  'hlink',
  'folHlink',
];

/** One `<a:dk1><a:sysClr lastClr="000000"/></a:dk1>` slot → hex. */
function slotColor(slot: any): string | null {
  if (!slot || typeof slot !== 'object') return null;
  const srgb = slot['a:srgbClr']?.['@_val'];
  if (typeof srgb === 'string' && /^[0-9a-fA-F]{6}$/.test(srgb)) {
    return `#${srgb.toLowerCase()}`;
  }
  // <a:sysClr val="windowText" lastClr="000000"/> — lastClr is the
  // resolved value the authoring app saw, which is what we want.
  const sys = slot['a:sysClr']?.['@_lastClr'];
  if (typeof sys === 'string' && /^[0-9a-fA-F]{6}$/.test(sys)) {
    return `#${sys.toLowerCase()}`;
  }
  return null;
}

/** Parse a `theme1.xml` map into the slots + fonts we use. */
export function readTheme(themeMap: any): OoxmlTheme {
  const elements = themeMap?.['a:theme']?.['a:themeElements'];
  const scheme = elements?.['a:clrScheme'];
  const colors: Record<string, string> = {};
  for (const slot of SCHEME_SLOTS) {
    const hex = slotColor(scheme?.[`a:${slot}`]);
    if (hex) colors[slot] = hex;
  }
  const fonts = elements?.['a:fontScheme'];
  const major = fonts?.['a:majorFont']?.['a:latin']?.['@_typeface'];
  const minor = fonts?.['a:minorFont']?.['a:latin']?.['@_typeface'];
  return {
    colors,
    ...(typeof major === 'string' && major ? { majorFont: major } : {}),
    ...(typeof minor === 'string' && minor ? { minorFont: minor } : {}),
  };
}

/**
 * The slide master's `<p:clrMap>`, which renames the scheme slots a
 * slide may reference: `bg1` usually means `lt1`, `tx1` means `dk1`,
 * and a deck with a dark theme flips them. Ignoring the map is how a
 * dark deck's `bg1` resolves to white.
 */
export type ColorMap = Record<string, string>;

const CLR_MAP_KEYS = [
  'bg1',
  'tx1',
  'bg2',
  'tx2',
  'accent1',
  'accent2',
  'accent3',
  'accent4',
  'accent5',
  'accent6',
  'hlink',
  'folHlink',
];

/** Read `<p:clrMap bg1="lt1" tx1="dk1" …/>` from a slide master map. */
export function readColorMap(masterMap: any): ColorMap {
  const node = masterMap?.['p:sldMaster']?.['p:clrMap'];
  const out: ColorMap = {};
  if (!node || typeof node !== 'object') return out;
  for (const key of CLR_MAP_KEYS) {
    const v = node[`@_${key}`];
    if (typeof v === 'string' && v) out[key] = v;
  }
  return out;
}

/** The context needed to turn any DrawingML colour node into a hex. */
export interface ColorContext {
  theme?: OoxmlTheme;
  colorMap?: ColorMap;
  /**
   * The colour `phClr` (placeholder colour) stands for, when resolving a
   * style reference such as `<p:bgRef>`'s fill.
   */
  placeholder?: string | null;
}

/**
 * Resolve a container that may hold `<a:srgbClr>`, `<a:schemeClr>` or
 * `<a:sysClr>` (with transforms) into `#rrggbb`.
 *
 * Returns null when the colour genuinely cannot be resolved — the
 * caller then leaves the field unset so the widget default applies,
 * and (where it matters) records a `COLOR_UNRESOLVED` warning.
 */
export function resolveColorNode(
  container: any,
  ctx: ColorContext = {},
): string | null {
  if (!container || typeof container !== 'object') return null;

  const srgb = container['a:srgbClr'];
  if (srgb) {
    const val = typeof srgb === 'object' ? srgb['@_val'] : srgb;
    if (typeof val === 'string' && /^[0-9a-fA-F]{6}$/.test(val)) {
      return applyColorTransforms(
        `#${val.toLowerCase()}`,
        readTransforms(typeof srgb === 'object' ? srgb : {}),
      );
    }
  }

  const sys = container['a:sysClr'];
  if (sys && typeof sys === 'object') {
    const last = sys['@_lastClr'];
    if (typeof last === 'string' && /^[0-9a-fA-F]{6}$/.test(last)) {
      return applyColorTransforms(
        `#${last.toLowerCase()}`,
        readTransforms(sys),
      );
    }
  }

  const schemeNode = container['a:schemeClr'];
  if (schemeNode) {
    const raw =
      typeof schemeNode === 'object' ? schemeNode['@_val'] : schemeNode;
    const base = resolveSchemeSlot(
      typeof raw === 'string' ? raw : undefined,
      ctx,
    );
    if (base) {
      return applyColorTransforms(
        base,
        readTransforms(typeof schemeNode === 'object' ? schemeNode : {}),
      );
    }
  }

  return null;
}

/** `bg1` / `dk2` / `accent3` / `phClr` → `#rrggbb`, via the colour map. */
export function resolveSchemeSlot(
  slot: string | undefined,
  ctx: ColorContext = {},
): string | null {
  if (!slot) return null;
  if (slot === 'phClr') return ctx.placeholder ?? null;
  const mapped = ctx.colorMap?.[slot] ?? slot;
  return ctx.theme?.colors?.[mapped] ?? ctx.theme?.colors?.[slot] ?? null;
}
