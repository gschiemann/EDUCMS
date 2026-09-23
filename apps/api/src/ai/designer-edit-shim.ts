/**
 * designer-edit-shim.ts — the EDUCMS-SHIM-V7 editability runtime, baked into
 * every AI Designer board at persist time so it becomes click-to-edit + accepts
 * live overrides via postMessage — the SAME protocol the static EXTERNAL_HTML
 * boards + PropertiesPanel already speak (educms-ready / educms-edit-mode /
 * educms-field-click / educms-overrides). Sourced VERBATIM from
 * apps/web/scripts/inject-shim-v2.cjs (MARKER EDUCMS-SHIM-V6) so there is ONE
 * runtime, not a parallel one. For srcdoc boards the URL-param + freeze paths are
 * dormant (no query string); the postMessage paths are what drive editing.
 *
 * Pure string + a tiny injector so it unit-tests without the Nest container.
 *
 * 2026-09-12 (M0-3) — ONE deliberate divergence from verbatim-V6:
 * `applyTextAndStyles` now also reads the BOOLEAN half of the text-style
 * contract (`{bold,italic,underline,strikethrough}`), which is what the
 * builder's text bar writes. Precedence matches the React zones, the packaged
 * boards and the kiosk shim: an explicit CSS value wins, underline and
 * strikethrough combine, and an already-CSS-shaped map renders unchanged.
 * The marker stays V6 — the click/freeze/apply protocol is untouched and
 * re-baking every AI board to renumber it would buy nothing.
 *
 * 2026-09-23 — EDUCMS-SHIM-V7 = V6 plus ONE statement, the first in its only
 * `message` listener: `if(e.source!==window.parent)return;`. The board lives in
 * a sandboxed srcdoc iframe, and every other frame on the same player page can
 * reach it as `parent.frames[i]` — a WEBPAGE zone runs a third-party page's JS
 * right beside it. V6 applied `educms-overrides` (words, styles, images, brand,
 * the action map) and `educms-edit-mode` from ANY of them. The only legitimate
 * sender is the board's parent: ExternalHtmlWidget posts from the window that
 * contains the iframe (player, builder, previews), and PropertiesPanel arms edit
 * mode from that same builder window. Nothing else changed, byte for byte:
 * V7 without that statement, under the V6 marker, hashes to the last pinned V6
 * (apps/web/src/lib/__tests__/designer-safe-srcdoc.test.ts proves it). The
 * marker changed this time so a saved board says which one it carries.
 *   • Boards kept before V7 still carry V6. buildSafeDesignerSrcdoc
 *     (apps/web/src/lib/designer-safe-srcdoc.ts) swaps a BYTE-IDENTICAL pinned
 *     V6 body for its V7 at render; injectDesignerEditShim below upgrades a V6
 *     block in place.
 *   • `EDUCMS-SHIM-V7` is also the name an old PACKAGED-board shim once carried
 *     (apps/web/scripts/inject-shim-v2.cjs). Different family: those boards are
 *     static files served by URL, they never pass through this module, and the
 *     srcdoc registry trusts a body only by its exact hash.
 */

/** The exact EDUCMS-SHIM-V7 runtime (a self-contained <script> IIFE). */
export const DESIGNER_EDIT_SHIM = "<script>/*EDUCMS-SHIM-V7*/(function(){try{\nvar editMode=false;\n// ── Gallery FREEZE mode ──────────────────────────────────────────────\n// Installed FIRST (this script is at end of <head>, before the board's own\n// <body> scripts), so the timer-wrappers below capture every timer the board\n// starts. Strict NO-OP unless the URL carries freeze=1.\nvar FROZEN=(function(){try{return new URLSearchParams(location.search).get('freeze')==='1';}catch(e){return false;}})();\nvar _frzStyle=null;\nfunction _unfreeze(){if(_frzStyle){try{if(_frzStyle.parentNode)_frzStyle.parentNode.removeChild(_frzStyle);}catch(e){}_frzStyle=null;}}\n(function(){if(!FROZEN)return;var ivs=[],tos=[],rafs=[];var _si=window.setInterval,_st=window.setTimeout,_raf=window.requestAnimationFrame;\nwindow.setInterval=function(){var id=_si.apply(window,arguments);try{ivs.push(id);}catch(e){}return id;};\nwindow.setTimeout=function(){var id=_st.apply(window,arguments);try{tos.push(id);}catch(e){}return id;};\nif(_raf)window.requestAnimationFrame=function(cb){var id=_raf.call(window,cb);try{rafs.push(id);}catch(e){}return id;};\nfunction freezeNow(){window.setInterval=_si;window.setTimeout=_st;if(_raf)window.requestAnimationFrame=_raf;try{for(var i=0;i<ivs.length;i++)clearInterval(ivs[i]);}catch(e){}try{for(var j=0;j<tos.length;j++)clearTimeout(tos[j]);}catch(e){}try{if(_raf)for(var k=0;k<rafs.length;k++)cancelAnimationFrame(rafs[k]);}catch(e){}try{var hi=_st(function(){},0);if(typeof hi==='number'&&hi>0){var lo=hi>100000?hi-100000:0;for(var z=hi;z>lo;z--){clearTimeout(z);clearInterval(z);}}}catch(e){}if(!_frzStyle){try{_frzStyle=document.createElement('style');_frzStyle.setAttribute('data-educms-freeze','1');_frzStyle.appendChild(document.createTextNode('*{animation:none!important;transition:none!important;}'));(document.head||document.documentElement).appendChild(_frzStyle);}catch(e){}}}\n// Settle window: let the board's auto-fit (setTimeout(autofit,500)+fonts.ready)\n// finish before killing its timers; then a brute-force id sweep catches any the\n// wrappers missed. Scheduled via the REAL setTimeout so this scheduler isn't\n// itself recorded/cleared.\n_st(freezeNow,1400);window.__educmsFreezeNow=freezeNow;}());\nfunction dec(p){if(!p)return null;try{var j=decodeURIComponent(Array.prototype.map.call(atob(p.replace(/-/g,'+').replace(/_/g,'/')),function(c){return '%'+('00'+c.charCodeAt(0).toString(16)).slice(-2);}).join(''));return JSON.parse(j);}catch(e){return null;}}\nfunction readParams(){var q=new URLSearchParams(location.search);return{brand:dec(q.get('brand'))||{},text:dec(q.get('text'))||{},styles:dec(q.get('textStyles'))||{},img:dec(q.get('img'))||{}};}\nvar BRAND_MAP={background:['--bg','--brand-canvas','--brand-bg','--surface-canvas','--c-bg'],surface:['--paper','--brand-paper','--surface','--c-surface','--c-panel'],\ntext:['--ink','--fg','--brand-ink','--brand-fg','--text','--c-ink'],muted:['--mute','--brand-mute','--text-muted','--c-ink2','--c-ink3'],\nprimary:['--primary','--brand-primary','--color-primary','--c-us','--c-primary','--c-accent'],accent:['--accent','--brand-accent','--brand-gold','--gold','--color-accent','--c-gold','--c-accent2'],\nfontDisplay:['--font-display','--font-headline','--f-display','--f-head'],fontBody:['--font-grotesk','--font-body','--font-sans','--f-body'],fontCondensed:['--font-condensed','--font-numeric','--f-mono']};\nfunction applyBrand(b){var r=document.documentElement.style;Object.keys(BRAND_MAP).forEach(function(k){if(b[k]){var val=/^font/i.test(k)?(\"'\"+String(b[k]).replace(/^['\"]|['\"]$/g,'')+\"'\"):b[k];BRAND_MAP[k].forEach(function(v){r.setProperty(v,val);});}});}\nvar _dEl=null;function dE(s){if(typeof s!=='string'||s.indexOf('&')===-1)return s;try{if(!_dEl)_dEl=document.createElement('textarea');_dEl.innerHTML=s;return _dEl.value;}catch(e){return s;}}\nfunction applyTextAndStyles(text,styles){var keys={};Object.keys(text||{}).forEach(function(k){keys[k]=1;});Object.keys(styles||{}).forEach(function(k){keys[k]=1;});Object.keys(keys).forEach(function(k){var nodes=document.querySelectorAll('[data-field=\"'+k.replace(/\"/g,'\\\\\"')+'\"]');for(var i=0;i<nodes.length;i++){var el=nodes[i];if(text&&typeof text[k]==='string'){var val=dE(text[k]);if(el.children.length===0){el.textContent=val;}else{var tn=null;for(var j=0;j<el.childNodes.length;j++){if(el.childNodes[j].nodeType===3){tn=el.childNodes[j];break;}}if(tn){tn.textContent=val;}else{el.insertBefore(document.createTextNode(val),el.firstChild);}}}var s=styles&&styles[k];if(s){if(s.color)el.style.color=s.color;if(s.fontSize!=null)el.style.fontSize=(typeof s.fontSize==='number'?s.fontSize+'px':s.fontSize);if(s.fontWeight!=null)el.style.fontWeight=String(s.fontWeight);else if(s.bold===true)el.style.fontWeight='800';if(s.fontStyle)el.style.fontStyle=s.fontStyle;else if(s.italic===true)el.style.fontStyle='italic';if(s.fontFamily)el.style.fontFamily=s.fontFamily;if(s.textDecoration){el.style.textDecoration=s.textDecoration;}else if(s.underline===true||s.strikethrough===true){var _dec=[];if(s.underline===true)_dec.push('underline');if(s.strikethrough===true)_dec.push('line-through');el.style.textDecoration=_dec.join(' ');}if(s.textAlign)el.style.textAlign=s.textAlign;if(s.backgroundColor)el.style.backgroundColor=s.backgroundColor;if(s.lineHeight!=null)el.style.lineHeight=String(s.lineHeight);}}});}\nfunction applyImages(img){if(!img)return;Object.keys(img).forEach(function(k){var v=img[k];if(typeof v!=='string')return;var esc=k.replace(/\"/g,'\\\\\"');var safe=v.replace(/[\"'()\\s]/g,'');var slot=document.querySelector('[data-imgslot=\"'+esc+'\"]');if(slot){slot.setAttribute('data-img',safe);if(safe){slot.style.backgroundImage=\"url('\"+safe+\"')\";slot.style.backgroundSize='cover';slot.style.backgroundPosition='center';slot.classList.add('has-img');slot.setAttribute('data-has-image','true');}else{slot.style.backgroundImage='';slot.classList.remove('has-img');slot.removeAttribute('data-has-image');}return;}if(!safe)return;var el=document.querySelector('[data-img=\"'+esc+'\"]')||document.querySelector('[data-slot=\"'+esc+'\"]');if(!el)return;if(el.tagName==='IMG'){el.setAttribute('src',safe);}else{el.style.backgroundImage=\"url('\"+safe+\"')\";el.style.backgroundSize='cover';el.style.backgroundPosition='center';}el.setAttribute('data-has-image','true');});}\nfunction armEdit(){document.querySelectorAll('[data-field],[data-imgslot],[data-img],[data-slot],[data-action]').forEach(function(el){if(el.__veArmed)return;el.__veArmed=true;el.style.cursor='pointer';var isAct=el.hasAttribute('data-action');el.addEventListener('mouseenter',function(){el.style.outline='2px dashed '+(isAct?'#f59e0b':'#06b6d4');el.style.outlineOffset='2px';});el.addEventListener('mouseleave',function(){el.style.outline='';});el.addEventListener('click',function(ev){ev.preventDefault();ev.stopPropagation();var key=el.getAttribute('data-action')||el.getAttribute('data-field')||el.getAttribute('data-imgslot')||el.getAttribute('data-slot')||el.getAttribute('data-img')||'';var kind=el.hasAttribute('data-action')?'action':(el.hasAttribute('data-field')?'text':'img');try{parent.postMessage({type:'educms-field-click',key:key,kind:kind},'*');}catch(_){}},true);});}\nvar WIRED={};\n// ── PLAYER MODE: a tap on a WIRED [data-action] hot zone ─────────────\n// Mirrors public/templates/kiosk/_edit-shim.js so there is ONE dialect:\n// post {type:'educms-action',key,action} and let the PLAYER run it through\n// the security-gated dispatchTouchAction. The player IGNORES the action we\n// send and re-resolves `key` against the operator's saved actionOverrides\n// (W0-02), so this board can never choose its own destination — the AI is\n// structurally incapable of inventing a link. Never fires in edit mode\n// (there a click configures the action instead). Delegated on document so\n// it survives any DOM the board rebuilds.\nfunction markWired(){try{var n=document.querySelectorAll('[data-action]');for(var i=0;i<n.length;i++){var el=n[i];var k=el.getAttribute('data-action');var on=!!(k&&WIRED[k]);el.setAttribute('data-action-wired',on?'1':'0');if(!editMode)el.style.cursor=on?'pointer':'';}}catch(e){}}\nfunction onActionTap(e){try{if(editMode)return;var t=e.target;var el=t&&t.closest?t.closest('[data-action]'):null;if(!el)return;var key=el.getAttribute('data-action');if(!key)return;var action=WIRED[key];if(action&&typeof action==='object'&&action.type){try{parent.postMessage({type:'educms-action',key:key,action:action},'*');}catch(_){}}}catch(e){}}\ndocument.addEventListener('click',onActionTap,true);\nfunction applyActions(a){if(a&&typeof a==='object')WIRED=a;markWired();}\nfunction applyAll(){var p=readParams();applyBrand(p.brand);applyTextAndStyles(p.text,p.styles);applyImages(p.img);markWired();if(editMode)armEdit();}\napplyBrand(readParams().brand);\nif(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',applyAll);}else{applyAll();}\ntry{parent.postMessage({type:'educms-ready'},'*');}catch(_){}\naddEventListener('message',function(e){try{if(e.source!==window.parent)return;var d=e.data;if(!d||typeof d!=='object')return;if(d.type==='educms-overrides'){if(d.brand)applyBrand(d.brand);applyTextAndStyles(d.text||{},d.textStyles||{});applyImages(d.img||{});applyActions(d.actions);}else if(d.type==='educms-edit-mode'){editMode=!!d.on;if(editMode){_unfreeze();armEdit();}markWired();}}catch(_){}});\n}catch(e){}})();</script>";

/** The marker DESIGNER_EDIT_SHIM opens with. */
const EDIT_SHIM_MARKER = 'EDUCMS-SHIM-V7';

/**
 * A V6 block as this module baked one before V7 (any <script> whose body opens
 * with the V6 marker). Only ever used through String#replace, which resets
 * lastIndex — never .test() on this global regex.
 */
const V6_SHIM_BLOCK =
  /<script\b[^>]*>\/\*EDUCMS-SHIM-V6\*\/[\s\S]*?<\/script\s*>/gi;

/**
 * Insert the edit shim into a board HTML document. Idempotent (skips if the
 * current marker is already present). A board baked before V7 is UPGRADED in
 * place, never stacked: its V6 block becomes the current shim right where it
 * stands, and any further V6 copy is dropped — two shims would apply every
 * override twice, and the V6 one would still take a sibling frame's. Refine /
 * "Edit with words" strips the runtime and re-injects, so it lands on V7 too.
 * Otherwise injects right before </head> (the shim must run before the board
 * body scripts, matching the static-board injector); falls back to before
 * </body>, then append.
 */
export function injectDesignerEditShim(html: string): string {
  if (typeof html !== "string" || !html) return html;
  let placed = html.indexOf(EDIT_SHIM_MARKER) !== -1; // already on the current shim
  const upgraded = html.replace(V6_SHIM_BLOCK, () => {
    if (placed) return '';
    placed = true;
    return DESIGNER_EDIT_SHIM;
  });
  if (placed) return upgraded;
  const headClose = html.search(/<\/head>/i);
  if (headClose !== -1) return html.slice(0, headClose) + DESIGNER_EDIT_SHIM + html.slice(headClose);
  const bodyClose = html.search(/<\/body>/i);
  if (bodyClose !== -1) return html.slice(0, bodyClose) + DESIGNER_EDIT_SHIM + html.slice(bodyClose);
  return html + DESIGNER_EDIT_SHIM;
}

/**
 * VOS-FIT-ENGINE — the deterministic text-placement engine baked into EVERY AI
 * Designer board at persist time. The model hand-sets pixel font-sizes that can
 * overflow, wrap, or collide (the 2026-06-29 "jumbled hunk" report); this engine
 * removes the guesswork: it measures each element flagged `data-fit` and
 * SHRINKS its font-size (binary search, down to a legibility floor) until it
 * fits its container on one line — so a headline/wordmark/price NEVER overflows
 * its box or wraps into the next element, regardless of content length or the
 * size the model guessed. Shrink-only by default (set data-fit-max to allow
 * growth), so it never surprises by ballooning short text. Re-runs on
 * fonts.ready + timeouts + resize because web fonts load late and change widths.
 * Structure-agnostic (keys only off the data-fit attribute), idempotent (marker),
 * runs inside the sandboxed srcdoc next to the edit shim. Chromium-83 safe.
 */
export const DESIGNER_LAYOUT_ENGINE =
  "<script>/*VOS-FIT-ENGINE*/(function(){try{" +
  // ── SIGNAGE LEGIBILITY FLOOR (2026-06-30) ── These boards play on 43-98in
  // screens viewed across a room, so NO text may render below a canvas-relative
  // minimum. The floor is 2.4% of the canvas SHORT side (≈26px @1920x1080,
  // ≈52px @2160x3840 4K-portrait) clamped to [24,60]. window.innerWidth/Height
  // are the board's DESIGN px in the srcdoc (the iframe is canvas-sized; the
  // OUTER element scales to the screen) — same basis guardDeco already uses.
  "var MINPX=24;function calcMin(){try{var W=window.__VOS_CW||window.innerWidth||1920;var H=window.__VOS_CH||window.innerHeight||1080;var d=Math.min(W,H);MINPX=Math.max(24,Math.min(60,Math.round(d*0.024)));}catch(e){MINPX=24;}}calcMin();" +
  // ── data-fit: shrink flagged display text to fit its box ──
  // 2026-08-25 (operator incident: a long scraped tagline used as the headline
  // rendered CLIPPED MID-PHRASE and overlapping its neighbours). The old pass
  // forced white-space:nowrap and shrank on ONE LINE only; when even the
  // legibility floor could not fit the string, `best` landed on the floor and
  // the element was LEFT nowrap — so it just ran off its box, over whatever sat
  // beside it. A headline must never do that, whatever its source or length.
  // Now: try one line first (unchanged, so every board that fit before is
  // byte-identical), and if one line is impossible at the floor, let it WRAP and
  // re-fit the wrapped block to the box's width AND height.
  "function fitOne(el){try{var p=el.parentElement;if(!p)return;" +
  "var cs=getComputedStyle(el);var cur=parseFloat(cs.fontSize)||40;" +
  "var min=parseFloat(el.getAttribute('data-fit-min'))||Math.max(14,Math.round(cur*0.35));if(min<MINPX)min=MINPX;" +
  "var max=parseFloat(el.getAttribute('data-fit-max'))||cur;if(max<min)max=min;" +
  "el.style.whiteSpace='nowrap';" +
  "var avail=p.clientWidth-(parseFloat(cs.paddingLeft)||0)-(parseFloat(cs.paddingRight)||0);" +
  "if(!avail||avail<8)return;el.style.fontSize=max+'px';" +
  "if(el.scrollWidth<=avail)return;" +
  "var lo=min,hi=max,best=min;for(var i=0;i<22;i++){var mid=(lo+hi)/2;el.style.fontSize=mid+'px';" +
  "if(el.scrollWidth<=avail){best=mid;lo=mid;}else{hi=mid;}}el.style.fontSize=best+'px';" +
  // Still wider than the box at the floor → one line is impossible. WRAP rather
  // than overflow: a wrapped headline pushes its siblings DOWN (normal flow, the
  // layout contract's own rule) instead of running across them.
  "if(el.scrollWidth<=avail+1)return;" +
  "el.style.whiteSpace='normal';el.style.overflowWrap='anywhere';el.style.wordBreak='break-word';" +
  "var availH=p.clientHeight-(parseFloat(cs.paddingTop)||0)-(parseFloat(cs.paddingBottom)||0);" +
  "function wrapFits(){if(el.scrollWidth>avail+1)return false;if(availH>8&&el.scrollHeight>availH+1)return false;return true;}" +
  "el.style.fontSize=max+'px';if(wrapFits())return;" +
  "var wlo=min,whi=max,wbest=min;for(var j=0;j<18;j++){var wm=(wlo+whi)/2;el.style.fontSize=wm+'px';" +
  "if(wrapFits()){wbest=wm;wlo=wm;}else{whi=wm;}}el.style.fontSize=wbest+'px';}catch(e){}}" +
  "function runFit(){try{var n=document.querySelectorAll('[data-fit]');for(var i=0;i<n.length;i++)fitOne(n[i]);}catch(e){}}" +
  // ── collision detection over visible TEXT-LEAF elements (post-transform) ──
  // 2026-09-22 — text a reader cannot see is not text. A 6%-opacity decorative
  // initial behind the headline (the old prompt's own art direction asked for
  // one) counted as a collision, and the repair shrank the 220px headline to
  // 101px and every menu row from 90 to 52 on a 4K board. faint() drops
  // aria-hidden text, text whose EFFECTIVE opacity (the product up the
  // ancestor chain) is under 0.2, and text painted in a color under 0.2 alpha
  // (unless it is gradient text painted through background-clip, which shows).
  "function alphaOf(c){var m=/rgba?\\(([^)]*)\\)/.exec(c||'');if(!m)return c==='transparent'?0:1;var p=m[1].split(/[\\s,\\/]+/).filter(function(x){return x!=='';});return p.length>=4?parseFloat(p[3]):1;}" +
  "function faint(el){try{if(el.closest&&el.closest('[aria-hidden=\"true\"]'))return true;var o=1,n=el;while(n&&n.nodeType===1){var v=parseFloat(getComputedStyle(n).opacity);if(!isNaN(v))o*=v;if(o<0.2)return true;n=n.parentElement;}" +
  "var cs=getComputedStyle(el);var clip=String(cs.webkitBackgroundClip||'')+String(cs.backgroundClip||'');if(clip.indexOf('text')===-1&&alphaOf(cs.webkitTextFillColor||cs.color)<0.2)return true;return false;}catch(e){return false;}}" +
  "function vis(el){var cs=getComputedStyle(el);return cs.visibility!=='hidden'&&cs.display!=='none'&&parseFloat(cs.opacity)!==0&&!faint(el);}" +
  "function leaves(){var out=[];if(!document.body)return out;var all=document.body.querySelectorAll('*');" +
  "for(var i=0;i<all.length;i++){var el=all[i];var t=(el.textContent||'').replace(/\\s+/g,'');if(!t)continue;" +
  "var ct=false,ch=el.children;for(var k=0;k<ch.length;k++){if((ch[k].textContent||'').replace(/\\s+/g,'')){ct=true;break;}}if(ct)continue;" +
  "if(!vis(el))continue;var r=grect(el);if(r.width<2||r.height<2)continue;out.push({el:el,r:r});}return out;}" +
  // GLYPH-accurate bounds: measure where the TEXT actually renders (Range client
  // rects), not the element's box. A wide container with short text (a full-width
  // eyebrow, a flex cell) has a box far larger than its glyphs — measuring the box
  // yields phantom overlaps (engine needlessly shrinks) AND misses real crowding
  // (e.g. stacked lines inside a round medallion). Range rects fix both.
  "function grect(el){try{var rg=document.createRange();rg.selectNodeContents(el);var rs=rg.getClientRects();if(!rs||!rs.length)return el.getBoundingClientRect();var x=1e9,y=1e9,R=-1e9,B=-1e9;for(var i=0;i<rs.length;i++){if(rs[i].width<1&&rs[i].height<1)continue;if(rs[i].left<x)x=rs[i].left;if(rs[i].top<y)y=rs[i].top;if(rs[i].right>R)R=rs[i].right;if(rs[i].bottom>B)B=rs[i].bottom;}if(R<x||B<y)return el.getBoundingClientRect();return {left:x,top:y,right:R,bottom:B,width:R-x,height:B-y};}catch(e){return el.getBoundingClientRect();}}" +
  "function pairs(lv){var p=[];for(var i=0;i<lv.length;i++)for(var j=i+1;j<lv.length;j++){var a=lv[i],b=lv[j];" +
  "if(a.el.contains(b.el)||b.el.contains(a.el))continue;" +
  "var ix=Math.min(a.r.right,b.r.right)-Math.max(a.r.left,b.r.left);" +
  "var iy=Math.min(a.r.bottom,b.r.bottom)-Math.max(a.r.top,b.r.top);" +
  "if(ix>6&&iy>6)p.push([a.el,b.el]);}return p;}" +
  "function nOver(){return pairs(leaves()).length;}" +
  // ── Pass A: flex leader-rows — name shrinks/wraps, short trailing value holds ──
  "function enforceRows(){try{var all=document.body.querySelectorAll('*');for(var i=0;i<all.length;i++){var el=all[i];" +
  "var cs=getComputedStyle(el);if(cs.display!=='flex'&&cs.display!=='inline-flex')continue;" +
  "if(cs.flexDirection&&cs.flexDirection.indexOf('column')===0)continue;" +
  "var kids=[];for(var k=0;k<el.children.length;k++)kids.push(el.children[k]);if(kids.length<2)continue;" +
  "for(var m=0;m<kids.length;m++){kids[m].style.minWidth='0';}" +
  "var first=kids[0];first.style.flexShrink='1';var fcs=getComputedStyle(first);if(fcs.whiteSpace==='nowrap')first.style.whiteSpace='normal';" +
  "var last=kids[kids.length-1];var lt=(last.textContent||'').trim();if(lt.length<=18){last.style.flexShrink='0';last.style.flexGrow='0';}" +
  "}}catch(e){}}" +
  // ── Pass B: stop text-clipping ancestors from hiding pushed content ──
  "function clearClips(ps){try{for(var i=0;i<ps.length;i++)for(var s=0;s<2;s++){var p=ps[i][s];for(var u=0;u<4&&p;u++){" +
  "var cs=getComputedStyle(p);if(cs.overflow==='hidden'||cs.overflowY==='hidden'||cs.overflowX==='hidden')p.style.overflow='visible';p=p.parentElement;}}}catch(e){}}" +
  // ── Pass C: scoped text down-scale until clean (idempotent via stored orig) ──
  "var stored=false;function storeOrig(){if(stored)return;var lv=leaves();for(var i=0;i<lv.length;i++){var el=lv[i].el;" +
  "if(!el.getAttribute('data-vos-fs')){var fs=parseFloat(getComputedStyle(el).fontSize)||0;if(fs>0)el.setAttribute('data-vos-fs',String(fs));}}stored=true;}" +
  // applyScale clamps at the legibility floor — the overlap down-scale can NEVER
  // push text below MINPX. If a board can't be both legible AND collision-free it
  // stays legible (content density is the prompt's job, not the engine's).
  // 2026-09-22 — it scales only the text inside `roots` (the colliding columns,
  // see scopes()), never the whole board: one crowded card must not shrink the
  // headline, the rail and every other card with it.
  "function applyScale(k,roots){var n=document.querySelectorAll('[data-vos-fs]');for(var i=0;i<n.length;i++){var el=n[i];if(roots){var inside=false;for(var r=0;r<roots.length;r++){if(roots[r]===el||roots[r].contains(el)){inside=true;break;}}if(!inside)continue;}" +
  "var o=parseFloat(el.getAttribute('data-vos-fs'))||0;if(o>0){var v=o*k;if(v<MINPX)v=MINPX;el.style.fontSize=(Math.round(v*100)/100)+'px';}}}" +
  // The COLUMN a collision lives in. For each colliding pair: the author's own
  // [data-fit-col] column when there is one. Else their nearest common
  // container when it is local (a card, a row, a column — at most 35% of the
  // canvas). Else, for the two sides of a big container (a rail vs the menu
  // grid), the branch holding each element. Everything outside stays as authored.
  // (Comments in this constant must never END a line with a semicolon: the web
  // drift tests extract it with a lazy match up to the first semicolon+newline.)
  "function lca(a,b){var s=[];for(var n=a;n;n=n.parentElement)s.push(n);for(var m=b;m;m=m.parentElement){if(s.indexOf(m)!==-1)return m;}return document.body;}" +
  "function branchOf(root,el){var n=el;while(n&&n.parentElement&&n.parentElement!==root)n=n.parentElement;return n||el;}" +
  "function fitColOf(el){for(var n=el;n&&n!==document.body;n=n.parentElement){if(n.hasAttribute&&n.hasAttribute('data-fit-col'))return n;}return null;}" +
  "function scopes(ps){var SA=(window.innerWidth||1920)*(window.innerHeight||1080);var out=[];function add(e){if(e&&e!==document.body&&e!==document.documentElement&&out.indexOf(e)===-1)out.push(e);}" +
  "for(var i=0;i<ps.length;i++){var a=ps[i][0],b=ps[i][1];var L=lca(a,b);var col=fitColOf(L);if(col){add(col);continue;}" +
  "var r=L.getBoundingClientRect();if(L!==document.body&&L!==document.documentElement&&r.width*r.height<=SA*0.35){add(L);continue;}" +
  "var ca=fitColOf(a),cb=fitColOf(b);add(ca||branchOf(L,a));add(cb||branchOf(L,b));}return out;}" +
  // ── FLOOR-UP: scale any under-floor text UP to MINPX (the legibility guard). ──
  // Stores the true original first so a later overlap down-scale starts from it.
  "function floorUp(){try{var lv=leaves();for(var i=0;i<lv.length;i++){var el=lv[i].el;var fs=parseFloat(getComputedStyle(el).fontSize)||0;if(fs>0&&fs<MINPX-0.5){if(!el.getAttribute('data-vos-fs'))el.setAttribute('data-vos-fs',String(fs));el.style.fontSize=MINPX+'px';}}}catch(e){}}" +
  // ── OVERFLOW CLAMP: no text may poke past the edge it has to live inside (the
  //    clipped-headline bug). Shrink-to-fit width down to MINPX; if it still
  //    overflows at the floor, let it WRAP rather than clip or go illegible. ──
  // 2026-08-25: the limit used to be the CANVAS only, so a headline that ran out
  // of its own COLUMN and across the photo panel / the next element was invisible
  // to this pass as long as it stayed inside 1920px — which is exactly what the
  // operator's board did ("…nd unparallel…" colliding at the column's right
  // edge). The limit is now the tighter of the canvas and the element's own
  // container box. Out-of-flow (absolute/fixed) elements keep the canvas-only
  // limit: they are deliberately positioned and their parent's box means nothing.
  "function limitFor(el){var W=window.innerWidth||1920;var lim={l:0,r:W};try{" +
  "var cs=getComputedStyle(el);if(cs.position==='absolute'||cs.position==='fixed')return lim;" +
  "var p=el.parentElement;if(!p||p===document.body||p===document.documentElement)return lim;" +
  "var pr=p.getBoundingClientRect();var pcs=getComputedStyle(p);" +
  "var pl=pr.left+(parseFloat(pcs.paddingLeft)||0)+(parseFloat(pcs.borderLeftWidth)||0);" +
  "var prr=pr.right-(parseFloat(pcs.paddingRight)||0)-(parseFloat(pcs.borderRightWidth)||0);" +
  "if(prr-pl<24)return lim;" +
  "if(pl>lim.l)lim.l=pl;if(prr<lim.r)lim.r=prr;return lim;}catch(e){return lim;}}" +
  "function clampOverflow(){try{var lv=leaves();for(var i=0;i<lv.length;i++){var el=lv[i].el;" +
  "var lim=limitFor(el);var pad=4;" +
  "var r=grect(el);if(r.right<=lim.r+pad&&r.left>=lim.l-pad)continue;" +
  "var cur=parseFloat(getComputedStyle(el).fontSize)||0;if(cur<=MINPX){el.style.whiteSpace='normal';el.style.overflowWrap='anywhere';continue;}" +
  "var lo=MINPX,hi=cur,best=MINPX;for(var s=0;s<14;s++){var mid=(lo+hi)/2;el.style.fontSize=mid+'px';var rr=grect(el);" +
  "if(rr.right<=lim.r+pad&&rr.left>=lim.l-pad){best=mid;lo=mid;}else{hi=mid;}}el.style.fontSize=best+'px';" +
  "var rf=grect(el);if(rf.right>lim.r+pad||rf.left<lim.l-pad){el.style.whiteSpace='normal';el.style.overflowWrap='anywhere';}}}catch(e){}}" +
  // ── DECORATION GUARD: a no-text GRAPHIC must NEVER cover text that isn't its
  //    own child (the 'giant sphere bleeds over the values' / 'badge lands on the
  //    headline' overshoot the model sometimes makes to fill the canvas). This is
  //    NOT a text-vs-text overlap so the passes above can't see it. We measure
  //    every pure-decoration element (5-70% of canvas, has a visual fill, no text
  //    of its own) and, if its box covers any text it does NOT contain, shrink it
  //    until clear; if it still covers at the floor, drop it BEHIND + translucent
  //    so the text always reads. Originals are stored so a later settled pass can
  //    restore an element that no longer collides (idempotent). Good boards never
  //    trigger it (nothing covers their text).
  "function _da(r){return Math.max(0,r.width)*Math.max(0,r.height);}" +
  // 2026-09-22 — a PHOTO is content, never decoration. The guard used to treat
  // the venue's photo panel as a decorative shape covering the headline and
  // shrink it (1280x2160 -> 640x1080 on a 4K board). An image slot, an <img> /
  // <video>, anything holding one, or anything inside one is exempt.
  "function isPhoto(el){try{var t=el.tagName;if(t==='IMG'||t==='VIDEO'||t==='PICTURE')return true;if(el.hasAttribute('data-imgslot')||el.hasAttribute('data-img'))return true;" +
  "if(el.closest&&el.closest('[data-imgslot],[data-img]'))return true;if(el.querySelector&&el.querySelector('img,video,picture,[data-imgslot],[data-img]'))return true;}catch(e){}return false;}" +
  "function guardDeco(){try{var lv=leaves();if(!lv.length)return;var SA=(window.innerWidth||1920)*(window.innerHeight||1080);var all=document.body.querySelectorAll('*');var cands=[];" +
  "for(var i=0;i<all.length;i++){var el=all[i];if((el.textContent||'').replace(/\\s+/g,''))continue;if(isPhoto(el))continue;" +
  "var cs=getComputedStyle(el);if(cs.display==='none'||cs.visibility==='hidden')continue;" +
  "var op=parseFloat(cs.opacity);if(isNaN(op))op=1;if(op<0.5&&el.getAttribute('data-vgo')===null)continue;" +
  "var bg=cs.backgroundImage&&cs.backgroundImage!=='none';var bc=cs.backgroundColor&&cs.backgroundColor!=='rgba(0, 0, 0, 0)'&&cs.backgroundColor!=='transparent';var cl=cs.clipPath&&cs.clipPath!=='none';" +
  "if(!(bg||bc||cl||el.tagName==='svg'))continue;" +
  "var r=el.getBoundingClientRect();var a=_da(r);if(a<SA*0.05||a>SA*0.7)continue;cands.push({el:el,a:a});}" +
  "cands.sort(function(x,y){return y.a-x.a;});" +
  "function cov(el){var er=el.getBoundingClientRect();for(var k=0;k<lv.length;k++){var T=lv[k];if(el===T.el||el.contains(T.el)||T.el.contains(el))continue;var ix=Math.min(er.right,T.r.right)-Math.max(er.left,T.r.left);var iy=Math.min(er.bottom,T.r.bottom)-Math.max(er.top,T.r.top);if(ix>8&&iy>8)return true;}return false;}" +
  "for(var c=0;c<cands.length;c++){var E=cands[c].el;" +
  "if(E.getAttribute('data-vgw')===null){E.setAttribute('data-vgw',String(E.offsetWidth));E.setAttribute('data-vgh',String(E.offsetHeight));E.setAttribute('data-vgo',E.style.opacity||'');E.setAttribute('data-vgz',E.style.zIndex||'');}" +
  "var ow=parseFloat(E.getAttribute('data-vgw'))||0,oh=parseFloat(E.getAttribute('data-vgh'))||0;" +
  "E.style.opacity=E.getAttribute('data-vgo');E.style.zIndex=E.getAttribute('data-vgz');if(ow>4)E.style.width=ow+'px';if(oh>4)E.style.height=oh+'px';" +
  "if(!cov(E))continue;" +
  "var cleared=false;if(ow>4&&oh>4){for(var s=0;s<8;s++){var f=1-(s+1)*0.1;E.style.width=Math.round(ow*f)+'px';E.style.height=Math.round(oh*f)+'px';if(!cov(E)){cleared=true;break;}}}" +
  "if(!cleared){try{E.style.zIndex='0';}catch(e){}E.style.opacity='0.2';}}}catch(e){}}" +
  // ── orchestrate: only mutate beyond data-fit when a real collision exists ──
  "function repair(){try{calcMin();runFit();floorUp();clampOverflow();guardDeco();if(nOver()===0)return;enforceRows();if(nOver()===0)return;" +
  "clearClips(pairs(leaves()));if(nOver()===0)return;storeOrig();" +
  // NB: do NOT call runFit() inside the shrink loop. runFit re-grows data-fit
  // elements to fill their WIDTH, which re-inflates a data-fit line (e.g. a
  // medallion's big middle line) and re-introduces the VERTICAL crowding we are
  // shrinking to resolve. runFit ran once up top; the loop shrinks the leaves in
  // the colliding columns (data-fit included, via their stored size) so stacked
  // lines actually separate.
  // 2026-09-22 — scoped + floored. Every stored leaf is put back at its authored
  // size first (so a re-run never compounds an earlier shrink), then ONLY the
  // colliding columns step down, 3% at a time, to 85% at the most. A board that
  // still collides at 85% keeps its size: shrinking a whole 4K board to half
  // size to dodge one overlap was the cure that killed the patient.
  "applyScale(1,null);var roots=scopes(pairs(leaves()));if(!roots.length)return;" +
  "for(var i=1;i<=5;i++){applyScale((100-3*i)/100,roots);if(nOver()===0)break;}}catch(e){}}" +
  "function run(){repair();}" +
  "if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run);else run();" +
  "if(document.fonts&&document.fonts.ready){try{document.fonts.ready.then(run);}catch(e){}}" +
  "setTimeout(run,400);setTimeout(run,1200);setTimeout(run,2000);window.addEventListener('resize',run);" +
  "}catch(e){}})();</script>";

/**
 * Insert the VOS-FIT-ENGINE just before </body> (it must run AFTER the board's
 * content exists so it can measure widths). Idempotent. Falls back to append.
 */
/**
 * Strip the server-injected runtime (edit shim, fit engine, canvas-dims) back
 * out of a board so the LLM revises the CLEAN authored board — then the caller
 * re-injects fresh runtime. Without this, "Edit with words" would feed the model
 * its own minified engine/shim scripts (which it would mangle or duplicate).
 */
export function stripInjectedRuntime(html: string): string {
  if (typeof html !== "string" || !html) return html;
  return html
    .replace(/<script>\/\*VOS-FIT-ENGINE\*\/[\s\S]*?<\/script>/g, "")
    .replace(/<script>\/\*EDUCMS-SHIM-V\d+\*\/[\s\S]*?<\/script>/g, "")
    .replace(/<script>\/\*VOS-CANVAS\*\/[\s\S]*?<\/script>/g, "");
}

export function injectDesignerLayoutEngine(
  html: string,
  screenWidth?: number,
  screenHeight?: number,
): string {
  if (typeof html !== "string" || !html) return html;
  if (html.indexOf("VOS-FIT-ENGINE") !== -1) return html; // already injected
  // Bake the DESIGN canvas so the legibility floor (MINPX) is computed from the
  // board's real dimensions in EVERY render context — the full-screen player AND
  // the scaled-down editor/picker preview (where window.innerWidth would be the
  // tiny preview size, under-applying the floor in the exact view the operator
  // judges from). Falls back to window dims when not supplied (old/external HTML).
  const w = Number(screenWidth), h = Number(screenHeight);
  const dims =
    Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0
      ? `<script>/*VOS-CANVAS*/window.__VOS_CW=${Math.round(w)};window.__VOS_CH=${Math.round(h)};</script>`
      : "";
  const block = dims + DESIGNER_LAYOUT_ENGINE;
  const bodyClose = html.search(/<\/body>/i);
  if (bodyClose !== -1) return html.slice(0, bodyClose) + block + html.slice(bodyClose);
  return html + block;
}
