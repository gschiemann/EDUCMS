/**
 * menu-binding.ts — the SERVER decides which POS item each row of an AI board is.
 *
 * WHY (2026-09-22, Greg): "our AI needs to be super tuned into our POS
 * integrations so that when we ask for an integration it knows to ask what one
 * and ensures the template is created with perfect integrations into those
 * systems". Before this, an AI menu board was a picture of a menu: the model
 * typed the items in, the board saved as `{ html }`, and nothing tied a row to
 * the POS item it showed — a renamed item, a new price, a sold-out dish never
 * reached it.
 *
 * THE RULE: the model never copies an id. The server numbers every item it
 * hands the model (`[item.N]` in the REAL CONTENT block — pos-binding-plan.ts),
 * the model is asked to key each row by that number (`data-menu-row="N"`,
 * `data-field="item.N.name|price|desc"`), and after the board comes back this
 * module — not the model — writes the binding onto the row:
 *
 *   data-pos-item="<externalId>"  the catalog id, from the PLAN, never from the page
 *   data-seed="<catalog name>"    what the Super Taco style runtimes match by name
 *   data-menu-row="N"             normalized onto the row element it found
 *
 * and rewrites the row's name + price to the catalog's own values, so the
 * snapshot on the glass is the POS's words even if the model "tidied" them. The
 * board root carries `data-pos-connection` + `data-pos-provider` so keep /
 * "Edit with words" can re-derive the bindings from the HTML alone — and verify
 * every id against THIS tenant's catalog before saving (templates.controller).
 *
 * Finding a row: `data-menu-row="N"` when the model wrote one that holds only
 * row N's fields; otherwise the V14 rule (the highest element holding every
 * `item.N.*` field and nothing of any other row — `itemRowRoot` in fact-guard).
 * Numbers the plan does not have, and second copies of a number, are strays:
 * generation removes them (the board must be exactly the plan), "Edit with
 * words" only unbinds them (the operator may have asked for an extra row).
 *
 * PURE — string in, string out; the parser is fact-guard's (one walker, one set
 * of rules about what counts as a row). Unit-tested in menu-binding.spec.ts.
 */
import {
  collectKeySites,
  enclosingNode,
  itemFieldOfKey,
  itemNumberOfKey,
  itemRowRoot,
  ITEM_TEXT_MAX,
  nodeAttr,
  nodeFullText,
  normalizeAmount,
  parseHtmlNodes,
  sitesWithin,
  stageIndex,
  type HtmlNode,
  type KeySite,
} from './fact-guard';

/** One catalog item the board must show, and the row number the model sees. */
export interface BindingPlanItem {
  /** The `[item.N]` number — the ONLY identity the model ever sees. */
  n: number;
  /** The POS item id (`MenuItem.externalId`). Never shown to the model. */
  externalId: string;
  /** The catalog's own name. */
  name: string;
  priceCents: number;
  /** "$14.50" — what the row's price must read. */
  priceText: string;
  /** The POS section (category) it came from. */
  section: string;
  description?: string | null;
}

/** Which POS items a board shows, in the order the model was given them. */
export interface BindingPlan {
  providerId: string;
  providerName: string;
  connectionId: string;
  items: BindingPlanItem[];
}

export interface BindResult {
  html: string;
  /** Row numbers found on the board and stamped. */
  bound: number[];
  /** Plan rows the board has no row for. */
  missing: number[];
  /** Stray rows (unknown or repeated numbers) taken off the board. */
  removedStrays: number;
}

/** The bindings a saved board carries — what keep / "Edit with words" read back. */
export interface ReadBindings {
  connectionId: string | null;
  providerId: string | null;
  /** `{ 'item.N': '<externalId>' }` — Codex's slot-map convention (posItemBindings). */
  slots: Record<string, string>;
}

/** Attributes only the server may write. */
const BINDING_ATTRS = ['data-pos-item', 'data-seed', 'data-menu-row'] as const;
const ROOT_ATTRS = ['data-pos-connection', 'data-pos-provider'] as const;
const STRUCTURAL = new Set(['html', 'head', 'body', 'style', 'title']);

function escapeText(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, '&quot;');
}

/** Rewrite an opening tag: remove each named attribute, then append the non-null ones. */
export function setTagAttrs(tagText: string, attrs: Record<string, string | null>): string {
  let out = tagText;
  for (const name of Object.keys(attrs)) {
    const re = new RegExp(`\\s+${name}(?:\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s"'>]+))?(?=[\\s/>])`, 'gi');
    out = out.replace(re, '');
  }
  const add = Object.entries(attrs)
    .filter(([, v]) => v !== null)
    .map(([k, v]) => ` ${k}="${escapeAttr(String(v))}"`)
    .join('');
  if (!add) return out;
  const selfClose = /\s*\/>$/.exec(out);
  if (selfClose) return out.slice(0, selfClose.index) + add + out.slice(selfClose.index);
  return out.slice(0, -1) + add + '>';
}

interface Edit { start: number; end: number; text: string }

/** Replace the text an element shows. Nested editable fields (a desc inside the name) are kept. */
function replaceTextEdits(html: string, nodes: HtmlNode[], sites: KeySite[], idx: number, value: string): Edit[] {
  const node = nodes[idx];
  if (!node.closed) return [];
  const esc = escapeText(value);
  const nested = sitesWithin(sites, node).some((s) => s.node !== idx);
  if (!nested) return [{ start: node.openEnd, end: node.closeStart, text: esc }];
  // Keep the children (a nested `item.N.desc`), rewrite only the element's OWN text runs.
  const segments: Array<[number, number]> = [];
  let cursor = node.openEnd;
  for (const c of node.children) {
    segments.push([cursor, nodes[c].openStart]);
    cursor = nodes[c].closed ? nodes[c].closeEnd : nodes[c].openEnd;
  }
  segments.push([cursor, node.closeStart]);
  const edits: Edit[] = [];
  let placed = false;
  for (const [s, e] of segments) {
    const chunk = html.slice(s, e);
    const re = /<[^>]*>|[^<]+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(chunk)) !== null) {
      if (m[0].startsWith('<') || !m[0].trim()) continue;
      const lead = /^\s*/.exec(m[0])![0];
      const trail = /\s*$/.exec(m[0])![0];
      edits.push({ start: s + m.index, end: s + m.index + m[0].length, text: placed ? '' : `${lead}${esc}${trail}` });
      placed = true;
    }
  }
  if (!placed) edits.push({ start: node.openEnd, end: node.openEnd, text: esc });
  return edits;
}

/** A row-number attribute value as an integer, or null. */
function rowNumber(v: string | null): number | null {
  if (v == null || !/^\s*\d{1,4}\s*$/.test(v)) return null;
  return Number(v.trim());
}

/** The element that carries the board-level bindings: <body>, else <html>, else the first element. */
function rootIndex(nodes: HtmlNode[]): number {
  const body = nodes.findIndex((n) => n.tag === 'body');
  if (body >= 0) return body;
  const htmlIdx = nodes.findIndex((n) => n.tag === 'html');
  return htmlIdx >= 0 ? htmlIdx : nodes.length ? 0 : -1;
}

interface Instance {
  n: number;
  /** The element that carries the binding (-1 when there is none to stamp). */
  row: number;
  /** Further elements of the same row (a price the model split into its own column). */
  fragments: number[];
  sites: KeySite[];
  explicit: boolean;
  start: number;
}

/**
 * Apply edits back-to-front. An edit that starts inside one already kept (a tag
 * rewrite inside a removed row, or inside a price whose text was replaced
 * wholesale) is dropped — the outer edit already decided that span.
 */
function applyEdits(html: string, edits: Edit[]): string {
  const ordered = [...edits].sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: Edit[] = [];
  let lastEnd = -1;
  for (const e of ordered) {
    if (e.start < lastEnd) continue;
    kept.push(e);
    lastEnd = Math.max(lastEnd, e.end);
  }
  let out = html;
  for (let i = kept.length - 1; i >= 0; i--) {
    const e = kept[i];
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  }
  return out;
}

/**
 * Stamp the plan onto a sanitized board. See the file header for the rules.
 * `removeStrays` (default true) takes unknown / repeated rows off the board;
 * false only unbinds them ("Edit with words").
 */
export function bindMenuRows(
  html: string,
  plan: BindingPlan,
  opts: { removeStrays?: boolean } = {},
): BindResult {
  const removeStrays = opts.removeStrays !== false;
  const empty: BindResult = { html, bound: [], missing: plan.items.map((i) => i.n), removedStrays: 0 };
  if (typeof html !== 'string' || !html) return empty;
  const nodes = parseHtmlNodes(html);
  if (!nodes.length) return empty;

  const stage = stageIndex(nodes);
  const allSites = collectKeySites(html, nodes);
  const itemSites = allSites.filter((s) => itemNumberOfKey(s.key) != null);
  const planByN = new Map(plan.items.map((i) => [i.n, i]));
  const attrChanges = new Map<number, Record<string, string | null>>();
  const setAttrs = (idx: number, attrs: Record<string, string | null>) => {
    attrChanges.set(idx, { ...(attrChanges.get(idx) || {}), ...attrs });
  };
  const unbind = (idx: number) => setAttrs(idx, { 'data-pos-item': null, 'data-seed': null, 'data-menu-row': null });

  // 1. Explicit rows the model marked — trusted only when they hold ONE row's fields.
  const instances: Instance[] = [];
  const explicitOf = new Map<number, Instance>();
  const claimed = new Set<KeySite>();
  const acceptedExplicit: number[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const attr = nodeAttr(html, nodes[i], 'data-menu-row');
    if (attr == null) continue;
    const node = nodes[i];
    const nestedInAccepted = acceptedExplicit.some(
      (a) => nodes[a].openStart < node.openStart && nodes[a].closeEnd >= node.closeEnd,
    );
    if (!node.closed || STRUCTURAL.has(node.tag) || i === stage || nestedInAccepted) { unbind(i); continue; }
    const within = sitesWithin(allSites, node);
    const nums = new Set(within.map((s) => itemNumberOfKey(s.key)));
    const names = within.filter((s) => itemFieldOfKey(s.key) === 'name').length;
    const prices = within.filter((s) => itemFieldOfKey(s.key) === 'price').length;
    // Spans several rows, holds a board field (headline, section title), or two
    // copies of one row: not a row — its fields are found by the V14 rule below.
    if (nums.has(null) || nums.size > 1 || names > 1 || prices > 1) { unbind(i); continue; }
    const n = nums.size === 1 ? ([...nums][0] as number) : rowNumber(attr);
    if (n == null) { unbind(i); continue; }
    within.forEach((s) => claimed.add(s));
    acceptedExplicit.push(i);
    const inst: Instance = { n, row: i, fragments: [], sites: within, explicit: true, start: node.openStart };
    instances.push(inst);
    if (!explicitOf.has(n)) explicitOf.set(n, inst);
  }

  // 2. Everything else: group each row's fields under their V14 row element.
  const byN = new Map<number, Array<{ site: KeySite; root: number }>>();
  for (const site of itemSites) {
    if (claimed.has(site)) continue;
    const n = itemNumberOfKey(site.key)!;
    const from = site.node >= 0 ? site.node : enclosingNode(nodes, site.start, site.end);
    const root = from >= 0 ? itemRowRoot(html, nodes, allSites, from, n) : -1;
    const list = byN.get(n) || [];
    list.push({ site, root });
    byN.set(n, list);
  }
  for (const [n, list] of byN) {
    // One instance per row element that shows a NAME; name-less fragments (a
    // price split into its own column) belong to the row before them — or to
    // the row the model marked explicitly.
    const roots: number[] = [];
    for (const { root } of list) if (!roots.includes(root)) roots.push(root);
    const ofN: Instance[] = explicitOf.has(n) ? [explicitOf.get(n)!] : [];
    for (const root of roots) {
      const rootSites = list.filter((x) => x.root === root).map((x) => x.site);
      const hasName = rootSites.some((s) => itemFieldOfKey(s.key) === 'name');
      const start = root >= 0 ? nodes[root].openStart : rootSites[0].start;
      if (hasName || !ofN.length) {
        const nameSite = rootSites.find((s) => itemFieldOfKey(s.key) === 'name' && s.node >= 0);
        const row = root >= 0 ? root : nameSite ? nameSite.node : rootSites.find((s) => s.node >= 0)?.node ?? -1;
        const inst: Instance = { n, row, fragments: [], sites: rootSites, explicit: false, start };
        ofN.push(inst);
        instances.push(inst);
      } else {
        const last = ofN[ofN.length - 1];
        const frag = root >= 0 ? root : rootSites.find((s) => s.node >= 0)?.node ?? -1;
        if (frag >= 0 && frag !== last.row && !last.fragments.includes(frag)) last.fragments.push(frag);
        last.sites.push(...rootSites);
      }
    }
  }

  // 3. One row per number: an explicit row wins, else the first in the document.
  instances.sort((a, b) => a.start - b.start);
  const rowOf = new Map<number, Instance>();
  for (const inst of instances) if (inst.explicit && !rowOf.has(inst.n)) rowOf.set(inst.n, inst);
  for (const inst of instances) if (!rowOf.has(inst.n)) rowOf.set(inst.n, inst);

  const edits: Edit[] = [];
  const removals: number[] = [];
  const stamped = new Set<number>();
  const bound: number[] = [];
  const missing: number[] = [];

  for (const item of plan.items) {
    const inst = rowOf.get(item.n);
    if (!inst || inst.row < 0) { missing.push(item.n); continue; }
    setAttrs(inst.row, {
      'data-menu-row': String(item.n),
      'data-pos-item': item.externalId,
      'data-seed': item.name,
    });
    stamped.add(inst.row);
    // The catalog's own words on the glass.
    for (const s of inst.sites) {
      if (s.node < 0) continue;
      const field = itemFieldOfKey(s.key);
      if (field === 'name') edits.push(...replaceTextEdits(html, nodes, allSites, s.node, item.name));
      else if (field === 'price') edits.push(...replaceTextEdits(html, nodes, allSites, s.node, item.priceText));
    }
    bound.push(item.n);
  }

  // 4. Strays: a number the plan does not have, or a second copy of one.
  for (const inst of instances) {
    if (planByN.has(inst.n) && rowOf.get(inst.n) === inst) continue;
    const elements = [inst.row, ...inst.fragments].filter((r) => r >= 0);
    const canRemove =
      removeStrays &&
      elements.length > 0 &&
      elements.every((r) => {
        const node = nodes[r];
        return node.closed && !STRUCTURAL.has(node.tag) && r !== stage && nodeFullText(html, node).length <= ITEM_TEXT_MAX;
      });
    if (canRemove) removals.push(...elements);
    else elements.forEach((r) => unbind(r));
  }

  // 5. Ids are never taken from the page: any binding attribute we did not
  //    just write goes, and the board root carries the connection.
  for (let i = 0; i < nodes.length; i++) {
    if (stamped.has(i)) continue;
    for (const a of BINDING_ATTRS) {
      if (nodeAttr(html, nodes[i], a) != null) { unbind(i); break; }
    }
    for (const a of ROOT_ATTRS) {
      if (nodeAttr(html, nodes[i], a) != null) setAttrs(i, { [a]: null });
    }
  }
  const root = rootIndex(nodes);
  if (root >= 0 && bound.length) {
    setAttrs(root, { 'data-pos-connection': plan.connectionId, 'data-pos-provider': plan.providerId });
  }

  // 6. Apply. A removed row swallows every edit inside it.
  const finalRemovals = removals.filter(
    (r) => !removals.some((o) => o !== r && nodes[o].openStart <= nodes[r].openStart && nodes[o].closeEnd >= nodes[r].closeEnd),
  );
  const all: Edit[] = finalRemovals.map((r) => ({ start: nodes[r].openStart, end: nodes[r].closeEnd, text: '' }));
  for (const [idx, attrs] of attrChanges) {
    const n = nodes[idx];
    all.push({ start: n.openStart, end: n.openEnd, text: setTagAttrs(html.slice(n.openStart, n.openEnd), attrs) });
  }
  all.push(...edits);

  return { html: applyEdits(html, all), bound, missing, removedStrays: finalRemovals.length };
}

/** Read the bindings a board carries (keep / "Edit with words"). Never trusts them — callers verify. */
export function readMenuBindings(html: string): ReadBindings {
  const out: ReadBindings = { connectionId: null, providerId: null, slots: {} };
  if (typeof html !== 'string' || !html) return out;
  const nodes = parseHtmlNodes(html);
  if (!nodes.length) return out;
  const root = rootIndex(nodes);
  if (root >= 0) {
    out.connectionId = nodeAttr(html, nodes[root], 'data-pos-connection') || null;
    out.providerId = nodeAttr(html, nodes[root], 'data-pos-provider') || null;
  }
  const sites = collectKeySites(html, nodes);
  for (let i = 0; i < nodes.length; i++) {
    const id = nodeAttr(html, nodes[i], 'data-pos-item');
    if (!id || id.length > 200) continue;
    let n = rowNumber(nodeAttr(html, nodes[i], 'data-menu-row'));
    if (n == null) n = itemNumberOfKey(nodeAttr(html, nodes[i], 'data-field'));
    if (n == null) {
      const nums = new Set(sitesWithin(sites, nodes[i]).map((s) => itemNumberOfKey(s.key)).filter((x) => x != null));
      if (nums.size === 1) n = [...nums][0] as number;
    }
    if (n == null) continue;
    const key = `item.${n}`;
    if (!(key in out.slots)) out.slots[key] = id;
  }
  return out;
}

/**
 * Does the board still show every planned item — bound, with a name, and with
 * its catalog price — after the price guard ran? `missing` names the rows that
 * do not.
 */
export function validateBoundBoard(html: string, plan: BindingPlan): { ok: boolean; missing: number[] } {
  const missing: number[] = [];
  const nodes = typeof html === 'string' && html ? parseHtmlNodes(html) : [];
  const sites = nodes.length ? collectKeySites(html, nodes) : [];
  const read = readMenuBindings(html);
  for (const item of plan.items) {
    if (read.slots[`item.${item.n}`] !== item.externalId) { missing.push(item.n); continue; }
    const text = (field: string) =>
      sites
        .filter((s) => s.node >= 0 && s.key.toLowerCase() === `item.${item.n}.${field}`)
        .map((s) => nodeFullText(html, nodes[s.node]));
    const nameOk = text('name').some((t) => t.length > 0);
    const want = normalizeAmount(item.priceText);
    const priceOk = text('price').some((t) => normalizeAmount(t) === want);
    if (!nameOk || !priceOk) missing.push(item.n);
  }
  return { ok: missing.length === 0, missing };
}
