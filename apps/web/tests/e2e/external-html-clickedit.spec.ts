import { test, expect, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';

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
 * Representatives span ALL THREE shim mechanisms:
 *   - hs/* + school/* + signage/<non-menu>/* + fitness → injector V13 (apply+click)
 *   - signage/{qsr,menus-pos,bar}/*                    → menu-V5 + additive click
 *   - kiosk/*                                          → EXTERNAL /templates/kiosk/_edit-shim.js
 *
 * 2026-09-11 COVERAGE WIDENING. This list held 23 of 250 boards (9.2%) and —
 * far worse — ZERO from `school/` (40 boards) and ZERO from `kiosk/` (19), so
 * the entire external-`_edit-shim.js` mechanism had no behavioural test at all.
 * That is the same blind spot as the CLAUDE.md shell sweep, which hardcodes
 * `find hs signage fitness` and cannot see those two directories either. A
 * hardcoded list that nobody notices is short is exactly how the 2026-06-07
 * "none of the templates can be edited" fire got to ship.
 *
 * Two things changed. (1) The list below now covers every top-level directory
 * and every signage sub-vertical. (2) The `every board family has a
 * representative` test at the bottom DISCOVERS directories off disk and fails
 * if any of them is unrepresented here — so a new vertical cannot be silently
 * uncovered; it breaks this spec until someone adds a board to the list.
 *
 * The static counterpart is `apps/web/tools/check-board-editability.cjs`,
 * which sweeps all 250 boards for shim presence/version/hot-zones on every CI
 * run. This spec is the behavioural half: it proves the shim actually POSTS.
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

  // ── 2026-09-11: the nine signage sub-verticals that had NO representative.
  // Each ships as EXTERNAL_HTML on the injector shim exactly like corporate/
  // healthcare above; without a board here a redesign of any of them could drop
  // click-to-edit and no gate would notice.
  '/templates/signage/church/01-welcome-flagship.html',
  '/templates/signage/clinic/01-campaign-flagship.html',
  '/templates/signage/fashion/01-lookbook-flagship.html',
  '/templates/signage/museum/01-today-flagship.html',
  '/templates/signage/office/01-room-grid-flagship.html',
  '/templates/signage/real-estate/01-availability-flagship.html',
  '/templates/signage/retail/01-storefront-gallery-threshold.html',
  '/templates/signage/veterinary/01-waiting-room-flagship.html',
  '/templates/signage/worship/giving-v1-measured-future.html',

  // ── 2026-09-11: school/ — 40 boards, previously ZERO covered, and invisible
  // to the CLAUDE.md sweep too. One representative per board FAMILY (bell /
  // lunch / news / schedule / wayfinder / lobby) across BOTH the elementary and
  // middle-school lines, plus the nested campus-pulse/ set.
  '/templates/school/elem-bell-sun-clock.html',
  '/templates/school/elem-lunch-v1.html',
  '/templates/school/elem-news-storybook.html',
  '/templates/school/elem-schedule-v1.html',
  '/templates/school/elem-wayfinder-mascot-signpost.html',
  '/templates/school/ms-bell-rotation-radar.html',
  '/templates/school/ms-lobby-v1.html',
  '/templates/school/ms-lunch-campus-lineup.html',
  '/templates/school/ms-news-studio-switcher.html',
  '/templates/school/campus-pulse/01-campus-magazine.html',

  // ── 2026-09-11: kiosk/ — 19 boards on the THIRD shim mechanism (an external
  // <script src="/templates/kiosk/_edit-shim.js">, currently V11), which had no
  // behavioural coverage whatsoever. This is the mechanism a grep cannot verify
  // at all: every kiosk board's markup greps clean even if that .js is deleted,
  // because the reference is all the grep can see. These tests actually load it.
  '/templates/kiosk/school.html',
  '/templates/kiosk/qsr.html',
  '/templates/kiosk/museum-quest.html',
  '/templates/kiosk/office-room-panel.html',
  '/templates/kiosk/real-estate-resident.html',
  '/templates/kiosk/gym-workout.html',
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

      // 3. Pick an editable element whose CENTRE actually hit-tests onto an
      //    armed element, and work out which key the shim will report for it.
      //
      // 2026-08-04 — this used to be `.first()` + `expectedKey = <its own
      // attr>`, which silently assumed "the first matching element is the one
      // that receives the click." That broke when the hospitality lobby board
      // was redesigned (2026-07-30) and gained a full-bleed
      // `data-imgslot="board.bg"` background layer: it sorts FIRST in the
      // locator, but Playwright clicks an element's CENTRE, and that centre is
      // covered by the hero copy painted on top of it (they are SIBLINGS, not
      // ancestor/descendant — so the background is not even in the event
      // path). The shim correctly reported `hero.lede`; the test demanded
      // `board.bg` and called a perfectly working board "hot-zone dead".
      //
      // 2026-09-11 — widening the list from 23 to 48 boards proved that fix
      // was only half done, in two separate ways. Both are modelling errors in
      // THIS FILE; all three boards that exposed them are perfectly editable by
      // hand. Evidence per board is in the commit message.
      //
      //   (a) WRONG END OF THE CHAIN. The old model took the OUTERMOST armed
      //       element in the event path. The shim does the opposite: every
      //       armed element's capture listener opens with
      //         var _n = ev.target.closest('[data-field],…,[data-posterslot]');
      //         if (_n && _n !== el) return;
      //       so each handler BAILS unless it is itself that `closest()` — i.e.
      //       the INNERMOST armed ancestor of the real event target is the one
      //       that reports. The 23 old boards never had two armed elements
      //       stacked at the click point, so picking either end looked correct.
      //       school/campus-pulse/01-campus-magazine.html has exactly that
      //       nesting (a `school.initials` SPAN inside a `school.logo` DIV):
      //       the shim reported `school.initials`, the model demanded
      //       `school.logo`.
      //
      //   (b) THE SIBLING-OVERLAY FALLBACK RE-CREATED THE 08-04 BUG. When the
      //       resolved chain came back EMPTY the model fell back to the
      //       locator's own key — the one element we know cannot receive the
      //       click. signage/worship/giving-v1-measured-future.html
      //       (`campaign.art`, 693×720) and school/elem-news-storybook.html
      //       (`board.background`, full-bleed 1280×720) both have an unarmed
      //       sibling painted over their centre, so NOTHING posts on that
      //       click and nothing ever could.
      //
      // So: model the shim exactly, and choose a target that the shim can
      // actually answer for. A board where NO editable element is reachable
      // still fails below — that is the genuinely hot-zone-dead case, and it
      // is what this spec exists to catch.
      const HOT = '[data-field]:not([data-field^="theme."]), [data-imgslot], [data-action]';
      const picked = await page.evaluate(
        async ({ hot }) => {
          // The exact selector the shim's `closest()` guard uses.
          const SEL = '[data-field],[data-mediafield],[data-imgslot],[data-img],[data-slot],[data-action],[data-videoslot],[data-posterslot]';
          // The shim's own key precedence (armEdit, then armMediaEdit).
          const keyOf = (n: Element): string =>
            n.getAttribute('data-action') || n.getAttribute('data-mediafield') ||
            n.getAttribute('data-field') || n.getAttribute('data-imgslot') ||
            n.getAttribute('data-videoslot') || n.getAttribute('data-posterslot') ||
            n.getAttribute('data-slot') || n.getAttribute('data-img') || '';
          // armEdit() sets __veArmed; armMediaEdit() sets __veMediaArmed.
          const isArmed = (n: Element): boolean =>
            (n as any).__veArmed === true || (n as any).__veMediaArmed === true;

          // armEdit() runs async after the edit-mode message; on animation-heavy
          // boards the busy main thread defers it. Retry rather than sleep, so a
          // genuine never-arms bug still ends as a failure below.
          for (let attempt = 0; attempt < 40; attempt++) {
            document.querySelectorAll('[data-e2e-hotzone]').forEach((n) => n.removeAttribute('data-e2e-hotzone'));
            for (const el of Array.from(document.querySelectorAll(hot))) {
              const r = el.getBoundingClientRect();
              if (r.width < 1 || r.height < 1) continue;
              if (r.left > window.innerWidth || r.top > window.innerHeight) continue;
              // Playwright clamps the click point into the viewport; mirror that.
              const cx = Math.min(Math.max(r.left + r.width / 2, 0), window.innerWidth - 1);
              const cy = Math.min(Math.max(r.top + r.height / 2, 0), window.innerHeight - 1);
              const top = document.elementFromPoint(cx, cy);
              if (!top) continue;
              // This is the shim's guard, verbatim: the handler that survives is
              // the one on `closest(SEL)`. If that element was never armed (or
              // there is none), no listener reports and this point is dead —
              // try the next candidate rather than assert on a doomed click.
              const reporter = top.closest(SEL);
              if (!reporter || !isArmed(reporter) || !keyOf(reporter)) continue;
              el.setAttribute('data-e2e-hotzone', '1');
              return { expectedKey: keyOf(reporter), targetKey: keyOf(el) };
            }
            await new Promise((r) => setTimeout(r, 200));
          }
          return null;
        },
        { hot: HOT },
      );

      expect(
        picked,
        `${board}: no editable element's centre hit-tests onto an ARMED element — ` +
          `every hot zone on this board is unreachable (hot-zone dead)`,
      ).not.toBeNull();

      // `data-e2e-hotzone` is inert: it is not in the shim's armed selector, so
      // stamping it cannot change which listener fires.
      const target = page.locator('[data-e2e-hotzone]');

      // Derive the expected key from the REAL event rather than predicting it.
      //
      // 2026-09-11 — the prediction above is measured before the click, and on
      // a board that is still animating, layout can move underneath it.
      // school/ms-news-studio-switcher.html failed on WEBKIT ONLY for exactly
      // that reason: it stacks a `story.poster` element over a `story.video`
      // one, the two engines settled that stack differently in the window
      // between measuring and clicking, and the test called a working board
      // dead. Prediction cannot win that race — so don't predict.
      //
      // A capture listener on `document` is the FIRST node in the capture path,
      // so it sees the same event, with the same `ev.target`, before any of the
      // shim's element listeners run (and their stopPropagation() cannot
      // retroactively unrun it). Applying the shim's own `closest()` rule to
      // that target yields exactly the element the shim will report — no race,
      // and strictly stronger than a guess, because a `closest()` that lands on
      // an UNARMED element still fails below as the genuinely dead zone it is.
      await page.evaluate(() => {
        const SEL = '[data-field],[data-mediafield],[data-imgslot],[data-img],[data-slot],[data-action],[data-videoslot],[data-posterslot]';
        (window as any).__expectedKey = null;
        document.addEventListener(
          'click',
          (ev) => {
            const t = ev.target as Element | null;
            const reporter = t && t.closest ? t.closest(SEL) : null;
            if (!reporter) return;
            (window as any).__expectedKey =
              reporter.getAttribute('data-action') || reporter.getAttribute('data-mediafield') ||
              reporter.getAttribute('data-field') || reporter.getAttribute('data-imgslot') ||
              reporter.getAttribute('data-videoslot') || reporter.getAttribute('data-posterslot') ||
              reporter.getAttribute('data-slot') || reporter.getAttribute('data-img') || '';
          },
          true,
        );
      });

      await target.click({ force: true });

      const expectedKey = await page.evaluate(() => (window as any).__expectedKey);
      expect(
        expectedKey,
        `${board}: the click landed on an element with no armed hot zone above it ` +
          `(picked ${picked!.targetKey}) — hot-zone dead`,
      ).not.toBeNull();

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
      expect(click, `${board}: clicking an element did NOT post educms-field-click (hot-zone dead)`).not.toBeNull();
      expect(click.key, `${board}: educms-field-click reported the wrong key`).toBe(expectedKey);
      // `media` is armEdit()'s kind for data-mediafield; the other four come
      // from armEdit()/armMediaEdit()'s own kind ternaries.
      expect(['text', 'img', 'action', 'video', 'media'], `${board}: bad kind`).toContain(click.kind);

      expect(pageErrors, `${board}: uncaught pageerror(s): ${pageErrors.slice(0, 3).join(' || ')}`).toEqual([]);
    });
  }
});

/**
 * THE ANTI-BLIND-SPOT TEST (2026-09-11).
 *
 * The bug this spec exists to catch already escaped once through the LIST
 * itself, not the assertions: `school/` and `kiosk/` shipped 59 boards with
 * zero coverage here, and the CLAUDE.md sweep hardcodes `hs signage fitness`
 * so it could not see them either. Both are the same failure — a static list
 * of directories that nobody re-checks against the tree.
 *
 * So DISCOVER the families off disk instead of trusting a list. A "family" is
 * any directory that directly contains board HTML (`school`, `signage/qsr`,
 * `school/campus-pulse`, …); asset-only directories drop out for free because
 * they hold no .html. Every family must have at least one representative in
 * BOARDS. Adding `public/templates/<new-vertical>/` now reds this test until
 * someone picks a board for it — which is the entire point.
 *
 * Filesystem-only, so it costs milliseconds and runs on both engines.
 */
test('every board family has a click-to-edit representative', () => {
  // Playwright transpiles specs as CommonJS, so `__dirname` is the spec's dir.
  const TEMPLATE_ROOT = path.resolve(__dirname, '..', '..', 'public', 'templates');

  const families = new Set<string>();
  (function walk(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    if (entries.some((e) => e.isFile() && e.name.endsWith('.html'))) {
      families.add(path.relative(TEMPLATE_ROOT, dir).split(path.sep).join('/') || '.');
    }
    for (const e of entries) {
      // `_thumbs` holds generated preview images, never boards.
      if (e.isDirectory() && e.name !== '_thumbs') walk(path.join(dir, e.name));
    }
  })(TEMPLATE_ROOT);

  const covered = new Set(
    BOARDS.map((b) => b.replace('/templates/', '').split('/').slice(0, -1).join('/') || '.'),
  );
  const uncovered = [...families].filter((f) => !covered.has(f)).sort();

  expect(
    uncovered,
    `These board families have NO representative in BOARDS, so a redesign that ` +
      `drops their click-to-edit shim would ship unnoticed — the exact 2026-06-07 ` +
      `regression. Add one board from each to the list above:\n  ${uncovered.join('\n  ')}`,
  ).toEqual([]);

  // Guard the guard: if the walk ever finds nothing (a moved directory, a bad
  // __dirname), an empty `families` would make the assertion above vacuously
  // pass. Anchor it to the measured 2026-09-11 floor.
  expect(families.size, 'board-family discovery found nothing — did the tree move?')
    .toBeGreaterThanOrEqual(20);
});
