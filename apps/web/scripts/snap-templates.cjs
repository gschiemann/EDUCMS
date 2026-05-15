#!/usr/bin/env node
/**
 * Render static JPG snapshots of the marketing landing-page template
 * previews (apps/web/public/demo/templates/*.html). Mobile Safari can't
 * tolerate even ONE animated 1920×1080 iframe — the cumulative GPU /
 * compositor cost OOMs the renderer process. So on mobile we show a
 * JPG instead. This script generates those JPGs from the live HTML
 * templates via headless Chrome — keeps the mobile preview in lock-
 * step with whatever the desktop iframe would show.
 *
 * Usage (from repo root):
 *   node apps/web/scripts/snap-templates.cjs
 *
 * Re-run whenever the HTML in demo/templates/*.html changes so the
 * mobile preview reflects the latest design. Three JPGs total today
 * (~360 KB combined); each is ~100–145 KB at 1280×720 quality 82.
 *
 * Render-size choice:
 *   1280×720 covers a mobile retina card (~350×197 CSS px @ 3x ≈
 *   1050×591 actual pixels) with margin for tablet sizes too. JPG
 *   quality 82 is the sweet spot where lossy artifacts aren't visible
 *   on the cards at any common screen size, and total payload stays
 *   under 500 KB for the gallery section.
 */
const path = require('path');
const fs = require('fs');

// Look for playwright in either the apps/web local install or the pnpm
// hoisted location (the repo uses pnpm so it lives in .pnpm).
function resolvePlaywright() {
  const candidates = [
    path.resolve(__dirname, '../node_modules/playwright/index.js'),
    path.resolve(__dirname, '../../../node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.js'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return require(c);
  }
  throw new Error('playwright not found — run `pnpm install` first');
}

const { chromium } = resolvePlaywright();

const TEMPLATES = ['rainbow', 'middle-school', 'varsity'];
const SRC_DIR = path.resolve(__dirname, '../public/demo/templates');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });
  for (const name of TEMPLATES) {
    const page = await ctx.newPage();
    const fileUrl = 'file://' + path.join(SRC_DIR, name + '.html');
    await page.goto(fileUrl, { waitUntil: 'load' });
    // Give animations one frame to settle so the snapshot lands on a
    // sensible "first beat" pose. Templates without animations don't
    // care; templates with intro animations get past the opening fade.
    await page.waitForTimeout(800);
    const out = path.join(SRC_DIR, name + '.jpg');
    await page.screenshot({ path: out, fullPage: false, type: 'jpeg', quality: 82 });
    const stat = fs.statSync(out);
    console.log(`${name} -> ${out} (${Math.round(stat.size / 1024)} KB)`);
    await page.close();
  }
  await browser.close();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
