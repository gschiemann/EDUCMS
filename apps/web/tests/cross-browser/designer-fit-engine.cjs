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
  <div class="tag" id="tag" data-field="tagline">Riot Color &middot; Since 2004</div>
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
  }

  console.log(failures ? `\n${failures} check(s) FAILED\n` : '\nAll fit-engine checks passed\n');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
