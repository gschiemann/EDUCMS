/**
 * designer-edit-shim.ts — the EDUCMS-SHIM-V6 editability runtime, baked into
 * every AI Designer board at persist time so it becomes click-to-edit + accepts
 * live overrides via postMessage — the SAME protocol the static EXTERNAL_HTML
 * boards + PropertiesPanel already speak (educms-ready / educms-edit-mode /
 * educms-field-click / educms-overrides). Sourced VERBATIM from
 * apps/web/scripts/inject-shim-v2.cjs (MARKER EDUCMS-SHIM-V6) so there is ONE
 * runtime, not a parallel one. For srcdoc boards the URL-param + freeze paths are
 * dormant (no query string); the postMessage paths are what drive editing.
 *
 * Pure string + a tiny injector so it unit-tests without the Nest container.
 */

/** The exact EDUCMS-SHIM-V6 runtime (a self-contained <script> IIFE). */
export const DESIGNER_EDIT_SHIM = "<script>/*EDUCMS-SHIM-V6*/(function(){try{\nvar editMode=false;\n// ── Gallery FREEZE mode ──────────────────────────────────────────────\n// Installed FIRST (this script is at end of <head>, before the board's own\n// <body> scripts), so the timer-wrappers below capture every timer the board\n// starts. Strict NO-OP unless the URL carries freeze=1.\nvar FROZEN=(function(){try{return new URLSearchParams(location.search).get('freeze')==='1';}catch(e){return false;}})();\nvar _frzStyle=null;\nfunction _unfreeze(){if(_frzStyle){try{if(_frzStyle.parentNode)_frzStyle.parentNode.removeChild(_frzStyle);}catch(e){}_frzStyle=null;}}\n(function(){if(!FROZEN)return;var ivs=[],tos=[],rafs=[];var _si=window.setInterval,_st=window.setTimeout,_raf=window.requestAnimationFrame;\nwindow.setInterval=function(){var id=_si.apply(window,arguments);try{ivs.push(id);}catch(e){}return id;};\nwindow.setTimeout=function(){var id=_st.apply(window,arguments);try{tos.push(id);}catch(e){}return id;};\nif(_raf)window.requestAnimationFrame=function(cb){var id=_raf.call(window,cb);try{rafs.push(id);}catch(e){}return id;};\nfunction freezeNow(){window.setInterval=_si;window.setTimeout=_st;if(_raf)window.requestAnimationFrame=_raf;try{for(var i=0;i<ivs.length;i++)clearInterval(ivs[i]);}catch(e){}try{for(var j=0;j<tos.length;j++)clearTimeout(tos[j]);}catch(e){}try{if(_raf)for(var k=0;k<rafs.length;k++)cancelAnimationFrame(rafs[k]);}catch(e){}try{var hi=_st(function(){},0);if(typeof hi==='number'&&hi>0){var lo=hi>100000?hi-100000:0;for(var z=hi;z>lo;z--){clearTimeout(z);clearInterval(z);}}}catch(e){}if(!_frzStyle){try{_frzStyle=document.createElement('style');_frzStyle.setAttribute('data-educms-freeze','1');_frzStyle.appendChild(document.createTextNode('*{animation:none!important;transition:none!important;}'));(document.head||document.documentElement).appendChild(_frzStyle);}catch(e){}}}\n// Settle window: let the board's auto-fit (setTimeout(autofit,500)+fonts.ready)\n// finish before killing its timers; then a brute-force id sweep catches any the\n// wrappers missed. Scheduled via the REAL setTimeout so this scheduler isn't\n// itself recorded/cleared.\n_st(freezeNow,1400);window.__educmsFreezeNow=freezeNow;}());\nfunction dec(p){if(!p)return null;try{var j=decodeURIComponent(Array.prototype.map.call(atob(p.replace(/-/g,'+').replace(/_/g,'/')),function(c){return '%'+('00'+c.charCodeAt(0).toString(16)).slice(-2);}).join(''));return JSON.parse(j);}catch(e){return null;}}\nfunction readParams(){var q=new URLSearchParams(location.search);return{brand:dec(q.get('brand'))||{},text:dec(q.get('text'))||{},styles:dec(q.get('textStyles'))||{},img:dec(q.get('img'))||{}};}\nvar BRAND_MAP={background:['--bg','--brand-canvas','--brand-bg','--surface-canvas','--c-bg'],surface:['--paper','--brand-paper','--surface','--c-surface','--c-panel'],\ntext:['--ink','--fg','--brand-ink','--brand-fg','--text','--c-ink'],muted:['--mute','--brand-mute','--text-muted','--c-ink2','--c-ink3'],\nprimary:['--primary','--brand-primary','--color-primary','--c-us','--c-primary','--c-accent'],accent:['--accent','--brand-accent','--brand-gold','--gold','--color-accent','--c-gold','--c-accent2'],\nfontDisplay:['--font-display','--font-headline','--f-display','--f-head'],fontBody:['--font-grotesk','--font-body','--font-sans','--f-body'],fontCondensed:['--font-condensed','--font-numeric','--f-mono']};\nfunction applyBrand(b){var r=document.documentElement.style;Object.keys(BRAND_MAP).forEach(function(k){if(b[k]){var val=/^font/i.test(k)?(\"'\"+String(b[k]).replace(/^['\"]|['\"]$/g,'')+\"'\"):b[k];BRAND_MAP[k].forEach(function(v){r.setProperty(v,val);});}});}\nvar _dEl=null;function dE(s){if(typeof s!=='string'||s.indexOf('&')===-1)return s;try{if(!_dEl)_dEl=document.createElement('textarea');_dEl.innerHTML=s;return _dEl.value;}catch(e){return s;}}\nfunction applyTextAndStyles(text,styles){var keys={};Object.keys(text||{}).forEach(function(k){keys[k]=1;});Object.keys(styles||{}).forEach(function(k){keys[k]=1;});Object.keys(keys).forEach(function(k){var nodes=document.querySelectorAll('[data-field=\"'+k.replace(/\"/g,'\\\\\"')+'\"]');for(var i=0;i<nodes.length;i++){var el=nodes[i];if(text&&typeof text[k]==='string'){var val=dE(text[k]);if(el.children.length===0){el.textContent=val;}else{var tn=null;for(var j=0;j<el.childNodes.length;j++){if(el.childNodes[j].nodeType===3){tn=el.childNodes[j];break;}}if(tn){tn.textContent=val;}else{el.insertBefore(document.createTextNode(val),el.firstChild);}}}var s=styles&&styles[k];if(s){if(s.color)el.style.color=s.color;if(s.fontSize!=null)el.style.fontSize=(typeof s.fontSize==='number'?s.fontSize+'px':s.fontSize);if(s.fontWeight!=null)el.style.fontWeight=String(s.fontWeight);if(s.fontStyle)el.style.fontStyle=s.fontStyle;if(s.fontFamily)el.style.fontFamily=s.fontFamily;if(s.textDecoration)el.style.textDecoration=s.textDecoration;if(s.textAlign)el.style.textAlign=s.textAlign;if(s.backgroundColor)el.style.backgroundColor=s.backgroundColor;if(s.lineHeight!=null)el.style.lineHeight=String(s.lineHeight);}}});}\nfunction applyImages(img){if(!img)return;Object.keys(img).forEach(function(k){var v=img[k];if(typeof v!=='string')return;var esc=k.replace(/\"/g,'\\\\\"');var safe=v.replace(/[\"'()\\s]/g,'');var slot=document.querySelector('[data-imgslot=\"'+esc+'\"]');if(slot){slot.setAttribute('data-img',safe);if(safe){slot.style.backgroundImage=\"url('\"+safe+\"')\";slot.style.backgroundSize='cover';slot.style.backgroundPosition='center';slot.classList.add('has-img');slot.setAttribute('data-has-image','true');}else{slot.style.backgroundImage='';slot.classList.remove('has-img');slot.removeAttribute('data-has-image');}return;}if(!safe)return;var el=document.querySelector('[data-img=\"'+esc+'\"]')||document.querySelector('[data-slot=\"'+esc+'\"]');if(!el)return;if(el.tagName==='IMG'){el.setAttribute('src',safe);}else{el.style.backgroundImage=\"url('\"+safe+\"')\";el.style.backgroundSize='cover';el.style.backgroundPosition='center';}el.setAttribute('data-has-image','true');});}\nfunction armEdit(){document.querySelectorAll('[data-field],[data-imgslot],[data-img],[data-slot],[data-action]').forEach(function(el){if(el.__veArmed)return;el.__veArmed=true;el.style.cursor='pointer';var isAct=el.hasAttribute('data-action');el.addEventListener('mouseenter',function(){el.style.outline='2px dashed '+(isAct?'#f59e0b':'#06b6d4');el.style.outlineOffset='2px';});el.addEventListener('mouseleave',function(){el.style.outline='';});el.addEventListener('click',function(ev){ev.preventDefault();ev.stopPropagation();var key=el.getAttribute('data-action')||el.getAttribute('data-field')||el.getAttribute('data-imgslot')||el.getAttribute('data-slot')||el.getAttribute('data-img')||'';var kind=el.hasAttribute('data-action')?'action':(el.hasAttribute('data-field')?'text':'img');try{parent.postMessage({type:'educms-field-click',key:key,kind:kind},'*');}catch(_){}},true);});}\nfunction applyAll(){var p=readParams();applyBrand(p.brand);applyTextAndStyles(p.text,p.styles);applyImages(p.img);if(editMode)armEdit();}\napplyBrand(readParams().brand);\nif(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',applyAll);}else{applyAll();}\ntry{parent.postMessage({type:'educms-ready'},'*');}catch(_){}\naddEventListener('message',function(e){try{var d=e.data;if(!d||typeof d!=='object')return;if(d.type==='educms-overrides'){if(d.brand)applyBrand(d.brand);applyTextAndStyles(d.text||{},d.textStyles||{});applyImages(d.img||{});}else if(d.type==='educms-edit-mode'){editMode=!!d.on;if(editMode){_unfreeze();armEdit();}}}catch(_){}});\n}catch(e){}})();</script>";

/**
 * Insert the edit shim into a board HTML document. Idempotent (skips if the
 * marker is already present). Injects right before </head> (the shim must run
 * before the board body scripts, matching the static-board injector); falls
 * back to before </body>, then append.
 */
export function injectDesignerEditShim(html: string): string {
  if (typeof html !== "string" || !html) return html;
  if (html.indexOf("EDUCMS-SHIM-V6") !== -1) return html; // already shimmed
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
  // ── data-fit: shrink flagged display text to fit its box on one line ──
  "function fitOne(el){try{var p=el.parentElement;if(!p)return;" +
  "var cs=getComputedStyle(el);var cur=parseFloat(cs.fontSize)||40;" +
  "var min=parseFloat(el.getAttribute('data-fit-min'))||Math.max(14,Math.round(cur*0.35));" +
  "var max=parseFloat(el.getAttribute('data-fit-max'))||cur;if(max<min)max=min;" +
  "el.style.whiteSpace='nowrap';" +
  "var avail=p.clientWidth-(parseFloat(cs.paddingLeft)||0)-(parseFloat(cs.paddingRight)||0);" +
  "if(!avail||avail<8)return;el.style.fontSize=max+'px';" +
  "if(el.scrollWidth<=avail)return;" +
  "var lo=min,hi=max,best=min;for(var i=0;i<22;i++){var mid=(lo+hi)/2;el.style.fontSize=mid+'px';" +
  "if(el.scrollWidth<=avail){best=mid;lo=mid;}else{hi=mid;}}el.style.fontSize=best+'px';}catch(e){}}" +
  "function runFit(){try{var n=document.querySelectorAll('[data-fit]');for(var i=0;i<n.length;i++)fitOne(n[i]);}catch(e){}}" +
  // ── collision detection over visible TEXT-LEAF elements (post-transform) ──
  "function vis(el){var cs=getComputedStyle(el);return cs.visibility!=='hidden'&&cs.display!=='none'&&parseFloat(cs.opacity)!==0;}" +
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
  // ── Pass C: uniform text down-scale until clean (idempotent via stored orig) ──
  "var stored=false;function storeOrig(){if(stored)return;var lv=leaves();for(var i=0;i<lv.length;i++){var el=lv[i].el;" +
  "if(!el.getAttribute('data-vos-fs')){var fs=parseFloat(getComputedStyle(el).fontSize)||0;if(fs>0)el.setAttribute('data-vos-fs',String(fs));}}stored=true;}" +
  "function applyScale(k){var n=document.querySelectorAll('[data-vos-fs]');for(var i=0;i<n.length;i++){var o=parseFloat(n[i].getAttribute('data-vos-fs'))||0;if(o>0)n[i].style.fontSize=(Math.round(o*k*100)/100)+'px';}}" +
  // ── orchestrate: only mutate beyond data-fit when a real collision exists ──
  "function repair(){try{runFit();if(nOver()===0)return;enforceRows();if(nOver()===0)return;" +
  "clearClips(pairs(leaves()));if(nOver()===0)return;storeOrig();" +
  // NB: do NOT call runFit() inside the shrink loop. runFit re-grows data-fit
  // elements to fill their WIDTH, which re-inflates a data-fit line (e.g. a
  // medallion's big middle line) and re-introduces the VERTICAL crowding we are
  // shrinking to resolve. runFit ran once up top; the loop shrinks ALL leaves
  // (data-fit included, via their stored size) so stacked lines actually separate.
  "var k=1.0;for(var i=0;i<9;i++){k-=0.06;applyScale(k);if(nOver()===0)break;if(k<=0.5)break;}}catch(e){}}" +
  "function run(){repair();}" +
  "if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run);else run();" +
  "if(document.fonts&&document.fonts.ready){try{document.fonts.ready.then(run);}catch(e){}}" +
  "setTimeout(run,400);setTimeout(run,1200);setTimeout(run,2000);window.addEventListener('resize',run);" +
  "}catch(e){}})();</script>";

/**
 * Insert the VOS-FIT-ENGINE just before </body> (it must run AFTER the board's
 * content exists so it can measure widths). Idempotent. Falls back to append.
 */
export function injectDesignerLayoutEngine(html: string): string {
  if (typeof html !== "string" || !html) return html;
  if (html.indexOf("VOS-FIT-ENGINE") !== -1) return html; // already injected
  const bodyClose = html.search(/<\/body>/i);
  if (bodyClose !== -1) return html.slice(0, bodyClose) + DESIGNER_LAYOUT_ENGINE + html.slice(bodyClose);
  return html + DESIGNER_LAYOUT_ENGINE;
}
