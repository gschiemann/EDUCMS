/**
 * Test environment helpers: where Chromium is, where the repo is, and how to
 * turn a board that references /templates/… assets into a self-contained one.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { packageRoot } from '../../src/paths.js';
import { DEFAULT_CHROMIUM_PATHS } from '../../src/browser.js';

export function repoRoot(): string {
  return path.resolve(packageRoot(), '..', '..');
}

export function fixturePath(name: string): string {
  return path.join(packageRoot(), 'test', 'fixtures', name);
}

/**
 * A Chromium to drive, or null (integration tests then SKIP, loudly).
 * Order: CHROME_PATH, PUPPETEER_EXECUTABLE_PATH, the Playwright Chromium the
 * repo's e2e suite installs, then the usual system locations.
 */
export function findChromium(): string | null {
  for (const v of [process.env.CHROME_PATH, process.env.PUPPETEER_EXECUTABLE_PATH]) {
    if (v && v.trim() && fs.existsSync(v.trim())) return v.trim();
  }
  try {
    const req = createRequire(path.join(packageRoot(), 'package.json'));
    const pw = req('playwright-core') as { chromium: { executablePath(): string } };
    const p = pw.chromium.executablePath();
    if (p && fs.existsSync(p)) return p;
  } catch {
    /* playwright-core absent or its browser not installed */
  }
  return DEFAULT_CHROMIUM_PATHS.find((p) => fs.existsSync(p)) ?? null;
}

/**
 * The Chromium for an integration test file, and the skip reason when there
 * is none. With RENDERER_REQUIRE_CHROMIUM=1 (CI) a missing browser is a hard
 * failure instead: a suite that silently skips its browser half is green and
 * meaningless.
 */
export function chromiumForTests(): { chromium: string | null; skip: string | false } {
  const chromium = findChromium();
  if (!chromium && process.env.RENDERER_REQUIRE_CHROMIUM === '1') {
    throw new Error('RENDERER_REQUIRE_CHROMIUM=1 but no Chromium was found — set CHROME_PATH');
  }
  return { chromium, skip: chromium ? false : 'no Chromium found (set CHROME_PATH) — browser integration tests skipped' };
}

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
};

/** Replace every `/templates/…` asset reference with a data: URI of the file (what the API does before rendering). */
export function inlineWebAssets(html: string): string {
  const pub = path.join(repoRoot(), 'apps', 'web', 'public');
  return html.replace(/(url\(\s*['"]?|src=["'])(\/templates\/[^'")\s]+)/g, (match, prefix: string, rel: string) => {
    const file = path.join(pub, rel);
    if (!file.startsWith(pub) || !fs.existsSync(file)) return match;
    const mime = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
    return `${prefix}data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
  });
}

export function readBoard(rel: string): string {
  return fs.readFileSync(path.join(repoRoot(), rel), 'utf8');
}

/** A 151 × 101 noisy PNG as a data: URI — the size of the Wix blur placeholder that once went full-bleed on a Designer board. */
export async function smallImageDataUri(width = 151, height = 101): Promise<string> {
  const sharp = (await import('sharp')).default;
  const png = await sharp({
    create: { width, height, channels: 3, background: { r: 196, g: 84, b: 48 }, noise: { type: 'gaussian', mean: 120, sigma: 40 } },
  })
    .png()
    .toBuffer();
  return `data:image/png;base64,${png.toString('base64')}`;
}

/** Read a fixture and fill its placeholders. */
export async function loadFixture(name: string): Promise<string> {
  let html = fs.readFileSync(fixturePath(name), 'utf8');
  if (html.includes('__SMALL_IMAGE__')) html = html.split('__SMALL_IMAGE__').join(await smallImageDataUri());
  return html;
}
