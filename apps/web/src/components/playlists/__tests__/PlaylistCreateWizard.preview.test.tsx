/**
 * New-playlist wizard → Step 2 "Selected media": every row's thumbnail opens a
 * full-size preview, and the arrows walk the list IN THE ORDER BEING ARRANGED.
 *
 * Greg, 2026-09-21 — six slides all called "ChatGPT Image Jul 9, 2026 at
 * 12_19_28 PM (n).png" behind 48px thumbnails:
 *   "i need to be able to open a preview of the images i added here to my
 *    playlist, so i can verify which is which and move around the order"
 */
import * as React from 'react';
import { render, screen as rtl, fireEvent, within } from '@testing-library/react';

const ASSETS = [
  { id: 'a1', originalName: 'ChatGPT Image (5).png', mimeType: 'image/png', fileUrl: 'https://cdn.test/five.png', folderId: null },
  { id: 'a2', originalName: 'ChatGPT Image (4).png', mimeType: 'image/png', fileUrl: 'https://cdn.test/four.png', folderId: null },
  { id: 'a3', originalName: 'ChatGPT Image (1).png', mimeType: 'image/png', fileUrl: 'https://cdn.test/one.png', folderId: null },
];

const noopMutation = () => ({ mutateAsync: jest.fn().mockResolvedValue({ id: 'new' }), isPending: false });

// Wholesale mock: every hook the wizard calls must be listed or it reads as
// undefined at render. If you add a hook to the wizard, add it here too.
jest.mock('@/hooks/use-api', () => ({
  useAssets: () => ({ data: ASSETS }),
  useAssetFolders: () => ({ data: [] }),
  useTemplates: () => ({ data: [] }),
  useScreens: () => ({ data: [] }),
  useScreenGroups: () => ({ data: [] }),
  useCreatePlaylist: noopMutation,
  useReorderPlaylistItems: noopMutation,
  useCreateSchedule: noopMutation,
  useCreateSubmission: noopMutation,
  useSetPlaylistSync: noopMutation,
  useSetScreenFaceMode: noopMutation,
}));
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn(), refetchQueries: jest.fn() }),
}));
const appConfirmMock = jest.fn().mockResolvedValue(true);
jest.mock('@/components/ui/app-dialog', () => ({
  appConfirm: (...a: unknown[]) => appConfirmMock(...a),
  appAlert: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/hooks/use-overlay-lock', () => ({ useOverlayLock: () => {} }));
jest.mock('@/store/ui-store', () => ({
  useUIStore: (sel: (s: unknown) => unknown) => sel({ user: { role: 'SCHOOL_ADMIN' } }),
}));

import { PlaylistCreateWizard } from '../PlaylistCreateWizard';

const onCloseWizard = jest.fn();

/** Walk to Step 2 and select all three assets, in the order (5), (4), (1). */
function toStepTwoWithThreeSelected() {
  render(<PlaylistCreateWizard open onClose={onCloseWizard} onCreated={() => {}} />);
  fireEvent.change(rtl.getByPlaceholderText(/e\.g\.|name/i), { target: { value: 'Lobby loop' } });
  fireEvent.click(rtl.getByText('Media Playlist'));
  fireEvent.click(rtl.getByRole('button', { name: /^Next/ }));
  for (const a of ASSETS) fireEvent.click(rtl.getAllByText(a.originalName)[0]);
}

const preview = () => document.body.querySelector('[data-testid="playlist-item-preview"]') as HTMLElement | null;
const previewedSrc = () => preview()?.querySelector('img')?.getAttribute('src') ?? null;

beforeEach(() => {
  onCloseWizard.mockClear();
  appConfirmMock.mockClear();
});

describe('new-playlist wizard — preview a selected item', () => {
  it('each selected row offers a preview button named for its slide and position', () => {
    toStepTwoWithThreeSelected();
    expect(rtl.getByRole('button', { name: 'Preview ChatGPT Image (5).png (item 1)' })).toBeInTheDocument();
    expect(rtl.getByRole('button', { name: 'Preview ChatGPT Image (4).png (item 2)' })).toBeInTheDocument();
    expect(rtl.getByRole('button', { name: 'Preview ChatGPT Image (1).png (item 3)' })).toBeInTheDocument();
    expect(preview()).toBeNull();
  });

  it('clicking a thumbnail opens THAT slide, full size, with its place in the order', () => {
    toStepTwoWithThreeSelected();
    fireEvent.click(rtl.getByRole('button', { name: 'Preview ChatGPT Image (4).png (item 2)' }));
    expect(preview()).not.toBeNull();
    expect(previewedSrc()).toContain('four.png');
    expect(within(preview()!).getByTestId('playlist-item-preview-position')).toHaveTextContent('2 of 3');
  });

  it('Next / Previous walk the list in its current order, and stop at the ends', () => {
    toStepTwoWithThreeSelected();
    fireEvent.click(rtl.getByRole('button', { name: 'Preview ChatGPT Image (5).png (item 1)' }));
    expect(within(preview()!).getByRole('button', { name: 'Previous item' })).toBeDisabled();

    fireEvent.click(within(preview()!).getByRole('button', { name: 'Next item' }));
    expect(previewedSrc()).toContain('four.png');
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(previewedSrc()).toContain('one.png');
    expect(within(preview()!).getByTestId('playlist-item-preview-position')).toHaveTextContent('3 of 3');
    expect(within(preview()!).getByRole('button', { name: 'Next item' })).toBeDisabled();

    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    expect(previewedSrc()).toContain('four.png');
  });

  it('Escape closes the PREVIEW — the wizard behind it stays open and is not asked to discard', () => {
    toStepTwoWithThreeSelected();
    fireEvent.click(rtl.getByRole('button', { name: 'Preview ChatGPT Image (5).png (item 1)' }));
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(preview()).toBeNull();
    expect(onCloseWizard).not.toHaveBeenCalled();
    expect(appConfirmMock).not.toHaveBeenCalled();
    // The selection is untouched.
    expect(rtl.getByRole('button', { name: 'Preview ChatGPT Image (1).png (item 3)' })).toBeInTheDocument();
  });
});

// ── The picker grid (same step, the tiles ABOVE the selected list) ───────
// Greg, same session: "when going to select the images i cant tell whats is
// landscap vs porterait because you made them all look identical in the
// preview here" — every tile was `object-cover` in a 16:9 box, so a portrait
// slide was cropped to a landscape-shaped slice.
describe('new-playlist wizard — picker tiles show the whole image and its shape', () => {
  function toStepTwo() {
    render(<PlaylistCreateWizard open onClose={() => {}} onCreated={() => {}} />);
    fireEvent.change(rtl.getByPlaceholderText(/e\.g\.|name/i), { target: { value: 'Lobby loop' } });
    fireEvent.click(rtl.getByText('Media Playlist'));
    fireEvent.click(rtl.getByRole('button', { name: /^Next/ }));
  }
  const tileImages = () => Array.from(document.querySelectorAll('img')).filter((i) => /cdn\.test/.test(i.getAttribute('src') || ''));
  const loadAs = (img: HTMLImageElement, w: number, h: number) => {
    Object.defineProperty(img, 'naturalWidth', { configurable: true, value: w });
    Object.defineProperty(img, 'naturalHeight', { configurable: true, value: h });
    fireEvent.load(img);
  };

  it('never crops: every tile image is object-contain, none is object-cover', () => {
    toStepTwo();
    const imgs = tileImages();
    expect(imgs.length).toBeGreaterThanOrEqual(3);
    for (const img of imgs) {
      expect(img.className).toMatch(/\bobject-contain\b/);
      expect(img.className).not.toMatch(/object-cover/);
    }
  });

  it('tags each tile with the shape MEASURED from the file — and says nothing before it has loaded', () => {
    toStepTwo();
    expect(rtl.queryAllByTestId('asset-orientation')).toHaveLength(0);
    const [a, b, c] = tileImages();
    loadAs(a, 1920, 1080);
    loadAs(b, 1080, 1920);
    loadAs(c, 1000, 1000);
    expect(rtl.getAllByTestId('asset-orientation').map((n) => n.textContent)).toEqual(['Landscape', 'Portrait', 'Square']);
  });
});
