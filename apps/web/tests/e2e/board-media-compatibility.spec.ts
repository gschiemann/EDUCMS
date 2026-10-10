import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../../public/templates');
function boards(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (entry.name.startsWith('_')) return [];
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? boards(file) : entry.name.endsWith('.html') ? [file] : [];
  });
}

// Discover the full corpus so new template families cannot silently miss the
// media companion. Run each real board with its original apply/POS/kiosk shim.
for (const file of boards(root)) {
  const url = `/templates/${path.relative(root, file).split(path.sep).join('/')}`;
  test(`packaged media controls load and apply: ${url}`, async ({ page, baseURL }) => {
    await page.route(/^https?:\/\//, route => new URL(route.request().url()).origin === new URL(baseURL!).origin ? route.continue() : route.abort());
    await page.addInitScript(() => {
      const state = window as unknown as { boardMediaSlots?: { key: string; kind: string }[] };
      addEventListener('message', event => {
        // Fitness's source runtime also announces this type without slots.
        // Only the editor capability payload describes editable media.
        if (event.data?.type === 'educms-media-ready' && Array.isArray(event.data.slots)) state.boardMediaSlots = event.data.slots;
      });
    });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => page.evaluate(() => (window as unknown as { boardMediaSlots?: unknown }).boardMediaSlots)).toBeDefined();
    const key = await page.evaluate(() => (window as unknown as { boardMediaSlots: { key: string }[] }).boardMediaSlots[0]?.key);
    if (!key) return; // A board with no media still advertises its empty capability list.
    await page.evaluate(key => window.postMessage({ type: 'educms-overrides', mediaStyles: { [key]: { rotation: 35, fit: 'contain' } } }, '*'), key);
    await expect.poll(() => page.evaluate(key => {
      const nodes = document.querySelectorAll<HTMLElement>('[data-imgslot],[data-posterslot],[data-img],[data-widget="image-slot"],[data-videoslot]');
      const slot = Array.from(nodes).find(el => (el.getAttribute('data-videoslot') || el.getAttribute('data-imgslot') || el.getAttribute('data-posterslot') || el.getAttribute('data-slot') || el.getAttribute('data-img')) === key);
      if (!slot) return null;
      const image = slot.matches('img,video') ? slot : slot.querySelector('img,video');
      return { rotated: slot.style.transform.includes('rotate(35deg)'), fit: (image ? getComputedStyle(image).objectFit : getComputedStyle(slot).backgroundSize).split(',')[0].trim() };
    }, key)).toEqual({ rotated: true, fit: 'contain' });
  });
}
