#!/usr/bin/env node
/**
 * Targeted poster regen for the fashion boards only (the redesign f4eee79c +
 * the 2026-07-23 photo bake changed their HTML but left the June posters in
 * place, so the gallery showed the OLD boards). Mirrors gen-template-posters.cjs
 * but scoped to signage/fashion so we don't touch ~100 unrelated posters.
 *
 * Usage (web-prod on :3000 already serves apps/web/public):
 *   node apps/web/scripts/regen-fashion-posters.cjs http://localhost:3000
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');

const BASE = process.argv[2] || 'http://localhost:3000';
const ROOT = path.join(__dirname, '..', 'public', 'templates');
const OUT = path.join(ROOT, '_thumbs');
const W = 800, H = 450;

const BOARDS = fs
  .readdirSync(path.join(ROOT, 'signage', 'fashion'))
  .filter((f) => f.endsWith('.html'))
  .map((f) => `signage/fashion/${f}`);

(async () => {
  console.log(`Regenerating ${BOARDS.length} fashion posters from ${BASE}`);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  let ok = 0, fail = 0;
  for (const rel of BOARDS) {
    const page = await ctx.newPage();
    try {
      await page.goto(`${BASE}/templates/${rel}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(3000); // fonts + autofit + photo load + settle
      await page.addStyleTag({ content: '*{animation:none!important;transition:none!important;}' });
      await page.waitForTimeout(150);
      const dest = path.join(OUT, rel.replace(/\.html$/, '.png'));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      await page.screenshot({ path: dest });
      console.log(`  ✓ ${rel}`);
      ok++;
    } catch (e) {
      fail++; console.log(`  ✗ ${rel}: ${String(e.message).slice(0, 80)}`);
    } finally { await page.close(); }
  }
  await ctx.close();
  await browser.close();
  console.log(`DONE — ${ok} posters written, ${fail} failed`);
})();
