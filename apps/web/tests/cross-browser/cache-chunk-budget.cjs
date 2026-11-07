/* Real CacheStorage + media decoding; no production connection or app server. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createHash } = require('node:crypto');
const { chromium, webkit } = require('@playwright/test');

async function main() {
  const clip = fs.readFileSync(path.join(__dirname, '../e2e/fixtures/loop-clip.mp4'));
  const pad = Buffer.alloc(9 * 1024 * 1024 - clip.length);
  pad.writeUInt32BE(pad.length); pad.write('free', 4);
  const file = Buffer.concat([clip, pad]);
  const sha256 = createHash('sha256').update(file).digest('hex');
  const worker = fs.readFileSync(path.join(__dirname, '../../public/sw-player.js'), 'utf8');
  // Enforce a staging budget just above one complete file. Reject a second
  // assembled copy too, so verified-chunk serving must work in a real browser.
  const fault = `
    const realOpen = caches.open.bind(caches);
    caches.open = async function(name) {
      const cache = await realOpen(name);
      if (cache.__budgetWrapped) return cache;
      cache.__budgetWrapped = true;
      const realPut = cache.put.bind(cache);
      cache.put = async function(request, response) {
        const url = new URL(typeof request === 'string' ? request : request.url, self.location.origin).href;
        if (url.endsWith('/player/video.mp4')) throw new DOMException('Quota exceeded.', 'QuotaExceededError');
        if (name === STAGING_CACHE) {
          let occupied = 0;
          for (const key of await cache.keys()) {
            if (key.url !== url) occupied += (await (await cache.match(key)).blob()).size;
          }
          const bytes = (await response.clone().blob()).size;
          if (occupied + bytes > ${file.length + 512 * 1024}) throw new DOMException('Quota exceeded.', 'QuotaExceededError');
        }
        return realPut(request, response);
      };
      return cache;
    };`;
  let forceChunkServing = true;
  const server = http.createServer((req, res) => {
    if (req.url === '/sw-player.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript', 'Service-Worker-Allowed': '/' });
      // WebKit's existing verified-chunks media serving path is unsupported
      // in this harness. Still test the chunk budget and ordinary assembled
      // cache playback there; Chromium also exercises chunk-backed playback.
      return res.end(worker + (forceChunkServing ? fault : fault.replace("if (url.endsWith('/player/video.mp4'))", 'if (false)')));
    }
    if (req.url === '/player/video.mp4') {
      const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
      const start = m ? Number(m[1]) : 0;
      const end = m && m[2] ? Math.min(Number(m[2]), file.length - 1) : file.length - 1;
      res.writeHead(m ? 206 : 200, { 'Content-Type': 'video/mp4', 'Content-Length': end - start + 1,
        ...(m ? { 'Content-Range': `bytes ${start}-${end}/${file.length}` } : {}) });
      return res.end(file.subarray(start, end + 1));
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><body style="margin:0;background:#000"><video muted playsinline loop style="width:640px;height:360px"></video></body>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const [name, type] of [['chromium', chromium], ['webkit', webkit]]) {
      forceChunkServing = name === 'chromium';
      const browser = await type.launch({ headless: true });
      try {
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.goto(base + '/player/test');
        const result = await page.evaluate(async ({ sha256, size }) => {
          const reg = await navigator.serviceWorker.register('/sw-player.js', { scope: '/' });
          await navigator.serviceWorker.ready;
          if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
          const ask = message => new Promise((resolve, reject) => {
            const port = new MessageChannel();
            const timer = setTimeout(() => reject(new Error('worker timeout')), 30000);
            port.port1.onmessage = e => { if (!e.data.started && !e.data.progress) { clearTimeout(timer); port.port1.close(); resolve(e.data); } };
            reg.active.postMessage(message, [port.port2]);
          });
          const asset = { url: location.origin + '/player/video.mp4', sha256, size };
          let offset = 0;
          while (offset < size) {
            const r = await ask({ type: 'PRECACHE_CHUNK', ...asset, offset, chunkBytes: 8 * 1024 * 1024 });
            if (!r.ok) throw new Error(JSON.stringify(r));
            offset = r.nextOffset;
          }
          const verified = await ask({ type: 'PRECACHE_VERIFY', ...asset });
          if (!verified.ok) throw new Error(JSON.stringify(verified));
          const assembled = await ask({ type: 'PRECACHE_ASSEMBLE', ...asset });
          return assembled;
        }, { sha256, size: file.length });
        assert.equal(result.ok, true);
        if (forceChunkServing) assert.equal(result.storage, 'verified-chunks');
        await context.setOffline(true);
        const digest = await page.evaluate(async ({ direct }) => {
          const v = document.querySelector('video');
          const response = direct ? await fetch('/player/video.mp4')
            : await (await caches.open((await caches.keys()).find(name => name.startsWith('edu-player-playlist-')))).match(location.origin + '/player/video.mp4');
          if (!response) throw new Error('assembled cache entry missing');
          const bytes = await response.arrayBuffer();
          const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(n => n.toString(16).padStart(2, '0')).join('');
          if (direct) { v.src = '/player/video.mp4'; await v.play(); }
          return hash;
        }, { direct: forceChunkServing });
        assert.equal(digest, sha256);
        if (forceChunkServing) {
          await page.waitForFunction(() => document.querySelector('video').currentTime > 0.2);
          await page.waitForTimeout(3500);
          assert.equal(await page.evaluate(() => document.querySelector('video').error?.code || 0), 0);
        }
        const output = process.env.QA_OUTPUT_DIR || '/private/tmp/venueos-cache-budget-qa';
        fs.mkdirSync(output, { recursive: true });
        await page.screenshot({ path: path.join(output, `${name}.png`) });
        console.log(`${name}: verified chunk budget, offline SHA-256${forceChunkServing ? ', direct decoded playback' : ' (CacheStorage integrity only; media playback unverified)'} PASS`);
      } finally { await browser.close(); }
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
