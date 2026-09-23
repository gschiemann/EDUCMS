import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRenderRequest } from '../../src/validate.js';
import { RenderGate } from '../../src/queue.js';
import { loadConfig } from '../../src/config.js';
import { RENDER_DEFAULTS, RENDER_ERROR_STATUS, RENDER_LIMITS } from '../../src/contract.js';

const HTML = '<!doctype html><html><body>hi</body></html>';

test('a minimal request gets the documented defaults', () => {
  const v = validateRenderRequest({ html: HTML, canvasWidth: 3840, canvasHeight: 2160 });
  assert.ok(v.ok);
  assert.equal(v.value.viewportScale, RENDER_DEFAULTS.viewportScale);
  assert.equal(v.value.settleMs, RENDER_DEFAULTS.settleMs);
  assert.equal(v.value.fullWidth, RENDER_DEFAULTS.fullWidth);
});

test('bad requests are refused with a reason, before any browser work', () => {
  const bad: unknown[] = [
    null,
    [],
    'html',
    { html: '', canvasWidth: 3840, canvasHeight: 2160 },
    { html: 'just words', canvasWidth: 3840, canvasHeight: 2160 },
    { html: HTML, canvasWidth: 3840.5, canvasHeight: 2160 },
    { html: HTML, canvasWidth: 20, canvasHeight: 2160 },
    { html: HTML, canvasWidth: 3840, canvasHeight: 99999 },
    { html: HTML, canvasWidth: 3840, canvasHeight: 2160, viewportScale: 0 },
    { html: HTML, canvasWidth: 3840, canvasHeight: 2160, viewportScale: 1.5 },
    { html: HTML, canvasWidth: 3840, canvasHeight: 2160, viewportScale: '0.5' },
    { html: HTML, canvasWidth: 3840, canvasHeight: 2160, settleMs: -1 },
    { html: HTML, canvasWidth: 3840, canvasHeight: 2160, settleMs: 60_000 },
    { html: HTML, canvasWidth: 3840, canvasHeight: 2160, fullWidth: 10_000 },
    // 8K at scale 1 is more than a 4K frame of pixels.
    { html: HTML, canvasWidth: 7680, canvasHeight: 4320, viewportScale: 1 },
  ];
  for (const body of bad) {
    const v = validateRenderRequest(body);
    assert.equal(v.ok, false, JSON.stringify(body)?.slice(0, 80));
    if (!v.ok) assert.ok(v.message.length > 0);
  }
  assert.equal(validateRenderRequest({ html: 'x'.repeat(10) + HTML, canvasWidth: 64, canvasHeight: 64 }, 20).ok, false);
});

test('portrait and 1080p canvases are fine', () => {
  assert.ok(validateRenderRequest({ html: HTML, canvasWidth: 2160, canvasHeight: 3840 }).ok);
  assert.ok(validateRenderRequest({ html: HTML, canvasWidth: 1920, canvasHeight: 1080, viewportScale: 1 }).ok);
});

test('every error code maps to its documented status', () => {
  assert.equal(RENDER_ERROR_STATUS.payload_too_large, 413);
  assert.equal(RENDER_ERROR_STATUS.queue_full, 429);
  assert.equal(RENDER_ERROR_STATUS.render_timeout, 504);
  assert.equal(RENDER_ERROR_STATUS.unsupported_media_type, 415);
  assert.equal(RENDER_LIMITS.maxBodyBytes, 4 * 1024 * 1024);
});

test('the gate runs one at a time, queues up to its limit, then says no', async () => {
  const gate = new RenderGate(2);
  const a = gate.enter();
  const b = gate.enter();
  const c = gate.enter();
  const d = gate.enter();
  assert.ok(a && b && c);
  assert.equal(d, null, 'line full');
  assert.deepEqual(gate.stats(), { active: 1, waiting: 2, max: 2 });
  const order: string[] = [];
  void b.ready.then(() => order.push('b'));
  void c.ready.then(() => order.push('c'));
  await a.ready;
  a.release();
  await b.ready;
  assert.deepEqual(order, ['b']);
  b.release();
  await c.ready;
  assert.deepEqual(order, ['b', 'c']);
  c.release();
  assert.deepEqual(gate.stats(), { active: 0, waiting: 0, max: 2 });
});

test('a caller that leaves the line frees its place; double release is harmless', async () => {
  const gate = new RenderGate(3);
  const a = gate.enter()!;
  const b = gate.enter()!;
  const c = gate.enter()!;
  assert.equal(b.waiting, true);
  b.release(); // left before its turn
  assert.deepEqual(gate.stats(), { active: 1, waiting: 1, max: 3 });
  a.release();
  a.release();
  await c.ready;
  assert.equal(c.waiting, false);
  assert.deepEqual(gate.stats(), { active: 1, waiting: 0, max: 3 });
  c.release();
  assert.equal(gate.stats().active, 0);
});

test('a release racing the grant (client hangs up the same tick) hands the slot on, not leaks it', async () => {
  const gate = new RenderGate(2);
  const a = gate.enter()!;
  const b = gate.enter()!;
  const c = gate.enter()!;
  a.release(); // grants b synchronously…
  b.release(); // …and b leaves before its promise settles
  await c.ready;
  assert.equal(gate.stats().active, 1);
  c.release();
  assert.equal(gate.stats().active, 0);
});

test('queue of 0: busy means 429 immediately', () => {
  const gate = new RenderGate(0);
  assert.ok(gate.enter());
  assert.equal(gate.enter(), null);
});

test('config: defaults, knobs, and a typo never crashes the boot', () => {
  const d = loadConfig({}).config;
  assert.equal(d.port, 8080);
  assert.equal(d.host, '::');
  assert.equal(d.queueMax, 4);
  assert.equal(d.renderTimeoutMs, 30_000);
  assert.equal(d.executablePath, null);
  const { config, warnings } = loadConfig({
    PORT: '9000',
    RENDERER_QUEUE_MAX: 'lots',
    RENDERER_TIMEOUT_MS: '15000',
    RENDERER_MEMORY_LIMIT_MB: '1500',
    PUPPETEER_EXECUTABLE_PATH: '   ',
    CHROME_PATH: '/usr/bin/chromium',
  });
  assert.equal(config.port, 9000);
  assert.equal(config.queueMax, 4, 'typo falls back');
  assert.equal(warnings[0]?.name, 'RENDERER_QUEUE_MAX');
  assert.equal(config.renderTimeoutMs, 15_000);
  assert.equal(config.memoryLimitBytes, 1500 * 1024 * 1024);
  assert.equal(config.executablePath, '/usr/bin/chromium', 'a blank variable is unset, not a path');
});
