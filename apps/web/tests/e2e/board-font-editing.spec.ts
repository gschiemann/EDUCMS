import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const fontFixture = fs.readFileSync(path.resolve(__dirname,
  '../../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2'));

for (const board of [
  { url: '/templates/school/ms-lobby-v1.html', key: 'hero.title', holiday: false },
  { url: '/templates/signage/menus-pos/02-wine-list.html', key: 'board.title', holiday: false },
  { url: '/holiday-templates/es-halloween-storybook.html', key: 'school.name', holiday: true },
]) {
  test(`selected fonts load inside the board document: ${board.url}`, async ({ page, baseURL }) => {
    // Use a bundled face under the selected family name to verify resource
    // loading deterministically. Visual review uses each real authored face.
    await page.route('https://fonts.googleapis.com/**', route => route.fulfill({
      contentType: 'text/css', headers: { 'access-control-allow-origin': '*' },
      body: '@font-face{font-family:Pacifico;src:url("https://fonts.gstatic.com/editor-font.woff2") format("woff2");font-display:swap}',
    }));
    await page.route('https://fonts.gstatic.com/**', route => route.fulfill({
      contentType: 'font/woff2', headers: { 'access-control-allow-origin': '*' }, body: fontFixture,
    }));
    await page.route('**/font-test-shell', route => route.fulfill({ contentType: 'text/html',
      body: `<iframe title="Font test" sandbox="allow-scripts" src="${board.url}" style="width:1280px;height:720px;border:0"></iframe>` }));
    await page.goto(`${baseURL}/font-test-shell`);
    const frame = page.getByTitle('Font test').contentFrame();
    const field = frame.locator(`[data-field="${board.key}"]`);
    await expect(field).toBeVisible();
    await page.evaluate(({ key, holiday }) => {
      const win = document.querySelector('iframe')!.contentWindow!;
      const styles = { [key]: { fontFamily: 'Pacifico', fontSize: 72 } };
      win.postMessage(holiday ? { type: 'template-apply-styles', styles } :
        { type: 'educms-overrides', textStyles: styles }, '*');
    }, board);
    await expect(field).toHaveCSS('font-family', /Pacifico/);
    await expect(field).toHaveCSS('font-size', '72px');
    await expect.poll(() => field.evaluate(() => Array.from(document.fonts)
      .some(face => face.family === 'Pacifico' && face.status === 'loaded'))).toBe(true);
    await expect(frame.locator('link[data-edu-board-font="Pacifico"],link[data-edu-holiday-font="Pacifico"]')).toHaveCount(1);
  });
}

for (const url of ['/templates/school/ms-lobby-v1.html', '/templates/signage/menus-pos/02-wine-list.html']) {
  test(`brand headline fonts load inside the board document: ${url}`, async ({ page, baseURL }) => {
    await page.route('https://fonts.googleapis.com/**', route => route.fulfill({
      contentType: 'text/css', headers: { 'access-control-allow-origin': '*' },
      body: '@font-face{font-family:Pacifico;src:url("https://fonts.gstatic.com/editor-font.woff2") format("woff2");font-display:swap}',
    }));
    await page.route('https://fonts.gstatic.com/**', route => route.fulfill({
      contentType: 'font/woff2', headers: { 'access-control-allow-origin': '*' }, body: fontFixture,
    }));
    await page.route('**/brand-font-shell', route => route.fulfill({ contentType: 'text/html',
      body: `<iframe title="Brand font test" sandbox="allow-scripts" src="${url}"></iframe>` }));
    await page.goto(`${baseURL}/brand-font-shell`);
    const frame = page.getByTitle('Brand font test').contentFrame();
    await expect(frame.locator('#stage')).toBeVisible();
    await page.evaluate(() => document.querySelector('iframe')!.contentWindow!.postMessage({
      type: 'educms-overrides', brand: { fontDisplay: 'Pacifico' },
    }, '*'));
    await expect(frame.locator('link[data-edu-board-font="Pacifico"]')).toHaveCount(1);
    await expect.poll(() => frame.locator('#stage').evaluate(() => Array.from(document.fonts)
      .some(face => face.family === 'Pacifico' && face.status === 'loaded'))).toBe(true);
    await expect.poll(() => frame.locator('#stage').evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--f-display'))).toContain('Pacifico');
  });
}
