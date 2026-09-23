/**
 * (d) The HTTP surface: limits, the queue, the wall clock, the memory
 * watchdog — each against a real server and (where it matters) a real
 * Chromium, and each followed by proof the service recovered.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { chromiumForTests } from '../helpers/env.js';
import { postRender, startTestServer } from '../helpers/server.js';

const { chromium, skip } = chromiumForTests();
const SMALL = '<!doctype html><html><body style="margin:0;background:#123"><h1 style="color:#fff;font:700 80px sans-serif">Hello</h1></body></html>';
const small = (over: Record<string, unknown> = {}) => ({ html: SMALL, canvasWidth: 1280, canvasHeight: 720, viewportScale: 1, settleMs: 100, ...over });

function rawPost(url: string, headers: Record<string, string>, body: string | null, opts: { chunkedBytes?: number } = {}) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    // A client that never gets an answer is a failure, not a hang.
    const timer = setTimeout(() => reject(new Error('no response within 15 s')), 15_000);
    const req = http.request(`${url}/render`, { method: 'POST', headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        clearTimeout(timer);
        resolve({ status: res.statusCode ?? 0, body: data });
      });
    });
    req.on('error', (e) => {
      // The server may hang up on an oversized upload after answering it.
      if ((e as NodeJS.ErrnoException).code === 'EPIPE' || (e as NodeJS.ErrnoException).code === 'ECONNRESET') return;
      reject(e);
    });
    if (opts.chunkedBytes) {
      const chunk = 'x'.repeat(64 * 1024);
      let sent = 0;
      const pump = () => {
        while (sent < (opts.chunkedBytes as number)) {
          sent += chunk.length;
          if (!req.write(chunk)) {
            req.once('drain', pump);
            return;
          }
        }
        req.end();
      };
      pump();
    } else {
      req.end(body ?? undefined);
    }
  });
}

test('health, routing, media type, JSON and validation errors — no browser needed to refuse', async () => {
  const s = await startTestServer({ executablePath: chromium });
  try {
    const bad = await fetch(`${s.url}/nope`);
    assert.equal(bad.status, 404);
    assert.equal((await bad.json()).error, 'not_found');
    const get = await fetch(`${s.url}/render`);
    assert.equal(get.status, 405);
    assert.equal(get.headers.get('allow'), 'POST');
    const text = await rawPost(s.url, { 'content-type': 'text/plain' }, 'hi');
    assert.equal(text.status, 415);
    const notJson = await rawPost(s.url, { 'content-type': 'application/json' }, '{nope');
    assert.equal(notJson.status, 400);
    assert.equal(JSON.parse(notJson.body).error, 'invalid_json');
    const invalid = await postRender(s.url, { html: SMALL, canvasWidth: 10, canvasHeight: 10 });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.json.error, 'invalid_request');
    assert.equal(invalid.json.contractVersion, 1);
  } finally {
    await s.close();
  }
});

test('413: a declared oversize body is refused unread; a streamed one is cut off at the cap', async () => {
  const s = await startTestServer({ executablePath: chromium });
  try {
    const declared = await rawPost(
      s.url,
      { 'content-type': 'application/json', 'content-length': String(5 * 1024 * 1024) },
      null,
    );
    assert.equal(declared.status, 413);
    assert.equal(JSON.parse(declared.body).error, 'payload_too_large');
    const streamed = await rawPost(s.url, { 'content-type': 'application/json', 'transfer-encoding': 'chunked' }, null, {
      chunkedBytes: 6 * 1024 * 1024,
    });
    assert.equal(streamed.status, 413);
    // …and the service is still answering afterwards.
    assert.equal((await fetch(`${s.url}/nope`)).status, 404);
  } finally {
    await s.close();
  }
});

test('/health reports the Chromium version once the browser is up', { skip }, async () => {
  const s = await startTestServer({ executablePath: chromium });
  try {
    await s.browsers.acquire();
    const res = await fetch(`${s.url}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
    assert.match(body.chromium, /Chrom/);
    assert.deepEqual(body.queue, { active: 0, waiting: 0, max: 4 });
    assert.equal((await fetch(`${s.url}/health`, { method: 'HEAD' })).status, 200);
  } finally {
    await s.close();
  }
});

test('/health is 503 when Chromium cannot start, and a render says browser_unavailable', async () => {
  const s = await startTestServer({ executablePath: '/nonexistent/chromium' });
  try {
    const r = await postRender(s.url, small());
    assert.equal(r.status, 503);
    assert.equal(r.json.error, 'browser_unavailable');
    const h = await fetch(`${s.url}/health`);
    assert.equal(h.status, 503);
    assert.equal((await h.json()).status, 'error');
  } finally {
    await s.close();
  }
});

test('429: one render running, the line full — the next caller is told to come back', { skip }, async () => {
  const s = await startTestServer({ executablePath: chromium, config: { queueMax: 1 } });
  try {
    await s.browsers.acquire();
    const a = postRender(s.url, small({ settleMs: 2000 }));
    await new Promise((r) => setTimeout(r, 300));
    const b = postRender(s.url, small({ settleMs: 200 }));
    await new Promise((r) => setTimeout(r, 200));
    assert.deepEqual(s.renderer.gate.stats(), { active: 1, waiting: 1, max: 1 });
    const c = await postRender(s.url, small());
    assert.equal(c.status, 429);
    assert.equal(c.json.error, 'queue_full');
    assert.equal(c.headers.get('retry-after'), '5');
    const [ra, rb] = await Promise.all([a, b]);
    assert.equal(ra.status, 200);
    assert.equal(rb.status, 200);
    assert.ok(rb.json.timings.queueMs > 500, `B waited ${rb.json.timings.queueMs} ms behind A`);
    assert.deepEqual(s.renderer.gate.stats(), { active: 0, waiting: 0, max: 1 });
  } finally {
    await s.close();
  }
});

test('504: a page that never finishes loading is killed at the wall clock, and the next render works', { skip }, async () => {
  const s = await startTestServer({ executablePath: chromium, config: { renderTimeoutMs: 3000 } });
  try {
    await s.browsers.acquire();
    const t0 = Date.now();
    const hung = await postRender(s.url, small({ html: '<!doctype html><html><body><h1>hang</h1><script>for(;;){}</script></body></html>' }));
    const took = Date.now() - t0;
    assert.equal(hung.status, 504);
    assert.equal(hung.json.error, 'render_timeout');
    assert.ok(took < 9000, `timeout answered after ${took} ms`);
    const after = await postRender(s.url, small());
    assert.equal(after.status, 200, JSON.stringify(after.json).slice(0, 200));
    assert.ok(after.json.timings.launchMs > 0, 'a fresh Chromium was launched for the next render');
  } finally {
    await s.close();
  }
});

test('503: the memory watchdog kills Chromium mid-render, and the service recovers', { skip }, async () => {
  let pressure = false;
  const s = await startTestServer({
    executablePath: chromium,
    memoryLimitBytes: 1000,
    readMemory: () => (pressure ? 5000 : 10),
  });
  try {
    await s.browsers.acquire();
    pressure = true;
    const killed = await postRender(s.url, small({ settleMs: 3000 }));
    pressure = false;
    assert.equal(killed.status, 503, JSON.stringify(killed.json));
    assert.equal(killed.json.error, 'memory_limit');
    const ok = await postRender(s.url, small());
    assert.equal(ok.status, 200, JSON.stringify(ok.json).slice(0, 200));
  } finally {
    await s.close();
  }
});

test('Chromium is recycled after N renders without the caller noticing', { skip }, async () => {
  const s = await startTestServer({ executablePath: chromium, config: { recycleAfter: 2 } });
  try {
    const launches: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      const r = await postRender(s.url, small());
      assert.equal(r.status, 200);
      launches.push(r.json.timings.launchMs > 0 ? 1 : 0);
    }
    assert.deepEqual(launches, [1, 0, 1, 0]);
  } finally {
    await s.close();
  }
});
