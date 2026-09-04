/**
 * Settings Command Center — Workspace group live shots (Overview /
 * Organization / Locations), chromium + webkit, 1440 and 390.
 *
 * Verification harness, not a CI gate: it logs into a running dev server
 * with a REAL account against the REAL API and captures what the operator
 * would see, plus any React-reconciler crash signature. Read-only — it never
 * submits a form, because the seed account points at a real tenant.
 *
 * Run:
 *   BASE=http://localhost:3103 node tests/cross-browser/settings-cc-workspace-shot.cjs
 */
const { chromium, webkit } = require('@playwright/test');
const path = require('path');

const BASE = process.env.BASE || 'http://localhost:3103';
// SEC-004 (2026-09-04): NO LITERAL CREDENTIAL FALLBACK. This file lives in a
// public repository; the previous `|| 'admin123'` default was a live production
// password anyone could read and use. Credentials now come from the environment
// (repo secrets in CI) and the harness exits rather than guessing.
const EMAIL = process.env.CC_EMAIL;
const PASSWORD = process.env.CC_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error(
    'settings-cc-workspace-shot: set the email env var / the password env var (repo secrets in CI). Refusing to run with a built-in credential.',
  );
  process.exit(1);
}

const TENANT = process.env.CC_TENANT || 'springfield-elementary';
const OUT = process.env.CC_OUT || '/tmp/settings-cc-shots';
const CRASH_RE = /removeChild|parentNode|stateNode|Minified React|Maximum update depth/i;

async function login(page) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      // WebKit: a fill that lands before hydration is wiped by React's first
      // controlled render — the field looks typed, submits empty, 401s. Fill,
      // then VERIFY, then re-fill.
      await page.waitForLoadState('load').catch(() => {});
      await page.waitForTimeout(1500);
      for (let i = 0; i < 3; i++) {
        await page.fill('input[type="email"]', EMAIL);
        await page.fill('input[type="password"]', PASSWORD);
        await page.waitForTimeout(400);
        if ((await page.inputValue('input[type="email"]')) === EMAIL) break;
      }
      await page.locator('input[type="checkbox"][aria-describedby="eula-text"]').check().catch(async () => {
        for (const c of await page.$$('input[type="checkbox"]')) { await c.check().catch(() => {}); }
      });
      await page.locator('button[type="submit"]:has-text("Sign in")').click();
      await page.waitForURL(/\/(dashboard|super)\b/, { timeout: 60_000 });
      return;
    } catch (e) {
      lastErr = e;
      console.log(`  login attempt ${attempt} failed: ${String(e.message).slice(0, 90)}`);
      await page.waitForTimeout(2000 * attempt);
    }
  }
  throw new Error(`login failed: ${lastErr && lastErr.message}`);
}

async function run(engine, name) {
  const browser = await engine.launch({ headless: true });
  for (const [label, viewport] of [['1440', { width: 1440, height: 1000 }], ['390', { width: 390, height: 844 }]]) {
    const page = await (await browser.newContext({ viewport })).newPage();
    const crashes = [];
    page.on('pageerror', (e) => { if (CRASH_RE.test(String(e.message || e))) crashes.push(String(e.message).slice(0, 160)); });
    await login(page);
    for (const route of ['overview', 'organization', 'locations']) {
      await page.goto(`${BASE}/${TENANT}/settings/${route}`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
        .catch(() => {});
      await page.waitForTimeout(2500);
      const file = path.join(OUT, `${name}-${label}-${route}.png`);
      await page.screenshot({ path: file, fullPage: true });
      const heading = await page.locator('h1').first().textContent().catch(() => null);
      console.log(`  ${name} ${label} /${route} → h1="${(heading || '').trim()}" ${file}`);
    }
    if (crashes.length) console.log(`  !! ${name} ${label} React crash signatures: ${crashes.join(' | ')}`);
    await page.close();
  }
  await browser.close();
}

(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  await run(chromium, 'chromium');
  await run(webkit, 'webkit');
  console.log('done');
})();
