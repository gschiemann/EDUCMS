/**
 * menu-matching — does this catalog item actually reach a screen?
 *
 * A menu board does not know about item ids. When "Driven by your POS" is
 * on, the board's baked `applyMenu()` indexes the live catalog by
 * NORMALIZED NAME and looks each of its own rows up by the name it is
 * currently displaying. Match on the name, get live price / description /
 * variants / sold-out. No match, and the board quietly keeps its authored
 * text.
 *
 * Quietly is the whole problem. An operator adds "burger" to the price
 * book and nothing tells them whether any board will ever show it, which
 * board, or that the join is on a string at all. From the board side, the
 * same silence: switching POS on maps some rows and not others, and says
 * nothing about which.
 *
 * This module is the shared answer — one implementation both the Menu
 * console and the template editor read, so what the editor claims and
 * what the screen does cannot drift.
 *
 * FIDELITY WARNING: `normalizeMenuName` MUST stay character-for-character
 * equivalent to the board's own `norm()` (see `applyMenu` in
 * apps/web/public/templates/signage/qsr/*.html). If they diverge, this
 * reports matches the screen will not make — which is worse than saying
 * nothing, because the operator would then trust it.
 */

/** The board's `norm()`, exactly: lowercase, runs of non-alphanumerics to
 *  a single space, trimmed. */
export function normalizeMenuName(raw: unknown): string {
  return String(raw == null ? '' : raw)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/^ +| +$/g, '');
}

/** The board's `isName()` — which leaf holds the item's name. */
export function isNameLeaf(leaf: string): boolean {
  return leaf === 'name' || leaf === 'n';
}

/** One row on a board that can take a live price. */
export interface BoardMenuRow {
  /** The field-key prefix that groups this row, e.g. "item.0". */
  group: string;
  /** The name the board currently displays — the join key. */
  displayName: string;
}

/**
 * Find the rows a board would try to fill from the catalog.
 *
 * Mirrors `applyMenu`: group `[data-field]` keys by everything before the
 * final dot, keep any group that has a name leaf. Takes the same
 * `{key, defaultText}` list the editor already discovered, plus the
 * operator's text overrides — because the board matches on what it is
 * DISPLAYING, so an override changes what it matches.
 */
export function boardMenuRows(
  fields: Array<{ key: string; defaultText: string }>,
  textOverrides: Record<string, string> = {},
): BoardMenuRow[] {
  const rows: BoardMenuRow[] = [];
  for (const f of fields) {
    const dot = f.key.lastIndexOf('.');
    if (dot < 0) continue;
    if (!isNameLeaf(f.key.slice(dot + 1))) continue;
    const shown = Object.prototype.hasOwnProperty.call(textOverrides, f.key)
      ? textOverrides[f.key]
      : f.defaultText;
    const displayName = String(shown ?? '').trim();
    if (!displayName) continue;
    rows.push({ group: f.key.slice(0, dot), displayName });
  }
  return rows;
}

export interface MenuMatchReport {
  /** Board rows that will take a live price, with the catalog name they hit. */
  matched: Array<{ group: string; displayName: string; catalogName: string }>;
  /** Board rows the catalog has nothing for — they keep their typed text. */
  boardOnly: BoardMenuRow[];
  /** Catalog items no row on this board displays — they reach nothing here. */
  catalogOnly: string[];
}

/**
 * What will and will not happen when this board renders this catalog.
 *
 * Both directions matter and they fail differently. A board row with no
 * catalog item silently keeps its authored price — wrong on screen, and
 * invisible. A catalog item no board shows is the operator's edit going
 * nowhere at all.
 */
export function matchMenuToBoard(
  rows: BoardMenuRow[],
  catalogNames: string[],
): MenuMatchReport {
  const byNorm = new Map<string, string>();
  for (const name of catalogNames) {
    const n = normalizeMenuName(name);
    if (n && !byNorm.has(n)) byNorm.set(n, name);
  }

  const matched: MenuMatchReport['matched'] = [];
  const boardOnly: BoardMenuRow[] = [];
  const hit = new Set<string>();

  for (const row of rows) {
    const n = normalizeMenuName(row.displayName);
    const catalogName = n ? byNorm.get(n) : undefined;
    if (catalogName) {
      matched.push({ group: row.group, displayName: row.displayName, catalogName });
      hit.add(n);
    } else {
      boardOnly.push(row);
    }
  }

  const catalogOnly: string[] = [];
  for (const [n, name] of byNorm) if (!hit.has(n)) catalogOnly.push(name);

  return { matched, boardOnly, catalogOnly };
}

/**
 * Does this packaged board carry its OWN live-menu runtime — the baked
 * `applyMenu()` name-join (qsr / menus-pos / bar packs) or the Super Taco
 * `renderMenu()`?
 *
 * 2026-09-23 — the answer is a property of the board FILE, and the menu packs'
 * sixteen `redesign-*` boards do not have one: they carry only the generic
 * shim, so a menu posted to them changes nothing. The builder still said
 * "LIVE FROM YOUR POS" over them and every screen polled the menu every 30 s
 * for them. `menu-runtime-boards.test.ts` reads every board under
 * public/templates and pins this rule to what the files actually contain.
 */
export function boardHasMenuRuntime(url: unknown): boolean {
  const path = typeof url === 'string' ? url.split('?')[0] : '';
  return /\/signage\/(qsr|menus-pos|bar)\//.test(path) && !/\/redesign-[^/]*$/.test(path);
}

/**
 * Is this board one the live menu feeds?
 *
 * Same test the renderer uses (see ExternalHtmlWidget): the packaged menu
 * packs by URL, or an explicit POS flag on the zone.
 */
export function isMenuDrivenBoard(cfg: {
  url?: unknown; posSync?: unknown; dataSource?: unknown;
}): boolean {
  const url = typeof cfg?.url === 'string' ? cfg.url : '';
  return /\/signage\/(qsr|menus-pos|bar)\//.test(url)
    || cfg?.posSync === true
    || cfg?.dataSource === 'POS';
}

/**
 * How close are two item names, once normalized?
 *
 * Used to aim the one-click fix: a board row reading "Onion Rings" should
 * offer "onion ring" first, not the alphabetically-first thing in the
 * catalog. Deliberately simple — shared word tokens, with a prefix bonus —
 * because this only ORDERS suggestions. The operator still confirms, and a
 * wrong guess costs one click to change, so cleverness buys nothing and
 * unpredictability costs.
 */
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeMenuName(a);
  const nb = normalizeMenuName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = new Set(na.split(' '));
  const tb = new Set(nb.split(' '));
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  const overlap = shared / Math.max(ta.size, tb.size);
  // A shared start ("burger" vs "burgers") reads as related to a person
  // even when tokens differ.
  const prefix = na.startsWith(nb) || nb.startsWith(na) ? 0.35 : 0;
  return Math.min(1, overlap + prefix);
}

export interface RowFill {
  /** The field key to write, e.g. "item.2.name". */
  fieldKey: string;
  /** What the row shows today. */
  from: string;
  /** The catalog item it should show instead. */
  to: string;
}

/**
 * Pair unmatched board rows with unmatched catalog items, best first.
 *
 * This is the whole "dead simple" path: the operator does not need to know
 * the join is on a string. They press one button and the rows that were
 * showing a typed price start showing their real one.
 *
 * Greedy on the strongest pair each round, so an obvious match is never
 * stolen by a weaker one earlier in the list. Pairs below `minScore` are
 * left alone — filling "Espresso" with "Onion Rings" because both were
 * spare would be worse than doing nothing.
 */
export function planRowFills(
  boardOnly: BoardMenuRow[],
  catalogOnly: string[],
  minScore = 0.34,
): RowFill[] {
  const rows = boardOnly.slice();
  const items = catalogOnly.slice();
  const out: RowFill[] = [];

  while (rows.length && items.length) {
    let best = { score: 0, ri: -1, ii: -1 };
    for (let ri = 0; ri < rows.length; ri += 1) {
      for (let ii = 0; ii < items.length; ii += 1) {
        const score = nameSimilarity(rows[ri].displayName, items[ii]);
        if (score > best.score) best = { score, ri, ii };
      }
    }
    if (best.ri < 0 || best.score < minScore) break;
    const row = rows.splice(best.ri, 1)[0];
    const item = items.splice(best.ii, 1)[0];
    out.push({ fieldKey: `${row.group}.name`, from: row.displayName, to: item });
  }
  return out;
}
