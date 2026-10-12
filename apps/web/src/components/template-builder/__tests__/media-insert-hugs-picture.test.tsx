/**
 * Owner 2026-10-12: "adding an image creates a zone much larger than the
 * image (big empty frame around a portrait image)". A new image / video zone
 * must take the file's own aspect ratio so the selection box hugs it:
 *   - the picked library asset's server-measured size is used first (no
 *     fetch — a slow 4K file used to outlast the 5 s browser read and land
 *     in the generic 40×40 box);
 *   - when the size is still unknown at insert, the frame is tightened as
 *     soon as the file can be read, unless the operator already moved it.
 */
import { act, render, waitFor } from '@testing-library/react';
import { useBuilderStore } from '../useBuilderStore';
import type { Zone } from '../types';
import { assetMetaDimensions, openMediaPicker } from '../media-sizing';

const mockRead = jest.fn();
jest.mock('../media-sizing', () => ({
  ...jest.requireActual('../media-sizing'),
  readMediaDimensions: (...args: unknown[]) => mockRead(...args),
}));
let mockPickArgs: [string, unknown] = ['/x.png', null];
jest.mock('../PropertiesPanel', () => ({
  AssetLibraryModal: ({ onPick }: { onPick: (url: string, dims?: unknown) => void }) => (
    <button type="button" data-testid="pick" onClick={() => onPick(...mockPickArgs)}>pick</button>
  ),
}));

import { MediaInsertPicker, tightenWhenKnown } from '../MediaInsertPicker';
import { fireEvent, screen } from '@testing-library/react';

const CANVAS = { width: 1920, height: 1080 };
const placeholder: Zone = { id: 'blank', name: 'Full Screen', widgetType: 'EMPTY', x: 0, y: 0, width: 100, height: 100, zIndex: 0, sortOrder: 0, defaultConfig: {} } as Zone;
const pixelAspect = (z: Zone) => (z.width * CANVAS.width) / (z.height * CANVAS.height);

beforeEach(() => {
  mockRead.mockReset();
  useBuilderStore.getState().init({
    id: 'media', isSystem: false, zones: [placeholder],
    meta: { name: 'T', description: '', screenWidth: CANVAS.width, screenHeight: CANVAS.height, bgColor: '', bgGradient: '', bgImage: '' },
  } as never);
});

it('reads an asset\'s stored size from processingMeta (processed first, then original)', () => {
  expect(assetMetaDimensions({ processingMeta: { processedDimensions: { w: 1080, h: 1920 }, originalDimensions: { w: 4000, h: 6000 } } })).toEqual({ width: 1080, height: 1920 });
  expect(assetMetaDimensions({ processingMeta: { originalDimensions: { w: 1080, h: 1920 } } })).toEqual({ width: 1080, height: 1920 });
  expect(assetMetaDimensions({ processingMeta: {} })).toBeNull();
  expect(assetMetaDimensions(null)).toBeNull();
});

it('a picked portrait library image gets a frame at its own aspect — without reading the file', async () => {
  mockPickArgs = ['https://cdn.example/portrait.jpg', { width: 1080, height: 1920 }];
  render(<MediaInsertPicker />);
  act(() => openMediaPicker({ kind: 'image' }));
  fireEvent.click(screen.getByTestId('pick'));
  await waitFor(() => expect(useBuilderStore.getState().zones[0]?.widgetType).toBe('IMAGE'));
  const z = useBuilderStore.getState().zones[0];
  expect(mockRead).not.toHaveBeenCalled();
  expect(pixelAspect(z)).toBeCloseTo(1080 / 1920);
  expect(z.height).toBeLessThanOrEqual(75);
  // Centred on the canvas.
  expect(z.x + z.width / 2).toBeCloseTo(50, 0);
});

it('a video uses its metadata dimensions the same way', async () => {
  mockPickArgs = ['https://cdn.example/clip.mp4', { width: 1920, height: 1080 }];
  render(<MediaInsertPicker />);
  act(() => openMediaPicker({ kind: 'video' }));
  fireEvent.click(screen.getByTestId('pick'));
  await waitFor(() => expect(useBuilderStore.getState().zones[0]?.widgetType).toBe('VIDEO'));
  expect(pixelAspect(useBuilderStore.getState().zones[0])).toBeCloseTo(16 / 9);
});

it('an unknown size at insert is tightened around the picture once it can be read', async () => {
  const st = useBuilderStore.getState();
  const id = st.addMediaZone('image', '/slow.jpg', null);
  const fallback = useBuilderStore.getState().zones.find(z => z.id === id)!;
  expect(fallback.width).toBe(40); // the generic box
  mockRead.mockResolvedValue({ width: 1000, height: 2000 });
  await expect(tightenWhenKnown(id, '/slow.jpg', 'image')).resolves.toBe(true);
  const z = useBuilderStore.getState().zones.find(zz => zz.id === id)!;
  expect(pixelAspect(z)).toBeCloseTo(0.5);
  // Stays inside the old frame, centred on it.
  expect(z.width).toBeLessThanOrEqual(fallback.width);
  expect(z.height).toBeLessThanOrEqual(fallback.height);
  expect(z.x + z.width / 2).toBeCloseTo(fallback.x + fallback.width / 2);
  expect(z.y + z.height / 2).toBeCloseTo(fallback.y + fallback.height / 2);
});

it('never resizes a frame the operator already moved', async () => {
  const id = useBuilderStore.getState().addMediaZone('image', '/slow.jpg', null);
  let release: (v: unknown) => void = () => {};
  mockRead.mockReturnValue(new Promise(r => { release = r; }));
  const pending = tightenWhenKnown(id, '/slow.jpg', 'image');
  useBuilderStore.getState().updateZone(id, { x: 1 }, true);
  release({ width: 1000, height: 2000 });
  await expect(pending).resolves.toBe(false);
  expect(useBuilderStore.getState().zones.find(z => z.id === id)!.width).toBe(40);
});
