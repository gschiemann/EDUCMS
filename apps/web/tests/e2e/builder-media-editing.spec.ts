import { test, expect, type Page, type Route } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const ORIGIN = process.env.E2E_BASE || 'http://localhost:3000';
const CORS = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'authorization,content-type,x-csrf-token,x-requested-with',
};
const media = ['landscape', 'portrait', 'square'].map(name => ({ id: name, mimeType: 'image/png', originalName: `${name}.png`, fileUrl: `${ORIGIN}/test-media/${name}.png` }));
const clip = { id: 'video', mimeType: 'video/mp4', originalName: 'clip.mp4', fileUrl: `${ORIGIN}/test-media/clip.mp4` };
type TestZone = Record<string, unknown> & { defaultConfig: Record<string, unknown> & {
  mediaStyles?: Record<string, { rotation?: number }>;
  imageOverrides?: Record<string, string | string[]>;
} };

async function openEditor(page: Page, portrait = false, initialZones?: TestZone[]) {
  let template: Record<string, unknown> & { zones: TestZone[] } = {
    id: 'media-editor', name: 'Media design', tenantId: 'e2e-school', isSystem: false,
    screenWidth: portrait ? 1080 : 1920, screenHeight: portrait ? 1920 : 1080, bgColor: '#ffffff', scenes: [],
    zones: initialZones || [{ id: 'blank', name: 'Full Screen', widgetType: 'EMPTY', x: 0, y: 0, width: 100, height: 100, zIndex: 0, sortOrder: 0, defaultConfig: {} }],
  };
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(() => localStorage.setItem('edu_cms_eula_accepted_v1.0', '1'));
  await page.route('**/test-media/**', route => {
    if (route.request().method() === 'PUT') return route.fulfill({ status: 200, body: '{}' });
    const name = new URL(route.request().url()).pathname.split('/').pop()!;
    const fixture = name === 'clip.mp4' ? 'loop-clip.mp4' : `editor-${name}`;
    return route.fulfill({ contentType: name.endsWith('.png') ? 'image/png' : 'video/mp4', body: fs.readFileSync(path.join(__dirname, 'fixtures', fixture)) });
  });
  const json = (route: Route, body: unknown) => route.fulfill({ contentType: 'application/json', headers: CORS, body: JSON.stringify(body) });
  await page.route(/(?:http:\/\/api\.invalid\/|\/api\/v1\/)/, route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const endpoint = new URL(route.request().url()).pathname.replace('/api/v1', '');
    if (endpoint === '/templates/media-editor/zones' && route.request().method() === 'PUT') {
      template = { ...template, zones: route.request().postDataJSON().zones.map((z: TestZone, i: number) => ({ ...z, id: `saved-${i}` })) };
      return json(route, template);
    }
    if (endpoint === '/templates/media-editor' && route.request().method() === 'PUT') template = { ...template, ...route.request().postDataJSON() };
    if (endpoint === '/auth/me') return json(route, { id: 'editor-user', email: 'editor@example.com', role: 'SCHOOL_ADMIN', tenantId: 'e2e-school', canTriggerPanic: false });
    if (endpoint === '/auth/csrf') return json(route, { token: 'e2e-csrf' });
    if (endpoint === '/assets/presign') {
      const filename = route.request().postDataJSON().filename;
      return json(route, { uploadUrl: `${ORIGIN}/test-media/upload`, storagePath: filename, fileUrl: media[0].fileUrl, mimeType: 'image/png', maxFileSize: 50 * 1024 * 1024 });
    }
    if (endpoint === '/assets/complete-upload') {
      const filename = route.request().postDataJSON().filename;
      const name = filename.replace(/^editor-/, '').replace(/\.png$/, '');
      return json(route, { id: `uploaded-${name}`, fileUrl: `${ORIGIN}/test-media/${name}.png`, mimeType: 'image/png', originalName: filename, status: 'PUBLISHED' });
    }
    if (endpoint.startsWith('/templates/media-editor')) return json(route, template);
    if (endpoint === '/tenants' || endpoint === '/tenants/accessible') return json(route, [{ id: 'e2e-school', name: 'Example venue', slug: 'e2e-school', vertical: 'CORPORATE' }]);
    if (endpoint === '/branding/me') return json(route, {});
    if (endpoint.startsWith('/assets')) return json(route, [...media, clip]);
    return json(route, []);
  });
  await page.goto('/e2e-school/templates/builder/media-editor', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('tab', { name: /^Widgets$/i })).toBeVisible({ timeout: 60_000 });
  if (!initialZones) await expect(page.getByRole('group', { name: 'Add to your design' })).toBeVisible();
  return { saved: () => template };
}

async function addImage(page: Page, name: string) {
  await page.getByRole('tab', { name: /^Widgets$/i }).click();
  await page.getByRole('group', { name: 'Add to your design' }).getByRole('button', { name: 'Image', exact: true }).click();
  const dialog = page.getByRole('dialog').filter({ hasText: 'Pick an image' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: `${name}.png`, exact: true }).click();
  await expect(dialog).toHaveCount(0);
  return page.locator('[data-zone-id]').filter({ has: page.locator(`img[src*="/${name}.png"]`) });
}

test('media starts at the top; cancel leaves the design alone; three pictures have tight frames and save their rotation', async ({ page }, testInfo) => {
  const state = await openEditor(page);
  const quick = page.getByRole('group', { name: 'Add to your design' });
  for (const label of ['Image', 'Video', 'Text']) await expect(quick.getByRole('button', { name: label, exact: true })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('blank-editor.png') });
  await quick.getByRole('button', { name: 'Image', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('[data-zone-id]')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Rotate selection' })).toHaveCount(0);
  for (const [name, width, height] of [['landscape', 1200, 800], ['portrait', 800, 1200], ['square', 900, 900]] as const) {
    const zone = await addImage(page, name);
    const geometry = await zone.evaluate(el => ({ width: (el as HTMLElement).offsetWidth, height: (el as HTMLElement).offsetHeight }));
    expect(geometry.width / geometry.height).toBeCloseTo(width / height, 1);
    expect(await zone.locator('img').evaluate(el => getComputedStyle(el).objectFit)).toBe('contain');
  }
  await expect(page.locator('[data-zone-id]')).toHaveCount(3);
  const bar = page.locator('[data-builder-bottom-bar]');
  await bar.getByRole('button', { name: 'Rotate right 90°', exact: true }).click();
  await expect(bar.getByRole('spinbutton', { name: 'Rotation in degrees' })).toHaveValue('90');
  await bar.getByRole('button', { name: /Undo/ }).click();
  await expect(bar.getByRole('spinbutton', { name: 'Rotation in degrees' })).toHaveValue('0');
  await bar.getByRole('button', { name: /Redo/ }).click();
  await expect(bar.getByRole('spinbutton', { name: 'Rotation in degrees' })).toHaveValue('90');
  await bar.getByRole('spinbutton', { name: 'Rotation in degrees' }).fill('25');
  await expect(page.locator('[data-selection-chrome]')).toHaveCSS('transform', /matrix/);
  await expect(bar).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('three-images-rotated.png') });
  await page.getByRole('button', { name: /^Save$/ }).click();
  await expect.poll(() => state.saved().zones.length).toBe(3);
  await expect.poll(() => state.saved().zones[2]?.defaultConfig?._zoneRotation).toBe(25);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-zone-id]')).toHaveCount(3);
  await expect(page.locator('[data-zone-id]').filter({ has: page.locator('img[src*="/square.png"]') })).toHaveCSS('transform', /matrix/);
});

test('rotation handle drags and supports keyboard; resize preserves proportions; lock removes gesture controls', async ({ page }) => {
  await openEditor(page);
  const zone = await addImage(page, 'landscape');
  const handle = page.getByRole('button', { name: 'Rotate selection', exact: true });
  const box = await zone.boundingBox();
  const knob = await handle.boundingBox();
  expect(box).not.toBeNull(); expect(knob).not.toBeNull();
  const cx = box!.x + box!.width / 2, cy = box!.y + box!.height / 2;
  await page.mouse.move(knob!.x + knob!.width / 2, knob!.y + knob!.height / 2);
  await page.mouse.down();
  await page.keyboard.down('Shift');
  await page.mouse.move(cx - 150, cy + 150, { steps: 12 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect(page.getByRole('spinbutton', { name: 'Rotation in degrees' })).toHaveValue('45');
  await page.locator('[data-builder-bottom-bar]').getByRole('button', { name: /Undo/ }).click();
  await expect(page.getByRole('spinbutton', { name: 'Rotation in degrees' })).toHaveValue('0');
  await handle.focus(); await page.keyboard.press('Shift+ArrowRight');
  await expect(page.getByRole('spinbutton', { name: 'Rotation in degrees' })).toHaveValue('15');
  await page.keyboard.press('Home');
  const resize = await page.getByRole('button', { name: 'Resize se', exact: true }).boundingBox();
  await page.mouse.move(resize!.x + 6, resize!.y + 6); await page.mouse.down();
  await page.mouse.move(resize!.x - 40, resize!.y - 30, { steps: 10 }); await page.mouse.up();
  const after = await zone.boundingBox();
  expect(after!.width).toBeLessThan(box!.width);
  expect(after!.width / after!.height).toBeCloseTo(1.5, 1);
  await page.locator('[data-builder-bottom-bar]').getByRole('button', { name: 'Lock', exact: true }).click();
  await expect(handle).toHaveCount(0);
  await expect(page.getByRole('spinbutton', { name: 'Rotation in degrees' })).toBeDisabled();
});

test('video picker adds the actual clip in a tight frame; portrait editor keeps the toolbar accessible', async ({ page }, testInfo) => {
  await openEditor(page, true);
  await page.getByRole('group', { name: 'Add to your design' }).getByRole('button', { name: 'Video', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: /clip.mp4/ }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const zone = page.locator('[data-zone-id]');
  await expect(zone).toHaveCount(1);
  const video = zone.locator('video');
  await expect(video).toHaveAttribute('src', /\/test-media\/clip\.mp4(?:#.*)?$/);
  const dimensions = await video.evaluate((el: HTMLVideoElement) => ({ width: el.videoWidth, height: el.videoHeight, frameW: el.clientWidth, frameH: el.clientHeight }));
  expect(dimensions.width).toBeGreaterThan(0);
  expect(dimensions.frameW / dimensions.frameH).toBeCloseTo(dimensions.width / dimensions.height, 1);
  await expect(page.getByRole('button', { name: 'Replace video', exact: true })).toBeVisible();
  await expect(page.locator('[data-builder-bottom-bar]')).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('portrait-video-editor.png') });
});

test('upload from the computer and drop a batch over an existing picture creates three separate images', async ({ page }) => {
  await openEditor(page);
  await page.getByRole('group', { name: 'Add to your design' }).getByRole('button', { name: 'Image', exact: true }).click();
  await page.getByRole('dialog').locator('input[type="file"]').setInputFiles(path.join(__dirname, 'fixtures/editor-landscape.png'));
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const zone = page.locator('[data-zone-id]');
  await expect(zone).toHaveCount(1);
  await expect(zone.locator('img')).toHaveAttribute('src', media[0].fileUrl);
  const files = ['portrait', 'square'].map(name => ({ name: `editor-${name}.png`, base64: fs.readFileSync(path.join(__dirname, 'fixtures', `editor-${name}.png`)).toString('base64') }));
  await zone.evaluate((el, files) => {
    const transfer = new DataTransfer();
    for (const file of files) transfer.items.add(new File([Uint8Array.from(atob(file.base64), c => c.charCodeAt(0))], file.name, { type: 'image/png' }));
    const rect = el.getBoundingClientRect();
    el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 }));
  }, files);
  await expect(page.locator('[data-zone-id]')).toHaveCount(3);
  for (const asset of media) await expect(page.locator(`[data-zone-id] img[src="${asset.fileUrl}"]`)).toHaveCount(1);
});

test('Fit frame repairs a saved image with empty borders; toolbar and panel fit controls agree; replacement preserves layout', async ({ page }) => {
  await openEditor(page, false, [{ id: 'legacy', name: 'Existing image', widgetType: 'IMAGE', x: 10, y: 10, width: 70, height: 70, zIndex: 1, sortOrder: 0, defaultConfig: { assetUrl: media[0].fileUrl, fit: 'contain' } }]);
  const zone = page.locator('[data-zone-id]');
  await zone.click();
  await page.getByRole('button', { name: 'Fit frame to image', exact: true }).click();
  await expect.poll(() => zone.evaluate(el => el.clientWidth / el.clientHeight)).toBeCloseTo(1.5, 1);
  const bar = page.locator('[data-builder-bottom-bar]');
  await bar.getByRole('combobox', { name: 'Media fit' }).selectOption('cover');
  await expect(zone.locator('img')).toHaveCSS('object-fit', 'cover');
  const panelFit = page.getByRole('tabpanel').locator('select').filter({ has: page.locator('option', { hasText: 'Show whole image' }) });
  await expect(panelFit).toHaveValue('cover');
  await panelFit.selectOption('contain');
  await expect(bar.getByRole('combobox', { name: 'Media fit' })).toHaveValue('contain');
  await expect(zone.locator('img')).toHaveCSS('object-fit', 'contain');
  const before = await zone.boundingBox();
  await bar.getByRole('button', { name: 'Replace image', exact: true }).click();
  await page.getByRole('dialog').getByRole('searchbox', { name: 'Search media library' }).fill('portrait');
  await expect(page.getByRole('dialog').getByRole('button', { name: 'landscape.png', exact: true })).toHaveCount(0);
  await page.getByRole('dialog').getByRole('button', { name: 'portrait.png', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const after = await zone.boundingBox();
  expect(after).toEqual(before);
  await expect(zone.locator('img')).toHaveAttribute('src', media[1].fileUrl);
});

for (const [board, key] of [
  ['/templates/school/elem-news-storybook.html', 'school.logo'],
  ['/templates/signage/qsr/01-drive-thru-flagship.html', 'hero'],
  ['/templates/kiosk/school.html', 'staff.reyes.photo'],
  ['/templates/custom/brookfield/07-tour-takeaway.html', 'tour.image'],
] as const) {
  test(`built-in media has the same replace, fit and rotation controls: ${board}`, async ({ page }, testInfo) => {
    const boardConfig = { url: board, imageOverrides: { [key]: [media[0].fileUrl, media[2].fileUrl] } };
    const state = await openEditor(page, false, [{ id: 'built-in', name: 'Standard template', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: boardConfig }]);
    const frame = page.locator('[data-zone-id="built-in"] iframe').contentFrame();
    if (board.includes('/kiosk/')) await frame.getByText('Directory', { exact: true }).click();
    const slot = frame.locator(`[data-imgslot="${key}"]:visible,[data-slot="${key}"]:visible,[data-img="${key}"]:visible,[data-posterslot="${key}"]:visible`).first();
    await expect(slot).toBeVisible();
    await slot.click();
    const bar = page.locator('[data-builder-bottom-bar]');
    await expect(bar.getByRole('button', { name: 'Replace image', exact: true })).toBeVisible();
    await bar.getByRole('combobox', { name: 'Media fit' }).selectOption('contain');
    await bar.getByRole('button', { name: 'Rotate right 90°', exact: true }).click();
    await expect(bar.getByRole('spinbutton', { name: 'Rotation in degrees' })).toHaveValue('90');
    await expect(slot).toHaveCSS('transform', /matrix\(0, 1, -1, 0,/);
    await bar.getByRole('button', { name: /Undo/ }).click();
    await expect(bar.getByRole('spinbutton', { name: 'Rotation in degrees' })).toHaveValue('0');
    await bar.getByRole('button', { name: /Redo/ }).click();
    await bar.getByRole('button', { name: 'Replace image', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'portrait.png', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const source = () => slot.evaluate(el => (el.matches('img') ? el : el.querySelector('img'))?.getAttribute('src') || getComputedStyle(el).backgroundImage);
    await expect.poll(source).toContain('/portrait.png');
    await bar.getByRole('button', { name: /Undo/ }).click();
    await expect.poll(source).toContain('/landscape.png');
    await bar.getByRole('button', { name: /Redo/ }).click();
    await expect.poll(source).toContain('/portrait.png');
    await bar.getByRole('button', { name: 'Delete image', exact: true }).click();
    await expect(slot).toHaveCount(0);
    await bar.getByRole('button', { name: 'Replace image', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'portrait.png', exact: true }).click();
    await expect(slot).toBeVisible();
    await expect.poll(source).toContain('/portrait.png');
    await page.getByRole('button', { name: /^Save$/ }).click();
    await expect.poll(() => state.saved().zones[0]?.defaultConfig?.mediaStyles?.[key]?.rotation).toBe(90);
    expect(state.saved().zones[0].defaultConfig.imageOverrides?.[key]).toEqual([media[1].fileUrl, media[2].fileUrl]);
    await page.reload({ waitUntil: 'domcontentloaded' });
    const savedFrame = page.locator('[data-zone-id] iframe').contentFrame();
    if (board.includes('/kiosk/')) await savedFrame.getByText('Directory', { exact: true }).click();
    const savedSlot = savedFrame.locator(`[data-imgslot="${key}"]:visible,[data-slot="${key}"]:visible,[data-img="${key}"]:visible,[data-posterslot="${key}"]:visible`).first();
    await expect.poll(() => savedSlot.evaluate(el => (el.matches('img') ? el : el.querySelector('img'))?.getAttribute('src') || getComputedStyle(el).backgroundImage)).toContain('/portrait.png');
    await expect(savedSlot).toHaveCSS('transform', /matrix\(0, 1, -1, 0,/);
    await expect.poll(() => savedSlot.evaluate(el => {
      const image = el.matches('img') ? el : el.querySelector('img');
      return (image ? getComputedStyle(image).objectFit : getComputedStyle(el).backgroundSize).split(',')[0].trim();
    })).toBe('contain');
    await savedSlot.click();
    await expect(bar.getByRole('button', { name: 'Replace image', exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('built-in-media-edited.png') });
    await addImage(page, 'square');
    await expect(page.locator('[data-zone-id]')).toHaveCount(2);
    await expect(savedSlot).toHaveCSS('transform', /matrix\(0, 1, -1, 0,/);
  });
}

test('adding media to a standard React template keeps the original design and uses the blank-canvas controls', async ({ page }) => {
  const background = { id: 'welcome', name: 'Animated Welcome Scene', widgetType: 'ANIMATED_WELCOME', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { title: 'Welcome, Friends!', subtitle: 'today is going to be amazing', logoEmoji: '🍎' } };
  const state = await openEditor(page, false, [background]);
  const picture = await addImage(page, 'portrait');
  await expect(page.locator('[data-zone-id="welcome"]')).toContainText('Welcome, Friends!');
  await page.locator('[data-builder-bottom-bar]').getByRole('button', { name: 'Rotate right 90°', exact: true }).click();
  await expect(picture).toHaveCSS('transform', /matrix\(0, 1, -1, 0,/);
  await page.getByRole('button', { name: /^Save$/ }).click();
  await expect.poll(() => state.saved().zones.length).toBe(2);
  expect(state.saved().zones[0]).toMatchObject({ ...background, id: 'saved-0', locked: false });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-zone-id]').filter({ has: page.locator('img[src*="/portrait.png"]') })).toHaveCSS('transform', /matrix\(0, 1, -1, 0,/);
});

test('the full widget list leads with everyday media and understands plural searches; quick Text replaces the empty starter', async ({ page }, testInfo) => {
  await openEditor(page);
  const start = page.locator('section').filter({ has: page.getByRole('heading', { name: /^Start here/ }) });
  const entries = start.getByRole('button', { name: /^Add / });
  await expect(entries.nth(0)).toHaveAccessibleName('Add Image to your empty board');
  await expect(entries.nth(1)).toHaveAccessibleName('Add Video to your empty board');
  await expect(entries.nth(3)).toHaveAccessibleName('Add Image Carousel to your empty board');
  await expect(entries.nth(4)).toHaveAccessibleName('Add Video Carousel to your empty board');
  const mediaRow = page.locator('section').filter({ has: page.getByRole('heading', { name: /^Photos & video/ }) });
  const rowEntries = mediaRow.getByRole('button', { name: /^Add / });
  await expect(rowEntries.nth(0)).toHaveAccessibleName('Add Image to your empty board');
  await expect(rowEntries.nth(1)).toHaveAccessibleName('Add Video to your empty board');
  const search = page.getByRole('searchbox', { name: 'Search widgets' });
  for (const [query, label] of [['images', 'Image'], ['videos', 'Video']] as const) {
    await search.fill(query);
    await expect(page.getByRole('button', { name: `Add ${label} to your empty board`, exact: true })).toBeVisible();
  }
  await search.fill('');
  await page.screenshot({ path: testInfo.outputPath('everyday-widgets-first.png') });
  await page.getByRole('group', { name: 'Add to your design' }).getByRole('button', { name: 'Text', exact: true }).click();
  await expect(page.locator('[data-zone-id]')).toHaveCount(1);
  await expect(page.locator('[data-zone-id]')).toContainText('Click to edit text');
  await page.locator('[data-builder-bottom-bar]').getByRole('button', { name: /Undo/ }).click();
  await expect(page.locator('[data-zone-id="blank"]')).toHaveCount(1);
});
