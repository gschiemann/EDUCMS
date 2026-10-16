import { committedNativeVideo } from '../nativeMediaCommit';
import type { NativeVideoDescriptor } from '../nativeSharedVideo';

const original: NativeVideoDescriptor = {
  version: 2, screenId: '11111111-1111-1111-1111-111111111111',
  tenantId: '22222222-2222-2222-2222-222222222222', faceIndex: 0, revision: 'original',
  asset: { id: '33333333-3333-3333-3333-333333333333',
    url: 'https://bhdaxzfalaycfopvcopm.supabase.co/storage/v1/object/public/assets/test/original.mp4',
    sha256: 'a'.repeat(64), size: 1000, width: 2160, height: 3338, fps: 30 },
  transform: { orientation: 'PORTRAIT', fit: 'fill' },
};
const replacement: NativeVideoDescriptor = { ...original, revision: 'replacement',
  asset: { ...original.asset, sha256: 'b'.repeat(64), width: 1080, height: 1668,
    url: original.asset.url.replace('original.mp4', '1080.mp4'), size: 500 } };
const items = (d: NativeVideoDescriptor) => [{ asset: { id: d.asset.id,
  fileHash: d.asset.sha256, fileUrl: d.asset.url } }];

it('keeps the old file eligible while a replacement downloads, then accepts only the committed replacement', () => {
  expect(committedNativeVideo(original, items(original), false)).toEqual(original);
  expect(committedNativeVideo(replacement, items(original), false)).toBeNull();
  expect(committedNativeVideo(replacement, items(replacement), false)).toEqual(replacement);
  expect(committedNativeVideo(original, items(replacement), false)).toBeNull();
});

it('never permits native for an emergency, an empty playlist, or unrelated media', () => {
  expect(committedNativeVideo(original, items(original), true)).toBeNull();
  expect(committedNativeVideo(original, [], false)).toBeNull();
  expect(committedNativeVideo(original, [...items(original), ...items(replacement)], false)).toBeNull();
  expect(committedNativeVideo({ ...original, version: 99 }, items(original), false)).toBeNull();
  expect(committedNativeVideo(original, [{ asset: { ...items(original)[0].asset,
    id: '44444444-4444-4444-4444-444444444444' } }], false)).toBeNull();
});
