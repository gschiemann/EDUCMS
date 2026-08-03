/**
 * Safe access to `navigator.serviceWorker`.
 *
 * WHY THIS EXISTS (2026-08-04): reading `navigator.serviceWorker` INVOKES a
 * getter that THROWS in contexts where service workers are disabled:
 *
 *   "Failed to read the 'serviceWorker' property from 'Navigator':
 *    Service worker is disabled because the context is sandboxed and lacks
 *    the 'allow-same-origin' flag."
 *
 * The obvious guards do NOT protect you:
 *   - `!navigator.serviceWorker`      → reads it. Throws.
 *   - `navigator.serviceWorker?.x`    → reads it. Optional chaining applies
 *                                       AFTER the getter has already run.
 *   - `'serviceWorker' in navigator`  → safe by itself, but only proves the
 *                                       property EXISTS. The subsequent read
 *                                       still throws. This was the actual bug:
 *                                       code correctly used `in` to guard, then
 *                                       threw on the very next line.
 *
 * This became reachable when the holiday-board iframe moved to a real
 * null-origin sandbox (`sandbox="allow-scripts"`, finding INJ-005) — before
 * that it carried `allow-same-origin` and service workers were available.
 * Other real-world cases: Chrome with site data blocked, some enterprise/MDM
 * policies, and hardened WebView configurations.
 *
 * Always returns null instead of throwing. Callers treat null as "no SW here",
 * which is the correct degraded behavior everywhere we use it.
 */
export function getServiceWorkerContainer(): ServiceWorkerContainer | null {
  try {
    if (typeof navigator === 'undefined') return null;
    if (!('serviceWorker' in navigator)) return null;
    // The read itself is what can throw — it must be inside the try.
    return navigator.serviceWorker ?? null;
  } catch {
    return null;
  }
}

/** True only when a ServiceWorkerContainer is genuinely readable. */
export function isServiceWorkerAvailable(): boolean {
  return getServiceWorkerContainer() !== null;
}
