/**
 * designer-render-document.ts — the EXACT document a screen renders for an AI
 * Designer board, assembled in the API so the board renderer (apps/renderer)
 * shoots what an operator will see (2026-09-23, Codex finding 3).
 *
 * A screen gets: the board → `injectDesignerLayoutEngine` (VOS-CANVAS +
 * VOS-FIT-ENGINE, designer-edit-shim.ts) → the web's `buildSafeDesignerSrcdoc`
 * (apps/web/src/lib/designer-safe-srcdoc.ts): untrusted scripts / handlers /
 * javascript: URLs / refresh / <base> / frames stripped, a nonce CSP <meta>
 * first in <head>, and the VOS-STAGE-SCALE + VOS-LIVE-MENU runtimes before
 * </head>. The API cannot import web code, so the two RUNTIMES below are
 * byte-for-byte copies of the web's constants (never re-implemented) and the
 * wrapper mirrors the web's steps. designer-render-document.spec.ts reads the
 * web file, compares both constants byte for byte, and runs the web's own
 * buildSafeDesignerSrcdoc beside this one over a corpus: any drift is a red test.
 *
 * TRUST, the one deliberate difference. The web trusts every body it ever
 * shipped (pinned hashes, V6→V7 upgrades) because it renders LEGACY boards.
 * This file only ever wraps a board the API sanitized and injected a moment
 * ago, so it keeps exactly the API's CURRENT runtime bodies (fit engine, edit
 * shim, the VOS-CANVAS dims) and strips everything else — fail-closed, and
 * identical to the web's output for every document this API produces.
 *
 * Pure string functions; `randomBytes` only for a default nonce.
 */
import { randomBytes } from 'node:crypto';
import {
  DESIGNER_EDIT_SHIM,
  DESIGNER_LAYOUT_ENGINE,
  injectDesignerLayoutEngine,
} from './designer-edit-shim';

// ─────────────────────────────────────────────────────────────────────────
// COPIED VERBATIM from apps/web/src/lib/designer-safe-srcdoc.ts (EDUCMS-SHIM-V7
// era, origin/master 9dec4f5c). Do not edit here: change the web file, then
// copy both constants back — the drift spec names the one that moved.
// ─────────────────────────────────────────────────────────────────────────

export const STAGE_SCALE_RUNTIME =
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

export const LIVE_MENU_RUNTIME = String.raw`/*VOS-LIVE-MENU*/(function(){try{
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

// ─────────────────────────────────────────────────────────────────────────

const SCRIPT_BLOCK = /^<script\b[^>]*>([\s\S]*)<\/script\s*>$/i;
const VOS_CANVAS_SHAPE =
  /^\/\*VOS-CANVAS\*\/window\.__VOS_CW=\d{1,6};(?:window\.__VOS_CH=\d{1,6};)?$/;

function scriptBody(block: string): string {
  const m = block.match(SCRIPT_BLOCK);
  return m ? m[1] : '';
}

/** The API's own current runtime bodies — the only scripts a render keeps. */
const TRUSTED_BODIES = new Set<string>([
  scriptBody(DESIGNER_LAYOUT_ENGINE),
  scriptBody(DESIGNER_EDIT_SHIM),
]);

function isOurRuntime(body: string): boolean {
  return TRUSTED_BODIES.has(body) || VOS_CANVAS_SHAPE.test(body);
}

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

/** The CSP a board document carries (the web's, for this nonce). */
export function designerRenderCsp(nonce: string): string {
  return (
    `<meta data-vos-csp="1" http-equiv="Content-Security-Policy" content="` +
    `default-src 'none'; ` +
    `style-src 'unsafe-inline' https://fonts.googleapis.com; ` +
    `font-src https://fonts.gstatic.com data:; ` +
    `img-src https: data: blob:; ` +
    `script-src 'nonce-${nonce}'; ` +
    `form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'` +
    `">`
  );
}

/**
 * The web's buildSafeDesignerSrcdoc, step for step, for a document this API
 * built (see TRUST above).
 */
export function wrapDesignerSrcdoc(rawHtml: string, nonce: string): string {
  if (typeof rawHtml !== 'string' || !rawHtml) return rawHtml ?? '';
  let html = rawHtml;

  // 1) Scripts: keep only our runtimes (nonce-stamped), drop the rest.
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, (block) => {
    const m = block.match(SCRIPT_BLOCK);
    if (!m || !isOurRuntime(m[1])) return '';
    return block.replace(/<script\b[^>]*>/i, `<script nonce="${nonce}">`);
  });
  html = html.replace(/<script\b[^>]*\/>/gi, '');

  // 2) Passive-vector strips.
  html = stripEventHandlerAttrs(html);
  html = html.replace(
    /((?:href|src|action|formaction|xlink:href)\s*=\s*)(['"]?)\s*javascript:[^'">\s]*(\2)/gi,
    '$1$2#$3',
  );
  html = html.replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh[^>]*>/gi, '');
  html = html.replace(/<base\b[^>]*>/gi, '');
  html = html
    .replace(/<(iframe|object|embed)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(iframe|object|embed)\b[^>]*\/?>/gi, '');

  // 3) CSP meta first in <head>; the runtimes last in <head>.
  html = html.replace(/<meta\b[^>]*data-vos-csp[^>]*>/gi, '');
  const csp = designerRenderCsp(nonce);
  const runtime =
    `<script nonce="${nonce}">${STAGE_SCALE_RUNTIME}</script>` +
    `<script nonce="${nonce}">${LIVE_MENU_RUNTIME}</script>`;
  const headOpen = html.match(/<head\b[^>]*>/i);
  if (headOpen && headOpen.index !== undefined) {
    const at = headOpen.index + headOpen[0].length;
    html = html.slice(0, at) + csp + html.slice(at);
  } else {
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

/**
 * A clean board (sanitized, bound, guarded) → the document a screen renders
 * for it: the fit engine baked in for its canvas, then the srcdoc wrap.
 */
export function assembleDesignerRenderDocument(
  boardHtml: string,
  canvasWidth: number,
  canvasHeight: number,
  nonce: string = randomBytes(16).toString('hex'),
): string {
  return wrapDesignerSrcdoc(
    injectDesignerLayoutEngine(boardHtml, canvasWidth, canvasHeight),
    nonce,
  );
}
