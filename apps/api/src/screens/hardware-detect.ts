/**
 * Server-side hardware-model auto-detection.
 *
 * 2026-05-27 — operator: "the screen needs to tell us all those answers
 * and not ask the end user anything when pairing....the player should
 * tell us the device and all the info i need to know".
 *
 * The pair modal used to ask "What hardware?" with a dropdown. Removed
 * in commit f293f99 with the promise that the dashboard would auto-
 * detect from the player's heartbeat. This file is that detection.
 *
 * Approach: parse the userAgent string the player APK / WebView sends
 * on /screens/register. Match well-known device signatures against the
 * HardwareModel enum in @cms/api-types. Fall back to coarse buckets
 * ("generic-android", "web") when we can't pin a specific model.
 *
 * The detection is LOSSY by design — we never overwrite an explicit
 * value an admin set via the dashboard. The controller calls
 * `inferIfUnknown()` which returns null when the existing value is
 * already set, so the auto-detect only kicks in for screens that
 * arrived with `hardware_model = null`.
 *
 * Adding a new device: append a rule below. Order matters — more
 * specific patterns first (an EP6N's UA may also contain "Android",
 * so we test for the Goodview marker before the generic Android one).
 */

import type { HardwareModel } from '@cms/api-types';

interface DetectInput {
  /** Full navigator.userAgent string the player sent. May be undefined
   *  for very old kiosks that predate the register-with-UA contract. */
  userAgent?: string | null;
  /** Coarse OS bucket the player computed client-side ("Android",
   *  "iOS", "Windows", "macOS", "Linux", "Chrome OS"). Used as a
   *  fallback when the userAgent doesn't match any device-specific
   *  rule. */
  osInfo?: string | null;
}

/**
 * Pure detection. Returns the best guess HardwareModel, or 'unknown'
 * when no rule matches. Never returns null — `'unknown'` is the
 * explicit "we have no idea" bucket and is a real catalog entry.
 */
export function detectHardwareModel(input: DetectInput): HardwareModel {
  const ua = (input.userAgent || '').toLowerCase();
  const os = (input.osInfo || '').toLowerCase();

  // ─── Specific device signatures ──────────────────────────────────
  // Goodview EP6N — the canonical sports-vertical target. Goodview's
  // stock Android System WebView typically emits a UA containing the
  // device model. We match a few likely tokens to be robust against
  // OEM Android System WebView builds putting the model in different
  // positions / casings.
  if (
    ua.includes('ep6n') ||
    ua.includes('goodview-ep6n') ||
    ua.includes('goodview ep6n') ||
    ua.includes('gv-ep6n')
  ) {
    return 'goodview-ep6n';
  }

  // Goodview ECBox 3576 — legacy single-RS232 box. Same matching
  // strategy as the EP6N.
  if (
    ua.includes('ecbox3576') ||
    ua.includes('ecbox-3576') ||
    ua.includes('ecbox 3576') ||
    ua.includes('goodview ecbox') ||
    ua.includes('rk3576')
  ) {
    return 'goodview-ecbox3576';
  }

  // MAXHUB L55VEC — floor-standing 55" PORTRAIT KIOSK.
  //
  // ⭐ Matched BEFORE the generic-Android fallback because this model carries
  // `nativeOrientation: 'PORTRAIT'`, and that is the only way VenueOS can know
  // which way up it is. The unit reports a 3840x2160 LANDSCAPE framebuffer
  // even though the chassis cannot be mounted landscape at all, so every
  // resolution-based guess gets it exactly backwards. Real UA from the
  // operator's own unit:
  //   Mozilla/5.0 (Linux; Android 13; L55VEC Build/TQ2A.230405.003.E1; wv) ...
  // Build.MANUFACTURER and Build.BRAND both read "MAXHUB"; board/device are
  // "t982_ar301" (Amlogic T982) — deliberately NOT matched on, because a
  // Goodview M43GUQ in the same fleet reports the identical board.
  if (ua.includes('l55vec') || ua.includes('maxhub')) {
    return 'maxhub-l55vec';
  }

  // NovaStar Taurus LED controller. Ships Chromium 83 (CLAUDE.md rule
  // #10). The Taurus UA contains "Taurus" verbatim plus a NovaStar
  // marker on most firmware revisions.
  if (
    ua.includes('taurus') ||
    ua.includes('novastar') ||
    ua.includes('nova-star')
  ) {
    return 'novastar-taurus';
  }

  // Raspberry Pi 5 — typically branded as "Raspberry Pi" in the UA
  // (Chromium on Pi OS) or detectable via Linux ARM markers.
  if (
    ua.includes('raspberry pi') ||
    ua.includes('raspbian') ||
    // Pi 5 specifically advertises armv8 — looser match for Pi
    // running standard Chromium on Pi OS / Ubuntu.
    (ua.includes('linux') && ua.includes('aarch64'))
  ) {
    return 'pi5';
  }

  // ─── Generic-Android fallback ─────────────────────────────────────
  // Anything Android-flavored that didn't match a specific Goodview /
  // Taurus / Pi rule lands in the generic-android bucket. Surfaces
  // basic Android caps on the dashboard (touch, WebView, etc.)
  // without claiming we know the exact OEM.
  if (os === 'android' || ua.includes('android')) {
    return 'generic-android';
  }

  // ─── Browser-only fallback ────────────────────────────────────────
  // Real desktop / laptop browsers (Mac, Windows, Linux desktop, iOS,
  // Chrome OS). The "web" bucket means "running our player in a
  // standard browser, not on a kiosk device" — preview mode, operator
  // QA, demo screens.
  if (
    os === 'macos' ||
    os === 'ios' ||
    os === 'windows' ||
    os === 'linux' ||
    os === 'chrome os'
  ) {
    return 'web';
  }

  // No rule matched. Could be an exotic device, a custom OEM ROM, or
  // a UA-stripped session. The 'unknown' bucket keeps the dashboard
  // honest — no false capability claims.
  return 'unknown';
}

/**
 * Convenience wrapper for the controller's register handler. Returns:
 *   - null when the screen already has a non-null hardware_model
 *     (admin must have set it explicitly via the dashboard — never
 *     overwrite that)
 *   - the inferred HardwareModel when the existing value is null and
 *     auto-detect produced something other than 'unknown'
 *   - null when auto-detect returned 'unknown' AND the existing
 *     column is also null (no point setting null → null)
 *
 * The controller can pass the return value straight into the update
 * data object — null means "don't touch this column."
 */
export function inferIfUnknown(
  input: DetectInput,
  existingHardwareModel: string | null | undefined,
): HardwareModel | null {
  if (existingHardwareModel) {
    // Operator already set a value, or a previous register call
    // auto-detected. Don't second-guess it.
    return null;
  }
  const detected = detectHardwareModel(input);
  if (detected === 'unknown') {
    return null;
  }
  return detected;
}
