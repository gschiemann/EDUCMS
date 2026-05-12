/**
 * prod-smoke.cjs — full UX smoke test, runs against the PRODUCTION
 * Vercel deployment. Wired to CI so a regression on master never
 * reaches a customer without the build going red.
 *
 * What it covers (one Playwright run, all in parallel):
 *   1. Login flow against the real Railway API
 *   2. Tenant navigation — every tenant the SUPER_ADMIN can see, hit
 *      /<slug>/templates, count tiles, capture page errors
 *   3. Template-builder smoke — open the first 12 templates from the
 *      API list, verify the canvas mounts at least one zone
 *
 * Test account: admin@springfield.edu / admin123 — the seed SUPER_ADMIN
 * on Springfield Elementary (the seed test tenant). READ-ONLY against
 * customer tenants (Chardon HS, AGC, Gym Demo, etc.) — never clicks
 * Customize / Save / Delete to keep prod data clean.
 *
 * Run locally:
 *   pnpm --filter web run test:prod-smoke
 *
 * CI: .github/workflows/prod-smoke.yml — runs on push to master + nightly
 * cron at 06:00 UTC (catches drift between deploys).
 *
 * Why prod and not localhost: a Tailwind v4 + Turbopack dev-mode quirk
 * affected the builder's size-gate (lg:hidden not emitted) only in dev,
 * so localhost testing was a worse signal than testing the real artifact
 * customers actually hit. Production is publicly accessible (verified
 * 200 on /login curl) so this test needs no SSO bypass.
 */
const { chromium, request } = require('@playwright/test');
const { setTimeout: delay } = require('node:timers/promises');
const { mkdirSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');

const BASE = process.env.PROD_SMOKE_BASE || 'https://educms-five.vercel.app';
const API = process.env.PROD_SMOKE_API || 'https://api-production-39a1.up.railway.app/api/v1';
const EMAIL = process.env.PROD_SMOKE_EMAIL || 'admin@springfield.edu';
const PASSWORD = process.env.PROD_SMOKE_PASSWORD || 'admin123';
const SHOTS = resolve(__dirname, 'prod-smoke-shots');
mkdirSync(SHOTS, { recursive: true });

const TENANTS = [
  { slug: 'springfield-district',   name: 'Springfield School District' },
  { slug: 'springfield-elementary', name: 'Springfield Elementary' },
  { slug: 'chardon-high-school',    name: 'Chardon High School' },
  { slug: 'cms',                    name: 'Chardon Middle School' },
  { slug: 'gym-demo',               name: 'Gym Demo' },
  { slug: 'agc-education',          name: 'AGC Education' },
  { slug: 'greg-s-fitness',         name: "Greg's Fitness" },
];
// 2026-05-11 — dropped from 6 → 3 after Supabase pgbouncer degraded
// during a fleet-grade Phase B run. 6 parallel browser contexts × 1
// templates fetch each = 6 simultaneous /templates queries pounding
// the pool. Half failed with "0 h3 after 30s" because the API never
// responded fast enough. 3 keeps the test honest (still catches real
// regressions) without piling on a struggling pool.
const CONCURRENCY = 3;
const TEMPLATES_TO_OPEN = 12;

const results = [];
function ok(scenario, step, detail = '') { results.push({ scenario, step, ok: true, detail }); }
function bad(scenario, step, detail = '') { results.push({ scenario, step, ok: false, detail }); }
async function shot(page, name) {
  try { await page.screenshot({ path: resolve(SHOTS, `${name}.png`), fullPage: false }); } catch {}
}

async function loginAndCapture(browser) {
  // Retry-with-backoff + token-capture-first. The /auth/login endpoint
  // has a 10/min per-IP throttle (added 2026-05-08); when multiple CI
  // runs land in quick succession all sharing GitHub Actions' shared
  // runner pool, the window can be saturated → 429. The Supabase
  // pgbouncer pooler also occasionally hiccups during argon2 verify,
  // pushing /auth/login response time above 15s.
  //
  // Previous strategy waited for URL navigation (Vercel-rendered
  // dashboard load) to complete — that compounds with both the login
  // throttle AND any post-login Vercel render slowness. New strategy:
  //   1. Listen for the /auth/login response BEFORE submitting.
  //   2. Submit, then await the response listener's promise (up to 45s).
  //   3. As soon as we have the token, we're done — never wait for
  //      the Vercel dashboard render. authedContext() will short-
  //      circuit straight to /<slug>/templates with the JWT in
  //      localStorage anyway.
  //
  // 5 attempts × 30/45/60/90 s backoffs gives the pool time to recover
  // and the per-IP throttle time to roll over. Total ceiling ~4 min.
  let lastErr;
  const backoffs = [30_000, 45_000, 60_000, 90_000];
  for (let attempt = 1; attempt <= 5; attempt++) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    let resolveToken, rejectToken;
    const tokenPromise = new Promise((res, rej) => { resolveToken = res; rejectToken = rej; });
    let token = null, user = null;
    page.on('response', async (r) => {
      if (/\/auth\/login$/.test(r.url())) {
        const status = r.status();
        if (status === 200) {
          try {
            const b = await r.json();
            token = b.access_token;
            user = b.user;
            if (token) resolveToken({ token, user });
          } catch (e) {
            rejectToken(new Error(`failed to parse /auth/login JSON: ${e.message}`));
          }
        } else {
          rejectToken(new Error(`/auth/login returned HTTP ${status}`));
        }
      }
    });
    try {
      await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
      await page.locator('#login-email').fill(EMAIL);
      await page.locator('#login-password').fill(PASSWORD);
      await page.locator('input[type="checkbox"][aria-describedby="eula-text"]').check();
      await delay(300);
      const submit = page.locator('button[type="submit"]:has-text("Sign in")');
      for (let i = 0; i < 30; i++) { if (await submit.isEnabled()) break; await delay(100); }
      await submit.click();
      // Wait for the API response, NOT the URL navigation. 45 s is
      // generous — covers the slowest observed Supabase auth verify
      // (pgbouncer cold-start + argon2). The page can still be on
      // /login when we resolve; authedContext() doesn't care.
      const timeoutP = new Promise((_r, rej) =>
        setTimeout(() => rej(new Error('login response timeout (45s)')), 45_000),
      );
      await Promise.race([tokenPromise, timeoutP]);
      // Give cookies / storageState a beat to settle.
      await delay(500);
      if (!token) throw new Error('login response missing access_token');
      return { token, user, state: await ctx.storageState() };
    } catch (e) {
      lastErr = e;
      console.log(`Login attempt ${attempt}/5 failed: ${e.message}`);
      await ctx.close();
      if (attempt < 5) {
        const backoffMs = backoffs[attempt - 1] ?? 60_000;
        console.log(`  backing off ${backoffMs / 1000}s before retry…`);
        await delay(backoffMs);
      }
    }
  }
  throw lastErr;
}

async function authedContext(browser, auth) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: auth.state,
  });
  // Auth store reads sessionStorage first then falls back to localStorage.
  // Seed both so the bootstrap finds the JWT regardless of code path.
  await ctx.addInitScript(({ token, user }) => {
    try {
      window.localStorage.setItem('edu_cms_token', token);
      window.localStorage.setItem('edu_cms_user', JSON.stringify(user));
      window.sessionStorage.setItem('edu_cms_token', token);
      window.sessionStorage.setItem('edu_cms_user', JSON.stringify(user));
    } catch {}
  }, { token: auth.token, user: auth.user });
  return ctx;
}

// -- Tenant smoke ---------------------------------------------------
async function tenantSmoke(browser, tenant, auth) {
  const ctx = await authedContext(browser, auth);
  const page = await ctx.newPage();
  const errs = [];
  // We only want the FIRST page error (hydration warnings cascade and
  // pollute the report). Ignore React hydration warnings — they're a
  // separate finding tracked in the audit.
  page.on('pageerror', (e) => {
    if (errs.length < 2 && !/Hydration failed/i.test(e.message)) errs.push(e.message);
  });
  try {
    const start = Date.now();
    await page.goto(`${BASE}/${tenant.slug}/templates`, {
      waitUntil: 'domcontentloaded',
      timeout: 25_000,
    }).catch((e) => errs.push(`goto: ${e.message}`));
    const navMs = Date.now() - start;
    const finalPath = new URL(page.url()).pathname;
    const stayedOnSlug = finalPath.startsWith(`/${tenant.slug}/`);
    if (!stayedOnSlug) {
      bad(tenant.slug, 'navigate', `redirected to ${finalPath}`);
      await shot(page, `t-${tenant.slug}-redirect`);
      return;
    }
    ok(tenant.slug, 'navigate', `${navMs}ms initial`);

    // Smart wait: poll for tile content. The templates page shows a
    // spinner while the API call is in flight; tiles are h3 elements
    // inside the templates section.
    //
    // Bumped to 25 s (was 12 s) because Supabase pgbouncer can hiccup
    // on the /templates query and we don't want a routine pool blip
    // to fail the whole smoke. The fleet's primary template fetch
    // hits the same pool — if it's healthy, h3 elements appear in
    // ~2 s; if it's degraded, 10-20 s; if it's broken, no amount of
    // waiting helps and the test correctly fails.
    const tileStart = Date.now();
    let tileCount = 0;
    try {
      await page.waitForFunction(() => {
        return document.querySelectorAll('h3').length > 5;
      }, { timeout: 25_000 });
      tileCount = await page.locator('h3').count();
    } catch {
      tileCount = await page.locator('h3').count();
    }
    const tileMs = Date.now() - tileStart;

    if (tileCount < 3) {
      bad(tenant.slug, 'tiles', `only ${tileCount} h3 after ${tileMs}ms wait — likely API failed`);
    } else if (tileMs > 8000) {
      // Tiles loaded eventually but slow — flag as perf concern not failure
      ok(tenant.slug, 'tiles', `${tileCount} tiles, SLOW (${tileMs}ms)`);
    } else {
      ok(tenant.slug, 'tiles', `${tileCount} tiles in ${tileMs}ms`);
    }
    await shot(page, `t-${tenant.slug}-templates`);

    if (errs.length) {
      bad(tenant.slug, 'page-errors', errs.slice(0, 2).map((e) => e.slice(0, 120)).join(' | '));
    }
  } finally {
    await ctx.close();
  }
}

// -- Template list via API + open in builder ------------------------
async function listTemplatesViaApi(token) {
  const ctx = await request.newContext({
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  });
  try {
    const resp = await ctx.get(`${API}/templates`);
    if (!resp.ok()) return null;
    return await resp.json();
  } finally {
    await ctx.dispose();
  }
}

async function openTemplateInBuilder(browser, tpl, auth) {
  const ctx = await authedContext(browser, auth);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => {
    if (errs.length < 2 && !/Hydration failed/i.test(e.message)) errs.push(e.message);
  });
  const label = `tpl:${(tpl.name || tpl.id || '?').slice(0, 60)}`;
  try {
    const url = `${BASE}/springfield-elementary/templates/builder/${tpl.id}`;
    const start = Date.now();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      .catch((e) => errs.push(`goto: ${e.message}`));
    // Smart wait: builder canvas mounts zones after the template fetch
    // resolves. Poll for [data-zone-id] up to 15s.
    let zones = 0;
    try {
      await page.waitForFunction(() => document.querySelectorAll('[data-zone-id]').length > 0, { timeout: 15_000 });
      zones = await page.locator('[data-zone-id]').count();
    } catch {
      zones = await page.locator('[data-zone-id]').count();
    }
    const ms = Date.now() - start;
    if (zones === 0) {
      bad(label, 'canvas', `0 zones after ${ms}ms`);
    } else if (ms > 8000) {
      ok(label, 'canvas', `${zones} zones, SLOW (${ms}ms)`);
    } else {
      ok(label, 'canvas', `${zones} zones in ${ms}ms`);
    }
    const safe = (tpl.name || tpl.id || 'unknown').replace(/[^a-z0-9]+/gi, '-').slice(0, 50).toLowerCase();
    await shot(page, `tpl-${safe}`);
    if (errs.length) bad(label, 'errors', errs.slice(0, 1)[0].slice(0, 120));
  } finally {
    await ctx.close();
  }
}

async function pool(items, fn, n) {
  const q = items.slice();
  await Promise.all(Array.from({ length: n }, async () => {
    while (q.length) {
      const it = q.shift();
      await fn(it).catch((e) => results.push({ scenario: 'pool', step: 'fatal', ok: false, detail: e.message }));
    }
  }));
}

(async () => {
  console.log('Step 1: login');
  const browser = await chromium.launch({ headless: true });
  let auth;
  try {
    auth = await loginAndCapture(browser);
    console.log(`  token captured (${auth.token.length} chars), role=${auth.user?.role}`);

    console.log(`Step 2: tenant smoke (${TENANTS.length} tenants × ${CONCURRENCY}-way)`);
    await pool(TENANTS, (t) => tenantSmoke(browser, t, auth), CONCURRENCY);

    console.log('Step 3: list templates via API');
    const tpls = await listTemplatesViaApi(auth.token);
    if (!Array.isArray(tpls)) {
      console.log('  ✗ /templates API did not return an array');
    } else {
      const slice = tpls.slice(0, TEMPLATES_TO_OPEN);
      console.log(`  → ${tpls.length} templates total, opening first ${slice.length}`);
      await pool(slice, (t) => openTemplateInBuilder(browser, t, auth), CONCURRENCY);
    }
  } finally {
    await browser.close();
  }

  console.log('\n=== RESULTS ===');
  const passes = results.filter((r) => r.ok).length;
  const fails = results.filter((r) => !r.ok).length;
  console.log(`PASS ${passes}   FAIL ${fails}\n`);

  console.log('--- TENANTS ---');
  for (const t of TENANTS) {
    const rs = results.filter((r) => r.scenario === t.slug);
    const status = rs.length && rs.every((r) => r.ok) ? '✓' : '✗';
    const tile = rs.find((r) => r.step === 'tiles');
    const nav = rs.find((r) => r.step === 'navigate');
    const err = rs.find((r) => r.step === 'page-errors' || r.step === 'navigate' && !r.ok);
    let line = `  ${status} ${t.name}: `;
    if (nav?.ok) line += `${nav.detail}, ${tile?.detail || '?'}`;
    if (err && !err.ok) line += `   [err: ${err.detail.slice(0, 80)}]`;
    console.log(line);
  }

  console.log('\n--- TEMPLATES (first 12) ---');
  const tplLabels = [...new Set(results.filter((r) => r.scenario.startsWith('tpl:')).map((r) => r.scenario))];
  for (const lbl of tplLabels) {
    const rs = results.filter((r) => r.scenario === lbl);
    const status = rs.every((r) => r.ok) ? '✓' : '✗';
    const canvas = rs.find((r) => r.step === 'canvas');
    const err = rs.find((r) => r.step === 'errors');
    let line = `  ${status} ${lbl.replace(/^tpl:/, '')}: ${canvas?.detail || '?'}`;
    if (err) line += `   [err: ${err.detail.slice(0, 80)}]`;
    console.log(line);
  }

  console.log(`\nScreenshots: ${SHOTS}`);
  writeFileSync(resolve(__dirname, 'prod-smoke-report.json'), JSON.stringify(results, null, 2));
  process.exit(fails > 0 ? 1 : 0);
})().catch((e) => { console.error('FATAL:', e); process.exit(1); });
