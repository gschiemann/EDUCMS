// Fonts are document resources: loading a face in the parent editor does not
// make it available inside a sandboxed board. Keep all three board protocols
// on the same font-loading path without replacing their existing edit shims.
const googleFonts = new Set([
  'Inter', 'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Poppins',
  'Oswald', 'Raleway', 'Nunito', 'Source Sans Pro', 'Playfair Display',
  'Merriweather', 'Bebas Neue', 'Caveat', 'Pacifico',
  'Fraunces', 'DM Sans', 'IBM Plex Mono', 'Archivo', 'Archivo Black',
  'Barlow Condensed', 'Instrument Sans', 'Newsreader', 'Manrope',
  'Cormorant Garamond', 'Hanken Grotesk', 'Space Grotesk', 'Sora',
  'Fredoka', 'JetBrains Mono', 'Baloo 2', 'Space Mono', 'Bricolage Grotesque',
]);
const requested = new Set<string>();
const themeFont = /^theme\.f(?:Display|Head|Body|Mono)$/;

function ensureFont(value: unknown) {
  if (typeof value !== 'string') return;
  const family = value.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
  if (!googleFonts.has(family) || requested.has(family)) return;
  requested.add(family);
  const alreadyDeclared = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')).some(link => {
    try { return decodeURIComponent(link.href).replace(/\+/g, ' ').includes(`family=${family}`); }
    catch { return false; }
  });
  if (alreadyDeclared) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.dataset.eduBoardFont = family;
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}&display=swap`;
  link.addEventListener('load', () => {
    if (document.fonts) document.fonts.load(`60px "${family}"`).then(() => {
      // Existing board resize handlers refit automatic text and preserve
      // explicit operator sizes after the actual face replaces its fallback.
      window.dispatchEvent(new Event('resize'));
    }).catch(() => { /* The authored fallback remains usable offline. */ });
  });
  (document.head || document.documentElement).appendChild(link);
}

function applyFonts(data: Record<string, unknown>) {
  for (const name of ['textStyles', 'styles']) {
    const styles = data[name];
    if (!styles || typeof styles !== 'object') continue;
    Object.values(styles).forEach(style => {
      if (style && typeof style === 'object') ensureFont((style as { fontFamily?: unknown }).fontFamily);
    });
  }
  for (const name of ['text', 'fields']) {
    const fields = data[name];
    if (!fields || typeof fields !== 'object') continue;
    Object.entries(fields).forEach(entry => { if (themeFont.test(entry[0])) ensureFont(entry[1]); });
  }
  const brand = data.brand;
  if (brand && typeof brand === 'object') {
    ['fontHeading', 'fontBody', 'fontMono'].forEach(key => ensureFont((brand as Record<string, unknown>)[key]));
  }
}

export function installBoardFontControls() {
  addEventListener('message', event => {
    if (event.source !== parent || !event.data || typeof event.data !== 'object') return;
    if (['educms-overrides', 'template-apply-styles'].includes(event.data.type)) applyFonts(event.data);
    if (event.data.type === 'holiday:setField' && themeFont.test(event.data.key || '')) ensureFont(event.data.value);
  });
  const start = () => {
    const params = new URLSearchParams(location.search);
    const initial: Record<string, unknown> = {};
    for (const key of ['textStyles', 'text', 'brand']) {
      try {
        const value = params.get(key);
        if (value) initial[key] = JSON.parse(decodeURIComponent(escape(atob(value.replace(/-/g, '+').replace(/_/g, '/')))));
      } catch { /* Invalid query data must leave the authored board intact. */ }
    }
    applyFonts(initial);
    const theme = document.querySelector('[data-widget="theme"]');
    if (!theme) return;
    const readTheme = () => theme.querySelectorAll<HTMLElement>('[data-field]').forEach(field => {
      if (themeFont.test(field.dataset.field || '')) ensureFont(field.textContent);
    });
    readTheme();
    new MutationObserver(readTheme).observe(theme, { subtree: true, childList: true, characterData: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}
