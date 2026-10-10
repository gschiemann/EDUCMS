// Additive companion to all three packaged-board shims. No changes to a
// board's layout or playback until the operator saves a media style override.
type MediaStyle = { fit?: string; rotation?: number; hidden?: boolean };
export {};
const selector = '[data-imgslot],[data-posterslot],[data-img],[data-widget="image-slot"],[data-videoslot]';
const authored = new WeakMap<HTMLElement, { transform: string; priority: string; base: string; display: string; size: string; position: string; repeat: string }>();
const originalFits = new WeakMap<HTMLElement, string>();
const sourceDefaults = new Map<string, string | string[]>();
const paintedSourceNodes = new WeakSet<HTMLElement>();
const seenSources = { img: new Set<string>(), video: new Set<string>() };
let mediaStyles: Record<string, MediaStyle> = {};
const currentSources: { img?: Record<string, unknown>; video?: Record<string, unknown> } = {};
let editing = false;
function keyOf(el: HTMLElement) {
  return el.getAttribute('data-videoslot') || el.getAttribute('data-imgslot') || el.getAttribute('data-posterslot') || el.getAttribute('data-slot') || el.getAttribute('data-img') || '';
}
function slots() {
  return Array.from(document.querySelectorAll<HTMLElement>(selector)).filter(el => keyOf(el) && !el.closest('#venueos-fields,[data-controls]'));
}
function rememberSources() {
  slots().forEach(el => {
    const key = keyOf(el);
    if (sourceDefaults.has(key) || !el.getClientRects().length) return;
    const media = el.matches('img,video') ? el : el.querySelector('img,video');
    const slides = Array.from(document.querySelectorAll<HTMLElement>('[data-field]')).find(field => field.dataset.field === `media.${key}.slides`);
    if (slides) { try { sourceDefaults.set(key, JSON.parse(slides.textContent || '[]')); return; } catch { /* use the element's source */ } }
    sourceDefaults.set(key, media?.getAttribute('src') || media?.querySelector('source')?.getAttribute('src') || /url\(["']?([^"')]+)["']?\)/.exec(getComputedStyle(el).backgroundImage)?.[1] || '');
  });
}
function announce() {
  parent.postMessage({ type: 'educms-media-ready', slots: slots().map(el => {
    const video = el.hasAttribute('data-videoslot');
    const child = el.matches('img,video') ? el as HTMLImageElement | HTMLVideoElement : el.querySelector<HTMLImageElement | HTMLVideoElement>('img,video');
    const fit = child ? getComputedStyle(child).objectFit : getComputedStyle(el).backgroundSize;
    return { key: keyOf(el), kind: video ? 'video' : 'image', defaultFit: fit === 'contain' ? 'contain' : 'cover',
      hasSource: !!(child?.getAttribute('src') || child?.querySelector('source')?.getAttribute('src') || /url\(/.test(getComputedStyle(el).backgroundImage)) };
  }) }, '*');
}
function apply() {
  slots().forEach(el => {
    const style = mediaStyles[keyOf(el)];
    const children = el.matches('img,video') ? [el] : Array.from(el.querySelectorAll<HTMLElement>('img,video'));
    if (!style && !authored.has(el)) return;
    if (!authored.has(el)) authored.set(el, { transform: el.style.transform, priority: el.style.getPropertyPriority('transform'), base: getComputedStyle(el).transform, display: el.style.display, size: el.style.backgroundSize, position: el.style.backgroundPosition, repeat: el.style.backgroundRepeat });
    const original = authored.get(el)!;
    const rotation = typeof style?.rotation === 'number' && Number.isFinite(style.rotation) ? ((style.rotation % 360) + 360) % 360 : 0;
    if (rotation) el.style.setProperty('transform', `${original.base === 'none' ? '' : original.base} rotate(${rotation}deg)`, 'important');
    else if (original.transform) el.style.setProperty('transform', original.transform, original.priority);
    else el.style.removeProperty('transform');
    if (style?.fit === 'contain' || style?.fit === 'cover' || style?.fit === 'fill') {
      children.forEach(child => { if (!originalFits.has(child)) originalFits.set(child, child.style.objectFit); child.style.objectFit = style.fit!; });
      el.style.backgroundSize = style.fit === 'fill' ? '100% 100%' : style.fit;
      el.style.backgroundRepeat = 'no-repeat';
      el.style.backgroundPosition = 'center';
    } else {
      children.forEach(child => { if (originalFits.has(child)) child.style.objectFit = originalFits.get(child)!; });
      el.style.backgroundSize = original.size; el.style.backgroundPosition = original.position; el.style.backgroundRepeat = original.repeat;
    }
    el.style.display = style?.hidden === true ? 'none' : original.display;
  });
}
function readInitial() {
  try {
    const params = new URLSearchParams(location.search);
    for (const key of ['mediaStyles', 'img', 'video'] as const) {
      const encoded = params.get(key);
      if (!encoded) continue;
      const value = JSON.parse(decodeURIComponent(escape(atob(encoded.replace(/-/g, '+').replace(/_/g, '/')))));
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      if (key === 'mediaStyles') mediaStyles = value;
      else currentSources[key] = value;
    }
  } catch { /* Keep the authored design when an override cannot be decoded. */ }
}
function paintSources(data: { img?: Record<string, unknown>; video?: Record<string, unknown> }, newNodesOnly = false) {
  slots().forEach(el => {
    if (newNodesOnly && paintedSourceNodes.has(el)) return;
    const video = el.hasAttribute('data-videoslot');
    const map = video ? data.video : data.img;
    const key = keyOf(el);
    if (!map || !(key in map)) return;
    // The native carousel adapter owns its roots, playlists and timers.
    if (!video && document.documentElement.dataset.nativeCarousels === 'true') return;
    const value = map[key];
    const source = typeof value === 'string' ? value : Array.isArray(value) && typeof value[0] === 'string' ? value[0] : '';
    const media = video ? (el.matches('video') ? el as HTMLVideoElement : el.querySelector('video')) : el.matches('img') ? el as HTMLImageElement : null;
    if (media) {
      if (media.getAttribute('src') !== source) { if (source) media.setAttribute('src', source); else media.removeAttribute('src'); if (media instanceof HTMLVideoElement) media.load(); }
    } else if (!video) el.style.backgroundImage = source ? `url(${JSON.stringify(source)})` : '';
    if (!video) { el.classList.toggle('has-img', !!source); if (source) el.setAttribute('data-has-image', 'true'); else el.removeAttribute('data-has-image'); }
    paintedSourceNodes.add(el);
  });
}
addEventListener('message', event => {
  if (event.source !== parent || !event.data || typeof event.data !== 'object') return;
  const data = event.data;
  if (data.type === 'educms-media-request') announce();
  if (data.type === 'educms-edit-mode') editing = data.on === true;
  if (data.type === 'educms-overrides') {
    // Existing shims interpret a missing key as "leave it alone". Expand
    // keys removed by Undo to the authored source before those handlers run.
    rememberSources();
    for (const map of ['img', 'video'] as const) {
      if (!data[map] || typeof data[map] !== 'object') continue;
      Object.keys(data[map]).forEach(key => seenSources[map].add(key));
      for (const key of seenSources[map]) if (!(key in data[map])) data[map][key] = sourceDefaults.get(key) || '';
      currentSources[map] = { ...data[map] };
    }
    paintSources(currentSources);
    if (data.mediaStyles && typeof data.mediaStyles === 'object') mediaStyles = data.mediaStyles;
    apply();
    Promise.resolve().then(() => { paintSources(currentSources); apply(); }); // after legacy source painters
  }
}, true);
// This runs before legacy element handlers. Keep their click-to-edit message
// for the panel, and announce our typed selection even on older menu shims.
document.addEventListener('click', event => {
  if (!editing) return;
  const target = (event.target as Element | null)?.closest<HTMLElement>(selector);
  if (!target || !slots().includes(target)) return;
  const nestedField = (event.target as Element | null)?.closest('[data-field],[data-action]');
  if (nestedField && nestedField !== target && target.contains(nestedField)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  parent.postMessage({ type: 'educms-media-select', key: keyOf(target) }, '*');
  parent.postMessage({ type: 'educms-field-click', key: keyOf(target), kind: target.hasAttribute('data-videoslot') ? 'video' : 'img' }, '*');
}, true);
function ready() {
  rememberSources(); readInitial(); paintSources(currentSources); apply(); announce();
  Promise.resolve().then(() => { paintSources(currentSources); apply(); });
  // Kiosk screen swaps and native carousels create new media nodes later.
  new MutationObserver(() => {
    rememberSources();
    // Repaint new kiosk screens, without resetting an existing carousel's
    // current slide on every unrelated clock/text DOM update.
    paintSources(currentSources, true);
    if (Object.keys(mediaStyles).length) apply();
    if (editing) announce();
  }).observe(document.body, { childList: true, subtree: true });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, true); else ready();
