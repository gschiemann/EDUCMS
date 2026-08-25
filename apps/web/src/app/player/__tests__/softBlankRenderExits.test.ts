/**
 * EVERY RENDER EXIT OF THE PLAYER MUST DRAW THE CROSS-BRANCH OVERLAYS.
 *
 * ── WHY THIS FILE EXISTS (three strikes) ──────────────────────────────
 *
 * `apps/web/src/app/player/page.tsx` is a ~10k-line component with FIVE
 * render exits — registering, pairing, TEMPLATE playlist, ribbon-tile parent,
 * and the main playback tree. An overlay added to one of them is invisible on
 * every screen that takes a different one, and the failure is completely
 * silent: state flips, handlers log success, the server audits `delivered`,
 * and the glass does not change.
 *
 * That has now happened three times in this one file:
 *
 *   2026-04-29  `{otaOverlay}` was missing from the TEMPLATE branch. Operator:
 *               "pushed the update from the app to the player and got no
 *               feedback on the player that anything was pushed."
 *   2026-05-14  `<TouchOverlay>` / `<TouchNavOverlay>` were below the same
 *               early return. Operator: taps did "nothing", with no error.
 *   2026-08-25  `{softBlankOverlay}` — the blank/power split shipped the
 *               black overlay inside the non-template branch only. G43 and
 *               M43 were both playing a single-zone EXTERNAL_HTML template
 *               playlist, so Blank and Wake did nothing on the operator's
 *               live fleet while every audit row read
 *               `dispatched / delivered:true / mechanism web-overlay`.
 *               L55VEC — the one panel where Blank worked — had no active
 *               template schedule and fell through to the main return.
 *
 * The first two were fixed by hand and left no guard, which is why there was
 * a third. This is the guard. It parses the real file with the TypeScript
 * compiler API (already a devDependency — the same tool
 * `check-inset-serialization.cjs` uses), finds every `return` statement that
 * BELONGS TO the player component itself (not to a nested callback, a
 * `.map()`, or a helper defined inside it), and asserts each one renders the
 * shared overlays.
 *
 * If you add a sixth render exit, add the overlays to it. If you add a new
 * cross-branch overlay, add it to REQUIRED below and to all five exits.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

/**
 * Overlays that MUST appear in EVERY render exit, no exceptions.
 *
 * Only `softBlankOverlay` is absolute, and deliberately so: it is the one
 * whose absence means an operator's button does nothing on a live panel, and
 * it is the only one this P0 change is entitled to move. The other
 * cross-branch overlays are pinned rather than required — see below.
 */
const REQUIRED = ['softBlankOverlay'];

/**
 * The OTHER cross-branch overlays, pinned to the exits that render them today.
 *
 * They are absent from exactly one exit — the ribbon-tile parent, whose whole
 * body is a row of iframes, each of which is itself a full player that draws
 * its own copy. Adding them to the parent as well is defensible (an OTA prompt
 * invisible on a ribbon wall is the 2026-04-29 bug wearing a different hat)
 * but it would put a second toast / modal on top of the N the children already
 * draw, and that is a visual change to a rare hardware configuration that
 * could not be verified on real glass during a live P0. So: recorded, pinned,
 * and NOT silently dropped. If you fix the tile parent, move these into
 * REQUIRED and delete this block.
 */
const PINNED_KNOWN_GAP = ['otaOverlay', 'connectivityToast', 'canvasEditor'];

const PAGE = path.resolve(__dirname, '../page.tsx');

interface Exit {
  line: number;
  text: string;
}

/**
 * Collect the return statements owned by the player component.
 *
 * "Owned by" = the nearest enclosing function is the component itself. A
 * `return` inside `items.map(x => <li/>)` or inside a `useEffect` cleanup
 * belongs to that inner function and is deliberately ignored.
 */
function componentRenderExits(): { name: string; exits: Exit[] } {
  const src = fs.readFileSync(PAGE, 'utf8');
  const sf = ts.createSourceFile(PAGE, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  const isFn = (n: ts.Node): n is ts.FunctionLikeDeclaration =>
    ts.isFunctionDeclaration(n) ||
    ts.isFunctionExpression(n) ||
    ts.isArrowFunction(n) ||
    ts.isMethodDeclaration(n);

  // The component is the SMALLEST function whose body declares the overlay —
  // `const softBlankOverlay = ...` is declared exactly once, in the component.
  const candidates: ts.FunctionLikeDeclaration[] = [];
  const visit = (n: ts.Node): void => {
    if (isFn(n) && n.body && /const\s+softBlankOverlay\s*=/.test(n.getText(sf))) {
      candidates.push(n);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);

  if (candidates.length === 0) {
    throw new Error('no function in page.tsx declares `const softBlankOverlay`');
  }
  candidates.sort((a, b) => a.getText(sf).length - b.getText(sf).length);
  const fn = candidates[0];

  const exits: Exit[] = [];
  const walk = (n: ts.Node): void => {
    // Do not descend into nested functions — their returns are not renders.
    if (n !== fn && isFn(n)) return;
    if (ts.isReturnStatement(n)) {
      // `return;` and `return null;` are not render exits.
      const expr = n.expression;
      if (expr && !(expr.kind === ts.SyntaxKind.NullKeyword)) {
        exits.push({
          line: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1,
          text: expr.getText(sf),
        });
      }
    }
    ts.forEachChild(n, walk);
  };
  walk(fn);

  const name =
    (fn.name && ts.isIdentifier(fn.name) && fn.name.text) ||
    (ts.isVariableDeclaration(fn.parent) && ts.isIdentifier(fn.parent.name)
      ? fn.parent.name.text
      : '(anonymous)');

  return { name, exits };
}

describe('player render exits all draw the cross-branch overlays', () => {
  const { name, exits } = componentRenderExits();

  it('finds the player component and more than one render exit', () => {
    // If this ever drops to 1 the parser is wrong, not the file — a
    // single-exit component could not have produced three field incidents.
    expect(name).toBeTruthy();
    expect(exits.length).toBeGreaterThan(1);
  });

  it.each(REQUIRED)('every render exit renders {%s}', (overlay) => {
    const missing = exits
      .filter((e) => !e.text.includes(`{${overlay}}`))
      .map((e) => `page.tsx:${e.line}  ${e.text.slice(0, 90).replace(/\s+/g, ' ')}…`);

    expect(
      missing.length === 0
        ? []
        : // The message IS the fix instruction — this failure will be read by
          // whoever adds render exit number six, possibly at 2am.
          [
            `${missing.length} render exit(s) of <${name}> do not render {${overlay}}.`,
            'An overlay missing from one branch is a feature that silently does',
            'nothing on every screen that takes that branch (2026-04-29,',
            '2026-05-14, 2026-08-25 — all the same bug). Add it there.',
            ...missing,
          ],
    ).toEqual([]);
  });

  it.each(PINNED_KNOWN_GAP)(
    '{%s} is missing from exactly one exit (the ribbon-tile parent) — pinned, not forgotten',
    (overlay) => {
      const missing = exits.filter((e) => !e.text.includes(`{${overlay}}`));
      // Exactly one, and it must be the iframe-only tile parent. If this
      // number GROWS, someone just reintroduced the 2026-04-29 bug. If it
      // drops to zero, someone fixed the tile parent — move this overlay into
      // REQUIRED above.
      expect(missing).toHaveLength(1);
      expect(missing[0].text).toContain('<iframe');
    },
  );
});
