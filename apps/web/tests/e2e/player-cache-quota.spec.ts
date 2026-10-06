import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { bootMockPlayer, ok, playerIds, playerManifest } from './helpers/mock-player';

test.use({ serviceWorkers: 'block' });

test.describe('Chromium service-worker quota regression', () => {
test.use({ serviceWorkers: 'allow' });
test('a verified video plays and loops offline when a second cached copy exceeds quota', async ({ page, context, browserName }, info) => {
  test.skip(browserName !== 'chromium', 'Playwright routes service-worker-owned network requests only in Chromium.');
  test.setTimeout(120_000);
  const clip = readFileSync(path.join(__dirname, 'fixtures/loop-clip.mp4'));
  const padding = Buffer.alloc(9 * 1024 * 1024 - clip.length);
  padding.writeUInt32BE(padding.length); padding.write('free', 4);
  const file = Buffer.concat([clip, padding]); // Valid MP4 with a trailing free atom.
  const sha256 = createHash('sha256').update(file).digest('hex');
  let networkReads = 0, downloaded = false;
  await context.route('**/_quota-test/seed', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Cache test</title>' }));
  await context.route('**/_quota-test/video.mp4', r => {
    networkReads += 1;
    if (downloaded) return r.abort();
    const range = /^bytes=(\d+)-(\d*)$/.exec(r.request().headers().range || '');
    const start = range ? Number(range[1]) : 0;
    const end = range && range[2] ? Math.min(Number(range[2]), file.length - 1) : file.length - 1;
    return r.fulfill({ status: range ? 206 : 200, contentType: 'video/mp4',
      headers: { 'Content-Length': String(end - start + 1), ...(range ? { 'Content-Range': `bytes ${start}-${end}/${file.length}` } : {}) },
      body: file.subarray(start, end + 1) });
  });
  const worker = readFileSync(path.join(__dirname, '../../public/sw-player.js'), 'utf8');
  await context.route('**/sw-player.js', r => r.fulfill({ contentType: 'text/javascript', body: worker + `
    const realPut = Cache.prototype.put;
    Cache.prototype.put = function(request, response) {
      const url = new URL(typeof request === 'string' ? request : request.url, self.location.origin);
      if (url.pathname === '/_quota-test/video.mp4') return Promise.reject(new DOMException('Quota exceeded.', 'QuotaExceededError'));
      return realPut.call(this, request, response);
    };` }));
  await page.goto('/_quota-test/seed');
  const url = new URL('/_quota-test/video.mp4', page.url()).href;
  const assembled = await page.evaluate(async ({ url, sha256, size }) => {
    const reg = await navigator.serviceWorker.register('/sw-player.js', { scope: '/player' });
    if (!reg.active) await new Promise<void>(resolve => {
      const sw = reg.installing || reg.waiting!;
      sw.addEventListener('statechange', () => { if (sw.state === 'activated') resolve(); });
    });
    const ask = (message: Record<string, unknown>) => new Promise<Record<string, unknown>>(resolve => {
      const channel = new MessageChannel();
      channel.port1.onmessage = e => { if (!e.data?.started) { channel.port1.close(); resolve(e.data); } };
      reg.active!.postMessage(message, [channel.port2]);
    });
    const asset = { url, sha256, size };
    let offset = 0;
    while (offset < size) {
      const chunk = await ask({ type: 'PRECACHE_CHUNK', ...asset, offset, chunkBytes: 8 * 1024 * 1024 });
      if (!chunk.ok) throw new Error(JSON.stringify(chunk));
      offset = Number(chunk.nextOffset);
    }
    const verified = await ask({ type: 'PRECACHE_VERIFY', ...asset });
    if (!verified.ok) throw new Error(JSON.stringify(verified));
    return ask({ type: 'PRECACHE_ASSEMBLE', ...asset });
  }, { url, sha256, size: file.length });
  expect(assembled).toMatchObject({ ok: true, storage: 'verified-chunks' });
  const readsAfterDownload = networkReads;
  downloaded = true;
  const manifest = playerManifest(playerIds('quota').screenId, 'video', { loopMode: 'native' }, 1, true);
  Object.assign(manifest.playlists[0].items[0], { url, asset_hash: sha256, asset_size: file.length });
  await bootMockPlayer(page, { tag: 'quota', kind: 'video', videoMp4: true, manifest });
  await expect.poll(() => page.evaluate(() => document.querySelector('video')?.getVideoPlaybackQuality().totalVideoFrames || 0), { timeout: 60_000 }).toBeGreaterThan(5);
  const before = await page.evaluate(() => document.querySelector('video')!.getVideoPlaybackQuality().totalVideoFrames);
  await context.setOffline(true);
  await page.waitForTimeout(7_000);
  const after = await page.evaluate(() => document.querySelector('video')!.getVideoPlaybackQuality().totalVideoFrames);
  expect(after - before).toBeGreaterThan(60);
  const range = await page.evaluate(async url => {
    const boundary = 8 * 1024 * 1024;
    const res = await fetch(url, { headers: { Range: `bytes=${boundary - 16}-${boundary + 15}` } });
    return { status: res.status, bytes: Array.from(new Uint8Array(await res.arrayBuffer())) };
  }, url);
  expect(range).toEqual({ status: 206, bytes: Array(32).fill(0) });
  expect(networkReads).toBe(readsAfterDownload);
  await page.screenshot({ path: info.outputPath('quota-cache-playback.png') });
});
});

test('reloading an already-current player does not replay an old APK request or show updating', async ({ page }) => {
  let reports = 0;
  const updateMessages: string[] = [];
  page.on('console', m => { if (m.text().includes('[OTA poll]')) updateMessages.push(m.text()); });
  const tag = 'ota-completed';
  const response = { ok: true, paired: true, ...playerIds(tag), name: 'Test Screen',
    forceUpdatePending: true, forceUpdatePendingAt: '2026-01-01T00:00:00Z',
    ota: { state: 'UP_TO_DATE', at: '2026-01-01T01:00:00Z', message: 'Already current' } };
  await bootMockPlayer(page, { tag, kind: 'images', extraRoutes: async p => {
    await p.route(`**/api/v1/screens/${playerIds(tag).screenId}/telemetry`, r => { reports += 1; return ok(r, response); });
    await p.route(/\/api\/v1\/screens\/status\//, r => ok(r, response));
  } });
  await expect.poll(() => reports).toBeGreaterThan(0);
  await page.waitForTimeout(500);
  expect(updateMessages).toEqual([]);
  await expect(page.getByText('Update in progress', { exact: true })).toHaveCount(0);
  await page.reload();
  await expect.poll(() => reports).toBeGreaterThan(1);
  await page.waitForTimeout(500);
  expect(updateMessages).toEqual([]);
  await expect(page.getByText('Update in progress', { exact: true })).toHaveCount(0);
});
