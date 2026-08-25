/**
 * external-chat-fields — the chat-to-edit inventory for PACKAGED
 * EXTERNAL_HTML boards (B11 dead-end fix, 2026-08-24).
 *
 * The ~107 packaged boards under /public/templates render in a null-origin
 * sandboxed iframe; their editable copy is the set of [data-field] hooks the
 * panel's ExternalHtmlTextEditor already discovers by fetching the board HTML
 * and walking it with DOMParser (see PropertiesPanel.tsx — same first-text-
 * node rule, same dedupe). Chat-to-edit was blind to that inventory, so
 * "change the title to say Welcome" 422'd with "I couldn't turn that into an
 * edit" on every packaged board. This module gives ChatToEditBox the same
 * field list the form editor renders, so the AI can target board copy by key
 * and the server routes the edits into cfg.textOverrides — the exact
 * transport the form fields and the in-board shim already use.
 *
 * Config spans (clock./carousel./video./media./motion.) are SETTINGS, not
 * copy — the panel renders them as curated controls (BOARD_CONFIG_KEYS), and
 * chat must not let the model mangle them. Filtered by prefix here; keep the
 * prefixes in sync with the config-span families in PropertiesPanel.
 */

export interface ExternalChatField {
  key: string;
  label: string;
  /** EFFECTIVE text: operator override ?? the board's own default copy. */
  value: string;
}

const CONFIG_SPAN_RE = /^(clock|carousel|video|media|motion|config)\./;
const MAX_FIELDS = 48;

/** "menu.burger.title" / "recordHolderYear" → "Menu burger title" / "Record holder year". */
function humanizeKey(k: string): string {
  const spaced = k
    .replace(/[._-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : k;
}

/**
 * Parse a board's HTML into its chat-addressable copy fields. Pure —
 * unit-testable under jsdom. Mirrors ExternalHtmlTextEditor's discovery:
 * first non-empty text node wins (nested <small> etc. stay untouched),
 * duplicate keys keep the first occurrence.
 */
export function parseExternalChatFields(
  html: string,
  textOverrides: Record<string, string>,
): ExternalChatField[] {
  if (!html) return [];
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, 'text/html');
  } catch {
    return [];
  }
  const seen = new Set<string>();
  const out: ExternalChatField[] = [];
  doc.querySelectorAll('[data-field]').forEach((el) => {
    if (out.length >= MAX_FIELDS) return;
    const key = (el as HTMLElement).getAttribute('data-field') || '';
    if (!key || seen.has(key) || CONFIG_SPAN_RE.test(key)) return;
    seen.add(key);
    let defaultText = '';
    for (let i = 0; i < el.childNodes.length; i++) {
      const c = el.childNodes[i];
      if (c.nodeType === 3) {
        defaultText = (c.textContent || '').trim();
        if (defaultText) break;
      }
    }
    if (!defaultText) defaultText = (el.textContent || '').trim();
    const value = (typeof textOverrides[key] === 'string' && textOverrides[key] !== ''
      ? textOverrides[key]
      : defaultText
    ).slice(0, 400);
    out.push({ key, label: humanizeKey(key), value });
  });
  return out;
}

// One in-flight/settled fetch per board URL — the operator may press Go
// repeatedly while iterating; the HTML is a same-origin static file that
// never changes within a session.
const htmlCache = new Map<string, Promise<string>>();

/**
 * Fetch + parse a packaged board's chat field inventory from its zone
 * config. Returns [] on any failure (the caller degrades to an honest
 * "this board doesn't expose chat-editable text" message — never a throw).
 */
export async function fetchExternalChatFields(
  cfg: Record<string, any> | undefined,
): Promise<ExternalChatField[]> {
  const url = typeof cfg?.url === 'string' ? cfg.url.trim() : '';
  if (!url) return [];
  const overrides: Record<string, string> =
    cfg?.textOverrides && typeof cfg.textOverrides === 'object' && !Array.isArray(cfg.textOverrides)
      ? cfg.textOverrides
      : {};
  try {
    let p = htmlCache.get(url);
    if (!p) {
      p = fetch(url, { credentials: 'omit' }).then((res) => (res.ok ? res.text() : ''));
      htmlCache.set(url, p);
      // A failed fetch must not poison the cache for the session.
      p.catch(() => htmlCache.delete(url));
    }
    const html = await p;
    return parseExternalChatFields(html, overrides);
  } catch {
    return [];
  }
}
