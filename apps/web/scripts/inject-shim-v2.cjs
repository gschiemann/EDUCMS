#!/usr/bin/env node
/**
 * Inject the EduCMS rebrand+text+image+video-overrides shim.
 *
 * Successor to `inject-brand-shim.cjs` (V1, colors only) and the V2
 * shim (added editable text). V3 adds per-image-slot overrides for the
 * 80 self-contained signage / HS templates. The EXTERNAL_HTML widget
 * appends query params (each base64-url-encoded JSON):
 *   - `brand`       CSS custom property overrides (background / text /
 *                   primary / accent / font slots)
 *   - `text`        per-data-field text overrides
 *                   { "i.0.0.n": "Carolina oysters" }
 *   - `textStyles`  per-data-field inline-style overrides
 *                   { "i.0.0.n": { color: "#fff", fontSize: 56,
 *                                  fontWeight: 700, fontStyle: "italic",
 *                                  textDecoration: "underline",
 *                                  fontFamily: "Georgia, serif",
 *                                  textAlign: "right" } }
 *   - `img`         per-image-slot URL overrides (G3, §19). Keyed by the
 *                   slot's `data-img` (preferred) OR `data-slot` value
 *                   (the existing `data-widget="image-slot"` convention).
 *                   { "hero": "https://cdn/…/photo.jpg" }. Applied as
 *                   background-image on the slot div (and `src` if the
 *                   slot is itself an <img>), and sets
 *                   `data-has-image="true"` so the slot's empty-state
 *                   placeholder hides (templates already gate `.ph` /
 *                   `.ph-empty` on that attribute).
 *   - `video`       per-video-slot URL overrides keyed by
 *                   `data-videoslot`. Applied to a <video> or <source>,
 *                   then reloads the owning video for immediate preview.
 *
 * The shim is per-file (not a shared script) because templates are
 * self-contained — no external imports — and the iframe is sandboxed
 * without same-origin, so a shared asset isn't reachable cleanly.
 *
 * Why a numbered marker: this script runs every time a template
 * changes. The marker carries a version (`EDUCMS-SHIM-V3`) so older
 * shims (V2 text-only, V1 brand-only) are removed and replaced. Without
 * version-aware replacement, the older shim would block the new image
 * overrides (it never read the `img` param).
 *
 * Idempotent — re-running with the SAME version skips already-shimmed
 * files.
 *
 * Usage:  node apps/web/scripts/inject-shim-v2.cjs
 */
const fs = require('fs');
const path = require('path');

// Optional CLI arg scopes the walk to a subdirectory, e.g.
//   node apps/web/scripts/inject-shim-v2.cjs hs
// so a flagship batch can re-shim just its own folder without churning all
// 80 templates. No arg = every template under public/templates.
// --force re-injects even when the marker already matches. Without it, the
// only way to iterate on the shim was to bump the version, so a bug fixed
// before the version ever shipped still burned a version number (V10 → V11
// happened exactly that way). Version bumps should mean "boards changed",
// not "the author was iterating".
const FORCE = process.argv.includes('--force');
const ARGS = process.argv.slice(2).filter((a) => a !== '--force');
const SUBDIR = ARGS[0] ? ARGS[0].replace(/^\/+|\/+$/g, '') : '';
const ROOT = path.resolve(__dirname, '../public/templates', SUBDIR);
const MARKER = 'EDUCMS-SHIM-V12';
// V12 also fixes CLICK TARGETING. Listeners are bound in CAPTURE phase, so
// the OUTERMOST editable ancestor fired first and won every click. On boards
// that wrap the whole scene in an image slot — `<main class="scene"
// data-imgslot="hero.image">` in signage/worship/welcome-v2 — that meant
// clicking ANY field (the clock, the headline, the church name) jumped the
// panel to "Hero - Image" and focused a URL box. The inner element's own
// stopPropagation could not help: by then the ancestor had already posted.
// Each handler now resolves the nearest editable ancestor of the real click
// target and stands down unless that is itself — innermost wins, regardless
// of phase.
//
// V12 (2026-08-25) makes the WALL CLOCK live. 42 boards across worship, hs,
// school, corporate, qsr and retail shipped the current time as authored TEXT
// — every church board sat at "9:42 AM" forever. 35 other boards carry a
// self-driven clock engine; this gives the rest the same behaviour without
// editing 42 files. A board that ships the `clock.mode` config span drives its
// own clock and is skipped, and an operator text override on a clock field
// still wins — it is an editable field, so their words beat the wall clock.
// The rendered shape is inferred from what the board authored ("SUNDAY · JUL
// 26" keeps its long weekday and separator; "SUN · OCT 18" keeps its short
// one), because reformatting them would be redesigning the board.
//
// V11 (2026-08-25) = V10 with its escaping fixed. V10's group-detection regex
// was authored inside this template literal without doubled backslashes, so the
// EMITTED board carried `/^([A-Za-z][w-]*).(d+)./` — a different, perfectly
// valid regex that matches nothing. It threw nothing and broke nothing visibly;
// the feature was simply inert. No board should sit on V10, hence the bump.
// `assertShimEscapesSurvived` now fails the injector before any file is written.
//
// V10 (2026-08-25) adds REPEATING GROUPS: `?repeat={"event":4}` (or the same
// key by postMessage) grows or shrinks a list on the board. A board with
// data-field="event.0.name" … "event.2.name" already declares a list; the shim
// INFERS it rather than requiring per-board markup, so all ~167 boards with
// indexed field groups get it without being edited. Detection is deliberately
// conservative: indices must be contiguous, and each index's elements must
// resolve to sibling items under one shared parent — anything else is left
// alone rather than guessed at.
//
// Growing clones the LAST item and renumbers its keys; shrinking drops from the
// end. `data-repeat-max` on the container caps it (default 12).
//
// The distribution CSS is applied ONLY when the count differs from what the
// board ships. At the authored count the board renders byte-identically to
// before this existed — which is what makes it safe to turn on everywhere.
//
// V9 (2026-08-24) adds `[data-mediafield]` — a value that can only come from
// a connected source (now-playing track, provider, audio zone, elapsed time,
// "Business licensed"). These are deliberately NOT `data-field`: the shim
// never writes them, because an operator typing a now-playing track onto a
// screen connected to nothing produces something that reads as a readout
// rather than as the placeholder it is. They hover VIOLET instead of cyan and
// report `kind:'media'`, so the panel opens the integration picker instead of
// a text box — the fix has to be reachable from the thing that is wrong.
//
// V8 (2026-08-17 build) also swaps `src` on <img data-imgslot> elements
// (stashing the authored src for clear-restore) — the MS Campus Lineup boards
// use real <img> slots, where a background-image override is invisible.
// V8 = V7 PLUS first-class replaceable video sources (`?video=` /
// `videoOverrides`) and independently replaceable video posters via
// `data-posterslot`. Video hot-zones report kind:"video" so the editor jumps
// to a video-only asset picker instead of the image picker.
// V7 = V6 PLUS a `hidden` key in the per-field style-override map (CRUSH E6,
// 2026-07-03). THE BUG: clearing a field's text in PropertiesPanel deletes its
// textOverrides entry, which resurrects the BOARD'S OWN DEFAULT COPY (the shim
// has no way to say "show nothing here") — operators had no way to actually
// blank/hide an element. FIX: applyTextAndStyles now also reads
// `styles[key].hidden` — `true` sets `el.style.display='none'`; the key being
// explicitly present-but-falsy (e.g. `{hidden:false}`) clears any inline
// `display` back to the template's own CSS. The key being ABSENT (every
// existing template + every non-hidden field) is a no-op — zero behavior
// change for the 107 boards' existing overrides. This rides the exact same
// `_styles`/`textStyles` transport `applyBrand`/color/fontSize already use;
// no new query param, no new postMessage type, no shim protocol change.
//
// V6 = V5's apply + click-to-edit logic PLUS gallery FREEZE mode. When the
// board URL carries `freeze=1` (the templates GALLERY GRID appends it — the
// full-screen preview modal / builder / player never do), the shim renders ONE
// correct auto-fit frame and then goes idle: it wraps setInterval / setTimeout /
// requestAnimationFrame at the very top of the IIFE (installed BEFORE the board's
// own <body> scripts run, so every timer the board starts — the live clock, the
// auto-fit settle timers, any ticker rAF — is recorded), and after a generous
// settle window (so auto-fit has finished) it clears every recorded timer/rAF
// and injects `<style>*{animation:none!important;transition:none!important;}`.
// Net: near-zero ongoing CPU per off-screen-but-mounted iframe, which kills the
// "dozens of live 4K animating boards accumulate → page unresponsive" perf bug.
// Freeze is a strict NO-OP when `freeze=1` is absent (the wrappers aren't even
// installed), never touches brand/text/img/menu overrides (those are applied
// synchronously / via postMessage, not via the recorded timers), and is undone
// if the board is later put into edit mode (defensive — the grid never does).
//
// V5 = V4's apply logic (brand / text+styles / images with the flagship
// `data-imgslot` convention + --c-*/--f-* theme tokens) PLUS the click-to-edit
// protocol the PropertiesPanel already speaks: on `educms-edit-mode {on}` it
// outlines every [data-field]/[data-imgslot]/[data-img]/[data-slot]/[data-action]
// on hover and, on click, posts `educms-field-click {key,kind}` so the panel
// jumps to that field's editor; it announces `educms-ready` on load so the panel
// can (re)arm after a remount. THIS is the fix for "none of the templates have
// hot zones" — V4 only applied overrides INBOUND, it never reported clicks, so
// every static signage / HS board was apply-only (no click-to-edit). V5 also
// HTML-entity-decodes text overrides (so "Mix & Match" no longer renders the
// literal "&amp;"). V5/V4/V3/V2/V1 are removed + replaced (pure superset — zero
// regression for the live player, which never enters edit mode).
const OLD_MARKERS = [...(process.argv.includes('--force') ? ['EDUCMS-SHIM-V12'] : []), 'EDUCMS-SHIM-V11', 'EDUCMS-SHIM-V10', 'EDUCMS-SHIM-V9', 'EDUCMS-SHIM-V8', 'EDUCMS-SHIM-V7', 'EDUCMS-SHIM-V6', 'EDUCMS-SHIM-V5', 'EDUCMS-SHIM-V4', 'EDUCMS-SHIM-V3', 'EDUCMS-SHIM-V2', 'EDUCMS-BRAND-SHIM'];

// Inline runtime — minified, runs at end of <head> before first paint.
// Reads `brand`, `text`, `textStyles`, `img`, `video` from URL params; applies
// brand to :root CSS vars, then walks `[data-field]` elements post-load
// and applies textContent / inline-style overrides, and walks
// `[data-img]` / `[data-slot]` image slots applying the URL override as
// background-image (or src for an <img>). Re-runs on postMessage
// `{type:'educms-overrides',...}` for parent-driven instant updates.
//
// applyImages: for each key in `img`, find the slot element by
// `data-img="<key>"` first (forward-compat), else `data-slot="<key>"`
// (the shipped `data-widget="image-slot"` convention). If the slot is an
// <img> set its `src`; otherwise set `background-image: url(...)` plus
// `background-size:cover` / `background-position:center`, and stamp
// `data-has-image="true"` so the template's own empty-state placeholder
// (gated on that attribute) hides. CSS url() value is sanitised by
// stripping quotes/parens/whitespace so a hostile URL can't break out of
// the url() context.
const SHIM = `<script>/*${MARKER}*/(function(){try{
var editMode=false;
function applyPosters(img){if(!img)return;Object.keys(img).forEach(function(k){var v=img[k];if(typeof v!=='string')return;var esc=k.replace(/"/g,'\\\\"');var safe=v.replace(/["'()\\s]/g,'');var el=document.querySelector('[data-posterslot="'+esc+'"]');if(!el)return;if(safe)el.setAttribute('poster',safe);else el.removeAttribute('poster');el.setAttribute('data-has-image',safe?'true':'false');});}
function applyVideos(video){if(!video)return;Object.keys(video).forEach(function(k){var v=video[k];if(typeof v!=='string')return;var esc=k.replace(/"/g,'\\\\"');var safe=v.replace(/["'()\\s]/g,'');var el=document.querySelector('[data-videoslot="'+esc+'"]');if(!el)return;var owner=el.tagName==='VIDEO'?el:(el.closest?el.closest('video'):null);if(el.tagName==='VIDEO'||el.tagName==='SOURCE'){if(safe)el.setAttribute('src',safe);else el.removeAttribute('src');}else{el.setAttribute('data-video',safe);}el.setAttribute('data-has-video',safe?'true':'false');if(owner){try{owner.load();if(owner.autoplay&&safe){var play=owner.play();if(play&&play.catch)play.catch(function(){});}}catch(e){}}});}
function armMediaEdit(){document.querySelectorAll('[data-posterslot],[data-videoslot]').forEach(function(el){if(el.__veMediaArmed)return;el.__veMediaArmed=true;el.style.cursor='pointer';var isVideo=el.hasAttribute('data-videoslot');el.addEventListener('mouseenter',function(){el.style.outline='2px dashed #06b6d4';el.style.outlineOffset='2px';});el.addEventListener('mouseleave',function(){el.style.outline='';});el.addEventListener('click',function(ev){var _t=ev.target;var _n=(_t&&_t.closest)?_t.closest('[data-field],[data-mediafield],[data-imgslot],[data-img],[data-slot],[data-action],[data-videoslot],[data-posterslot]'):null;if(_n&&_n!==el)return;ev.preventDefault();ev.stopPropagation();var key=el.getAttribute('data-videoslot')||el.getAttribute('data-posterslot')||'';try{parent.postMessage({type:'educms-field-click',key:key,kind:isVideo?'video':'img'},'*');}catch(_){}},true);});}
// ── Gallery FREEZE mode ──────────────────────────────────────────────
// Installed FIRST (this script is at end of <head>, before the board's own
// <body> scripts), so the timer-wrappers below capture every timer the board
// starts. Strict NO-OP unless the URL carries freeze=1.
var FROZEN=(function(){try{return new URLSearchParams(location.search).get('freeze')==='1';}catch(e){return false;}})();
var _frzStyle=null;
function _unfreeze(){if(_frzStyle){try{if(_frzStyle.parentNode)_frzStyle.parentNode.removeChild(_frzStyle);}catch(e){}_frzStyle=null;}}
(function(){if(!FROZEN)return;var ivs=[],tos=[],rafs=[];var _si=window.setInterval,_st=window.setTimeout,_raf=window.requestAnimationFrame;
window.setInterval=function(){var id=_si.apply(window,arguments);try{ivs.push(id);}catch(e){}return id;};
window.setTimeout=function(){var id=_st.apply(window,arguments);try{tos.push(id);}catch(e){}return id;};
if(_raf)window.requestAnimationFrame=function(cb){var id=_raf.call(window,cb);try{rafs.push(id);}catch(e){}return id;};
function freezeNow(){window.setInterval=_si;window.setTimeout=_st;if(_raf)window.requestAnimationFrame=_raf;try{for(var i=0;i<ivs.length;i++)clearInterval(ivs[i]);}catch(e){}try{for(var j=0;j<tos.length;j++)clearTimeout(tos[j]);}catch(e){}try{if(_raf)for(var k=0;k<rafs.length;k++)cancelAnimationFrame(rafs[k]);}catch(e){}try{var hi=_st(function(){},0);if(typeof hi==='number'&&hi>0){var lo=hi>100000?hi-100000:0;for(var z=hi;z>lo;z--){clearTimeout(z);clearInterval(z);}}}catch(e){}if(!_frzStyle){try{_frzStyle=document.createElement('style');_frzStyle.setAttribute('data-educms-freeze','1');_frzStyle.appendChild(document.createTextNode('*{animation:none!important;transition:none!important;}'));(document.head||document.documentElement).appendChild(_frzStyle);}catch(e){}}}
// Settle window: let the board's auto-fit (setTimeout(autofit,500)+fonts.ready)
// finish before killing its timers; then a brute-force id sweep catches any the
// wrappers missed. Scheduled via the REAL setTimeout so this scheduler isn't
// itself recorded/cleared.
_st(freezeNow,1400);window.__educmsFreezeNow=freezeNow;}());
function dec(p){if(!p)return null;try{var j=decodeURIComponent(Array.prototype.map.call(atob(p.replace(/-/g,'+').replace(/_/g,'/')),function(c){return '%'+('00'+c.charCodeAt(0).toString(16)).slice(-2);}).join(''));return JSON.parse(j);}catch(e){return null;}}
function readParams(){var q=new URLSearchParams(location.search);return{brand:dec(q.get('brand'))||{},text:dec(q.get('text'))||{},styles:dec(q.get('textStyles'))||{},img:dec(q.get('img'))||{},video:dec(q.get('video'))||{},repeat:dec(q.get('repeat'))||{}};}
var BRAND_MAP={background:['--bg','--brand-canvas','--brand-bg','--surface-canvas','--c-bg'],surface:['--paper','--brand-paper','--surface','--c-surface','--c-panel'],
text:['--ink','--fg','--brand-ink','--brand-fg','--text','--c-ink'],muted:['--mute','--brand-mute','--text-muted','--c-ink2','--c-ink3'],
primary:['--primary','--brand-primary','--color-primary','--c-us','--c-primary','--c-accent'],secondary:['--secondary','--brand-secondary','--brand2','--c-secondary'],accent:['--accent','--brand-accent','--brand-gold','--gold','--color-accent','--c-gold'],accent2:['--accent2','--brand-accent2','--c-accent2'],positive:['--positive','--pos','--brand-positive','--c-positive'],negative:['--negative','--neg','--brand-negative','--c-negative'],
fontDisplay:['--font-display','--font-headline','--f-display','--f-head'],fontBody:['--font-grotesk','--font-body','--font-sans','--f-body'],fontCondensed:['--font-condensed','--font-numeric','--f-mono']};
function applyBrand(b){var r=document.documentElement.style;Object.keys(BRAND_MAP).forEach(function(k){if(b[k]){var val=/^font/i.test(k)?("'"+String(b[k]).replace(/^['"]|['"]$/g,'')+"'"):b[k];BRAND_MAP[k].forEach(function(v){r.setProperty(v,val);});}});}
var _dEl=null;function dE(s){if(typeof s!=='string'||s.indexOf('&')===-1)return s;try{if(!_dEl)_dEl=document.createElement('textarea');_dEl.innerHTML=s;return _dEl.value;}catch(e){return s;}}
function applyTextAndStyles(text,styles){var keys={};Object.keys(text||{}).forEach(function(k){keys[k]=1;});Object.keys(styles||{}).forEach(function(k){keys[k]=1;});Object.keys(keys).forEach(function(k){var nodes=document.querySelectorAll('[data-field="'+k.replace(/"/g,'\\\\"')+'"]');for(var i=0;i<nodes.length;i++){var el=nodes[i];if(text&&typeof text[k]==='string'){var val=dE(text[k]);if(el.children.length===0){el.textContent=val;}else{var tn=null;for(var j=0;j<el.childNodes.length;j++){if(el.childNodes[j].nodeType===3){tn=el.childNodes[j];break;}}if(tn){tn.textContent=val;}else{el.insertBefore(document.createTextNode(val),el.firstChild);}}}var s=styles&&styles[k];if(s){if(s.color)el.style.color=s.color;if(s.fontSize!=null)el.style.fontSize=(typeof s.fontSize==='number'?s.fontSize+'px':s.fontSize);if(s.fontWeight!=null)el.style.fontWeight=String(s.fontWeight);if(s.fontStyle)el.style.fontStyle=s.fontStyle;if(s.fontFamily)el.style.fontFamily=s.fontFamily;if(s.textDecoration)el.style.textDecoration=s.textDecoration;if(s.textAlign)el.style.textAlign=s.textAlign;if(s.backgroundColor)el.style.backgroundColor=s.backgroundColor;if(s.lineHeight!=null)el.style.lineHeight=String(s.lineHeight);if(Object.prototype.hasOwnProperty.call(s,'hidden')){el.style.display=s.hidden?'none':'';}}}});}
function applyImages(img){if(!img)return;Object.keys(img).forEach(function(k){var v=img[k];if(typeof v!=='string')return;var esc=k.replace(/"/g,'\\\\"');var safe=v.replace(/["'()\\s]/g,'');var slot=document.querySelector('[data-imgslot="'+esc+'"]');if(slot){slot.setAttribute('data-img',safe);if(slot.tagName==='IMG'){if(slot.__eduSrc0===undefined)slot.__eduSrc0=slot.getAttribute('src')||'';if(safe){slot.setAttribute('src',safe);slot.classList.add('has-img');slot.setAttribute('data-has-image','true');}else{if(slot.__eduSrc0)slot.setAttribute('src',slot.__eduSrc0);else slot.removeAttribute('src');slot.classList.remove('has-img');slot.removeAttribute('data-has-image');}return;}if(safe){slot.style.backgroundImage="url('"+safe+"')";slot.style.backgroundSize='cover';slot.style.backgroundPosition='center';slot.classList.add('has-img');slot.setAttribute('data-has-image','true');}else{slot.style.backgroundImage='';slot.classList.remove('has-img');slot.removeAttribute('data-has-image');}return;}if(!safe)return;var el=document.querySelector('[data-img="'+esc+'"]')||document.querySelector('[data-slot="'+esc+'"]');if(!el)return;if(el.tagName==='IMG'){el.setAttribute('src',safe);}else{el.style.backgroundImage="url('"+safe+"')";el.style.backgroundSize='cover';el.style.backgroundPosition='center';}el.setAttribute('data-has-image','true');});}
function armEdit(){document.querySelectorAll('[data-field],[data-mediafield],[data-imgslot],[data-img],[data-slot],[data-action]').forEach(function(el){if(el.__veArmed)return;el.__veArmed=true;el.style.cursor='pointer';var isAct=el.hasAttribute('data-action');var isSrc=el.hasAttribute('data-mediafield');el.addEventListener('mouseenter',function(){el.style.outline='2px dashed '+(isAct?'#f59e0b':(isSrc?'#8b5cf6':'#06b6d4'));el.style.outlineOffset='2px';});el.addEventListener('mouseleave',function(){el.style.outline='';});el.addEventListener('click',function(ev){var _t=ev.target;var _n=(_t&&_t.closest)?_t.closest('[data-field],[data-mediafield],[data-imgslot],[data-img],[data-slot],[data-action],[data-videoslot],[data-posterslot]'):null;if(_n&&_n!==el)return;ev.preventDefault();ev.stopPropagation();var key=el.getAttribute('data-action')||el.getAttribute('data-mediafield')||el.getAttribute('data-field')||el.getAttribute('data-imgslot')||el.getAttribute('data-slot')||el.getAttribute('data-img')||'';var kind=el.hasAttribute('data-action')?'action':(isSrc?'media':(el.hasAttribute('data-field')?'text':'img'));try{parent.postMessage({type:'educms-field-click',key:key,kind:kind},'*');}catch(_){}},true);});}

function _rpGroups(){var map={},all=document.querySelectorAll('[data-field],[data-mediafield],[data-style]');
for(var i=0;i<all.length;i++){var el=all[i],k=el.getAttribute('data-field')||el.getAttribute('data-mediafield')||el.getAttribute('data-style')||'';
var m=/^([A-Za-z][\\w-]*)\\.(\\d+)\\./.exec(k);if(!m)continue;var g=m[1],n=+m[2];map[g]=map[g]||{};(map[g][n]=map[g][n]||[]).push(el);}
var out=[];Object.keys(map).forEach(function(g){var idxs=Object.keys(map[g]).map(Number).sort(function(a,b){return a-b;});
if(idxs.length<2)return;for(var c=1;c<idxs.length;c++)if(idxs[c]!==idxs[c-1]+1)return;
var items=[];for(var j=0;j<idxs.length;j++){var els=map[g][idxs[j]],best=els[0],p=els[0].parentElement;
while(p&&p!==document.body){var okAll=true;for(var q=0;q<els.length;q++)if(!p.contains(els[q])){okAll=false;break;}if(!okAll)break;
var clean=true;for(var r=0;r<idxs.length&&clean;r++){if(idxs[r]===idxs[j])continue;var o=map[g][idxs[r]];for(var t=0;t<o.length;t++)if(p.contains(o[t])){clean=false;break;}}
if(!clean)break;best=p;p=p.parentElement;}items.push(best);}
var parent=items[0].parentElement;if(!parent)return;for(var j2=1;j2<items.length;j2++)if(items[j2].parentElement!==parent)return;
out.push({group:g,items:items,parent:parent,base:idxs[0]});});return out;}
function _rpRenumber(root,group,from,to){var A=['data-field','data-mediafield','data-style','data-imgslot','data-img','data-slot','data-videoslot','data-posterslot','data-action'],
N=[root].concat([].slice.call(root.querySelectorAll('*')));for(var i=0;i<N.length;i++){for(var j=0;j<A.length;j++){
var v=N[i].getAttribute&&N[i].getAttribute(A[j]);if(!v)continue;var pre=group+'.'+from+'.';if(v.indexOf(pre)===0)N[i].setAttribute(A[j],group+'.'+to+'.'+v.slice(pre.length));}}}
var _rpStyled=false;
function _rpStyle(){if(_rpStyled)return;_rpStyled=true;var st=document.createElement('style');
st.textContent='[data-educms-repeat]{display:flex;flex-direction:column;gap:var(--educms-repeat-gap,18px);height:100%;align-content:stretch}'+
'[data-educms-repeat]>[data-educms-repeat-item]{flex:1 1 0;min-height:0;margin-bottom:0;overflow:hidden}';
document.head.appendChild(st);}
function applyRepeat(counts){if(!counts||typeof counts!=='object')return;var G=_rpGroups();
for(var i=0;i<G.length;i++){var g=G[i],want=counts[g.group];if(typeof want!=='number'||!isFinite(want))continue;
var mx=parseInt(g.parent.getAttribute('data-repeat-max')||'',10);if(!isFinite(mx))mx=12;
want=Math.max(1,Math.min(mx,Math.round(want)));var have=g.items.length;
if(want===have){g.parent.removeAttribute('data-educms-repeat');for(var z=0;z<g.items.length;z++)g.items[z].removeAttribute('data-educms-repeat-item');continue;}
if(want<have){for(var d=have-1;d>=want;d--)if(g.items[d].parentNode)g.items[d].parentNode.removeChild(g.items[d]);}
else{var tpl=g.items[have-1];for(var a=have;a<want;a++){var cl=tpl.cloneNode(true);_rpRenumber(cl,g.group,g.base+have-1,g.base+a);g.parent.appendChild(cl);}}
_rpStyle();g.parent.setAttribute('data-educms-repeat','');
var kids=g.parent.children;for(var y=0;y<kids.length;y++)kids[y].setAttribute('data-educms-repeat-item','');}}

var TIME_KEYS={'clock.time':1,'meta.time':1,'header.time':1,'now.time':1,'time.now':1};
var DATE_KEYS={'clock.date':1,'meta.day':1,'meta.date':1,'header.date':1,'header.day':1};
function _ckCfg(k,fb){var el=document.querySelector('[data-field="'+k+'"]');var v=el?(el.textContent||'').trim():'';return v||fb;}
/* Match the shape the board AUTHORED — "SUNDAY · JUL 26" and "SUN · OCT 18"
 * are different designs, and a clock that reformats them has redesigned the
 * board. Infer weekday length, separator and case from the sample. */
function _ckDate(sample,d,tz,locale){
  var longDay=/^[A-Za-z]{4,}/.test(sample.replace(/^\\s+/,''));
  /* Capture the separator WITH its surrounding whitespace — trimming it
   * turns the authored "SUNDAY · JUL 26" into "TUESDAY· AUG 25", which is
   * a (small, ugly) redesign of the board. */
  var sep=(sample.match(/[A-Za-z]([^A-Za-z0-9]+)[A-Za-z]/)||[,' '])[1]||' ';
  var o={weekday:longDay?'long':'short',month:'short',day:'numeric'};
  if(tz)o.timeZone=tz;
  var parts;
  try{parts=new Intl.DateTimeFormat(locale||'en-US',o).formatToParts(d);}catch(e){return sample;}
  var g=function(t){var f=null;for(var i=0;i<parts.length;i++)if(parts[i].type===t)f=parts[i].value;return f||'';};
  var out=g('weekday')+sep+g('month')+' '+g('day');
  return sample===sample.toUpperCase()?out.toUpperCase():out;
}
function _ckTime(sample,d,tz,locale,hour12){
  var o={hour:'numeric',minute:'2-digit',hour12:hour12};
  if(tz)o.timeZone=tz;
  var out;
  try{out=new Intl.DateTimeFormat(locale||'en-US',o).format(d);}catch(e){return sample;}
  return sample===sample.toUpperCase()?out.toUpperCase():out;
}
var _ckSamples=null,_ckTimer=null;
/* A board that ships the K-12 clock config span already drives its own
 * clock; two engines writing the same node would fight. */
function _ckOwnEngine(){return !!document.querySelector('[data-field="clock.mode"]');}
function startClock(text){
  if(_ckOwnEngine())return;
  var nodes=[];
  var all=document.querySelectorAll('[data-field]');
  for(var i=0;i<all.length;i++){
    var k=all[i].getAttribute('data-field');
    if(!TIME_KEYS[k]&&!DATE_KEYS[k])continue;
    /* The operator typed something here — their words win over the wall
     * clock, exactly as for any other editable field. */
    if(text&&typeof text[k]==='string')continue;
    nodes.push({el:all[i],key:k,isTime:!!TIME_KEYS[k]});
  }
  if(!nodes.length)return;
  if(!_ckSamples){_ckSamples={};for(var j=0;j<nodes.length;j++)_ckSamples[nodes[j].key]=(nodes[j].el.textContent||'').trim();}
  var tz=_ckCfg('clock.timeZone','');
  var locale=_ckCfg('clock.locale','en-US');
  var h12raw=_ckCfg('clock.hour12','yes');
  var hour12=!/^(no|off|false|0|24)/i.test(h12raw);
  function tick(){
    var d=new Date();
    for(var n=0;n<nodes.length;n++){
      var s=_ckSamples[nodes[n].key]||'';
      nodes[n].el.textContent=nodes[n].isTime?_ckTime(s,d,tz,locale,hour12):_ckDate(s,d,tz,locale);
    }
  }
  tick();
  if(_ckTimer)clearInterval(_ckTimer);
  _ckTimer=setInterval(tick,15000);
}
function applyAll(){var p=readParams();applyBrand(p.brand);applyRepeat(p.repeat);applyTextAndStyles(p.text,p.styles);applyImages(p.img);applyPosters(p.img);applyVideos(p.video);startClock(p.text);if(editMode){armEdit();armMediaEdit();}}
applyBrand(readParams().brand);
if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',applyAll);}else{applyAll();}
try{parent.postMessage({type:'educms-ready'},'*');}catch(_){}
addEventListener('message',function(e){try{var d=e.data;if(!d||typeof d!=='object')return;if(d.type==='educms-overrides'){if(d.brand)applyBrand(d.brand);if(d.repeat)applyRepeat(d.repeat);applyTextAndStyles(d.text||{},d.textStyles||{});applyImages(d.img||{});applyPosters(d.img||{});applyVideos(d.video||{});startClock(d.text||{});}else if(d.type==='educms-edit-mode'){editMode=!!d.on;if(editMode){_unfreeze();armEdit();armMediaEdit();}}}catch(_){}});
}catch(e){}})();</script>`;

/**
 * The shim is authored inside a JS TEMPLATE LITERAL, so every backslash in it
 * must be doubled — `\w` in the source becomes a bare `w` in the emitted
 * board. That failure is silent and vicious: it does not throw, it produces a
 * DIFFERENT, valid regex that quietly matches nothing. The repeat detector
 * shipped that way and simply did nothing.
 *
 * (Same family as the 2026-05-09 Safari bug, where a literal newline inside a
 * regex in this kind of inline block killed the whole bridge in WebKit.)
 *
 * Assert the emitted text still contains the escapes it needs before writing a
 * single board.
 */
function assertShimEscapesSurvived(shim) {
  const required = [
    ['\\w', 'word-character class'],
    ['\\d', 'digit class'],
    ['\\.', 'escaped dot'],
  ];
  const missing = required.filter(([seq]) => !shim.includes(seq));
  if (missing.length) {
    console.error('\nSHIM ESCAPE LOSS — the emitted shim is missing: '
      + missing.map(([s, why]) => `${s} (${why})`).join(', '));
    console.error('A backslash inside the template literal must be written doubled.');
    console.error('Nothing was written. Fix the escaping in this file and re-run.\n');
    process.exit(1);
  }
}

function walk(dir) {
  let out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out = out.concat(walk(full));
    else if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

// Remove a legacy shim block (matches by marker) so we can replace it.
function removeLegacyShim(html, marker) {
  const re = new RegExp(
    `<script>\\s*/\\*${marker}\\*/[\\s\\S]*?</script>\\s*`,
    'g',
  );
  return html.replace(re, '');
}

assertShimEscapesSurvived(SHIM);

const files = fs.statSync(ROOT).isDirectory() ? walk(ROOT) : [ROOT];
let injected = 0, replaced = 0, skipped = 0;
for (const file of files) {
  let html = fs.readFileSync(file, 'utf8');

  if (html.includes(MARKER) && !FORCE) {
    skipped++;
    continue;
  }

  // Kiosks load the external `_edit-shim.js` (kiosk/_edit-shim.js) which
  // ALREADY does brand/text/img apply + click-to-edit AND wraps the kiosk
  // engine's _render so overrides survive screen swaps — capabilities this
  // static inline shim deliberately lacks. Injecting here would double-shim
  // them (two `educms-ready` + duplicate field-click messages). Skip them;
  // they're already editable via that file.
  if (/src=["'][^"']*_edit-shim\.js/.test(html)) {
    skipped++;
    continue;
  }

  // MENU boards (signage/{qsr,menus-pos,bar}) carry a HAND-CRAFTED EDUCMS-SHIM-V5
  // whose applyMenu() overlays live per-location POS prices + auto-86 — load-
  // bearing for the restaurant pilot and a capability this generic shim lacks.
  // It shares the V5 marker, so now that V5 is in OLD_MARKERS this injector would
  // STRIP applyMenu and replace it with the generic body. SKIP any board with
  // applyMenu — its freeze handling + click-to-edit come from inject-click-shim.cjs
  // (EDUCMS-CLICK-V2), which is purely additive and leaves applyMenu intact.
  if (/applyMenu/.test(html)) {
    skipped++;
    continue;
  }

  let hadOld = false;
  for (const old of OLD_MARKERS) {
    if (html.includes(old)) {
      html = removeLegacyShim(html, old);
      hadOld = true;
    }
  }

  const idx = html.search(/<\/head>/i);
  if (idx === -1) {
    console.warn('no </head> in ' + path.relative(ROOT, file) + ' — skipped');
    skipped++;
    continue;
  }
  html = html.slice(0, idx) + SHIM + '\n' + html.slice(idx);
  fs.writeFileSync(file, html);
  if (hadOld) replaced++; else injected++;
}
console.log(`shim ${MARKER}: injected ${injected}, replaced ${replaced} legacy, skipped ${skipped} up-to-date (of ${files.length} templates)`);
