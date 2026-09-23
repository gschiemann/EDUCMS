/**
 * The font manifest: which families the renderer ships, and from which npm
 * package each one comes.
 *
 * `fonts/manifest.json` is GENERATED (`pnpm --filter renderer gen:fonts`) from
 * `DESIGNER_FONTS` in apps/api/src/ai/designer-prompt.ts — the list the AI
 * Designer is told it may use — plus the look-alikes for the system faces the
 * flagship exemplar boards name (Impact, Arial, Georgia…). The prompt agent is
 * free to change that list; `test/unit/font-manifest.test.ts` goes red the
 * moment the manifest and the prompt disagree, so a new Designer font can
 * never silently render as a fallback here.
 */
import fs from 'node:fs';
import path from 'node:path';
import { packageRoot } from '../paths.js';

export interface FontManifest {
  generatedFrom: string;
  /** DESIGNER_FONTS, verbatim and in order. */
  designerFonts: string[];
  /**
   * System family (as a board writes it) → bundled look-alike. These faces are
   * proprietary and cannot ship; the look-alike is metric-compatible where one
   * exists (Arimo ≈ Arial, Tinos ≈ Times New Roman, Gelasio ≈ Georgia) and the
   * closest free cut otherwise (Anton for Impact).
   */
  substitutes: Record<string, string>;
  /** Every bundled family → its npm package. */
  families: Record<string, string>;
}

/** Look-alikes for the system faces the exemplar boards use. Policy, not data. */
export const SUBSTITUTES: Readonly<Record<string, string>> = Object.freeze({
  Impact: 'Anton',
  Arial: 'Arimo',
  Helvetica: 'Arimo',
  'Helvetica Neue': 'Arimo',
  Georgia: 'Gelasio',
  'Times New Roman': 'Tinos',
  Times: 'Tinos',
});

/**
 * Pull the `DESIGNER_FONTS` string literals out of designer-prompt.ts.
 *
 * A literal parse rather than an import: the renderer must never execute API
 * code, and the constant is a plain array of quoted names. Comments inside the
 * array are skipped so a quoted word in a comment cannot become a font.
 */
export function extractDesignerFonts(source: string): string[] {
  const start = source.search(/export\s+const\s+DESIGNER_FONTS\s*=\s*\[/);
  if (start === -1) throw new Error('DESIGNER_FONTS not found in designer-prompt.ts');
  const open = source.indexOf('[', start);
  const close = source.indexOf(']', open);
  if (open === -1 || close === -1) throw new Error('DESIGNER_FONTS array is malformed');
  const body = source
    .slice(open + 1, close)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  const names: string[] = [];
  const re = /'([^'\\]*)'|"([^"\\]*)"/g;
  for (let m = re.exec(body); m; m = re.exec(body)) {
    const name = (m[1] ?? m[2] ?? '').trim();
    if (name) names.push(name);
  }
  if (names.length === 0) throw new Error('DESIGNER_FONTS is empty');
  return names;
}

/** fontsource's package id for a family: "Source Serif 4" → "source-serif-4". */
export function fontsourceId(family: string): string {
  return family.trim().toLowerCase().replace(/\s+/g, '-');
}

export function manifestPath(): string {
  return path.join(packageRoot(), 'fonts', 'manifest.json');
}

export function loadManifest(file = manifestPath()): FontManifest {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<FontManifest>;
  if (!Array.isArray(raw.designerFonts) || typeof raw.families !== 'object' || raw.families === null) {
    throw new Error(`font manifest ${file} is malformed — regenerate it with \`pnpm --filter renderer gen:fonts\``);
  }
  return {
    generatedFrom: String(raw.generatedFrom ?? ''),
    designerFonts: raw.designerFonts.map(String),
    substitutes: { ...(raw.substitutes ?? {}) },
    families: { ...raw.families },
  };
}
