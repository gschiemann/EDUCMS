/**
 * Double-sided displays — which face resolves which content (2026-09-16).
 *
 * THE PROBLEM. Greg installed the first double-sided unit and needs
 * "individual content on each side, sometimes the same but at times
 * different". The hardware can do it: the DH43 is one rk3288 board with TWO
 * REAL Android displays (display 1 carries FLAG_PRESENTATION and is not a
 * private/virtual mirror). Evidence:
 * docs/research/2026-09-15-double-sided-display/README.md.
 *
 * THE MODEL. One face = one `Screen` row (the standing decision in
 * docs/roadmap/ROADMAP.md). Side B is a Screen linked to the primary by
 * `faceOfScreenId`. Everything a Screen can already do, a face can do:
 * schedules, playlists, emergency delivery, proof of play, render proof,
 * fleet grading, remote refresh. Nothing had to learn about "slots".
 *
 * THE ONE THING THIS FILE DECIDES. A face has a content mode:
 *
 *   MIRROR (default) — resolve the PRIMARY's schedules. A face created
 *                      today shows what side A shows with zero operator
 *                      action, which is the "sometimes the same" half of
 *                      the request and the only safe default (a brand-new
 *                      face with no schedules would otherwise be black).
 *   OWN              — resolve its own schedules. The "at times different"
 *                      half.
 *
 * MIRROR borrows EXACTLY ONE THING: which schedules feed the face's content.
 * It does not borrow identity. The face keeps its own orientation, canvas,
 * device credential, render proof, proof of play, and — stated explicitly
 * because it is life-safety — its own emergency resolution. A mirroring face
 * is still a Screen row in the tenant, so a tenant- or group-scoped lockdown
 * reaches it through the ordinary path, and `getManifest`'s emergency branch
 * returns BEFORE any of this code runs. There is no mode, and no
 * misconfiguration, in which mirroring can suppress an alert.
 *
 * PURE AND PRISMA-FREE so it unit-tests in microseconds — same discipline as
 * `effective-schedule.ts`, which sits directly downstream of it.
 */

/** A face resolves its own schedules, or the primary's. */
export type FaceContentMode = 'MIRROR' | 'OWN';

export const FACE_CONTENT_MODES: readonly FaceContentMode[] = ['MIRROR', 'OWN'];

/**
 * The default for a NEWLY created face, and the fallback for any unreadable
 * value. MIRROR, because a face that has never been assigned content must
 * show something rather than nothing — "both sides the same" is the state
 * the operator gets for free, and "different" is the deliberate choice.
 */
export const DEFAULT_FACE_CONTENT_MODE: FaceContentMode = 'MIRROR';

/** The maximum number of faces one device may carry, primary included. */
export const MAX_FACES_PER_UNIT = 4;

/** The minimal Screen shape this module reads. */
export interface FaceAwareScreen {
  id: string;
  tenantId?: string | null;
  screenGroupId?: string | null;
  faceOfScreenId?: string | null;
  faceIndex?: number | null;
  faceContentMode?: string | null;
  [column: string]: unknown;
}

/** True when this row is a secondary face of some other screen. */
export function isFaceScreen(screen: FaceAwareScreen | null | undefined): boolean {
  return !!screen && typeof screen.faceOfScreenId === 'string' && screen.faceOfScreenId.length > 0;
}

/**
 * Normalise a stored/submitted content mode.
 *
 * Unknown input reads as MIRROR rather than throwing: this runs on the
 * manifest hot path, and the fail-safe direction for a face is "show side
 * A's content", never "show nothing".
 */
export function normalizeFaceContentMode(value: unknown): FaceContentMode {
  const v = String(value ?? '').trim().toUpperCase();
  return v === 'OWN' ? 'OWN' : 'MIRROR';
}

/** Is this a value the face-mode endpoint will accept? */
export function isValidFaceContentMode(value: unknown): value is FaceContentMode {
  const v = String(value ?? '').trim().toUpperCase();
  return v === 'OWN' || v === 'MIRROR';
}

/**
 * The effective content mode of a screen row.
 *
 * A NON-face screen always answers 'OWN' — it has no primary to mirror, and
 * answering MIRROR there would be a silent invitation for a caller to look
 * for a primary that does not exist.
 */
export function faceContentMode(screen: FaceAwareScreen | null | undefined): FaceContentMode {
  if (!isFaceScreen(screen)) return 'OWN';
  return normalizeFaceContentMode(screen?.faceContentMode);
}

/**
 * The operator-facing name for a face position. 0 is the primary.
 *
 * Deliberately physical words, not ids: an operator standing at the display
 * reads "Front" and "Back", and the numbers only appear on the (currently
 * hypothetical) three-plus-sided unit.
 */
export function faceLabel(index: number | null | undefined): string {
  const n = typeof index === 'number' && Number.isFinite(index) ? Math.trunc(index) : 0;
  if (n <= 0) return 'Front';
  if (n === 1) return 'Back';
  return `Side ${n + 1}`;
}

/** The default name for a newly created face: "DH43 — Back". */
export function defaultFaceName(primaryName: string | null | undefined, index: number): string {
  const base = String(primaryName ?? '').trim() || 'Display';
  return `${base} — ${faceLabel(index)}`;
}

/**
 * The device fingerprint a face row carries.
 *
 * Derived from the primary's so one physical box's faces are recognisable as
 * one box in forensics, and so the native side can compute the same string
 * without being told it. `::face<N>` cannot collide with a real fingerprint
 * (no existing generator emits a colon pair) and cannot be confused with the
 * primary's own.
 *
 * ⚠️ Knowing this string grants NOTHING. A face's credential is minted the
 * same way every other screen's is; the derivation is a naming convention,
 * never an authentication input. (DEVAUTH-01: fingerprint knowledge must
 * never upgrade a credential.)
 */
export function faceDeviceFingerprint(primaryFingerprint: string, index: number): string {
  return `${primaryFingerprint}::face${Math.max(1, Math.trunc(index))}`;
}

/** Which screen id + group the manifest should match schedules against. */
export interface FaceContentTarget {
  /** The screen id whose pinned schedules feed this face. */
  screenId: string;
  /** The group whose schedules feed this face, or null. */
  screenGroupId: string | null;
  /**
   * The primary this face is mirroring, or null when the screen resolves its
   * own content. Surfaced in the manifest for diagnostics — an operator
   * looking at a face that is showing the "wrong" thing must be able to see
   * that it is mirroring, not guess.
   */
  mirroredFromScreenId: string | null;
}

/**
 * Resolve which schedules feed a screen's content.
 *
 * `primary` is the face's primary Screen row, or null when the caller could
 * not read it. THE FALLBACK IS DELIBERATE AND IS THE SAFE DIRECTION: a
 * mirroring face whose primary cannot be read (deleted mid-request, a pool
 * blip, a cross-tenant row) resolves its OWN target rather than inheriting
 * something unverified. Worst case it shows the face's own content — or
 * nothing, which the "waiting for assignment" manifest already handles
 * honestly. It can never show another tenant's content.
 *
 * CROSS-TENANT REFUSAL is enforced here rather than trusted upstream: the FK
 * is written by an endpoint that checks tenancy, but a manifest read must not
 * depend on a past write having been correct.
 */
export function resolveFaceContentTarget(
  screen: FaceAwareScreen,
  primary: FaceAwareScreen | null | undefined,
): FaceContentTarget {
  const own: FaceContentTarget = {
    screenId: screen.id,
    screenGroupId: screen.screenGroupId ?? null,
    mirroredFromScreenId: null,
  };

  if (faceContentMode(screen) !== 'MIRROR') return own;
  if (!primary || !primary.id) return own;
  // The row we were handed must actually be this face's primary.
  if (primary.id !== screen.faceOfScreenId) return own;
  // A face and its primary are the same physical box, so they are always the
  // same tenant. A row that disagrees is corrupt or hostile — resolve own.
  if ((screen.tenantId ?? null) !== (primary.tenantId ?? null)) return own;
  // A face may not mirror another face: that is a chain, and a chain can be a
  // cycle. One hop, always.
  if (isFaceScreen(primary)) return own;

  return {
    screenId: primary.id,
    screenGroupId: primary.screenGroupId ?? null,
    mirroredFromScreenId: primary.id,
  };
}

/**
 * Does this screen need its primary read in order to resolve content?
 *
 * The manifest asks this before spending a query. False for every ordinary
 * screen, so the 99.9% of the fleet that is single-sided pays nothing.
 */
export function needsPrimaryForContent(screen: FaceAwareScreen | null | undefined): boolean {
  return isFaceScreen(screen) && faceContentMode(screen) === 'MIRROR';
}

/**
 * Every screen id a DEVICE-scoped action on `screenId` must reach.
 *
 * THIS IS A LIFE-SAFETY HELPER. A device-scoped lockdown names one screen id;
 * with faces, that id is one PANE of a physical display, and an alert that
 * lit only the front of a double-sided board while the back kept advertising
 * the lunch menu would be exactly the failure this product exists to prevent.
 * Tenant- and group-scoped alerts already reach faces for free (a face is an
 * ordinary Screen row in the tenant); this closes the device-scoped case.
 *
 * Deliberately symmetric: it is used for BOTH trigger and all-clear, so the
 * set that goes into an alert is the set that comes out of it. An
 * asymmetry here is how a screen gets stranded on a lockdown nobody can
 * clear (the emergency-003 class of bug).
 *
 * Direction matters: naming the PRIMARY reaches its faces, and naming a FACE
 * reaches the whole unit — the primary and its siblings — because the
 * physical display is the thing in the room, not the pane.
 */
export function deviceScopeScreenIds(
  scopeScreenId: string,
  unitRows: Array<{ id: string; faceOfScreenId?: string | null }>,
): string[] {
  const ids = new Set<string>([scopeScreenId]);
  const byId = new Map(unitRows.map((r) => [r.id, r]));
  const named = byId.get(scopeScreenId);
  // The primary of the unit the named screen belongs to.
  const rootId = named?.faceOfScreenId || scopeScreenId;
  ids.add(rootId);
  for (const row of unitRows) {
    if (row.id === rootId || row.faceOfScreenId === rootId) ids.add(row.id);
  }
  return Array.from(ids);
}

/** The next free face index for a unit that already has these faces. */
export function nextFaceIndex(existingFaceIndexes: Array<number | null | undefined>): number {
  let next = 1;
  const taken = new Set(
    existingFaceIndexes
      .map((n) => (typeof n === 'number' && Number.isFinite(n) ? Math.trunc(n) : null))
      .filter((n): n is number => n !== null),
  );
  while (taken.has(next)) next += 1;
  return next;
}

/**
 * Does this device's reported display inventory show a REAL second panel?
 *
 * Reads the probe's `displays` section
 * (`ScreenDeviceInventory.report.displays`, the only place a list of
 * displays exists — see that model's header). The distinction the probe was
 * added to make: a display that carries `isPresentation` and is NOT
 * `isPrivate` is a real second output; anything else is a mirror or a
 * virtual/overlay surface and must not be offered as a second side.
 *
 * Returns false for every device that has never reported, which is the whole
 * browser-player fleet and every pre-probe APK. "We do not know" must never
 * render as "this display has two sides".
 */
export function reportsSecondDisplay(inventoryReport: unknown): boolean {
  const displays = (inventoryReport as { displays?: unknown } | null | undefined)?.displays;
  if (!Array.isArray(displays)) return false;
  return displays.some((d) => {
    if (!d || typeof d !== 'object') return false;
    const row = d as Record<string, unknown>;
    return row.isPresentation === true && row.isPrivate !== true;
  });
}
