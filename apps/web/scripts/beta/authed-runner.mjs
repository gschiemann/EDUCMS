/**
 * Authenticated beta-tester harness — drives LOGGED-IN VenueOS surfaces in a real
 * browser as a human operator, on an ISOLATED throwaway tenant (zero risk to real
 * data). Self-provisions via POST /signup (no email gate), seeds the web auth state
 * (edu_cms_token in local+sessionStorage, per ui-store.ts) and the API session
 * cookie (edu_cms_sid, captured by the context's request), then navigates straight
 * to the dashboard — bypassing any UI-redirect flakiness — and exercises each surface,
 * capturing a screenshot + console errors + failed/5xx network at every step.
 *
 * Usage: node authed-runner.mjs <surface|all|comma,list> <browser> [web] [api]
 *   surface: dashboard|screens|assets|playlists|templates|sports|settings|ai|all
 *   browser: chromium | webkit | firefox
 * Writes report.json + screenshots to /tmp/beta-authed-<surface>-<browser>-<stamp>/
 */
import { chromium, webkit, firefox } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const [surfaceArg = 'all', browserName = 'chromium',
  WEB = 'https://venue-os.app',
  API = 'https://api-production-39a1.up.railway.app/api/v1'] = process.argv.slice(2);

const ENGINES = { chromium, webkit, firefox };
const MOBILE = process.env.BETA_MOBILE === '1'; // phone viewport + touch (iPhone-class)
const stamp = Date.now();
const outDir = `/tmp/beta-authed-${surfaceArg.replace(/\W+/g, '-')}-${browserName}${MOBILE ? '-mobile' : ''}-${stamp}`;
mkdirSync(outDir, { recursive: true });

const TOKEN_KEY = 'edu_cms_token', USER_KEY = 'edu_cms_user', REMEMBER_KEY = 'edu_cms_remember';

// surface -> { path, marker(regex of expected on-page text), interact?(page) }
const SURFACES = {
  dashboard: { path: 'dashboard', marker: /dashboard|welcome|screens|playlist/i },
  screens:   { path: 'screens',   marker: /screen|pair|group|offline|online/i },
  assets:    { path: 'assets',    marker: /asset|upload|folder|librar/i },
  playlists: { path: 'playlists', marker: /playlist|new playlist|create/i, interact: openPlaylistWizard },
  templates: { path: 'templates', marker: /template|import|new template|gallery/i, interact: openFirstTemplate },
  sports:    { path: 'sports',    marker: /game|score|sport|new game|board/i },
  settings:  { path: 'settings',  marker: /setting|account|billing|branding|user|integration/i },
  ai:        { path: 'settings/ai', marker: /ai|provider|api key|anthropic|openai|gemini|google/i },
};
const ORDER = ['dashboard', 'screens', 'assets', 'playlists', 'templates', 'sports', 'settings', 'ai'];
const requested = surfaceArg === 'all' ? ORDER
  : surfaceArg.split(',').map((s) => s.trim()).filter((s) => SURFACES[s]);

const consoleErrors = [], netFailures = [], steps = [];
let stepN = 0;

async function openPlaylistWizard(page) {
  // The "New Playlist" wizard historically crashed with React #310 — opening it IS the test.
  const btn = page.locator('button:has-text("New playlist"), button:has-text("New Playlist"), button:has-text("Create playlist")').first();
  if (await btn.count()) { await btn.click({ timeout: 5000 }); await page.waitForTimeout(1500); }
}
async function openFirstTemplate(page) {
  const tile = page.locator('[class*="template"], a[href*="builder"], button:has-text("Edit")').first();
  if (await tile.count()) { await tile.click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(1500); }
}

const run = async () => {
  const browser = await ENGINES[browserName].launch();
  let ctxOpts = { viewport: { width: 1440, height: 900 } };
  if (MOBILE) {
    // iPhone-class phone viewport. isMobile is chromium/webkit-only (firefox throws).
    ctxOpts = { viewport: { width: 390, height: 844 }, hasTouch: true, deviceScaleFactor: 3 };
    if (browserName !== 'firefox') ctxOpts.isMobile = true;
  }
  const ctx = await browser.newContext(ctxOpts);

  const email = `beta+${surfaceArg.replace(/\W+/g, '')}-${stamp}@venue-os.app`;
  const password = 'BetaTester!2026x';
  const vertical = requested.includes('sports') ? 'SPORTS' : 'K12';
  const districtName = `Beta ${surfaceArg} ${stamp}`;
  const slug = `beta-${surfaceArg.replace(/\W+/g, '')}-${stamp}`.slice(0, 60);

  // ---- provision throwaway tenant (cookies land in ctx automatically) ----
  let token, user, provErr;
  for (let attempt = 0; attempt < 3 && !token; attempt++) {
    try {
      const resp = await ctx.request.post(`${API}/signup`, {
        data: { districtName, slug: `${slug}${attempt ? '-' + attempt : ''}`, adminEmail: email, password, vertical, firstName: 'Beta', lastName: 'Tester' },
        timeout: 30000,
      });
      const body = await resp.json().catch(() => ({}));
      if (resp.status() === 429) { provErr = 'rate-limited'; await new Promise((r) => setTimeout(r, 4000 * (attempt + 1))); continue; }
      if (!resp.ok()) { provErr = `signup ${resp.status()} ${JSON.stringify(body).slice(0, 220)}`; break; }
      token = body.access_token; user = body.user;
      if (!token) { provErr = `no access_token: ${JSON.stringify(body).slice(0, 220)}`; break; }
    } catch (e) { provErr = String(e).slice(0, 220); }
  }
  if (!token) {
    writeFileSync(`${outDir}/report.json`, JSON.stringify({ surface: surfaceArg, browser: browserName, provisioned: false, provErr }, null, 2));
    console.log(JSON.stringify({ surface: surfaceArg, browser: browserName, provisioned: false, provErr }));
    await browser.close();
    return;
  }

  // ---- seed web auth state BEFORE any page load (ui-store reads these on boot) ----
  await ctx.addInitScript(([tk, uk, rk, t, u]) => {
    try {
      localStorage.setItem(tk, t); localStorage.setItem(uk, u); localStorage.setItem(rk, '1');
      sessionStorage.setItem(tk, t); sessionStorage.setItem(uk, u);
    } catch (e) {}
  }, [TOKEN_KEY, USER_KEY, REMEMBER_KEY, token, JSON.stringify(user)]);

  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => consoleErrors.push('PAGEERROR: ' + String(e).slice(0, 300)));
  page.on('requestfailed', (r) => {
    const err = r.failure()?.errorText || '';
    const u = r.url();
    if (/[?&]_rsc=/.test(u) && /ERR_ABORTED/.test(err)) return; // Next.js RSC prefetch abort — normal noise
    netFailures.push(`${r.method()} ${u.slice(0, 150)} — ${err}`);
  });
  page.on('response', (r) => { if (r.status() >= 500) netFailures.push(`HTTP ${r.status()} ${r.url().slice(0, 150)}`); });

  const tslug = user.tenantSlug || user.tenantId;

  const step = async (label, fn) => {
    stepN++; const tag = String(stepN).padStart(2, '0');
    const errsBefore = consoleErrors.length, netBefore = netFailures.length;
    try {
      await fn();
      await page.screenshot({ path: `${outDir}/${tag}-${label.replace(/\W+/g, '-')}.png` });
      steps.push({ step: tag, label, ok: true, newConsoleErrors: consoleErrors.length - errsBefore, new5xxOrNetFail: netFailures.length - netBefore });
    } catch (e) {
      await page.screenshot({ path: `${outDir}/${tag}-FAIL-${label.replace(/\W+/g, '-')}.png` }).catch(() => {});
      steps.push({ step: tag, label, ok: false, error: String(e).slice(0, 300) });
    }
  };

  // verify the seeded session actually lands us in the authed app
  await step('auth-dashboard', async () => {
    await page.goto(`${WEB}/${tslug}/dashboard`, { waitUntil: 'networkidle', timeout: 45000 });
    const url = page.url();
    if (/\/login|\/signup/.test(url)) throw new Error(`auth seed failed — redirected to ${url}`);
  });

  for (const key of requested) {
    if (key === 'dashboard') continue; // already done
    const s = SURFACES[key];
    await step(key, async () => {
      await page.goto(`${WEB}/${tslug}/${s.path}`, { waitUntil: 'networkidle', timeout: 45000 });
      const url = page.url();
      if (/\/login/.test(url)) throw new Error(`redirected to /login on ${key}`);
      const text = await page.innerText('body').catch(() => '');
      const hasError = /something went wrong|application error|internal server error|this page (could not|can.t)|failed to load/i.test(text) && text.length < 700;
      if (hasError) throw new Error(`error page on ${key}: ${text.slice(0, 160)}`);
      const markerOk = s.marker.test(text);
      if (s.interact) { try { await s.interact(page); await page.screenshot({ path: `${outDir}/${String(stepN).padStart(2, '0')}-${key}-interact.png` }); } catch (e) {} }
      if (!markerOk) throw new Error(`expected content not found on ${key} (marker miss); sample="${text.slice(0, 120).replace(/\s+/g, ' ')}"`);
    });
  }

  const finalText = await page.innerText('body').catch(() => '');
  writeFileSync(`${outDir}/final.json`, JSON.stringify({ finalUrl: page.url(), tslug, vertical, sample: finalText.slice(0, 600) }, null, 2));
  await browser.close();
};

run()
  .then(() => {
    const report = {
      surface: surfaceArg, browser: browserName, provisioned: true, outDir,
      steps,
      passed: steps.filter((s) => s.ok).length,
      failed: steps.filter((s) => !s.ok).length,
      consoleErrors: [...new Set(consoleErrors)].slice(0, 25),
      netFailures: [...new Set(netFailures)].slice(0, 25),
    };
    writeFileSync(`${outDir}/report.json`, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  })
  .catch((e) => { console.error('RUNNER CRASH', e); process.exit(1); });
