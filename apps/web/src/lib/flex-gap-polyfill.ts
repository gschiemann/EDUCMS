/**
 * Flexbox `gap` polyfill for NovaStar Taurus LED controllers (Chromium 83).
 *
 * Flex `gap` shipped in Chrome 84 (grid `gap` is older and DOES work on 83).
 * Our widget library has 200+ `display:flex; gap:…` callsites; on the Taurus
 * the gap is silently dropped and flex children butt together. Rather than
 * hand-edit every callsite (regression-prone, and gap→margin isn't a 1:1
 * context-free transform), we detect the missing support ONCE and convert
 * each flex container's gap to equivalent child margins at runtime.
 *
 * SAFETY / ZERO-REGRESSION:
 *  - Feature-detected: on every modern browser (Chrome/Safari/Firefox, Pi,
 *    standard Android boxes) flex gap IS supported, so this is a hard no-op —
 *    `applyFlexGapPolyfill()` returns immediately. It only ever does work on
 *    Chromium <84.
 *  - Reads the COMPUTED column-/row-gap (already resolved to px by the
 *    engine even when it doesn't lay it out for flex) and applies it as
 *    margin-left / margin-top on every child after the first, honoring
 *    flex-direction. Idempotent via a data-attribute marker.
 *  - Does NOT fix container-query-unit gaps (`Ncqmin` etc.) — those are an
 *    unsupported UNIT on Chromium 83 (no computed px to read); they need a
 *    source-level replacement, handled separately.
 */

let flexGapSupported: boolean | null = null;

/** True if the engine lays out flex `gap`. Cached after first probe. */
export function isFlexGapSupported(): boolean {
  if (flexGapSupported !== null) return flexGapSupported;
  if (typeof document === 'undefined') return true; // SSR — assume modern
  try {
    const f = document.createElement('div');
    f.style.display = 'flex';
    f.style.flexDirection = 'column';
    f.style.rowGap = '1px';
    f.style.position = 'absolute';
    f.style.visibility = 'hidden';
    f.appendChild(document.createElement('div'));
    f.appendChild(document.createElement('div'));
    document.body.appendChild(f);
    // Two zero-height children + 1px row-gap → scrollHeight 1px iff gap applied.
    flexGapSupported = f.scrollHeight === 1;
    document.body.removeChild(f);
  } catch {
    flexGapSupported = true; // fail OPEN to modern behavior — never churn the DOM on error
  }
  return flexGapSupported;
}

const MARK = 'data-flexgap-fixed';

/**
 * Convert flex `gap` to child margins inside `root`. No-op where flex gap is
 * natively supported. Safe to call repeatedly (re-applies after content swaps).
 */
export function applyFlexGapPolyfill(root: ParentNode | null = (typeof document !== 'undefined' ? document.body : null)): void {
  if (!root || isFlexGapSupported()) return;
  let els: HTMLElement[];
  try {
    els = Array.from(root.querySelectorAll<HTMLElement>('*'));
  } catch {
    return;
  }
  for (const el of els) {
    // Skip already-processed elements BEFORE the (costly) getComputedStyle so
    // repeat passes on the 24/7 player only touch newly-mounted content.
    if (el.hasAttribute(MARK)) continue;
    let cs: CSSStyleDeclaration;
    try {
      cs = getComputedStyle(el);
    } catch {
      continue;
    }
    if (cs.display !== 'flex' && cs.display !== 'inline-flex') continue;
    const colGap = parseFloat(cs.columnGap || '') || 0;
    const rowGap = parseFloat(cs.rowGap || '') || 0;
    if (!colGap && !rowGap) {
      el.setAttribute(MARK, '0'); // flex but no gap — mark so we skip it next pass
      continue;
    }

    const isColumn = cs.flexDirection.startsWith('column');
    const gapPx = isColumn ? rowGap : colGap;
    el.setAttribute(MARK, `${isColumn ? 'c' : 'r'}:${gapPx}`);
    if (!gapPx) continue;

    const kids = Array.from(el.children) as HTMLElement[];
    kids.forEach((kid, i) => {
      if (i === 0) return;
      if (isColumn) kid.style.marginTop = `${gapPx}px`;
      else kid.style.marginLeft = `${gapPx}px`;
    });
  }
}
