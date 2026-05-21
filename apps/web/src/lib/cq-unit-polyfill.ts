/**
 * Container-query LENGTH-UNIT polyfill for Chromium < 105 (NovaStar Taurus =
 * Chrome 83; some boxes are 95/101 — all < 105). `cqw`/`cqh`/`cqmin`/`cqmax`
 * (and logical `cqi`/`cqb`) shipped in Chrome 105. Below that they're an
 * INVALID unit — any value containing one (e.g. `clamp(30px, 30cqh, 180px)`)
 * becomes invalid and the property falls back to inherited/initial, so text
 * and icons render at the wrong size.
 *
 * This resolves cq units in INLINE styles (React `style={{}}` props) to px at
 * runtime, relative to the element's nearest `container-type` ancestor (the
 * same box the browser would query). `<style>`-block CSS rules are handled
 * separately via an `@supports`-gated source fallback — CSSOM rewriting can't
 * resolve a shared rule's value per-element cheaply.
 *
 * ZERO modern-browser / demo risk: feature-detected. On any engine that
 * supports cq units (Chrome 105+, Safari 16+, Firefox 110+ — i.e. every modern
 * box) this is a hard no-op and does nothing. It ONLY runs on < 105.
 */

let cqSupported: boolean | null = null;

export function isCqUnitSupported(): boolean {
  if (cqSupported !== null) return cqSupported;
  if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') {
    cqSupported = true; // can't feature-detect → assume modern, do nothing
    return cqSupported;
  }
  // CSS.supports returns false for cq units on engines that lack them.
  cqSupported = CSS.supports('width', '1cqh') || CSS.supports('width', '1cqw');
  return cqSupported;
}

/** Nearest ancestor that establishes a size/inline-size container. */
function nearestSizeContainer(el: HTMLElement): HTMLElement | null {
  let p: HTMLElement | null = el.parentElement;
  while (p) {
    let ct = '';
    try {
      ct = getComputedStyle(p).getPropertyValue('container-type').trim();
    } catch {
      /* ignore */
    }
    if (ct && ct !== 'normal') return p;
    p = p.parentElement;
  }
  return null;
}

// Matches a number immediately followed by a cq length unit.
const CQ_RE = /(-?\d*\.?\d+)cq(w|h|i|b|min|max)\b/gi;
const MARK = 'data-cqfix';

/**
 * Resolve cq units in every inline style under `root`. Idempotent per element
 * (marked) — but a React re-render restores the original cq string AND drops
 * the marker, so the periodic re-run (see the player effect) re-fixes it.
 */
export function applyCqUnitPolyfill(root: ParentNode | null = (typeof document !== 'undefined' ? document.body : null)): void {
  if (!root || isCqUnitSupported()) return;
  let els: HTMLElement[];
  try {
    els = Array.from(root.querySelectorAll<HTMLElement>('[style]'));
  } catch {
    return;
  }
  for (const el of els) {
    if (el.getAttribute(MARK) === '1') continue;
    const cssText = el.getAttribute('style') || '';
    if (!/cq(w|h|i|b|min|max)/i.test(cssText)) continue;

    const container = nearestSizeContainer(el);
    const cw = container ? container.clientWidth : (typeof window !== 'undefined' ? window.innerWidth : 0);
    const ch = container ? container.clientHeight : (typeof window !== 'undefined' ? window.innerHeight : 0);
    if (!cw && !ch) continue; // container not laid out yet — try again next pass
    const cqw = cw / 100;
    const cqh = ch / 100;
    const cqmin = Math.min(cw, ch) / 100;
    const cqmax = Math.max(cw, ch) / 100;

    const fixed = cssText.replace(CQ_RE, (_m, num: string, unit: string) => {
      const n = parseFloat(num);
      const u = unit.toLowerCase();
      // Logical cqi≈cqw, cqb≈cqh for horizontal-tb (all our content).
      const base = u === 'w' || u === 'i' ? cqw : u === 'h' || u === 'b' ? cqh : u === 'min' ? cqmin : cqmax;
      const px = n * base;
      return Number.isFinite(px) ? `${px.toFixed(3)}px` : '0px';
    });
    if (fixed !== cssText) {
      el.setAttribute('style', fixed);
    }
    el.setAttribute(MARK, '1');
  }

  // Also handle cq units inside <style>-block CSS rules (e.g. ".hs-num {
  // font-size: clamp(22px, 42cqh, 36px) }"). getComputedStyle can't recover
  // the intended value (the invalid cq makes it fall back), so we read the
  // RULE text, resolve per matched element against its container, and write
  // the result as an inline override (which beats the class rule and — since
  // React doesn't manage these elements' inline styles — survives re-renders).
  resolveStyleBlockCq();
}

function resolveCq(value: string, cw: number, ch: number): string {
  const cqw = cw / 100;
  const cqh = ch / 100;
  const cqmin = Math.min(cw, ch) / 100;
  const cqmax = Math.max(cw, ch) / 100;
  return value.replace(CQ_RE, (_m, num: string, unit: string) => {
    const n = parseFloat(num);
    const u = unit.toLowerCase();
    const base = u === 'w' || u === 'i' ? cqw : u === 'h' || u === 'b' ? cqh : u === 'min' ? cqmin : cqmax;
    const px = n * base;
    return Number.isFinite(px) ? `${px.toFixed(3)}px` : '0px';
  });
}

function resolveStyleBlockCq(): void {
  let sheets: CSSStyleSheet[];
  try {
    sheets = Array.from(document.styleSheets) as CSSStyleSheet[];
  } catch {
    return;
  }
  for (const sheet of sheets) {
    let rules: CSSRuleList | null = null;
    try {
      rules = sheet.cssRules; // throws for cross-origin sheets → skip
    } catch {
      continue;
    }
    if (!rules) continue;
    for (let r = 0; r < rules.length; r++) {
      const rule = rules[r] as CSSStyleRule;
      if (!rule || !rule.selectorText || !rule.style) continue;
      const cssText = rule.style.cssText || '';
      if (!/cq(w|h|i|b|min|max)/i.test(cssText)) continue;

      // Collect just the cq-bearing declarations from this rule.
      const decls: Array<[string, string]> = [];
      for (let i = 0; i < rule.style.length; i++) {
        const prop = rule.style[i];
        const val = rule.style.getPropertyValue(prop);
        if (/cq(w|h|i|b|min|max)/i.test(val)) decls.push([prop, val]);
      }
      if (!decls.length) continue;

      let matched: NodeListOf<HTMLElement>;
      try {
        matched = document.querySelectorAll<HTMLElement>(rule.selectorText);
      } catch {
        continue;
      }
      matched.forEach((el) => {
        const container = nearestSizeContainer(el);
        const cw = container ? container.clientWidth : window.innerWidth;
        const ch = container ? container.clientHeight : window.innerHeight;
        if (!cw && !ch) return;
        for (const [prop, val] of decls) {
          el.style.setProperty(prop, resolveCq(val, cw, ch));
        }
      });
    }
  }
}
