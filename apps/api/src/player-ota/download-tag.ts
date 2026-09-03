/**
 * download-tag.ts — per-download screen attribution for the APK endpoints.
 *
 * WHY THIS EXISTS. `/apk/v/:vc` is the one OTA request that carries no
 * identity at all: `OtaUpdateWorker.dlConn`, Manager's `OtaWorker.download`,
 * `ManagerSelfUpdateWorker.download` and `ManagerBootstrap.download` each
 * open a bare `HttpURLConnection` with nothing but timeouts on it. The
 * device token rides the `/update-check` POST and stops there. So when the
 * lead asks "which screens are being served by the redirect and which are
 * still on the proxy", the download log has nothing to answer with.
 *
 * `/update-check` DOES know the screen. So it stamps a tag onto the
 * download URL it advertises, and the download endpoint reads it back. The
 * whole installed fleet gets this today, with no APK change: the Kotlin
 * workers use `apkUrl` verbatim and `HostAllowlist` inspects the host only.
 *
 * ============================================================
 * THIS IS TELEMETRY. IT IS NOT AUTHORIZATION.
 * ============================================================
 *
 * The tag is HMAC-signed so a passer-by cannot poison the log with a screen
 * id that never downloaded anything, and it is domain-separated from every
 * other use of DEVICE_SECRET_KEY. That is the ONLY property it has. It is
 * not short-lived, it is not bound to a device credential, and anyone who
 * observes one URL can replay it.
 *
 * So: NEVER let a verified tag decide whether a download is allowed, which
 * bytes are served, or anything else with an effect. If `/apk/v/:vc` is
 * ever gated on identity, it must be gated on the DEVICE TOKEN — which
 * means first shipping a build whose downloader sends one, then waiting for
 * the fleet floor to include it (the same staging rule CLAUDE.md player
 * rule 9 applies to new bridge methods). A missing or bad tag must always
 * mean "log a dash", never "refuse".
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** Query parameter carrying the tag. Optional on every route that reads it. */
export const DOWNLOAD_TAG_PARAM = 'dl';

const HMAC_HEX_LENGTH = 16;

function secret(env: NodeJS.ProcessEnv): string {
  // Same secret the device-credential chain uses, DOMAIN-SEPARATED below so
  // a tag can never be confused for (or forged from) a device token.
  return (env.DEVICE_SECRET_KEY || '').trim();
}

function mac(screenId: string, versionCode: number, env: NodeJS.ProcessEnv): string {
  return createHmac('sha256', secret(env))
    .update(`apk-download-tag:v1:${screenId}:${versionCode}`)
    .digest('hex')
    .slice(0, HMAC_HEX_LENGTH);
}

/**
 * Build the tag `/update-check` appends to the advertised download URL.
 * Returns null when there is nothing to attribute (no screen resolved, no
 * secret configured) — the URL is then advertised exactly as it is today.
 */
export function signDownloadTag(
  screenId: string | null | undefined,
  versionCode: number,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const id = (screenId || '').trim();
  if (!id || !secret(env)) return null;
  // Screen ids are opaque cuids from our own schema, but keep the tag
  // URL-safe rather than trusting that.
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
  return `${id}.${mac(id, versionCode, env)}`;
}

/**
 * Read a tag back on the download request. Returns the screen id only when
 * the signature checks out; '' for anything else (absent, malformed,
 * forged, wrong versionCode, no secret). Never throws.
 */
export function verifyDownloadTag(
  rawTag: unknown,
  versionCode: number,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (typeof rawTag !== 'string' || !rawTag || !secret(env)) return '';
  const dot = rawTag.lastIndexOf('.');
  if (dot <= 0) return '';
  const id = rawTag.slice(0, dot);
  const given = rawTag.slice(dot + 1);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return '';
  if (!/^[0-9a-f]{16}$/.test(given)) return '';
  const expected = mac(id, versionCode, env);
  try {
    if (!timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(given, 'utf8'))) return '';
  } catch {
    return '';
  }
  return id;
}
