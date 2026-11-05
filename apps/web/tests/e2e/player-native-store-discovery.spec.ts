import { test, expect } from '@playwright/test';
import { bootMockPlayer, playerManifest } from './helpers/mock-player';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

type TestWindow = {
  __storeCommands: Array<{ version?: number; op?: string; manifestTag?: string }>;
  __storeDocument: string;
  __eduCmsBridgeNonce: string;
  __eduTestRealtime: { deliver(message: unknown): void };
  EduCmsNative: {
    sharedVideoPrepare(...args: string[]): void;
    sharedVideoCommit(): void;
    sharedVideoStop(): void;
    sharedVideoState(): string;
  };
};

const screenId = '11111111-1111-4111-8111-111111111111';
const tenantId = '22222222-2222-4222-8222-222222222222';
const assetId = '44444444-4444-4444-8444-444444444444';
const url = 'https://storage.invalid/needs-native-store.mp4';
const sha256 = 'a'.repeat(64);

for (const patch of [64, 63]) {
  test.describe(`store discovery on APK 1.1.${patch}`, () => {
    test.use({ userAgent: `Mozilla/5.0 (Linux; Android 9; wv) Chrome/87.0 Mobile Safari/537.36 EduCmsPlayer/1.1.${patch}-field.1` });
    test('an image-to-video update can nudge its own source before v4 without a reload or playback command', async ({ page }) => {
      await page.addInitScript(() => {
        const w = window as unknown as TestWindow;
        w.__storeCommands = [];
        w.__storeDocument = 'preserved';
        w.__eduCmsBridgeNonce = 'fake-discovery-nonce';
        w.EduCmsNative = {
          sharedVideoPrepare: (...args: string[]) => { try { w.__storeCommands.push(JSON.parse(args[args.length - 1])); } catch {} },
          sharedVideoCommit: () => {}, sharedVideoStop: () => {},
          sharedVideoState: () => JSON.stringify({ version: 1, protocol: 2, protocolMax: 3, state: 'idle',
            device: { nativeSolo: true, nativeFirst: false, protocol3: true } }),
        };
      });
      const images = { ...playerManifest(screenId, 'images'), tenantId, sync: { enabled: false } };
      images.playlists[0].items.forEach((item, index) => { item.url = `https://storage.invalid/slide-${index}.png`; });
      const video = {
        ...playerManifest(screenId, 'video'), tenantId, sync: { enabled: false },
        nativeVideo: { version: 2, screenId, tenantId, faceIndex: 0, revision: 'discovery-video',
          nativeFirst: true, store: true,
          asset: { id: assetId, url, sha256, size: 50_000_000, width: 1280, height: 720, fps: 29.97 },
          transform: { orientation: 'LANDSCAPE', fit: 'fill' } },
      };
      Object.assign(video.playlists[0].items[0], { asset_id: assetId, url, mime_type: 'video/mp4',
        asset_hash: sha256, asset_size: 50_000_000, muted: true });
      let current: typeof images | typeof video = images;
      await bootMockPlayer(page, {
        tag: `store-discovery-${patch}`, identity: { screenId, fingerprint: `fake-store-${patch}`, deviceToken: 'fake.store.token' },
        kind: 'images', manifest: images, query: '&client=android',
        extraRoutes: async p => {
          await p.route(`**/api/v1/screens/${screenId}/manifest*`, route => route.fulfill({ status: 200,
            contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'ETag', ETag: current === images ? '"images"' : '"video"' },
            body: JSON.stringify(current) }));
          await p.route(url, route => route.fulfill({ status: 503, body: '' }));
          await p.route('https://storage.invalid/slide-*.png', route => route.fulfill({ status: 200, contentType: 'image/png',
            body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') }));
        },
      });
      await expect(page.locator('img[src*="slide-"]:visible').first()).toBeVisible({ timeout: 30_000 });
      await expect.poll(() => page.locator('img[src*="slide-"]:visible').first().evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
      current = video;
      await page.evaluate(() => (window as unknown as TestWindow).__eduTestRealtime.deliver({ type: 'SYNC', eventId: 'store-discovery-video',
        timestamp: Date.now(), payload: {} }));
      const nudges = () => page.evaluate(() => (window as unknown as TestWindow).__storeCommands.filter(m => m.version === 4));
      if (patch === 64) {
        await expect.poll(nudges, { timeout: 20_000 }).toEqual([{ version: 4, op: 'sync', manifestTag: 'video' }]);
      } else {
        await page.waitForTimeout(2000);
        expect(await nudges()).toEqual([]);
      }
      expect(await page.evaluate(() => (window as unknown as TestWindow).__storeDocument)).toBe('preserved');
    });

    if (patch === 64) test('enabling discovery never interrupts an already playing video', async ({ page }) => {
      await page.addInitScript(() => {
        const w = window as unknown as TestWindow;
        w.__storeCommands = [];
        w.__eduCmsBridgeNonce = 'fake-discovery-nonce';
        w.EduCmsNative = {
          sharedVideoPrepare: (...args: string[]) => { try { w.__storeCommands.push(JSON.parse(args[args.length - 1])); } catch {} },
          sharedVideoCommit: () => {}, sharedVideoStop: () => {},
          sharedVideoState: () => JSON.stringify({ version: 1, protocol: 2, protocolMax: 3, state: 'idle',
            device: { nativeSolo: true, nativeFirst: false, protocol3: true } }),
        };
      });
      const clip = fs.readFileSync(path.join(__dirname, 'fixtures', 'loop-clip.mp4'));
      const hash = createHash('sha256').update(clip).digest('hex');
      const mediaUrl = 'https://bhdaxzfalaycfopvcopm.supabase.co/storage/v1/object/public/assets/discovery-fixture.mp4';
      const manifest = {
        ...playerManifest(screenId, 'video', { loopMode: 'native' }, 1, true), tenantId, sync: { enabled: false },
        nativeVideo: { version: 2, screenId, tenantId, faceIndex: 0, revision: 'discovery-playing', nativeFirst: true,
          asset: { id: assetId, url: mediaUrl, sha256: hash, size: clip.length, width: 320, height: 180, fps: 30 },
          transform: { orientation: 'LANDSCAPE', fit: 'fill' } },
      };
      Object.assign(manifest.playlists[0].items[0], { asset_id: assetId, url: mediaUrl, asset_hash: hash, asset_size: clip.length });
      let store = false;
      let manifestRequests = 0;
      await bootMockPlayer(page, {
        tag: 'store-working-video', kind: 'video', videoMp4: true, manifest,
        identity: { screenId, fingerprint: 'fake-store-working', deviceToken: 'fake.store.token' },
        query: '&client=android', videoFixtures: { [mediaUrl]: 'loop-clip.mp4' },
        extraRoutes: async p => {
          await p.route(`**/api/v1/screens/${screenId}/manifest*`, route => {
            manifestRequests++;
            return route.fulfill({ status: 200, contentType: 'application/json',
              headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'ETag', ETag: store ? '"store-on"' : '"store-off"' },
              body: JSON.stringify({ ...manifest, nativeVideo: { ...manifest.nativeVideo, store } }) });
          });
        },
      });
      const playing = () => page.locator('video:visible').first().evaluate((v: HTMLVideoElement) => v.currentTime > 0 && !v.paused);
      await expect.poll(playing, { timeout: 30_000 }).toBe(true);
      const before = manifestRequests;
      store = true;
      await page.evaluate(() => (window as unknown as TestWindow).__eduTestRealtime.deliver({ type: 'SYNC', eventId: 'store-enable-while-playing',
        timestamp: Date.now(), payload: {} }));
      await expect.poll(() => manifestRequests).toBeGreaterThan(before);
      await page.waitForTimeout(1000);
      expect(await page.evaluate(() => (window as unknown as TestWindow).__storeCommands.filter(m => m.version === 4))).toEqual([]);
      await expect.poll(playing).toBe(true);
    });
  });
}
