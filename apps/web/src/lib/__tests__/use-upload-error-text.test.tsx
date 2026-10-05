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
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { renderHook } from '@testing-library/react';
import { DirectUploadError } from '@/lib/direct-upload';
import en from '@/i18n/messages/en.json';
import es from '@/i18n/messages/es.json';
import zh from '@/i18n/messages/zh.json';
import { CONTENT_REFUSAL_KEYS, useUploadErrorText } from '../use-upload-error-text';

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

/**
 * 2026-10-05 — complete-upload refuses a file that is not what its name says, or
 * that a screen cannot play (apps/api/src/assets/upload-content-verdict.ts). Each
 * refusal's code is TRANSLATED; the bodies below are cut from the producer
 * (`refusalFor(...)` → `{ code, message, reason }`, HTTP 422).
 */
describe('useUploadErrorText — the upload content check', () => {
  const refusal = (code: string, serverMessage = 'SERVER SENTENCE') =>
    new DirectUploadError('server', serverMessage, 422, 'api', code, { code, message: serverMessage, reason: 'x' });

  it.each([
    ['ASSET_FILE_EMPTY', 'This file is empty (0 bytes). Export it again and upload the new copy.'],
    ['ASSET_VIDEO_UNPLAYABLE', "This isn't a playable video — the file may be damaged or incomplete. Export it again and upload the new copy."],
    ['ASSET_VIDEO_NO_PICTURE', 'This file has sound but no picture, so a screen would show nothing. Export it again as a video and upload the new copy.'],
    ['ASSET_VIDEO_IS_PICTURE', 'This is a picture saved with a video name. Upload it under its real picture name (for example .jpg or .png).'],
    ['ASSET_IMAGE_UNREADABLE', "This isn't a picture screens can show — it may be damaged or not really an image. Export it as JPG or PNG and upload it again."],
    // 2026-10-05 — a HEIC is converted to JPEG at upload; these are the two ways that can fail.
    ['ASSET_IMAGE_HEIC', "This HEIC photo couldn't be converted. Export it as JPEG and upload it again."],
    ['ASSET_IMAGE_HEIC_UNAVAILABLE', "This HEIC photo couldn't be converted just now. Upload it again in a minute, or export it as JPEG and upload that."],
    ['ASSET_AUDIO_UNPLAYABLE', "This isn't a playable audio file — the file may be damaged or incomplete. Export it again and upload the new copy."],
    ['ASSET_PDF_NOT_PDF', "This isn't a PDF — it may be another kind of file saved with a .pdf name. Save or export it as a PDF again and upload the new copy."],
    ['ASSET_PDF_INCOMPLETE', 'This PDF is incomplete — the file may be damaged or cut short. Save or export it again and upload the new copy.'],
  ])('%s is translated, not passed through', (code, words) => {
    expect(text(refusal(code))).toBe(words);
  });

  it('"this kind of file can\'t be uploaded" is translated with the format lists from the shared table — not the server\'s English (2026-10-05)', () => {
    const sent = "This kind of file can't be uploaded. Upload photos (…), video (…), audio (…) or PDF.";
    const refused = new DirectUploadError('unsupported', sent, 415, 'api', 'ASSET_FILE_TYPE_UNSUPPORTED', { code: 'ASSET_FILE_TYPE_UNSUPPORTED', message: sent });
    const { result } = renderHook(() => useUploadErrorText());
    expect(result.current(refused, new File(['x'], 'clip.flv'))).toBe(
      "clip.flv can't be uploaded. Upload photos (JPG, PNG, WebP, GIF, BMP, ICO, HEIC), video (MP4, M4V, WebM, MOV, AVI, MKV, WMV, MPG, 3GP, TS), audio (MP3, OGG, WAV, M4A) or PDF.",
    );
    const svg = new DirectUploadError('unsupported', 'SERVER', 415, 'api', 'ASSET_SVG_NOT_SUPPORTED', { code: 'ASSET_SVG_NOT_SUPPORTED' });
    expect(result.current(svg, new File(['x'], 'logo.svg'))).toBe(
      "SVG can't be uploaded as content — an SVG can carry hidden scripts. Export it as PNG. For a logo, Settings → Branding takes SVG safely.",
    );
  });

  it('a 0-byte file refused on the page (before any network call) gets the same words', () => {
    expect(text(new DirectUploadError('empty', 'This file is empty.'))).toBe(
      'This file is empty (0 bytes). Export it again and upload the new copy.',
    );
  });

  it('DRIFT GUARD: every refusal code the API can send has words here (read from the producer)', () => {
    const src = readFileSync(resolve(__dirname, '../../../../api/src/assets/upload-content-verdict.ts'), 'utf8');
    const block = src.slice(src.indexOf('export const UPLOAD_REFUSALS'), src.indexOf('export function refusalFor'));
    const codes = new Set(Array.from(block.matchAll(/code: '(ASSET_[A-Z_]+)'/g), (m) => m[1]));
    expect(codes.size).toBeGreaterThanOrEqual(9);
    for (const code of codes) expect(CONTENT_REFUSAL_KEYS[code]).toEqual(expect.any(String));
  });

  it('the words exist in English, Spanish and Chinese — really translated', () => {
    const catalogs = { en, es, zh } as unknown as Record<string, { directUpload: Record<string, string> }>;
    for (const key of Object.values(CONTENT_REFUSAL_KEYS)) {
      for (const lang of ['en', 'es', 'zh']) expect(catalogs[lang].directUpload[key]).toEqual(expect.stringMatching(/\S/));
      expect(catalogs.es.directUpload[key]).not.toBe(catalogs.en.directUpload[key]);
      expect(catalogs.zh.directUpload[key]).not.toBe(catalogs.en.directUpload[key]);
    }
  });
});
