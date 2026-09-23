/**
 * assembleMetrics: viewport px + CSS px + pixels → canvas-px judgements.
 * Every threshold the contract documents is exercised here without a browser.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleMetrics, edgeTolerance, sizeTiers, type AssembleInput } from '../../src/metrics/assemble.js';
import type { RawPageMeasure, RawText, RawImage } from '../../src/page/types.js';
import { makeImage, drawStrokes } from '../helpers/pixels.js';

const NAVY = { r: 13, g: 27, b: 42 };
const ZERO = { top: 0, right: 0, bottom: 0, left: 0 };

let nextId = 0;
function text(over: Partial<RawText> = {}): RawText {
  const id = nextId++;
  const rect = { x: 10 + id * 100, y: 10, w: 80, h: 20 };
  return {
    id,
    field: `f${id}`,
    selector: `#t${id}`,
    text: `text ${id}`,
    chars: 6,
    hasWordChars: true,
    fontSizeCss: 30,
    scale: 1,
    primaryFamily: 'Inter',
    familyList: 'Inter, sans-serif',
    weight: '400',
    style: 'normal',
    fill: { r: 255, g: 255, b: 255, a: 1 },
    opacity: 1,
    ariaHidden: false,
    effects: false,
    inkRects: [rect],
    descentVp: 0,
    visibleRects: [rect],
    inkArea: rect.w * rect.h,
    visibleArea: rect.w * rect.h,
    boxOverflow: null,
    clip: null,
    stage: { ...ZERO },
    ...over,
  };
}

function raw(over: Partial<RawPageMeasure> = {}): RawPageMeasure {
  return {
    viewport: { width: 1920, height: 1080, dpr: 1 },
    texts: [],
    textLimitHit: false,
    images: [],
    fit: { vosFs: [], vgw: [], fitCol: [], dataFit: [] },
    counts: { dataField: 0, dataImgslot: 0, dataMenuRow: 0, dataPosItem: 0, dataAction: 0 },
    menu: { rows: 0, rowsVisible: 0, rowsWithNameAndPrice: 0, rowProblems: [], posItems: 0, items: 0, itemsWithNameAndPrice: 0 },
    fontFaces: [],
    probes: [],
    warnings: [],
    ...over,
  };
}

function input(r: RawPageMeasure, over: Partial<AssembleInput> = {}): AssembleInput {
  const frame = makeImage(r.viewport.width / 10, r.viewport.height / 10, NAVY);
  return {
    raw: r,
    log: { csp: [], popups: [], frozenAnimations: 0 },
    canvasWidth: 3840,
    canvasHeight: 2160,
    viewportScale: 0.5,
    image: frame,
    plate: frame,
    dpr: 0.1, // the synthetic frames are 1/10 of the viewport
    blocked: [],
    fontRequests: { notBundled: new Map(), rejected: [], served: new Set() },
    platformFonts: null,
    substitutes: new Map([['impact', 'Anton']]),
    pageErrors: [],
    warnings: [],
    ...over,
  };
}

test('font sizes are reported in canvas px through the transform chain', () => {
  // 1920-wide viewport of a 3840 canvas: 1 viewport px = 2 canvas px.
  const a = text({ fontSizeCss: 94, scale: 0.5 }); // a stage-scaled board: 94 canvas px
  const b = text({ fontSizeCss: 26, scale: 1 }); // a viewport-sized board: 52 canvas px
  const m = assembleMetrics(input(raw({ texts: [a, b] })));
  assert.equal(m.canvas.shortSide, 2160);
  assert.equal(m.text.floorPx, 51.8);
  assert.equal(m.text.minFont?.fontPx, 52);
  assert.equal(m.text.largestPx, 94);
  assert.equal(m.text.belowFloorCount, 0);
});

test('the floor, and decorative text staying out of every summary', () => {
  const caption = text({ fontSizeCss: 11, field: 'legal' }); // 22 canvas px
  const ghost = text({ fontSizeCss: 5, opacity: 0.1 }); // tiny but decorative (opacity)
  const hidden = text({ fontSizeCss: 6, ariaHidden: true }); // decorative (aria-hidden)
  const m = assembleMetrics(input(raw({ texts: [caption, ghost, hidden, text({ fontSizeCss: 60 })] })));
  assert.equal(m.text.minFont?.field, 'legal');
  assert.equal(m.text.minFont?.fontPx, 22);
  assert.equal(m.text.minFont?.pctShortSide, 1.019);
  assert.equal(m.text.belowFloorCount, 1);
  assert.equal(m.text.elements, 2);
  assert.equal(m.text.decorativeElements, 2);
});

test('size tiers cluster within 5 % and give the top-two ratio', () => {
  assert.deepEqual(
    sizeTiers([
      { px: 240, chars: 10 },
      { px: 236, chars: 4 },
      { px: 100, chars: 30 },
      { px: 52, chars: 80 },
    ]),
    [
      { px: 240, elements: 2, characters: 14 },
      { px: 100, elements: 1, characters: 30 },
      { px: 52, elements: 1, characters: 80 },
    ],
  );
  const m = assembleMetrics(input(raw({ texts: [text({ fontSizeCss: 120 }), text({ fontSizeCss: 50 })] })));
  assert.equal(m.text.topTwoRatio, 2.4);
});

test('overflow: horizontal spill always counts; a descender poking under a tight line does not', () => {
  const wide = text({ fontSizeCss: 50, boxOverflow: { selector: '#box', top: 0, right: 10, bottom: 0, left: 0 } }); // 20 canvas px right
  const tight = text({ fontSizeCss: 100, boxOverflow: { selector: '#box2', top: 0, right: 0, bottom: 20, left: 0 } }); // 40 < 0.3×200
  const offCanvas = text({ fontSizeCss: 50, stage: { top: 0, right: 0, bottom: 0, left: 30 } });
  const m = assembleMetrics(input(raw({ texts: [wide, tight, offCanvas] })));
  assert.equal(m.overflow.count, 2);
  const box = m.overflow.items.find((i) => i.kind === 'box');
  assert.equal(box?.overflowPx, 20);
  assert.deepEqual(box?.sides, ['right']);
  assert.equal(box?.boxSelector, '#box');
  const stage = m.overflow.items.find((i) => i.kind === 'stage');
  assert.equal(stage?.overflowPx, 60);
  assert.deepEqual(stage?.sides, ['left']);
});

test('edge tolerance: a cut inside the descender band is tolerated, one into the letter bodies is not', () => {
  // 104 canvas px text with a 25 px descender (measured): clipping 20 px off
  // the bottom only trims tails; clipping 40 px cuts through the x-height.
  const tol = edgeTolerance(104, 25);
  assert.equal(tol.bottom, 27);
  const trims = text({
    fontSizeCss: 52,
    descentVp: 12.5,
    clip: { kind: 'ancestor', selector: '.col', top: 0, right: 0, bottom: 10, left: 0, coversViewport: false, fullyHidden: false, nearEdge: true },
  });
  const cuts = text({
    fontSizeCss: 52,
    descentVp: 12.5,
    clip: { kind: 'ancestor', selector: '.col', top: 0, right: 0, bottom: 20, left: 0, coversViewport: false, fullyHidden: false, nearEdge: true },
  });
  const m = assembleMetrics(input(raw({ texts: [trims, cuts] })));
  assert.equal(m.clipped.count, 1);
  assert.equal(m.clipped.items[0]?.clippedPx, 40);
  // Unmeasured fonts fall back to a quarter-em descender.
  assert.equal(edgeTolerance(100, 0).bottom, 27);
});

test('clipping: cut-off text is reported; a carousel slide parked off-screen is not; a stage-sized clipper reads as off-canvas', () => {
  const cut = text({
    inkArea: 1000,
    visibleArea: 600,
    clip: { kind: 'self', selector: '.dish-name', top: 0, right: 0, bottom: 30, left: 0, coversViewport: false, fullyHidden: false, nearEdge: true },
  });
  const parked = text({
    inkArea: 1000,
    visibleArea: 0,
    clip: { kind: 'ancestor', selector: '.track', top: 0, right: 0, bottom: 0, left: 4000, coversViewport: false, fullyHidden: true, nearEdge: false },
  });
  const offStage = text({
    clip: { kind: 'ancestor', selector: '.stage', top: 0, right: 40, bottom: 0, left: 0, coversViewport: true, fullyHidden: false, nearEdge: true },
  });
  const m = assembleMetrics(input(raw({ texts: [cut, parked, offStage] })));
  assert.equal(m.clipped.count, 1);
  assert.equal(m.clipped.items[0]?.clipSelector, '.dish-name');
  assert.equal(m.clipped.items[0]?.hiddenFraction, 0.4);
  assert.equal(m.clipped.items[0]?.clippedPx, 60);
  assert.equal(m.overflow.items.filter((i) => i.kind === 'stage').length, 1);
});

test('overlaps: > 6 canvas px on both axes between readable text; decorative text never collides', () => {
  const a = text({ visibleRects: [{ x: 0, y: 0, w: 100, h: 40 }] });
  const b = text({ visibleRects: [{ x: 96, y: 30, w: 100, h: 40 }] }); // 4 × 10 vp px = 8 × 20 canvas px
  const deco = text({ ariaHidden: true, visibleRects: [{ x: 0, y: 0, w: 300, h: 300 }] });
  const m = assembleMetrics(input(raw({ texts: [a, b, deco] })));
  assert.equal(m.overlaps.count, 1);
  assert.equal(m.overlaps.items[0]?.overlapW, 8);
  assert.equal(m.overlaps.items[0]?.overlapH, 20);
  assert.equal(m.overlaps.items[0]?.identicalText, false);
});

test('fit-engine repairs: shrunk text, text raised to the floor, guarded decorations, scaled columns, data-fit', () => {
  const m = assembleMetrics(
    input(
      raw({
        fit: {
          vosFs: [
            { field: 'h', selector: '#h', text: 'Headline', originalCss: 80, currentCss: 60, scale: 1 },
            { field: 'c', selector: '#c', text: 'caption', originalCss: 20, currentCss: 26, scale: 1 },
            { field: 'n', selector: '#n', text: 'same', originalCss: 40, currentCss: 40, scale: 1 },
          ],
          vgw: [{ selector: '.blob', originalW: 400, originalH: 400, currentW: 280, currentH: 280, dimmed: true, scale: 1 }],
          fitCol: [
            { selector: '.col', field: null, scale: 0.8 },
            { selector: '.col2', field: null, scale: 1 },
          ],
          dataFit: [{ field: 'x', selector: '#x', text: 'x', authoredCss: 100, renderedCss: 95, scale: 0.5 }],
        },
      }),
    ),
  );
  assert.equal(m.fitRepairs.textScaled.count, 1);
  assert.equal(m.fitRepairs.textScaled.minScale, 0.75);
  assert.equal(m.fitRepairs.textScaled.items[0]?.originalPx, 160, 'canvas px');
  assert.equal(m.fitRepairs.raisedToFloor, 1);
  assert.equal(m.fitRepairs.decorations.count, 1);
  assert.equal(m.fitRepairs.decorations.dimmed, 1);
  assert.equal(m.fitRepairs.decorations.minScale, 0.7);
  assert.equal(m.fitRepairs.columns.count, 1);
  assert.equal(m.fitRepairs.columns.minScale, 0.8);
  assert.equal(m.fitRepairs.dataFit.count, 1);
  assert.equal(m.fitRepairs.dataFit.items[0]?.authoredPx, 100);
  assert.equal(m.fitRepairs.overcrowded, true);
});

test('images: drawn size in canvas px, blur, distortion, broken, vector', () => {
  const base: RawImage = {
    kind: 'img',
    selector: 'img.hero',
    slot: 'hero',
    src: 'data:image/png (1 KB)',
    naturalW: 151,
    naturalH: 101,
    broken: false,
    vector: false,
    boxW: 640,
    boxH: 1080,
    scale: 1,
    fit: 'fill',
    rect: { x: 1280, y: 0, w: 640, h: 1080 },
    visible: true,
  };
  const m = assembleMetrics(
    input(
      raw({
        images: [
          base,
          { ...base, selector: 'img.broken', broken: true, naturalW: 0, naturalH: 0 },
          { ...base, selector: 'img.svg', vector: true, naturalW: 24, naturalH: 24 },
          { ...base, kind: 'background', selector: '.logo', fit: 'contain', naturalW: 1300, naturalH: 364, boxW: 430, boxH: 75 },
        ],
      }),
    ),
  );
  const hero = m.images.items.find((i) => i.selector === 'img.hero');
  assert.equal(hero?.drawnWidth, 1280);
  assert.equal(hero?.drawnHeight, 2160);
  assert.equal(hero?.upscale, 21.39);
  assert.equal(hero?.blurry, true);
  assert.equal(hero?.distortion, 2.52);
  assert.equal(m.images.broken, 1);
  assert.equal(m.images.items[0]?.selector, 'img.broken', 'broken first');
  assert.equal(m.images.items.find((i) => i.selector === 'img.svg')?.upscale, null);
  assert.equal(m.images.items.find((i) => i.selector === '.logo')?.blurry, false);
  assert.equal(m.images.blurry, 1);
  assert.equal(m.images.maxUpscale, 21.39);
});

test('fonts: web fonts, look-alikes, missing system faces, unbundled and rejected Google families', () => {
  const inter = text({ primaryFamily: 'Inter' });
  const impact = text({ primaryFamily: 'Impact' });
  const comic = text({ primaryFamily: 'Comic Sans MS' });
  const lobster = text({ primaryFamily: 'Lobster' });
  const generic = text({ primaryFamily: 'sans-serif' });
  const platformFonts = new Map([
    [inter.id, [{ family: 'Inter', custom: true, glyphs: 40 }]],
    [impact.id, [{ family: 'Anton', custom: true, glyphs: 30 }, { family: 'DejaVu Sans', custom: false, glyphs: 1 }]],
    [comic.id, [{ family: 'DejaVu Sans', custom: false, glyphs: 12 }]],
    [lobster.id, [{ family: 'DejaVu Sans', custom: false, glyphs: 9 }]],
  ]);
  const m = assembleMetrics(
    input(
      raw({
        texts: [inter, impact, comic, lobster, generic],
        fontFaces: [
          { family: 'Inter', style: 'normal', weight: '400', status: 'loaded' },
          { family: 'Impact', style: 'normal', weight: '400', status: 'loaded' },
        ],
      }),
      {
        platformFonts,
        fontRequests: {
          notBundled: new Map([['lobster', 'https://fonts.googleapis.com/css2?family=Lobster']]),
          rejected: [{ family: 'Anton', reason: 'weight 700 not in Anton (400)' }],
          served: new Set(['inter']),
        },
      },
    ),
  );
  const status = Object.fromEntries(m.fonts.map((f) => [f.family, f.status]));
  assert.deepEqual(status, { Inter: 'webfont', Impact: 'substituted', 'Comic Sans MS': 'fallback', Lobster: 'fallback', 'sans-serif': 'generic' });
  assert.equal(m.fonts.find((f) => f.family === 'Impact')?.servedAs, 'Anton');
  const reasons = Object.fromEntries(m.fontFallbacks.map((f) => [f.family, f.reason]));
  assert.equal(reasons['Comic Sans MS'], 'not-installed');
  assert.equal(reasons.Lobster, 'not-bundled');
  assert.equal(reasons.Anton, 'google-fonts-error');
  assert.equal(m.fontFallbacks.find((f) => f.family === 'Lobster')?.usedInText, true);
});

test('a family used only for symbols (✹) is not called a fallback: no text face carries dingbats', () => {
  const star = text({ primaryFamily: 'Georgia', text: '✹', chars: 1, hasWordChars: false });
  const m = assembleMetrics(
    input(raw({ texts: [star] }), {
      platformFonts: new Map([[star.id, [{ family: 'Zapf Dingbats', custom: false, glyphs: 1 }]]]),
      substitutes: new Map([['georgia', 'Gelasio']]),
    }),
  );
  assert.equal(m.fonts[0]?.status, 'unverified');
  assert.deepEqual(m.fontFallbacks, []);
});

test('blocked requests merge interception, CSP and popups, deduplicated', () => {
  const m = assembleMetrics(
    input(raw(), {
      blocked: [
        { url: 'http://example.com/x.png', type: 'image', reason: 'network' },
        { url: 'http://example.com/x.png', type: 'image', reason: 'network' },
      ],
      log: {
        csp: [
          { uri: 'http://169.254.169.254/', directive: 'connect-src' },
          { uri: 'inline', directive: 'script-src-elem' },
        ],
        popups: ['https://evil.test/'],
        frozenAnimations: 3,
      },
    }),
  );
  assert.equal(m.blockedRequestCount, 3);
  assert.deepEqual(
    m.blockedRequests.map((b) => `${b.reason}:${b.url}`),
    ['network:http://example.com/x.png', 'csp:http://169.254.169.254/', 'popup:https://evil.test/'],
  );
});

test('contrast is read from the two frames; without a backplate it is skipped with a warning', () => {
  const frame = makeImage(192, 108, NAVY);
  const plate = makeImage(192, 108, NAVY);
  drawStrokes(frame, { x: 10, y: 10, w: 80, h: 20 }, { r: 255, g: 255, b: 255 });
  const t = text({ visibleRects: [{ x: 100, y: 100, w: 800, h: 200 }] }); // → px 10,10,80,20 at dpr 0.1
  const m = assembleMetrics(input(raw({ texts: [t] }), { image: frame, plate }));
  assert.equal(m.contrast.measured, 1);
  assert.ok((m.contrast.min ?? 0) > 15);
  assert.equal(m.contrast.items[0]?.bg, '#0d1b2a');
  const none = assembleMetrics(input(raw({ texts: [t] }), { image: frame, plate: null }));
  assert.equal(none.contrast.measured, 0);
  assert.ok(none.warnings.some((w) => w.includes('backplate')));
});

test('empty space uses a 16 × 9 grid, 9 × 16 for portrait', () => {
  const flat = assembleMetrics(input(raw()));
  assert.equal(flat.emptySpace.ratio, 1);
  assert.equal(flat.emptySpace.overTarget, true);
  assert.equal(flat.emptySpace.map.length, 9);
  const portrait = assembleMetrics(input(raw({ viewport: { width: 1080, height: 1920, dpr: 1 } }), { canvasWidth: 2160, canvasHeight: 3840 }));
  assert.equal(portrait.emptySpace.map.length, 16);
  assert.equal(portrait.emptySpace.map[0]?.length, 9);
});
