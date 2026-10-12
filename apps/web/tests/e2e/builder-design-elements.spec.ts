import { test, expect, type Page, type Route } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// Playwright's block script reads navigator.serviceWorker in every frame;
// packaged boards deliberately lack allow-same-origin. This suite uses no SW.
test.use({ serviceWorkers: 'allow' });

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

async function openEditor(page: Page, portrait = false, initialZones?: TestZone[], resolution = 1920) {
  let template: Record<string, unknown> & { zones: TestZone[] } = {
    id: 'media-editor', name: 'Media design', tenantId: 'e2e-school', isSystem: false,
    screenWidth: portrait ? Math.round(resolution * 9 / 16) : resolution, screenHeight: portrait ? resolution : Math.round(resolution * 9 / 16), bgColor: '#ffffff', scenes: [],
    zones: initialZones || [{ id: 'blank', name: 'Full Screen', widgetType: 'EMPTY', x: 0, y: 0, width: 100, height: 100, zIndex: 0, sortOrder: 0, defaultConfig: {} }],
  };
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(() => { if (window === window.top) localStorage.setItem('edu_cms_eula_accepted_v1.0', '1'); });
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

  return { saved: () => template };
}


async function addElement(page: Page, query: string, name: string) {
  await page.getByRole('tab', { name: /^Widgets$/i }).click();
  await page.getByRole('searchbox', { name: 'Search widgets' }).fill(query);
  await page.getByRole('button', { name: new RegExp(`^Add ${name}(?: to your empty board)?$`) }).click();
  await page.getByRole('tab', { name: /^Properties$/i }).click();
}

for (const preset of [false, true]) {
  test(`new design tools save and reopen on ${preset ? 'a built-in template' : 'a blank canvas'}`, async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    page.on('pageerror', error => { errors.push(error.message); console.log('browser error:', error.message); });
    const initial = preset ? [{ id: 'built-in', name: 'Standard template', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 0, sortOrder: 0, defaultConfig: { url: '/templates/signage/corporate/20-service-update.html' } }] : undefined;
    const state = await openEditor(page, false, initial);
    await addElement(page, 'Table', 'Table');
    await page.getByLabel('Heading', { exact: true }).fill('Visitor services');
    await page.getByLabel('Item · row 1', { exact: true }).fill('Reception');
    await expect(page.locator('[data-zone-id] [data-design-data="table"]')).toContainText('Reception');
    await addElement(page, 'Bar chart', 'Bar chart');
    await page.getByLabel('Value · row 1', { exact: true }).fill('-12');
    await page.getByLabel('Chart type', { exact: true }).selectOption('design-chart-line');
    await expect(page.locator('[data-zone-id] svg[aria-label^="Line chart"]')).toHaveAttribute('aria-label', /Mon -12/);
    await addElement(page, 'Circle photo frame', 'Circle photo frame');
    await page.getByLabel('Frame shape', { exact: true }).selectOption('arch');
    await page.getByRole('button', { name: 'Browse library', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'portrait.png', exact: true }).click();
    await page.getByLabel('Photo caption', { exact: true }).fill('Welcome');
    await page.getByLabel('Photo vertical framing', { exact: true }).fill('35');
    await expect(page.locator('[data-zone-id] [data-photo-frame="arch"] img')).toHaveCSS('object-position', '50% 35%');
    await addElement(page, 'Featured photo collage', 'Featured photo collage');
    for (const name of ['landscape', 'portrait', 'square']) {
      const i = ['landscape', 'portrait', 'square'].indexOf(name);
      await page.getByRole('button', { name: 'Browse library', exact: true }).nth(i).click();
      await page.getByRole('dialog').getByRole('button', { name: `${name}.png`, exact: true }).click();
      await page.getByLabel(`Photo ${i + 1} caption`, { exact: true }).fill(name);
    }
    await expect(page.locator('[data-zone-id] [data-photo-collage] img')).toHaveCount(3);
    const collage = page.locator('[data-zone-id] [data-photo-collage]');
    const boxes = await collage.locator('[data-photo-index]').evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { w: r.width, h: r.height }; }));
    expect(boxes.every(box => box.w > 30 && box.h > 30)).toBe(true);
    await page.getByRole('combobox', { name: 'Collage layout', exact: true }).selectOption('grid');
    await page.getByRole('button', { name: 'Remove photo 2', exact: true }).click();
    await expect(collage.locator('img')).toHaveCount(2);
    await page.locator('[data-builder-bottom-bar]').getByRole('button', { name: /Undo/ }).click();
    await expect(collage.locator('img')).toHaveCount(3);
    await page.locator('[data-builder-bottom-bar]').getByRole('button', { name: /Redo/ }).click();
    await expect(collage.locator('img')).toHaveCount(2);
    await page.screenshot({ path: testInfo.outputPath('design-elements-editor.png') });
    await page.getByRole('button', { name: /^Save$/ }).click();
    await expect.poll(() => state.saved().zones.length).toBe(preset ? 5 : 4);
    const configs = () => state.saved().zones.map(zone => zone.defaultConfig);
    expect(configs().find(c => c.variant === 'design-table')?.rows).toEqual(expect.arrayContaining([expect.arrayContaining(['Reception'])]));
    expect(configs().find(c => c.variant === 'design-chart-line')?.rows).toEqual(expect.arrayContaining([expect.objectContaining({ value: -12 })]));
    expect(configs().find(c => c.variant === 'photo-frame-circle')).toMatchObject({ frameShape: 'arch', focalY: 35 });
    expect(configs().find(c => c.variant === 'photo-collage-featured')?.photos).toHaveLength(2);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('tab', { name: /^Widgets$/i })).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-zone-id] [data-design-data="table"]')).toContainText('Reception');
    await expect(page.locator('[data-zone-id] [data-photo-frame="arch"] img')).toHaveCSS('object-position', '50% 35%');
    await expect(page.locator('[data-zone-id] [data-photo-collage] img')).toHaveCount(2);
    expect(errors).toEqual([]);
  });
}

test('render all ten additional elements with readable default data and editable photographs', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const zone = (id: string, widgetType: string, config: Record<string, unknown>, x: number, y: number, width: number, height: number): TestZone => ({ id, name: id, widgetType, defaultConfig: config, x, y, width, height, zIndex: 1, sortOrder: 0 });
  const dataZones = [
    zone('table', 'CHART', { variant: 'design-table', heading: 'Visitor services', columns: ['Service', 'Location'], rows: [['Reception', 'Main lobby'], ['Collection', 'Service desk'], ['Returns', 'Service desk']], fontFamily: 'Fraunces, serif' }, 2, 2, 46, 46),
    ...['bar', 'line', 'pie'].map((kind, i) => zone(kind, 'CHART', { variant: `design-chart-${kind}`, heading: `${kind[0].toUpperCase() + kind.slice(1)} chart`, rows: [{ label: 'North', value: 42, color: '#285c52' }, { label: 'South', value: 58, color: '#b86245' }, { label: 'East', value: 35, color: '#c49e55' }, { label: 'West', value: 71, color: '#6b6692' }] }, i === 0 ? 52 : i === 1 ? 2 : 52, i === 0 ? 2 : 52, 46, 46)),
  ];
  await openEditor(page, false, dataZones, 3840);
  await expect(page.locator('[data-template-canvas] [data-design-data]')).toHaveCount(4);
  await expect(page.locator('[data-template-canvas] svg[aria-label^="Pie chart"]')).toBeVisible();
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.locator('[data-template-canvas]').screenshot({ path: testInfo.outputPath('all-data-elements.png') });
  const bounds = await page.locator('[data-template-canvas] [data-design-data]').evaluateAll(nodes => nodes.map(node => ({ w: node.scrollWidth - node.clientWidth, h: node.scrollHeight - node.clientHeight })));
  expect(bounds).toEqual(bounds.map(() => ({ w: 0, h: 0 })));
  const photos = [
    '/templates/signage/hospitality/assets/hospitality-lobby-grand-room-v1.jpg',
    '/templates/signage/retail/assets/retail-endcap-cobalt-sneaker-v1.png',
    '/templates/signage/hospitality/assets/hospitality-lobby-goldenhour-pool-v1.jpg',
    '/templates/signage/fashion/assets/pexels-6263068.jpg',
  ].map((url, i) => ({ url, caption: ['Welcome', 'New arrivals', 'Golden hour', 'The edit'][i], focalX: 50, focalY: 50, zoom: 1 }));
  const photoZones = [
    ...['rounded', 'circle', 'arch'].map((shape, i) => zone(shape, 'IMAGE', { variant: `photo-frame-${shape}`, frameShape: shape, assetUrl: photos[i].url, borderWidth: 0 }, 2 + i * 33, 2, 29, 44)),
    ...['pair', 'featured', 'grid'].map((layout, i) => zone(layout, 'IMAGE_CAROUSEL', { variant: `photo-collage-${layout}`, layout, photos: photos.slice(0, i + 2), spacing: 20 }, 2 + i * 33, 52, 29, 46)),
  ];
  await openEditor(page, false, photoZones, 3840);
  await expect(page.locator('[data-template-canvas] [data-photo-frame]')).toHaveCount(3);
  await expect(page.locator('[data-template-canvas] [data-photo-collage]')).toHaveCount(3);
  await expect.poll(() => page.locator('[data-template-canvas] img').evaluateAll(nodes => nodes.every(node => (node as HTMLImageElement).complete && (node as HTMLImageElement).naturalWidth > 0))).toBe(true);
  await page.locator('[data-template-canvas]').screenshot({ path: testInfo.outputPath('all-photo-elements.png') });
});
