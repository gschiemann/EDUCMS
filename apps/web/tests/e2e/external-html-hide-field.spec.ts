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
 * the baked shim still implements the `hidden` clause (regression guard: a
 * re-bake that silently drops it leaves this red instead of a silent no-op).
 *
 * 2026-08-21 — this spec used to pin the exact marker `EDUCMS-SHIM-V7` and
 * two hard-coded field keys from the board of the day. Both went stale the
 * moment the board was redesigned and the shim moved to V8, turning a
 * healthy board into a red build. The contract is "current shim, >= the
 * version that introduced `hidden`, and a real field on this board" — so
 * the version is compared numerically and the fields are discovered.
 */

const BOARD = '/templates/hs/achievement.html';

/** The first two visible, independent text fields on the board — discovered
 *  rather than hard-coded so a redesign changes the copy, not the gate. */
async function twoVisibleFields(page: import('@playwright/test').Page): Promise<[string, string]> {
  const keys = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll('[data-field]')) {
      const key = el.getAttribute('data-field') || '';
      if (!key || key.startsWith('theme.') || key.startsWith('clock.') || key.startsWith('video.')) continue;
      if (!(el.textContent || '').trim()) continue;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (cs.display === 'none' || cs.visibility === 'hidden' || r.width < 2 || r.height < 2) continue;
      // Skip a field that contains another — hiding a parent hides the child,
      // which would make the sibling-independence assertion meaningless.
      if (out.some((k) => {
        const prev = document.querySelector(`[data-field="${k}"]`);
        return prev && (prev.contains(el) || el.contains(prev));
      })) continue;
      out.push(key);
      if (out.length === 2) break;
    }
    return out;
  });
  expect(keys.length, `${BOARD}: expected two independent visible text fields`).toBe(2);
  return [keys[0], keys[1]];
}

test.describe('EXTERNAL_HTML boards — hide/show a field (E6)', () => {
  test(`shim carries the hidden key: ${BOARD}`, async ({ page }) => {
    const res = await page.request.get(BOARD);
    const html = await res.text();
    const marker = html.match(/EDUCMS-SHIM-V(\d+)/);
    expect(marker, 'board must carry a baked EduCMS shim (re-bake did not land)').toBeTruthy();
    expect(Number(marker![1]), 'shim must be at least V7 — the version that introduced the hidden clause')
      .toBeGreaterThanOrEqual(7);
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

    const [FIELD_KEY] = await twoVisibleFields(page);
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

    const [FIELD_KEY, SIBLING_KEY] = await twoVisibleFields(page);
    const hidden = page.locator(`[data-field="${FIELD_KEY}"]`).first();
    const sibling = page.locator(`[data-field="${SIBLING_KEY}"]`).first();
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
