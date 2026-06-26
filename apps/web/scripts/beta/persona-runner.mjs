/**
 * Beta-tester persona runner — drives the LIVE app in a real browser as a human
 * end user, capturing a screenshot + console errors + failed network calls at
 * every step, and writing a findings report. Self-contained; no app creds (the
 * signup persona self-provisions).
 *
 * Usage: node persona-runner.mjs <persona> <browser> <baseUrl>
 *   persona: signup
 *   browser: chromium | webkit | firefox
 *   baseUrl: https://venue-os.app
 */
import { chromium, webkit, firefox } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const [persona = 'signup', browserName = 'chromium', baseUrl = 'https://venue-os.app'] = process.argv.slice(2);
const ENGINES = { chromium, webkit, firefox };
const stamp = Date.now();
const outDir = `/tmp/beta-${persona}-${browserName}-${stamp}`;
mkdirSync(outDir, { recursive: true });

const findings = [];
const consoleErrors = [];
const netFailures = [];
let stepN = 0;

const run = async () => {
  const browser = await ENGINES[browserName].launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => consoleErrors.push('PAGEERROR: ' + String(e).slice(0, 300)));
  page.on('requestfailed', (r) => netFailures.push(`${r.method()} ${r.url().slice(0, 160)} — ${r.failure()?.errorText}`));
  page.on('response', (r) => { if (r.status() >= 500) netFailures.push(`HTTP ${r.status()} ${r.url().slice(0, 160)}`); });

  const step = async (label, fn) => {
    stepN++;
    const tag = String(stepN).padStart(2, '0');
    try {
      await fn();
      await page.screenshot({ path: `${outDir}/${tag}-${label.replace(/\W+/g, '-')}.png` });
      findings.push({ step: tag, label, ok: true });
    } catch (e) {
      await page.screenshot({ path: `${outDir}/${tag}-FAIL-${label.replace(/\W+/g, '-')}.png` }).catch(() => {});
      findings.push({ step: tag, label, ok: false, error: String(e).slice(0, 400) });
      throw new Error(`STEP FAILED: ${label}`);
    }
  };

  const email = `beta+${stamp}@venue-os.app`;
  const password = 'BetaTester!2026x';
  const org = `Beta Test ${stamp}`;

  try {
    if (persona === 'login') {
      const e = process.env.BETA_EMAIL, p = process.env.BETA_PW;
      await step('goto-login', async () => { await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle', timeout: 30000 }); });
      await step('fill-creds', async () => {
        await page.fill('input[type="email"], input[name="email"]', e, { timeout: 8000 });
        await page.fill('input[type="password"]', p, { timeout: 8000 });
        await page.check('input[type="checkbox"]', { timeout: 4000 }).catch(() => {}); // required EULA agree
      });
      await step('submit-login', async () => {
        await page.click('button[type="submit"], button:has-text("Sign in"), button:has-text("Log in")', { timeout: 8000 });
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(3000);
      });
      await step('reached-dashboard', async () => {
        const url = page.url();
        const text = await page.innerText('body').catch(() => '');
        writeFileSync(`${outDir}/login-result.json`, JSON.stringify({ url, sample: text.slice(0, 400) }, null, 2));
        if (/\/login\b/.test(url)) throw new Error(`still on /login after submit — url=${url}`);
      });
    }
    if (persona === 'signup') {
      await step('landing-loads', async () => { await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }); });
      await step('goto-signup', async () => { await page.goto(`${baseUrl}/signup`, { waitUntil: 'networkidle', timeout: 30000 }); });
      // Dump the form fields a human would see, so we know what's required.
      const fields = await page.$$eval('input,select,textarea,button[type=submit]', (els) =>
        els.map((e) => ({ tag: e.tagName, type: e.getAttribute('type'), name: e.getAttribute('name'), ph: e.getAttribute('placeholder'), txt: (e.textContent || '').trim().slice(0, 40) })));
      writeFileSync(`${outDir}/signup-form-fields.json`, JSON.stringify(fields, null, 2));
      await step('select-vertical', async () => {
        await page.selectOption('select', { index: 1 }).catch(async () => { await page.selectOption('select', { label: /K-?12/i }); });
        await page.waitForTimeout(900); // form re-renders placeholders per vertical
        const fields = await page.$$eval('input,select,textarea', (els) =>
          els.map((e) => ({ tag: e.tagName, type: e.getAttribute('type'), ph: e.getAttribute('placeholder') })));
        writeFileSync(`${outDir}/signup-form-after-vertical.json`, JSON.stringify(fields, null, 2));
      });
      await step('fill-org', async () => {
        await page.fill('input[placeholder*="organization" i], input[placeholder*="venue" i], input[placeholder*="school" i], input[placeholder*="district" i], input[placeholder*="name" i]:not([type=email])', org, { timeout: 8000 });
      });
      await step('fill-slug', async () => {
        await page.fill('input[placeholder*="your-" i], input[placeholder*="slug" i]', `beta-${stamp}`, { timeout: 4000 }).catch(() => {});
      });
      await step('fill-name', async () => {
        await page.fill('input[placeholder="Alex"]', 'Beta', { timeout: 4000 }).catch(() => {});
        await page.fill('input[placeholder="Garcia"]', 'Tester', { timeout: 4000 }).catch(() => {});
      });
      await step('fill-email', async () => { await page.fill('input[type="email"]', email, { timeout: 8000 }); });
      await step('fill-phone', async () => { await page.fill('input[type="tel"]', '+12135551234', { timeout: 4000 }).catch(() => {}); });
      await step('fill-password', async () => {
        const pw = await page.$$('input[type="password"]');
        if (!pw.length) throw new Error('no password field');
        await pw[0].fill(password);
        if (pw[1]) await pw[1].fill(password);
      });
      await step('submit-signup', async () => {
        await page.click('button[type="submit"], button:has-text("Create workspace"), button:has-text("Create")', { timeout: 8000 });
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(3000);
      });
      await step('post-signup-state', async () => {
        const url = page.url();
        const body = (await page.innerText('body').catch(() => '')).slice(0, 400);
        writeFileSync(`${outDir}/post-signup.json`, JSON.stringify({ url, body }, null, 2));
        // Success heuristic: landed on an authed/dashboard URL OR a clear next step.
        if (/login|signin/i.test(url) && !/dashboard|onboard|\/[a-z0-9-]+\//i.test(url)) {
          // landed back on login — try logging in with what we just created
          await page.fill('input[type="email"], input[name="email"]', email).catch(() => {});
          await page.fill('input[type="password"]', password).catch(() => {});
          await page.click('button[type="submit"], button:has-text("Log in"), button:has-text("Sign in")').catch(() => {});
          await page.waitForTimeout(2500);
        }
      });
      await step('authed-dashboard-renders', async () => {
        const url = page.url();
        const text = await page.innerText('body').catch(() => '');
        if (/error|something went wrong|500|cannot reach/i.test(text) && text.length < 600) {
          throw new Error(`dashboard shows error: ${text.slice(0, 200)}`);
        }
        writeFileSync(`${outDir}/dashboard.json`, JSON.stringify({ url, sample: text.slice(0, 500) }, null, 2));
      });
    }
  } catch (e) {
    // step already recorded the failure; continue to report
  } finally {
    await browser.close();
  }

  const report = {
    persona, browser: browserName, baseUrl, email, outDir,
    steps: findings,
    passed: findings.filter((f) => f.ok).length,
    failed: findings.filter((f) => !f.ok).length,
    consoleErrors: [...new Set(consoleErrors)].slice(0, 20),
    netFailures: [...new Set(netFailures)].slice(0, 20),
  };
  writeFileSync(`${outDir}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
};

run().catch((e) => { console.error('RUNNER CRASH', e); process.exit(1); });
