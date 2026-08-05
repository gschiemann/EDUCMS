import { PlatformAlertMailer } from './platform-alert-mailer.service';

/**
 * PlatformAlertMailer — regression locks.
 *
 * Recipient routing carries the 2026-07-16 incident contract (moved here from
 * efficiency-alerting.spec.ts when the mailer was extracted): an "Egress
 * anomaly" email landed in the operator's WORK inbox because his work-email
 * TEST user carries SUPER_ADMIN. PLATFORM_ALERT_EMAILS routes exclusively;
 * the SUPER_ADMIN sweep survives only as the unset-env fallback.
 *
 * New contracts introduced by the extraction (both exist because this mailer
 * now carries the "database is down" alert):
 *  - recipient cache: a DB outage with the env unset uses the last-good list
 *  - persist-then-send: a failed emailLog write must NOT eat the send
 */

function makeMailer(overrides?: { findMany?: jest.Mock; create?: jest.Mock; update?: jest.Mock }) {
  const findMany = overrides?.findMany ?? jest.fn();
  const create = overrides?.create ?? jest.fn(async (args: any) => ({ id: 'log-1', ...args.data }));
  const update = overrides?.update ?? jest.fn(async () => ({}));
  const prisma = {
    client: {
      user: { findMany },
      emailLog: { create, update },
    },
  } as any;
  return { mailer: new PlatformAlertMailer(prisma), findMany, create, update };
}

describe('PlatformAlertMailer — recipient routing', () => {
  beforeEach(() => {
    delete process.env.PLATFORM_ALERT_EMAILS;
    delete process.env.RESEND_API_KEY; // no real sends — logs only
  });

  it('PLATFORM_ALERT_EMAILS routes alerts ONLY to the configured owner inbox(es)', async () => {
    process.env.PLATFORM_ALERT_EMAILS = 'owner@personal.test, ops@personal.test';
    const { mailer, findMany } = makeMailer();

    const recipients = await mailer.resolveAlertRecipients();
    expect(recipients).toEqual(['owner@personal.test', 'ops@personal.test']);
    // The SUPER_ADMIN sweep must not even be queried — a test user holding
    // SUPER_ADMIN (the 2026-07-16 work-inbox leak) can never receive one.
    expect(findMany).not.toHaveBeenCalled();
  });

  it('falls back to the SUPER_ADMIN sweep when the env is unset (no silent alert loss)', async () => {
    const { mailer, findMany } = makeMailer();
    findMany.mockResolvedValue([{ email: 'admin-a@x.test' }, { email: 'work-test-user@corp.test' }]);

    const recipients = await mailer.resolveAlertRecipients();
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(recipients).toEqual(['admin-a@x.test', 'work-test-user@corp.test']);
  });

  it('junk env values (no @) are ignored → fallback still works', async () => {
    process.env.PLATFORM_ALERT_EMAILS = 'not-an-email, ,';
    const { mailer, findMany } = makeMailer();
    findMany.mockResolvedValue([{ email: 'admin-a@x.test' }]);

    const recipients = await mailer.resolveAlertRecipients();
    expect(recipients).toEqual(['admin-a@x.test']);
  });

  it('DB outage with env unset → uses the last-good cached list (the DB-down alert must route)', async () => {
    const { mailer, findMany } = makeMailer();
    findMany.mockResolvedValueOnce([{ email: 'admin-a@x.test' }]);
    await mailer.resolveAlertRecipients(); // primes the cache

    findMany.mockRejectedValueOnce(new Error('connection refused'));
    const recipients = await mailer.resolveAlertRecipients();
    expect(recipients).toEqual(['admin-a@x.test']);
  });

  it('DB outage with NO cache and env unset → empty (documented: set PLATFORM_ALERT_EMAILS)', async () => {
    const { mailer, findMany } = makeMailer();
    findMany.mockRejectedValueOnce(new Error('connection refused'));
    expect(await mailer.resolveAlertRecipients()).toEqual([]);
  });
});

describe('PlatformAlertMailer — sendAlert', () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    delete process.env.PLATFORM_ALERT_EMAILS;
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  it('logs one email per configured recipient (and never queries users)', async () => {
    process.env.PLATFORM_ALERT_EMAILS = 'owner@personal.test';
    const { mailer, findMany, create } = makeMailer();

    await mailer.sendAlert('[VenueOS] test subject', 'body', 'EFFICIENCY_ANOMALY_ALERT');

    expect(findMany).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].data.toEmail).toBe('owner@personal.test');
  });

  it('a failed emailLog persist does NOT eat the send (DB-down alert survives)', async () => {
    process.env.PLATFORM_ALERT_EMAILS = 'owner@personal.test';
    process.env.RESEND_API_KEY = 're_test_key';
    const fetchMock = jest.fn(async () => ({ ok: true, text: async () => '' })) as any;
    global.fetch = fetchMock;

    const create = jest.fn(async () => {
      throw new Error('database unreachable');
    });
    const { mailer } = makeMailer({ create });

    await mailer.sendAlert('[VenueOS] DB down', 'body', 'PLATFORM_HEALTH_ALERT');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload.to).toEqual(['owner@personal.test']);
  });

  it('honesty gate: shared onboarding@resend.dev sender → SENT_UNVERIFIED, never SENT', async () => {
    process.env.PLATFORM_ALERT_EMAILS = 'owner@personal.test';
    process.env.RESEND_API_KEY = 're_test_key';
    // EMAIL_FROM unset → shared sender fallback.
    global.fetch = jest.fn(async () => ({ ok: true, text: async () => '' })) as any;

    const { mailer, update } = makeMailer();
    await mailer.sendAlert('[VenueOS] test', 'body', 'PLATFORM_HEALTH_ALERT');

    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0].data.status).toBe('SENT_UNVERIFIED');
  });

  it('verified custom sender → confident SENT', async () => {
    process.env.PLATFORM_ALERT_EMAILS = 'owner@personal.test';
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.EMAIL_FROM = 'VenueOS <alerts@venueos.example>';
    global.fetch = jest.fn(async () => ({ ok: true, text: async () => '' })) as any;

    const { mailer, update } = makeMailer();
    await mailer.sendAlert('[VenueOS] test', 'body', 'PLATFORM_HEALTH_ALERT');

    expect(update.mock.calls[0][0].data.status).toBe('SENT');
  });

  it('Resend non-2xx → row marked FAILED with the status captured', async () => {
    process.env.PLATFORM_ALERT_EMAILS = 'owner@personal.test';
    process.env.RESEND_API_KEY = 're_test_key';
    global.fetch = jest.fn(async () => ({ ok: false, status: 422, text: async () => 'bad payload' })) as any;

    const { mailer, update } = makeMailer();
    await mailer.sendAlert('[VenueOS] test', 'body', 'PLATFORM_HEALTH_ALERT');

    expect(update.mock.calls[0][0].data.status).toBe('FAILED');
    expect(update.mock.calls[0][0].data.error).toContain('422');
  });
});
