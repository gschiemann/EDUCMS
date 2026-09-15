/**
 * The import-staging bucket must be PRIVATE, and must stay private.
 *
 * WHY THIS FILE EXISTS. An imported original is the operator's source
 * document, not signage — a school deck routinely carries student names,
 * speaker notes and hidden slides that were never meant to reach a display.
 * The `assets` bucket is public and serves inline, and the import pipeline had
 * added the PowerPoint MIME types to it, so an original landed at a
 * world-readable URL. A random object name is not authorization.
 *
 * These assertions are cheap and the regression they guard is silent: a bucket
 * created `public: true`, or an import routed to `upload()` instead of
 * `uploadImportStaging()`, looks completely normal until someone guesses a URL.
 */
import { SupabaseStorageService } from './supabase-storage.service';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE = readFileSync(join(__dirname, 'supabase-storage.service.ts'), 'utf8');

/** Pull the options object of a createBucket/updateBucket call by bucket name. */
function bucketCall(fn: 'createBucket' | 'updateBucket', bucketConst: string): string {
  const re = new RegExp(`storage\\.${fn}\\(${bucketConst},\\s*\\{([\\s\\S]*?)\\}\\)`);
  const m = SOURCE.match(re);
  expect(m).toBeTruthy();
  return m![1];
}

describe('import-staging bucket', () => {
  it('is created private and re-asserted private on every boot', () => {
    // Both calls matter: create protects a fresh project, update corrects a
    // bucket someone flipped public in the Supabase console.
    expect(bucketCall('createBucket', 'IMPORT_STAGING_BUCKET')).toMatch(/public:\s*false/);
    expect(bucketCall('updateBucket', 'IMPORT_STAGING_BUCKET')).toMatch(/public:\s*false/);
  });

  it('is NOT in the public-URL set', () => {
    // PUBLIC_BUCKETS decides the returned URL shape. Listing the staging
    // bucket there would hand out `/object/public/...` links that resolve
    // without a signature — the exact failure this bucket exists to prevent.
    const m = SOURCE.match(/const PUBLIC_BUCKETS = new Set\(\[([^\]]*)\]\)/);
    expect(m).toBeTruthy();
    expect(m![1]).not.toContain('IMPORT_STAGING_BUCKET');
  });

  it('exposes a dedicated upload helper that targets the private bucket', () => {
    const svc = SupabaseStorageService.prototype as unknown as Record<string, unknown>;
    expect(typeof svc.uploadImportStaging).toBe('function');
    expect(typeof svc.importStagingBucketName).toBe('function');
    const body = SOURCE.match(/async uploadImportStaging\([\s\S]*?\n  \}/)![0];
    expect(body).toContain('IMPORT_STAGING_BUCKET');
    expect(body).not.toContain('uploadToBucket(BUCKET');
  });

  it('accepts the import capability contract and nothing wider', () => {
    const m = SOURCE.match(/const IMPORT_STAGING_MIMES = \[([\s\S]*?)\]/);
    expect(m).toBeTruthy();
    const mimes = m![1];
    for (const allowed of [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'image/png', 'image/jpeg', 'image/webp',
    ]) {
      expect(mimes).toContain(allowed);
    }
    // Legacy binary PowerPoint is not a supported source: it is not a ZIP, the
    // parser cannot read it, and accepting it here would re-create the
    // "successful import of an unreadable file" path.
    expect(mimes).not.toContain('application/vnd.ms-powerpoint');
    // A generic binary must never be storable — the import route accepts
    // octet-stream from browsers that mislabel a .pptx, but the server
    // normalises before it writes.
    expect(mimes).not.toContain('application/octet-stream');
    // SVG is a stored-XSS vector wherever bytes are served back to a browser.
    expect(mimes).not.toContain('image/svg+xml');
  });
});
