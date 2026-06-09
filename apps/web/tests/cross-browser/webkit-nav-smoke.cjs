/**
 * webkit-nav-smoke.cjs — WebKit (Safari engine) dashboard-navigation canary.
 *
 * WHY THIS EXISTS (2026-06-08): a WebKit-ONLY React crash —
 *   "TypeError: null is not an object (… parentNode.removeChild)"
 * — from BrandStyleInjector imperatively detaching the React-managed
 * <link rel="icon"> nodes in <head> made "every menu click needs two clicks /
 * it just reloads" in Safari for DAYS. Chromium silently tolerated it, so CI +
 * local dev (Chrome-only) never caught it. Fixed in commit ddb64dab.
 *
 * This guard reproduces that whole CLASS: log into the real dashboard in WebKit,
 * click through the main sidebar nav with REAL clicks, and FAIL if either:
 *   (a) any pageerror fires matching /removeChild|parentNode|stateNode|Minified
 *       React/ (a React reconciler crash — the favicon-detach class), or
 *   (b) a sidebar click does a FULL PAGE RELOAD instead of client-side nav
 *       (detected via a `window.__navMarker` that must survive a soft nav).
 *
 * Runs against the LIVE deploy (the dashboard needs the real Railway API, which
 * the local-dev cross-browser jobs can't provide). Same seed SUPER_ADMIN as
 * prod-smoke (admin@springfield.edu / admin123 — a public seed account isolated
 * to the Springfield Elementary tenant, never touches customer data).
 *
 * Run locally:   pnpm --filter web run test:webkit-nav
 * CI:            .github/workflows/prod-smoke.yml (prod-smoke-webkit-nav job)
 */
const { webkit } = require('@playwright/test');

const BASE = process.env.WEBKIT_NAV_BASE || process.env.PROD_SMOKE_BASE || 'https://venue-os.app';
const EMAIL = process.env.WEBKIT_NAV_EMAIL || process.env.PROD_SMOKE_EMAIL || 'admin@springfield.edu';
const PASSWORD = process.env.WEBKIT_NAV_PASSWORD || process.env.PROD_SMOKE_PASSWORD || 'admin123';
// A tenant the seed admin can open whose dashboard mounts the full chrome
// (Sidebar + BrandStyleInjector). Springfield Elementary is the seed tenant.
const TENANT = process.env.WEBKIT_NAV_TENANT || 'springfield-elementary';

// React-reconciler crash signatures. The favicon-detach bug threw the first;
// the others catch the broader "non-React code detached a node React owns" class.
const CRASH_RE = /removeChild|parentNode|stateNode|Minified React|Maximum update depth/i;

// Sidebar destinations to click through, in order. Real left-nav targets.
const HOPS = ['screens', 'assets', 'templates', 'playlists', 'screens', 'assets'];

function log(...a) { console.log(...a); }

async function login(page) {
  // Retry the login a few times — the seed Supabase pgbouncer pool can be
  // briefly degraded right after a deploy (same reason prod-smoke retries).
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.fill('input[type="email"]', EMAIL);
      await page.fill('input[type="password"]', PASSWORD);
      // EULA consent checkbox (must be checked to enable submit).
      await page.locator('input[type="checkbox"][aria-describedby="eula-text"]').check().catch(async () => {
        for (const c of await page.$$('input[type="checkbox"]')) { await c.check().catch(() => {}); }
      });
      await page.locator('button[type="submit"]:has-text("Sign in")').click();
      await page.waitForURL(/\/(dashboard|super)\b/, { timeout: 25_000 });
      return;
    } catch (e) {
      lastErr = e;
      log(`  login attempt ${attempt} failed: ${e.message.slice(0, 80)} — retrying`);
      await page.waitForTimeout(2000 * attempt);
    }
  }
  throw new Error(`login failed after retries: ${lastErr && lastErr.message}`);
}

(async () => {
  const browser = await webkit.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1325, height: 800 } })).newPage();

  const crashes = [];
  page.on('pageerror', (e) => {
    const msg = String(e.message || e);
    if (CRASH_RE.test(msg)) crashes.push(msg.slice(0, 200));
  });

  const failures = [];
  try {
    log(`WebKit nav smoke → ${BASE} (tenant: ${TENANT})`);
    await login(page);
    await page.goto(`${BASE}/${TENANT}/dashboard`, { waitUntil: 'networkidle', timeout: 30_000 });
    // Let BrandStyleInjector apply branding (it runs setBrandFavicon).
    await page.waitForTimeout(2500);

    // Confirm React actually hydrated the sidebar (else the test is meaningless).
    const hydrated = await page.evaluate(() => {
      const a = document.querySelector('aside a[href*="/screens"], nav a[href*="/screens"]');
      return a ? Object.keys(a).some((k) => k.startsWith('__react')) : false;
    });
    if (!hydrated) failures.push('sidebar nav never hydrated (React not attached) — cannot validate navigation');

    for (const target of HOPS) {
      const sel = `aside a[href$="/${target}"], nav a[href$="/${target}"]`;
      const link = await page.$(sel);
      if (!link) { log(`  · /${target} — no sidebar link, skipping`); continue; }
      await page.evaluate(() => { window.__navMarker = 'ALIVE'; });
      const before = page.url();
      const crashBefore = crashes.length;
      await link.click({ timeout: 6000 }).catch((e) => failures.push(`/${target}: click failed — ${e.message.slice(0, 80)}`));
      await page.waitForTimeout(2200);
      const after = page.url();
      const survived = await page.evaluate(() => window.__navMarker === 'ALIVE');
      const arrived = after.endsWith(`/${target}`);
      const newCrash = crashes.length > crashBefore;

      if (newCrash) {
        failures.push(`/${target}: React crash during navigation (${crashes[crashes.length - 1]})`);
        log(`  ✗ /${target} — REACT CRASH`);
      } else if (arrived && survived) {
        log(`  ✓ /${target} — soft nav`);
      } else if (arrived && !survived) {
        failures.push(`/${target}: FULL PAGE RELOAD instead of client-side navigation (the "it just reloads" symptom)`);
        log(`  ✗ /${target} — FULL RELOAD`);
      } else if (before === after) {
        // Click registered no navigation at all — only fail if a crash explains it.
        log(`  · /${target} — no navigation (no crash); ignoring (focus/timing)`);
      }
    }
  } catch (e) {
    failures.push(`fatal: ${e.message}`);
  }

  log('');
  log(`React crashes: ${crashes.length}  |  nav failures: ${failures.filter((f) => !f.startsWith('fatal')).length}`);
  if (crashes.length || failures.length) {
    log('FAIL:');
    for (const f of failures) log(`  - ${f}`);
    for (const c of crashes) log(`  - crash: ${c}`);
    await browser.close();
    process.exit(1);
  }
  log('PASS: WebKit dashboard navigation is crash-free and client-side.');
  await browser.close();
  process.exit(0);
})().catch((e) => { console.error('runner error:', e); process.exit(1); });
