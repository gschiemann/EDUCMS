/**
 * Wave A BONUS regression spec (2026-07-02) — canvas-level file drop.
 *
 * Pre-fix, native file drop was accepted ONLY on IMAGE/LOGO/
 * STAFF_SPOTLIGHT/IMAGE_CAROUSEL zones; a drop that missed them hit the
 * browser default — the tab NAVIGATED to the file and the builder
 * unmounted mid-edit. Post-fix, BuilderCanvas preventDefaults file
 * dragover/drop window-wide while mounted (except native file inputs)
 * and routes canvas drops through placeDroppedImageFiles(): each image
 * uploads through the same direct-to-storage client the per-zone drop
 * uses (src/lib/direct-upload.ts), then lands as an IMAGE zone centered on
 * the cursor (staggered for multi-file drops).
 *
 * 2026-09-23 — the upload is mocked at the client boundary with the shape the
 * PRODUCER returns (AssetsController.completeUpload: `fileUrl`, never `url`).
 * The old fixture answered `{ url }` — a key the real multipart endpoint
 * never sent — which is exactly how "the zone's URL is undefined" hid behind
 * a green test.
 */
import { placeDroppedImageFiles } from '../BuilderCanvas';
import { useBuilderStore } from '../useBuilderStore';
import { appAlert } from '@/components/ui/app-dialog';

jest.mock('@/components/ui/app-dialog', () => ({
  appAlert: jest.fn().mockResolvedValue(undefined),
  appConfirm: jest.fn().mockResolvedValue(false),
}));

jest.mock('@/hooks/use-api', () => ({
  useTemplate: () => ({ data: null, isLoading: false }),
}));

const uploadAssetDirect = jest.fn();
jest.mock('@/lib/direct-upload', () => ({
  uploadAssetDirect: (...args: unknown[]) => uploadAssetDirect(...args),
}));

/** Cut from AssetsController.completeUpload's return. */
const completed = (fileUrl: string) => ({
  id: 'asset-new',
  fileUrl,
  mimeType: 'image/png',
  fileSize: 1,
  fileHash: null,
  originalName: 'a.png',
  status: 'PUBLISHED',
  altText: null,
  posterUrl: null,
});

function initStore() {
  useBuilderStore.getState().init({
    id: 't1',
    isSystem: false,
    zones: [],
    meta: { name: 'T', description: '', screenWidth: 1920, screenHeight: 1080, bgColor: '', bgGradient: '', bgImage: '' },
    isTouchEnabled: false,
    idleResetMs: 60000,
    scenes: [],
  });
}

const png = (name: string) => new File(['x'], name, { type: 'image/png' });

describe('BONUS — canvas-level file drop places uploaded images at the cursor', () => {
  afterEach(() => {
    jest.clearAllMocks();
    uploadAssetDirect.mockReset();
  });

  it('uploads each file and adds one IMAGE zone per file, centered on the drop point', async () => {
    initStore();
    let call = 0;
    uploadAssetDirect.mockImplementation(async () => completed(`https://cdn.example/asset-${++call}.png`));

    const ids = await placeDroppedImageFiles([png('a.png'), png('b.png')], { x: 50, y: 40 });

    expect(ids.length).toBe(2);
    const zones = useBuilderStore.getState().zones;
    expect(zones.length).toBe(2);
    expect(zones.every((z) => z.widgetType === 'IMAGE')).toBe(true);
    expect((zones[0].defaultConfig as any).assetUrl).toBe('https://cdn.example/asset-1.png');
    expect((zones[1].defaultConfig as any).assetUrl).toBe('https://cdn.example/asset-2.png');

    // addZone centers a 40x30 default zone on the drop point → first
    // file at (50-20, 40-15); the second staggers +3/+3 so a multi-drop
    // doesn't stack invisibly.
    expect(zones[0].x).toBeCloseTo(30, 5);
    expect(zones[0].y).toBeCloseTo(25, 5);
    expect(zones[1].x).toBeCloseTo(33, 5);
    expect(zones[1].y).toBeCloseTo(28, 5);

    // Both went through the direct-upload client, one file each.
    expect(uploadAssetDirect).toHaveBeenCalledTimes(2);
    expect((uploadAssetDirect.mock.calls[0][0] as File).name).toBe('a.png');
  });

  it('a failed upload surfaces the standard dialog and adds no zone', async () => {
    initStore();
    uploadAssetDirect.mockRejectedValue(new Error('Storage upload failed (500).'));
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const ids = await placeDroppedImageFiles([png('broken.png')], { x: 50, y: 40 });

    expect(ids).toEqual([]);
    expect(useBuilderStore.getState().zones.length).toBe(0);
    expect(appAlert).toHaveBeenCalledTimes(1);
    errSpy.mockRestore();
  });

  it('placement still works without a drop point (falls back to addZone default flow)', async () => {
    initStore();
    uploadAssetDirect.mockResolvedValue(completed('https://cdn.example/one.png'));

    const ids = await placeDroppedImageFiles([png('one.png')]);
    expect(ids.length).toBe(1);
    expect(useBuilderStore.getState().zones.length).toBe(1);
  });
});
