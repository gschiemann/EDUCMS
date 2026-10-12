import { expect, test } from '@playwright/test';

test.use({ timezoneId: 'UTC' });

// Scroll-size checks alone missed metadata crossing its row's border. Check
// rendered text against the containing row and the other fields instead.
for (const variant of [1, 3]) for (const portrait of [false, true]) {
  test(`elementary V${variant} contains full rows and saved edits (${portrait ? 'portrait' : 'landscape'})`, async ({ page }) => {
    await page.setViewportSize(portrait ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 });
    await page.clock.install({ time: new Date('2026-10-12T08:10:00Z') });
    const url = `/templates/school/elem-schedule-v${variant}.html${portrait ? '?o=portrait' : ''}`;
    const checkLayout = async () => {
      const result = await page.locator('.sched').evaluate(schedule => {
        const issues: string[] = [];
        const stage = document.querySelector<HTMLElement>('.stage')!;
        const scale = stage.getBoundingClientRect().width / stage.offsetWidth;
        const tolerance = scale * 2;
        const rows = [...schedule.querySelectorAll('.row')];
        for (const row of rows) {
          const box = row.getBoundingClientRect();
          const textRects: { key: string; rect: DOMRect }[] = [];
          for (const node of row.querySelectorAll<HTMLElement>('[data-field],.stat')) {
            const key = node.dataset.field || 'status';
            if (getComputedStyle(node).display === 'none') {
              if (node.hasAttribute('data-field')) issues.push(`${key} hidden`);
              continue;
            }
            if (node.dataset.field && parseFloat(getComputedStyle(node).fontSize) < 60) issues.push(`${key} below 60px`);
            const range = document.createRange();
            range.selectNodeContents(node);
            for (const rect of range.getClientRects()) {
              if (rect.left < box.left - tolerance || rect.right > box.right + tolerance || rect.top < box.top - tolerance || rect.bottom > box.bottom + tolerance) issues.push(`${key} outside row`);
              textRects.push({ key, rect });
            }
          }
          for (let a = 0; a < textRects.length; a++) for (let b = a + 1; b < textRects.length; b++) {
            const left = textRects[a], right = textRects[b];
            if (left.key === right.key) continue;
            if (Math.min(left.rect.right, right.rect.right) - Math.max(left.rect.left, right.rect.left) > tolerance && Math.min(left.rect.bottom, right.rect.bottom) - Math.max(left.rect.top, right.rect.top) > tolerance) issues.push(`${left.key} overlaps ${right.key}`);
          }
        }
        for (const tile of document.querySelectorAll('.tile')) {
          const box = tile.getBoundingClientRect();
          for (const node of tile.querySelectorAll('[data-field]')) {
            const range = document.createRange(); range.selectNodeContents(node);
            for (const rect of range.getClientRects()) if (rect.left < box.left - tolerance || rect.right > box.right + tolerance || rect.top < box.top - tolerance || rect.bottom > box.bottom + tolerance) issues.push(`${node.getAttribute('data-field')} outside tile`);
          }
        }
        return { count: rows.length, issues };
      });
      expect(result.count).toBe(6);
      expect(result.issues).toEqual([]);
    };
    await page.goto(url);
    await page.evaluate(() => document.fonts.ready);
    await page.clock.runFor(600);
    await checkLayout();
    await expect(page.locator('.row.now .stat')).toHaveText(/Now$/);
    const text = { 'p.0.name': 'Homeroom & Morning Meeting', 'p.0.meta': 'Room 12 · Ms. Alex Diaz' };
    const saved = Buffer.from(JSON.stringify(text)).toString('base64url');
    await page.goto(`${url}${portrait ? '&' : '?'}text=${saved}`);
    await page.evaluate(() => document.fonts.ready);
    await page.clock.runFor(600);
    await expect(page.locator('[data-field="p.0.meta"]')).toHaveText(text['p.0.meta']);
    await checkLayout();
    // Existing click-to-edit remains available on the repositioned metadata.
    await page.evaluate(() => {
      addEventListener('message', e => { if (e.data?.type === 'educms-field-click') (window as unknown as { selectedField: string }).selectedField = e.data.key; });
      postMessage({ type: 'educms-edit-mode', on: true }, '*');
    });
    await page.locator('[data-field="p.0.meta"]').click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { selectedField: string }).selectedField)).toBe('p.0.meta');
  });
}
