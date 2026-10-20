/**
 * The version an in-flight update is actually installing (1.1.46).
 *
 * The splash / Stop-menu update surfaces labelled the build with
 * `latest-version-public` — the STABLE release (v1.1.29) — while the screen was
 * installing a pushed field build (v1.1.45-field.1). The APK names the build it
 * is working on in every OTA state message it reports ("…tap Install for
 * v1.1.45-field.1…", "v1.1.45-field.1" while downloading), so that is the
 * source of truth while an OTA state is live; the public latest version is only
 * the fallback.
 */
const VERSION_IN_MESSAGE = /\bv(\d+\.\d+\.\d+(?:-[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*)?)/;

export function otaTargetVersion(otaMessage: string | null | undefined, fallback: string | null): string | null {
  if (otaMessage) {
    const m = VERSION_IN_MESSAGE.exec(otaMessage);
    if (m) return m[1].replace(/\.$/, '');
  }
  return fallback;
}
