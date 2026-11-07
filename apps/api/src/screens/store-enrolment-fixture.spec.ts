import { createHash } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { buildNativeVideoDescriptor } from './native-video';

// Android consumes the actual API producer's output. Regenerate explicitly:
// UPDATE_STORE_ENROLMENT_FIXTURE=1 pnpm exec jest --runInBand --runTestsByPath src/screens/store-enrolment-fixture.spec.ts
it('keeps the native-store enrolment fixture identical to the API producer', () => {
  const screenId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const assetId = '44444444-4444-4444-8444-444444444444';
  const bytes = Buffer.alloc(128 * 1024, 7);
  const hash = createHash('sha256').update(bytes).digest('hex');
  const url = 'https://storage.test/storage/v1/object/public/assets/enrolment.mp4';
  const item = { asset_id: assetId, url, asset_hash: hash, asset_size: bytes.length, mime_type: 'video/mp4', muted: true };
  const manifest = {
    screenId, tenantId, isEmergency: false, sync: { enabled: false }, orientation: 'LANDSCAPE',
    playlists: [{ id: 'playlist', schedule: { mode: 'replace' }, items: [item] }],
  };
  const nativeVideo = buildNativeVideoDescriptor({
    screen: { id: screenId, tenantId, status: 'ONLINE' }, manifest,
    asset: { id: assetId, fileUrl: url, fileHash: hash, fileSize: bytes.length,
      processingMeta: { probe: { codec: 'h264', rotation: 0, pixFmt: 'yuv420p', fps: 30, codedWidth: 1920, codedHeight: 1080 } } },
    env: { SUPABASE_URL: 'https://storage.test', PLAYER_NATIVE_FIRST: screenId, PLAYER_CONTENT_STORE: screenId },
  });
  expect(nativeVideo).toMatchObject({ screenId, faceIndex: 0, nativeFirst: true, store: true });
  const output = { ...manifest, nativeVideo };
  const file = resolve(__dirname, '../../../player/app/src/test/resources/__fixtures__/store-enrolment-manifest.json');
  if (process.env.UPDATE_STORE_ENROLMENT_FIXTURE === '1') {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(output, null, 2) + '\n');
  }
  expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(output);
});
