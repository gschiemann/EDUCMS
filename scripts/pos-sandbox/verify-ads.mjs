// Ad-surface visual verification: sponsor airing on the public board page +
// HOUSE_AD_BANNER rendering in the builder. Run from apps/web.
import { chromium } from '@playwright/test';

const API = 'http://localhost:8080/api/v1';
const WEB = 'http://localhost:3000';
const GAMEID = process.argv[2];
const HOUSE_TPL = process.argv[3];

const results = [];
const check = (n, ok, d = '') => { results.push(ok); console.log(`  ${ok ? '✅' : '❌'} ${n}${d ? ' — ' + d : ''}`); };

const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@springfield.edu', password: 'admin123' }) });
const auth = await login.json();

const browser = await chromium.launch({ channel: 'chrome' });

// ── 1. Public board page: sponsor slot airs within a rotation cycle ──
const board = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await board.goto(`${WEB}/board/${GAMEID}`, { waitUntil: 'domcontentloaded' });
const aired = await board
  .waitForFunction(() => document.body.innerText.includes('Walnut Creek Toyota'), { timeout: 60000 })
  .then(() => true)
  .catch(() => false);
check('sponsor "Walnut Creek Toyota" airs on public /board page', aired);
if (aired) {
  const tagline = await board.evaluate(() => document.body.innerText.includes('Drive home a winner'));
  check('sponsor tagline rendered', tagline);
}
// Impressions written by the surface itself (fire-and-forget beacon)?
await board.waitForTimeout(3000);

// ── 2. HOUSE_AD_BANNER renders its slot ─────────────────────────────
const b2 = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await b2.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' });
await b2.evaluate(([t, u]) => { sessionStorage.setItem('edu_cms_token', t); sessionStorage.setItem('edu_cms_user', JSON.stringify(u)); }, [auth.access_token, auth.user]);
await b2.goto(`${WEB}/springfield-district/templates/builder/${HOUSE_TPL}`, { waitUntil: 'domcontentloaded' });
await b2.waitForTimeout(5000);
await b2.evaluate(() => {
  const ov = [...document.querySelectorAll('div')].find((d) => d.className.includes?.('lg:hidden') && d.textContent.includes('Larger screen required'));
  if (ov) ov.style.display = 'none';
  const c = [...document.querySelectorAll('div')].find((d) => d.className === 'hidden lg:block');
  if (c) c.style.display = 'block';
});
const ad = await b2
  .waitForFunction(() => {
    const img = [...document.querySelectorAll('img')].find((i) => (i.src || '').startsWith('data:image/png'));
    const label = document.body.innerText.includes('Springfield Boosters');
    return img && label ? { img: true, label } : false;
  }, { timeout: 20000 })
  .then((h) => h.jsonValue())
  .catch(() => null);
check('HOUSE_AD_BANNER renders slot image + sponsor label', !!ad, JSON.stringify(ad));

await browser.close();
const passed = results.filter(Boolean).length;
console.log(`\nRESULT: ${passed}/${results.length}${passed === results.length ? ' — ALL GREEN' : ''}`);
process.exit(passed === results.length ? 0 : 1);
