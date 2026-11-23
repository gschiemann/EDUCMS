/**
 * The browser Sentry SDK starts from `src/instrumentation-client.ts`, the
 * file Next runs on every page before hydration (2026-11-23, launch audit
 * LIV-03 / OPS-04 / PLW-02 / SSC-06). Before this, the only browser init was
 * in `sentry.client.config.ts`, which the Turbopack build never loads.
 *
 * The bundle-level proof is `apps/web/tools/check-client-sentry.cjs` (after a
 * build) and `tests/e2e/sentry-client-init.spec.ts` (a real browser).
 */
export {};

const init = jest.fn();
const captureRouterTransitionStart = jest.fn();
const zodConfig = jest.fn();

jest.mock('@sentry/nextjs', () => ({ init, captureRouterTransitionStart }));
jest.mock('zod', () => ({ config: zodConfig }));

const DSN = 'https://public@o0.ingest.sentry.io/0';
const savedDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

type Loaded = { onRouterTransitionStart: unknown };

function load(dsn: string | undefined, pathname: string): Loaded {
  if (dsn === undefined) delete process.env.NEXT_PUBLIC_SENTRY_DSN;
  else process.env.NEXT_PUBLIC_SENTRY_DSN = dsn;
  window.history.replaceState(null, '', pathname);
  let mod: Loaded = { onRouterTransitionStart: undefined };
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('../instrumentation-client');
  });
  return mod;
}

let warn: jest.SpyInstance;

beforeEach(() => {
  init.mockReset();
  captureRouterTransitionStart.mockReset();
  zodConfig.mockReset();
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  warn.mockRestore();
  if (savedDsn === undefined) delete process.env.NEXT_PUBLIC_SENTRY_DSN;
  else process.env.NEXT_PUBLIC_SENTRY_DSN = savedDsn;
});

it('initialises Sentry once with the DSN on an operator page', () => {
  load(DSN, '/login');
  expect(init).toHaveBeenCalledTimes(1);
  const opts = init.mock.calls[0][0];
  expect(opts.dsn).toBe(DSN);
  expect(opts.tracesSampleRate).toBe(0.1);
  expect(typeof opts.beforeSend).toBe('function');
  expect(typeof opts.beforeSendTransaction).toBe('function');
  expect(typeof opts.beforeBreadcrumb).toBe('function');
  expect(warn).not.toHaveBeenCalled();
});

it('initialises Sentry with the screen profile on /player', () => {
  load(DSN, '/player');
  expect(init).toHaveBeenCalledTimes(1);
  const opts = init.mock.calls[0][0];
  expect(opts.tracesSampleRate).toBe(0);
  expect(opts.sendClientReports).toBe(false);
  expect(typeof opts.integrations).toBe('function');
});

it('with no DSN: no init and exactly one warning', () => {
  load(undefined, '/player');
  expect(init).not.toHaveBeenCalled();
  expect(warn).toHaveBeenCalledTimes(1);
  expect(String(warn.mock.calls[0][0])).toContain('NEXT_PUBLIC_SENTRY_DSN not set');
});

it('an init that throws never stops the page', () => {
  init.mockImplementation(() => { throw new Error('sdk failed'); });
  expect(() => load(DSN, '/player')).not.toThrow();
});

it('keeps the Zod JIT off', () => {
  load(DSN, '/login');
  expect(zodConfig).toHaveBeenCalledWith({ jitless: true });
});

it('exports the router transition hook @sentry/nextjs documents', () => {
  const mod = load(DSN, '/login');
  expect(mod.onRouterTransitionStart).toBe(captureRouterTransitionStart);
});
