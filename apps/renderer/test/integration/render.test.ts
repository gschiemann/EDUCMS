/**
 * End-to-end renders through the real HTTP server and a real Chromium.
 *
 *   (a) the Super Taco exemplars, assets inlined as data: URIs → clean, no
 *       blocked requests, sane metrics;
 *   (b) a deliberately bad board → every defect it carries is caught;
 *   a crowded AI-style board assembled with the product's OWN fit engine and
 *       srcdoc wrapper (transpiled from apps/api + apps/web source) → the
 *       repairs those runtimes make are reported;
 *   Google Fonts edge cases → faithful 400s and unbundled families reported.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { findChromium, fixturePath, inlineWebAssets, loadFixture, readBoard } from '../helpers/env.js';
import { assembleLikeTheProduct, runtimesAvailable } from '../helpers/runtimes.js';
import { postRender, startTestServer, type TestServer } from '../helpers/server.js';

const chromium = findChromium();
const skip = chromium ? false : 'no Chromium found (set CHROME_PATH) — browser integration tests skipped';
const QSR = 'apps/web/public/templates/signage/qsr';

let server: TestServer | null = null;
before(async () => {
  if (chromium) server = await startTestServer({ executablePath: chromium });
});
after(async () => {
  await server?.close();
});

const isWebp = (b64: string) => {
  const buf = Buffer.from(b64, 'base64');
  return buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP';
};

test('(a) Super Taco burritos, assets inlined: a clean render with sane metrics', { skip }, async () => {
  const html = inlineWebAssets(readBoard(`${QSR}/26-super-taco-burritos.html`));
  const res = await postRender(server!.url, { html, canvasWidth: 3840, canvasHeight: 2160 });
  assert.equal(res.status, 200, JSON.stringify(res.json).slice(0, 300));
  const r = res.json;
  assert.equal(r.contractVersion, 1);
  assert.ok(isWebp(r.image) && isWebp(r.thumb));
  assert.deepEqual([r.imageWidth, r.imageHeight, r.thumbWidth, r.thumbHeight], [1920, 1080, 480, 270]);
  assert.match(r.chromium, /Chrom/);

  const m = r.metrics;
  assert.deepEqual(m.blockedRequests, [], 'nothing may be blocked: every asset was inlined');
  assert.deepEqual(m.pageErrors, []);
  assert.deepEqual(m.canvas, { width: 3840, height: 2160, shortSide: 2160, viewportWidth: 1920, viewportHeight: 1080, viewportScale: 0.5, devicePixelRatio: 1 });
  // Text: measured in canvas px — the board's own sizes, not the half-size screenshot's.
  assert.ok(m.text.elements >= 40, `text elements ${m.text.elements}`);
  assert.ok(m.text.minFont.fontPx >= 49 && m.text.minFont.fontPx <= 52, `min font ${m.text.minFont.fontPx}`);
  assert.ok(m.text.largestPx >= 200, `largest ${m.text.largestPx}`);
  assert.equal(m.overflow.count, 0, JSON.stringify(m.overflow.items).slice(0, 300));
  assert.equal(m.clipped.count, 0, JSON.stringify(m.clipped.items).slice(0, 300));
  assert.equal(m.overlaps.count, 0, JSON.stringify(m.overlaps.items).slice(0, 300));
  assert.equal(m.images.broken, 0);
  assert.equal(m.images.blurry, 0);
  assert.ok(m.images.items.some((i: { slot: string }) => i.slot === 'brand.logo'));
  assert.ok(m.images.items.some((i: { slot: string }) => i.slot === 'rail.image'));
  assert.equal(m.menu.items, 6);
  assert.equal(m.menu.itemsWithNameAndPrice, 6);
  assert.ok(m.counts.dataField >= 40);
  const fonts = Object.fromEntries(m.fonts.map((f: { family: string; status: string; servedAs: string }) => [f.family, `${f.status}:${f.servedAs}`]));
  assert.equal(fonts.Impact, 'substituted:Anton');
  assert.equal(fonts.Arial, 'substituted:Arimo');
  assert.deepEqual(m.fontFallbacks, []);
  assert.ok(m.contrast.measured >= 40);
  assert.equal(m.contrast.occluded, 0);
  assert.ok(m.emptySpace.ratio < 0.35);
  assert.deepEqual(m.warnings, []);
  assert.ok(r.timings.totalMs < 15_000, `took ${r.timings.totalMs} ms`);
});

test('(a) all four Super Taco boards render with nothing blocked and no page errors', { skip }, async () => {
  for (const board of ['24-super-taco-flagship', '25-super-taco-tacos', '26-super-taco-burritos', '27-super-taco-combos']) {
    const html = inlineWebAssets(readBoard(`${QSR}/${board}.html`));
    const res = await postRender(server!.url, { html, canvasWidth: 3840, canvasHeight: 2160 });
    assert.equal(res.status, 200, `${board}: ${JSON.stringify(res.json).slice(0, 200)}`);
    const m = res.json.metrics;
    assert.deepEqual(m.blockedRequests, [], board);
    assert.deepEqual(m.pageErrors, [], board);
    assert.equal(m.images.broken, 0, board);
    assert.ok(m.fonts.every((f: { status: string }) => f.status !== 'fallback'), `${board}: ${JSON.stringify(m.fonts)}`);
  }
});

test('(b) the bad board: every defect it carries is caught', { skip }, async () => {
  const res = await postRender(server!.url, { html: await loadFixture('bad-board.html'), canvasWidth: 3840, canvasHeight: 2160 });
  assert.equal(res.status, 200, JSON.stringify(res.json).slice(0, 300));
  const m = res.json.metrics;
  // 1. The 22 px caption — at 3840×2160, 1 % of the short side.
  assert.equal(m.text.minFont.field, 'legal');
  assert.equal(m.text.minFont.fontPx, 22);
  assert.ok(m.text.minFont.pctShortSide < 1.1);
  assert.ok(m.text.belowFloor.some((t: { field: string }) => t.field === 'legal'));
  // 2. The headline running out of its 1400 px box.
  const spill = m.overflow.items.find((i: { field: string; kind: string }) => i.field === 'headline' && i.kind === 'box');
  assert.ok(spill, JSON.stringify(m.overflow));
  assert.ok(spill.overflowPx > 500 && spill.sides.includes('right'));
  // 3. The 151×101 image drawn 1280×2160.
  const hero = m.images.items.find((i: { slot: string }) => i.slot === 'hero');
  assert.deepEqual([hero.naturalWidth, hero.naturalHeight, hero.drawnWidth, hero.drawnHeight], [151, 101, 1280, 2160]);
  assert.ok(hero.upscale > 20 && hero.blurry, JSON.stringify(hero));
  assert.ok(hero.distortion > 2.4);
  assert.equal(m.images.blurry, 1);
  // 4. The translucent giant letter over the headline.
  const ghost = m.overlaps.items.find((o: { a: { text: string }; b: { field: string } }) => o.a.text === 'S' && o.b.field === 'headline');
  assert.ok(ghost, JSON.stringify(m.overlaps));
  assert.ok(ghost.overlapW > 6 && ghost.overlapH > 6);
  // 5. The flat empty panel: a single void well over the rubric's ~12 %.
  assert.ok(m.emptySpace.largestVoidPct > 0.12, JSON.stringify(m.emptySpace));
  // The Google fonts it links were served from the bundle, not fetched.
  assert.deepEqual(
    m.fonts.map((f: { family: string; status: string }) => `${f.family}:${f.status}`).sort(),
    ['Anton:webfont', 'Inter:webfont'],
  );
  assert.deepEqual(m.blockedRequests, []);
});

test('the product\'s own fit engine and stage runtime: their repairs are reported, and what they could not fix is caught', { skip: skip || (!runtimesAvailable() && 'apps/api or apps/web sources absent') }, async () => {
  const html = assembleLikeTheProduct(fs.readFileSync(fixturePath('crowded-ai-board.html'), 'utf8'), 3840, 2160);
  assert.match(html, /VOS-FIT-ENGINE/);
  assert.match(html, /VOS-STAGE-SCALE/);
  assert.match(html, /Content-Security-Policy/);
  const res = await postRender(server!.url, { html, canvasWidth: 3840, canvasHeight: 2160 });
  assert.equal(res.status, 200, JSON.stringify(res.json).slice(0, 300));
  const m = res.json.metrics;
  const f = m.fitRepairs;
  // Floor-up: the 20 px legal line was raised to the engine's 52 px floor.
  assert.equal(f.raisedToFloor, 1);
  assert.equal(m.text.minFont.field, 'legal');
  assert.ok(m.text.minFont.fontPx >= 51 && m.text.minFont.fontPx <= 53);
  // data-fit: the long headline was shrunk hard.
  const headline = f.dataFit.items.find((i: { field: string }) => i.field === 'headline');
  assert.ok(headline && headline.scale < 0.6, JSON.stringify(f.dataFit));
  // data-fit-col: the overfull column was scaled…
  assert.equal(f.columns.count, 1);
  assert.ok(f.columns.minScale < 1);
  // …but it clips its own content, so scaling it could not un-clip the last row.
  assert.ok(
    m.clipped.items.some((c: { field: string }) => c.field === 'item.6.name'),
    `the cut-off last row was not reported: ${JSON.stringify(m.clipped)}`,
  );
  // The decoration guard shrank the shape that covered "Two sides free".
  assert.equal(f.decorations.count, 1);
  assert.equal(f.overcrowded, true);
  // Google fonts through the board's own CSP, from the bundle.
  assert.deepEqual(m.fonts.map((x: { family: string; status: string }) => `${x.family}:${x.status}`).sort(), ['Inter:webfont', 'Oswald:webfont']);
  assert.deepEqual(m.blockedRequests, []);
});

test('Google Fonts: an impossible selector 400s the whole link (as Google would) and is reported', { skip }, async () => {
  const html = `<!doctype html><html><head>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400&family=Anton:wght@700&display=swap">
    <style>body{margin:0;background:#fff} h1{font:700 120px 'Anton', serif} p{font:400 60px 'Inter', serif}</style>
    </head><body><h1>Headline</h1><p>Body copy here</p></body></html>`;
  const res = await postRender(server!.url, { html, canvasWidth: 1920, canvasHeight: 1080, viewportScale: 1, settleMs: 300 });
  assert.equal(res.status, 200);
  const m = res.json.metrics;
  const rejected = m.fontFallbacks.find((f: { reason: string; family: string }) => f.reason === 'google-fonts-error' && f.family === 'Anton');
  assert.ok(rejected, JSON.stringify(m.fontFallbacks));
  // Neither family loaded: the whole <link> failed, so BOTH fall back — as on a screen.
  const status = Object.fromEntries(m.fonts.map((f: { family: string; status: string }) => [f.family, f.status]));
  assert.equal(status.Anton, 'fallback');
  assert.equal(status.Inter, 'fallback');
});

test('a family outside the bundle falls back and is reported as not-bundled', { skip }, async () => {
  const html = `<!doctype html><html><head>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lobster&family=Inter:wght@400">
    <style>body{margin:0;background:#fff} h1{font:400 120px 'Lobster', serif} p{font:400 60px 'Inter', serif}</style>
    </head><body><h1>Headline</h1><p>Body copy here</p></body></html>`;
  const res = await postRender(server!.url, { html, canvasWidth: 1920, canvasHeight: 1080, viewportScale: 1, settleMs: 300 });
  assert.equal(res.status, 200);
  const m = res.json.metrics;
  const lobster = m.fontFallbacks.find((f: { family: string }) => f.family === 'Lobster');
  assert.ok(lobster && lobster.reason === 'not-bundled' && lobster.usedInText, JSON.stringify(m.fontFallbacks));
  const status = Object.fromEntries(m.fonts.map((f: { family: string; status: string }) => [f.family, f.status]));
  assert.equal(status.Lobster, 'fallback');
  assert.equal(status.Inter, 'webfont');
});

test('portrait: the same board in its portrait layout, measured on a 9 × 16 grid', { skip }, async () => {
  const html = inlineWebAssets(readBoard(`${QSR}/26-super-taco-burritos.html`));
  const res = await postRender(server!.url, { html, canvasWidth: 2160, canvasHeight: 3840 });
  assert.equal(res.status, 200);
  const r = res.json;
  assert.deepEqual([r.imageWidth, r.imageHeight], [1920, 3413]);
  const m = r.metrics;
  assert.equal(m.canvas.shortSide, 2160);
  assert.equal(m.emptySpace.map.length, 16);
  // The portrait layout sets its kicker at 43 px: under the 2.4 % floor.
  assert.ok(m.text.minFont.fontPx < 50, JSON.stringify(m.text.minFont));
  assert.deepEqual(m.blockedRequests, []);
});
