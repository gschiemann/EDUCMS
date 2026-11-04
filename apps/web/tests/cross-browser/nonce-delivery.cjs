/* Exercises the injection script emitted by the compiled Android unit test. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, webkit } = require('@playwright/test');

async function main() {
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../player/app/build/nonce-delivery-fixture.json'), 'utf8'));
  for (const [name, type] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await type.launch();
    try {
      const context = await browser.newContext();
      // Every request stays in this test: no production or external connection.
      await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><body>Local bridge check</body>' }));
      const page = await context.newPage();
      await page.goto(fixture.origin + '/player');
      for (let i = 0; i < 3; i++) {
        assert.equal(await page.evaluate(key => window[key], fixture.global), undefined);
        assert.equal(await page.evaluate(fixture.script), fixture.acknowledgement);
        assert.equal(await page.evaluate(key => window[key], fixture.global), 'a'.repeat(64));
        await page.reload(); // Same URL, fresh document: must receive the nonce again.
      }
      await page.evaluate(() => {
        for (const src of ['/child', 'https://foreign.test/child']) {
          const frame = document.createElement('iframe'); frame.src = src; document.body.appendChild(frame);
        }
      });
      await page.waitForFunction(() => [...document.querySelectorAll('iframe')].every(f => f.contentWindow));
      for (const frame of page.frames().filter(f => f !== page.mainFrame())) {
        assert.equal(await frame.evaluate(fixture.script), null);
        assert.equal(await frame.evaluate(key => window[key], fixture.global), undefined);
      }
      for (const origin of ['https://sub.trusted-player.test', 'https://trusted-player.test.evil.test', 'http://trusted-player.test', 'https://trusted-player.test:444']) {
        await page.goto(origin + '/player');
        assert.equal(await page.evaluate(fixture.script), null);
        assert.equal(await page.evaluate(key => window[key], fixture.global), undefined);
      }
      // A queued script after navigation must recheck the execution origin.
      await page.goto(fixture.origin + '/player');
      await page.goto('https://foreign.test/redirected');
      assert.equal(await page.evaluate(fixture.script), null);
      for (const variant of fixture.defaultPorts) {
        await page.goto(variant.origin + '/player');
        assert.equal(await page.evaluate(variant.script), fixture.acknowledgement);
      }
      console.log(`${name}: compiled nonce script reload, subframe and execution-origin checks PASS`);
    } finally { await browser.close(); }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
