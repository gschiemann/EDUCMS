/* Screenshot every bar board (chromium, landscape + optional portrait). Usage:
   node shoot-bar-boards.cjs <boards-dir> <out-dir> [--portrait]           */
const { createRequire } = require('module');
const req = createRequire('/Users/gschiemann/Desktop/EDU CMS/apps/web/package.json');
const { chromium } = req('@playwright/test');
const fs = require('fs');
const path = require('path');

(async () => {
  const dir = process.argv[2];
  const out = process.argv[3];
  const portrait = process.argv.includes('--portrait');
  fs.mkdirSync(out, { recursive: true });
  const files = fs.readdirSync(dir).filter((f) => /^(0\d|10)-.*\.html$/.test(f)).sort();
  const b = await chromium.launch();
  const report = [];
  for (const f of files) {
    const url = 'file://' + path.join(dir, f);
    for (const o of portrait ? ['land', 'port'] : ['land']) {
      const vp = o === 'port' ? { width: 608, height: 1080 } : { width: 1920, height: 1080 };
      const p = await b.newPage({ viewport: vp });
      const errs = [];
      p.on('pageerror', (e) => errs.push(e.message));
      await p.goto(url + (o === 'port' ? '?o=portrait' : ''), { waitUntil: 'load' });
      await p.waitForTimeout(2500);
      const name = f.replace('.html', '') + (o === 'port' ? '-port' : '') + '.png';
      await p.screenshot({ path: path.join(out, name) });
      const stats = await p.evaluate(() => ({
        fields: document.querySelectorAll('[data-field]').length,
        imgslots: document.querySelectorAll('[data-imgslot]').length,
        overflow: Math.max(0, document.documentElement.scrollHeight - document.documentElement.clientHeight),
      }));
      report.push({ file: f, orient: o, errors: errs, ...stats });
      await p.close();
    }
  }
  await b.close();
  console.log(JSON.stringify(report, null, 1));
})();
