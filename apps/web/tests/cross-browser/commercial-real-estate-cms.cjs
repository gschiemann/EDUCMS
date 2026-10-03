const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium, webkit } = require('@playwright/test');
const root = path.resolve(__dirname, '../../../..');
const publicRoot = path.join(root, 'apps/web/public');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'docs/templates/commercial-real-estate-install-manifest.json')));
const output = process.env.CRE_TEST_OUTPUT || '/tmp/commercial-real-estate-proof';
const capture = process.argv.includes('--capture-posters');
fs.mkdirSync(output, { recursive: true });
const server = http.createServer((req, res) => {
  const file = path.resolve(publicRoot, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
  if (!file.startsWith(publicRoot + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png' }[path.extname(file)] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': mime }); fs.createReadStream(file).pipe(res);
});
const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
let base;
async function mount(browser, record, extra = '') {
  const page = await browser.newPage({ viewport: record.orientation === 'PORTRAIT' ? { width: 720, height: 1280 } : { width: 1280, height: 720 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const url = base + record.url + (record.url.includes('?') ? '&' : '?') + extra;
  await page.setContent(`<style>body{margin:0}</style><iframe title="Property board" sandbox="allow-scripts" src="${url}" style="position:absolute;top:0;left:0;width:100%;height:100%;border:0"></iframe><script>window.messages=[];addEventListener('message',e=>window.messages.push(e.data));</script>`);
  const frame = page.frames().find(f => f !== page.mainFrame());
  await frame.waitForSelector('[data-native-image-carousel]');
  await frame.evaluate(() => document.fonts.ready);
  await frame.waitForFunction(() => Array.from(document.querySelectorAll('[data-native-image-carousel] img')).every(i => i.complete && i.naturalWidth > 0));
  await frame.evaluate(() => Promise.all(Array.from(document.querySelectorAll('img')).map(i => i.decode ? i.decode().catch(() => {}) : Promise.resolve())));
  await page.waitForTimeout(250);
  return { page, frame, errors };
}
async function send(page, data) {
  await page.evaluate(d => document.querySelector('iframe').contentWindow.postMessage(d, '*'), data);
  await page.waitForTimeout(100);
}
async function layout(frame) {
  return frame.evaluate(() => ({
    origin: self.origin,
    portrait: document.querySelector('.stage').classList.contains('portrait'),
    fields: document.querySelectorAll('[data-field]').length,
    native: document.querySelectorAll('[data-native-image-carousel]').length,
    clipped: Array.from(document.querySelectorAll('.stage [data-fit]')).filter(e => e.offsetWidth && e.offsetHeight && e.scrollWidth > e.clientWidth + 3).map(e => e.dataset.field),
    tooSmall: Array.from(document.querySelectorAll('.stage [data-fit]')).filter(e => e.offsetWidth && e.offsetHeight && parseFloat(getComputedStyle(e).fontSize) < 50).map(e => e.dataset.field),
    logosContained: Array.from(document.querySelectorAll('[data-imgslot*="logo"] img')).every(i => getComputedStyle(i).objectFit === 'contain'),
    plansContained: Array.from(document.querySelectorAll('[data-imgslot*="plan"] img')).every(i => getComputedStyle(i).objectFit === 'contain'),
  }));
}
async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); base = 'http://127.0.0.1:' + server.address().port;
  const results = [];
  const provenancePath = path.join(publicRoot, 'templates/_thumbs/poster-manifest.json');
  const provenance = JSON.parse(fs.readFileSync(provenancePath));
  try {
    for (const [engineName, engine] of Object.entries({ chromium, webkit })) {
      const browser = await engine.launch();
      try {
        for (const record of manifest) {
          const { page, frame, errors } = await mount(browser, record, 'text=' + enc({ 'carousel.autoplay': 'no' }));
          const proof = await layout(frame);
          assert.equal(proof.portrait, record.orientation === 'PORTRAIT', record.id);
          assert.equal(proof.origin, 'null', record.id + ' sandbox origin');
          assert.deepEqual(proof.clipped, [], record.id + ' clipped');
          assert.deepEqual(proof.tooSmall, [], record.id + ' small type');
          assert.equal(proof.logosContained, true, record.id + ' logo fit');
          assert.equal(proof.plansContained, true, record.id + ' plan fit');
          assert.deepEqual(errors, [], record.id + ' browser errors');
          const slug = record.url.slice('/templates/'.length).split('?')[0].replace(/\.html$/, '');
          const poster = slug + (record.orientation === 'PORTRAIT' ? '-portrait' : '') + '.png';
          await page.screenshot({ path: path.join(output, engineName + '-' + record.id + '.png') });
          if (capture && engineName === 'chromium') {
            const dest = path.join(publicRoot, 'templates/_thumbs', poster); fs.mkdirSync(path.dirname(dest), { recursive: true });
            await page.screenshot({ path: dest }); provenance[slug] = record.sha256.slice(0, 16);
          }
          results.push({ engine: engineName, id: record.id, ...proof });
          await page.close();
        }
        for (const collection of ['standard', 'jll']) for (const orientation of ['LANDSCAPE', 'PORTRAIT']) {
          const tour = manifest.find(r => r.collection === collection && r.orientation === orientation && r.url.includes('07-guided'));
          const { page, frame, errors } = await mount(browser, tour);
          const keys = await frame.locator('[data-page]').evaluateAll(es => es.map(e => e.dataset.page));
          for (const key of keys) {
            await frame.locator('[data-nav="' + key + '"]').click();
            assert.equal(await frame.locator('[data-page="' + key + '"]').isVisible(), true);
            assert.deepEqual((await layout(frame)).clipped, [], tour.id + ' ' + key);
            await page.screenshot({ path: path.join(output, engineName + '-' + tour.id + '-' + key + '.png') });
          }
          await frame.locator('[data-nav="plans"]').click();
          await frame.locator('[data-zoom="in"]').click();
          assert.equal(await frame.locator('[data-field="plans.zoom"]').textContent(), '150%');
          assert.equal(await frame.locator('.plan-canvas').evaluate(e => e.offsetWidth > e.parentElement.clientWidth), true);
          await frame.locator('[data-plan="1"]').click();
          assert.equal(await frame.locator('[data-field="plans.zoom"]').textContent(), '100%');
          assert.equal(await frame.locator('[data-imgslot="plan.flex"]').isVisible(), true);
          await send(page, { type: 'educms-overrides', text: { 'tour.startPage': 'amenities', 'theme.brand': '#125599', 'amenity.0.name': 'ROOFTOP LOUNGE', 'contact.url': 'https://example.com/approved-brochure', 'media.plan.office.fit': 'contain' }, textStyles: { 'amenity.0.name': { fontSize: 98, fontWeight: '700', offsetX: 16, offsetY: 12 } } });
          assert.equal(await frame.locator('[data-page="amenities"]').isVisible(), true);
          assert.equal(await frame.locator('[data-field="amenity.0.name"]').textContent(), 'ROOFTOP LOUNGE');
          assert.equal(await frame.locator('[data-field="amenity.0.name"]').evaluate(e => e.style.transform.includes('16px') && e.style.transform.includes('12px')), true, 'hidden-page saved position');
          await send(page, { type: 'educms-layout-request' });
          assert.equal(await page.evaluate(() => window.messages.some(m => m.type === 'educms-layout-ready' && m.keys.includes('amenity.0.name'))), true, 'hidden-page layout tools');
          await send(page, { type: 'educms-edit-mode', on: true });
          await frame.locator('[data-field="amenity.0.name"]').click();
          await page.waitForFunction(() => window.messages.some(m => m.type === 'educms-field-click' && m.key === 'amenity.0.name'));
          await send(page, { type: 'educms-edit-mode', on: false });
          await frame.locator('[data-nav="contact"]').click();
          assert.equal(await frame.locator('[data-qr]').getAttribute('data-destination'), 'https://example.com/approved-brochure');
          await send(page, { type: 'educms-overrides', text: { 'contact.url': 'javascript:alert(1)' } });
          assert.equal(await frame.locator('[data-qr]').getAttribute('data-error'), 'invalid-url');
          await send(page, { type: 'educms-overrides', text: { 'tour.idleSeconds': '30' } });
          await frame.evaluate(() => { const now = Date.now.bind(Date); Date.now = () => now() + 31000; });
          await frame.waitForFunction(() => !document.querySelector('[data-page="overview"]').hidden);
          assert.deepEqual(errors, []);
          results.push({ engine: engineName, id: tour.id, interaction: '8 pages, zoom, switch plan, theme/copy/style/position edits, QR validation, idle reset' });
          await page.close();

          const finder = manifest.find(r => r.collection === collection && r.orientation === orientation && r.url.includes('08-property'));
          const f = await mount(browser, finder);
          await f.frame.locator('[data-filter="Industrial"]').click();
          assert.equal(await f.frame.locator('.listing-card:visible').count(), 1);
          await f.frame.locator('[data-filter="all"]').click();
          const selects = f.frame.locator('[data-select]');
          await selects.nth(0).click(); await selects.nth(1).click(); await selects.nth(2).click();
          assert.equal(await f.frame.locator('[data-select][aria-pressed="true"]').count(), 2);
          await f.frame.locator('[data-compare]').click();
          assert.equal(await f.frame.locator('.dialog-shell').isVisible(), true);
          assert.equal(await f.frame.locator('.dialog-grid>article').count(), 3);
          assert.equal(await f.frame.locator('#finder-dialog-title').textContent(), 'Side by side');
          await send(f.page, { type: 'educms-overrides', text: { 'listing.0.name': 'Approved Tower' }, textStyles: { 'listing.0.name': { offsetX: 20 } } });
          assert.equal(await f.frame.locator('.dialog-grid [data-field="listing.0.name"]').textContent(), 'Approved Tower');
          assert.equal(await f.frame.locator('.dialog-grid [data-field="listing.0.name"]').evaluate(e => e.style.transform.includes('20px')), true, 'dialog layout offsets');
          await f.page.keyboard.press('Escape');
          assert.equal(await f.frame.locator('.dialog-shell').isVisible(), false);
          assert.equal(await f.frame.locator('[data-compare]').evaluate(e => e === document.activeElement), true, 'restored keyboard focus');
          await f.frame.locator('[data-explore]').nth(0).click();
          assert.equal(await f.frame.locator('.dialog-grid').innerText().then(t => t.includes('Concept floor plan')), true);
          assert.equal(await f.frame.locator('#finder-dialog-title').textContent(), 'Property details');
          await f.frame.locator('[data-close]').click();
          await send(f.page, { type: 'educms-overrides', text: { 'finder.idleSeconds': '30' } });
          await f.frame.evaluate(() => { const now = Date.now.bind(Date); Date.now = () => now() + 31000; });
          await f.frame.waitForFunction(() => document.querySelector('[data-compare]').textContent.includes('(0 / 2)'));
          assert.deepEqual(f.errors, []);
          results.push({ engine: engineName, id: finder.id, interaction: 'filters, two-property limit, comparison, detail plans, dialog edits, keyboard/focus, idle reset' });
          await f.page.close();
        }
        // Persisted query edits and the same gallery protocol used by Properties.
        const record = manifest.find(r => r.collection === 'standard' && r.orientation === 'LANDSCAPE' && r.url.includes('01-property'));
        const { page, frame } = await mount(browser, record, 'freeze=1&text=' + enc({ 'property.name': 'APPROVED PROPERTY', 'theme.brand': '#993355' }) + '&textStyles=' + enc({ 'property.name': { fontSize: 200, offsetX: 25 } }));
        assert.equal(await frame.locator('[data-field="property.name"]').textContent(), 'APPROVED PROPERTY');
        assert.equal(await frame.locator('[data-field="property.name"]').evaluate(e => e.style.transform.includes('25px')), true);
        const imgs = [base + '/templates/signage/corporate/commercial-real-estate/_assets/lobby.jpg', base + '/templates/signage/corporate/commercial-real-estate/_assets/office.jpg'];
        await send(page, { type: 'educms-overrides', img: { 'property.hero': imgs }, text: { 'media.property.hero.mode': 'single', 'media.property.hero.fit': 'contain', 'carousel.intervalSeconds': '2' } });
        await frame.waitForFunction(() => document.querySelector('[data-imgslot="property.hero"] img').src.includes('lobby.jpg'));
        assert.equal(await frame.locator('[data-imgslot="property.hero"] img').first().evaluate(e => getComputedStyle(e).objectFit), 'contain');
        await send(page, { type: 'educms-overrides', img: { 'property.hero': [] } });
        assert.equal(await frame.locator('[data-imgslot="property.hero"] img').count(), 0, 'clear gallery stays empty');
        results.push({ engine: engineName, persistence: 'query text/style/offset; gallery replacement, fit, mode, clear' });
        await page.close();
      } finally { await browser.close(); }
      console.log(engineName + ': render and interaction checks passed');
    }
    if (capture) fs.writeFileSync(provenancePath, JSON.stringify(provenance, null, 2) + '\n');
    fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify({ pass: true, cases: results.length, output }));
  } finally { await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
