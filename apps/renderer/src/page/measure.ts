/**
 * The in-page measurement pass.
 *
 * ⚠️ `measurePage` is SERIALISED and run inside the board (page.evaluate). It
 * may not reference anything outside its own body — no imports, no module
 * constants, no TypeScript runtime helpers (the build targets ES2022, which
 * emits none; `test/unit/page-functions.test.ts` guards that). Types are free.
 *
 * It only OBSERVES: geometry in viewport px, computed styles in each element's
 * own CSS px, and the transform scale between them. Every judgement is made in
 * Node (src/metrics/assemble.ts).
 *
 * The one mutation it makes comes last, after the screenshot: a `data-fit`
 * element's inline font-size is lifted for one synchronous style read to learn
 * its stylesheet size, then restored; and font-probe elements get a marker
 * attribute so the CDP font probe can find them.
 */
import type {
  MeasureArgs,
  RawColor,
  RawFit,
  RawImage,
  RawPageMeasure,
  RawProbe,
  RawText,
  VRect,
} from './types.js';
import type { MenuMetrics } from '../contract.js';

export async function measurePage(args: MeasureArgs & { key: string }): Promise<RawPageMeasure> {
  const warnings: string[] = [];
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const hooks = (window as unknown as Record<string, { nativeSetTimeout: typeof setTimeout } | undefined>)[args.key];
  const later = hooks ? hooks.nativeSetTimeout : setTimeout;

  // ── small helpers ────────────────────────────────────────────────────────
  const styleCache = new Map<Element, CSSStyleDeclaration>();
  const cs = (el: Element): CSSStyleDeclaration => {
    let s = styleCache.get(el);
    if (!s) {
      s = getComputedStyle(el);
      styleCache.set(el, s);
    }
    return s;
  };
  const num = (v: string | null | undefined, fallback = 0): number => {
    const n = parseFloat(v ?? '');
    return Number.isFinite(n) ? n : fallback;
  };
  const rectOf = (r: { left: number; top: number; width: number; height: number }): VRect => ({
    x: r.left,
    y: r.top,
    w: r.width,
    h: r.height,
  });
  const intersectV = (a: VRect, b: VRect): VRect | null => {
    const x = Math.max(a.x, b.x);
    const y = Math.max(a.y, b.y);
    const r = Math.min(a.x + a.w, b.x + b.w);
    const bt = Math.min(a.y + a.h, b.y + b.h);
    return r > x && bt > y ? { x, y, w: r - x, h: bt - y } : null;
  };
  const areaOf = (r: VRect): number => Math.max(0, r.w) * Math.max(0, r.h);
  const viewport: VRect = { x: 0, y: 0, w: vw, h: vh };

  const cssEscape = (v: string): string => v.replace(/["\\]/g, '\\$&');
  const IDENT = /^[A-Za-z_][\w-]*$/;
  const selectorOf = (el: Element): string => {
    if (el.id && IDENT.test(el.id)) return `#${el.id}`;
    const field = el.getAttribute('data-field');
    if (field) return `[data-field="${cssEscape(field)}"]`;
    const parts: string[] = [];
    let e: Element | null = el;
    for (let depth = 0; e && e !== document.body && e !== document.documentElement && depth < 4; depth += 1) {
      if (e.id && IDENT.test(e.id)) {
        parts.unshift(`#${e.id}`);
        break;
      }
      let part = e.tagName.toLowerCase();
      const classes = (e.getAttribute('class') ?? '')
        .trim()
        .split(/\s+/)
        .filter((c) => IDENT.test(c))
        .slice(0, 2);
      if (classes.length > 0) part += `.${classes.join('.')}`;
      const parent: Element | null = e.parentElement;
      if (parent) {
        const same = Array.prototype.filter.call(parent.children, (c: Element) => c.tagName === e!.tagName) as Element[];
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(e) + 1})`;
      }
      parts.unshift(part);
      e = parent;
    }
    return parts.join(' > ').slice(0, 160) || el.tagName.toLowerCase();
  };
  const fieldOf = (el: Element): string | null => {
    const holder = el.closest('[data-field]');
    return holder ? holder.getAttribute('data-field') : null;
  };

  // Effective opacity (product up the tree), memoised.
  const opacityMemo = new Map<Element, number>();
  const effectiveOpacity = (el: Element | null): number => {
    if (!el) return 1;
    const hit = opacityMemo.get(el);
    if (hit !== undefined) return hit;
    const v = num(cs(el).opacity, 1) * effectiveOpacity(el.parentElement);
    opacityMemo.set(el, v);
    return v;
  };

  // Viewport px per CSS px: the transform / scale / zoom chain, memoised.
  const scaleMemo = new Map<Element, number>();
  const ownScale = (el: Element): number => {
    const s = cs(el);
    let k = 1;
    const t = s.transform;
    if (t && t !== 'none') {
      try {
        const m = new DOMMatrixReadOnly(t);
        const det = Math.abs(m.a * m.d - m.b * m.c);
        if (det > 0) k *= Math.sqrt(det);
      } catch {
        /* unparseable transform — treat as identity */
      }
    }
    const sc = (s as unknown as { scale?: string }).scale;
    if (sc && sc !== 'none') {
      const vals = sc.split(/\s+/).map((v) => num(v, 1));
      const sx = vals[0] ?? 1;
      const sy = vals[1] ?? sx;
      k *= Math.sqrt(Math.abs(sx * sy)) || 1;
    }
    const zoom = num((s as unknown as { zoom?: string }).zoom, 1);
    if (zoom > 0) k *= zoom;
    return k;
  };
  const chainScale = (el: Element | null): number => {
    if (!el) return 1;
    const hit = scaleMemo.get(el);
    if (hit !== undefined) return hit;
    const v = ownScale(el) * chainScale(el.parentElement);
    scaleMemo.set(el, v);
    return v;
  };

  // Colours → sRGB bytes, via a 1×1 canvas (handles every CSS colour syntax).
  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = 1;
  colorCanvas.height = 1;
  const cctx = colorCanvas.getContext('2d', { willReadFrequently: true });
  const colorCache = new Map<string, RawColor | null>();
  const parseColor = (value: string): RawColor | null => {
    if (colorCache.has(value)) return colorCache.get(value) ?? null;
    let out: RawColor | null = null;
    try {
      if (cctx && value && CSS.supports('color', value)) {
        cctx.clearRect(0, 0, 1, 1);
        cctx.fillStyle = '#000';
        cctx.fillStyle = value;
        cctx.fillRect(0, 0, 1, 1);
        const d = cctx.getImageData(0, 0, 1, 1).data;
        out = { r: d[0] as number, g: d[1] as number, b: d[2] as number, a: (d[3] as number) / 255 };
      }
    } catch {
      out = null;
    }
    colorCache.set(value, out);
    return out;
  };

  // Font ink metrics via canvas measureText, per font shorthand.
  const inkCanvas = document.createElement('canvas');
  const ictx = inkCanvas.getContext('2d');
  const inkMetrics = (s: CSSStyleDeclaration, sample: string) => {
    if (!ictx || !sample) return null;
    try {
      ictx.font = '10px monospace';
      const font = `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
      ictx.font = font;
      if (ictx.font === '10px monospace') return null;
      const m = ictx.measureText(sample);
      const fAsc = m.fontBoundingBoxAscent;
      const fDesc = m.fontBoundingBoxDescent;
      if (!(fAsc + fDesc > 0)) return null;
      return { asc: m.actualBoundingBoxAscent, desc: m.actualBoundingBoxDescent, fAsc, fDesc };
    } catch {
      return null;
    }
  };
  const applyTextTransform = (t: string, tt: string): string => {
    if (tt === 'uppercase') return t.toUpperCase();
    if (tt === 'lowercase') return t.toLowerCase();
    if (tt === 'capitalize') return t.replace(/(^|\s)(\S)/g, (_m, a: string, b: string) => a + b.toUpperCase());
    return t;
  };

  // ── clipping: which rect clips an element's CONTENT ──────────────────────
  interface Clipper {
    el: Element;
    rect: VRect;
    x: boolean;
    y: boolean;
  }
  interface ClipInfo {
    rect: VRect | null;
    clippers: Clipper[];
  }
  const NO_CLIP: ClipInfo = { rect: null, clippers: [] };
  const clipMemo = new Map<Element, ClipInfo>();
  const containingBlockOf = (el: Element): Element | null => {
    const pos = cs(el).position;
    if (pos !== 'absolute' && pos !== 'fixed') return el.parentElement;
    for (let a = el.parentElement; a; a = a.parentElement) {
      const s = cs(a);
      const establishes =
        s.transform !== 'none' ||
        s.filter !== 'none' ||
        s.perspective !== 'none' ||
        /paint|layout|strict|content/.test(s.contain || '') ||
        (s.willChange || '').includes('transform') ||
        (pos === 'absolute' && s.position !== 'static');
      if (establishes) return a;
    }
    return null;
  };
  const paddingBox = (el: Element): VRect => {
    const r = el.getBoundingClientRect();
    const s = cs(el);
    const k = chainScale(el);
    const bl = num(s.borderLeftWidth) * k;
    const br = num(s.borderRightWidth) * k;
    const bt = num(s.borderTopWidth) * k;
    const bb = num(s.borderBottomWidth) * k;
    return { x: r.left + bl, y: r.top + bt, w: Math.max(0, r.width - bl - br), h: Math.max(0, r.height - bt - bb) };
  };
  const clipFor = (el: Element | null): ClipInfo => {
    if (!el) return NO_CLIP;
    const hit = clipMemo.get(el);
    if (hit) return hit;
    const inherited = clipFor(containingBlockOf(el));
    let info = inherited;
    if (el !== document.documentElement && el !== document.body) {
      const s = cs(el);
      const paint = /paint|strict|content/.test(s.contain || '');
      const cx = paint || s.overflowX !== 'visible';
      const cy = paint || s.overflowY !== 'visible';
      if (cx || cy) {
        const pb = paddingBox(el);
        const own: VRect = {
          x: cx ? pb.x : -1e7,
          y: cy ? pb.y : -1e7,
          w: cx ? pb.w : 2e7,
          h: cy ? pb.h : 2e7,
        };
        const rect = inherited.rect ? intersectV(inherited.rect, own) ?? { x: own.x, y: own.y, w: 0, h: 0 } : own;
        info = { rect, clippers: inherited.clippers.concat([{ el, rect: own, x: cx, y: cy }]) };
      }
    }
    clipMemo.set(el, info);
    return info;
  };
  const excessPast = (rects: VRect[], edge: VRect) => {
    let top = 0;
    let right = 0;
    let bottom = 0;
    let left = 0;
    for (const r of rects) {
      top = Math.max(top, edge.y - r.y);
      left = Math.max(left, edge.x - r.x);
      right = Math.max(right, r.x + r.w - (edge.x + edge.w));
      bottom = Math.max(bottom, r.y + r.h - (edge.y + edge.h));
    }
    return { top, right, bottom, left };
  };
  const blockBoxOf = (el: Element): Element | null => {
    for (let e: Element | null = el; e; e = e.parentElement) {
      const d = cs(e).display;
      if (d !== 'inline' && d !== 'contents' && d !== 'none') return e;
    }
    return null;
  };

  // ── 1. TEXT ───────────────────────────────────────────────────────────────
  const root = document.body || document.documentElement;
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TITLE', 'TEXTAREA', 'OPTION', 'HEAD']);
  const groups = new Map<Element, Text[]>();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text;
    if (!/\S/.test(t.data)) continue;
    const parent = t.parentElement;
    if (!parent || SKIP.has(parent.tagName)) continue;
    let list = groups.get(parent);
    if (!list) {
      list = [];
      groups.set(parent, list);
    }
    list.push(t);
  }

  const texts: RawText[] = [];
  const textEls: Element[] = [];
  const range = document.createRange();
  let textLimitHit = false;
  for (const [el, nodes] of groups) {
    if (texts.length >= args.maxTexts) {
      textLimitHit = true;
      break;
    }
    const s = cs(el);
    if (s.visibility !== 'visible') continue;
    const lineRects: VRect[] = [];
    for (const node of nodes) {
      range.selectNodeContents(node);
      const rs = range.getClientRects();
      for (let i = 0; i < rs.length && lineRects.length < 80; i += 1) {
        const r = rs[i] as DOMRect;
        if (r.width >= 0.5 && r.height >= 0.5) lineRects.push(rectOf(r));
      }
    }
    if (lineRects.length === 0) continue;

    const raw = nodes.map((n) => n.data).join(' ').replace(/\s+/g, ' ').trim();
    const opacity = effectiveOpacity(el);
    const scale = chainScale(el);
    const fillStr = (s as unknown as { webkitTextFillColor?: string }).webkitTextFillColor || s.color;
    const fillColor = parseColor(fillStr);
    const bgClip = (s as unknown as { webkitBackgroundClip?: string }).webkitBackgroundClip || s.backgroundClip;
    const strokeWidth = num((s as unknown as { webkitTextStrokeWidth?: string }).webkitTextStrokeWidth);
    const effects = strokeWidth > 0 || (s.textShadow !== 'none' && s.textShadow !== '') || bgClip === 'text';
    const fill: RawColor | null =
      fillColor && fillColor.a > 0.02 ? { r: fillColor.r, g: fillColor.g, b: fillColor.b, a: fillColor.a * opacity } : null;
    if (!fill && !effects) continue; // transparent text with nothing to draw it

    // Ink boxes: the content-area rect trimmed to where glyphs actually are.
    const im = inkMetrics(s, applyTextTransform(raw.slice(0, 200), s.textTransform));
    let descentVp = 0;
    const inkRects = lineRects.map((r) => {
      if (!im) return r;
      const k = r.h / (im.fAsc + im.fDesc);
      const baseline = r.y + im.fAsc * k;
      const top = baseline - im.asc * k;
      const bottom = baseline + im.desc * k;
      if (bottom - top < 1) return r;
      descentVp = Math.max(descentVp, Math.max(0, im.desc * k));
      return { x: r.x, y: top, w: r.w, h: bottom - top };
    });

    const clip = clipFor(el);
    const visibleRects: VRect[] = [];
    for (const r of inkRects) {
      const a = clip.rect ? intersectV(r, clip.rect) : r;
      const b = a ? intersectV(a, viewport) : null;
      if (b) visibleRects.push(b);
    }
    const inkArea = inkRects.reduce((sum, r) => sum + areaOf(r), 0);
    const visibleArea = visibleRects.reduce((sum, r) => sum + areaOf(r), 0);

    // Clipped: the innermost clipper the ink runs past.
    const box = blockBoxOf(el);
    const fontVp = num(s.fontSize) * scale;
    let clipHit: RawText['clip'] = null;
    for (let i = clip.clippers.length - 1; i >= 0; i -= 1) {
      const c = clip.clippers[i] as Clipper;
      const ex = excessPast(inkRects, c.rect);
      const e = {
        top: c.y ? ex.top : 0,
        bottom: c.y ? ex.bottom : 0,
        left: c.x ? ex.left : 0,
        right: c.x ? ex.right : 0,
      };
      if (Math.max(e.top, e.bottom, e.left, e.right) > 0.5) {
        const kind: 'self' | 'ancestor' = c.el === el || c.el === box ? 'self' : 'ancestor';
        const coversViewport =
          c.rect.x <= 2 && c.rect.y <= 2 && c.rect.x + c.rect.w >= vw - 2 && c.rect.y + c.rect.h >= vh - 2;
        const survivors = inkRects.some((r) => intersectV(r, c.rect));
        // Distance from the clip box to the nearest ink, for text that is
        // entirely hidden: a price pushed just past a card's bottom edge is a
        // defect; a carousel slide parked 4000 px away is not.
        let gap = Infinity;
        for (const r of inkRects) {
          const dx = Math.max(c.rect.x - (r.x + r.w), r.x - (c.rect.x + c.rect.w), 0);
          const dy = Math.max(c.rect.y - (r.y + r.h), r.y - (c.rect.y + c.rect.h), 0);
          gap = Math.min(gap, Math.max(dx, dy));
        }
        clipHit = {
          kind,
          selector: selectorOf(c.el),
          ...e,
          coversViewport,
          fullyHidden: !survivors,
          nearEdge: survivors || gap <= Math.max(4, fontVp),
        };
        break;
      }
    }
    if (box) {
      const bs = cs(box);
      const ellipsis = bs.textOverflow === 'ellipsis' && (box as HTMLElement).scrollWidth > (box as HTMLElement).clientWidth + 1;
      const clamp =
        ((bs as unknown as { webkitLineClamp?: string }).webkitLineClamp ?? 'none') !== 'none' &&
        (box as HTMLElement).scrollHeight > (box as HTMLElement).clientHeight + 1;
      if (ellipsis || clamp) {
        const k = chainScale(box);
        clipHit = {
          kind: 'ellipsis',
          selector: selectorOf(box),
          top: 0,
          left: 0,
          right: ellipsis ? ((box as HTMLElement).scrollWidth - (box as HTMLElement).clientWidth) * k : 0,
          bottom: clamp ? ((box as HTMLElement).scrollHeight - (box as HTMLElement).clientHeight) * k : 0,
          coversViewport: false,
          fullyHidden: false,
          nearEdge: true,
        };
      }
    }

    // Visible spill past its own box, or past that box's parent (the fit
    // engine's own rule: an in-flow headline must stay inside its column).
    let boxOverflow: RawText['boxOverflow'] = null;
    if (box && box !== document.body && box !== document.documentElement && visibleRects.length > 0) {
      const candidates: Element[] = [box];
      const pos = cs(box).position;
      const parent = box.parentElement;
      if (pos !== 'absolute' && pos !== 'fixed' && parent && parent !== document.body && parent !== document.documentElement) {
        candidates.push(parent);
      }
      for (const c of candidates) {
        const ccs = cs(c);
        const ex = excessPast(visibleRects, paddingBox(c));
        const e = {
          top: ccs.overflowY === 'visible' ? ex.top : 0,
          bottom: ccs.overflowY === 'visible' ? ex.bottom : 0,
          left: ccs.overflowX === 'visible' ? ex.left : 0,
          right: ccs.overflowX === 'visible' ? ex.right : 0,
        };
        const worst = Math.max(e.top, e.bottom, e.left, e.right);
        if (worst > 0.5 && (!boxOverflow || worst > Math.max(boxOverflow.top, boxOverflow.bottom, boxOverflow.left, boxOverflow.right))) {
          boxOverflow = { selector: selectorOf(c), ...e };
        }
      }
    }

    // Past the canvas edge: measured on the ink that inner clippers let through.
    const clippedInk: VRect[] = [];
    for (const r of inkRects) {
      const a = clip.rect ? intersectV(r, clip.rect) : r;
      if (a) clippedInk.push(a);
    }
    const stage = excessPast(clippedInk, viewport);

    const family = s.fontFamily;
    const primaryFamily = (family.split(',')[0] ?? '').trim().replace(/^["']|["']$/g, '');
    texts.push({
      id: texts.length,
      field: fieldOf(el),
      selector: selectorOf(el),
      text: raw.slice(0, 60),
      chars: raw.replace(/\s+/g, '').length,
      hasWordChars: /[\p{L}\p{N}]/u.test(raw),
      fontSizeCss: num(s.fontSize),
      scale,
      primaryFamily,
      familyList: family,
      weight: s.fontWeight,
      style: s.fontStyle,
      fill,
      opacity,
      ariaHidden: el.closest('[aria-hidden="true"]') !== null,
      effects,
      inkRects,
      descentVp,
      visibleRects,
      inkArea,
      visibleArea,
      boxOverflow,
      clip: clipHit,
      stage,
    });
    textEls.push(el);
  }

  // ── 2. IMAGES ────────────────────────────────────────────────────────────
  const images: RawImage[] = [];
  const slotOf = (el: Element): string | null => el.getAttribute('data-imgslot') || el.getAttribute('data-img') || null;
  const summarizeSrc = (src: string): string => {
    if (/^data:/i.test(src)) {
      const head = src.slice(0, Math.max(5, Math.min(src.indexOf(','), 48)));
      return `${head.replace(/;base64$/i, '')} (${Math.round(src.length / 1024)} KB)`;
    }
    return src.length > 160 ? `${src.slice(0, 160)}…` : src;
  };
  const isVector = (src: string): boolean => /^data:image\/svg/i.test(src) || /\.svg(?:[?#]|$)/i.test(src);

  for (const img of Array.from(document.images)) {
    if (images.length >= args.maxImages) break;
    const s = cs(img);
    if (s.display === 'none') continue;
    const r = img.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const src = img.currentSrc || img.getAttribute('src') || '';
    const rect = intersectV(rectOf(r), viewport);
    images.push({
      kind: 'img',
      selector: selectorOf(img),
      slot: slotOf(img),
      src: summarizeSrc(src),
      naturalW: img.naturalWidth,
      naturalH: img.naturalHeight,
      broken: !src || (img.complete && img.naturalWidth === 0),
      vector: isVector(src),
      boxW: Math.max(0, img.clientWidth - num(s.paddingLeft) - num(s.paddingRight)),
      boxH: Math.max(0, img.clientHeight - num(s.paddingTop) - num(s.paddingBottom)),
      scale: chainScale(img),
      fit: s.objectFit || 'fill',
      rect,
      visible: !!rect && s.visibility === 'visible' && effectiveOpacity(img) > 0.05,
    });
  }

  // Background images: natural sizes need a load, so collect first.
  interface BgLayer {
    el: Element;
    url: string;
    size: string;
  }
  const layers: BgLayer[] = [];
  const all = document.body ? document.body.getElementsByTagName('*') : ([] as unknown as HTMLCollectionOf<Element>);
  const bgTargets: Element[] = [document.documentElement];
  if (document.body) bgTargets.push(document.body);
  for (let i = 0; i < all.length && i < 8000; i += 1) bgTargets.push(all[i] as Element);
  for (const el of bgTargets) {
    const s = cs(el);
    const bg = s.backgroundImage;
    if (!bg || bg === 'none' || bg.indexOf('url(') === -1) continue;
    const sizes = s.backgroundSize.split(',').map((v) => v.trim());
    const re = /url\((["']?)(.*?)\1\)/g;
    let layer = 0;
    // Layers are comma-separated at the top level; counting url()s against
    // the size list is exact whenever the layers are all images, and close
    // enough when a gradient sits between them.
    for (let m = re.exec(bg); m; m = re.exec(bg)) {
      if (layers.length >= args.maxImages * 2) break;
      layers.push({ el, url: m[2] as string, size: sizes[layer % sizes.length] ?? 'auto' });
      layer += 1;
    }
  }
  const naturals = new Map<string, { w: number; h: number; ok: boolean }>();
  await Promise.all(
    [...new Set(layers.map((l) => l.url))].map(
      (url) =>
        new Promise<void>((resolve) => {
          const probe = new Image();
          let done = false;
          const finish = (ok: boolean) => {
            if (done) return;
            done = true;
            naturals.set(url, { w: probe.naturalWidth, h: probe.naturalHeight, ok: ok && probe.naturalWidth > 0 });
            resolve();
          };
          later(() => finish(false), args.imageTimeoutMs);
          probe.onload = () => finish(true);
          probe.onerror = () => finish(false);
          probe.src = url;
          if (probe.complete && probe.naturalWidth > 0) finish(true);
        }),
    ),
  );
  for (const l of layers) {
    if (images.length >= args.maxImages) break;
    const nat = naturals.get(l.url) ?? { w: 0, h: 0, ok: false };
    const isRoot = l.el === document.documentElement || l.el === document.body;
    const r = isRoot ? { left: 0, top: 0, width: vw, height: vh } : l.el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const s = cs(l.el);
    const rect = intersectV(rectOf(r), viewport);
    images.push({
      kind: 'background',
      selector: isRoot ? l.el.tagName.toLowerCase() : selectorOf(l.el),
      slot: slotOf(l.el),
      src: summarizeSrc(l.url),
      naturalW: nat.w,
      naturalH: nat.h,
      broken: !nat.ok,
      vector: isVector(l.url),
      boxW: isRoot ? vw : (l.el as HTMLElement).clientWidth,
      boxH: isRoot ? vh : (l.el as HTMLElement).clientHeight,
      scale: isRoot ? 1 : chainScale(l.el),
      fit: l.size,
      rect,
      visible: !!rect && s.visibility === 'visible' && effectiveOpacity(l.el) > 0.05,
    });
  }

  // ── 3. FIT-ENGINE REPAIRS ────────────────────────────────────────────────
  const fit: RawFit = { vosFs: [], vgw: [], fitCol: [], dataFit: [] };
  const ownText = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
  for (const el of Array.from(document.querySelectorAll('[data-vos-fs]'))) {
    const original = num(el.getAttribute('data-vos-fs'));
    const current = num(cs(el).fontSize);
    if (original > 0 && current > 0) {
      fit.vosFs.push({ field: fieldOf(el), selector: selectorOf(el), text: ownText(el), originalCss: original, currentCss: current, scale: chainScale(el) });
    }
  }
  for (const el of Array.from(document.querySelectorAll('[data-vgw]'))) {
    const he = el as HTMLElement;
    fit.vgw.push({
      selector: selectorOf(el),
      originalW: num(el.getAttribute('data-vgw')),
      originalH: num(el.getAttribute('data-vgh')),
      currentW: he.offsetWidth,
      currentH: he.offsetHeight,
      dimmed: (he.style.opacity || '') === '0.2',
      scale: chainScale(el),
    });
  }
  for (const el of Array.from(document.querySelectorAll('[data-fit-col]'))) {
    const inline = (el as HTMLElement).style.transform || '';
    const m = /scale\(\s*([\d.]+)/.exec(inline);
    let s = m ? num(m[1], 1) : 1;
    if (!m) {
      const t = cs(el).transform;
      if (t && t !== 'none') {
        try {
          const mm = new DOMMatrixReadOnly(t);
          s = Math.sqrt(Math.abs(mm.a * mm.d - mm.b * mm.c)) || 1;
        } catch {
          s = 1;
        }
      }
    }
    fit.fitCol.push({ selector: selectorOf(el), field: fieldOf(el), scale: s });
  }

  // ── 4. COUNTS + MENU ─────────────────────────────────────────────────────
  const count = (sel: string) => document.querySelectorAll(sel).length;
  const counts = {
    dataField: count('[data-field]'),
    dataImgslot: count('[data-imgslot]'),
    dataMenuRow: count('[data-menu-row]'),
    dataPosItem: count('[data-pos-item]'),
    dataAction: count('[data-action]'),
  };
  const readable: Element[] = [];
  texts.forEach((t, i) => {
    if (t.visibleArea > 1 && t.opacity >= 0.2 && !t.ariaHidden) readable.push(textEls[i] as Element);
  });
  const showsText = (el: Element | null): boolean => !!el && readable.some((t) => t === el || el.contains(t));
  const isVisibleBox = (el: Element): boolean => {
    const r = el.getBoundingClientRect();
    return r.width >= 1 && r.height >= 1 && !!intersectV(rectOf(r), viewport) && cs(el).visibility === 'visible' && effectiveOpacity(el) >= 0.2;
  };
  const PRICE_TEXT = /(?:[$€£¥]\s?\d)|(?:\d+[.,]\d{2}\b)/;
  const menu: MenuMetrics = { rows: 0, rowsVisible: 0, rowsWithNameAndPrice: 0, rowProblems: [], posItems: counts.dataPosItem, items: 0, itemsWithNameAndPrice: 0 };
  for (const row of Array.from(document.querySelectorAll('[data-menu-row]'))) {
    menu.rows += 1;
    if (!isVisibleBox(row)) continue;
    menu.rowsVisible += 1;
    const name = row.querySelector('[data-field$=".name"],[data-field="name"],[data-menu-name],[data-pos-name]');
    let price = row.querySelector('[data-field$=".price"],[data-field="price"],[data-menu-price],[data-pos-price]');
    if (!price) {
      price = readable.find((t) => row.contains(t) && PRICE_TEXT.test(t.textContent ?? '')) ?? null;
    }
    const missing: Array<'name' | 'price'> = [];
    if (!showsText(name)) missing.push('name');
    if (!showsText(price)) missing.push('price');
    if (missing.length === 0) menu.rowsWithNameAndPrice += 1;
    else if (menu.rowProblems.length < 20) menu.rowProblems.push({ selector: selectorOf(row), field: fieldOf(row), missing });
  }
  const itemGroups = new Map<string, { name: Element[]; price: Element[] }>();
  for (const el of Array.from(document.querySelectorAll('[data-field^="item."]'))) {
    const m = /^item\.(\d+)\.(name|price)$/.exec(el.getAttribute('data-field') ?? '');
    if (!m) continue;
    let g = itemGroups.get(m[1] as string);
    if (!g) {
      g = { name: [], price: [] };
      itemGroups.set(m[1] as string, g);
    }
    (m[2] === 'name' ? g.name : g.price).push(el);
  }
  menu.items = itemGroups.size;
  for (const g of itemGroups.values()) {
    if (g.name.some((e) => showsText(e)) && g.price.some((e) => showsText(e))) menu.itemsWithNameAndPrice += 1;
  }

  // ── 5. FONTS ─────────────────────────────────────────────────────────────
  const fontFaces: RawPageMeasure['fontFaces'] = [];
  try {
    document.fonts.forEach((f) => {
      if (fontFaces.length < 400) {
        fontFaces.push({ family: f.family.replace(/^["']|["']$/g, ''), style: f.style, weight: f.weight, status: f.status });
      }
    });
  } catch {
    warnings.push('document.fonts could not be read');
  }
  const probes: RawProbe[] = [];
  const bySignature = new Map<string, RawText[]>();
  for (const t of texts) {
    if (t.visibleArea <= 1 || t.opacity < 0.2) continue;
    const sig = `${t.primaryFamily.toLowerCase()}|${t.weight}|${t.style}`;
    const list = bySignature.get(sig) ?? [];
    list.push(t);
    bySignature.set(sig, list);
  }
  for (const [signature, list] of bySignature) {
    list.sort((a, b) => b.chars - a.chars);
    for (const t of list.slice(0, 2)) {
      const probe = probes.length;
      (textEls[t.id] as Element).setAttribute(args.probeAttr, String(probe));
      probes.push({ probe, textId: t.id, signature });
    }
  }

  // ── 6. data-fit AUTHORED SIZES (last: the only style mutation) ───────────
  for (const el of Array.from(document.querySelectorAll('[data-fit]'))) {
    const he = el as HTMLElement;
    const inline = he.style.getPropertyValue('font-size');
    if (!inline) continue;
    const priority = he.style.getPropertyPriority('font-size');
    const rendered = num(getComputedStyle(el).fontSize);
    he.style.removeProperty('font-size');
    const authored = num(getComputedStyle(el).fontSize);
    he.style.setProperty('font-size', inline, priority);
    if (authored > 0 && rendered > 0) {
      fit.dataFit.push({ field: fieldOf(el), selector: selectorOf(el), text: ownText(el), authoredCss: authored, renderedCss: rendered, scale: chainScale(el) });
    }
  }

  return {
    viewport: { width: vw, height: vh, dpr: window.devicePixelRatio || 1 },
    texts,
    textLimitHit,
    images,
    fit,
    counts,
    menu,
    fontFaces,
    probes,
    warnings,
  };
}
