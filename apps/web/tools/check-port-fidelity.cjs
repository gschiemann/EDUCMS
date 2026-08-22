#!/usr/bin/env node
/**
 * PORT FIDELITY — a ported board must render its approved design, exactly.
 *
 * WHY THIS EXISTS (2026-08-21). The port pipeline adds "invisible" seams to
 * each approved mockup: canonical brand-token aliases, config spans, an
 * inlined runtime. One of those seams emitted `--font-display:var(--font-display)`
 * — a self-referential CSS variable. CSS drops a cycle as invalid, the board
 * silently fell back to a serif face, and twelve boards shipped looking
 * nothing like the design that was signed off. Every other gate passed:
 * layout audits, click-to-edit, clocks, builds. None of them looks at
 * TYPOGRAPHY, so none of them could see it.
 *
 * The fixture is a fingerprint captured FROM the approved mockups
 * (font family, size, weight, color for every data-field). Regenerate it
 * only when a design is re-approved — never to make a red build go away.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('node:child_process');
const { chromium } = require('@playwright/test');

const PUBLIC_DIR = path.resolve(__dirname, '../public');
const FIXTURE = path.resolve(__dirname, '../tests/fixtures/board-typography.json');
const PORT = 8833;

(async () => {
  const expected = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const server = spawn('/bin/sh', ['-c', `ulimit -n 4096 2>/dev/null; exec python3 -m http.server ${PORT} --directory "${PUBLIC_DIR}"`], { stdio: ['ignore', 'ignore', 'ignore'] });
  await new Promise((r) => setTimeout(r, 1500));
  let browser = await chromium.launch();
  let made = 0;
  let bad = 0;

  for (const [board, fields] of Object.entries(expected)) {
    if (made >= 30) { await browser.close(); browser = await chromium.launch(); made = 0; }
    made += 1;
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await page.clock.install({ time: new Date('2026-08-21T10:00:00') });
    await page.goto(`http://localhost:${PORT}/templates/${board}.html?time=10:00`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
    await new Promise((r) => setTimeout(r, 1200));
    const actual = await page.evaluate(() => {
      const out = {};
      for (const el of document.querySelectorAll('[data-field]')) {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const r = el.getBoundingClientRect();
        if (r.width < 1 && r.height < 1) continue;
        out[el.getAttribute('data-field')] = [
          cs.fontFamily.split(',')[0].replace(/["']/g, ''),
          Math.round(parseFloat(cs.fontSize)), cs.fontWeight, cs.color,
        ];
      }
      return out;
    });
    await page.close();

    const drift = [];
    for (const [key, exp] of Object.entries(fields)) {
      const got = actual[key];
      if (!got) { drift.push(`${key}: missing`); continue; }
      const names = ['font', 'size', 'weight', 'color'];
      exp.forEach((v, i) => {
        const g = got[i];
        if (i === 1 ? Math.abs(v - g) > 1 : v !== g) drift.push(`${key}.${names[i]}: approved=${v} shipped=${g}`);
      });
    }
    if (drift.length) {
      bad += 1;
      console.error(`✗ ${board} — ${drift.length} typography drift(s) from the approved design`);
      drift.slice(0, 6).forEach((d) => console.error(`    ${d}`));
    } else {
      console.log(`✓ ${board}`);
    }
  }

  await browser.close();
  server.kill();
  console.log(bad
    ? `PORT FIDELITY: ${bad} board(s) no longer match their approved design`
    : `PORT FIDELITY: all ${Object.keys(expected).length} boards match their approved design`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
