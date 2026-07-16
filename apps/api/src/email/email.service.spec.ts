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
