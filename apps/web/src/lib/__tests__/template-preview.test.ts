import { templatePreviewOf } from '../template-preview';

it('keeps saved edits, geometry and portrait size from the playlist API, including string configs', () => {
  const preview = templatePreviewOf({ screenWidth: 1080, screenHeight: 1920, zones: [{ widgetType: 'EXTERNAL_HTML', x: 4, y: 5, width: 70, height: 90, defaultConfig: JSON.stringify({ url: '/templates/custom/board.html', textOverrides: { title: 'Saved title' } }) }] });
  expect(preview).toMatchObject({ screenWidth: 1080, screenHeight: 1920, zones: [{ x: 4, y: 5, width: 70, height: 90, defaultConfig: { textOverrides: { title: 'Saved title' } } }] });
});

it('previews the first scene and global zones without stacking later scenes on it', () => {
  const preview = templatePreviewOf({ scenes: [{ id: 'first' }], zones: [
    { widgetType: 'TEXT', sceneId: null }, { widgetType: 'CLOCK', sceneId: 'first' }, { widgetType: 'IMAGE', sceneId: 'second' },
  ] });
  expect(preview?.zones.map(z => z.widgetType)).toEqual(['TEXT', 'CLOCK']);
});
