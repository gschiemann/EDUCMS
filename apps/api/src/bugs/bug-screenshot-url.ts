/**
 * Bug-report screenshots are served ONLY as short-TTL signed URLs
 * (2026-10-10). A screenshot is a capture of an operator's dashboard —
 * customer names, screen lists, school data — so a permanent public link is
 * not acceptable. New screenshots live in the PRIVATE `bug-screenshots-private`
 * bucket; screenshots taken before that still sit in the legacy PUBLIC
 * `bug-screenshots` bucket until `scripts/migrate-bug-screenshots-private.ts`
 * moves them. Both are signed on read: the stored URL never leaves the API.
 */
import { LEGACY_BUG_SCREENSHOT_BUCKET } from '../storage/supabase-storage.service';

/** Long enough to look at a bug report; short enough that a pasted link dies. */
export const BUG_SCREENSHOT_SIGNED_URL_TTL_SECONDS = 30 * 60;

export interface BugScreenshotSigner {
  parseObjectUrl(objectUrl: string): { bucket: string; path: string } | null;
  createSignedUrl(filePath: string, expiresInSeconds?: number, bucket?: string): Promise<string | null>;
  bugScreenshotBucketName(): string;
}

/**
 * Turn the STORED screenshot URL into something a browser may open.
 *  - private bucket  → signed URL, or null when signing fails (the stored
 *    `/object/<bucket>/…` URL cannot be opened anyway, and must not be shown);
 *  - legacy public   → signed URL, falling back to the stored URL on a signing
 *    failure (it is already public until migrated; hiding it only loses
 *    evidence);
 *  - anything else   → null. We only sign the buckets that exist for this
 *    purpose, so a row can never be used to mint a signature for an
 *    unrelated object.
 */
export async function signBugScreenshotUrl(
  storage: BugScreenshotSigner,
  storedUrl: string | null | undefined,
): Promise<string | null> {
  if (!storedUrl) return null;
  const parsed = storage.parseObjectUrl(storedUrl);
  if (!parsed) return null;
  const privateBucket = storage.bugScreenshotBucketName();
  if (parsed.bucket !== privateBucket && parsed.bucket !== LEGACY_BUG_SCREENSHOT_BUCKET) {
    return null;
  }
  const signed = await storage.createSignedUrl(
    parsed.path,
    BUG_SCREENSHOT_SIGNED_URL_TTL_SECONDS,
    parsed.bucket,
  );
  if (signed) return signed;
  return parsed.bucket === LEGACY_BUG_SCREENSHOT_BUCKET ? storedUrl : null;
}
