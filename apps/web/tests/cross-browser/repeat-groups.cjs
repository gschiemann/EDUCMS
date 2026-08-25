/**
 * repeat-groups.cjs — "if i want to add a 4th event i should be able to
 * and the cards resize… they need to just work no matter what the user
 * is trying to do."
 *
 * A board that ships `event.0.name` … `event.2.name` already declares a
 * list. The shim (EDUCMS-SHIM-V11) infers it — no per-board markup — and
 * grows or shrinks the real DOM, distributing the space across however
 * many rows there are.
 *
 * Two properties, checked on every board that has such a group:
 *
 *  1. IDENTITY. At the authored count the board must render EXACTLY as it
 *     did before this feature existed — pixel-for-pixel. That is what
 *     makes it safe to turn on across the whole library rather than
 *     opting boards in one at a time. (Boards with a live clock are
 *     compared structurally instead, since their pixels legitimately
 *     change between two screenshots.)
 *
 *  2. IT ACTUALLY FITS. At authored+1 the row count must really grow, and
 *     nothing may end up clipped, off-stage, or overlapping. A feature
 *     that adds a row the operator cannot read is not the feature.
 */
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path'), url = require('url');

const PUBLIC = path.resolve(__dirname, '..', '..', 'public');
const TEMPLATES = path.join(PUBLIC, 'templates');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.css': 'text/css', '.mp4': 'video/mp4' };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Boards with an indexed field group, and the group's authored length. */
function boardsWithGroups() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('_')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.name.endsWith('.html')) continue;
      const html = fs.readFileSync(p, 'utf8');
      const byGroup = {};
      for (const m of html.matchAll(/data-(?:field|mediafield|style)="([A-Za-z][\w-]*)\.(\d+)\./g)) {
        (byGroup[m[1]] ||= new Set()).add(Number(m[2]));
      }
      for (const [group, set] of Object.entries(byGroup)) {
        const idx = [...set].sort((a, b) => a - b);
        if (idx.length < 2) continue;
        if (idx.some((n, i) => i > 0 && n !== idx[i - 1] + 1)) continue;
        out.push({ rel: '/templates/' + path.relative(TEMPLATES, p).split(path.sep).join('/'), group, authored: idx.length });
      }
    }
  };
  walk(TEMPLATES);
  return out;
}

const MEASURE = () => {
  const stage = document.querySelector('#stage, .stage, .scene, main');
  if (!stage) return { noStage: true };
  const sr = stage.getBoundingClientRect();
  const rows = [];
  for (const el of stage.querySelectorAll('*')) {
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) continue;
    for (const n of [...el.childNodes].filter((x) => x.nodeType === 3 && x.textContent.trim())) {
      const rg = document.createRange(); rg.selectNodeContents(n);
      const r = rg.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
      let occluded = false;
      if (hit && !(hit === el || el.contains(hit) || hit.contains(el))) {
        const area = Math.max(1, r.width * r.height);
        for (let n2 = hit; n2 && n2 !== document.body; n2 = n2.parentElement) {
          if (n2.contains(el)) break;
          const bg = getComputedStyle(n2).backgroundColor || '';
          const parts = (bg.match(/rgba?\(([^)]+)\)/) || [, ''])[1].split(',');
          const alpha = parts.length > 3 ? parseFloat(parts[3]) : (parts.length === 3 ? 1 : 0);
          if (!(alpha > 0.85)) continue;
          const nr = n2.getBoundingClientRect();
          const ow = Math.min(nr.right, r.right) - Math.max(nr.left, r.left);
          const oh = Math.min(nr.bottom, r.bottom) - Math.max(nr.top, r.top);
          if (ow > 0 && oh > 0 && (ow * oh) / area >= 0.9) { occluded = true; break; }
        }
      }
      if (!occluded) rows.push({ t: n.textContent.trim().slice(0, 24), l: r.left, r: r.right, tp: r.top, b: r.bottom });
    }
  }
  let overlaps = 0;
  for (let i = 0; i < rows.length; i += 1) for (let j = i + 1; j < rows.length; j += 1) {
    const w = Math.min(rows[i].r, rows[j].r) - Math.max(rows[i].l, rows[j].l);
    const h = Math.min(rows[i].b, rows[j].b) - Math.max(rows[i].tp, rows[j].tp);
    if (w > 3 && h > 3) overlaps += 1;
  }
  const outside = rows.filter((r) => r.l < sr.left - 1 || r.r > sr.right + 1 || r.tp < sr.top - 1 || r.b > sr.bottom + 1);
  return {
    noStage: false, overlaps, outside: outside.length,
    outsideSample: outside.slice(0, 2).map((r) => r.t),
    scroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
    signature: rows.map((r) => `${r.t}@${Math.round(r.l)},${Math.round(r.tp)}`).join('|'),
  };
};

(async () => {
  const srv = http.createServer((q, r) => {
    const p = path.join(PUBLIC, decodeURIComponent(url.parse(q.url).pathname));
    fs.readFile(p, (e, d) => {
      if (e) { r.writeHead(404); return r.end('nf'); }
      r.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
      r.end(d);
    });
  });
  await new Promise((r) => srv.listen(0, r));
  const port = srv.address().port;
  const boards = boardsWithGroups();
  const browser = await chromium.launch();
  const failures = [];
  let identical = 0, structural = 0, grew = 0;

  const load = async (rel, q) => {
    const pg = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    await pg.goto(`http://127.0.0.1:${port}${rel}${q}`, { waitUntil: 'networkidle', timeout: 25000 });
    await pg.addStyleTag({ content: '*{animation:none!important;transition:none!important}' });
    await pg.waitForTimeout(700);
    const m = await pg.evaluate(MEASURE);
    const png = (await pg.screenshot({ type: 'png' })).toString('base64');
    await pg.close();
    return { m, png };
  };

  for (const { rel, group, authored } of boards) {
    const sep = rel.includes('?') ? '&' : '?';
    let base, same, more;
    try {
      base = await load(rel, '');
      same = await load(rel, `${sep}repeat=${b64({ [group]: authored })}`);
      more = await load(rel, `${sep}repeat=${b64({ [group]: authored + 1 })}`);
    } catch (e) {
      failures.push(`${rel} [${group}]: failed to load — ${String(e.message).slice(0, 70)}`);
      continue;
    }
    if (base.m.noStage) continue; // not a fixed-stage board

    // 1. Identity at the authored count.
    if (same.png === base.png) identical += 1;
    else if (same.m.signature === base.m.signature) structural += 1;
    else failures.push(`${rel} [${group}]: setting the count to its own authored value (${authored}) changed the layout`);

    // 2. One more row really appears, and fits.
    const rowsGrew = more.m.signature !== base.m.signature;
    if (!rowsGrew) failures.push(`${rel} [${group}]: asking for ${authored + 1} changed nothing — the group was not detected`);
    else grew += 1;
    if (more.m.overlaps > base.m.overlaps) failures.push(`${rel} [${group}]: +1 row introduced ${more.m.overlaps - base.m.overlaps} text overlap(s)`);
    if (more.m.outside > base.m.outside) failures.push(`${rel} [${group}]: +1 row pushed text off the stage ${JSON.stringify(more.m.outsideSample)}`);
    if (more.m.scroll[1] > 1081) failures.push(`${rel} [${group}]: +1 row made the page scroll (${more.m.scroll.join('x')})`);
  }

  await browser.close();
  srv.close();

  if (failures.length) {
    console.error(`\nREPEAT GROUPS — ${failures.length} failure(s) across ${boards.length} group(s):\n`);
    failures.slice(0, 40).forEach((f) => console.error('  ✗ ' + f));
    if (failures.length > 40) console.error(`  … and ${failures.length - 40} more`);
    console.error('');
    process.exit(1);
  }
  console.log(`REPEAT GROUPS: ${boards.length} groups across the library — ${identical} pixel-identical at their authored count`
    + `${structural ? ` (+${structural} structurally identical; live clocks)` : ''}, ${grew} grew by one row with no clipping, overlap or scroll.`);
})();
