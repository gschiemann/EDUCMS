/**
 * Where pdf.js lives on disk, and which of its files the raster page may read.
 *
 * The raster pipeline runs with NO network (see `pdf-raster-pipeline.ts`), so
 * every byte pdf.js would normally fetch has to come from the filesystem. Two
 * kinds of byte need that:
 *
 *   • THE CODE — `pdf.mjs` and `pdf.worker.mjs`, read once and injected into
 *     the page as blob URLs.
 *   • THE FONT DATA — `standard_fonts/` (the 14 PDF base fonts, which a PDF is
 *     allowed to reference without embedding) and `cmaps/` (CJK character
 *     maps). pdf.js asks for these by URL at render time. Left unresolvable,
 *     a document that references Helvetica renders with the wrong metrics or
 *     no glyphs at all — the audit saw exactly that as a stream of
 *     `standardFontDataUrl` warnings.
 *
 * Nothing here is packaged or copied: `pdfjs-dist` ships all four directories
 * inside the installed package, and the runtime image already carries them
 * because `imports/parsers/pdf-parser.ts` imports the same build at runtime.
 * This module just says where they are, and refuses to serve anything else.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

/**
 * The LEGACY build, matching `imports/parsers/pdf-parser.ts`.
 *
 * "Legacy" here means ES2017-compatible output, not an old version: it is what
 * pdf.js ships for engines without the newest syntax, and it is what the
 * shipped Chromium and the Node-side parser already agree on. Using the same
 * build in both places means a PDF that parses for text and a PDF that
 * rasterizes are being read by identical code.
 */
const PDFJS_MODULE_SPECIFIER = 'pdfjs-dist/legacy/build/pdf.mjs';

/** Directories inside `pdfjs-dist` the render page may read from. Nothing else. */
const SERVABLE_DIRS = ['standard_fonts', 'cmaps'] as const;

/** `standard_fonts/FoxitSans.pfb`, `cmaps/UniJIS-UCS2-H.bcmap` — nothing exotic. */
const ASSET_PATH = /^(standard_fonts|cmaps)\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export interface PdfjsAssets {
  /** Absolute path of the installed `pdfjs-dist` package. */
  packageRoot: string;
  /** Source of `pdf.mjs`, injected into the page as a blob. */
  moduleSource: string;
  /** Source of `pdf.worker.mjs`, injected the same way. */
  workerSource: string;
}

/**
 * Read pdf.js off disk once per worker process.
 *
 * Throws rather than degrading: a raster job with no pdf.js is not a job that
 * can produce a partial answer, and the caller turns the throw into a typed
 * `pdfjs-unavailable` refusal.
 */
export function loadPdfjsAssets(): PdfjsAssets {
  const modulePath = require.resolve(PDFJS_MODULE_SPECIFIER);
  const buildDir = dirname(modulePath);
  return {
    // legacy/build/pdf.mjs → up two levels is the package root.
    packageRoot: resolve(buildDir, '..', '..'),
    moduleSource: readFileSync(modulePath, 'utf8'),
    workerSource: readFileSync(join(buildDir, 'pdf.worker.mjs'), 'utf8'),
  };
}

/**
 * Resolve one asset request from the render page to a file, or null.
 *
 * Two independent checks, because path handling is where this kind of thing
 * goes wrong: the request must match a narrow allowlist pattern naming one of
 * the two servable directories, AND the resolved absolute path must still sit
 * under the package root. The second catches anything the first did not
 * anticipate — a normalisation quirk, a symlink, a future widening of the
 * pattern.
 */
export function resolvePdfjsAsset(
  packageRoot: string,
  relativePath: string,
): string | null {
  if (!ASSET_PATH.test(relativePath)) return null;
  const absolute = resolve(packageRoot, relativePath);
  const root = packageRoot.endsWith(sep) ? packageRoot : packageRoot + sep;
  if (!absolute.startsWith(root)) return null;
  if (
    !SERVABLE_DIRS.some((dir) =>
      absolute.startsWith(resolve(packageRoot, dir) + sep),
    )
  ) {
    return null;
  }
  return absolute;
}
