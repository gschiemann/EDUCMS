import { createRoot } from 'react-dom/client';
import { NativeImageCarousel } from '../src/components/widgets/NativeImageCarousel';

// Adapter only: timing, transitions and media rendering are the app's widget.
const slots = Array.from(document.querySelectorAll<HTMLElement>('[data-imgslot]'));
const roots = new Map<HTMLElement, ReturnType<typeof createRoot>>();
const defaults = new Map<HTMLElement, { fit: string; position: string }>();
const signatures = new Map<HTMLElement, string>();
function field(key: string) { return Array.from(document.querySelectorAll<HTMLElement>('[data-field]')).find((el) => el.dataset.field === key); }
function read(key: string) { return field(key)?.textContent.trim() || ''; }
function write(key: string, value: string) { const el = field(key); if (el && el.textContent !== value) el.textContent = value; }
function list(value: unknown): string[] { return typeof value === 'string' ? (value ? [value] : []) : Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && !!v.trim()) : []; }
function sources(key: string) { try { return list(JSON.parse(read(`media.${key}.slides`) || '[]')); } catch { return []; } }
let queued = false;
function sync() {
  const params = new URLSearchParams(location.search);
  slots.forEach((el) => {
    const key = el.dataset.imgslot!;
    // The injected edit shim understands lists too; leave exactly one timer.
    const legacy = el as HTMLElement & { __eduRot?: ReturnType<typeof setInterval> };
    if (legacy.__eduRot) { clearInterval(legacy.__eduRot); delete legacy.__eduRot; }
    if (!defaults.has(el)) {
      const style = getComputedStyle(el);
      defaults.set(el, { fit: style.backgroundSize, position: style.backgroundPosition });
    }
    const urls = sources(key);
    if (!urls.length) return; // A text wordmark remains editable text until replaced.
    if (!roots.has(el)) {
      const host = document.createElement('div');
      host.dataset.nativeCarouselHost = key;
      Object.assign(host.style, { position: 'absolute', top: '0', left: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '0' });
      el.appendChild(host);
      roots.set(el, createRoot(host));
    }
    const config = {
      urls, intervalMs: Math.max(2, Math.min(120, Number(read('carousel.intervalSeconds')) || 7)) * 1000,
      transition: read('carousel.transition') || 'fade',
      fitMode: read(`media.${key}.fit`) || defaults.get(el)!.fit || 'cover',
      objectPosition: read(`media.${key}.position`) || defaults.get(el)!.position,
      alt: read(`media.${key}.alt`) || el.getAttribute('aria-label') || '',
      paused: read(`media.${key}.mode`) !== 'carousel' || params.has('freeze') || read('carousel.autoplay') === 'no',
      showIndicators: false, noEntrance: true,
    };
    el.style.setProperty('background-image', 'none', 'important');
    el.classList.add('has-img');
    const signature = JSON.stringify(config);
    if (signatures.get(el) !== signature) {
      signatures.set(el, signature);
      roots.get(el)!.render(<NativeImageCarousel config={config} />);
    }
  });
}
function queue() { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; sync(); }); } }
function apply(payload: { img?: Record<string, unknown>; text?: Record<string, unknown> }) {
  for (const [key, value] of Object.entries(payload.img || {})) {
    write(`media.${key}.slides`, JSON.stringify(list(value)));
    if (!(payload.text && `media.${key}.mode` in payload.text)) write(`media.${key}.mode`, Array.isArray(value) && value.length > 1 ? 'carousel' : 'single');
  }
  queue();
}
function decode(raw: string | null) { try { return JSON.parse(decodeURIComponent(escape(atob((raw || '').replace(/-/g, '+').replace(/_/g, '/'))))); } catch { return {}; } }
const params = new URLSearchParams(location.search);
const text = decode(params.get('text'));
for (const [key, value] of Object.entries(text)) if (key.startsWith('media.') || key.startsWith('carousel.')) write(key, String(value));
apply({ img: decode(params.get('img')), text });
addEventListener('message', (event) => {
  if (event.source !== parent || event.data?.type !== 'educms-overrides') return;
  apply(event.data);
});
const controls = document.querySelector('[data-controls]');
if (controls) new MutationObserver(queue).observe(controls, { subtree: true, childList: true, characterData: true });
const stage = document.querySelector('.stage');
if (stage) new MutationObserver(queue).observe(stage, { subtree: true, attributes: true, attributeFilter: ['data-img'] });
sync();
document.fonts.ready.then(queue);
addEventListener('DOMContentLoaded', queue);
