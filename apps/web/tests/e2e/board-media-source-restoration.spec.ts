import { test, expect } from '@playwright/test';

const board = '/templates/school/commencement-guest-guide.html';
const key = 'ceremony.photo';
const replacement = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="coral"/></svg>';
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
for (const saved of [false, true]) {
  test(`Undo restores authored photo source and crop ${saved ? 'after saved reload' : 'on first edit'}`, async ({ page, baseURL }) => {
    await page.route(/^https?:\/\//, route => new URL(route.request().url()).origin === new URL(baseURL!).origin ? route.continue() : route.abort());
    const url = board + (saved ? `?img=${encode({ [key]: replacement })}&mediaStyles=${encode({ [key]: { fit: 'contain', rotation: 35 } })}` : '');
    await page.route('**/source-restore-shell', route => route.fulfill({ contentType: 'text/html',
      body: `<iframe title="Media restoration" sandbox="allow-scripts" src="${url}" style="width:1280px;height:720px;border:0"></iframe>` }));
    await page.goto(`${baseURL}/source-restore-shell`);
    const frame = page.getByTitle('Media restoration').contentFrame();
    const slot = frame.locator(`[data-imgslot="${key}"]`);
    await expect(slot).toBeVisible();
    const send = (payload: Record<string, unknown>) => page.evaluate(payload => document.querySelector('iframe')!.contentWindow!.postMessage({ type: 'educms-overrides', ...payload }, '*'), payload);
    if (!saved) await send({ img: { [key]: replacement }, mediaStyles: { [key]: { fit: 'contain', rotation: 35 } } });
    await expect(slot).toHaveCSS('background-size', 'contain');
    await expect.poll(() => slot.evaluate(el => el.style.transform)).toContain('rotate(35deg)');
    await send({ img: {}, mediaStyles: {} });
    await expect(slot).toHaveCSS('background-size', 'cover');
    await expect(slot).toHaveCSS('background-position', '50% 20%');
    await expect.poll(() => slot.evaluate(el => getComputedStyle(el).backgroundImage)).toContain('/templates/school/assets/campuspulse-corridor.jpg');
    await expect.poll(() => slot.evaluate(el => el.style.transform)).toBe('');
    // Keep the default crop after the deferred legacy painter reapplication.
    await page.waitForTimeout(100);
    await expect(slot).toHaveCSS('background-position', '50% 20%');
  });
}
