/**
 * /signup in English, Spanish and Chinese (launch QA 2026-10-23, U2: the page
 * was English-only while /login offered all three) — and the public
 * "Report a security issue" page plus its RFC 9116 security.txt.
 *
 * Self-contained like the rest of tests/e2e: the API is `http://api.invalid`
 * and every call to it is answered here with page.route(). The language comes
 * from the same `venueos_locale` cookie the app's switcher writes; the
 * translated catalog is fetched by the page itself (`/locales/<lang>.json`).
 * Run in BOTH engines — Safari is where the operator lives:
 *
 *   E2E_BASE=http://localhost:3217 pnpm exec playwright test -c playwright.sandbox.config.ts \
 *     tests/e2e/signup-i18n.spec.ts --project=webkit
 */
import { test, expect, type Page, type Route, type BrowserContext } from '@playwright/test';

const ORIGIN = process.env.E2E_BASE || 'http://localhost:3000';
const API_ROOT = 'http://api.invalid/api/v1';
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'authorization,content-type,x-csrf-token,x-requested-with',
};

type Lang = 'en' | 'es' | 'zh';

/** What a reader of each language must see — written out here, not read from the catalogs,
 *  so a broken or missing catalog entry fails this test instead of agreeing with it. */
const COPY: Record<Lang, {
  switcher: string;
  title: string;
  industry: string;
  k12: string;
  k12NameLabel: string;
  adminEmail: string;
  password: string;
  confirm: string;
  create: string;
  mismatch: string;
  slugTaken: string;
  security: string;
  securityTitle: string;
  securityAck: string;
  headerSignIn: string;
}> = {
  en: {
    switcher: 'English',
    title: 'Start your free workspace.',
    industry: 'What are you running?',
    k12: 'K-12 school or district',
    k12NameLabel: 'District or school name',
    adminEmail: 'Admin email',
    password: 'Password',
    confirm: 'Confirm password',
    create: 'Create workspace',
    mismatch: 'Passwords do not match.',
    slugTaken: 'That workspace URL is already taken — try another one.',
    security: 'Security',
    securityTitle: 'Report a security issue',
    securityAck: '2 business days',
    headerSignIn: 'Sign in',
  },
  es: {
    switcher: 'Español',
    title: 'Crea tu espacio de trabajo gratis.',
    industry: '¿Qué tipo de organización administras?',
    k12: 'Escuela o distrito escolar (K-12)',
    k12NameLabel: 'Nombre del distrito o la escuela',
    adminEmail: 'Correo del administrador',
    password: 'Contraseña',
    confirm: 'Confirmar contraseña',
    create: 'Crear espacio de trabajo',
    mismatch: 'Las contraseñas no coinciden.',
    slugTaken: 'Esa URL de espacio de trabajo ya está en uso: prueba con otra.',
    security: 'Seguridad',
    securityTitle: 'Reportar un problema de seguridad',
    securityAck: '2 días hábiles',
    headerSignIn: 'Iniciar sesión',
  },
  zh: {
    switcher: '中文',
    title: '创建您的免费工作区。',
    industry: '您经营的是什么？',
    k12: 'K-12 学校或学区',
    k12NameLabel: '学区或学校名称',
    adminEmail: '管理员邮箱',
    password: '密码',
    confirm: '确认密码',
    create: '创建工作区',
    mismatch: '两次输入的密码不一致。',
    slugTaken: '该工作区网址已被占用，请换一个。',
    security: '安全',
    securityTitle: '报告安全问题',
    securityAck: '2 个工作日',
    headerSignIn: '登录',
  },
};

/**
 * The server-rendered HTML already shows English text and a working-looking
 * form, so "the heading says X" is not proof the page is interactive. React
 * hangs its props on a DOM node when it hydrates it — wait for that on the
 * form before typing or clicking, or the input lands before React and is
 * thrown away.
 */
async function waitForHydration(page: Page) {
  await page.waitForFunction(
    () => {
      const form = document.querySelector('form');
      return !!form && Object.keys(form).some((k) => k.startsWith('__reactProps'));
    },
    undefined,
    { timeout: 45_000 },
  );
}

async function useLanguage(context: BrowserContext, lang: Lang) {
  await context.addCookies([{ name: 'venueos_locale', value: lang, url: ORIGIN }]);
}

/** Answers every API call; POST /signup refuses with the API's own 409 sentence. */
async function mockApi(page: Page) {
  const signups: Array<Record<string, unknown>> = [];
  const cors = (route: Route, respond: () => unknown) =>
    route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: CORS_HEADERS, body: '' }) : respond();
  await page.route(/^http:\/\/api\.invalid\//, (route) => cors(route, () => route.fulfill({ status: 204, headers: CORS_HEADERS, body: '' })));
  await page.route(`${API_ROOT}/signup`, (route) =>
    cors(route, () => {
      signups.push(JSON.parse(route.request().postData() || '{}'));
      return route.fulfill({
        status: 409,
        contentType: 'application/json',
        headers: CORS_HEADERS,
        body: JSON.stringify({ statusCode: 409, message: 'That slug is already taken.', error: 'Conflict' }),
      });
    }),
  );
  return signups;
}

for (const lang of ['en', 'es', 'zh'] as const) {
  test.describe(`/signup in ${lang}`, () => {
    test('every label, button, error and link is in the reader’s language', async ({ page, context }) => {
      test.setTimeout(90_000);
      await useLanguage(context, lang);
      const signups = await mockApi(page);
      const c = COPY[lang];

      await page.goto('/signup', { waitUntil: 'domcontentloaded' });
      await waitForHydration(page);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(c.title, { timeout: 30_000 });
      await expect(page.getByRole('button', { name: c.switcher })).toHaveAttribute('aria-pressed', 'true');

      // Labels are tied to their controls now (htmlFor), so they work as locators.
      const industry = page.getByLabel(c.industry);
      await expect(industry).toBeVisible();
      await industry.selectOption('K12');
      await expect(industry.locator('option:checked')).toHaveText(c.k12);
      const name = page.getByLabel(c.k12NameLabel);
      await expect(name).toBeVisible();
      await name.fill('Springfield E2E');

      await page.getByLabel(c.adminEmail).fill('admin@springfield-e2e.example');
      await page.getByLabel(c.password, { exact: true }).fill('correct horse battery');
      await page.getByLabel(c.confirm).fill('different horse battery');
      await page.getByRole('button', { name: c.create }).click();
      await expect(page.getByTestId('signup-error')).toHaveText(c.mismatch);
      expect(signups).toHaveLength(0);

      // The server's English 409 is shown in the reader's language.
      await page.getByLabel(c.confirm).fill('correct horse battery');
      await page.getByRole('button', { name: c.create }).click();
      await expect(page.getByTestId('signup-error')).toHaveText(c.slugTaken);
      expect(signups).toHaveLength(1);
      expect(signups[0]).toMatchObject({ vertical: 'K12', locale: lang, slug: 'springfield-e2e' });

      // The compact legal footer links the security page, in this language.
      const security = page.getByRole('link', { name: c.security, exact: true });
      await expect(security).toHaveAttribute('href', '/security');

      // No English left in the form for a non-English reader.
      if (lang !== 'en') {
        const formText = await page.locator('form').innerText();
        for (const english of ['What are you running?', 'Workspace URL', 'Admin email', 'Create workspace', 'By creating a workspace']) {
          expect(formText).not.toContain(english);
        }
      }
    });
  });
}

test('the language switcher on /signup changes the page in place, without a reload', async ({ page }) => {
  test.setTimeout(90_000);
  await mockApi(page);
  await page.goto('/signup', { waitUntil: 'domcontentloaded' });
  await waitForHydration(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(COPY.en.title, { timeout: 30_000 });
  await page.evaluate(() => { (window as unknown as { __noReload: boolean }).__noReload = true; });

  await page.getByRole('button', { name: COPY.es.switcher }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(COPY.es.title, { timeout: 15_000 });
  await page.getByRole('button', { name: COPY.zh.switcher }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(COPY.zh.title, { timeout: 15_000 });
  expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true);
});

for (const lang of ['en', 'es', 'zh'] as const) {
  test(`/security — "Report a security issue" in ${lang}`, async ({ page, context }) => {
    test.setTimeout(90_000);
    await useLanguage(context, lang);
    await page.goto('/security', { waitUntil: 'domcontentloaded' });
    const c = COPY[lang];
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(c.securityTitle, { timeout: 30_000 });
    const report = page.getByTestId('security-report-page');
    await expect(report.getByTestId('security-report-email')).toHaveAttribute('href', 'mailto:security@venue-os.app');
    await expect(report).toContainText(c.securityAck);
    await expect(report.locator('a[href="/.well-known/security.txt"]')).toBeVisible();
    // The public header above it speaks the same language.
    // (a <header> inside the root layout's <main> has no banner role, so locate it as an element)
    await expect(page.locator('header').first().getByRole('link', { name: c.headerSignIn, exact: true })).toBeVisible();
  });
}

test('/.well-known/security.txt is served as RFC 9116 plain text', async ({ request }) => {
  const res = await request.get('/.well-known/security.txt');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toMatch(/^text\/plain/);
  const body = await res.text();
  expect(body).toMatch(/^Contact: mailto:security@venue-os\.app$/m);
  expect(body).toMatch(/^Expires: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/m);
  expect(body).toMatch(/^Preferred-Languages: en$/m);
  expect(body).toMatch(/^Policy: https:\/\/venue-os\.app\/security$/m);
});
