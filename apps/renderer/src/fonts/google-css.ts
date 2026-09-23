/**
 * Answer a Google Fonts stylesheet request (`fonts.googleapis.com/css2?…` or
 * the legacy `/css?…`) from the bundled catalog — the CSS Google would have
 * returned, pointing at files that never leave the container.
 *
 * FAITHFULNESS. The point of the renderer is to show the critic what a screen
 * shows, so this mirrors Google's behaviour where it matters for rendering:
 *   • css2 is STRICT: one family asking for a weight/style/axis value the
 *     family does not have makes Google answer 400 for the WHOLE link, and a
 *     screen then draws every family in that link with a fallback. The same
 *     happens here (and is reported in `fontFallbacks` as google-fonts-error).
 *   • Discrete weights (`wght@400;700`) produce single-weight faces, so a
 *     `font-weight: 600` in the board resolves to 700 exactly as it would in
 *     production; ranges (`wght@300..700`) produce a ranged face.
 *   • The legacy /css API is lenient: unknown variants are dropped.
 * A family we do not bundle cannot be answered at all; it is left out of the
 * CSS and reported as not-bundled.
 */
import { orderSubsets, type CatalogFamily, type FontCatalog } from './catalog.js';

export type FontDisplay = 'auto' | 'block' | 'swap' | 'fallback' | 'optional';
const DISPLAY_VALUES: readonly FontDisplay[] = ['auto', 'block', 'swap', 'fallback', 'optional'];

export type AxisValue = number | [number, number];

export interface StyleSpec {
  italic: boolean;
  weight: AxisValue;
}

export interface FamilyRequest {
  name: string;
  /** Axis tags in the order the request listed them (css2 only). */
  axes: string[];
  specs: StyleSpec[];
  /** Values requested for axes other than ital/wght (opsz, wdth, SOFT…). */
  otherAxes: Record<string, AxisValue[]>;
  /** A css2 selector that could not be parsed at all. */
  malformed: string | null;
}

export interface GoogleFontsRequest {
  api: 'css2' | 'css';
  families: FamilyRequest[];
  display: FontDisplay | null;
}

export interface GeneratedCss {
  status: 200 | 400;
  css: string;
  /** Families answered from the bundle. */
  served: string[];
  /** Families the bundle does not carry. */
  notBundled: string[];
  /** css2 selectors Google would reject (these make the whole answer a 400). */
  invalid: Array<{ family: string; reason: string }>;
}

const GOOGLE_CSS_HOST = 'fonts.googleapis.com';

function parseAxisValue(raw: string): AxisValue | null {
  const s = raw.trim();
  const range = /^(-?\d+(?:\.\d+)?)\.\.(-?\d+(?:\.\d+)?)$/.exec(s);
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    return Number.isFinite(a) && Number.isFinite(b) ? [a, b] : null;
  }
  if (/^-?\d+(?:\.\d+)?$/.test(s)) return Number(s);
  return null;
}

function parseCss2Family(value: string): FamilyRequest {
  const colon = value.indexOf(':');
  const name = (colon === -1 ? value : value.slice(0, colon)).trim();
  const request: FamilyRequest = { name, axes: [], specs: [], otherAxes: {}, malformed: null };
  if (colon === -1) {
    request.specs.push({ italic: false, weight: 400 });
    return request;
  }
  const spec = value.slice(colon + 1);
  const at = spec.indexOf('@');
  if (at === -1) {
    request.malformed = spec;
    return request;
  }
  const axes = spec
    .slice(0, at)
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean);
  request.axes = axes;
  const tuples = spec
    .slice(at + 1)
    .split(';')
    .map((t) => t.trim())
    .filter(Boolean);
  if (axes.length === 0 || tuples.length === 0) {
    request.malformed = spec;
    return request;
  }
  for (const tuple of tuples) {
    const values = tuple.split(',');
    if (values.length !== axes.length) {
      request.malformed = spec;
      return request;
    }
    let italic = false;
    let weight: AxisValue = 400;
    for (let i = 0; i < axes.length; i += 1) {
      const tag = axes[i] as string;
      const parsed = parseAxisValue(values[i] as string);
      if (parsed === null) {
        request.malformed = spec;
        return request;
      }
      if (tag === 'ital') {
        if (parsed !== 0 && parsed !== 1) {
          request.malformed = spec;
          return request;
        }
        italic = parsed === 1;
      } else if (tag === 'wght') {
        weight = parsed;
      } else {
        (request.otherAxes[tag] ??= []).push(parsed);
      }
    }
    request.specs.push({ italic, weight });
  }
  return request;
}

/** Legacy /css variant tokens: 400, 700italic, 700i, bold, bi, regular… */
function parseCss1Variant(token: string): StyleSpec | null {
  const t = token.trim().toLowerCase();
  if (!t) return null;
  const named: Record<string, StyleSpec> = {
    regular: { italic: false, weight: 400 },
    r: { italic: false, weight: 400 },
    normal: { italic: false, weight: 400 },
    italic: { italic: true, weight: 400 },
    i: { italic: true, weight: 400 },
    bold: { italic: false, weight: 700 },
    b: { italic: false, weight: 700 },
    bolditalic: { italic: true, weight: 700 },
    bi: { italic: true, weight: 700 },
  };
  if (named[t]) return named[t] as StyleSpec;
  const m = /^(\d{3})(i|italic)?$/.exec(t);
  if (m) return { italic: Boolean(m[2]), weight: Number(m[1]) };
  return null;
}

function parseCss1Family(value: string): FamilyRequest {
  const [namePart, variantPart] = value.split(':');
  const request: FamilyRequest = { name: (namePart ?? '').trim(), axes: [], specs: [], otherAxes: {}, malformed: null };
  if (!variantPart) {
    request.specs.push({ italic: false, weight: 400 });
    return request;
  }
  for (const token of variantPart.split(',')) {
    const spec = parseCss1Variant(token);
    if (spec) request.specs.push(spec);
  }
  if (request.specs.length === 0) request.specs.push({ italic: false, weight: 400 });
  return request;
}

/** Parse a Google Fonts stylesheet URL. Null when it is not one. */
export function parseGoogleFontsUrl(raw: string): GoogleFontsRequest | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.hostname !== GOOGLE_CSS_HOST) return null;
  const api = url.pathname === '/css2' ? 'css2' : url.pathname === '/css' ? 'css' : null;
  if (!api) return null;
  const displayRaw = url.searchParams.get('display');
  const display = DISPLAY_VALUES.includes(displayRaw as FontDisplay) ? (displayRaw as FontDisplay) : null;
  const families: FamilyRequest[] = [];
  if (api === 'css2') {
    for (const value of url.searchParams.getAll('family')) {
      if (value.trim()) families.push(parseCss2Family(value));
    }
  } else {
    for (const value of url.searchParams.getAll('family')) {
      for (const part of value.split('|')) if (part.trim()) families.push(parseCss1Family(part));
    }
  }
  return { api, families, display };
}

function withinAxis(value: AxisValue, range: { min: number; max: number }): boolean {
  if (Array.isArray(value)) return value[0] <= value[1] && value[0] >= range.min && value[1] <= range.max;
  return value >= range.min && value <= range.max;
}

/** Why Google's css2 API would refuse this family's selector, or null if it would not. */
export function css2Rejection(entry: CatalogFamily, request: FamilyRequest): string | null {
  if (request.malformed !== null) return `malformed selector "${request.malformed}"`;
  for (const tag of request.axes) {
    if (tag === 'ital' || tag === 'wght') continue;
    if (entry.kind === 'static') return `axis ${tag} requested on a static family`;
    const range = entry.axes[tag];
    if (!range) return `axis ${tag} is not an axis of ${entry.family}`;
    for (const value of request.otherAxes[tag] ?? []) {
      if (!withinAxis(value, range)) return `${tag} ${JSON.stringify(value)} outside ${range.min}..${range.max}`;
    }
  }
  for (const spec of request.specs) {
    if (spec.italic && !entry.italic) return `${entry.family} has no italic`;
    if (entry.kind === 'variable') {
      const range = entry.wght ?? { min: 400, max: 400 };
      if (!withinAxis(spec.weight, range)) {
        return `weight ${JSON.stringify(spec.weight)} outside ${range.min}..${range.max}`;
      }
    } else if (Array.isArray(spec.weight)) {
      return `weight range ${spec.weight[0]}..${spec.weight[1]} requested on a static family`;
    } else if (!entry.weights.includes(spec.weight)) {
      return `weight ${spec.weight} not in ${entry.family} (${entry.weights.join(', ')})`;
    }
  }
  return null;
}

/** Which variable file variant carries the axes a request asked for. */
export function pickVariant(entry: CatalogFamily, axes: string[]): string {
  const has = (v: string) => entry.variants.includes(v);
  const extra = axes.filter((a) => a !== 'wght' && a !== 'ital');
  const fallback = has('wght') ? 'wght' : has('standard') ? 'standard' : (entry.variants[0] ?? 'wght');
  if (extra.length === 0) return fallback;
  if (extra.length === 1 && has((extra[0] as string).toLowerCase())) return (extra[0] as string).toLowerCase();
  const registered = new Set(['opsz', 'wdth', 'slnt', 'ital', 'wght']);
  if (extra.every((a) => registered.has(a)) && has('standard')) return 'standard';
  if (has('full')) return 'full';
  return fallback;
}

function weightDescriptor(weight: AxisValue): string {
  return Array.isArray(weight) ? `${weight[0]} ${weight[1]}` : String(weight);
}

function stretchDescriptor(values: AxisValue[] | undefined): string | null {
  if (!values || values.length === 0) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    const [a, b] = Array.isArray(v) ? v : [v, v];
    min = Math.min(min, a);
    max = Math.max(max, b);
  }
  return min === max ? `${min}%` : `${min}% ${max}%`;
}

export interface FaceRule {
  family: string;
  style: 'normal' | 'italic';
  weight: string;
  stretch: string | null;
  url: string;
  unicodeRange: string;
  subset: string;
}

/** The @font-face rules one family request expands to, one per (spec × subset) on disk. */
export function facesFor(entry: CatalogFamily, request: FamilyRequest, catalog: FontCatalog): FaceRule[] {
  const faces: FaceRule[] = [];
  const seen = new Set<string>();
  const stretch = entry.kind === 'variable' ? stretchDescriptor(request.otherAxes.wdth) : null;
  const variant = entry.kind === 'variable' ? pickVariant(entry, request.axes) : '';
  for (const spec of request.specs) {
    const style: 'normal' | 'italic' = spec.italic ? 'italic' : 'normal';
    if (spec.italic && !entry.italic) continue;
    let weights: AxisValue[];
    if (entry.kind === 'variable') {
      weights = [spec.weight];
    } else if (Array.isArray(spec.weight)) {
      const [lo, hi] = spec.weight;
      weights = entry.weights.filter((w) => w >= lo && w <= hi);
    } else {
      weights = entry.weights.includes(spec.weight) ? [spec.weight] : [];
    }
    for (const weight of weights) {
      const key = `${style}|${weightDescriptor(weight)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      for (const subset of orderSubsets(entry.subsets)) {
        const file =
          entry.kind === 'variable'
            ? `${entry.id}-${subset}-${variant}-${style}.woff2`
            : `${entry.id}-${subset}-${weight as number}-${style}.woff2`;
        if (!entry.files.has(file)) continue;
        faces.push({
          family: entry.family,
          style,
          weight: weightDescriptor(weight),
          stretch,
          url: catalog.urlFor(entry, file),
          unicodeRange: entry.unicode[subset] ?? 'U+0-10FFFF',
          subset,
        });
      }
    }
  }
  return faces;
}

function renderFace(face: FaceRule, display: FontDisplay | null): string {
  const lines = [
    `/* ${face.subset} */`,
    '@font-face {',
    `  font-family: '${face.family}';`,
    `  font-style: ${face.style};`,
    `  font-weight: ${face.weight};`,
  ];
  if (face.stretch) lines.push(`  font-stretch: ${face.stretch};`);
  if (display) lines.push(`  font-display: ${display};`);
  lines.push(`  src: url(${face.url}) format('woff2');`, `  unicode-range: ${face.unicodeRange};`, '}');
  return lines.join('\n');
}

export function generateGoogleFontsCss(request: GoogleFontsRequest, catalog: FontCatalog): GeneratedCss {
  const served: string[] = [];
  const notBundled: string[] = [];
  const invalid: Array<{ family: string; reason: string }> = [];
  const blocks: string[] = [];
  for (const family of request.families) {
    const entry = catalog.families.get(family.name.toLowerCase());
    if (!entry) {
      if (family.name) notBundled.push(family.name);
      continue;
    }
    if (request.api === 'css2') {
      const reason = css2Rejection(entry, family);
      if (reason) {
        invalid.push({ family: entry.family, reason });
        continue;
      }
    }
    const faces = facesFor(entry, family, catalog);
    if (faces.length === 0) continue;
    served.push(entry.family);
    for (const face of faces) blocks.push(renderFace(face, request.display));
  }
  if (request.api === 'css2' && invalid.length > 0) {
    return { status: 400, css: '', served: [], notBundled, invalid };
  }
  return { status: 200, css: blocks.join('\n'), served, notBundled, invalid };
}

/** Faces that make a system family name draw with its bundled look-alike. */
export function substituteFaces(catalog: FontCatalog): FaceRule[] {
  const faces: FaceRule[] = [];
  for (const [system, target] of Object.entries(catalog.manifest.substitutes)) {
    const entry = catalog.families.get(target.toLowerCase());
    if (!entry) continue;
    const specs: StyleSpec[] = [];
    const styles = entry.italic ? [false, true] : [false];
    for (const italic of styles) {
      if (entry.kind === 'variable') {
        const range = entry.wght ?? { min: 400, max: 400 };
        specs.push({ italic, weight: range.min === range.max ? range.min : [range.min, range.max] });
      } else {
        for (const w of entry.weights) specs.push({ italic, weight: w });
      }
    }
    const request: FamilyRequest = { name: entry.family, axes: ['wght'], specs, otherAxes: {}, malformed: null };
    for (const face of facesFor(entry, request, catalog)) faces.push({ ...face, family: system });
  }
  return faces;
}
