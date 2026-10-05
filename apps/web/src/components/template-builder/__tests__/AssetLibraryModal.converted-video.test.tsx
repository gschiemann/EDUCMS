/**
 * The template builder's media picker and a MOV / AVI / … (2026-10-05).
 *
 * A widget keeps the URL this picker hands it BY VALUE. A video the server
 * converts AFTER upload changes URL when its MP4 is swapped in, and the original
 * is kept while anything names it — so a URL taken from the upload response, or
 * from a library tile still stored as QuickTime, would put the `.mov` on every
 * screen for good. Pinned here, on the REAL AssetLibraryModal:
 *   1. a just-uploaded MOV is picked as its converted MP4 (the picker waits);
 *   2. an MP4 is picked at once, as before (no wait);
 *   3. a library tile still stored as QuickTime cannot be picked yet;
 *   4. the picker offers MOV & co. in its chooser, and refuses SVG with the
 *      shared words, before any upload.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';

const MOV_TILE = 'https://x.supabase.co/storage/v1/object/public/assets/t/11111111.mov';
const MP4_TILE = 'https://x.supabase.co/storage/v1/object/public/assets/t/22222222.mp4';
const NEW_MOV = 'https://x.supabase.co/storage/v1/object/public/assets/t/33333333.mov';
const NEW_MP4 = 'https://x.supabase.co/storage/v1/object/public/assets/t/optimized/44444444.mp4';

jest.mock('@/hooks/use-api', () => ({
  usePasskeys: () => ({ data: undefined }),
  useAssets: () => ({
    data: [
      { id: 'a1', fileUrl: 'https://x.supabase.co/storage/v1/object/public/assets/t/11111111.mov', mimeType: 'video/quicktime', originalName: 'IMG_0001.MOV' },
      { id: 'a2', fileUrl: 'https://x.supabase.co/storage/v1/object/public/assets/t/22222222.mp4', mimeType: 'video/mp4', originalName: 'gym.mp4' },
    ],
    isLoading: false,
  }),
  usePlaylists: () => ({ data: [], isLoading: false }),
  useTemplates: () => ({ data: [], isLoading: false }),
  useTemplateBackdrops: () => ({ data: [], isLoading: false }),
}));

jest.mock('@tanstack/react-query', () => {
  const actual = jest.requireActual('@tanstack/react-query');
  return { ...actual, useQueryClient: () => ({ invalidateQueries: jest.fn(async () => undefined) }) };
});

const uploadAssetDirect = jest.fn();
jest.mock('@/lib/direct-upload', () => {
  const actual = jest.requireActual('@/lib/direct-upload');
  return { ...actual, uploadAssetDirect: (...a: unknown[]) => uploadAssetDirect(...a) };
});

const waitForScreenVersion = jest.fn();
jest.mock('@/lib/screen-version', () => {
  const actual = jest.requireActual('@/lib/screen-version');
  return { ...actual, waitForScreenVersion: (...a: unknown[]) => waitForScreenVersion(...a) };
});

import { AssetLibraryModal } from '../PropertiesPanel';

const fileInput = () => document.querySelector('input[type="file"]') as HTMLInputElement;
async function choose(file: File) {
  await act(async () => {
    fireEvent.change(fileInput(), { target: { files: [file] } });
  });
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  uploadAssetDirect.mockReset();
  waitForScreenVersion.mockReset();
});

describe('AssetLibraryModal — videos converted after upload', () => {
  it('a just-uploaded MOV is handed over as its converted MP4 — never the original URL', async () => {
    uploadAssetDirect.mockResolvedValue({ id: 'new-1', fileUrl: NEW_MOV, mimeType: 'video/quicktime' });
    waitForScreenVersion.mockResolvedValue({ fileUrl: NEW_MP4, mimeType: 'video/mp4' });
    const onPick = jest.fn();
    render(<AssetLibraryModal kind="video" onPick={onPick} onClose={jest.fn()} />);
    await choose(new File(['x'], 'IMG_0042.MOV', { type: 'video/quicktime' }));
    expect(uploadAssetDirect).toHaveBeenCalledTimes(1);
    expect(waitForScreenVersion).toHaveBeenCalledWith('new-1', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(onPick).toHaveBeenCalledWith(NEW_MP4);
    expect(onPick).not.toHaveBeenCalledWith(NEW_MOV);
  });

  it('a conversion that fails is said in plain words, and nothing is picked', async () => {
    const { ScreenVersionError } = jest.requireActual('@/lib/screen-version');
    uploadAssetDirect.mockResolvedValue({ id: 'new-2', fileUrl: NEW_MOV, mimeType: 'video/quicktime' });
    waitForScreenVersion.mockRejectedValue(new ScreenVersionError('failed', 'The conversion ended failed.'));
    const onPick = jest.fn();
    render(<AssetLibraryModal kind="video" onPick={onPick} onClose={jest.fn()} />);
    await choose(new File(['x'], 'IMG_0042.MOV', { type: 'video/quicktime' }));
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.getByText("IMG_0042.MOV couldn't be converted to MP4 for screens. Export it as MP4 (H.264) and upload that.")).toBeInTheDocument();
  });

  it('an MP4 is picked at once, as before — no wait', async () => {
    uploadAssetDirect.mockResolvedValue({ id: 'new-3', fileUrl: MP4_TILE, mimeType: 'video/mp4' });
    const onPick = jest.fn();
    render(<AssetLibraryModal kind="video" onPick={onPick} onClose={jest.fn()} />);
    await choose(new File(['x'], 'gym.mp4', { type: 'video/mp4' }));
    expect(waitForScreenVersion).not.toHaveBeenCalled();
    expect(onPick).toHaveBeenCalledWith(MP4_TILE);
  });

  it('a library tile still stored as QuickTime cannot be picked yet; the MP4 tile can', () => {
    const onPick = jest.fn();
    render(<AssetLibraryModal kind="video" onPick={onPick} onClose={jest.fn()} />);
    const tiles = screen.getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') !== null || b.className.includes('aspect-square'));
    const movTile = tiles.find((b) => b.textContent?.includes('Optimizing for screens'));
    expect(movTile).toBeDefined();
    expect(movTile).toBeDisabled();
    fireEvent.click(movTile!);
    expect(onPick).not.toHaveBeenCalledWith(MOV_TILE);
    const mp4Tile = tiles.find((b) => b !== movTile && !b.hasAttribute('disabled'));
    fireEvent.click(mp4Tile!);
    expect(onPick).toHaveBeenCalledWith(MP4_TILE);
  });

  it('the video chooser offers MOV & co. — and no pictures, no SVG', () => {
    render(<AssetLibraryModal kind="video" onPick={jest.fn()} onClose={jest.fn()} />);
    expect(fileInput().accept.split(',')).toEqual(expect.arrayContaining(['.mov', '.avi', '.mkv', '.mts', '.mp4']));
    expect(fileInput().accept).not.toMatch(/image|svg/);
  });

  it('the picture picker takes HEIC and refuses SVG with the shared words', async () => {
    render(<AssetLibraryModal kind="image" onPick={jest.fn()} onClose={jest.fn()} />);
    expect(fileInput().accept.split(',')).toEqual(expect.arrayContaining(['.heic', '.jpg']));
    expect(fileInput().accept).not.toMatch(/svg|avif/);
    await choose(new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' }));
    expect(uploadAssetDirect).not.toHaveBeenCalled();
    expect(screen.getByText(/SVG can't be uploaded as content/)).toBeInTheDocument();
  });
});
