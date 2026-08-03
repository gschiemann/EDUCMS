/**
 * spatial-nav-shim.ts — the remote-control spatial-navigation runtime, injected
 * SERVER-SIDE into every `/api/v1/proxy/web` document.
 *
 * ─── WHY THIS MOVED SERVER-SIDE (security wave 2026-08-02, INJ-001a) ───────
 *
 * Until now the shim was injected from the React parent with
 * `iframe.contentWindow.eval(SHIM_JS)` (apps/web/.../webpage-spatial-nav.ts).
 * That call is only legal because the proxied frame was SAME-ORIGIN with the
 * dashboard/player — and that same-origin reachability IS the vulnerability:
 * any script the upstream page runs (or that an attacker injects into it) sits
 * in our origin, can read `parent.document`, our localStorage device token, and
 * can drive the player. We now ship the WEBPAGE proxy iframe with
 * `sandbox="allow-scripts allow-popups-to-escape-sandbox"` (NO
 * `allow-same-origin`), which makes the frame a null origin — and kills
 * `contentWindow.eval`.
 *
 * So the shim is baked into the proxied document here instead. No eval, no
 * same-origin requirement, and it works on the FIRST paint (before the parent's
 * `load` handler would even have fired).
 *
 * ─── THE PARENT <-> FRAME CHANNEL ─────────────────────────────────────────
 *
 * A null-origin sandboxed frame reports `event.origin === "null"` to its
 * parent, so on the PARENT side the load-bearing check is
 * `event.source === iframe.contentWindow` (see webpage-spatial-nav.ts).
 * On THIS side (inside the frame) the parent has a real origin, so we check
 * BOTH `event.source === window.parent` AND that `event.origin` is in the
 * server-baked allowlist (derived from ALLOWED_ORIGINS).
 *
 * Protocol — versioned namespace, FIXED command enum, nothing else accepted:
 *   parent -> frame  { vosnav: 'vosnav/1', cmd: 'arm'|'disarm'|'up'|'down'
 *                                             |'left'|'right'|'activate' }
 *   frame  -> parent { vosnav: 'vosnav/1', evt: 'ready'|'result',
 *                      cmd?: string, moved?: boolean }
 *
 * There is deliberately NO command that carries code, a selector, a URL, or any
 * other payload — the enum is the whole vocabulary. Never add one.
 *
 * ─── DORMANT UNTIL ARMED (keeps the 2026-06-08 two-click fix) ─────────────
 *
 * The shim auto-focuses an element and re-focuses via a MutationObserver. On a
 * TV kiosk that is the feature; on the DASHBOARD (template preview iframes,
 * which also route through this proxy) it continuously steals keyboard focus
 * and every sidebar click needed two clicks (the 2026-06-08 fire — see
 * WidgetRenderer's WEBPAGE onLoad comment). The old parent-side injector gated
 * on the parent's pathname; a server-injected shim cannot see the parent's
 * path, so instead it installs itself INERT and only wakes on an `arm` command
 * from an allowlisted parent. Display surfaces arm it; the dashboard never
 * does. Same outcome, enforced at the frame instead of the injector.
 *
 * Chromium-83 safe (NovaStar Taurus LED controllers): ES5 only — no
 * const/let, no arrow functions, no template literals, no `Array#includes`,
 * no optional chaining.
 */

/** Protocol namespace. Must stay byte-identical to PARENT `VOSNAV_NS`. */
export const VOSNAV_NS = 'vosnav/1';

/** The complete command vocabulary. Anything else is ignored by the shim. */
export const VOSNAV_COMMANDS = [
  'arm',
  'disarm',
  'up',
  'down',
  'left',
  'right',
  'activate',
] as const;

/**
 * Resolve the origins the shim will accept commands from. Source of truth is
 * ALLOWED_ORIGINS — the same allowlist the API's CORS layer uses, and the one
 * production refuses to boot without (main.ts:206). In dev (unset) we fall back
 * to the local Next dev server so spatial nav keeps working on localhost.
 */
export function resolveParentOrigins(rawEnv?: string): string[] {
  var raw = typeof rawEnv === 'string' ? rawEnv : process.env.ALLOWED_ORIGINS;
  var out: string[] = [];
  if (raw) {
    var parts = raw.split(',');
    for (var i = 0; i < parts.length; i++) {
      var candidate = parts[i].trim();
      if (!candidate) continue;
      try {
        // Normalise "https://x.com/" -> "https://x.com" so the shim's
        // strict `event.origin` equality can never fail on a stray slash.
        out.push(new URL(candidate).origin);
      } catch {
        /* malformed entry in ALLOWED_ORIGINS — skip, never throw at request time */
      }
    }
  }
  if (out.length === 0) {
    out.push('http://localhost:3000');
    out.push('http://127.0.0.1:3000');
  }
  // De-dupe without Set spread (keeps the ES target flexible).
  var seen: Record<string, boolean> = {};
  var uniq: string[] = [];
  for (var j = 0; j < out.length; j++) {
    if (!seen[out[j]]) {
      seen[out[j]] = true;
      uniq.push(out[j]);
    }
  }
  return uniq;
}

/**
 * Storage fallback for the opaque (sandboxed, null) origin.
 *
 * `localStorage` / `sessionStorage` THROW SecurityError in a null-origin
 * document. Plenty of ordinary sites touch them at the top of a bundle, and an
 * uncaught throw there takes the whole page's JS with it — which on a signage
 * screen looks like "the website loaded blank". Since a proxied page never had
 * access to the real upstream storage anyway (different origin, no cookies
 * relayed), an in-memory shim is strictly more functional than a throw and
 * strictly less powerful than real storage.
 *
 * Injected only in interactive mode (static mode strips the page's scripts, so
 * nothing would call it).
 */
export const OPAQUE_STORAGE_POLYFILL =
  '<script>/*VOS-OPAQUE-STORAGE*/(function(){try{' +
  'function mem(){var m={};return{getItem:function(k){k=String(k);return Object.prototype.hasOwnProperty.call(m,k)?m[k]:null;},' +
  'setItem:function(k,v){m[String(k)]=String(v);},removeItem:function(k){delete m[String(k)];},' +
  'clear:function(){m={};},key:function(i){var ks=Object.keys(m);return i<ks.length?ks[i]:null;},' +
  'get length(){return Object.keys(m).length;}};}' +
  'function ensure(name){var ok=false;try{var s=window[name];if(s){s.setItem("__vos_probe","1");s.removeItem("__vos_probe");ok=true;}}catch(e){ok=false;}' +
  'if(ok)return;try{Object.defineProperty(window,name,{configurable:true,writable:true,value:mem()});}catch(e){try{window[name]=mem();}catch(e2){}}}' +
  'ensure("localStorage");ensure("sessionStorage");' +
  '}catch(e){}})();</script>';

/**
 * Build the spatial-nav shim <script> for a given parent-origin allowlist.
 *
 * The allowlist is baked in as a JSON literal — it is server-controlled, never
 * derived from the request, so a hostile upstream page (or a crafted `?url=`)
 * cannot widen it.
 */
export function buildSpatialNavShim(parentOrigins: string[]): string {
  var originsJson = JSON.stringify(parentOrigins);
  var cmdsJson = JSON.stringify(VOSNAV_COMMANDS);
  var nsJson = JSON.stringify(VOSNAV_NS);

  return (
    '<script>/*VOS-SPATIAL-NAV*/(function(){' +
    'if(window.__eduCmsSpatialNav)return;window.__eduCmsSpatialNav=true;' +
    'try{' +
    'var NS=' + nsJson + ';' +
    'var PARENTS=' + originsJson + ';' +
    'var CMDS=' + cmdsJson + ';' +
    'var armed=false;var mo=null;var initTimer=null;' +
    'var FOCUS_SEL=[' +
    "'a[href]'," +
    "'button:not([disabled])'," +
    '\'input:not([disabled]):not([type="hidden"])\',' +
    "'select:not([disabled])'," +
    "'textarea:not([disabled])'," +
    '\'[tabindex]:not([tabindex="-1"])\',' +
    '\'[role="button"]\',' +
    '\'[role="link"]\',' +
    '\'[role="menuitem"]\',' +
    '\'[role="tab"]\',' +
    '\'[contenteditable="true"]\'' +
    "].join(',');" +
    // ── focus ring ───────────────────────────────────────────────────────
    "function ring(){var id='__edu-cms-spatial-nav-style';if(document.getElementById(id))return;" +
    "var s=document.createElement('style');s.id=id;" +
    "s.textContent='*:focus, *:focus-visible {'+" +
    "'  outline: 3px solid #4f46e5 !important;'+" +
    "'  outline-offset: 2px !important;'+" +
    "'  box-shadow: 0 0 0 5px rgba(79, 70, 229, 0.35) !important;'+" +
    "'}';" +
    '(document.head||document.documentElement).appendChild(s);}' +
    // ── geometry helpers (identical maths to the pre-2026-08 shim) ───────
    'function isVisible(el){if(!el||!el.getBoundingClientRect)return false;' +
    'var r=el.getBoundingClientRect();if(r.width<=0||r.height<=0)return false;' +
    'if(r.bottom<0||r.right<0)return false;' +
    'var vh=window.innerHeight||document.documentElement.clientHeight;' +
    'var vw=window.innerWidth||document.documentElement.clientWidth;' +
    'if(r.top>vh||r.left>vw)return false;' +
    'var st=window.getComputedStyle(el);' +
    "if(st.visibility==='hidden'||st.display==='none')return false;" +
    'if(parseFloat(st.opacity)===0)return false;return true;}' +
    'function center(r){return {x:r.left+r.width/2,y:r.top+r.height/2};}' +
    'function candidates(){var nodes=document.querySelectorAll(FOCUS_SEL);var out=[];' +
    'for(var i=0;i<nodes.length;i++){if(isVisible(nodes[i]))out.push(nodes[i]);}return out;}' +
    'function score(curRect,candRect,dir){var cur=center(curRect),cand=center(candRect);' +
    'var dx=cand.x-cur.x,dy=cand.y-cur.y;var inCone=' +
    "(dir==='up'&&dy<-1&&Math.abs(dx)<=Math.abs(dy)+50)||" +
    "(dir==='down'&&dy>1&&Math.abs(dx)<=Math.abs(dy)+50)||" +
    "(dir==='left'&&dx<-1&&Math.abs(dy)<=Math.abs(dx)+50)||" +
    "(dir==='right'&&dx>1&&Math.abs(dy)<=Math.abs(dx)+50);" +
    'if(!inCone)return Infinity;' +
    "var primary=(dir==='up'||dir==='down')?Math.abs(dy):Math.abs(dx);" +
    "var secondary=(dir==='up'||dir==='down')?Math.abs(dx):Math.abs(dy);" +
    'return primary+secondary*3;}' +
    'function pickInitial(){var list=candidates();if(!list.length)return null;' +
    'list.sort(function(a,b){var ra=a.getBoundingClientRect(),rb=b.getBoundingClientRect();' +
    'if(Math.abs(ra.top-rb.top)>8)return ra.top-rb.top;return ra.left-rb.left;});return list[0];}' +
    'function scrollInDir(dir){' +
    "var amt=Math.round((dir==='up'||dir==='down'?(window.innerHeight||600):(window.innerWidth||800))*0.6);" +
    'var dx=0,dy=0;' +
    "if(dir==='up')dy=-amt;else if(dir==='down')dy=amt;else if(dir==='left')dx=-amt;else if(dir==='right')dx=amt;" +
    "try{window.scrollBy({top:dy,left:dx,behavior:'smooth'});return true;}catch(e){window.scrollBy(dx,dy);return true;}}" +
    'function move(dir){var active=document.activeElement;var list=candidates();' +
    'if(!list.length)return scrollInDir(dir);' +
    'if(!active||active===document.body||list.indexOf(active)===-1){var first=pickInitial();' +
    "if(first){first.focus();first.scrollIntoView({block:'nearest',inline:'nearest'});return true;}" +
    'return scrollInDir(dir);}' +
    'var curR=active.getBoundingClientRect();var best=null,bestScore=Infinity;' +
    'for(var i=0;i<list.length;i++){if(list[i]===active)continue;' +
    'var sc=score(curR,list[i].getBoundingClientRect(),dir);if(sc<bestScore){bestScore=sc;best=list[i];}}' +
    "if(best){best.focus();best.scrollIntoView({block:'nearest',inline:'nearest'});return true;}" +
    'return scrollInDir(dir);}' +
    'function activate(){var el=document.activeElement;' +
    'if(!el||el===document.body){var first=pickInitial();if(first){first.focus();return true;}return false;}' +
    "var tag=(el.tagName||'').toLowerCase();" +
    "if(tag==='input'||tag==='textarea'||el.isContentEditable)return false;" +
    'try{el.click();}catch(e){}return true;}' +
    // ── the FIXED command table. No dynamic dispatch, no eval. ───────────
    'function run(cmd){' +
    "if(cmd==='up')return move('up');" +
    "if(cmd==='down')return move('down');" +
    "if(cmd==='left')return move('left');" +
    "if(cmd==='right')return move('right');" +
    "if(cmd==='activate')return activate();" +
    'return false;}' +
    'function focusFirstIfIdle(){var ae=document.activeElement;' +
    'if(!ae||ae===document.body){var first=pickInitial();if(first)first.focus();}}' +
    // ── arm / disarm ─────────────────────────────────────────────────────
    'function arm(){if(armed)return;armed=true;ring();' +
    'var settle=null;' +
    'try{mo=new MutationObserver(function(){if(settle)clearTimeout(settle);' +
    'settle=setTimeout(function(){if(armed)focusFirstIfIdle();},250);});' +
    'mo.observe(document.documentElement,{childList:true,subtree:true});}catch(e){}' +
    'initTimer=setTimeout(function(){if(armed)focusFirstIfIdle();},100);}' +
    'function disarm(){if(!armed)return;armed=false;' +
    'try{if(mo)mo.disconnect();}catch(e){}mo=null;' +
    'if(initTimer){clearTimeout(initTimer);initTimer=null;}}' +
    // ── in-frame keydown: only when the frame itself holds focus ─────────
    "document.addEventListener('keydown',function(e){" +
    'if(!armed)return;' +
    'var ae=document.activeElement;' +
    "var aeTag=(ae&&ae.tagName||'').toLowerCase();" +
    "var isTyping=(aeTag==='input'||aeTag==='textarea'||(ae&&ae.isContentEditable));" +
    'if(isTyping)return;var k=e.key;' +
    "if(k==='ArrowUp'){if(move('up'))e.preventDefault();}" +
    "else if(k==='ArrowDown'){if(move('down'))e.preventDefault();}" +
    "else if(k==='ArrowLeft'){if(move('left'))e.preventDefault();}" +
    "else if(k==='ArrowRight'){if(move('right'))e.preventDefault();}" +
    "else if(k==='Enter'||k===' '){if(activate())e.preventDefault();}" +
    '},true);' +
    // ── the hardened parent channel ──────────────────────────────────────
    "window.addEventListener('message',function(e){try{" +
    // 1. only our embedder, 2. only an allowlisted origin,
    // 3. only our versioned namespace, 4. only a command from the enum.
    'if(e.source!==window.parent)return;' +
    'if(PARENTS.indexOf(e.origin)===-1)return;' +
    'var d=e.data;' +
    "if(!d||typeof d!=='object')return;" +
    'if(d.vosnav!==NS)return;' +
    'var cmd=d.cmd;' +
    "if(typeof cmd!=='string')return;" +
    'if(CMDS.indexOf(cmd)===-1)return;' +
    'var moved=false;' +
    "if(cmd==='arm'){arm();}" +
    "else if(cmd==='disarm'){disarm();}" +
    'else if(armed){moved=run(cmd);}' +
    "try{e.source.postMessage({vosnav:NS,evt:'result',cmd:cmd,moved:!!moved},e.origin);}catch(_){}" +
    '}catch(_){}},false);' +
    // ── announce readiness to each allowlisted parent origin ─────────────
    'function announce(){for(var i=0;i<PARENTS.length;i++){' +
    "try{window.parent.postMessage({vosnav:NS,evt:'ready'},PARENTS[i]);}catch(_){}}}" +
    "if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',announce);}else{announce();}" +
    'setTimeout(announce,400);' +
    "}catch(err){try{console.warn('eduCmsSpatialNav init failed',err);}catch(e){}}" +
    '})();</script>'
  );
}
