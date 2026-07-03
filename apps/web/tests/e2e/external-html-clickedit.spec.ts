import { test, expect, type Page } from '@playwright/test';

/**
 * EXTERNAL_HTML CLICK-TO-EDIT SHIM CONTRACT — verifies the hot-zone fix
 * for the HS / signage / menu boards.
 *
 * THE BUG: every EXTERNAL_HTML board (HS school signage, the signage
 * verticals, the QSR/menu boards) shipped with an apply-only shim that
 * NEVER reported clicks — so clicking an element in the builder did
 * nothing. Only the one hand-built Domino's board posted the
 * `educms-field-click` message the PropertiesPanel listens for. Operator:
 * "none of the templates can be edited."
 *
 * THE FIX (this run): the shim injector (inject-shim-v2.cjs) was upgraded
 * V4→V5 to bundle the click-to-edit protocol, and a standalone additive
 * click shim (inject-click-shim.cjs) was dropped onto the menu boards
 * (whose hand-crafted V5 carries `applyMenu` and must not be clobbered).
 *
 * WHAT THIS PROVES: it loads each REAL board top-level (so the shim's
 * `parent.postMessage(...)` posts to the test window), arms edit mode the
 * exact way PropertiesPanel does (`educms-edit-mode {on:true}`), clicks a
 * real editable element, and asserts the shim posts
 * `educms-field-click {key,kind}` with the clicked element's own key.
 *
 * That `educms-field-click` is precisely what the PropertiesPanel's
 * EXTERNAL_HTML handler scrolls/focuses on (the proven Domino's path), so
 * a board that posts it has working hot-zones. Runs in chromium + webkit.
 *
 * Representatives span BOTH fixed mechanisms:
 *   - hs/* + signage/<non-menu>/* + fitness  → injector V5 (apply+click)
 *   - signage/{qsr,menus-pos,bar}/*          → menu-V5 + additive click
 */

const BOARDS = [
  '/templates/hs/varsity.html',
  // Flagship rebuilds + React→EXTERNAL_HTML conversions (2026-06-08 designer batch).
  '/templates/hs/broadcast.html',
  '/templates/hs/yearbook.html',
  '/templates/hs/achievement.html',
  '/templates/hs/morning-news.html',
  '/templates/hs/bell-schedule.html',
  '/templates/hs/caf-today.html',
  '/templates/hs/hall-bulletin.html',
  '/templates/signage/corporate/01-lobby-welcome-flagship.html',
  '/templates/signage/corporate/03-kpi-dashboard.html',
  '/templates/signage/healthcare/01-waiting-room-flagship.html',
  '/templates/signage/healthcare/02-physician-directory.html',
  // 2026-07-01 (Day-2 launch sprint) — HOSPITALITY and GYM had ZERO clickedit
  // coverage despite shipping as EXTERNAL_HTML costumes in the 2026-06-27
  // beta. Verified live (chromium+webkit) that both already carry a working
  // V6 shim + data-field/data-imgslot hot zones; adding them here is the CI
  // gate so a future redesign that forgets to re-run inject-shim-v2.cjs
  // (the exact 2026-06-07 regression class) fails the build instead of
  // silently shipping an un-editable board.
  '/templates/signage/hospitality/01-lobby-welcome-flagship.html',
  '/templates/signage/hospitality/02-concierge-board.html',
  '/templates/signage/gym/01-floor-board-flagship.html',
  '/templates/signage/gym/02-leaderboard.html',
  // New-member welcome boards (2026-07-02 approved gym-welcome batch) — pixel-
  // faithful ports; CI gate so a future redesign that forgets to re-run
  // inject-shim-v2.cjs fails the build instead of shipping un-editable.
  '/templates/signage/gym/03-welcome-poster.html',
  '/templates/signage/gym/04-welcome-split-duo.html',
  '/templates/signage/gym/05-welcome-locker-room.html',
  '/templates/signage/qsr/01-drive-thru-flagship.html',     // menu-V5 + additive click
  '/templates/signage/menus-pos/01-fullservice-menu.html',  // menu-V5 + additive click
  '/templates/signage/bar/01-tap-list-flagship.html',       // menu-V5 + additive click
  '/templates/fitness/01-stadium.html',
];

// Record every message the board posts to the parent window (top-level →
// parent === window, so the shim's posts land here).
async function captureMessages(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__msgs = [];
    window.addEventListener('message', (e) => {
      const d = e.data;
      if (d && typeof d === 'object' && typeof (d as { type?: string }).type === 'string') {
        (window as unknown as { __msgs: unknown[] }).__msgs.push(d);
      }
    });
  });
}

test.describe('EXTERNAL_HTML boards report clicks (hot-zones)', () => {
  for (const board of BOARDS) {
    test(`click-to-edit works: ${board}`, async ({ page }) => {
      test.setTimeout(45_000);
      const pageErrors: string[] = [];
      page.on('pageerror', (e) => {
        if (/access control|Load failed|Failed to fetch|NetworkError|ipapi|fonts\.googleapis/i.test(e.message)) return;
        pageErrors.push(e.message);
      });

      await captureMessages(page);
      await page.goto(board, { waitUntil: 'domcontentloaded' });

      // 1. The shim announces itself on load.
      await expect
        .poll(() => page.evaluate(() => (window as any).__msgs.some((m: any) => m.type === 'educms-ready')),
          { message: `${board}: shim never posted educms-ready (no click-to-edit shim loaded)`, timeout: 15_000 })
        .toBe(true);

      // 2. Arm edit mode exactly like PropertiesPanel does.
      await page.evaluate(() => window.postMessage({ type: 'educms-edit-mode', on: true }, '*'));

      // 3. Find the first REAL editable element (skip the hidden theme.* /
      //    brand-token block + the hidden field manifest).
      const target = page.locator(
        '[data-field]:not([data-field^="theme."]):visible, [data-imgslot]:visible, [data-action]:visible',
      ).first();
      await expect(target, `${board}: no visible editable element to click`).toBeVisible({ timeout: 10_000 });
      const expectedKey = await target.evaluate((el) =>
        el.getAttribute('data-action') || el.getAttribute('data-field') ||
        el.getAttribute('data-imgslot') || el.getAttribute('data-slot') || el.getAttribute('data-img') || '');
      // armEdit() runs async after the edit-mode message; on animation-heavy
      // boards the busy main thread defers it. Poll until THIS element is
      // actually armed before clicking (no fixed sleep → no flake, and a
      // genuine never-arms bug still times out here).
      await expect
        .poll(() => target.evaluate((el) => (el as any).__veArmed === true),
          { message: `${board}: armEdit never armed the target`, timeout: 8_000 })
        .toBe(true);
      await target.click({ force: true });

      // 4. The shim must have posted educms-field-click for THAT element —
      //    the message PropertiesPanel turns into a panel jump. parent.post
      //    Message is ASYNC (delivered on a later task), so POLL for it
      //    rather than reading once (the read-before-delivery race).
      await expect
        .poll(() => page.evaluate(() =>
          ((window as any).__msgs.filter((m: any) => m.type === 'educms-field-click').slice(-1)[0] || {}).key ?? null),
          { message: `${board}: clicking an element did NOT post educms-field-click (hot-zone dead)`, timeout: 5_000 })
        .toBe(expectedKey);
      const click = await page.evaluate(() =>
        (window as any).__msgs.filter((m: any) => m.type === 'educms-field-click').slice(-1)[0] || null,
      );
      if (!click) {
        const diag = await page.evaluate((k) => {
          const el = document.querySelector(`[data-field="${k}"]`) as HTMLElement | null;
          const r = el?.getBoundingClientRect();
          const cx = r ? r.left + r.width / 2 : 0, cy = r ? r.top + r.height / 2 : 0;
          const topEl = r ? document.elementFromPoint(cx, cy) : null;
          return {
            armedCount: document.querySelectorAll('[data-field]').length,
            anyArmed: !!document.querySelector('[data-field]') && (document.querySelector('[data-field]') as any).__veArmed === true,
            targetArmed: el ? (el as any).__veArmed === true : 'no-el',
            box: r ? { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left), y: Math.round(r.top) } : null,
            topElIsTargetOrChild: !!(topEl && el && (el === topEl || el.contains(topEl) || topEl.contains(el))),
            topElTag: topEl ? topEl.tagName + (topEl.getAttribute('data-field') ? `[data-field=${topEl.getAttribute('data-field')}]` : '') : null,
            msgs: (window as any).__msgs.map((m: any) => m.type),
          };
        }, expectedKey);
        // eslint-disable-next-line no-console
        console.log(`\n[DIAG ${board}] key=${expectedKey}`, JSON.stringify(diag));
      }
      expect(click, `${board}: clicking an element did NOT post educms-field-click (hot-zone dead)`).not.toBeNull();
      expect(click.key, `${board}: educms-field-click reported the wrong key`).toBe(expectedKey);
      expect(['text', 'img', 'action'], `${board}: bad kind`).toContain(click.kind);

      expect(pageErrors, `${board}: uncaught pageerror(s): ${pageErrors.slice(0, 3).join(' || ')}`).toEqual([]);
    });
  }
});
