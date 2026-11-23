/**
 * Spell check by default on the dashboard's free-text fields.
 *
 * The owner asked for spell check "everywhere … even when I'm typing the
 * screen group names". Nothing in the app turned it off globally, but browser
 * defaults differ: Chrome and Safari check single-line text inputs on their
 * own, Firefox checks only multi-line controls unless the field says
 * `spellcheck="true"`. This module makes the default explicit and the same on
 * every engine, using the browser's own dictionary — no bundle, no network,
 * no AI. It changes nothing else: autocorrect and autocapitalize are left
 * exactly as each field declares them (spell check underlines a word; it never
 * rewrites what was typed).
 *
 * How: one capture-phase `focusin` listener on the document. When a field that
 * holds words receives focus and has no `spellcheck` attribute of its own (or
 * inherited from an ancestor), the listener sets `spellcheck="true"` on it.
 *
 * Why this is safe beside React: React only writes the attributes it
 * rendered. A field that React renders with `spellCheck={false}` already has
 * the attribute, so this module never touches it, and the existing opt-outs
 * stay opt-outs. A field rendered without `spellCheck` has no attribute React
 * owns, so setting one is invisible to reconciliation: React never reads it
 * back, never warns about it (the listener is installed after hydration, from
 * an effect), and if a later render does pass `spellCheck`, React's own write
 * wins, which is the right direction.
 *
 * Mounted once, from `DashboardLayout` (the chrome of every `/[schoolId]/*`
 * page). Screen surfaces — /player, /board, /ribbon, /scorebug, /overlay,
 * /pair — never import it: they are separate routes outside that layout, and
 * `tests/e2e/spellcheck-default.spec.ts` proves nothing is installed there.
 * Cost: one listener, no timers, no polling, no per-field listeners; the
 * handler is a handful of attribute reads on the focused element only.
 */

/** Any element inside a node carrying this attribute is left alone. */
export const NO_SPELLCHECK_ATTR = 'data-no-spellcheck';

/**
 * `inputmode` values that announce a non-word value. `search` is included on
 * purpose: a search or filter box holds query fragments, names and IDs, a
 * typo there shows itself as "no results", and the text is never saved or
 * put on a screen — red underlines would be noise, not help. `none` is a
 * field driven by a custom picker or keypad.
 */
const SKIP_INPUT_MODES = new Set(['numeric', 'decimal', 'tel', 'email', 'url', 'search', 'none']);

/** `autocomplete` tokens that announce a credential, code or address-like value. */
const SKIP_AUTOCOMPLETE_TOKENS = new Set([
  'email',
  'username',
  'url',
  'tel',
  'one-time-code',
  'current-password',
  'new-password',
  'postal-code',
]);

function autocompleteSkips(value: string | null): boolean {
  if (!value) return false;
  for (const raw of value.toLowerCase().split(/\s+/)) {
    if (!raw) continue;
    if (SKIP_AUTOCOMPLETE_TOKENS.has(raw)) return true;
    // `tel-national`, `tel-local`, … and every card field (`cc-number`, …).
    if (raw.startsWith('tel-') || raw.startsWith('cc-')) return true;
  }
  return false;
}

function isContentEditableHost(el: Element): boolean {
  const ce = el.getAttribute('contenteditable');
  if (ce === null) return false;
  const v = ce.trim().toLowerCase();
  return v === '' || v === 'true' || v === 'plaintext-only';
}

/**
 * True when `el` is a free-text field that should get `spellcheck="true"`.
 * Pure: reads attributes only, never writes.
 */
export function shouldSpellcheck(el: Element | null | undefined): boolean {
  if (!el || typeof el.getAttribute !== 'function') return false;
  // An explicit choice on the field — or inherited from an ancestor, because
  // `spellcheck` inherits — always wins. The existing `spellCheck={false}`
  // opt-outs stay off; a wrapper that turned it off keeps it off.
  if (el.closest('[spellcheck]')) return false;
  if (el.closest(`[${NO_SPELLCHECK_ATTR}]`)) return false;

  const tag = el.tagName.toLowerCase();
  if (tag === 'textarea' || tag === 'input') {
    if (el.hasAttribute('readonly') || el.hasAttribute('disabled')) return false;
    if (tag === 'input') {
      // Only `type="text"` or no type. url, email, search, password, number,
      // tel, date, colour, … all hold something other than words.
      const type = (el.getAttribute('type') ?? '').trim().toLowerCase();
      if (type !== '' && type !== 'text') return false;
      // A `pattern` constrains the value to a format (a code, an ID).
      if (el.hasAttribute('pattern')) return false;
    }
    const mode = (el.getAttribute('inputmode') ?? '').trim().toLowerCase();
    if (SKIP_INPUT_MODES.has(mode)) return false;
    if (autocompleteSkips(el.getAttribute('autocomplete'))) return false;
    return true;
  }

  return isContentEditableHost(el);
}

let listener: ((e: FocusEvent) => void) | null = null;
let installs = 0;

/**
 * Install the document-level default. Idempotent and reference-counted, so a
 * Strict Mode double mount (or a second caller) still leaves exactly one
 * listener. Returns the uninstaller, suitable as a `useEffect` cleanup.
 */
export function installSpellcheckDefault(doc: Document | null = typeof document !== 'undefined' ? document : null): () => void {
  if (!doc) return () => {};
  installs += 1;
  if (!listener) {
    listener = (e: FocusEvent) => {
      const target = e.target;
      if (target instanceof Element && shouldSpellcheck(target)) {
        target.setAttribute('spellcheck', 'true');
      }
    };
    doc.addEventListener('focusin', listener, true);
  }
  let done = false;
  return () => {
    if (done) return;
    done = true;
    installs -= 1;
    if (installs <= 0 && listener) {
      doc.removeEventListener('focusin', listener, true);
      listener = null;
      installs = 0;
    }
  };
}
