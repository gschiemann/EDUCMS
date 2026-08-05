/**
 * The email honesty gate — pinned across EVERY sender in the API.
 *
 * BUG THIS PINS (2026-08-03): the `SENT_UNVERIFIED` fix originally reached
 * only `EmailService`. `StorageWatchdogService` (storage-outage alerts) and
 * `EfficiencyAlertingService` (egress-cost alerts) each kept their own
 * hand-rolled Resend POST that wrote a confident `status: 'SENT'` on any 2xx
 * — so the two alerts that exist to tell you the PLATFORM IS BROKEN were the
 * ones lying about having been delivered. On the default shared
 * `onboarding@resend.dev` sender, Resend delivers only to the Resend account
 * owner and silently drops every other recipient.
 *
 * 2026-08-05 UPDATE: the duplicate hand-rolled senders are GONE — both
 * services now delegate to the single PlatformAlertMailer (the extraction
 * their comments demanded). These tests therefore drive the gate through
 * that one real send path (stubbed global fetch + Prisma), wire-level FROM
 * included, so a regression back to a hard-coded 'SENT' fails here rather
 * than in production silence.
 */
import { PlatformAlertMailer } from './platform-alert-mailer.service';
import {
  DEFAULT_EMAIL_FROM,
  isDeliverableToArbitraryRecipients,
  resendAcceptedStatus,
  resolveEmailFrom,
} from './sender-identity';

describe('sender-identity (shared honesty gate)', () => {
  const savedFrom = process.env.EMAIL_FROM;
  afterEach(() => {
    if (savedFrom === undefined) delete process.env.EMAIL_FROM;
    else process.env.EMAIL_FROM = savedFrom;
  });

  it('falls back to the shared Resend sender when EMAIL_FROM is unset', () => {
    delete process.env.EMAIL_FROM;
    expect(resolveEmailFrom()).toBe(DEFAULT_EMAIL_FROM);
    expect(isDeliverableToArbitraryRecipients()).toBe(false);
    expect(resendAcceptedStatus()).toBe('SENT_UNVERIFIED');
  });

  it('treats a custom verified domain as genuinely deliverable', () => {
    process.env.EMAIL_FROM = 'VenueOS <noreply@venueos.example>';
    expect(resolveEmailFrom()).toBe('VenueOS <noreply@venueos.example>');
    expect(isDeliverableToArbitraryRecipients()).toBe(true);
    expect(resendAcceptedStatus()).toBe('SENT');
  });

  it('is case-insensitive about the shared sender', () => {
    process.env.EMAIL_FROM = 'VenueOS <Onboarding@Resend.Dev>';
    expect(resendAcceptedStatus()).toBe('SENT_UNVERIFIED');
  });
});

// ── The one platform-alert send path must apply the same gate ──────────────

type Updated = { where: { id: string }; data: Record<string, any> };

function makePrismaStub(updates: Updated[]) {
  return {
    client: {
      emailLog: {
        create: jest.fn(async () => ({ id: 'log-1' })),
        update: jest.fn(async (args: Updated) => {
          updates.push(args);
          return args;
        }),
      },
      user: { findMany: jest.fn(async () => []) },
    },
  } as any;
}

describe('PlatformAlertMailer (storage-outage + egress-cost + platform-health alerts) routes through the honesty gate', () => {
  const build = (prisma: any) => {
    const mailer = new PlatformAlertMailer(prisma);
    return (subject: string, body: string, kind: string) => mailer.sendAlert(subject, body, kind);
  };
  const savedFrom = process.env.EMAIL_FROM;
  const savedKey = process.env.RESEND_API_KEY;
  const savedRecipients = process.env.PLATFORM_ALERT_EMAILS;
  const realFetch = global.fetch;

  beforeEach(() => {
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.PLATFORM_ALERT_EMAILS = 'ops@venueos.example';
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => '',
    })) as any;
  });

  afterEach(() => {
    global.fetch = realFetch;
    if (savedFrom === undefined) delete process.env.EMAIL_FROM;
    else process.env.EMAIL_FROM = savedFrom;
    if (savedKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = savedKey;
    if (savedRecipients === undefined) delete process.env.PLATFORM_ALERT_EMAILS;
    else process.env.PLATFORM_ALERT_EMAILS = savedRecipients;
    jest.restoreAllMocks();
  });

  it('records SENT_UNVERIFIED on the default shared sender (a 2xx is ACCEPTED, not DELIVERED)', async () => {
    delete process.env.EMAIL_FROM;
    const updates: Updated[] = [];
    const send = build(makePrismaStub(updates));

    await send('[VenueOS] alert', 'body', 'TEST_ALERT');

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(updates).toHaveLength(1);
    expect(updates[0].data.status).toBe('SENT_UNVERIFIED');
    // The FROM actually put on the wire is the shared sender.
    const wireBody = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(wireBody.from).toBe(DEFAULT_EMAIL_FROM);
  });

  it('records a confident SENT only once EMAIL_FROM is a verified custom domain', async () => {
    process.env.EMAIL_FROM = 'VenueOS <alerts@venueos.example>';
    const updates: Updated[] = [];
    const send = build(makePrismaStub(updates));

    await send('[VenueOS] alert', 'body', 'TEST_ALERT');

    expect(updates).toHaveLength(1);
    expect(updates[0].data.status).toBe('SENT');
  });

  it('still records FAILED on a Resend non-2xx', async () => {
    process.env.EMAIL_FROM = 'VenueOS <alerts@venueos.example>';
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 422,
      text: async () => 'domain not verified',
    })) as any;
    const updates: Updated[] = [];
    const send = build(makePrismaStub(updates));

    await send('[VenueOS] alert', 'body', 'TEST_ALERT');

    expect(updates).toHaveLength(1);
    expect(updates[0].data.status).toBe('FAILED');
  });
});
