/**
 * The shared "choose content" picker (sports cues, sponsors, spotlights) and a
 * MOV / AVI / … (2026-10-05). Same contract as the template builder's picker:
 * the caller keeps the URL BY VALUE, so a just-uploaded MOV is handed over as its
 * converted MP4, and a library tile still stored as QuickTime cannot be picked.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';

const NEW_MOV = 'https://x.supabase.co/storage/v1/object/public/assets/t/33333333.mov';
const NEW_MP4 = 'https://x.supabase.co/storage/v1/object/public/assets/t/optimized/44444444.mp4';

jest.mock('@/hooks/use-api', () => ({
  useAssets: () => ({
    data: [
      { id: 'a1', fileUrl: 'https://x.supabase.co/storage/v1/object/public/assets/t/11111111.mov', mimeType: 'video/quicktime', originalName: 'IMG_0001.MOV' },
      { id: 'a2', fileUrl: 'https://x.supabase.co/storage/v1/object/public/assets/t/22222222.mp4', mimeType: 'video/mp4', originalName: 'gym.mp4' },
    ],
    isLoading: false,
  }),
  useAssetFolders: () => ({ data: [] }),
}));

jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: jest.fn(async () => undefined) }) }));
jest.mock('@/hooks/use-overlay-lock', () => ({ useOverlayLock: () => {} }));

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

import { AssetPicker } from '../AssetPicker';

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

describe('AssetPicker — videos converted after upload', () => {
  it('a just-uploaded MOV is handed over as its converted MP4', async () => {
    uploadAssetDirect.mockResolvedValue({ id: 'new-1', fileUrl: NEW_MOV, mimeType: 'video/quicktime' });
    waitForScreenVersion.mockResolvedValue({ fileUrl: NEW_MP4, mimeType: 'video/mp4' });
    const onPick = jest.fn();
    render(<AssetPicker kind="video" onPick={onPick} onClose={jest.fn()} />);
    expect(fileInput().accept.split(',')).toEqual(expect.arrayContaining(['.mov', '.mkv', '.mp4']));
    await choose(new File(['x'], 'IMG_0042.MOV', { type: 'video/quicktime' }));
    expect(waitForScreenVersion).toHaveBeenCalledWith('new-1', expect.anything());
    expect(onPick).toHaveBeenCalledWith(NEW_MP4);
    expect(onPick).not.toHaveBeenCalledWith(NEW_MOV);
  });

  it('a library tile still stored as QuickTime is shown as optimizing and cannot be picked', () => {
    const onPick = jest.fn();
    render(<AssetPicker kind="video" onPick={onPick} onClose={jest.fn()} />);
    const movTile = screen.getByTitle(/IMG_0001\.MOV — Optimizing for screens/);
    expect(movTile).toBeDisabled();
    fireEvent.click(movTile);
    expect(onPick).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTitle('gym.mp4'));
    expect(onPick).toHaveBeenCalledWith('https://x.supabase.co/storage/v1/object/public/assets/t/22222222.mp4');
  });

  it('a picture picker refuses a video and an SVG with the shared words — and takes a HEIC with no type', async () => {
    uploadAssetDirect.mockResolvedValue({ id: 'new-2', fileUrl: 'https://x/t/5.jpg', mimeType: 'image/jpeg' });
    const onPick = jest.fn();
    render(<AssetPicker kind="image" onPick={onPick} onClose={jest.fn()} />);
    expect(fileInput().accept).not.toMatch(/avif|svg|video/);
    await choose(new File(['x'], 'clip.mov', { type: 'video/quicktime' }));
    expect(screen.getByText("clip.mov can't be used here — this takes JPG, PNG, WebP, GIF, BMP, ICO, HEIC.")).toBeInTheDocument();
    await choose(new File(['x'], 'logo.svg', { type: 'image/svg+xml' }));
    expect(screen.getByText(/SVG can't be uploaded as content/)).toBeInTheDocument();
    expect(uploadAssetDirect).not.toHaveBeenCalled();
    await choose(new File(['x'], 'IMG_0043.HEIC', { type: '' }));
    expect(uploadAssetDirect).toHaveBeenCalledTimes(1);
    expect(waitForScreenVersion).not.toHaveBeenCalled(); // a HEIC is converted BEFORE the asset exists
    expect(onPick).toHaveBeenCalledWith('https://x/t/5.jpg');
  });
});
