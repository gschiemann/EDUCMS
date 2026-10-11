import { test, expect } from '@playwright/test';

// Removing all but one row used to erase the inferred group. These real
// sandboxed boards exercise restoration of authored rows and saved edits.
for (const board of [
  { url: '/templates/signage/clinic/02-services-booking-guide.html', group: 'service', field: 'name', count: 3 },
  { url: '/templates/signage/corporate/09-events-week.html', group: 'e', field: 'title', count: 5 },
]) for (const portrait of [false, true]) {
  test(`rows restore after shrinking to one: ${board.url} ${portrait ? 'portrait' : 'landscape'}`, async ({ page, baseURL }) => {
    await page.route(/^https?:\/\//, route => new URL(route.request().url()).origin === new URL(baseURL!).origin ? route.continue() : route.abort());
    const encoded = Buffer.from(JSON.stringify({ [board.group]: 1 })).toString('base64url');
    const url = `${board.url}?repeat=${encoded}${portrait ? '&o=portrait' : ''}`;
    await page.addInitScript(() => {
      addEventListener('message', e => { if (e.data?.type === 'educms-field-click') (window as any).lastField = e.data.key; });
    });
    await page.route('**/repeat-shell', route => route.fulfill({ contentType: 'text/html',
      body: `<iframe title="Repeating board" sandbox="allow-scripts" src="${url}" style="width:${portrait ? 720 : 1280}px;height:${portrait ? 1280 : 720}px;border:0"></iframe>` }));
    await page.goto(`${baseURL}/repeat-shell`);
    const frame = page.getByTitle('Repeating board').contentFrame();
    const names = frame.locator(`[data-field^="${board.group}."][data-field$=".${board.field}"]`);
    await expect(names).toHaveCount(1);
    const send = async (count: number, text: Record<string, string> = {}) => page.evaluate(({ group, count, text }) => {
      document.querySelector('iframe')!.contentWindow!.postMessage({ type: 'educms-overrides', repeat: { [group]: count }, text }, '*');
    }, { group: board.group, count, text });
    await page.evaluate(() => document.querySelector('iframe')!.contentWindow!.postMessage({ type: 'educms-edit-mode', on: true }, '*'));
    await send(board.count);
    await expect(names).toHaveCount(board.count);
    const originals = await names.allTextContents();
    expect(new Set(originals).size).toBe(board.count);
    await send(1);
    await expect(names).toHaveCount(1);
    // A repeated one-row update must retain its repeat layout.
    await send(1);
    await expect(frame.locator(`[data-educms-repeat-group="${board.group}"]`).first().locator('..')).toHaveAttribute('data-educms-repeat', '');
    const key = `${board.group}.${board.count - 1}.${board.field}`;
    await send(board.count, { [key]: 'Saved restored row' });
    await expect(names).toHaveCount(board.count);
    await expect(frame.locator(`[data-field="${key}"]`)).toHaveText('Saved restored row');
    expect((await names.allTextContents()).slice(0, -1)).toEqual(originals.slice(0, -1));
    await expect(frame.locator(`[data-educms-repeat-group="${board.group}"]`).first().locator('..')).not.toHaveAttribute('data-educms-repeat', '');
    await frame.locator(`[data-field="${key}"]`).click();
    await expect.poll(() => page.evaluate(() => (window as any).lastField)).toBe(key);
  });
}
