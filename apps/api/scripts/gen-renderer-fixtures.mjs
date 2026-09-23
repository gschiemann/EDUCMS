#!/usr/bin/env node
/**
 * Regenerate apps/api/src/ai/__fixtures__/renderer/*.response.json — REAL
 * answers from the board renderer (apps/renderer), cut from the producer, for
 * the API's renderer client + review specs. Never hand-edit those files.
 *
 *   pnpm --filter renderer exec tsc -p tsconfig.test.json      # builds dist-test
 *   node apps/api/scripts/gen-renderer-fixtures.mjs            # from the repo root
 *
 * Each board goes through the renderer's own product pipeline
 * (test/helpers/runtimes.ts assembleLikeTheProduct = the API fit engine + the
 * web srcdoc wrapper, from source) into a real in-process renderer driving a
 * real Chromium (CHROME_PATH, or the Playwright Chromium). `fullWidth: 160`
 * keeps the committed `image` small; the metrics do not depend on it (they are
 * measured on the full-resolution frame).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const dist = (p) => pathToFileURL(path.join(ROOT, 'apps/renderer/dist-test/test/helpers', p)).href;
const { startTestServer, postRender } = await import(dist('server.js'));
const { findChromium, loadFixture } = await import(dist('env.js'));
const { assembleLikeTheProduct } = await import(dist('runtimes.js'));

const OUT = path.join(ROOT, 'apps/api/src/ai/__fixtures__/renderer');

/** The API's compiled reference boards (approved boards reduced to CSS + markup, placeholders only) — AI-contract boards. */
function exemplar(id) {
  const ts = createRequire(path.join(ROOT, 'apps/api/package.json'))('typescript');
  const src = fs.readFileSync(path.join(ROOT, 'apps/api/src/ai/designer-exemplars.generated.ts'), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const mod = { exports: {} };
  new Function('exports', 'require', 'module', js)(mod.exports, () => ({}), mod);
  const e = mod.exports.DESIGNER_EXEMPLARS.find((x) => x.id === id);
  if (!e) throw new Error(`no exemplar ${id}`);
  return e;
}

const BOARDS = {
  // An approved menu board (placeholders, empty photo frames), as a screen gets it: what a clean board measures.
  'exemplar-menu-hero-cards': () => {
    const e = exemplar('menu-hero-cards');
    return { html: assembleLikeTheProduct(e.html, e.width, e.height), width: e.width, height: e.height };
  },
  // Its portrait twin (2160 × 3840).
  'exemplar-menu-hero-cards-portrait': () => {
    const e = exemplar('menu-hero-cards-portrait');
    return { html: assembleLikeTheProduct(e.html, e.width, e.height), width: e.width, height: e.height };
  },
  // The same board with a logo hotlinked from a host we never gave it: the renderer blocks and reports it.
  'exemplar-external-logo': () => {
    const e = exemplar('menu-hero-cards');
    const html = e.html.replace(
      '<span class="logo-fallback">VENUE NAME</span>',
      '<img data-imgslot="logo" src="https://cdn.example-venue.com/brand/logo.png" alt=""><span class="logo-fallback">VENUE NAME</span>',
    );
    if (html === e.html) throw new Error('logo slot not found in the exemplar');
    return { html: assembleLikeTheProduct(html, e.width, e.height), width: e.width, height: e.height };
  },
  // The renderer's crowded AI-shaped board: tiny text raised, a shrunk headline, a scaled column, a guarded decoration.
  'crowded-ai-board': async () => ({ html: assembleLikeTheProduct(await loadFixture('crowded-ai-board.html'), 3840, 2160), width: 3840, height: 2160 }),
  // The renderer's deliberately bad board: 22 px caption, spilling headline, a blurry stretched image, an overlap, dead space.
  'bad-board': async () => ({ html: await loadFixture('bad-board.html'), width: 3840, height: 2160 }),
};

const chromium = findChromium();
if (!chromium) throw new Error('no Chromium found (set CHROME_PATH)');
const server = await startTestServer({ executablePath: chromium });
try {
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, build] of Object.entries(BOARDS)) {
    const { html, width, height } = await build();
    const res = await postRender(server.url, { html, canvasWidth: width, canvasHeight: height, fullWidth: 160 });
    if (res.status !== 200) throw new Error(`${name}: HTTP ${res.status} ${JSON.stringify(res.json).slice(0, 300)}`);
    fs.writeFileSync(path.join(OUT, `${name}.response.json`), JSON.stringify(res.json, null, 1) + '\n');
    const m = res.json.metrics;
    console.log(
      name.padEnd(28),
      `min ${m.text.minFont?.fontPx}px`,
      `overflow ${m.overflow.count}`,
      `clipped ${m.clipped.count}`,
      `overlaps ${m.overlaps.count}`,
      `blocked ${m.blockedRequestCount}`,
      `broken ${m.images.broken}`,
      `blurry ${m.images.blurry}`,
      `repairs ${m.fitRepairs.textScaled.count}/${m.fitRepairs.columns.count}/${m.fitRepairs.decorations.count}`,
      `empty ${m.emptySpace.ratio}`,
      `${res.json.chromium}`,
    );
  }
} finally {
  await server.close();
}
