import { useBuilderStore } from '../useBuilderStore';
import { naturalMediaSize, mediaFrameGeometry } from '../media-sizing';
import { mediaSourcePatch } from '../media-source';
import type { Zone } from '../types';
import { patchBoardMedia, replaceBoardMedia } from '../board-media';

const canvas = { width: 1920, height: 1080 };
const placeholder: Zone = { id: 'empty', name: 'Empty', widgetType: 'EMPTY', x: 0, y: 0, width: 100, height: 100, zIndex: 0, sortOrder: 0, defaultConfig: {} };
beforeEach(() => useBuilderStore.getState().init({
  id: 'media-test', isSystem: false, zones: [placeholder],
  meta: { name: 'Test', description: '', screenWidth: canvas.width, screenHeight: canvas.height, bgColor: '#fff', bgImage: '', bgGradient: '' },
}));

it('keeps original pixels for a small file and fits a large portrait without stretching', () => {
  const small = naturalMediaSize({ width: 200, height: 100 }, canvas);
  expect(small.w / 100 * canvas.width).toBeCloseTo(200);
  expect(small.h / 100 * canvas.height).toBeCloseTo(100);
  const tall = naturalMediaSize({ width: 1600, height: 2400 }, canvas);
  expect(tall.h).toBe(75);
  expect(tall.w / tall.h * canvas.width / canvas.height).toBeCloseTo(2 / 3);
});

it('adds the actual image in a tight frame, removes only the blank placeholder, and undoes in one step', () => {
  const st = useBuilderStore.getState();
  const id = st.addMediaZone('image', '/photo.png', { width: 200, height: 100 });
  const after = useBuilderStore.getState();
  expect(after.zones).toHaveLength(1);
  expect(after.zones[0].id).toBe(id);
  expect(after.zones[0].defaultConfig).toMatchObject({ assetUrl: '/photo.png', fit: 'contain' });
  expect(after.zones[0].width / after.zones[0].height * canvas.width / canvas.height).toBeCloseTo(2);
  expect(after.past).toHaveLength(1);
  st.undo();
  expect(useBuilderStore.getState().zones).toEqual([placeholder]);
  st.redo();
  expect(useBuilderStore.getState().zones[0].id).toBe(id);
  st.addMediaZone('image', '/another.png', { width: 800, height: 1200 });
  expect(useBuilderStore.getState().zones).toHaveLength(2);
});

it('a thin banner retains its proportions even below the generic widget minimum', () => {
  useBuilderStore.getState().addMediaZone('image', '/banner.png', { width: 1200, height: 20 });
  const z = useBuilderStore.getState().zones[0];
  expect(z.width / z.height * canvas.width / canvas.height).toBeCloseTo(60);
});

it('repairs an oversized frame around the whole picture and preserves its centre', () => {
  const frame = { x: 10, y: 20, width: 60, height: 60 };
  const fixed = mediaFrameGeometry(frame, { width: 400, height: 600 }, canvas);
  expect(fixed.width / fixed.height * canvas.width / canvas.height).toBeCloseTo(2 / 3);
  expect(fixed.x + fixed.width / 2).toBeCloseTo(40);
  expect(fixed.y + fixed.height / 2).toBeCloseTo(50);
});

it('the first file tightens an empty image frame; replacement preserves position, size and styling', () => {
  const frame: Zone = { ...placeholder, widgetType: 'IMAGE', width: 60, height: 60 };
  const patch = mediaSourcePatch(frame, '/first.png', 'image', { width: 400, height: 600 }, canvas);
  expect(patch.width).toBeLessThan(60);
  const occupied: Zone = { ...frame, defaultConfig: { assetUrl: '/old.png', fit: 'cover', _zoneRotation: 25 } };
  const replacement = mediaSourcePatch(occupied, '/new.png', 'image', { width: 900, height: 900 }, canvas);
  expect(replacement.width).toBeUndefined();
  expect(replacement.x).toBeUndefined();
  expect(replacement.defaultConfig).toMatchObject({ assetUrl: '/new.png', fit: 'cover', _zoneRotation: 25, _mediaWidth: 900 });
});

it('built-in image replacement preserves galleries, copy, styles and geometry and undoes in one step', () => {
  const board: Zone = { ...placeholder, id: 'board', widgetType: 'EXTERNAL_HTML', defaultConfig: {
    url: '/templates/school/example.html', textOverrides: { headline: 'Our school' }, _styles: { headline: { bold: true } },
    imageOverrides: { hero: ['/first.png', '/second.png'], logo: '/logo.png' }, mediaStyles: { hero: { rotation: 25 } },
  } };
  useBuilderStore.setState({ zones: [board] });
  replaceBoardMedia('board', 'hero', 'image', '/replacement.png');
  expect(useBuilderStore.getState().zones[0]).toMatchObject({ ...board, defaultConfig: { ...board.defaultConfig, imageOverrides: { hero: ['/replacement.png', '/second.png'], logo: '/logo.png' } } });
  useBuilderStore.getState().undo();
  expect(useBuilderStore.getState().zones[0]).toEqual(board);
  patchBoardMedia('board', 'hero', { fit: 'contain' });
  expect(useBuilderStore.getState().zones[0].defaultConfig).toMatchObject({ mediaStyles: { hero: { rotation: 25, fit: 'contain' } }, textOverrides: { headline: 'Our school' } });
  useBuilderStore.getState().undo();
  expect(useBuilderStore.getState().zones[0]).toEqual(board);
});

it('media updates respect locked built-in templates and preview mode', () => {
  const board: Zone = { ...placeholder, id: 'board', widgetType: 'EXTERNAL_HTML', locked: true };
  useBuilderStore.setState({ zones: [board] });
  patchBoardMedia('board', 'hero', { rotation: 90 });
  replaceBoardMedia('board', 'hero', 'image', '/new.png');
  expect(useBuilderStore.getState().zones[0]).toEqual(board);
  useBuilderStore.setState({ zones: [{ ...board, locked: false }], previewMode: true });
  replaceBoardMedia('board', 'hero', 'image', '/new.png');
  expect(useBuilderStore.getState().zones[0].defaultConfig).toEqual({});
  useBuilderStore.setState({ previewMode: false });
});

it('replacing a deleted embedded image makes it visible and Undo restores its deleted state', () => {
  const board: Zone = { ...placeholder, id: 'board', widgetType: 'EXTERNAL_HTML', defaultConfig: { mediaStyles: { hero: { hidden: true, rotation: 90, fit: 'contain' } } } };
  useBuilderStore.setState({ zones: [board] });
  replaceBoardMedia('board', 'hero', 'image', '/replacement.png');
  expect(useBuilderStore.getState().zones[0].defaultConfig).toMatchObject({ mediaStyles: { hero: { hidden: false, rotation: 90, fit: 'contain' } } });
  useBuilderStore.getState().undo();
  expect(useBuilderStore.getState().zones[0]).toEqual(board);
});
