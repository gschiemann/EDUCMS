import { apkVersionFromUserAgent } from './nativeBridge';

/** Eligibility for a READ-ONLY source refresh, never permission to play.
 * .64 added authenticated store-to-session enrolment discovery. Older APKs
 * retain their existing path; the app still decides enrolment from its own
 * authenticated manifest, not this page's copy. */
export function nativeStoreDiscoveryAllowed(input: {
  manifest: unknown;
  screenId: string;
  userAgent: string;
  holdRaised: boolean;
  mediaAlreadyAvailable: boolean;
}): boolean {
  if (input.holdRaised || input.mediaAlreadyAvailable) return false;
  const version = apkVersionFromUserAgent(input.userAgent);
  if (!version || version.some(n => !Number.isSafeInteger(n)) ||
    (version[0] < 1 || (version[0] === 1 && (version[1] < 1 || (version[1] === 1 && version[2] < 64))))) return false;
  if (!input.manifest || typeof input.manifest !== 'object' || Array.isArray(input.manifest)) return false;
  const m = input.manifest as Record<string, unknown>;
  if (!m.nativeVideo || typeof m.nativeVideo !== 'object' || Array.isArray(m.nativeVideo)) return false;
  const d = m.nativeVideo as Record<string, unknown>;
  const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
  return !!m && m.isEmergency === false && m.screenId === input.screenId &&
    uuid.test(input.screenId) && typeof m.tenantId === 'string' && uuid.test(m.tenantId) &&
    !!d && d.screenId === input.screenId && d.tenantId === m.tenantId &&
    (d.faceIndex === 0 || d.faceIndex === 1) && d.nativeFirst === true && d.store === true;
}
