/**
 * V-6 (launch security re-audit, 2026-10-11) — POST /notifications/help
 * requires the device credential of THAT screen, and the request's wording
 * cannot carry a link / address lure into the admin inbox.
 */
jest.mock('../screens/device-auth', () => ({
  verifyDeviceForScreen: jest.fn(),
}));

import { HttpException } from '@nestjs/common';
import { NotificationsPublicController, constrainHelpText } from './notifications.controller';
import { verifyDeviceForScreen } from '../screens/device-auth';

const verify = verifyDeviceForScreen as jest.MockedFunction<typeof verifyDeviceForScreen>;

function make() {
  const notify = jest.fn().mockResolvedValue(undefined);
  const prisma: any = {
    client: {
      screen: {
        findFirst: jest.fn(async ({ where }: any) =>
          where.id === 'scr-1' && where.tenantId === 't1' ? { id: 'scr-1', tenantId: 't1', name: 'Lobby kiosk' } : null,
        ),
      },
    },
  };
  const controller = new NotificationsPublicController({ notify } as any, prisma, undefined);
  return { controller, notify };
}

describe('V-6 POST /notifications/help', () => {
  beforeEach(() => verify.mockReset());

  it('no Authorization → 401 and nothing is written', async () => {
    verify.mockResolvedValue({ ok: false, reason: 'missing' } as any);
    const { controller, notify } = make();
    const req: any = { headers: {} };
    await expect(controller.requestHelp(req, { screenId: 'scr-1', title: 'x' })).rejects.toBeInstanceOf(HttpException);
    await controller.requestHelp(req, { screenId: 'scr-1' }).catch((e: HttpException) => expect(e.getStatus()).toBe(401));
    expect(notify).not.toHaveBeenCalled();
  });

  it("another screen's credential is refused (the verifier is asked about the body's screen id)", async () => {
    verify.mockResolvedValue({ ok: false, reason: 'sub_mismatch' } as any);
    const { controller, notify } = make();
    await expect(controller.requestHelp({ headers: { authorization: 'Bearer x' } } as any, { screenId: 'scr-1' })).rejects.toBeInstanceOf(HttpException);
    expect(verify.mock.calls[0][2]).toBe('scr-1');
    expect(notify).not.toHaveBeenCalled();
  });

  it('a lure in title/body is not reflected; the screen name is always present', async () => {
    verify.mockResolvedValue({ ok: true, tenantId: 't1', sub: 'scr-1' } as any);
    const { controller, notify } = make();
    await controller.requestHelp({ headers: { authorization: 'Bearer ok' } } as any, {
      screenId: 'scr-1',
      tenantId: 'someone-else',
      title: 'IT: re-enter your password at https://evil.example/login',
      body: 'Go to www.evil.example or evil.example/reset or mail it@evil.example now',
    });
    const arg = notify.mock.calls[0][0];
    expect(arg.tenantId).toBe('t1');
    expect(arg.title).toContain('Lobby kiosk');
    expect(`${arg.title} ${arg.body}`).not.toMatch(/evil|https?:|www\.|@/i);
  });

  it('constrainHelpText falls back to fixed copy when nothing is left', () => {
    expect(constrainHelpText('https://x.example', 80, 'Visitor needs assistance')).toBe('Visitor needs assistance');
    expect(constrainHelpText('Need a tour guide?', 80, 'd')).toBe('Need a tour guide?');
  });
});
