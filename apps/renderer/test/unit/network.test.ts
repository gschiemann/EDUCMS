import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOARD_CSP, BOARD_URL, DEAD_PROXY, networkLockdownArgs, routeRequest, summariseUrl, type RouteInput } from '../../src/network.js';
import { chromiumArgs } from '../../src/browser.js';
import { testCatalog } from '../helpers/server.js';

const route = (over: Partial<RouteInput>) =>
  routeRequest({ url: BOARD_URL, resourceType: 'image', isNavigation: false, isMainFrame: true, documentServed: true, ...over }, testCatalog());

test('the board document is served exactly once, to the main frame', () => {
  assert.deepEqual(route({ isNavigation: true, documentServed: false, resourceType: 'document' }), { action: 'document' });
  // A reload, a second navigation, a frame, a form post: all cancelled with a 204.
  assert.deepEqual(route({ isNavigation: true, documentServed: true, resourceType: 'document' }), { action: 'cancel-navigation' });
  assert.deepEqual(route({ isNavigation: true, isMainFrame: false, documentServed: false }), { action: 'cancel-navigation' });
  assert.deepEqual(route({ isNavigation: true, url: 'http://169.254.169.254/latest/meta-data/' }), { action: 'cancel-navigation' });
});

test('data: and blob: are the only things allowed through untouched', () => {
  assert.deepEqual(route({ url: 'data:image/png;base64,AAAA' }), { action: 'allow' });
  assert.deepEqual(route({ url: 'DATA:image/png;base64,AAAA' }), { action: 'allow' });
  assert.deepEqual(route({ url: 'blob:https://board.vosr.invalid/1234' }), { action: 'allow' });
});

test('Google Fonts CSS is answered locally; font files only from the allowlist', () => {
  assert.equal(route({ url: 'https://fonts.googleapis.com/css2?family=Inter' }).action, 'google-css');
  assert.deepEqual(route({ url: 'https://fonts.googleapis.com/icon?family=Material+Icons' }), { action: 'block', reason: 'font' });
  const ok = route({ url: 'https://fonts.gstatic.com/s/vosr/v/inter/inter-latin-wght-normal.woff2?v=1', resourceType: 'font' });
  assert.equal(ok.action, 'font-file');
  assert.deepEqual(route({ url: 'https://fonts.gstatic.com/s/inter/v13/abc.woff2', resourceType: 'font' }), { action: 'block', reason: 'font' });
  // The real Google hosts over http are not ours either.
  assert.deepEqual(route({ url: 'http://fonts.googleapis.com/css2?family=Inter' }), { action: 'block', reason: 'network' });
});

test('everything else is blocked: metadata, loopback, private ranges, other schemes, the board origin itself', () => {
  for (const url of [
    'http://169.254.169.254/',
    'http://127.0.0.1:8080/render',
    'http://localhost:9/',
    'http://[::1]/',
    'http://10.0.0.5/x.png',
    'https://example.com/x.png',
    'https://board.vosr.invalid/templates/logo.png',
    'file:///etc/passwd',
    'ftp://example.com/x',
    'chrome://settings',
    'ws://127.0.0.1:1234/',
    'not a url',
  ]) {
    assert.equal(route({ url }).action, 'block', url);
  }
});

test('Chromium is launched with no resolvable host, a dead proxy with no loopback bypass, and no UDP WebRTC', () => {
  const args = chromiumArgs();
  assert.ok(args.includes('--host-resolver-rules=MAP * ~NOTFOUND'));
  assert.ok(args.includes(`--proxy-server=${DEAD_PROXY}`));
  assert.ok(args.includes('--proxy-bypass-list=<-loopback>'));
  // The spelling matters: `--force-webrtc-ip-handling-policy` is ignored by
  // Chromium (measured — STUN datagrams still left). This one works.
  assert.ok(args.includes('--webrtc-ip-handling-policy=disable_non_proxied_udp'));
  assert.ok(!args.some((a) => a.startsWith('--force-webrtc')));
  assert.deepEqual(networkLockdownArgs().filter((a) => !args.includes(a)), []);
  assert.ok(!args.some((a) => a.startsWith('--remote-debugging-port')), 'no DevTools port');
  assert.ok(!args.includes('--disable-popup-blocking'));
});

test('the board CSP header closes every non-rendering channel', () => {
  for (const d of ["connect-src 'none'", "worker-src 'none'", "manifest-src 'none'", "object-src 'none'", "form-action 'none'"]) {
    assert.ok(BOARD_CSP.includes(d), d);
  }
});

test('blocked URLs are summarised: data: bodies are never echoed, control characters are stripped', () => {
  const big = `data:image/png;base64,${'A'.repeat(50_000)}`;
  const s = summariseUrl(big);
  assert.ok(s.startsWith('data:image/png;base64,…'));
  assert.ok(s.length < 80);
  assert.equal(summariseUrl('https://x.test/a\nb'), 'https://x.test/a b');
  assert.ok(summariseUrl(`https://x.test/${'y'.repeat(500)}`).length <= 201);
});
