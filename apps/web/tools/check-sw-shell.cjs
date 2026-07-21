#!/usr/bin/env node
/*
 * sw-player invariants gate (bundle-split step 1, 2026-07-20).
 *
 * Why a plain-node gate and not a jest spec: apps/web has NO unit-test
 * runner — `sw-cache-version-sort.test.ts` sat under src/app/player/
 * __tests__/ for months and was never executed by any script or workflow
 * (root `test` = `turbo run test`, web has no `test` script). That is the
 * W0-05 false-green class. This gate vm-loads the real SW source, runs the
 * pure helpers, and asserts the structural invariants — wired into the
 * deploy-reliability web-build job next to check-bundle-budget.cjs, so it
 * actually runs on every push. The dead test's BUG #5 assertions are
 * migrated here (the .test.ts file is deleted).
 *
 * Run: node apps/web/tools/check-sw-shell.cjs   (exit 1 on violation)
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SW_PATH = path.join(__dirname, '..', 'public', 'sw-player.js');

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`ok: ${name}`);
  } else {
    failures += 1;
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// ── Load the SW in a minimal sandbox (only load-time globals needed) ──
const src = fs.readFileSync(SW_PATH, 'utf8');
const fakeSelf = { addEventListener: () => {}, location: { origin: 'https://player.example' } };
fakeSelf.self = fakeSelf;
const sandbox = { self: fakeSelf, console, URL, Map, Set };
vm.createContext(sandbox);
try {
  vm.runInContext(src, sandbox, { filename: 'sw-player.js' });
} catch (e) {
  console.error(`FATAL: sw-player.js failed to evaluate: ${e.message}`);
  process.exit(1); // a crashed gate is never a pass
}
const hooks = fakeSelf.__swTestHooks || {};
check('SW exposes __swTestHooks', !!hooks.cacheVersionNum && !!hooks.newestCacheName && !!hooks.extractShellUrls);

// ── BUG #5 regression (migrated from the dead sw-cache-version-sort.test.ts) ──
if (hooks.cacheVersionNum && hooks.newestCacheName) {
  const { cacheVersionNum, newestCacheName } = hooks;
  check('cacheVersionNum parses -vN', cacheVersionNum('edu-player-emergency-v9') === 9 &&
    cacheVersionNum('edu-player-emergency-v10') === 10 && cacheVersionNum('edu-player-playlist-v100') === 100);
  check('cacheVersionNum → -1 without suffix', cacheVersionNum('edu-player-emergency-nope') === -1 &&
    cacheVersionNum('') === -1 && cacheVersionNum(undefined) === -1);
  const pair = ['edu-player-emergency-v9', 'edu-player-emergency-v10'];
  check('newestCacheName picks v10 over v9 (numeric, not lexical)',
    newestCacheName(pair) === 'edu-player-emergency-v10' &&
    newestCacheName([...pair].reverse()) === 'edu-player-emergency-v10');
  check('lexical sort would have been wrong for that input',
    [...pair].sort()[pair.length - 1] === 'edu-player-emergency-v9');
  check('newestCacheName across v2…v100',
    newestCacheName(['v2', 'v9', 'v10', 'v11', 'v100', 'v99'].map((v) => `edu-player-playlist-${v}`)) ===
      'edu-player-playlist-v100');
  check('newestCacheName single + empty', newestCacheName(['edu-player-meta-v9']) === 'edu-player-meta-v9' &&
    newestCacheName([]) === null);
}

// ── Shell URL extraction (pure parser the precache relies on) ──
if (hooks.extractShellUrls) {
  const x = hooks.extractShellUrls;
  const plain = x('<script src="/_next/static/chunks/0y~8kp_2v_pm7.js" defer></script>' +
    '<link rel="stylesheet" href="/_next/static/css/abc123.css">');
  check('extracts js + css from plain HTML', plain.length === 2 &&
    plain.includes('/_next/static/chunks/0y~8kp_2v_pm7.js') && plain.includes('/_next/static/css/abc123.css'));

  const escaped = x('{"scripts":["\\/_next\\/static\\/chunks\\/9xyz.js"]}');
  check('handles JSON-escaped \\/ form (Next flight data)', escaped.length === 1 &&
    escaped[0] === '/_next/static/chunks/9xyz.js');

  const deduped = x('"/_next/static/chunks/a.js" "/_next/static/chunks/a.js"');
  check('dedupes repeated references', deduped.length === 1);

  const filtered = x('"/_next/static/chunks/a.js.map" "/_next/static/media/font.woff2" "/_next/static/chunks/b.txt"');
  check('keeps fonts, drops source maps + non-assets', filtered.length === 1 &&
    filtered[0] === '/_next/static/media/font.woff2');

  check('empty/garbage input → empty list', x('').length === 0 && x(null).length === 0 &&
    x('<html>no chunks here</html>').length === 0);
}

// ── Structural invariants (the tier can't be silently deleted or bypassed) ──
check('SHELL_CACHE is registered in ALL_CACHES',
  /ALL_CACHES\s*=\s*\[[^\]]*SHELL_CACHE[^\]]*\]/.test(src),
  'activate() would garbage-collect the shell as a stale cache');
check('message handler routes PRECACHE_SHELL', /PRECACHE_SHELL'/.test(src) && /precacheAppShell\(/.test(src));
check('fetch handler serves /_next/static/ cache-first',
  /startsWith\('\/_next\/static\/'\)/.test(src) && /shellFetch/.test(src));
check('fetch handler still never touches the API', /includes\('\/api\/v1\/'\)/.test(src));
check('clearCache supports the shell tier', /tier === 'shell'/.test(src));
check('activate copy-forwards the shell on VERSION bump', /edu-player-shell-'/.test(src.replace(/`/g, "'")));
check('media tiers untouched: emergency cache still checked first in fetch',
  src.indexOf('EMERGENCY_CACHE);') !== -1 && src.indexOf('caches.open(EMERGENCY_CACHE)') < src.indexOf('caches.open(PLAYLIST_CACHE)'));
check('step-3 guard comment present (lazy player chunks need manifest-driven prune)',
  /STEP-3 GUARD/.test(src));
check('navigation requests get network-first + cached-document fallback',
  /mode === 'navigate'/.test(src) && /shellNavigate/.test(src),
  'without a cached DOCUMENT, cold-boot-offline dies before any chunk cache matters');
// Field incident 2026-07-21: Android WebView shows its dead native error page
// for ANY non-2xx top-level document (ERR_HTTP_RESPONSE_CODE_FAILURE) and
// never retries — a kiosk stayed stuck after the network came back. The
// offline fallback MUST be a 200 that self-heals.
{
  const navStart = src.indexOf('async function shellNavigate');
  const navBody = navStart >= 0 ? src.slice(navStart, src.indexOf('async function shellFetch')) : '';
  check('offline navigation fallback is HTTP 200 (Android WebView reds any non-2xx document)',
    navStart >= 0 && /status:\s*200/.test(navBody) && !/status:\s*50[0-9]/.test(navBody));
  check('offline fallback page SELF-HEALS (online listener + interval probe + reload)',
    /addEventListener\("online"/.test(navBody) && /setInterval\(probe/.test(navBody) && /location\.replace/.test(navBody));
}
check('precacheAppShell pins the document alongside its chunks',
  /wanted\.add\(route\)/.test(src));

if (failures > 0) {
  console.error(`\nsw-shell gate: ${failures} violation(s).`);
  process.exit(1);
}
console.log('sw-shell gate: all invariants hold.');
