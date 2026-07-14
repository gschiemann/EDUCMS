/**
 * designer-safe-srcdoc.ts — audit W0-02 (2026-07-13): containment for
 * AI-authored board HTML rendered via <iframe srcdoc sandbox="allow-scripts">.
 *
 * THE HOLE THIS CLOSES. The null-origin sandbox blocks cookies/parent-DOM,
 * but NOT script execution, postMessage, outbound requests, or CPU burn.
 * Model-authored (or prompt-injected) JavaScript inside a board could post
 * `educms-action` messages, read the render document, navigate the frame to
 * a hostile origin, or fetch out. Every srcdoc render therefore passes
 * through here first:
 *
 *   1. STRIP every <script> that is not one of OUR baked runtimes
 *      (identified by marker: EDUCMS-SHIM-V6 / VOS-FIT-ENGINE /
 *      VOS-STAGE-SCALE). New boards are already script-free at persist
 *      (the API strips model scripts before injecting the runtimes); this
 *      render-side pass contains LEGACY persisted boards too.
 *   2. STRIP inline event-handler attributes (onload/onclick/…),
 *      javascript: URLs, <meta http-equiv=refresh>, <base>, and nested
 *      frames/objects/embeds.
 *   3. INJECT a strict CSP <meta> with a fresh per-render nonce:
 *      default-src 'none' (no fetch/XHR/WebSocket/form/frame), Google-Fonts
 *      styles/fonts, https images only, scripts ONLY with this render's
 *      nonce. Surviving trusted runtimes get the nonce stamped on; anything
 *      that slipped both strips still cannot execute.
 *   4. INJECT the VOS-STAGE-SCALE trusted runtime — the replacement for the
 *      model's (now stripped) self-scaling script: fits the fixed-size stage
 *      to the iframe viewport and shrinks any `data-fit-col` column that
 *      overflows its box. ES5 + Chromium-83-safe (Taurus players).
 *
 * The action channel is hardened separately (kiosk-frame-registry.ts +
 * the player's source-bound, key-resolved `educms-action` handler).
 */

// VOS-CANVAS is the tiny __VOS_CW/__VOS_CH assignment injectDesignerLayoutEngine
// bakes next to the fit engine — stripping it would under-apply the legibility
// floor in scaled previews (the 2026-06-30 fix).
const TRUSTED_SCRIPT_MARKERS = ['EDUCMS-SHIM-V6', 'VOS-FIT-ENGINE', 'VOS-STAGE-SCALE', 'VOS-CANVAS'];

/** Chromium-83-safe (no crypto.randomUUID there). CSP nonces just need to be unguessable-per-render. */
function makeNonce(): string {
  try {
    const c: Crypto | undefined = typeof crypto !== 'undefined' ? crypto : undefined;
    if (c?.getRandomValues) {
      const buf = new Uint8Array(16);
      c.getRandomValues(buf);
      let s = '';
      for (let i = 0; i < buf.length; i++) s += buf[i].toString(16).padStart(2, '0');
      return s;
    }
  } catch { /* fall through */ }
  return `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

/**
 * VOS-STAGE-SCALE — trusted replacement for the model's self-scaling script.
 * ES5 only (ships to Chromium 83). Scales body.firstElementChild (the
 * fixed-size stage div every Designer board wraps itself in) to fit the
 * iframe viewport, centers it, and shrink-fits any [data-fit-col] column
 * that overflows its container. Re-runs on resize/fonts/late layout.
 */
const STAGE_SCALE_RUNTIME =
  '/*VOS-STAGE-SCALE*/(function(){try{' +
  'function fitCols(){try{var els=document.querySelectorAll("[data-fit-col]");' +
  'for(var i=0;i<els.length;i++){(function(el){' +
  'el.style.transform="";el.style.transformOrigin="top left";' +
  'var avail=el.clientHeight?el.clientHeight:(el.parentElement?el.parentElement.clientHeight:0);' +
  'var need=el.scrollHeight;' +
  'if(avail>0&&need>avail+2){var s=avail/need;if(s<0.5)s=0.5;el.style.transform="scale("+s+")";}' +
  '})(els[i]);}}catch(e){}}' +
  'function fit(){try{var b=document.body;if(!b)return;' +
  'b.style.margin="0";document.documentElement.style.overflow="hidden";b.style.overflow="hidden";' +
  'var st=b.firstElementChild;if(!st||!st.style)return;' +
  'var prev=st.style.transform;st.style.transform="";' +
  'var w=st.offsetWidth,h=st.offsetHeight;' +
  'var vw=window.innerWidth,vh=window.innerHeight;' +
  'if(!w||!h||!vw||!vh){st.style.transform=prev;return;}' +
  'if(Math.abs(vw-w)<2&&Math.abs(vh-h)<2){fitCols();return;}' +
  'var s=Math.min(vw/w,vh/h);' +
  'st.style.transformOrigin="top left";' +
  'st.style.transform="translate("+Math.max(0,Math.round((vw-w*s)/2))+"px,"+Math.max(0,Math.round((vh-h*s)/2))+"px) scale("+s+")";' +
  'fitCols();}catch(e){}}' +
  'if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",fit);}else{fit();}' +
  'window.addEventListener("resize",fit);' +
  'setTimeout(fit,300);setTimeout(fit,1200);' +
  'if(document.fonts&&document.fonts.ready&&document.fonts.ready.then){document.fonts.ready.then(function(){fit();});}' +
  '}catch(e){}})();';

function isTrustedScriptBlock(block: string): boolean {
  for (const marker of TRUSTED_SCRIPT_MARKERS) {
    if (block.indexOf(marker) !== -1) return true;
  }
  return false;
}

/** Strip inline on* handlers from every tag (looped — one pass can uncover another match). */
function stripEventHandlerAttrs(html: string): string {
  const re = /(<[a-zA-Z][^>]*?)\s+on[a-zA-Z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/g;
  let prev = '';
  let out = html;
  let guard = 0;
  while (out !== prev && guard < 10) {
    prev = out;
    out = out.replace(re, '$1');
    guard++;
  }
  return out;
}

/**
 * Sanitize a persisted/candidate Designer board document and wrap it with the
 * CSP + trusted runtime. Pure string transform — safe to useMemo per board.
 */
export function buildSafeDesignerSrcdoc(rawHtml: string): string {
  if (typeof rawHtml !== 'string' || !rawHtml) return rawHtml ?? '';
  const nonce = makeNonce();
  let html = rawHtml;

  // 1) Scripts: keep only our baked runtimes (nonce-stamped), drop the rest.
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, (block) => {
    if (!isTrustedScriptBlock(block)) return '';
    // Re-stamp the open tag with the render nonce (drop any prior attrs
    // except type; our runtimes carry none that matter).
    return block.replace(/<script\b[^>]*>/i, `<script nonce="${nonce}">`);
  });
  // Self-closing / dangling script tags (malformed docs) — no marker, drop.
  html = html.replace(/<script\b[^>]*\/>/gi, '');

  // 2) Passive-vector strips.
  html = stripEventHandlerAttrs(html);
  html = html.replace(/((?:href|src|action|formaction|xlink:href)\s*=\s*)(['"]?)\s*javascript:[^'">\s]*(\2)/gi, '$1$2#$3');
  html = html.replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh[^>]*>/gi, '');
  html = html.replace(/<base\b[^>]*>/gi, '');
  html = html
    .replace(/<(iframe|object|embed)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(iframe|object|embed)\b[^>]*\/?>/gi, '');

  // 3) CSP meta (fresh each render; remove any stale one from a prior wrap).
  html = html.replace(/<meta\b[^>]*data-vos-csp[^>]*>/gi, '');
  const csp =
    `<meta data-vos-csp="1" http-equiv="Content-Security-Policy" content="` +
    `default-src 'none'; ` +
    `style-src 'unsafe-inline' https://fonts.googleapis.com; ` +
    `font-src https://fonts.gstatic.com data:; ` +
    `img-src https: data: blob:; ` +
    `script-src 'nonce-${nonce}'; ` +
    `form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'` +
    `">`;
  const runtime = `<script nonce="${nonce}">${STAGE_SCALE_RUNTIME}</script>`;

  // Insert CSP as early in <head> as possible (before any stylesheet/script),
  // and the runtime at end of head so it runs before <body> content scripts
  // would have (there are none left, but order stays deterministic).
  const headOpen = html.match(/<head\b[^>]*>/i);
  if (headOpen && headOpen.index !== undefined) {
    const at = headOpen.index + headOpen[0].length;
    html = html.slice(0, at) + csp + html.slice(at);
  } else {
    // No <head> — prepend a minimal one right after <html> (or at doc start).
    const htmlOpen = html.match(/<html\b[^>]*>/i);
    if (htmlOpen && htmlOpen.index !== undefined) {
      const at = htmlOpen.index + htmlOpen[0].length;
      html = html.slice(0, at) + `<head>${csp}</head>` + html.slice(at);
    } else {
      html = `<head>${csp}</head>` + html;
    }
  }
  const headClose = html.search(/<\/head\s*>/i);
  if (headClose !== -1) {
    html = html.slice(0, headClose) + runtime + html.slice(headClose);
  } else {
    html += runtime;
  }
  return html;
}
