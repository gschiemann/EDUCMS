import { test, expect } from '@playwright/test';

/**
 * EXTERNAL_HTML BOARDS — hide/show a field (CRUSH Wave E, item E6).
 *
 * THE BUG: on a packaged EXTERNAL_HTML board, clearing a text field's
 * override in PropertiesPanel's `ExternalHtmlTextEditor` deletes its
 * `textOverrides` entry — which resurrects the BOARD'S OWN DEFAULT COPY,
 * because the shim has no way to render "nothing" for a field. Operators
 * had no way to actually blank/hide an element.
 *
 * THE FIX: PropertiesPanel now writes a `hidden: true` flag into the SAME
 * per-field `_styles` override map the color/font-size controls already
 * use (`cfg._styles[fieldKey].hidden`). That map rides the existing
 * `textStyles` transport (URL query param on first paint, `educms-overrides`
 * postMessage on live edit) — no new protocol. The packaged-board shim
 * (`inject-shim-v2.cjs`, EDUCMS-SHIM-V7) reads `styles[key].hidden` in its
 * `applyTextAndStyles` and sets `el.style.display = 'none'` (or clears it
 * back to the template's own CSS when the flag is false/absent).
 *
 * WHAT THIS PROVES: loads a REAL packaged board (not a mock), posts the
 * exact `educms-overrides` message PropertiesPanel's live-edit path sends,
 * and asserts the target element's COMPUTED display is actually `none` —
 * not just that an attribute was set. Then reverses the override and
 * asserts the element is visible again (computed display !== 'none').
 * Also proves the SAME override still carries a live text change (hiding
 * doesn't clobber other style/text overrides on the same field) and that
 * the marker is the new V7 (regression guard: a future re-bake that
 * silently drops the `hidden` clause would leave this test red instead of
 * a silent no-op).
 */

const BOARD = '/templates/hs/achievement.html';
const FIELD_KEY = 'school.name';

test.describe('EXTERNAL_HTML boards — hide/show a field (E6)', () => {
  test(`shim carries EDUCMS-SHIM-V7 with a hidden key: ${BOARD}`, async ({ page }) => {
    const res = await page.request.get(BOARD);
    const html = await res.text();
    expect(html, 'board must carry the V7 marker (re-bake did not land)').toContain('EDUCMS-SHIM-V7');
    expect(html, 'applyTextAndStyles must read styles[key].hidden').toMatch(/hasOwnProperty\.call\(s,'hidden'\)/);
  });

  test(`hide then restore a field, verified via computed style: ${BOARD}`, async ({ page }) => {
    test.setTimeout(30_000);
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (/access control|Load failed|Failed to fetch|NetworkError|ipapi|fonts\.googleapis/i.test(e.message)) return;
      pageErrors.push(e.message);
    });

    await page.goto(BOARD, { waitUntil: 'domcontentloaded' });

    const target = page.locator(`[data-field="${FIELD_KEY}"]`).first();
    await expect(target, `${BOARD}: ${FIELD_KEY} not found`).toBeVisible({ timeout: 10_000 });

    // Baseline: visible, board's own default copy showing.
    await expect(target).not.toHaveCSS('display', 'none');
    const defaultText = (await target.textContent())?.trim();
    expect(defaultText, 'board should render its own default copy before any override').toBeTruthy();

    // 1. HIDE — exact message shape PropertiesPanel's live-edit path posts
    //    (WidgetRenderer's ExternalHtmlWidget forwards cfg.textStyles as
    //    `textStyles` on `educms-overrides`).
    await page.evaluate(
      ({ key }) => {
        window.postMessage(
          { type: 'educms-overrides', text: {}, textStyles: { [key]: { hidden: true } }, img: {} },
          '*',
        );
      },
      { key: FIELD_KEY },
    );
    await expect
      .poll(() => target.evaluate((el) => getComputedStyle(el).display), {
        message: `${BOARD}: ${FIELD_KEY} did not receive display:none after hidden:true`,
        timeout: 5_000,
      })
      .toBe('none');

    // 2. RESTORE — same field, hidden:false. Must reverse cleanly AND
    //    prove the un-hide doesn't require deleting the whole override —
    //    combine it with a live text change to show both apply in one pass.
    await page.evaluate(
      ({ key }) => {
        window.postMessage(
          {
            type: 'educms-overrides',
            text: { [key]: 'Restored Copy' },
            textStyles: { [key]: { hidden: false } },
            img: {},
          },
          '*',
        );
      },
      { key: FIELD_KEY },
    );
    await expect
      .poll(() => target.evaluate((el) => getComputedStyle(el).display), {
        message: `${BOARD}: ${FIELD_KEY} did not restore after hidden:false`,
        timeout: 5_000,
      })
      .not.toBe('none');
    await expect(target).toHaveText('Restored Copy');

    expect(pageErrors, `${BOARD}: uncaught pageerror(s): ${pageErrors.slice(0, 3).join(' || ')}`).toEqual([]);
  });

  test(`hiding one field does not affect a sibling field: ${BOARD}`, async ({ page }) => {
    test.setTimeout(30_000);
    await page.goto(BOARD, { waitUntil: 'domcontentloaded' });

    const hidden = page.locator(`[data-field="${FIELD_KEY}"]`).first();
    const sibling = page.locator('[data-field="school.sub"]').first();
    await expect(hidden).toBeVisible({ timeout: 10_000 });
    await expect(sibling).toBeVisible({ timeout: 10_000 });

    await page.evaluate(
      ({ key }) => {
        window.postMessage(
          { type: 'educms-overrides', text: {}, textStyles: { [key]: { hidden: true } }, img: {} },
          '*',
        );
      },
      { key: FIELD_KEY },
    );
    await expect
      .poll(() => hidden.evaluate((el) => getComputedStyle(el).display))
      .toBe('none');
    // Sibling must be untouched.
    await expect(sibling).not.toHaveCSS('display', 'none');
  });
});
