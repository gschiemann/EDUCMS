/**
 * `boardHasMenuRuntime(url)` decides, from a URL alone, whether a packaged board
 * reads the live menu itself — it starts the 30-s menu poll on every screen
 * showing that board, and it decides whether the builder may claim "live from
 * your POS (matched by name)". A URL rule is only as good as its agreement with
 * the files, so this reads EVERY board under public/templates (recursively, the
 * `_`-prefixed path rule the poster generator uses) and checks the rule against
 * what the file actually contains: a menu handler (`applyMenu` / `renderMenu`, or
 * a message listener reading `d.menu`).
 *
 * 2026-09-23 (POS-A): the sixteen qsr/bar `redesign-*` boards carry only the
 * generic shim. They matched the old rule, so screens polled the menu for them
 * and the builder promised name-matched live prices that never happen.
 */
import * as fs from 'fs';
import * as path from 'path';
import { boardHasMenuRuntime } from '../menu-matching';

const ROOT = path.resolve(__dirname, '../../../../public/templates');

function boards(dir: string, rel = ''): string[] {
  const out: string[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith('_')) continue;
    const abs = path.join(dir, name);
    const r = rel ? `${rel}/${name}` : name;
    if (fs.statSync(abs).isDirectory()) out.push(...boards(abs, r));
    else if (name.endsWith('.html')) out.push(r);
  }
  return out;
}

const HANDLER = /function applyMenu\(|function renderMenu\(|\bd\.menu\b/;
const ALL = boards(ROOT);

it('walks the whole board catalogue (not a sample)', () => {
  expect(ALL.length).toBeGreaterThanOrEqual(250);
});

it.each(ALL)('%s — the URL rule matches what the file does', (rel) => {
  const reads = HANDLER.test(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  expect(boardHasMenuRuntime(`/templates/${rel}`)).toBe(reads);
});

it('the redesign-* menu boards are exactly the ones the old rule got wrong', () => {
  const oldRule = (u: string) => /\/signage\/(qsr|menus-pos|bar)\//.test(u);
  const wrong = ALL.filter((rel) => oldRule(`/templates/${rel}`) !== boardHasMenuRuntime(`/templates/${rel}`));
  expect(wrong.length).toBe(16);
  for (const rel of wrong) expect(rel).toMatch(/\/redesign-[^/]+\.html$/);
});

it('a query string or a preview param does not change the answer', () => {
  expect(boardHasMenuRuntime('/templates/signage/qsr/02-counter-menu.html?text=abc&freeze=1')).toBe(true);
  expect(boardHasMenuRuntime('/templates/signage/qsr/redesign-pizza-v1-slice-signal.html?text=abc')).toBe(false);
  expect(boardHasMenuRuntime(undefined)).toBe(false);
});
