/**
 * What an import refusal becomes on the wire.
 *
 * The review page decides whether to offer "Try again" from the HTTP status
 * alone: 503 means the same file can be sent again, anything else means the
 * file itself needs attention. So the status is part of the contract, and the
 * converter's own reason string must never ride along to the browser.
 */
import { HttpException } from '@nestjs/common';
import { ImportJobsController } from './import-jobs.controller';
import { PrepareRejection } from './import-prepare.service';

const req = { user: { tenantId: 'tenant-a', id: 'u1', role: 'SCHOOL_ADMIN' } };
const file = {
  buffer: Buffer.from('%PDF-1.7 stand-in'),
  originalname: 'Flyer.pdf',
} as Express.Multer.File;

async function answerFor(
  failure: unknown,
): Promise<{ status: number; body: unknown }> {
  const prepareSvc = { prepare: jest.fn().mockRejectedValue(failure) };
  const controller = new ImportJobsController(
    {} as never,
    {} as never,
    prepareSvc as never,
    {} as never,
  );
  const err: unknown = await controller.prepare(req, file).then(
    () => null,
    (e: unknown) => e,
  );
  if (!(err instanceof HttpException))
    throw new Error(`expected an HttpException, got ${String(err)}`);
  return { status: err.getStatus(), body: err.getResponse() };
}

describe('ImportJobsController.prepare — refusals on the wire', () => {
  it('answers a busy renderer with 503, the status the review page offers Try again for', async () => {
    const { status, body } = await answerFor(
      new PrepareRejection(
        'IMPORTS_RENDER_BUSY',
        'Busy. Try again in a moment.',
        503,
        'raster-busy',
      ),
    );
    expect(status).toBe(503);
    expect(body).toEqual({
      code: 'IMPORTS_RENDER_BUSY',
      message: 'Busy. Try again in a moment.',
    });
  });

  it('answers a file that is itself the problem with its own 4xx and code', async () => {
    const { status, body } = await answerFor(
      new PrepareRejection(
        'IMPORTS_PDF_PASSWORD_PROTECTED',
        'Protected.',
        422,
        'pdf-password-protected',
      ),
    );
    expect(status).toBe(422);
    expect(body).toEqual({
      code: 'IMPORTS_PDF_PASSWORD_PROTECTED',
      message: 'Protected.',
    });
  });

  it('keeps a refusal without a status of its own at 400', async () => {
    const { status } = await answerFor(
      new PrepareRejection('IMPORTS_LEGACY_PPT', 'Old PowerPoint.'),
    );
    expect(status).toBe(400);
  });

  it('never sends the converter’s own reason', async () => {
    const { body } = await answerFor(
      new PrepareRejection(
        'IMPORTS_RENDER_UNAVAILABLE',
        'Try again.',
        503,
        'browser-launch-failed',
      ),
    );
    expect(JSON.stringify(body)).not.toContain('browser-launch-failed');
  });

  it('hides an unexpected failure behind the general 500', async () => {
    const { status, body } = await answerFor(
      new Error('ECONNRESET at /srv/internal'),
    );
    expect(status).toBe(500);
    expect(body).toEqual({
      code: 'IMPORT_FAILED',
      message:
        'That import could not be completed. Try again, or try a different file.',
    });
  });
});
