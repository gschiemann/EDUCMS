#!/usr/bin/env node
/**
 * snap-templates.cjs — render marketing template previews to JPG.
 *
 * TemplateEmbed (apps/web/src/components/marketing/TemplateEmbed.tsx)
 * never mounts a live iframe on mobile — one animated 1920x1080 iframe
 * crashes iOS Safari's renderer. On mobile it shows a `staticImage`
 * instead. This script generates those static images: it loads each
 * template HTML in headless Chromium at the 1920x1080 design canvas,
 * lets fonts + intro animations settle, and writes a JPG into
 * apps/web/public/demo/templates/.
 *
 * Usage:
 *   node scripts/snap-templates.cjs                    # only missing JPGs
 *   node scripts/snap-templates.cjs --force            # regenerate all
 *   BASE=http://localhost:3000 node scripts/snap-templates.cjs
 *
 * BASE must point at a server that serves apps/web/public at its root
 * (the Next.js dev server does). Default http://localhost:3000.
 *
 * When you add an industry to IndustryShowcase, add its template here
 * and run this script so the mobile preview is a real template, not a
 * gradient placeholder.
 */
const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const BASE = (process.env.BASE || 'http://localhost:3000').replace(/\/$/, '');
const FORCE = process.argv.includes('--force');
const OUT_DIR = path.join(__dirname, '..', 'apps', 'web', 'public', 'demo', 'templates');

// Every industry preview in IndustryShowcase + the landing gallery.
// `src` is the template path under public/; `out` is the JPG filename
// TemplateEmbed references as `staticImage`.
const TEMPLATES = [
  { src: '/demo/templates/rainbow.html',                                  out: 'rainbow.jpg' },
  { src: '/templates/hs/ath-gameday.html',                                out: 'sports-gameday.jpg' },
  { src: '/templates/signage/qsr/01-drive-thru-flagship.html',            out: 'qsr-drive-thru.jpg' },
  { src: '/templates/signage/menus-pos/01-fullservice-menu.html',         out: 'restaurant-menu.jpg' },
  { src: '/templates/signage/fashion/03-sale.html',                       out: 'retail-sale.jpg' },
  { src: '/templates/signage/fashion/01-lookbook-flagship.html',          out: 'fashion-lookbook.jpg' },
  { src: '/demo/templates/varsity.html',                                  out: 'varsity.jpg' },
  { src: '/templates/signage/healthcare/01-waiting-room-flagship.html',   out: 'healthcare-waiting.jpg' },
  { src: '/templates/signage/hospitality/03-events-board.html',           out: 'hospitality-events.jpg' },
  { src: '/templates/signage/corporate/01-lobby-welcome-flagship.html',   out: 'corporate-lobby.jpg' },
  { src: '/templates/signage/bar/01-tap-list-flagship.html',              out: 'bar-taplist.jpg' },
];

(async () => {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });
  let made = 0, skipped = 0, failed = 0;
  for (const t of TEMPLATES) {
    const outPath = path.join(OUT_DIR, t.out);
    if (!FORCE && fs.existsSync(outPath)) {
      console.log(`skip   ${t.out} (exists)`);
      skipped++;
      continue;
    }
    try {
      await page.goto(BASE + t.src, { waitUntil: 'load', timeout: 30000 });
      await page.waitForTimeout(2000); // fonts + intro animations settle
      await page.screenshot({ path: outPath, type: 'jpeg', quality: 84 });
      console.log(`made   ${t.out}  <-  ${t.src}`);
      made++;
    } catch (e) {
      console.error(`FAIL   ${t.out}: ${e.message}`);
      failed++;
    }
  }
  await browser.close();
  console.log(`\n${made} made, ${skipped} skipped, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
