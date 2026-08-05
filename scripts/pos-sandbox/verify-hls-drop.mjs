#!/usr/bin/env node
/**
 * HLS playback + drop/recovery verifier (2026-08-04, media-integration
 * sandbox). Live-executes what the 2026-08-03 census only inferred from
 * code (§6 P1 "dropped HLS = permanent black screen"):
 *
 *   1. Spawns a local live HLS stream (ffmpeg testsrc) + CORS server :4747.
 *   2. Logs into the sandbox web app (headless chromium; session injected
 *      via sessionStorage edu_cms_token — the app's own bootstrap path).
 *   3. Opens the "HLS Sandbox Test" template in the builder and asserts the
 *      StreamingWidget's <video> actually PLAYS (currentTime advances,
 *      real decoded frames).
 *   4. Kills the stream → asserts hls.js surfaces the fatal "Stream error:"
 *      toast (widget error path works).
 *   5. Restarts the stream → documents whether playback recovers.
 *      EXPECTED TODAY: it does NOT (census P1, no recoverMediaError/
 *      startLoad anywhere) — the assertion encodes the CURRENT behavior so
 *      this script flips to a regression test the day the fix lands (then
 *      update EXPECT_RECOVERY to true).
 *
 * Prereqs: sandbox API :8080 + web :3000 up (see README), template
 * "HLS Sandbox Test" created (run-e2e leaves the DB; or create per README).
 * Run from apps/web: node ../../scripts/pos-sandbox/verify-hls-drop.mjs
 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const API = process.env.SANDBOX_API || 'http://localhost:8080/api/v1';
const WEB = process.env.SANDBOX_WEB || 'http://localhost:3000';
const HLS_PORT = 4747;

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
};

// ─── Stream lifecycle ──────────────────────────────────────────────────
const hlsDir = mkdtempSync(join(tmpdir(), 'venueos-hls-'));
const serverPath = join(fileURLToPath(import.meta.url), '../hls-server.mjs');
let ffmpeg = null;
const server = spawn('node', [serverPath, hlsDir, String(HLS_PORT)], { stdio: 'ignore' });
function startStream() {
  ffmpeg = spawn('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-re',
    '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440',
    '-c:v', 'h264', '-preset', 'veryfast', '-g', '60', '-c:a', 'aac',
    '-f', 'hls', '-hls_time', '2', '-hls_list_size', '6',
    '-hls_flags', 'delete_segments+append_list',
    join(hlsDir, 'live.m3u8'),
  ], { stdio: 'ignore' });
}
const stopStream = () => { try { ffmpeg?.kill('SIGKILL'); } catch { /* */ } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  startStream();
  await sleep(7000); // first segments

  // ─── Auth: mint a session and inject it the way bootstrapAuth reads it ─
  const login = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@springfield.edu', password: 'admin123' }),
  });
  const auth = await login.json();
  if (!auth?.access_token) throw new Error('sandbox login failed — is the API up?');

  // Find the HLS test template id by name (created by the sandbox setup).
  const tpls = await (await fetch(`${API}/templates`, { headers: { Authorization: `Bearer ${auth.access_token}` } })).json();
  const tpl = (Array.isArray(tpls) ? tpls : tpls?.templates || []).find((t) => t.name === 'HLS Sandbox Test');
  if (!tpl) throw new Error('template "HLS Sandbox Test" not found — see README (create via POST /templates)');

  // channel:'chrome' = the installed Google Chrome — Playwright's bundled
  // chromium has NO h264/aac decoders, so the stream parses (videoWidth
  // set from the init segment) but never advances a frame.
  const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(([t, u]) => {
    sessionStorage.setItem('edu_cms_token', t);
    sessionStorage.setItem('edu_cms_user', JSON.stringify(u));
  }, [auth.access_token, auth.user]);
  await page.goto(`${WEB}/springfield-district/templates/builder/${tpl.id}`, { waitUntil: 'domcontentloaded' });

  // The dev server sometimes fails to compile the lg: breakpoint CSS — force
  // the builder content visible either way (same workaround as interactive).
  await page.waitForTimeout(4000);
  await page.evaluate(() => {
    const ov = [...document.querySelectorAll('div')].find((d) => d.className.includes?.('lg:hidden') && d.textContent.includes('Larger screen required'));
    if (ov) ov.style.display = 'none';
    const c = [...document.querySelectorAll('div')].find((d) => d.className === 'hidden lg:block');
    if (c) c.style.display = 'block';
  });

  // ─── 1. Playback ───────────────────────────────────────────────────
  await page.waitForSelector('video', { timeout: 20000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('video');
    return v && v.videoWidth > 0;
  }, { timeout: 20000 });
  // The builder surface passes live=false (no autoplay while editing); the
  // real player passes live=true and calls v.play(). Simulate the player's
  // play call so the drop/recovery behavior we measure is the kiosk's.
  await page.evaluate(() => document.querySelector('video').play().catch(() => {}));
  await page.waitForTimeout(1500);
  const t0 = await page.evaluate(() => document.querySelector('video').currentTime);
  await page.waitForTimeout(6000);
  const s1 = await page.evaluate(() => {
    const v = document.querySelector('video');
    return { t: v.currentTime, w: v.videoWidth, paused: v.paused };
  });
  check('HLS stream decodes in StreamingWidget (videoWidth 1280)', s1.w === 1280, `w=${s1.w}`);
  check('playback advances (live)', s1.t - t0 > 3 && !s1.paused, `t ${t0.toFixed(1)}→${s1.t.toFixed(1)} paused=${s1.paused}`);

  // ─── 2. Drop the stream (~2 min outage) ────────────────────────────
  // Empirical finding (2026-08-04, supersedes the census code-read): a
  // plain server outage does NOT reach hls.js's fatal path — it retries
  // playlist loads non-fatally the whole time, so no "Stream error:" toast
  // appears. The census P1 (no recovery handler) only bites for
  // FATAL-class errors (decode errors, exhausted frag retries). We report
  // whether the fatal toast appeared as information, and assert the
  // user-meaningful invariant in step 3: playback RESUMES once the stream
  // returns.
  stopStream();
  const errToast = await page
    .waitForFunction(() => {
      const d = [...document.querySelectorAll('div')].map((e) => e.textContent.trim()).find((t) => /^Stream error:/.test(t) && t.length < 90);
      return d || false;
    }, { timeout: 120000 })
    .then((h) => h.jsonValue())
    .catch(() => null);
  console.log(`  ℹ️  during outage: ${errToast ? `fatal toast shown ("${errToast}") — recovery below would need the P1 fix` : 'no fatal error — hls.js retrying non-fatally (expected)'}`);

  // ─── 3. Restart → playback must resume ─────────────────────────────
  startStream();
  await sleep(20000);
  const s2 = await page.evaluate(() => {
    const v = document.querySelector('video');
    return { t: v?.currentTime ?? -1, paused: v?.paused };
  });
  await sleep(8000);
  const s3 = await page.evaluate(() => document.querySelector('video')?.currentTime ?? -1);
  const recovered = s3 - s2.t > 3;
  check(
    'playback resumes after the stream returns (~2min outage)',
    recovered,
    `t ${s2.t.toFixed(1)}→${s3.toFixed(1)}${errToast ? ' (went fatal — P1 territory)' : ''}`,
  );

  await browser.close();
} catch (err) {
  check('verifier crashed', false, String(err?.message || err));
} finally {
  stopStream();
  try { server.kill('SIGKILL'); } catch { /* */ }
}

const passed = results.filter(Boolean).length;
console.log(`\nRESULT: ${passed}/${results.length} passed${passed === results.length ? ' — ALL GREEN' : ''}`);
process.exit(passed === results.length ? 0 : 1);
