/**
 * resolve-menu-bindings.ts — explicit POS bindings, resolved against the live menu.
 *
 * WHY (2026-09-23, POS-A). A board can be told WHICH POS item a row or a field
 * shows, instead of hoping a name matches:
 *
 *   • ROW SLOTS  `posItemBindings = { 'item.3': '<externalId>' }` — the
 *     convention Codex set for the Super Taco boards and the one a kept
 *     POS-bound AI board saves (templates.controller `create-designer`). The
 *     row's `item.3.name` / `.price` / `.desc` all follow that one item.
 *   • FIELDS     `posItemBindings = { 'hero.price': { externalId, field } }` —
 *     the builder's older "Bind to a live menu item" control. It ALSO used to
 *     write a `{{pos.item:<externalId>.<field>}}` token into textOverrides,
 *     which nothing ever resolved: with no menu the literal token reached the
 *     glass. Tokens are still READ here (saved boards carry them) but never
 *     written again, and never sent to a board (`stripBindingTokens`).
 *
 * Before this module no code anywhere read a binding: a kept POS-bound AI board
 * showed the prices it was generated with, forever.
 *
 * THE RULES (the order is the contract):
 *   • no menu — still loading, the fetch failed, or no POS source is
 *     configured — resolves NOTHING: every board keeps the text it already
 *     shows (its baked snapshot, or the operator's own words). Never a token.
 *   • the item is on the menu and available  → its live name / price / desc;
 *   • the item is on the menu, `available:false` → SOLD OUT. Only the menu
 *     says that (a provider that reports sold-out, or an operator 86 in the
 *     Menu console) — nothing here infers it;
 *   • the item is missing from a menu we DID get (removed or hidden in the
 *     POS, or its section is out of hours right now) → NOT AVAILABLE. The row
 *     keeps its last words, and its price stops claiming a price.
 *
 * On-glass words ("Sold out" / "Not available") follow the BOARD's language
 * (`<html lang>`), not the dashboard's — the audience reads the board.
 *
 * PURE — no React, no DOM, no network. Unit-tested in
 * __tests__/resolve-menu-bindings.test.ts; WidgetRenderer and the builder read
 * the same functions, so what the builder says and what the screen does cannot
 * drift.
 */

/** Which value of a POS item a single bound field shows. */
export type BoundField = 'name' | 'price' | 'desc' | 'available';

/** One text field bound to one POS item. */
export interface FieldBinding {
  externalId: string;
  field: BoundField;
}

export interface MenuBindings {
  /** Whole rows: `'item.3' → externalId`. */
  slots: Record<string, string>;
  /** Single fields: `'hero.price' → { externalId, field }`. */
  fields: Record<string, FieldBinding>;
}

/** The leaves of a row slot that follow its item. */
export const ROW_LEAVES = ['name', 'price', 'desc'] as const;
export type RowLeaf = (typeof ROW_LEAVES)[number];

/** Anything containing this is a binding token and must never reach a board. */
export const BINDING_TOKEN_MARK = '{{pos.item:';

/** POS ids are short (Toast GUIDs, Square ids); anything longer is not one. */
const MAX_ID_LENGTH = 200;

const TOKEN_RE = /^\s*\{\{\s*pos\.item:(.+)\.(name|price|desc|description|available)\s*\}\}\s*$/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function cleanId(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const id = v.trim();
  return id && id.length <= MAX_ID_LENGTH ? id : null;
}

function normalizeField(v: unknown): BoundField | null {
  const f = typeof v === 'string' ? v.trim() : '';
  if (f === 'description') return 'desc';
  return f === 'name' || f === 'price' || f === 'desc' || f === 'available' ? f : null;
}

/** Does this value carry a binding token (well-formed or not)? */
export function isBindingToken(v: unknown): v is string {
  return typeof v === 'string' && v.indexOf(BINDING_TOKEN_MARK) !== -1;
}

/** `{{pos.item:<externalId>.<field>}}` → the binding, or null. */
export function parseBindingToken(v: unknown): FieldBinding | null {
  if (typeof v !== 'string') return null;
  const m = TOKEN_RE.exec(v);
  if (!m) return null;
  const externalId = cleanId(m[1]);
  const field = normalizeField(m[2]);
  return externalId && field ? { externalId, field } : null;
}

/**
 * textOverrides with every binding-token value removed — what a board may be
 * sent. A token is never text: dropping it lets the board show its own copy
 * until the live value arrives. Returns the SAME object when there is nothing
 * to strip, so React memo dependencies stay stable.
 */
export function stripBindingTokens<T>(overrides: T): T {
  if (!isPlainObject(overrides)) return overrides;
  let hit = false;
  for (const k of Object.keys(overrides)) {
    if (isBindingToken(overrides[k])) { hit = true; break; }
  }
  if (!hit) return overrides;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(overrides)) {
    if (!isBindingToken(overrides[k])) out[k] = overrides[k];
  }
  return out as T;
}

/**
 * Read a zone's bindings — both shapes, plus legacy tokens. A field bound in
 * `posItemBindings` wins over a token for the same key; a token with no entry
 * (a board saved by an older builder) still counts.
 */
export function parseMenuBindings(posItemBindings: unknown, textOverrides?: unknown): MenuBindings {
  const slots: Record<string, string> = {};
  const fields: Record<string, FieldBinding> = {};
  if (isPlainObject(posItemBindings)) {
    for (const rawKey of Object.keys(posItemBindings)) {
      const key = rawKey.trim();
      if (!key) continue;
      const v = posItemBindings[rawKey];
      if (typeof v === 'string') {
        const id = cleanId(v);
        if (id) slots[key] = id;
      } else if (isPlainObject(v)) {
        const id = cleanId(v.externalId);
        const field = normalizeField(v.field);
        if (id && field) fields[key] = { externalId: id, field };
      }
    }
  }
  if (isPlainObject(textOverrides)) {
    for (const key of Object.keys(textOverrides)) {
      if (fields[key]) continue;
      const b = parseBindingToken(textOverrides[key]);
      if (b) fields[key] = b;
    }
  }
  return { slots, fields };
}

export function countMenuBindings(b: MenuBindings): number {
  return Object.keys(b.slots).length + Object.keys(b.fields).length;
}

/** `item.3.price` → the slot it belongs to (`item.3`) and its leaf, when the leaf follows a row. */
export function slotOfField(key: string): { slot: string; leaf: RowLeaf } | null {
  const dot = key.lastIndexOf('.');
  if (dot <= 0) return null;
  const leaf = key.slice(dot + 1);
  if (leaf !== 'name' && leaf !== 'price' && leaf !== 'desc') return null;
  return { slot: key.slice(0, dot), leaf };
}

/** The `data-menu-row` number of an `item.N` slot (what the server stamps on an AI board's row). */
export function rowNumberOfSlot(slot: string): string | null {
  const m = /^item\.(\d{1,4})$/.exec(slot);
  return m ? m[1] : null;
}

// ─── On-glass words ───────────────────────────────────────────────────────

export interface GlassLabels {
  soldOut: string;
  unavailable: string;
}

/** The words a board shows its audience, in the board's own language. */
export const GLASS_LABELS: Readonly<Record<'en' | 'es' | 'zh', GlassLabels>> = {
  en: { soldOut: 'Sold out', unavailable: 'Not available' },
  es: { soldOut: 'Agotado', unavailable: 'No disponible' },
  zh: { soldOut: '已售罄', unavailable: '暂不供应' },
};

export function glassLabelsFor(lang?: string | null): GlassLabels {
  const tag = String(lang || '').trim().toLowerCase();
  if (tag === 'es' || tag.startsWith('es-')) return GLASS_LABELS.es;
  if (tag === 'zh' || tag.startsWith('zh-')) return GLASS_LABELS.zh;
  return GLASS_LABELS.en;
}

/** `<html lang="es-MX">` → `es-MX`. The board declares its audience's language. */
export function boardLangOf(html: unknown): string | null {
  if (typeof html !== 'string' || !html) return null;
  const m = /<html\b[^>]*?\blang\s*=\s*["']?([A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*)/i.exec(html.slice(0, 4000));
  return m ? m[1] : null;
}

// ─── Resolution ───────────────────────────────────────────────────────────

/** One item of the live menu feed (usePosMenuItems' PosMenuItem, structurally). */
export interface LiveMenuItem {
  externalId?: string | null;
  name: string;
  price?: string | null;
  desc?: string | null;
  available?: boolean;
}

export type BindingState = 'live' | 'soldout' | 'missing';

export interface ResolvedBindingRow {
  slot: string;
  externalId: string;
  state: BindingState;
  /** The text each leaf should show. A leaf left out keeps what the board says. */
  text: Partial<Record<RowLeaf, string>>;
}

export interface ResolvedBindingField {
  key: string;
  externalId: string;
  field: BoundField;
  state: BindingState;
  /** null = keep what the board says. */
  text: string | null;
}

export interface ResolvedMenuBindings {
  /** false: there is no menu to resolve against — every board keeps its own text. */
  hasMenu: boolean;
  rows: ResolvedBindingRow[];
  fields: ResolvedBindingField[];
}

/** Natural order, so `item.10` sorts after `item.9`. */
function naturalKeyOrder(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}

/** The state of one bound item in a menu we have. */
export function bindingStateOf(item: LiveMenuItem | undefined): BindingState {
  if (!item) return 'missing';
  return item.available === false ? 'soldout' : 'live';
}

/** What one bound value shows, per the rules in the header. null = keep the board's own text. */
export function boundText(
  field: BoundField,
  state: BindingState,
  item: LiveMenuItem | undefined,
  labels: GlassLabels,
): string | null {
  const nonEmpty = (v: unknown): string | null => {
    const s = typeof v === 'string' ? v.trim() : '';
    return s ? s : null;
  };
  switch (field) {
    case 'name':
      return state === 'missing' ? null : nonEmpty(item?.name);
    case 'desc':
      return state === 'missing' ? null : nonEmpty(item?.desc);
    case 'price':
      if (state === 'soldout') return labels.soldOut;
      if (state === 'missing') return labels.unavailable;
      return nonEmpty(item?.price);
    case 'available':
      if (state === 'soldout') return labels.soldOut;
      if (state === 'missing') return labels.unavailable;
      return '';
    default:
      return null;
  }
}

/** Index a menu by POS id; a duplicate id prefers the copy that is available. */
function indexMenu(items: readonly LiveMenuItem[]): Map<string, LiveMenuItem> {
  const byId = new Map<string, LiveMenuItem>();
  for (const it of items) {
    if (!it || typeof it.externalId !== 'string' || !it.externalId) continue;
    const prev = byId.get(it.externalId);
    if (!prev || (prev.available === false && it.available !== false)) byId.set(it.externalId, it);
  }
  return byId;
}

export function resolveMenuBindings(input: {
  bindings: MenuBindings;
  /** The live menu; null/undefined = not loaded / failed. */
  items: readonly LiveMenuItem[] | null | undefined;
  /** `menuSourceConfigured(items)`; false = no POS source behind this answer. */
  configured?: boolean;
  labels?: GlassLabels;
}): ResolvedMenuBindings {
  const hasMenu = Array.isArray(input.items) && input.configured !== false;
  if (!hasMenu) return { hasMenu: false, rows: [], fields: [] };
  const labels = input.labels || GLASS_LABELS.en;
  const byId = indexMenu(input.items as readonly LiveMenuItem[]);

  const rows: ResolvedBindingRow[] = [];
  for (const slot of Object.keys(input.bindings.slots).sort(naturalKeyOrder)) {
    const externalId = input.bindings.slots[slot];
    const item = byId.get(externalId);
    const state = bindingStateOf(item);
    const text: Partial<Record<RowLeaf, string>> = {};
    for (const leaf of ROW_LEAVES) {
      const t = boundText(leaf, state, item, labels);
      if (t !== null) text[leaf] = t;
    }
    rows.push({ slot, externalId, state, text });
  }

  const fields: ResolvedBindingField[] = [];
  for (const key of Object.keys(input.bindings.fields).sort(naturalKeyOrder)) {
    const b = input.bindings.fields[key];
    const item = byId.get(b.externalId);
    const state = bindingStateOf(item);
    fields.push({ key, externalId: b.externalId, field: b.field, state, text: boundText(b.field, state, item, labels) });
  }
  return { hasMenu: true, rows, fields };
}

/**
 * The resolved values as a flat `field key → text` map — what a board with its
 * own shim applies (`educms-overrides { text }`). A row slot expands to its
 * `<slot>.name|price|desc`; a single-field binding for the same key wins.
 */
export function resolvedBindingText(resolved: ResolvedMenuBindings): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of resolved.rows) {
    for (const leaf of ROW_LEAVES) {
      const t = row.text[leaf];
      if (typeof t === 'string') out[`${row.slot}.${leaf}`] = t;
    }
  }
  for (const f of resolved.fields) {
    if (f.text !== null) out[f.key] = f.text;
    else delete out[f.key];
  }
  return out;
}

/**
 * What an AI board's VOS-LIVE-MENU runtime receives (designer-safe-srcdoc.ts):
 * the FULL desired state. Anything it painted before and that is not listed
 * here goes back to the board's own words — so an unbind, or a menu that went
 * away, restores the snapshot.
 */
export interface DesignerPosPayload {
  v: 1;
  rows: Array<{
    slot: string;
    /** `data-menu-row` number for an `item.N` slot, else null. */
    row: string | null;
    s: BindingState;
    t: Partial<Record<RowLeaf, string>>;
  }>;
  fields: Array<{ key: string; t: string }>;
}

export function designerPosPayload(resolved: ResolvedMenuBindings): DesignerPosPayload {
  const fieldKeys = new Set(resolved.fields.map((f) => f.key));
  return {
    v: 1,
    rows: resolved.rows.map((r) => {
      const t: Partial<Record<RowLeaf, string>> = {};
      for (const leaf of ROW_LEAVES) {
        const v = r.text[leaf];
        // A single-field binding on the same key decides that field instead.
        if (typeof v === 'string' && !fieldKeys.has(`${r.slot}.${leaf}`)) t[leaf] = v;
      }
      return { slot: r.slot, row: rowNumberOfSlot(r.slot), s: r.state, t };
    }),
    fields: resolved.fields
      .filter((f): f is ResolvedBindingField & { text: string } => f.text !== null)
      .map((f) => ({ key: f.key, t: f.text })),
  };
}
