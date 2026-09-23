/**
 * The bundled-font catalog: everything the renderer needs to answer a Google
 * Fonts request from disk, built once at boot from the manifest and each
 * fontsource package's own metadata.json / unicode.json.
 *
 * The files are served at a URL on the REAL gstatic host
 * (`https://fonts.gstatic.com/s/vosr/<v|s>/<id>/<file>.woff2`) so a board's
 * own CSP (`font-src https://fonts.gstatic.com`, which the API's srcdoc CSP
 * sets) admits them exactly as it would admit Google's. The request never
 * leaves Chromium: interception answers it from the allowlist below, and the
 * allowlist is the exact set of file names found on disk at boot — a path is
 * looked up, never joined, so there is no traversal to get wrong.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { packageRoot } from '../paths.js';
import { fontsourceId, loadManifest, type FontManifest } from './manifest.js';

export const FONT_ORIGIN = 'https://fonts.gstatic.com';
export const FONT_PATH_PREFIX = '/s/vosr/';

export interface AxisRange {
  min: number;
  max: number;
}

export interface CatalogFamily {
  /** Canonical family name, e.g. "Source Serif 4". */
  family: string;
  /** fontsource id, e.g. "source-serif-4". */
  id: string;
  pkg: string;
  /** 'v' variable (@fontsource-variable), 's' static (@fontsource). */
  scope: 'v' | 's';
  kind: 'variable' | 'static';
  /** Absolute path of the package's files/ directory. */
  filesDir: string;
  /** Static: the shipped weights. Variable: the named instances (informational). */
  weights: number[];
  /** Variable weight axis, when there is one. */
  wght: AxisRange | null;
  /** Every variable axis by tag (as fontsource spells it: 'opsz', 'wdth', 'SOFT'…). */
  axes: Record<string, AxisRange>;
  italic: boolean;
  /** Variable-file variants present on disk: 'wght', 'standard', 'full', 'opsz'… */
  variants: string[];
  subsets: string[];
  unicode: Record<string, string>;
  /** woff2 basenames actually on disk — the serving allowlist. */
  files: Set<string>;
}

export interface FontCatalog {
  manifest: FontManifest;
  /** lower-cased family → entry. */
  families: Map<string, CatalogFamily>;
  /** lower-cased system family ("impact") → the bundled look-alike. */
  substitutes: Map<string, CatalogFamily>;
  /** Absolute path for a gstatic `/s/vosr/…` path, or null if it is not ours. */
  resolveFontPath(urlPath: string): string | null;
  /** The URL a given bundled file is served at. */
  urlFor(entry: CatalogFamily, file: string): string;
}

interface FontsourceMetadata {
  family: string;
  subsets: string[];
  weights: number[];
  styles: string[];
  variable?: Record<string, { min: string | number; max: string | number }> | false;
}

/** Subset order for emitted CSS: everything else first, then latin-ext, then latin (checked first). */
export function orderSubsets(subsets: string[]): string[] {
  const rank = (s: string) => (s === 'latin' ? 2 : s === 'latin-ext' ? 1 : 0);
  return [...subsets].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

function loadEntry(family: string, pkg: string, req: NodeRequire): CatalogFamily {
  const pkgJson = req.resolve(`${pkg}/package.json`);
  const dir = path.dirname(pkgJson);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'metadata.json'), 'utf8')) as FontsourceMetadata;
  const unicode = JSON.parse(fs.readFileSync(path.join(dir, 'unicode.json'), 'utf8')) as Record<string, string>;
  const filesDir = path.join(dir, 'files');
  const files = new Set(fs.readdirSync(filesDir).filter((f) => f.endsWith('.woff2')));
  const id = fontsourceId(family);
  const variable = pkg.startsWith('@fontsource-variable/');
  const axes: Record<string, AxisRange> = {};
  if (variable && meta.variable) {
    for (const [tag, range] of Object.entries(meta.variable)) {
      if (tag === 'ital') continue;
      axes[tag] = { min: Number(range.min), max: Number(range.max) };
    }
  }
  const variants = new Set<string>();
  if (variable) {
    const re = new RegExp(`^${id}-(.+)-([a-z0-9]+)-(normal|italic)\\.woff2$`);
    for (const f of files) {
      const m = re.exec(f);
      if (m?.[2]) variants.add(m[2]);
    }
  }
  return {
    family: meta.family || family,
    id,
    pkg,
    scope: variable ? 'v' : 's',
    kind: variable ? 'variable' : 'static',
    filesDir,
    weights: (meta.weights ?? []).map(Number).filter((n) => Number.isFinite(n)).sort((a, b) => a - b),
    wght: axes.wght ?? null,
    axes,
    italic: (meta.styles ?? []).includes('italic'),
    variants: [...variants].sort(),
    subsets: orderSubsets((meta.subsets ?? []).filter((s) => typeof unicode[s] === 'string')),
    unicode,
    files,
  };
}

export function loadFontCatalog(manifest: FontManifest = loadManifest()): FontCatalog {
  const req = createRequire(path.join(packageRoot(), 'package.json'));
  const families = new Map<string, CatalogFamily>();
  for (const [family, pkg] of Object.entries(manifest.families)) {
    families.set(family.toLowerCase(), loadEntry(family, pkg, req));
  }
  const substitutes = new Map<string, CatalogFamily>();
  for (const [system, target] of Object.entries(manifest.substitutes)) {
    const entry = families.get(target.toLowerCase());
    if (entry) substitutes.set(system.toLowerCase(), entry);
  }
  const byScopeId = new Map<string, CatalogFamily>();
  for (const entry of families.values()) byScopeId.set(`${entry.scope}/${entry.id}`, entry);

  return {
    manifest,
    families,
    substitutes,
    resolveFontPath(urlPath: string): string | null {
      if (!urlPath.startsWith(FONT_PATH_PREFIX)) return null;
      const m = /^([vs])\/([a-z0-9-]+)\/([a-z0-9-]+\.woff2)$/.exec(urlPath.slice(FONT_PATH_PREFIX.length));
      if (!m) return null;
      const entry = byScopeId.get(`${m[1]}/${m[2]}`);
      if (!entry || !entry.files.has(m[3] as string)) return null;
      return path.join(entry.filesDir, m[3] as string);
    },
    urlFor(entry: CatalogFamily, file: string): string {
      return `${FONT_ORIGIN}${FONT_PATH_PREFIX}${entry.scope}/${entry.id}/${file}`;
    },
  };
}
