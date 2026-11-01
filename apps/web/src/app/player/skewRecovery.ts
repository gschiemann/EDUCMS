/**
 * Deploy-skew recovery — the PRE-BOOT half (2026-10-27 field incident).
 *
 * ============================================================
 * THE FAILURE THIS CLOSES
 * ============================================================
 *
 * After several website deploys and a rollback, Android player screens
 * loaded the player DOCUMENT but its client JS never ran: the native boot
 * card read "client JS never started — registration never attempted". Some
 * went black and ignored the remote (quiet boot keeps the root invisible
 * until React mounts — and React never mounted), some flashed white then
 * black. The card's Retry did nothing. Relaunching the app fixed them.
 *
 * The mechanism (verified against production on 2026-10-31):
 *   - Skew Protection is OFF: the /player HTML carries no `?dpl=` on its
 *     chunk URLs, so the production domain serves ONLY the current
 *     deployment's `/_next/static` files. A chunk named by any other
 *     deployment's document is a 404.
 *   - That 404 is served with `cache-control: public,max-age=31536000,
 *     immutable` (the platform's /_next/static rule applies to misses too).
 *     A chunk that 404s ONCE during a promotion/rollback flip can therefore
 *     be pinned as a 404 by the WebView's HTTP cache, so the same document
 *     keeps failing on every reload in that process.
 *   - The service worker served its saved player document on any network
 *     failure without checking that the chunks it names were saved too.
 *
 * Every such state has the same signature at the glass: a `/_next/static`
 * script fails, or the document finished loading and the app never stamped
 * `data-edu-booted`. Nothing inside the bundle can react — the bundle is
 * what failed — so this runs inline in the player layout, before any chunk.
 *
 * ============================================================
 * WHAT IT DOES
 * ============================================================
 *
 * ONE clean reload: the failed build files are first re-fetched with
 * `cache: 'reload'` (bounded, 5 s) so a cached 404 cannot be reused, then
 * `location.replace` to the same URL with a fresh `_v` cache-buster (every
 * APK parameter preserved). The service worker serves
 * navigations network-first and — since this wave — never falls back to a
 * saved document whose chunks are not all on disk, and it re-fetches a
 * failed chunk past the HTTP cache once (`sw-player.js`). Then it BACKS OFF:
 * 2 min, 10 min, then every 30 min, persisted in localStorage so a reload
 * cannot reset the ladder. Never a loop:
 *   - storage unwritable  → no automatic reload at all (fail safe);
 *   - booted              → the ladder is cleared, nothing else happens;
 *   - a chunk failing AFTER boot (a lazy import) is not this module's case
 *     and is ignored (the running player owns that).
 *
 * The emergency path is untouched: nothing here reads or clears a cache.
 * A screen whose JS never started cannot show an alert at all, so the
 * reload is the only route by which a live alert can reach that glass.
 *
 * ES5 on purpose (Chromium 83 WebViews, CLAUDE.md #10). The decision
 * function is a STRING so the Jest suite evaluates the exact bytes shipped.
 */

export const SKEW_RECOVERY_KEY = 'edu_skew_recover';

/** Backoff after the first clean reload, by attempts already made (1, 2, 3+). */
export const SKEW_BACKOFF_MS = [2 * 60_000, 10 * 60_000, 30 * 60_000] as const;
/** A ladder older than this is history, not a loop: start again at one reload. */
export const SKEW_LADDER_RESET_MS = 6 * 60 * 60_000;
/** No-error backstop: document loaded at least this long ago, still not booted. */
export const SKEW_AFTER_LOAD_MS = 8_000;
/** …and at least this long since the document started (below the APK's 30 s card). */
export const SKEW_MIN_SINCE_START_MS = 20_000;
/** Longest wait for the cache-bypassing re-fetch of failed build files before reloading anyway. */
export const SKEW_REFETCH_BUDGET_MS = 5_000;
/** Grace after a chunk error so several failures coalesce into one decision. */
export const SKEW_ERROR_GRACE_MS = 1_500;

export type SkewState = { n: number; last: number } | null;
export type SkewDecision =
  | { action: 'reload'; next: { n: number; last: number } }
  | { action: 'wait'; waitMs: number };

/**
 * decide(state, nowMs) — pure. `state.n` = clean reloads already made in this
 * ladder, `state.last` = when the latest was made.
 */
export const SKEW_DECIDE_JS =
  'function(s,now){' +
  'var B=[' + SKEW_BACKOFF_MS.join(',') + '],R=' + SKEW_LADDER_RESET_MS + ';' +
  "var n=s&&typeof s.n==='number'&&isFinite(s.n)&&s.n>0?Math.floor(s.n):0;" +
  "var last=s&&typeof s.last==='number'&&isFinite(s.last)?s.last:0;" +
  // A stamp in the future (clock stepped back) or long ago starts a fresh ladder.
  'if(n>0&&(last>now||now-last>R))n=0;' +
  "if(n===0)return{action:'reload',next:{n:1,last:now}};" +
  'var gap=B[Math.min(n,B.length)-1];' +
  "if(now-last>=gap)return{action:'reload',next:{n:n+1,last:now}};" +
  "return{action:'wait',waitMs:gap-(now-last)};" +
  '}';

/** Typed handle on the shipped decision (tests + any TS caller). */
export function decideSkewRecovery(state: SkewState, nowMs: number): SkewDecision {
  return (new Function('return ' + SKEW_DECIDE_JS)() as (s: SkewState, n: number) => SkewDecision)(state, nowMs);
}

export const SKEW_RECOVERY_INLINE_JS =
  '(function(){try{' +
  // Dashboard preview tiles are not screens; never reload them.
  "if(/[?&]preview=1(&|$)/.test(location.search))return;" +
  'var D=document.documentElement,K=' + JSON.stringify(SKEW_RECOVERY_KEY) + ';' +
  'var decide=' + SKEW_DECIDE_JS + ';' +
  'var ls=null;try{ls=window.localStorage;}catch(e){}' +
  'if(!ls)return;' +
  // Prove storage persists BEFORE ever reloading: without it a backoff cannot
  // survive the reload and this would become exactly the loop it forbids.
  "try{ls.setItem(K+':probe','1');if(ls.getItem(K+':probe')!=='1')return;ls.removeItem(K+':probe');}catch(e){return;}" +
  "function booted(){return D.getAttribute('data-edu-booted')==='1';}" +
  'function read(){try{var v=JSON.parse(ls.getItem(K)||"null");return v&&typeof v==="object"?v:null;}catch(e){return null;}}' +
  'var start=Date.now(),loadAt=0,busy=false,done=false,timer=null,failed=[];' +
  "if(document.readyState==='complete')loadAt=start;" +
  "window.addEventListener('load',function(){loadAt=Date.now();});" +
  'function finish(){done=true;if(timer){clearInterval(timer);timer=null;}}' +
  'function trigger(why){' +
  'if(done||busy)return;' +
  'if(booted()){try{ls.removeItem(K);}catch(e){}finish();return;}' +
  'busy=true;' +
  'var d=decide(read(),Date.now());' +
  "if(d.action==='wait'){setTimeout(function(){busy=false;trigger(why);},d.waitMs);return;}" +
  'try{ls.setItem(K,JSON.stringify(d.next));var back=read();if(!back||back.n!==d.next.n){busy=false;finish();return;}}catch(e){busy=false;finish();return;}' +
  'finish();' +
  "try{window.__eduSkewRecovery={why:why,attempt:d.next.n,at:d.next.last};}catch(e){}" +
  'var u;try{u=new URL(location.href);u.searchParams.set("_v",String(Date.now()));u=u.toString();}catch(e){u=null;}' +
  'var gone=false;function go(){if(gone)return;gone=true;try{if(u)location.replace(u);else location.reload();}catch(e){}}' +
  // Re-ask the failed build files past every cache first (bounded): a 404
  // served `immutable` is otherwise reused by the engine's own cache for the
  // reloaded document (measured in WebKit) and the reload changes nothing.
  // With no known failure (the backstop), re-ask every build script this
  // document names; it only ever runs on a document that is already dead.
  'var list=failed.slice(0);' +
  "if(!list.length){try{var ss=document.getElementsByTagName('script');for(var i=0;i<ss.length;i++){var sv=ss[i].src||'';if(sv.indexOf('/_next/static/')!==-1)list.push(sv);}}catch(e){}}" +
  "if(typeof fetch!=='function'||!list.length){go();return;}" +
  'setTimeout(go,' + SKEW_REFETCH_BUDGET_MS + ');' +
  "try{var ps=[];for(var j=0;j<list.length&&j<64;j++){ps.push(fetch(list[j],{cache:'reload',credentials:'same-origin'}).then(function(){},function(){}));}Promise.all(ps).then(go,go);}catch(e){go();}" +
  '}' +
  // Fast path: a build asset of THIS document failed before the app booted.
  "window.addEventListener('error',function(ev){try{" +
  'if(booted())return;' +
  'var t=ev&&ev.target;var src=t&&(t.src||"");' +
  "var chunk=t&&t.tagName==='SCRIPT'&&src.indexOf('/_next/static/')!==-1;" +
  "var msg=!chunk&&ev&&ev.message&&/ChunkLoadError|Loading chunk|Failed to load chunk|Failed to fetch dynamically imported module|Importing a module script failed/i.test(String(ev.message));" +
  "if(chunk&&failed.indexOf(src)===-1)failed.push(src);" +
  "if(chunk||msg)setTimeout(function(){trigger(chunk?'chunk-error':'chunk-message');}," + SKEW_ERROR_GRACE_MS + ');' +
  '}catch(e){}},true);' +
  "window.addEventListener('unhandledrejection',function(ev){try{if(booted())return;var r=ev&&ev.reason;var m=String(r&&(r.message||r.name)||r||'');" +
  "if(/ChunkLoadError|Loading chunk|Failed to load chunk|Failed to fetch dynamically imported module/i.test(m))setTimeout(function(){trigger('chunk-rejection');}," + SKEW_ERROR_GRACE_MS + ');}catch(e){}});' +
  // Backstop: every script finished (load fired) and the app still never
  // booted. Also the place a successful boot clears the ladder.
  'timer=setInterval(function(){try{' +
  'if(done)return;' +
  'if(booted()){try{ls.removeItem(K);}catch(e){}finish();return;}' +
  'var now=Date.now();' +
  'if(loadAt&&now-loadAt>=' + SKEW_AFTER_LOAD_MS + '&&now-start>=' + SKEW_MIN_SINCE_START_MS + ")trigger('never-booted');" +
  '}catch(e){}},2000);' +
  '}catch(e){}})();';
