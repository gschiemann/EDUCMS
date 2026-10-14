#!/usr/bin/env node
// Real Chromium + the shipped worker: cache video, fail the host, cold reload.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { chromium } = require('@playwright/test');
const root = path.resolve(__dirname, '..');
const sw = fs.readFileSync(path.join(root, 'public/sw-player.js'));
const video = fs.readFileSync(path.join(root, 'tests/e2e/fixtures/loop-clip.mp4'));
const sha256 = createHash('sha256').update(video).digest('hex');
const html = '<!doctype html><html><head><script src="/_next/static/chunks/outage-proof.js"></script></head><body style="background:black"><video id="clip" autoplay muted loop playsinline src="/clip.mp4" style="width:640px;height:360px"></video><script>navigator.serviceWorker.register("/sw-player.js",{scope:"/player"})</script></body></html>';
let hostStatus = 200;
const server = http.createServer((req, res) => {
  const p = new URL(req.url, 'http://localhost').pathname;
  if (hostStatus !== 200) { res.writeHead(hostStatus, { 'content-type': 'text/plain', 'cache-control': 'no-store' }); return res.end('DEPLOYMENT_DISABLED'); }
  const routes = {
    '/player': ['text/html', html],
    '/sw-player.js': ['application/javascript', sw],
    '/_next/static/chunks/outage-proof.js': ['application/javascript', 'window.outageProof=true;'],
    '/clip.mp4': ['video/mp4', video],
  };
  const hit = routes[p];
  if (!hit) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': hit[0], 'cache-control': 'no-store', 'service-worker-allowed': '/player' });
  res.end(hit[1]);
});
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(origin + '/player');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    const send = msg => page.evaluate(m => new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => reject(new Error('worker acknowledgement timeout')), 20000);
      channel.port1.onmessage = e => { if (e.data.started) return; clearTimeout(timer); resolve(e.data); };
      navigator.serviceWorker.controller.postMessage(m, [channel.port2]);
    }), msg);
    assert.equal((await send({ type: 'PRECACHE_SHELL' })).ok, true);
    assert.equal((await send({ type: 'PRECACHE_PLAYLIST', assets: [{ url: origin + '/clip.mp4', sha256, size: video.length }] })).ok, true);
    for (const mode of [402, 503, 'offline', 200]) {
      hostStatus = mode === 'offline' ? 200 : mode;
      await context.setOffline(mode === 'offline');
      const response = await page.reload({ waitUntil: 'load' });
      assert.equal(response.status(), 200, `${mode}: cached navigation must be successful`);
      assert.equal(await page.evaluate(() => window.outageProof), true, 'cached script executed');
      await page.waitForFunction(() => {
        const v = document.querySelector('video');
        return v && v.readyState >= 2 && !v.paused && v.getVideoPlaybackQuality().totalVideoFrames > 2;
      });
      const first = await page.locator('video').evaluate(v => v.getVideoPlaybackQuality().totalVideoFrames);
      await page.waitForFunction(n => document.querySelector('video').getVideoPlaybackQuality().totalVideoFrames > n + 8, first);
      const evidence = await page.locator('video').evaluate(v => ({ frames: v.getVideoPlaybackQuality().totalVideoFrames, readyState: v.readyState, width: v.videoWidth, height: v.videoHeight }));
      if (process.env.OUTAGE_PROOF_DIR) {
        fs.mkdirSync(process.env.OUTAGE_PROOF_DIR, { recursive: true });
        await page.screenshot({ path: path.join(process.env.OUTAGE_PROOF_DIR, `playback-${mode}.png`) });
      }
      console.log(JSON.stringify({ mode, status: response.status(), ...evidence }));
    }
  } finally {
    if (browser) await browser.close();
    await new Promise(r => server.close(r));
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
