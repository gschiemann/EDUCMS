import { beginInlineTextEdit } from '../src/lib/inline-text-edit';

// Uses the existing board selection, style transport and native canvas typing.
let editing = false;
let styles: Record<string, Record<string, unknown>> = {};
let scheduled = false;
const managed = new WeakMap<HTMLElement, Set<string>>();
const properties: Record<string, string> = { fontSize: 'font-size', fontFamily: 'font-family', fontWeight: 'font-weight', fontStyle: 'font-style', color: 'color', textAlign: 'text-align', lineHeight: 'line-height', letterSpacing: 'letter-spacing', textDecoration: 'text-decoration' };
const validKey = (key: string) => /^property\.[a-zA-Z]+$/.test(key) || /^tenant\..+\.(name|suite)$/.test(key);
function fields() {
  return Array.from(document.querySelectorAll<HTMLElement>('.canvas [data-field]')).filter(node => validKey(node.dataset.field || '') && node.getClientRects().length && !node.closest('[hidden]'));
}
function announce() {
  const nodes = fields();
  parent.postMessage({ type: 'educms-layout-ready', keys: nodes.map(node => node.dataset.field), fontSizes: Object.fromEntries(nodes.map(node => [node.dataset.field, parseFloat(getComputedStyle(node).fontSize)])) }, '*');
}
function apply() {
  for (const node of fields()) {
    const explicit = styles[node.dataset.field!] || {};
    const before = managed.get(node) || new Set<string>();
    const next = new Set<string>();
    for (const [key, property] of Object.entries(properties)) {
      const raw = explicit[key] ?? explicit[property];
      if (typeof raw !== 'string' && typeof raw !== 'number') { if (before.has(property)) node.style.removeProperty(property); continue; }
      const value = typeof raw === 'number' && ['fontSize', 'letterSpacing'].includes(key) ? `${raw}px` : String(raw);
      if (!CSS.supports(property, value)) continue;
      // Explicit customer choices must win over the directory's automatic fit CSS.
      node.style.setProperty(property, value, 'important'); next.add(property);
      // WebKit keeps the adaptive var() font even with an inline !important
      // font-size. Override that same variable on this field as well.
      if (property === 'font-size' && node.matches('.tenant-name,.entry-suite b')) { node.style.setProperty('--entry-font', value, 'important'); next.add('--entry-font'); }
    }
    if (before.has('--entry-font') && !next.has('--entry-font')) node.style.removeProperty('--entry-font');
    managed.set(node, next);
  }
  if (editing) announce();
}
function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => { scheduled = false; apply(); });
}
try {
  const encoded = new URLSearchParams(location.search).get('textStyles');
  if (encoded) { const value = JSON.parse(decodeURIComponent(escape(atob(encoded.replace(/-/g, '+').replace(/_/g, '/'))))); if (value && typeof value === 'object' && !Array.isArray(value)) styles = value; }
} catch { /* no saved styles */ }
addEventListener('message', event => {
  if (event.source !== parent || !event.data || typeof event.data !== 'object') return;
  const message = event.data;
  if (message.type === 'educms-edit-mode') { editing = message.on === true; if (editing) announce(); }
  if (message.type === 'educms-layout-request') announce();
  if (message.type === 'educms-overrides' && message.textStyles && typeof message.textStyles === 'object' && !Array.isArray(message.textStyles)) { styles = message.textStyles; schedule(); }
});
window.addEventListener('click', event => {
  if (!editing) return;
  const node = (event.target as Element | null)?.closest<HTMLElement>('[data-field]');
  if (!node || !fields().includes(node)) return;
  if (node.isContentEditable) { event.stopImmediatePropagation(); return; }
  event.preventDefault(); event.stopImmediatePropagation();
  announce();
  parent.postMessage({ type: 'educms-field-select', key: node.dataset.field }, '*');
  parent.postMessage({ type: 'educms-field-click', key: node.dataset.field, kind: 'text', text: node.textContent, inline: true }, '*');
  beginInlineTextEdit(node, value => parent.postMessage({ type: 'arc-directory-text-change', key: node.dataset.field, value }, '*'), node.dataset.field!.endsWith('.suite') ? 16 : node.dataset.field!.startsWith('tenant.') ? 180 : 1200);
}, true);
new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, characterData: true });
document.fonts.ready.then(schedule);
apply(); announce();
