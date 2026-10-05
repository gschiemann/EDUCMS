import { EmailService } from './email.service';
import { PrismaService } from '../prisma/prisma.service';

// isDeliverableToArbitraryRecipients() only reads process.env.EMAIL_FROM and
// never touches Prisma, so a bare stub is enough to construct the service.
function makeService(): EmailService {
  return new EmailService({} as unknown as PrismaService);
}

describe('EmailService.isDeliverableToArbitraryRecipients', () => {
  const savedFrom = process.env.EMAIL_FROM;

  afterEach(() => {
    if (savedFrom === undefined) delete process.env.EMAIL_FROM;
    else process.env.EMAIL_FROM = savedFrom;
  });

  it('is false when EMAIL_FROM is unset (falls back to the shared Resend sender)', () => {
    delete process.env.EMAIL_FROM;
    expect(makeService().isDeliverableToArbitraryRecipients()).toBe(false);
  });

  it('is false when EMAIL_FROM is blank / whitespace-only', () => {
    process.env.EMAIL_FROM = '   ';
    expect(makeService().isDeliverableToArbitraryRecipients()).toBe(false);
  });

  it('is false for the bare shared onboarding@resend.dev sender', () => {
    process.env.EMAIL_FROM = 'onboarding@resend.dev';
    expect(makeService().isDeliverableToArbitraryRecipients()).toBe(false);
  });

  it('is false for the display-name-wrapped default sender', () => {
    process.env.EMAIL_FROM = 'VenueOS <onboarding@resend.dev>';
    expect(makeService().isDeliverableToArbitraryRecipients()).toBe(false);
  });

  it('is false regardless of case on the shared sender', () => {
    process.env.EMAIL_FROM = 'VenueOS <Onboarding@Resend.Dev>';
    expect(makeService().isDeliverableToArbitraryRecipients()).toBe(false);
  });

  it('is true for a custom verified-domain sender', () => {
    process.env.EMAIL_FROM = 'VenueOS <noreply@venueos.example>';
    expect(makeService().isDeliverableToArbitraryRecipients()).toBe(true);
  });

  it('is true for a bare custom-domain address', () => {
    process.env.EMAIL_FROM = 'noreply@mydistrict.org';
    expect(makeService().isDeliverableToArbitraryRecipients()).toBe(true);
  });
});

// 2026-10-05 — the emailed sign-in code and the "new sign-in" notice.
describe('EmailService — sign-in code + new sign-in notice', () => {
  const saved = {
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    NODE_ENV: process.env.NODE_ENV,
    EMAIL_FROM: process.env.EMAIL_FROM,
  };
  let rows: Array<Record<string, unknown>>;
  let fetchMock: jest.Mock;

  function service(): EmailService {
    rows = [];
    const prisma = {
      client: {
        emailLog: {
          create: jest.fn(async ({ data }: any) => {
            const row = { id: `log-${rows.length + 1}`, ...data };
            rows.push(row);
            return row;
          }),
          update: jest.fn(async ({ where, data }: any) => {
            const row = rows.find((r) => r.id === where.id)!;
            Object.assign(row, data);
            return row;
          }),
        },
      },
    };
    return new EmailService(prisma as unknown as PrismaService);
  }

  beforeEach(() => {
    process.env.RESEND_API_KEY = 're_test_not_real';
    process.env.EMAIL_FROM = 'VenueOS <noreply@venueos.example>';
    fetchMock = jest.fn(async () => ({ ok: true, text: async () => '' }));
    (global as any).fetch = fetchMock;
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    delete (global as any).fetch;
  });

  it('SENDS the code (subject + body, for phone notifications and one-time-code AutoFill) but never STORES it', async () => {
    const svc = service();
    const status = await svc.sendSignInCode({ to: 'owner@venueos.example', code: '482913' });
    expect(status).toBe('SENT');

    const payload = JSON.parse((fetchMock.mock.calls[0] as any[])[1].body);
    expect(payload.to).toEqual(['owner@venueos.example']);
    expect(payload.subject).toBe('482913 is your VenueOS sign-in code');
    expect(payload.text).toContain('482913');
    expect(payload.text).toContain('10 minutes');

    // The durable row — readable by anyone with database access — is redacted.
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('MFA_EMAIL_CODE');
    expect(JSON.stringify(rows[0])).not.toContain('482913');
    expect(rows[0].subject).toBe('•••••• is your VenueOS sign-in code');
    expect(rows[0].status).toBe('SENT');
  });

  it('reports FAILED (instead of pretending) when the provider refuses', async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, status: 422, text: async () => 'bad' }));
    const svc = service();
    await expect(svc.sendSignInCode({ to: 'owner@venueos.example', code: '482913' })).resolves.toBe('FAILED');
    expect(rows[0].status).toBe('FAILED');
  });

  it('"New sign-in to your VenueOS account on <device>" names the device and the time, and carries NO link', async () => {
    const svc = service();
    await svc.sendNewSignInNotice({
      to: 'owner@venueos.example',
      device: 'an iPhone',
      at: new Date('2026-10-05T14:03:00Z'),
    });
    const payload = JSON.parse((fetchMock.mock.calls[0] as any[])[1].body);
    expect(payload.subject).toBe('New sign-in to your VenueOS account on an iPhone');
    expect(payload.text).toContain('2026-10-05 14:03 UTC');
    expect(payload.text).toContain('Forgot password?');
    expect(payload.text).not.toMatch(/https?:\/\//);
    expect(rows[0].kind).toBe('NEW_SIGN_IN');
  });
});
