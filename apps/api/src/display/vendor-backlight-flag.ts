/**
 * THE VENDOR-BACKLIGHT KILL SWITCH (player 1.1.52, 2026-10-23) — `PLAYER_VENDOR_BACKLIGHT`.
 *
 * On a Goodview GUQ (Amlogic t982 / IFPDOS) the player's BLANK now switches
 * the panel's backlight off through the vendor's own control service while
 * Android, the page and the native alert watch keep running
 * (`apps/player/.../display/VendorBacklightProvider.kt`). The APK DETECTS the
 * service itself (owner rule 2026-10-18: no settings); this env is the lead's
 * kill switch only, following the 1.1.43 pattern — a token can only REMOVE
 * the behaviour, never force it:
 *
 *   PLAYER_VENDOR_BACKLIGHT=off            (or 0 / false / no / -all) — fleet-wide off
 *   PLAYER_VENDOR_BACKLIGHT=-<uuid>,-<uuid> — off for those screens
 *   PLAYER_VENDOR_BACKLIGHT=all / <uuid>    — accepted, changes nothing
 *   anything else                           — ignored (a typo disables nothing)
 *
 * Carried on the manifest's `display` block as `vendorBacklight: false`, and
 * ONLY for a screen the env names, so no other screen's payload hash moves
 * (CLAUDE.md manifest-cache rule 7). Deterministic per (screen, env).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OFF_WORDS = new Set(['off', '0', 'false', 'no']);

export interface VendorBacklightTargets {
  /** The whole fleet is switched off. */
  offAll: boolean;
  /** Screens switched off by id (lower-case uuids). */
  offIds: Set<string>;
}

export function parseVendorBacklightEnv(
  env: Record<string, string | undefined> = process.env,
): VendorBacklightTargets {
  const r: VendorBacklightTargets = { offAll: false, offIds: new Set() };
  const raw = (env.PLAYER_VENDOR_BACKLIGHT ?? '').trim();
  if (!raw) return r;
  if (OFF_WORDS.has(raw.toLowerCase())) return { offAll: true, offIds: new Set() };
  for (const t0 of raw.split(',')) {
    let t = t0.trim();
    if (!t.startsWith('-')) continue; // positive tokens are accepted and change nothing
    t = t.slice(1).trim();
    if (t.toLowerCase() === 'all') r.offAll = true;
    else if (UUID_RE.test(t)) r.offIds.add(t.toLowerCase());
  }
  return r;
}

/**
 * The flag for ONE screen: `false` when the env switches it off, `null` when
 * the block must carry no key at all.
 */
export function vendorBacklightFlagFor(
  screenId: string,
  env: Record<string, string | undefined> = process.env,
): false | null {
  const id = String(screenId ?? '').toLowerCase();
  const r = parseVendorBacklightEnv(env);
  if (r.offAll) return false;
  if (UUID_RE.test(id) && r.offIds.has(id)) return false;
  return null;
}
