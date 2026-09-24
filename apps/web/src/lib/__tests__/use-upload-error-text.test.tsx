/**
 * useUploadErrorText (2026-09-24) — the one server refusal that is TRANSLATED
 * rather than shown as sent: 413 STORAGE_QUOTA_EXCEEDED, whose body carries the
 * numbers. Every other API refusal keeps passing its own sentence through.
 *
 * The 413 body below is cut from the PRODUCER — `storageQuotaError()` in
 * apps/api/src/assets/storage-quota.service.ts, run for an organisation with
 * 10 paired screens (50 GB included), 49.6 GB stored, and a 0.9 GB upload:
 *   {"status":413,"body":{"code":"STORAGE_QUOTA_EXCEEDED","message":"This file
 *   needs 0.9 GB; 0.4 GB of your 50 GB is left — delete unused media or add
 *   screens.","usedBytes":53257594470,"includedBytes":53687091200,
 *   "neededBytes":966367642}}
 */
import { renderHook } from '@testing-library/react';
import { DirectUploadError } from '@/lib/direct-upload';
import { useUploadErrorText } from '../use-upload-error-text';

const QUOTA_413 = {
  status: 413,
  body: {
    code: 'STORAGE_QUOTA_EXCEEDED',
    message: 'This file needs 0.9 GB; 0.4 GB of your 50 GB is left — delete unused media or add screens.',
    usedBytes: 53257594470,
    includedBytes: 53687091200,
    neededBytes: 966367642,
  },
};

const file = new File(['x'], 'gym.mp4', { type: 'video/mp4' });

/** The error `mapApiError` builds from what api-client throws for that response. */
const quotaError = (message = QUOTA_413.body.message, body: unknown = QUOTA_413.body) =>
  new DirectUploadError('too-large', message, 413, 'api', QUOTA_413.body.code, body);

function text(err: unknown): string {
  const { result } = renderHook(() => useUploadErrorText());
  return result.current(err, file);
}

describe('useUploadErrorText — STORAGE_QUOTA_EXCEEDED', () => {
  it('is translated from the numbers in the body, not passed through', () => {
    // A server sentence the copy would never contain proves the translated path ran.
    expect(text(quotaError('SERVER SENTENCE'))).toBe(
      'This file needs 0.9 GB; 0.4 GB of your 50 GB is left — delete unused media or add screens.',
    );
  });

  it('agrees with the server\'s own sentence to the digit (the same formatter on both sides)', () => {
    expect(text(quotaError())).toBe(QUOTA_413.body.message);
  });

  it('NEGATIVE CONTROL: without the numbers the server sentence is shown as sent', () => {
    const noUsed: Record<string, unknown> = { ...QUOTA_413.body };
    delete noUsed.usedBytes;
    expect(text(quotaError('SERVER SENTENCE', noUsed))).toBe('SERVER SENTENCE');
    expect(text(quotaError('SERVER SENTENCE', null))).toBe('SERVER SENTENCE');
  });

  it('never goes below zero when the organisation is already over', () => {
    const over = { ...QUOTA_413.body, usedBytes: QUOTA_413.body.includedBytes + 5 * 1024 * 1024 * 1024 };
    expect(text(quotaError('x', over))).toBe(
      'This file needs 0.9 GB; 0 MB of your 50 GB is left — delete unused media or add screens.',
    );
  });

  it('any other API refusal still passes its own sentence through', () => {
    const tooLarge = new DirectUploadError(
      'too-large',
      'Video is too large for signage (2.5 GB). Max is 2 GB — …',
      413,
      'api',
      'ASSET_VIDEO_TOO_LARGE',
      { code: 'ASSET_VIDEO_TOO_LARGE' },
    );
    expect(text(tooLarge)).toBe('Video is too large for signage (2.5 GB). Max is 2 GB — …');
  });
});
