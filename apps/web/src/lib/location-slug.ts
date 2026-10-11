/**
 * Location slug auto-derivation, shared by Settings → Locations
 * (`settings/cc/LocationsPage.tsx`) and the older `DistrictSchoolsCard`.
 *
 * Muse beta DEV-003 (2026-10-07): LocationsPage computed the next slug inside
 * a `setSlug(prev => …)` updater that read `lastAutoSlug.current` — but the
 * updater runs LATER, after the ref had already been reassigned to the new
 * auto value, so `prev === lastAutoSlug.current` was false from the second
 * keystroke on and the slug froze at one letter. The server then refused the
 * create with `TENANT_SLUG_TOO_SHORT`. This pure step is decided synchronously
 * from the values at keystroke time, so it cannot be raced.
 */

export function slugifyLocationName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

/**
 * The next slug + last-auto marker after the name changes. The slug follows
 * the name while it still equals the last value WE derived (or is empty); a
 * slug the operator typed themselves is kept.
 */
export function nextAutoSlug(
  currentSlug: string,
  lastAuto: string,
  nextName: string,
): { slug: string; lastAuto: string } {
  const auto = slugifyLocationName(nextName);
  if (!currentSlug || currentSlug === lastAuto) {
    return { slug: auto, lastAuto: auto };
  }
  return { slug: currentSlug, lastAuto };
}
