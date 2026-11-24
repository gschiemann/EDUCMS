import {
  DELIVERY_RECHECK_MS,
  EmailService,
  deliveryStatusFromEvent,
  escapeHtml,
  inviteHtml,
} from './email.service';
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

// 2026-10-11 - customer-facing mail must read like an established company:
// no internal links, no dev/AI vocabulary, friendly role names.
describe('EmailService - customer-facing copy', () => {
  const saved = {
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EMAIL_FROM: process.env.EMAIL_FROM,
    APP_PUBLIC_URL: process.env.APP_PUBLIC_URL,
  };
  let fetchMock: jest.Mock;

  function service(): EmailService {
    const prisma = {
      client: {
        emailLog: {
          create: jest.fn(async ({ data }: any) => ({ id: 'log-1', ...data })),
          update: jest.fn(async () => ({})),
        },
      },
    };
    return new EmailService(prisma as unknown as PrismaService);
  }
  const sent = () => JSON.parse((fetchMock.mock.calls[0] as any[])[1].body) as { subject: string; text: string };

  beforeEach(() => {
    process.env.RESEND_API_KEY = 're_test_not_real';
    process.env.EMAIL_FROM = 'VenueOS <noreply@venueos.example>';
    process.env.APP_PUBLIC_URL = 'https://app.example.test';
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

  const INTERNAL = /\/super\b|diff|pull request|\bPR\b|\bCI\b|approve|confidence|automated|Claude|\bAI\b/i;

  it('bug received: a plain thank-you with the ref, and nothing internal', async () => {
    await service().sendBugFiled({
      to: 'a@b.test', bugId: 'abcdef12-0000', description: 'The page is blank', pathname: '/x', tenantSlug: 'acme',
    });
    const { subject, text } = sent();
    expect(text).toContain('we received your report (ref #abcdef12) and our team is on it');
    expect(text).toContain('The page is blank');
    expect(subject + text).not.toMatch(INTERNAL);
    expect(text).not.toContain('app.example.test');
  });

  it('bug fixed: says it is fixed, no PR link or internal vocabulary', async () => {
    await service().sendBugFixShipped({
      to: 'a@b.test', bugId: 'abcdef12-0000', description: 'The page is blank', prUrl: 'https://example.test/pull/1',
    });
    const { subject, text } = sent();
    expect(subject).toContain("it's fixed");
    expect(text).not.toContain('example.test/pull');
    expect(subject + text).not.toMatch(INTERNAL);
  });

  it('invite shows a friendly role, not the enum', async () => {
    await service().sendUserInvite({
      to: 'a@b.test', inviterEmail: 'boss@b.test', tenantName: 'Acme', role: 'SCHOOL_ADMIN', inviteToken: 't',
    });
    const { text } = sent();
    expect(text).toContain('as Admin.');
    expect(text).not.toContain('SCHOOL_ADMIN');
  });

  it('welcome does not print the tenant slug', async () => {
    await service().sendWelcome({ to: 'a@b.test', districtName: 'Acme', tenantSlug: 'acme-secret-slug' });
    const { text } = sent();
    expect(text).not.toMatch(/slug/i);
    expect(text).not.toContain('acme-secret-slug');
  });
});

// 2026-11-23 — a customer alert email (the emergency record copy now states
// the screen's local time): the durable email_logs row holds EXACTLY what was
// sent — it is not a redacted kind.
describe('EmailService.sendCustomerAlert — the email_logs row is the email as sent', () => {
  const saved = { RESEND_API_KEY: process.env.RESEND_API_KEY, EMAIL_FROM: process.env.EMAIL_FROM };
  let fetchMock: jest.Mock;
  let create: jest.Mock;

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

  it.each([
    ['ALERT_EMERGENCY', 'VenueOS: Lockdown drill started at Lincoln Elementary', 'Time: Mon, Nov 23, 2026, 2:41 PM CST'],
    ['ALERT_ALL_CLEAR', 'VenueOS: Simulacro terminado en Lincoln Elementary', 'Hora: lun, 23 nov 2026, 14:41 hora estándar central'],
    ['ALERT_EMERGENCY', 'VenueOS：Lincoln Elementary 已开始封锁演练', '时间: 2026年11月23日周一 北美中部标准时间下午2:41'],
  ])('%s: subject and body in the row equal the dispatched message', async (kind, subject, timeLine) => {
    create = jest.fn(async ({ data }: any) => ({ id: 'log-1', ...data }));
    const prisma = { client: { emailLog: { create, update: jest.fn(async () => ({})) } } };
    const body = `A record copy.\n\n${timeLine}\n\n— The VenueOS team`;
    await new EmailService(prisma as unknown as PrismaService).sendCustomerAlert({ to: 'principal@example.org', subject, body, kind });
    const sent = JSON.parse((fetchMock.mock.calls[0] as any[])[1].body) as { subject: string; text: string };
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].data).toMatchObject({ toEmail: 'principal@example.org', kind, subject: sent.subject, body: sent.text });
    expect(sent.text).toBe(body);
    expect(sent.subject).toBe(subject);
  });
});

// The durable email_logs row never holds a usable one-time link token.
describe('EmailService — one-time link tokens are redacted in email_logs', () => {
  const saved = {
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EMAIL_FROM: process.env.EMAIL_FROM,
    APP_PUBLIC_URL: process.env.APP_PUBLIC_URL,
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
  const sent = () => JSON.parse((fetchMock.mock.calls[0] as any[])[1].body) as { subject: string; text: string };

  beforeEach(() => {
    process.env.RESEND_API_KEY = 're_test_not_real';
    process.env.EMAIL_FROM = 'VenueOS <noreply@venueos.example>';
    process.env.APP_PUBLIC_URL = 'https://app.example.test';
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

  it('password reset: sends the real link, stores the link with the token redacted', async () => {
    await service().sendPasswordReset({ to: 'a@b.test', resetToken: 'reset-tok-1234567890' });
    expect(sent().text).toContain('/reset-password/reset-tok-1234567890');
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('PASSWORD_RESET');
    expect(JSON.stringify(rows[0])).not.toContain('reset-tok-1234567890');
    expect(rows[0].body).toContain('/reset-password/[redacted]');
  });

  it('invite: sends the real link, stores the link with the token redacted', async () => {
    await service().sendUserInvite({
      to: 'a@b.test', inviterEmail: 'boss@b.test', tenantName: 'Acme', role: 'SCHOOL_ADMIN', inviteToken: 'invite-tok-0987654321',
    });
    expect(sent().text).toContain('/accept-invite/invite-tok-0987654321');
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('INVITE');
    expect(JSON.stringify(rows[0])).not.toContain('invite-tok-0987654321');
    expect(rows[0].body).toContain('/accept-invite/[redacted]');
  });
});

// 2026-11-18 - two invitations were recorded SENT, reached the recipients'
// mail server and were never seen. The subject carried the inviter's address,
// the mail was text only, and nothing recorded what the provider reported.
describe('EmailService - invitation shape and delivery state', () => {
  const saved = {
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EMAIL_FROM: process.env.EMAIL_FROM,
    APP_PUBLIC_URL: process.env.APP_PUBLIC_URL,
  };
  let rows: Array<Record<string, any>>;
  let fetchMock: jest.Mock;
  let lastEvent: string | null;
  let lookupOk: boolean;

  function service(): EmailService {
    const prisma = {
      client: {
        emailLog: {
          create: jest.fn(async ({ data }: any) => {
            const row = { id: `log-${rows.length + 1}`, createdAt: new Date(), ...data };
            rows.push(row);
            return row;
          }),
          update: jest.fn(async ({ where, data }: any) => {
            const row = rows.find((r) => r.id === where.id)!;
            Object.assign(row, data);
            return row;
          }),
          findFirst: jest.fn(async ({ where }: any) => {
            const hits = rows
              .filter((r) => r.toEmail === where.toEmail && r.kind === where.kind && r.createdAt >= where.createdAt.gte)
              .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
            return hits[0] ?? null;
          }),
        },
      },
    };
    return new EmailService(prisma as unknown as PrismaService);
  }
  const posts = () => fetchMock.mock.calls.filter((c: any[]) => (c[1]?.method ?? 'GET') === 'POST');
  const gets = () => fetchMock.mock.calls.filter((c: any[]) => (c[1]?.method ?? 'GET') === 'GET');
  const sent = () => JSON.parse(posts()[0][1].body) as { subject: string; text: string; html?: string };
  const invite = (over: Record<string, unknown> = {}) => ({
    to: 'new.person@corp.test', inviterEmail: 'boss@corp.test', tenantName: 'Acme Houston',
    role: 'CONTRIBUTOR', inviteToken: 'invite-tok-0987654321', ...over,
  });

  beforeEach(() => {
    rows = [];
    lastEvent = 'delivered';
    lookupOk = true;
    process.env.RESEND_API_KEY = 're_test_not_real';
    process.env.EMAIL_FROM = 'VenueOS <noreply@venueos.example>';
    process.env.APP_PUBLIC_URL = 'https://app.example.test';
    fetchMock = jest.fn(async (url: string, init?: any) => {
      if ((init?.method ?? 'GET') === 'POST') {
        return { ok: true, text: async () => '', json: async () => ({ id: 'prov-1' }) };
      }
      if (!lookupOk) return { ok: false, status: 500, text: async () => 'boom', json: async () => ({}) };
      // The provider's answer also carries the body, link included.
      return { ok: true, json: async () => ({ id: 'prov-1', last_event: lastEvent, text: 'https://app.example.test/accept-invite/invite-tok-0987654321' }) };
    });
    (global as any).fetch = fetchMock;
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    delete (global as any).fetch;
    jest.useRealTimers();
  });

  it('the subject names the workspace and never carries the inviter address', async () => {
    await service().sendUserInvite(invite() as any);
    expect(sent().subject).toBe("You're invited to Acme Houston on VenueOS");
    expect(sent().subject).not.toContain('@');
    expect(rows[0].subject).not.toContain('@');
  });

  it('the body names the inviter by name when the account has one, by address otherwise', async () => {
    await service().sendUserInvite(invite({ inviterName: 'Pat Jones' }) as any);
    expect(sent().text).toContain('Pat Jones invited you to join Acme Houston on VenueOS as Editor.');
    expect(sent().text).not.toContain('boss@corp.test');
    fetchMock.mockClear();
    await service().sendUserInvite(invite({ inviterName: '   ' }) as any);
    expect(sent().text).toContain('boss@corp.test invited you to join Acme Houston');
  });

  it('sends an HTML part beside the text, with the same link, and keeps neither it nor the token in the log row', async () => {
    await service().sendUserInvite(invite() as any);
    const { html, text } = sent();
    expect(text).toContain('https://app.example.test/accept-invite/invite-tok-0987654321');
    expect(html).toContain('href="https://app.example.test/accept-invite/invite-tok-0987654321"');
    expect(html).toContain('Accept invitation');
    expect(html).not.toMatch(/<img|<script|http:\/\//i);
    expect(JSON.stringify(rows[0])).not.toContain('invite-tok-0987654321');
    expect(JSON.stringify(rows[0])).not.toContain('<html');
    expect(rows[0].body).toContain('/accept-invite/[redacted]');
  });

  it('a name typed by a person cannot inject markup into the HTML part or a second line into the subject', async () => {
    await service().sendUserInvite(invite({
      tenantName: 'Acme <img src=x onerror=alert(1)>\r\nBcc: evil@x.test',
      inviterName: '"><script>alert(1)</script>',
    }) as any);
    const { html, subject } = sent();
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
    expect(subject).not.toMatch(/[\r\n]/);
    expect(subject).toBe("You're invited to Acme <img src=x onerror=alert(1)> Bcc: evil@x.test on VenueOS");
  });

  it('escapeHtml escapes the five characters that matter in text and in an attribute', () => {
    expect(escapeHtml(`a&b<c>d"e'f`)).toBe('a&amp;b&lt;c&gt;d&quot;e&#39;f');
    expect(inviteHtml({ who: 'A', tenantName: 'B', role: 'C', url: 'https://x.test/a?b=1&c="2"' }))
      .toContain('href="https://x.test/a?b=1&amp;c=&quot;2&quot;"');
  });

  it('other mail stays text only', async () => {
    await service().sendPasswordReset({ to: 'a@b.test', resetToken: 'reset-tok' });
    expect(sent().html).toBeUndefined();
  });

  it("stores the provider's id for the message, and survives an answer that has none", async () => {
    await service().sendUserInvite(invite() as any);
    expect(rows[0].status).toBe('SENT');
    expect(rows[0].providerId).toBe('prov-1');
    fetchMock.mockImplementationOnce(async () => ({ ok: true, text: async () => '' }));
    await service().sendUserInvite(invite({ to: 'second@corp.test' }) as any);
    expect(rows[1].status).toBe('SENT');
    expect(rows[1].providerId).toBeUndefined();
  });

  it('maps the provider events to our words', () => {
    expect(deliveryStatusFromEvent('delivered')).toBe('delivered');
    expect(deliveryStatusFromEvent('opened')).toBe('delivered');
    expect(deliveryStatusFromEvent('clicked')).toBe('delivered');
    expect(deliveryStatusFromEvent('bounced')).toBe('bounced');
    expect(deliveryStatusFromEvent('suppressed')).toBe('bounced');
    expect(deliveryStatusFromEvent('delivery_delayed')).toBe('delayed');
    expect(deliveryStatusFromEvent('complained')).toBe('complained');
    expect(deliveryStatusFromEvent('failed')).toBe('failed');
    expect(deliveryStatusFromEvent('sent')).toBe('sent');
    expect(deliveryStatusFromEvent('something_new')).toBeNull();
    expect(deliveryStatusFromEvent(undefined)).toBeNull();
  });

  it('reads the delivery state once, stores it, and never asks again once it is final', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-18T17:25:00Z') });
    const svc = service();
    const since = new Date();
    await svc.sendUserInvite(invite() as any);
    const first = await svc.inviteDelivery({ to: 'new.person@corp.test', since });
    expect(first.status).toBe('delivered');
    expect(first.checkedAt).toBeInstanceOf(Date);
    expect(rows[0].deliveryStatus).toBe('delivered');
    expect(gets()).toHaveLength(1);
    expect(gets()[0][0]).toBe('https://api.resend.com/emails/prov-1');
    const second = await svc.inviteDelivery({ to: 'new.person@corp.test', since });
    expect(second.status).toBe('delivered');
    expect(gets()).toHaveLength(1);
    // long after the re-check window: a final state is still not asked for again
    jest.setSystemTime(new Date(Date.now() + 10 * DELIVERY_RECHECK_MS));
    lastEvent = 'bounced';
    expect((await svc.inviteDelivery({ to: 'new.person@corp.test', since })).status).toBe('delivered');
    expect(gets()).toHaveLength(1);
    // the provider's answer held the live link: it is not kept anywhere
    expect(JSON.stringify(rows)).not.toContain('invite-tok-0987654321');
  });

  it('a state that can still move is re-read, but not more than once per window', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-18T17:25:00Z') });
    const svc = service();
    const since = new Date();
    await svc.sendUserInvite(invite() as any);
    lastEvent = 'sent';
    expect((await svc.inviteDelivery({ to: 'new.person@corp.test', since })).status).toBe('sent');
    expect((await svc.inviteDelivery({ to: 'new.person@corp.test', since })).status).toBe('sent');
    expect(gets()).toHaveLength(1);
    jest.setSystemTime(new Date(Date.now() + DELIVERY_RECHECK_MS));
    lastEvent = 'bounced';
    expect((await svc.inviteDelivery({ to: 'new.person@corp.test', since })).status).toBe('bounced');
    expect(gets()).toHaveLength(2);
  });

  it('refresh:false returns what is stored and never asks the provider', async () => {
    const svc = service();
    const since = new Date();
    await svc.sendUserInvite(invite() as any);
    const res = await svc.inviteDelivery({ to: 'new.person@corp.test', since, refresh: false });
    expect(res.status).toBe('unknown');
    expect(gets()).toHaveLength(0);
  });

  it('a lookup that fails, throws or returns an unknown event leaves the stored state alone', async () => {
    const svc = service();
    const since = new Date();
    await svc.sendUserInvite(invite() as any);
    lookupOk = false;
    expect((await svc.inviteDelivery({ to: 'new.person@corp.test', since })).status).toBe('unknown');
    lookupOk = true;
    lastEvent = 'something_new';
    expect((await svc.inviteDelivery({ to: 'new.person@corp.test', since })).status).toBe('unknown');
    fetchMock.mockImplementationOnce(async () => { throw new Error('network down'); });
    expect((await svc.inviteDelivery({ to: 'new.person@corp.test', since })).status).toBe('unknown');
    expect(rows[0].deliveryStatus).toBeUndefined();
  });

  it('a row the provider never accepted is not_sent, and a row without a provider id is never looked up', async () => {
    const svc = service();
    const since = new Date(Date.now() - 1000);
    rows.push({ id: 'log-a', toEmail: 'refused@corp.test', kind: 'INVITE', status: 'FAILED', createdAt: new Date() });
    rows.push({ id: 'log-b', toEmail: 'old@corp.test', kind: 'INVITE', status: 'SENT', sentAt: new Date(), createdAt: new Date() });
    expect((await svc.inviteDelivery({ to: 'refused@corp.test', since })).status).toBe('not_sent');
    expect((await svc.inviteDelivery({ to: 'old@corp.test', since })).status).toBe('unknown');
    expect((await svc.inviteDelivery({ to: 'nobody@corp.test', since })).status).toBe('unknown');
    expect(gets()).toHaveLength(0);
  });

  it('only a mail written at or after the invitation counts, and only an INVITE', async () => {
    const svc = service();
    rows.push({ id: 'log-old', toEmail: 'p@corp.test', kind: 'INVITE', status: 'SENT', providerId: 'prov-old', deliveryStatus: 'bounced', createdAt: new Date(Date.now() - 3_600_000) });
    rows.push({ id: 'log-code', toEmail: 'p@corp.test', kind: 'MFA_EMAIL_CODE', status: 'SENT', providerId: 'prov-code', deliveryStatus: 'delivered', createdAt: new Date() });
    expect((await svc.inviteDelivery({ to: 'p@corp.test', since: new Date() })).status).toBe('unknown');
    expect(gets()).toHaveLength(0);
  });
});
