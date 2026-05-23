// SSRF / scheme allowlist for every URL field an operator can set on an
// emergency message (`mediaUrl`, `audioUrl`, each entry of `mediaUrls[]`,
// SOS `voiceClipUrl`). The player fetches these on every paired screen,
// so an admin (legitimate or compromised) without a guard here could paint
// `file:///etc/hosts`, an internal-network URL, or arbitrary attacker content
// onto every wall in the district.
//
// Allowlist: https only, host either (a) the SUPABASE_URL host, (b) a
// generic Supabase storage suffix (*.supabase.co / *.supabase.in), or
// (c) a host explicitly added via the EMERGENCY_MEDIA_ALLOWED_HOSTS env
// var (comma-separated, for a customer-CDN exception).
//
// This is intentionally stricter than the brand-scraper's `safe-fetch.ts`
// (which has to walk arbitrary school websites). Emergency media is always
// a previously-uploaded asset, so the asset host is a tightly bounded set.

import { BadRequestException } from '@nestjs/common';

function deriveSupabaseHost(): string | null {
  try {
    const u = new URL(process.env.SUPABASE_URL || '');
    return u.host || null;
  } catch {
    return null;
  }
}

const SUPABASE_HOST = deriveSupabaseHost();

const ALLOWED_HOSTS = new Set<string>(
  [
    SUPABASE_HOST,
    ...(process.env.EMERGENCY_MEDIA_ALLOWED_HOSTS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  ].filter((h): h is string => !!h),
);

const ALLOWED_HOST_SUFFIXES = ['.supabase.co', '.supabase.in'];

/** True iff the URL is safe to hand to the player as emergency media/audio. */
export function isAllowedEmergencyMediaUrl(raw: string | null | undefined): boolean {
  // null / empty means "no media on this field" — that's fine.
  if (raw == null) return true;
  const s = String(raw).trim();
  if (!s) return true;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  const host = u.host.toLowerCase();
  if (ALLOWED_HOSTS.has(host)) return true;
  if (ALLOWED_HOST_SUFFIXES.some((suf) => host.endsWith(suf))) return true;
  return false;
}

/** Throw 400 INVALID_MEDIA_URL if the URL fails the allowlist. */
export function assertAllowedEmergencyMediaUrl(
  raw: string | null | undefined,
  field: string,
): void {
  if (!isAllowedEmergencyMediaUrl(raw)) {
    throw new BadRequestException({
      code: 'INVALID_MEDIA_URL',
      message: `${field} must be an https:// URL pointing at the tenant's Supabase storage (or a host on EMERGENCY_MEDIA_ALLOWED_HOSTS).`,
    });
  }
}

/** Convenience for array fields like MediaAlert.mediaUrls. */
export function assertAllowedEmergencyMediaUrls(
  urls: ReadonlyArray<string | null | undefined> | null | undefined,
  field: string,
): void {
  if (!urls) return;
  urls.forEach((u, i) => assertAllowedEmergencyMediaUrl(u, `${field}[${i}]`));
}
