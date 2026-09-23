/**
 * VOS-FIT-ENGINE regression guard — a real-browser measurement of the
 * "the headline doesn't fit" class of bug (chromium + webkit, no server).
 *
 * THE BUG (2026-08-25, operator incident). An AI Designer board came back with
 * the tenant's long scraped tagline as its headline, CLIPPED MID-PHRASE and
 * running across the neighbouring photo panel ("…nd unparallel…" colliding at
 * the right edge). Root cause: `fitOne()` in
 * apps/api/src/ai/designer-edit-shim.ts forced `white-space:nowrap` and shrank
 * the text on ONE LINE only. When even the legibility floor could not fit the
 * string on one line, it left the element nowrap at the floor — overflowing.
 * `clampOverflow()` could not rescue it either: it measured against the CANVAS
 * edge, and the headline was overflowing its COLUMN while staying inside 1920px.
 * Measured before the fix: the headline ran 718px past its own column and the
 * decoration guard then shrank the 600px photo panel to 120px trying to get out
 * of its way.
 *
 * WHAT THIS GUARDS. Boots the REAL engine (read straight out of the API source,
 * so it can never drift from what ships) over a board with the incident's exact
 * geometry, and asserts, in every browser:
 *   1. a very long headline never leaves its column, never crosses the photo
 *      panel, and never overlaps the element below it;
 *   2. it stays at or above the canvas-relative legibility floor;
 *   3. a SHORT headline is still fitted on ONE line at full size — the fix must
 *      not turn well-fitting boards into wrapped ones (zero regression);
 *   4. a long row NAME still shrinks/wraps beside its value instead of riding it.
 *
 * AND (2026-09-22, AI Designer rework — research report 01, measured red first):
 *   R1. a nearly invisible decorative initial (opacity .06 / aria-hidden /
 *       6%-alpha color) is not a collision — before: headline 220 → 101px, rows
 *       90 → 52px; a fully opaque initial still is (negative control);
 *   R2. a photo slot is never "decoration" — before: 1280×2160 → 640×1080;
 *   R3. a real collision shrinks only its own column, never below 85%.
 *
 * Run locally:  cd apps/web && node tests/cross-browser/designer-fit-engine.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium, webkit } = require('@playwright/test');

const SHIM_SRC = path.join(__dirname, '../../../../apps/api/src/ai/designer-edit-shim.ts');

/** Pull `export const NAME = "…" + "…";` out of the API source and evaluate it. */
function apiConstant(name) {
  const src = fs.readFileSync(SHIM_SRC, 'utf8');
  const m = src.match(new RegExp('export const ' + name + ' =([\\s\\S]*?);\\n'));
  if (!m) throw new Error('could not find ' + name + ' in designer-edit-shim.ts');
  // eslint-disable-next-line no-eval
  return eval(m[1]);
}

const ENGINE = apiConstant('DESIGNER_LAYOUT_ENGINE');

// The tenant's real scraped tagline — the string that came back clipped.
const LONG_HEADLINE =
  "Amplify your brand's presence with captivating visuals and unparalleled print quality";
const SHORT_HEADLINE = 'Chrome.';

/** The incident's board shape: 1920×1080 stage, 600px photo panel pinned right,
 *  content column constrained to the remaining width. */
function board(headline) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1920px;height:1080px;background:#15181c;overflow:hidden}
.stage{position:relative;width:1920px;height:1080px;background:#1b2027;color:#f0f1f3;font-family:Georgia,serif;overflow:hidden}
.photo{position:absolute;top:0;right:0;bottom:0;width:600px;background:#2d343d}
.fit{position:absolute;top:90px;left:120px;width:1080px}
.wordmark{font-weight:800;font-size:118px;line-height:.9;letter-spacing:-.015em}
.tag{font-size:34px;color:#c1c8d1;margin-top:24px}
.row{display:flex;align-items:baseline;margin-top:40px}
.nm{flex:0 1 auto;min-width:0;font-size:46px}
.dots{flex:1 1 auto;min-width:12px;border-bottom:2px dotted #4a5464;margin:0 20px 12px}
.pr{flex:0 0 auto;font-size:44px}
</style></head><body><div class="stage">
<div class="photo"></div>
<div class="fit" id="col" data-fit-col>
  <div class="wordmark" id="hl" data-field="headline" data-fit data-fit-min="56">${headline}</div>
  <div class="tag" id="tag" data-field="tagline">Springfield Elementary &middot; Since 2004</div>
  <div class="row"><div class="nm" id="nm">Experiential Environmental Graphics Program Management</div><div class="dots"></div><div class="pr" id="pr">By project</div></div>
</div>
</div>${ENGINE}</body></html>`;
}

/** Glyph-accurate bounds, the same way the engine measures. */
const MEASURE = () => {
  function glyphRect(el) {
    const rg = document.createRange();
    rg.selectNodeContents(el);
    const rs = rg.getClientRects();
    let l = 1e9, t = 1e9, r = -1e9, b = -1e9;
    for (let i = 0; i < rs.length; i++) {
      if (rs[i].width < 1 && rs[i].height < 1) continue;
      if (rs[i].left < l) l = rs[i].left;
      if (rs[i].top < t) t = rs[i].top;
      if (rs[i].right > r) r = rs[i].right;
      if (rs[i].bottom > b) b = rs[i].bottom;
    }
    return { left: l, top: t, right: r, bottom: b, lines: rs.length };
  }
  const hl = document.getElementById('hl');
  const h = glyphRect(hl);
  const col = document.getElementById('col').getBoundingClientRect();
  const photo = document.querySelector('.photo').getBoundingClientRect();
  const tag = document.getElementById('tag').getBoundingClientRect();
  const nm = glyphRect(document.getElementById('nm'));
  const pr = document.getElementById('pr').getBoundingClientRect();
  return {
    overflowsColumnBy: Math.round(h.right - col.right),
    crossesPhotoPanel: h.right > photo.left + 1,
    overlapsNextElement: h.bottom > tag.top + 1,
    fontSize: parseFloat(getComputedStyle(hl).fontSize),
    lines: h.lines,
    photoWidth: Math.round(photo.width),
    nameRidesValue: nm.right > pr.left + 1,
  };
};

async function measure(browserType, name, headline) {
  const browser = await browserType.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await page.setContent(board(headline), { waitUntil: 'load' });
    // The engine re-runs at 400/1200/2000ms (fonts load late and change widths).
    await page.waitForTimeout(2400);
    return await page.evaluate(MEASURE);
  } finally {
    await browser.close();
  }
}

// ── 2026-09-22 — the engine was shrinking and fading GOOD work ──────────────
//
// Research report 01 (docs/research/2026-09-22-ai-designer-rework) measured two
// ways this engine wrecked a well-built 4K board, both with the real engine in
// headless Chromium:
//   R1. ONE translucent decorative initial behind the headline (6% opacity —
//       the prompt's own art direction asked for it) counted as a text
//       collision, and a collision shrank EVERY text element on the board:
//       headline 220 → 101 px, menu rows 90 → 52 px.
//   R2. The decoration guard treated the venue's PHOTO panel as decoration and
//       shrank it: 1280×2160 → 640×1080.
// And the fix's own contract:
//   R3. a REAL collision shrinks only the column it happens in, never below 85%,
//       and leaves the rest of the board at its authored size.
const W4K = 3840;
const H4K = 2160;

/** R1 — a translucent watermark initial overlapping the headline + rows. */
function watermarkBoard(kind) {
  const wm = {
    opacity: '<div class="wm" style="opacity:.06">S</div>',
    ariaHidden: '<div class="wm" aria-hidden="true" style="color:#fff">S</div>',
    colorAlpha: '<div class="wm" style="color:rgba(255,255,255,.06)">S</div>',
    none: '',
  }[kind];
  return `<!doctype html><html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}html,body{width:${W4K}px;height:${H4K}px;overflow:hidden}
.stage{position:relative;width:${W4K}px;height:${H4K}px;background:#1b1b1b;color:#fff;font-family:Arial,sans-serif}
.wm{position:absolute;top:120px;left:200px;font-size:900px;line-height:1;font-weight:900}
.col{position:absolute;top:200px;left:240px;width:2000px}
h1{font-size:220px;line-height:1}
.row{font-size:90px;margin-top:40px}
</style></head><body><div class="stage">
${wm}
<div class="col"><h1 id="hl" data-field="headline">Super Taco</h1>
<div class="row" data-field="item.0.name">Asada Super Burrito</div>
<div class="row" data-field="item.1.name">Street Tacos</div>
<div class="row" data-field="item.2.name">Menudo</div></div>
</div><script>/*VOS-CANVAS*/window.__VOS_CW=${W4K};window.__VOS_CH=${H4K};</script>${ENGINE}</body></html>`;
}

/** R2 — a right-third hero PHOTO panel with the headline bridging onto it. */
function photoPanelBoard(slot) {
  const hero = {
    imgslot: '<div class="hero" data-imgslot="hero.image"></div>',
    img: '<div class="hero"><img data-imgslot="hero.image" alt="" style="width:100%;height:100%;display:block;background:#c84"></div>',
  }[slot];
  return `<!doctype html><html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}html,body{width:${W4K}px;height:${H4K}px;overflow:hidden}
.stage{position:relative;width:${W4K}px;height:${H4K}px;background:#2a1a12;color:#fff;font-family:Arial,sans-serif}
.hero{position:absolute;top:0;right:0;width:1280px;height:2160px;background:linear-gradient(#c84,#420)}
.col{position:absolute;top:300px;left:200px;width:3100px}
h1{font-size:260px;line-height:1}
</style></head><body><div class="stage">
${hero}
<div class="col"><h1 data-field="headline">Welcome To Super Taco</h1></div>
</div><script>/*VOS-CANVAS*/window.__VOS_CW=${W4K};window.__VOS_CH=${H4K};</script>${ENGINE}</body></html>`;
}

/** R3 — two columns; the LEFT one has a real collision (a two-line name in a
 *  one-line box overlapping the description under it), the RIGHT one is clean. */
function twoColumnBoard() {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}html,body{width:${W4K}px;height:${H4K}px;overflow:hidden}
.stage{position:relative;width:${W4K}px;height:${H4K}px;background:#f7f0e3;color:#2d1a13;font-family:Arial,sans-serif;display:grid;grid-template-columns:1200px 1fr}
.left{padding:120px 96px}.right{padding:120px 96px;background:#fffaf2}
.card{position:relative;height:520px}
.name{font-size:120px;line-height:1;height:120px}
.desc{font-size:60px;line-height:1.1;margin-top:8px}
.title{font-size:180px;line-height:1}
.body{font-size:72px;line-height:1.2;margin-top:48px}
</style></head><body><div class="stage">
<section class="left"><div class="card"><div class="name" id="lname" data-field="item.0.name">Grilled Chicken Super Burrito</div><div class="desc" id="ldesc" data-field="item.0.desc">Chicken, rice, beans and all the fixings.</div></div></section>
<section class="right"><div class="title" id="rtitle" data-field="headline">Burritos &amp; More</div><div class="body" id="rbody" data-field="subhead">Big flavor for every appetite.</div></section>
</div><script>/*VOS-CANVAS*/window.__VOS_CW=${W4K};window.__VOS_CH=${H4K};</script>${ENGINE}</body></html>`;
}

async function runBoard(browserType, html, evaluate) {
  const browser = await browserType.launch();
  try {
    const page = await browser.newPage({ viewport: { width: W4K, height: H4K } });
    await page.setContent(html, { waitUntil: 'load' });
    await page.waitForTimeout(2400);
    return await page.evaluate(evaluate);
  } finally {
    await browser.close();
  }
}

const FONT_SIZES = () =>
  Array.from(document.querySelectorAll('h1,.row')).map((e) => parseFloat(getComputedStyle(e).fontSize));
const HERO_BOX = () => {
  const h = document.querySelector('.hero');
  return { w: h.offsetWidth, h: h.offsetHeight, opacity: parseFloat(getComputedStyle(h).opacity) };
};
const TWO_COLUMNS = () => {
  const fs = (id) => parseFloat(getComputedStyle(document.getElementById(id)).fontSize);
  return { lname: fs('lname'), ldesc: fs('ldesc'), rtitle: fs('rtitle'), rbody: fs('rbody') };
};

let failures = 0;
function check(label, ok, detail) {
  console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

(async () => {
  for (const [engineName, browserType] of [['chromium', chromium], ['webkit', webkit]]) {
    console.log(`\n── ${engineName} ──`);

    const long = await measure(browserType, engineName, LONG_HEADLINE);
    console.log(`   long headline: ${long.fontSize.toFixed(1)}px, ${long.lines} line(s), overflow ${long.overflowsColumnBy}px`);
    check('a long headline stays inside its column', long.overflowsColumnBy <= 4, `${long.overflowsColumnBy}px past the column`);
    check('a long headline never crosses the photo panel', !long.crossesPhotoPanel);
    check('a long headline never overlaps the element below it', !long.overlapsNextElement);
    check('a long headline stays legible (>= the 26px floor at 1920x1080)', long.fontSize >= 25.5, `${long.fontSize.toFixed(1)}px`);
    check('the photo panel is not sacrificed to make room', long.photoWidth >= 590, `${long.photoWidth}px wide`);
    check('a long row name does not ride its value', !long.nameRidesValue);

    const short = await measure(browserType, engineName, SHORT_HEADLINE);
    console.log(`   short headline: ${short.fontSize.toFixed(1)}px, ${short.lines} line(s)`);
    check('a SHORT headline still fits on one line at full size (no regression)', short.lines === 1 && short.fontSize >= 117);
    check('a short headline does not overflow', short.overflowsColumnBy <= 4);

    // R1 — decorative, nearly invisible text is not a collision.
    for (const kind of ['opacity', 'ariaHidden', 'colorAlpha']) {
      const sizes = await runBoard(browserType, watermarkBoard(kind), FONT_SIZES);
      console.log(`   R1 watermark (${kind}): headline + rows = ${sizes.map((s) => s.toFixed(1)).join(', ')} (authored 220, 90, 90, 90)`);
      check(`R1 a ${kind} decorative initial leaves the 220px headline alone`, sizes[0] >= 219.5, `${sizes[0].toFixed(1)}px`);
      check(`R1 a ${kind} decorative initial leaves the 90px rows alone`, sizes.slice(1).every((s) => s >= 89.5), sizes.slice(1).join(', '));
    }
    // Negative control: the SAME geometry with a fully opaque initial is a real
    // collision, so the engine must still act on it (proves R1 is not simply
    // "the engine stopped measuring").
    {
      const sizes = await runBoard(browserType, watermarkBoard('none').replace('<div class="col">', '<div class="wm" style="color:#fff">S</div><div class="col">'), FONT_SIZES);
      console.log(`   R1 control (opaque initial): headline + rows = ${sizes.map((s) => s.toFixed(1)).join(', ')}`);
      check('R1 control: an OPAQUE overlapping initial still triggers the collision repair', sizes[0] < 219.5, `${sizes[0].toFixed(1)}px`);
    }

    // R2 — a photo slot is content, never decoration.
    for (const slot of ['imgslot', 'img']) {
      const box = await runBoard(browserType, photoPanelBoard(slot), HERO_BOX);
      console.log(`   R2 photo panel (${slot}): ${box.w}x${box.h} opacity ${box.opacity} (authored 1280x2160, opacity 1)`);
      check(`R2 the ${slot} photo panel keeps its 1280x2160 size`, box.w === 1280 && box.h === 2160, `${box.w}x${box.h}`);
      check(`R2 the ${slot} photo panel is not faded`, box.opacity >= 0.99, String(box.opacity));
    }

    // R3 — a real collision shrinks only its own column, and never below 85%.
    {
      const s = await runBoard(browserType, twoColumnBoard(), TWO_COLUMNS);
      console.log(`   R3 two columns: left name ${s.lname.toFixed(1)} desc ${s.ldesc.toFixed(1)} | right title ${s.rtitle.toFixed(1)} body ${s.rbody.toFixed(1)} (authored 120/60 | 180/72)`);
      check('R3 the clean RIGHT column keeps its authored sizes', s.rtitle >= 179.5 && s.rbody >= 71.5, `${s.rtitle}/${s.rbody}`);
      check('R3 the colliding LEFT column never goes below 85%', s.lname >= 120 * 0.85 - 0.5 && s.ldesc >= 60 * 0.85 - 0.5, `${s.lname}/${s.ldesc}`);
    }
  }

  console.log(failures ? `\n${failures} check(s) FAILED\n` : '\nAll fit-engine checks passed\n');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
