/**
 * ES5 polyfills for WebViews older than Chrome 71 — the Android-9 Goodview
 * LCDs (2026-09-02).
 *
 * PROOF (real Chromium 68 via puppeteer 1.4, against the production player):
 * every chunk threw `ReferenceError: globalThis is not defined` at line 1.
 * Turbopack wraps each chunk in `globalThis`, which Chrome added in 71, so on
 * a Chrome-66 WebView the page paints its static shell and no script ever
 * runs — the exact "Connecting to your CMS…" forever the field saw. With
 * `globalThis` defined BEFORE the first chunk, the same build boots fully
 * (data-edu-booted="1", /screens/register fires, zero errors).
 *
 * PLACEMENT IS THE WHOLE FIX. Next emits its chunk `<script async>` tags at
 * the top of `<head>`, before anything a layout can render, and an async
 * script runs the moment it is fetched — from a local cache that is before
 * the parser reaches an inline shim further down. Next's own
 * `beforeInteractive` scripts are executed BY its runtime, i.e. after the
 * chunks, so they cannot help either. So `proxy.ts` serves `/player` to a
 * legacy UA with `injectLegacyPolyfills` applied: the polyfill becomes the
 * FIRST child of `<head>`, a synchronous script no async chunk can overtake.
 * The player layout still carries the same code in its late shim for
 * documents that bypass the proxy (belt and braces; harmless where native).
 *
 * SECOND FINDING, same day: with `globalThis` in place the Goodview reached
 * the ROOT error boundary — `ReferenceError: BigInt is not defined`, thrown
 * while a chunk EVALUATES (the validation library builds its int64 range
 * with BigInt("…") at module load, unguarded). BigInt shipped in Chrome 67;
 * puppeteer 1.2.0's 67.0.3372 reproduces the crash, 67.0.3391 boots. BigInt
 * cannot be polyfilled faithfully; the shim below returns a Number, which
 * is exactly enough for module-load range tables on a device that will
 * never see a bigint value, and throws where real BigInt would.
 *
 * Rules: ES5 only (no arrow functions, no `let`, no template literals), no
 * backslashes or backticks (this string is also interpolated into a template
 * literal), every polyfill a no-op where the API is native.
 */

export const LEGACY_POLYFILLS_JS: string = [
  "if(typeof globalThis==='undefined'){try{Object.defineProperty(Object.prototype,'__venueos_gt__',{get:function(){return this;},configurable:true});__venueos_gt__.globalThis=__venueos_gt__;delete Object.prototype.__venueos_gt__;}catch(e){window.globalThis=window;}}",
  "if(typeof BigInt==='undefined'){window.BigInt=function BigInt(v){if(typeof v==='number'){if(v!==Math.trunc(v))throw new RangeError('The number '+v+' cannot be converted to a BigInt because it is not an integer');return v;}var n=Number(String(v).trim());if(String(v).trim()===''||isNaN(n))throw new SyntaxError('Cannot convert '+v+' to a BigInt');return n;};window.BigInt.asIntN=function(b,v){return v;};window.BigInt.asUintN=function(b,v){return v;};}",
  "if(typeof window.queueMicrotask!=='function'){window.queueMicrotask=function(cb){Promise.resolve().then(cb).catch(function(e){setTimeout(function(){throw e;},0);});};}",
  "if(typeof Object.fromEntries!=='function'){Object.fromEntries=function(it){var o={};Array.from(it).forEach(function(kv){o[kv[0]]=kv[1];});return o;};}",
  "if(typeof Promise.allSettled!=='function'){Promise.allSettled=function(it){return Promise.all(Array.from(it).map(function(p){return Promise.resolve(p).then(function(v){return{status:'fulfilled',value:v};},function(e){return{status:'rejected',reason:e};});}));};}",
  "if(typeof Array.prototype.flat!=='function'){Array.prototype.flat=function(d){d=d===undefined?1:d;var out=[];(function go(a,k){for(var i=0;i<a.length;i++){var v=a[i];if(k>0&&Array.isArray(v))go(v,k-1);else out.push(v);}})(this,d);return out;};}",
  "if(typeof Array.prototype.flatMap!=='function'){Array.prototype.flatMap=function(f,t){return Array.prototype.map.call(this,f,t).flat(1);};}",
  "if(typeof String.prototype.matchAll!=='function'){String.prototype.matchAll=function(re){if(!(re instanceof RegExp)||!re.global)throw new TypeError('matchAll requires a global RegExp');var s=this,r=new RegExp(re.source,re.flags),out=[],m;while((m=r.exec(s))!==null){out.push(m);if(m[0]==='')r.lastIndex++;}return out[Symbol.iterator]();};}",
  "if(typeof window.WeakRef!=='function'){window.WeakRef=function(t){this.__t=t;};window.WeakRef.prototype.deref=function(){return this.__t;};}",
  "if(typeof window.FinalizationRegistry!=='function'){window.FinalizationRegistry=function(){};window.FinalizationRegistry.prototype.register=function(){};window.FinalizationRegistry.prototype.unregister=function(){};}",
].join('\n');

/** Attribute that marks the injected tag — also the idempotency key. */
export const LEGACY_POLYFILL_MARKER = 'data-edu-shim="legacy-polyfills"';

/** Response header the proxy sets so a curl from the field can prove the path. */
export const LEGACY_POLYFILL_RESPONSE_HEADER = 'x-venueos-legacy-polyfills';

/**
 * Chrome / Chromium / Android WebView with a major below 71 (`globalThis`
 * landed in 71). Any other UA — Safari, Firefox, no UA — is left alone.
 */
export function needsLegacyPolyfills(userAgent: string | null | undefined): boolean {
  const m = /(?:Chrome|Chromium|CriOS)\/(\d+)/.exec(userAgent || '');
  if (!m) return false;
  const major = Number(m[1]);
  return Number.isFinite(major) && major > 0 && major < 71;
}

/**
 * Put the polyfill in as the FIRST child of `<head>` — ahead of every async
 * chunk tag. Falls back to "before the first script" if a document has no
 * head, and never double-injects.
 */
export function injectLegacyPolyfills(html: string): string {
  if (html.includes(LEGACY_POLYFILL_MARKER)) return html;
  const tag = `<script ${LEGACY_POLYFILL_MARKER}>${LEGACY_POLYFILLS_JS}</script>`;
  const head = /<head(?:\s[^>]*)?>/i.exec(html);
  if (head) {
    const at = head.index + head[0].length;
    return html.slice(0, at) + tag + html.slice(at);
  }
  const firstScript = html.search(/<script[\s>]/i);
  if (firstScript >= 0) return html.slice(0, firstScript) + tag + html.slice(firstScript);
  return tag + html;
}

/**
 * ── LEGACY SPLASH CSS (Chrome < 79) ─────────────────────────────────────
 * With the scripts running, the Android-9 Goodview rendered the pairing
 * splash collapsed: no code tiles, buttons jammed together, spacing gone
 * (reproduced pixel-for-pixel on Chromium 67.0.3372). KioskSplash sizes
 * almost everything with `clamp()` (Chrome 79) and spaces flex rows with
 * `gap` (Chrome 84): the engine DROPS every clamp() declaration, so the
 * code tiles have no width, no height and no font size, and every gap is
 * zero. These are the clamp() midpoints for a 1920×1080 panel plus
 * sibling margins in place of gap. Served ONLY to a UA below Chrome 79,
 * ahead of the app's own CSS: on such an engine the app's clamp() rules
 * are invalid and these stand; nothing else ever receives them.
 * `legacyPolyfills.test.ts` pins every selector to a class KioskSplash
 * still renders.
 */
export const LEGACY_SPLASH_CSS: string = [
  '.kiosk-stage{padding:48px}',
  '.kiosk-brand{margin-bottom:43px}',
  '.kiosk-logo-ring{width:119px;height:119px}',
  '.kiosk-brand-name{font-size:48px}',
  '.kiosk-brand-sub{font-size:14px}',
  '.kiosk-instructions{margin-bottom:32px}',
  '.kiosk-instruction-label{font-size:16px}',
  '.kiosk-instruction-line{font-size:22px}',
  '.kiosk-code-row{margin-bottom:32px}',
  '.kiosk-code-tile+.kiosk-code-tile{margin-left:18px}',
  '.kiosk-code-tile{width:140px;height:196px}',
  '.kiosk-code-char{font-size:100px}',
  '.kiosk-qr-hint{margin-bottom:22px}',
  '.kiosk-qr-hint>*+*{margin-left:10px}',
  '.kiosk-orient-label{font-size:13px}',
  '.kiosk-orient-btn{font-size:15px}',
  '.kiosk-orient-btn+.kiosk-orient-btn{margin-left:10px}',
  '.kiosk-status-row{font-size:17px}',
  '.kiosk-status-row>*+*{margin-left:12px}',
  '.kiosk-status-dots>span+span{margin-left:4px}',
  '.kiosk-pulse-loader>div+div{margin-left:12px}',
  '.kiosk-phase-copy{font-size:22px}',
  '.kiosk-tech-chips{bottom:32px}',
  '.kiosk-tech-chips>*+*{margin-left:10px}',
  '.kiosk-chip>*+*{margin-left:8px}',
].join('\n');

export const LEGACY_CSS_MARKER = 'data-edu-shim="legacy-css"';

/** Chrome / Chromium / WebView below 79 — no clamp(), no min()/max(), no flex gap. */
export function needsLegacyCss(userAgent: string | null | undefined): boolean {
  const m = /(?:Chrome|Chromium|CriOS)\/(\d+)/.exec(userAgent || '');
  if (!m) return false;
  const major = Number(m[1]);
  return Number.isFinite(major) && major > 0 && major < 79;
}

/**
 * Put the fallback stylesheet in right after the polyfill script (or as the
 * first head child when the script is absent) — BEFORE the app's CSS, so a
 * modern rule that the engine does understand still wins by source order.
 */
export function injectLegacyCss(html: string): string {
  if (html.includes(LEGACY_CSS_MARKER)) return html;
  const tag = `<style ${LEGACY_CSS_MARKER}>${LEGACY_SPLASH_CSS}</style>`;
  const afterPolyfill = html.indexOf('</script>', html.indexOf(LEGACY_POLYFILL_MARKER));
  if (html.indexOf(LEGACY_POLYFILL_MARKER) >= 0 && afterPolyfill >= 0) {
    const at = afterPolyfill + '</script>'.length;
    return html.slice(0, at) + tag + html.slice(at);
  }
  const head = /<head(?:\s[^>]*)?>/i.exec(html);
  if (head) {
    const at = head.index + head[0].length;
    return html.slice(0, at) + tag + html.slice(at);
  }
  return tag + html;
}

