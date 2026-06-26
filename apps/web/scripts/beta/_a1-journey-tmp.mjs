/**
 * A1 first-run journey — drives the REAL signup UI, onboarding/branding wizard,
 * scrape→adopt, and lands on the dashboard. NOT the API shortcut.
 * Captures screenshots + console errors + 5xx/net failures at every step.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const WEB = 'https://venue-os.app';
const API = 'https://api-production-39a1.up.railway.app/api/v1';
const MOBILE = process.env.BETA_MOBILE === '1';
const stamp = Date.now();
const outDir = `/private/tmp/claude-501/-Users-gschiemann-Desktop-EDU-CMS/4129bcd1-4636-4065-90ea-207bae54cd20/scratchpad/a1/run-${MOBILE ? 'mobile' : 'desk'}-${stamp}`;
mkdirSync(outDir, { recursive: true });

const consoleErrors = [], netFailures = [], steps = [];
let stepN = 0;
const rand = Math.random().toString(36).slice(2, 8);

const run = async () => {
  const browser = await chromium.launch();
  const ctxOpts = MOBILE
    ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }
    : { viewport: { width: 1440, height: 900 } };
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => consoleErrors.push('PAGEERROR: ' + String(e).slice(0, 300)));
  page.on('requestfailed', (r) => {
    const err = r.failure()?.errorText || '';
    const u = r.url();
    if (/[?&]_rsc=/.test(u) && /ERR_ABORTED/.test(err)) return;
    netFailures.push(`${r.method()} ${u.slice(0, 130)} — ${err}`);
  });
  page.on('response', (r) => { if (r.status() >= 500) netFailures.push(`HTTP ${r.status()} ${r.url().slice(0, 130)}`); });

  const shot = async (label) => {
    stepN++; const tag = String(stepN).padStart(2, '0');
    await page.screenshot({ path: `${outDir}/${tag}-${label.replace(/\W+/g, '-')}.png`, fullPage: false }).catch(() => {});
    return tag;
  };

  const result = { ok: true, notes: [] };

  // ── 1. Landing on signup ──
  await page.goto(`${WEB}/signup`, { waitUntil: 'networkidle', timeout: 60000 });
  await shot('signup-landing');
  const bodyText1 = await page.innerText('body').catch(() => '');
  result.signupHeadingPresent = /Start your free workspace/i.test(bodyText1);
  result.freePilotBadge = /Free pilot/i.test(bodyText1);

  // ── 2. Fill the form ──
  // industry select
  await page.selectOption('select', 'K12').catch((e) => result.notes.push('select industry failed: ' + e));
  await page.waitForTimeout(300);
  await shot('signup-industry-picked');

  const districtName = `Beta Run ${rand}`;
  const adminEmail = `beta+a1-${rand}@venue-os.app`;
  const password = 'BetaTester!2026x';
  // district name (first text input after select) — target by placeholder
  await page.fill('input[placeholder*="Springfield"]', districtName).catch((e) => result.notes.push('district fill: ' + e));
  await page.waitForTimeout(200);
  // first/last
  await page.fill('input[placeholder="Alex"]', 'Beta').catch(() => {});
  await page.fill('input[placeholder="Garcia"]', 'Tester').catch(() => {});
  // email
  await page.fill('input[type="email"]', adminEmail).catch((e) => result.notes.push('email fill: ' + e));
  // password + confirm
  const pws = page.locator('input[type="password"]');
  await pws.nth(0).fill(password).catch((e) => result.notes.push('pw fill: ' + e));
  await pws.nth(1).fill(password).catch((e) => result.notes.push('confirm fill: ' + e));
  // capture slug value
  result.slugAuto = await page.locator('input[placeholder="springfield"]').inputValue().catch(() => '(n/a)');
  await shot('signup-filled');

  // ── 3. Submit ──
  const submitBtn = page.locator('button[type="submit"]:has-text("Create workspace")');
  await submitBtn.click().catch((e) => result.notes.push('submit click: ' + e));
  // wait for navigation to onboarding OR error
  let landed = '';
  try {
    await page.waitForURL(/\/onboarding\/branding|\/dashboard/, { timeout: 45000 });
    landed = page.url();
  } catch (e) {
    landed = page.url();
    result.notes.push('did not navigate to onboarding within 45s; url=' + landed);
  }
  await page.waitForTimeout(2000);
  await shot('after-submit');
  result.afterSubmitUrl = landed;
  const errAfterSubmit = await page.locator('.bg-rose-50, [role="alert"]').first().innerText().catch(() => '');
  if (errAfterSubmit) result.signupError = errAfterSubmit.slice(0, 200);

  // ── 4. Onboarding / branding wizard ──
  if (/\/onboarding\/branding/.test(page.url())) {
    await page.waitForLoadState('networkidle').catch(() => {});
    await shot('onboarding-landing');
    const obText = await page.innerText('body').catch(() => '');
    result.onboardingHasPasteUrl = /Paste your website/i.test(obText);
    result.onboardingHasSkip = /Skip for now/i.test(obText);

    // Try the URL scrape via a sample button (Harvard is verified-friendly)
    const sampleBtn = page.locator('button:has-text("Harvard"), button:has-text("Stanford")').first();
    let usedSample = false;
    if (await sampleBtn.count()) {
      usedSample = true;
      await sampleBtn.click().catch((e) => result.notes.push('sample click: ' + e));
    } else {
      // type a URL + click Scan
      await page.fill('input[placeholder*="yourschool"]', 'https://www.stanford.edu/').catch(() => {});
      await page.locator('button:has-text("Scan")').first().click().catch(() => {});
    }
    result.scrapeUsedSample = usedSample;
    await shot('scrape-initiated');

    // Wait for the preview to appear (Confidence card / Logos found / Adopt button)
    let scrapeOk = false;
    try {
      await page.waitForSelector('text=/Confidence|Logos found|Palette|Adopt branding/i', { timeout: 40000 });
      scrapeOk = true;
    } catch (e) {
      result.notes.push('scrape preview did not appear within 40s');
    }
    await page.waitForTimeout(2000);
    await shot('scrape-result');
    result.scrapeProducedPreview = scrapeOk;

    if (scrapeOk) {
      const previewText = await page.innerText('body').catch(() => '');
      const confMatch = previewText.match(/Confidence[\s\S]{0,40}?(\d{1,3})%/);
      result.scrapeConfidence = confMatch ? confMatch[1] + '%' : '(not parsed)';
      const logosMatch = previewText.match(/Logos found\s*\((\d+)\)/);
      result.logosFound = logosMatch ? logosMatch[1] : '(not parsed)';
      const scrapeErr = await page.locator('text=/bot protection|Scrape failed|couldn.t/i').first().innerText().catch(() => '');
      if (scrapeErr) result.scrapeWarning = scrapeErr.slice(0, 200);

      // ── 5. Adopt ──
      const adoptBtn = page.locator('button:has-text("Adopt branding")').first();
      if (await adoptBtn.count()) {
        await adoptBtn.scrollIntoViewIfNeeded().catch(() => {});
        await adoptBtn.click().catch((e) => result.notes.push('adopt click: ' + e));
        try {
          await page.waitForURL(/\/dashboard/, { timeout: 30000 });
          result.adoptLandedDashboard = true;
        } catch (e) {
          result.adoptLandedDashboard = false;
          result.notes.push('adopt did not redirect to dashboard within 30s; url=' + page.url());
        }
        await page.waitForTimeout(3000);
        await shot('after-adopt');
      } else {
        result.notes.push('no Adopt branding button found');
      }
    }
  }

  // ── 6. Dashboard state ──
  await page.waitForTimeout(1500);
  await shot('final-dashboard');
  const dashText = await page.innerText('body').catch(() => '');
  result.finalUrl = page.url();
  result.dashboardReached = /\/dashboard/.test(page.url());
  result.dashboardHasGettingStarted = /Getting started/i.test(dashText);
  result.dashboardHas3Steps = /Connect a Screen/i.test(dashText) && /Upload Content/i.test(dashText) && /Build a Playlist/i.test(dashText);
  result.dashboardBrandedFlash = /\?branded=1/.test(page.url());
  result.dashboardSample = dashText.slice(0, 400).replace(/\s+/g, ' ');

  writeFileSync(`${outDir}/result.json`, JSON.stringify({
    ...result,
    credentials: { districtName, adminEmail, slug: result.slugAuto },
    consoleErrors: [...new Set(consoleErrors)].slice(0, 30),
    netFailures: [...new Set(netFailures)].slice(0, 30),
    outDir,
  }, null, 2));
  console.log(JSON.stringify({
    ...result,
    consoleErrors: [...new Set(consoleErrors)].slice(0, 30),
    netFailures: [...new Set(netFailures)].slice(0, 30),
    outDir,
  }, null, 2));
  await browser.close();
};

run().catch((e) => { console.error('CRASH', e); process.exit(1); });
