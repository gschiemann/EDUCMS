/**
 * M0-6 (2026-09-12) — version-restore fidelity helpers.
 *
 * `TemplateVersion.zones` is written by `snapshotVersion()` from the RAW
 * Prisma `TemplateZone` rows (`freshTemplate.zones`), so a snapshot row
 * carries EVERY persisted zone column — `sceneId` included, and
 * `defaultConfig` as the JSON **string** the column stores (the same shape
 * `assertZoneUrlsSafe` already documents itself as tolerating).
 *
 * `restoreVersion()` re-materialises those rows, and it used to lose two of
 * them on the way back in:
 *
 *  1. **`sceneId` was hard-coded to `null`** behind a comment claiming
 *     "scenes aren't captured in the snapshot". They are. Restoring ANY
 *     version of a multi-scene touch kiosk therefore collapsed every zone
 *     onto every scene — the navigation graph the operator built is gone
 *     and each scene renders the union of all of them.
 *  2. **`defaultConfig` was re-`JSON.stringify`'d** — a string in, a
 *     string-of-a-string out. `mapTemplate` then `JSON.parse`s that back to
 *     a *string*, not an object, so every widget config in the template
 *     became unreadable (blank widgets), and each further restore added
 *     another layer of escaping.
 *
 * Both fixes live here as pure functions so they can be unit-tested without
 * a Nest module, and so the "what does a snapshot zone actually carry"
 * question has exactly one answer in the codebase.
 */

/** The zone shape a version snapshot carries (a raw TemplateZone row). */
export interface SnapshotZone {
  name?: unknown;
  widgetType?: unknown;
  x?: unknown;
  y?: unknown;
  width?: unknown;
  height?: unknown;
  zIndex?: unknown;
  sortOrder?: unknown;
  defaultConfig?: unknown;
  touchAction?: unknown;
  sceneId?: unknown;
}

/** Minimal scene shape needed to resolve a snapshot's scene references. */
export interface LiveScene {
  id: string;
  isDefault?: boolean | null;
}

/**
 * `defaultConfig` for a zone about to be written back to the DB.
 *
 * The column is `String?` holding JSON. A snapshot row already carries that
 * string verbatim; a hand-built zone (the `replaceZones` request body) carries
 * a parsed object. Stringify ONLY the object shape — stringifying the string
 * shape is the double-encode bug described in this file's header.
 *
 * An unparseable string is passed through unchanged rather than rejected:
 * that is byte-identical to what the row held before the restore, and
 * `mapTemplate` already degrades a malformed config to `{}` with a warning.
 */
export function serializeSnapshotConfig(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === 'string') return raw.length ? raw : null;
  return JSON.stringify(raw);
}

/**
 * Resolve a snapshot zone's `sceneId` against the template's scenes AS THEY
 * ARE NOW.
 *
 *  - `null`/absent  → stays shared-across-every-scene (an explicit operator
 *                     choice; `deleteScene` is careful to preserve it too).
 *  - still exists   → the zone goes back on its original scene. This is the
 *                     whole point of M0-6.
 *  - deleted since  → falls back to the template's DEFAULT scene, mirroring
 *                     `deleteScene()`'s own "re-point orphaned zones at the
 *                     default so they keep rendering" rule. Writing the
 *                     dangling id instead would be a foreign-key violation
 *                     that fails the entire restore; writing `null` would
 *                     re-create the collapse bug on a subset of zones.
 *  - no default     → `null`. A template with no scenes at all has nothing
 *                     to point at, and `null` is exactly "renders anyway".
 */
export function resolveSnapshotSceneId(
  raw: unknown,
  liveScenes: readonly LiveScene[],
): string | null {
  if (typeof raw !== 'string' || !raw) return null;
  if (liveScenes.some((s) => s.id === raw)) return raw;
  const fallback = liveScenes.find((s) => s.isDefault) ?? null;
  return fallback ? fallback.id : null;
}

/**
 * The exact `TemplateZone.create` payload for one snapshot zone (minus
 * `templateId`, which the caller owns). Every persisted column the snapshot
 * carries survives; `id` is deliberately NOT carried, because `replaceZones`
 * regenerates zone ids on every single save — they are ephemeral by design
 * and nothing references them across a save.
 */
export function materializeSnapshotZone(
  z: SnapshotZone,
  index: number,
  liveScenes: readonly LiveScene[],
): Record<string, unknown> {
  return {
    name: z.name,
    widgetType: z.widgetType,
    x: z.x,
    y: z.y,
    width: z.width,
    height: z.height,
    zIndex: (z.zIndex as number) ?? 0,
    sortOrder: (z.sortOrder as number) ?? index,
    defaultConfig: serializeSnapshotConfig(z.defaultConfig),
    touchAction: z.touchAction == null ? null : z.touchAction,
    sceneId: resolveSnapshotSceneId(z.sceneId, liveScenes),
  };
}

/**
 * M0-6 — does the template's CURRENT state already equal `candidate` (the
 * newest existing version row)?
 *
 * Why this exists: `restoreVersion` writes a safety snapshot of the current
 * state before it overwrites anything, so a bad restore is one more Restore
 * away from undone. That guarantee is worth keeping — but `snapshotVersion`
 * caps history at the 5 newest rows, so an unconditional safety snapshot
 * spends one of the operator's five slots and evicts their oldest real save
 * EVERY TIME they restore. Restore the oldest version and the very act of
 * restoring it deletes it from the list.
 *
 * In the normal flow that capture is pure waste: `snapshotVersion` runs at
 * the END of `replaceZones` against the POST-save row, so the newest version
 * IS the current state. Comparing them lets restore skip a duplicate write
 * and stay slot-neutral, while still capturing whenever the live row has
 * genuinely drifted from the newest snapshot (a brand-apply writes
 * `TemplateZone.defaultConfig` directly, `deleteScene` re-points `sceneId` —
 * neither goes through `snapshotVersion`).
 *
 * Comparison is a normalised deep-equal over exactly the fields a snapshot
 * round-trips. It fails SAFE: anything it cannot line up reads as "not
 * equal", which means a snapshot is taken — today's behaviour.
 */
export function snapshotMatchesLiveState(
  candidate: { zones?: unknown; meta?: unknown } | null | undefined,
  liveZones: readonly SnapshotZone[],
  liveMeta: Record<string, unknown>,
): boolean {
  if (!candidate) return false;
  const snapZones = candidate.zones;
  // Both sides have to BE arrays. `liveZones` comes from a Prisma include
  // that a caller could omit, and "I could not read the live zones" must
  // grade as "not equal" (→ take the safety snapshot), never as a match.
  if (!Array.isArray(snapZones) || !Array.isArray(liveZones)) return false;
  if (snapZones.length !== liveZones.length) return false;
  for (let i = 0; i < snapZones.length; i++) {
    if (
      normalizeZoneForCompare(snapZones[i]) !==
      normalizeZoneForCompare(liveZones[i])
    )
      return false;
  }
  return (
    normalizeMetaForCompare(candidate.meta) ===
    normalizeMetaForCompare(liveMeta)
  );
}

/** Stable, order-independent JSON for the zone fields a snapshot carries. */
function normalizeZoneForCompare(z: unknown): string {
  const zone = (z ?? {}) as SnapshotZone;
  return stableStringify({
    name: zone.name ?? null,
    widgetType: zone.widgetType ?? null,
    x: zone.x ?? null,
    y: zone.y ?? null,
    width: zone.width ?? null,
    height: zone.height ?? null,
    zIndex: zone.zIndex ?? null,
    sortOrder: zone.sortOrder ?? null,
    defaultConfig: serializeSnapshotConfig(zone.defaultConfig),
    touchAction: zone.touchAction ?? null,
    sceneId:
      typeof zone.sceneId === 'string' && zone.sceneId ? zone.sceneId : null,
  });
}

/** Same for the builder-editable scalar subset `snapshotVersion` stores. */
function normalizeMetaForCompare(meta: unknown): string {
  const m = (meta ?? {}) as Record<string, unknown>;
  return stableStringify({
    name: m.name ?? null,
    description: m.description ?? null,
    screenWidth: m.screenWidth ?? null,
    screenHeight: m.screenHeight ?? null,
    bgColor: m.bgColor ?? null,
    bgGradient: m.bgGradient ?? null,
    bgImage: m.bgImage ?? null,
    isTouchEnabled: m.isTouchEnabled ?? null,
    idleResetMs: m.idleResetMs ?? null,
  });
}

/**
 * `JSON.stringify` with sorted keys at every level, so two structurally
 * equal objects that were built in a different key order still compare
 * equal. `undefined` is normalised to `null` by the callers above.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    // `undefined` has no JSON form; normalise it to null so an absent key
    // and an explicit null compare equal.
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',')}}`;
}
