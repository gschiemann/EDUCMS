import {
  OPERATOR_TRACES_SAMPLE_RATE,
  SCREEN_DROPPED_INTEGRATIONS,
  SCREEN_EVENT_CAP,
  SCREEN_EVENT_COUNT_KEY,
  isScreenPath,
  makeScreenEventGate,
  sentryClientOptions,
} from '../sentry-client-options';
import { FILTERED } from '../sentry-scrub';

const DSN = 'https://public@o0.ingest.sentry.io/0';

/** The integration names the SDK installs by default (@sentry/nextjs 10). */
const DEFAULTS = [
  'InboundFilters', 'FunctionToString', 'ConversationId', 'BrowserApiErrors', 'Breadcrumbs',
  'GlobalHandlers', 'LinkedErrors', 'Dedupe', 'HttpContext', 'CultureContext', 'BrowserSession',
  'BrowserTracing', 'NextjsClientStackFrameNormalization',
].map((name) => ({ name, setupOnce: () => undefined }));

type IntegrationsFn = (d: typeof DEFAULTS) => typeof DEFAULTS;
type Hook = (e: unknown, hint?: unknown) => unknown;

beforeEach(() => {
  window.sessionStorage.clear();
});

describe('isScreenPath', () => {
  it.each(['/player', '/player/', '/player/tile', '/board/g1', '/ribbon/g1', '/scorebug/g1', '/overlay/g1'])(
    '%s is a screen',
    (p) => expect(isScreenPath(p)).toBe(true),
  );
  it.each(['/', '/login', '/panic', '/acme/dashboard', '/acme/settings/player', '/players', '/download/player', '/boards'])(
    '%s is an operator page',
    (p) => expect(isScreenPath(p)).toBe(false),
  );
});

describe('sentryClientOptions — operator pages keep the legacy client options', () => {
  const o = sentryClientOptions(DSN, '/login');

  it('sets the DSN, sampling and replay exactly as the legacy file did', () => {
    expect(o.dsn).toBe(DSN);
    expect(o.tracesSampleRate).toBe(OPERATOR_TRACES_SAMPLE_RATE);
    expect(o.tracesSampleRate).toBe(0.1);
    expect(o.replaysOnErrorSampleRate).toBe(0);
    expect(o.replaysSessionSampleRate).toBe(0);
    expect(o.environment).toBe(process.env.NODE_ENV);
  });

  it('keeps every default integration (no override)', () => {
    expect(o.integrations).toBeUndefined();
  });

  it('leaves fetch error messages as the browser wrote them', () => {
    expect(o.enhanceFetchErrorMessages).toBe('report-only');
  });

  it('scrubs events, transactions and breadcrumbs', () => {
    const ev = { request: { url: 'https://app.example/setup-account/SECRET?code=1' } };
    expect((o.beforeSend as Hook)(ev)).toEqual({ request: { url: `https://app.example/setup-account/${FILTERED}?${FILTERED}` } });
    const tx = { transaction: '/console/SECRET' };
    expect((o.beforeSendTransaction as Hook)(tx)).toEqual({ transaction: `/console/${FILTERED}` });
    const crumb = (o.beforeBreadcrumb as Hook)({ data: { url: '/x?token=SECRET' } });
    expect(JSON.stringify(crumb)).not.toMatch(/SECRET/);
  });
});

describe('sentryClientOptions — the screen profile', () => {
  const o = sentryClientOptions(DSN, '/player');

  it('drops the session and tracing integrations and nothing else', () => {
    const kept = (o.integrations as unknown as IntegrationsFn)(DEFAULTS).map((i) => i.name);
    for (const n of SCREEN_DROPPED_INTEGRATIONS) expect(kept).not.toContain(n);
    expect(kept).toEqual(DEFAULTS.map((i) => i.name).filter((n) => n !== 'BrowserSession' && n !== 'BrowserTracing'));
    // Error capture stays.
    expect(kept).toEqual(expect.arrayContaining(['GlobalHandlers', 'BrowserApiErrors', 'Breadcrumbs', 'Dedupe', 'LinkedErrors']));
  });

  it('samples no traces and sends no client reports', () => {
    expect(o.tracesSampleRate).toBe(0);
    expect(o.sendClientReports).toBe(false);
    expect(o.enhanceFetchErrorMessages).toBe('report-only');
  });

  it('scrubs the device token out of the screen URL', () => {
    const ev = { request: { url: 'https://app.example/player?token=SECRET', headers: { Referer: 'https://app.example/player?token=SECRET' } } };
    expect(JSON.stringify((o.beforeSend as Hook)(ev))).not.toMatch(/SECRET/);
  });

  it(`sends at most ${SCREEN_EVENT_CAP} events per tab session, across reloads`, () => {
    const send = sentryClientOptions(DSN, '/player').beforeSend as Hook;
    let sent = 0;
    for (let i = 0; i < SCREEN_EVENT_CAP + 5; i++) if (send({ message: `e${i}` }) !== null) sent++;
    expect(sent).toBe(SCREEN_EVENT_CAP);
    expect(window.sessionStorage.getItem(SCREEN_EVENT_COUNT_KEY)).toBe(String(SCREEN_EVENT_CAP));
    // A reload builds fresh options; the stored count still holds.
    const afterReload = sentryClientOptions(DSN, '/player');
    expect((afterReload.beforeSend as Hook)({ message: 'after reload' })).toBeNull();
  });
});

describe('makeScreenEventGate', () => {
  it('counts per document when sessionStorage throws', () => {
    const spyGet = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    const spySet = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    try {
      const admit = makeScreenEventGate(3);
      expect([admit(), admit(), admit(), admit()]).toEqual([true, true, true, false]);
    } finally {
      spyGet.mockRestore();
      spySet.mockRestore();
    }
  });
});
