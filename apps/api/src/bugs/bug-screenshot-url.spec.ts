/**
 * Bug-report screenshots must never leave the API as a permanent link
 * (2026-10-10). New ones live in a PRIVATE bucket; legacy ones in the public
 * `bug-screenshots` bucket are signed too until the migration script moves them.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SupabaseStorageService } from '../storage/supabase-storage.service';
import {
  BUG_SCREENSHOT_SIGNED_URL_TTL_SECONDS,
  signBugScreenshotUrl,
  type BugScreenshotSigner,
} from './bug-screenshot-url';

const ORIGIN = 'https://proj.supabase.co';

function signer(signed: string | null = 'https://proj.supabase.co/storage/v1/object/sign/x?token=t') {
  const real = Object.create(SupabaseStorageService.prototype) as SupabaseStorageService;
  const createSignedUrl = jest.fn(async () => signed);
  const s: BugScreenshotSigner = {
    parseObjectUrl: (u) => real.parseObjectUrl(u),
    createSignedUrl,
    bugScreenshotBucketName: () => real.bugScreenshotBucketName(),
  };
  return { s, createSignedUrl };
}

describe('signBugScreenshotUrl', () => {
  it('signs a private-bucket screenshot against the private bucket', async () => {
    const { s, createSignedUrl } = signer();
    const out = await signBugScreenshotUrl(
      s,
      `${ORIGIN}/storage/v1/object/bug-screenshots-private/t1/a.png`,
    );
    expect(out).toContain('/object/sign/');
    expect(createSignedUrl).toHaveBeenCalledWith(
      't1/a.png',
      BUG_SCREENSHOT_SIGNED_URL_TTL_SECONDS,
      'bug-screenshots-private',
    );
  });

  it('signs a legacy public screenshot against the legacy bucket', async () => {
    const { s, createSignedUrl } = signer();
    await signBugScreenshotUrl(s, `${ORIGIN}/storage/v1/object/public/bug-screenshots/t1/a.png`);
    expect(createSignedUrl).toHaveBeenCalledWith('t1/a.png', expect.any(Number), 'bug-screenshots');
  });

  it('never returns the stored private URL when signing fails', async () => {
    const { s } = signer(null);
    const out = await signBugScreenshotUrl(
      s,
      `${ORIGIN}/storage/v1/object/bug-screenshots-private/t1/a.png`,
    );
    expect(out).toBeNull();
  });

  it('keeps an (already public) legacy URL when signing fails', async () => {
    const { s } = signer(null);
    const stored = `${ORIGIN}/storage/v1/object/public/bug-screenshots/t1/a.png`;
    expect(await signBugScreenshotUrl(s, stored)).toBe(stored);
  });

  it('refuses to sign any other bucket', async () => {
    const { s, createSignedUrl } = signer();
    const out = await signBugScreenshotUrl(s, `${ORIGIN}/storage/v1/object/floor-plans/t1/plan.png`);
    expect(out).toBeNull();
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('returns null for empty / unparseable values', async () => {
    const { s } = signer();
    expect(await signBugScreenshotUrl(s, null)).toBeNull();
    expect(await signBugScreenshotUrl(s, 'not a url')).toBeNull();
  });
});

describe('bug-screenshot bucket', () => {
  const SOURCE = readFileSync(join(__dirname, '../storage/supabase-storage.service.ts'), 'utf8');
  function bucketCall(fn: 'createBucket' | 'updateBucket'): string {
    const m = SOURCE.match(new RegExp(`storage\\.${fn}\\(BUG_SCREENSHOT_BUCKET,\\s*\\{([\\s\\S]*?)\\}\\)`));
    expect(m).toBeTruthy();
    return m![1];
  }

  it('is created private and re-asserted private on every boot', () => {
    expect(bucketCall('createBucket')).toMatch(/public:\s*false/);
    expect(bucketCall('updateBucket')).toMatch(/public:\s*false/);
  });

  it('is NOT in the public-URL set', () => {
    const m = SOURCE.match(/const PUBLIC_BUCKETS = new Set\(\[([^\]]*)\]\)/);
    expect(m![1]).not.toContain('BUG_SCREENSHOT_BUCKET');
  });

  it('the controller uploads to the private bucket and signs every DTO', () => {
    const ctrl = readFileSync(join(__dirname, 'bugs.controller.ts'), 'utf8');
    expect(ctrl).toContain('this.storage.bugScreenshotBucketName()');
    expect(ctrl).not.toMatch(/object\/public\/\$\{/);
    // every DTO return is wrapped
    expect(ctrl).not.toMatch(/return this\.toDetail\(/);
    expect(ctrl).not.toMatch(/rows\.map\(\(r\) => this\.toListItem\(r\)\);/);
  });
});
