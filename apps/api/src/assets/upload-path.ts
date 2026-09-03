/**
 * UPLD-02 (2026-09-02, adversarial security re-audit) — the ONE shape
 * `POST /assets/presign` mints, and therefore the only shape
 * `POST /assets/complete-upload` may finalize.
 *
 * `presign` builds `${tenantId}/${randomUUID()}${ext}` — one segment after
 * the tenant prefix, a bare v4 UUID basename, an optional short extension.
 * `complete-upload` used to accept any `storagePath` that merely STARTED
 * with the tenant prefix, which let a caller name an object belonging to a
 * different subsystem in the same bucket (branding logos, exports) and have
 * the finalize path delete it.
 *
 * Pure + exported so it is unit-testable without the Nest DI graph.
 */

/** `<uuid-v4>` exactly as `crypto.randomUUID()` emits it (lowercase hex). */
const UUID_BASENAME =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.[A-Za-z0-9]{1,8})?$/;

/**
 * @param storagePath the client-supplied object key.
 * @param tenantId the AUTHENTICATED caller's tenant (never a body field).
 * @returns true only for a key this API's own presign step could have minted
 *          for this tenant.
 */
export function isMintedUploadPath(storagePath: unknown, tenantId: string): boolean {
  if (typeof storagePath !== 'string' || !storagePath || !tenantId) return false;
  const prefix = `${tenantId}/`;
  if (!storagePath.startsWith(prefix)) return false;
  const rest = storagePath.slice(prefix.length);
  // Exactly one segment — no sub-directories, no traversal, no empty tail.
  if (!rest || rest.includes('/')) return false;
  return UUID_BASENAME.test(rest);
}
