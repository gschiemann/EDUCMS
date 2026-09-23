/**
 * (c) Nothing leaves the machine.
 *
 * A local HTTP listener and a local UDP listener stand in for "the network":
 * they count every TCP connection (even one that never sends a request, like
 * a preconnect) and every datagram. The attack board then tries every exit it
 * can find. Three runs:
 *
 *   1. CONTROL — a stock headless Chromium with none of our layers loads the
 *      local-only attack. The listener MUST see traffic, or the probe proves
 *      nothing.
 *   2. PRODUCT — the real renderer (all four layers) renders the full attack
 *      board, including the brief's two probes (http://example.com/x.png and
 *      fetch('http://169.254.169.254/')). The listeners must see NOTHING, and
 *      both probes must be reported as blocked.
 *   3. LAYER 3 ALONE — Chromium with only our launch flags, no interception
 *      and no CSP header, loads the local-only attack. Still nothing: the
 *      flags are a real backstop, not decoration.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer, { type Browser } from 'puppeteer-core';
import { chromiumArgs } from '../../src/browser.js';
import { chromiumForTests, fixturePath } from '../helpers/env.js';
import { startListeners, type Listeners } from '../helpers/listeners.js';
import { postRender, startTestServer, type TestServer } from '../helpers/server.js';

const { chromium, skip } = chromiumForTests();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function attackHtml(l: Listeners, { localOnly }: { localOnly: boolean }): string {
  let html = fs.readFileSync(fixturePath('network-attack.html'), 'utf8');
  if (localOnly) {
    // Never aim a browser WITHOUT the lockdown at the real internet or the
    // cloud-metadata address: the control run only ever talks to loopback.
    html = html
      .split('\n')
      .filter((line) => !line.includes('example.com') && !line.includes('169.254.169.254'))
      .join('\n');
  }
  return html.split('__PORT__').join(String(l.port)).split('__UDP__').join(String(l.udpPort));
}

async function loadDirect(args: string[], html: string): Promise<void> {
  let browser: Browser | null = null;
  try {
    browser = await puppeteer.launch({ executablePath: chromium as string, headless: true, pipe: true, args });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load', timeout: 15_000 }).catch(() => undefined);
    await sleep(2500);
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

let server: TestServer | null = null;
before(async () => {
  if (chromium) server = await startTestServer({ executablePath: chromium });
});
after(async () => {
  await server?.close();
});

test('CONTROL: without the lockdown, the same page reaches the listener (so the probe is real)', { skip }, async () => {
  const l = await startListeners();
  try {
    await loadDirect(['--no-sandbox'], attackHtml(l, { localOnly: true }));
    assert.ok(l.connections.length > 0, 'a stock Chromium should have connected to the listener');
    assert.ok(l.requests.length > 0, `requests seen: ${l.requests.join(', ')}`);
    // …and WebRTC's STUN datagrams, so "0 datagrams" below means something.
    assert.ok(l.udpPackets > 0, 'a stock Chromium should have sent STUN to the UDP listener');
  } finally {
    await l.close();
  }
});

test('PRODUCT: the renderer lets NOTHING out — no TCP connection, no request, no datagram', { skip }, async () => {
  const l = await startListeners();
  try {
    const res = await postRender(server!.url, { html: attackHtml(l, { localOnly: false }), canvasWidth: 1920, canvasHeight: 1080, viewportScale: 1, settleMs: 2000 });
    await sleep(1000); // anything late still has to land on the listener to count
    assert.equal(res.status, 200, JSON.stringify(res.json).slice(0, 300));
    assert.deepEqual(l.connections, [], 'TCP connections reached the listener');
    assert.deepEqual(l.requests, [], 'HTTP requests reached the listener');
    assert.equal(l.udpPackets, 0, 'UDP datagrams reached the listener');

    const m = res.json.metrics;
    const blocked: Array<{ url: string; reason: string; type: string }> = m.blockedRequests;
    const has = (pred: (b: { url: string; reason: string; type: string }) => boolean) => blocked.some(pred);
    // Chromium auto-upgrades a mixed-content image on an https document, so
    // the attempt arrives as https:// — either way it was stopped here.
    assert.ok(has((b) => /^https?:\/\/example\.com\/x\.png$/.test(b.url) && b.reason === 'network'), 'example.com image not reported');
    assert.ok(has((b) => b.url.startsWith('http://169.254.169.254/') && b.reason === 'csp' && b.type === 'connect-src'), 'metadata fetch not reported');
    assert.ok(has((b) => b.url.startsWith('http://169.254.169.254/latest/meta-data/iam.png') && b.reason === 'network'), 'metadata image not reported');
    assert.ok(has((b) => b.reason === 'navigation'), 'the self-navigation / form post was not reported');
    assert.ok(has((b) => b.url.includes(`127.0.0.1:${l.port}/ws`) && b.reason === 'csp'), 'the WebSocket was not reported');
    assert.ok(m.blockedRequestCount >= 15, `only ${m.blockedRequestCount} exits reported`);
    // The board itself still rendered and was measured.
    assert.ok(m.text.elements >= 1);
    assert.equal(res.json.imageWidth, 1920);
  } finally {
    await l.close();
  }
});

test('LAYER 3 ALONE: the launch flags stop the same traffic with no interception and no CSP', { skip }, async () => {
  const l = await startListeners();
  try {
    await loadDirect(chromiumArgs(), attackHtml(l, { localOnly: true }));
    await sleep(500);
    assert.deepEqual(l.connections, [], 'TCP connections reached the listener');
    assert.deepEqual(l.requests, [], 'HTTP requests reached the listener');
    assert.equal(l.udpPackets, 0, 'UDP datagrams reached the listener');
  } finally {
    await l.close();
  }
});
