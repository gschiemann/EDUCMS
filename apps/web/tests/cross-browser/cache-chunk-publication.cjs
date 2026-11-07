/* Real Cache.put atomicity, malformed network streams and commit-before-info recovery. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createHash } = require('node:crypto');
const { chromium, webkit } = require('@playwright/test');
const MiB = 1024 * 1024;
const file = Buffer.alloc(MiB, 73);
const sha256 = createHash('sha256').update(file).digest('hex');
const worker = fs.readFileSync(path.join(__dirname, '../../public/sw-player.js'), 'utf8');
const recovered = new Set();

async function main() {
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/sw-player.js')) {
      const fault = req.url.includes('failInfo=1') ? `
        const realOpen = caches.open.bind(caches);
        caches.open = async name => {
          const cache = await realOpen(name); const put = cache.put.bind(cache);
          cache.put = (key, value) => {
            if (String(key.url || key).includes('/__edu_stage_info__/')) throw new Error('worker stopped before info');
            return put(key, value);
          }; return cache;
        };` : '';
      res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store', 'Service-Worker-Allowed': '/' });
      return res.end(worker + fault);
    }
    if (req.url.startsWith('/media/')) {
      const mode = recovered.has(req.url) ? 'good' : req.url.split('/')[2].split('-')[0];
      res.writeHead(206, { 'Content-Type': 'video/mp4', 'Content-Range': `bytes 0-${file.length - 1}/${file.length}`,
        'Content-Length': mode === 'short' ? file.length - 1 : mode === 'long' ? file.length + 1 : file.length });
      if (mode === 'error') {
        res.flushHeaders(); res.write(file.subarray(0, file.length / 2));
        return setTimeout(() => res.destroy(), 20);
      }
      res.write(mode === 'short' ? file.subarray(0, file.length - 1) : file);
      return res.end(mode === 'long' ? Buffer.from([1]) : undefined);
    }
    res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><body>Local cache verification</body>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const [name, type] of [['chromium', chromium], ['webkit', webkit]]) {
      const browser = await type.launch();
      try {
        const page = await browser.newPage(); await page.goto(base + '/player/test');
        const register = async suffix => page.evaluate(async suffix => {
          const reg = await navigator.serviceWorker.register('/sw-player.js?' + suffix, { scope: '/' });
          const sw = reg.installing || reg.waiting || reg.active;
          if (sw.state !== 'activated') await new Promise(resolve => sw.addEventListener('statechange', () => { if (sw.state === 'activated') resolve(); }));
          window.ask = message => new Promise((resolve, reject) => {
            const channel = new MessageChannel(); const timer = setTimeout(() => reject(new Error('worker timeout')), 15000);
            channel.port1.onmessage = e => { if (!e.data.started && !e.data.progress) { clearTimeout(timer); channel.port1.close(); resolve(e.data); } };
            sw.postMessage(message, [channel.port2]);
          });
        }, suffix);
        await register('normal=1');
        for (const digest of [null, sha256]) for (const fault of ['short', 'long', 'error']) {
          const mediaPath = `/media/${fault}-${name}-${digest ? 'hash' : 'nohash'}.mp4`;
          const asset = { url: base + mediaPath, size: file.length, sha256: digest };
          const result = await page.evaluate(asset => window.ask({ type: 'PRECACHE_CHUNK', ...asset, offset: 0, chunkBytes: 1024 * 1024 }), asset);
          assert.equal(result.ok, false);
          const verify = await page.evaluate(asset => window.ask({ type: 'PRECACHE_VERIFY', ...asset }), asset);
          assert.equal(verify.ok, false);
          const keys = await page.evaluate(async () => {
            const name = (await caches.keys()).find(k => k.startsWith('edu-player-staging-'));
            return (await (await caches.open(name)).keys()).map(k => k.url);
          });
          assert.equal(keys.some(k => k.includes(encodeURIComponent(asset.url)) && /\/0-\d+$/.test(k)), false);
          recovered.add(mediaPath);
          assert.equal((await page.evaluate(asset => window.ask({ type: 'PRECACHE_CHUNK', ...asset, offset: 0, chunkBytes: 1024 * 1024 }), asset)).ok, true);
          assert.equal((await page.evaluate(asset => window.ask({ type: 'PRECACHE_VERIFY', ...asset }), asset)).ok, true);
        }
        const asset = { url: base + `/media/good-${name}-restart.mp4`, size: file.length, sha256 };
        await register('failInfo=1');
        assert.equal((await page.evaluate(asset => window.ask({ type: 'PRECACHE_CHUNK', ...asset, offset: 0, chunkBytes: 1024 * 1024 }), asset)).ok, false);
        await register('fresh=1'); // A new worker instance; committed bytes remain in CacheStorage.
        const resumed = await page.evaluate(asset => window.ask({ type: 'PRECACHE_CHUNK', ...asset, offset: 0, chunkBytes: 1024 * 1024 }), asset);
        assert.equal(resumed.staged, true);
        assert.equal((await page.evaluate(asset => window.ask({ type: 'PRECACHE_VERIFY', ...asset }), asset)).ok, true);
        assert.equal((await page.evaluate(asset => window.ask({ type: 'PRECACHE_ASSEMBLE', ...asset }), asset)).ok, true);
        const hash = await page.evaluate(async url => {
          const name = (await caches.keys()).find(k => k.startsWith('edu-player-playlist-'));
          const response = await (await caches.open(name)).match(url);
          return [...new Uint8Array(await crypto.subtle.digest('SHA-256', await response.arrayBuffer()))].map(n => n.toString(16).padStart(2, '0')).join('');
        }, asset.url);
        assert.equal(hash, sha256);
        console.log(`${name}: real short/long/error publication and new-worker metadata recovery PASS`);
      } finally { await browser.close(); }
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
