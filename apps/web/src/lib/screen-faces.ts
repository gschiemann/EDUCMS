/**
 * Double-sided displays, operator side — grouping screens into DISPLAYS.
 *
 * The server models one face as one `Screen` row (see
 * `apps/api/src/screens/screen-faces.ts` for why). That is right for
 * schedules, emergency delivery and fleet health — and wrong for the
 * operator, who installed ONE display and must not be shown two unexplained
 * rows named "DH43" and "DH43 — Back" in every picker.
 *
 * This module is the translation: it folds the flat screen list the API
 * returns into UNITS (a display and its sides) so every publish surface can
 * ask the operator one question — "same on both sides, or different?" —
 * instead of making them work out that two rows are one object.
 *
 * PURE ON PURPOSE: no React, no DOM, no network — same contract as
 * `blast-radius.ts`, which consumes the same face fields.
 */

/** The face columns `GET /screens` carries on every row. */
export interface FaceAwareScreenRef {
  id: string;
  name?: string | null;
  status?: string | null;
  resolution?: string | null;
  /** The primary this row is a face of. Null/absent on ordinary screens. */
  faceOfScreenId?: string | null;
  /** Ordinal among the unit's faces; the primary is 0 (stored as null). */
  faceIndex?: number | null;
  /** 'MIRROR' (shows the primary's content) | 'OWN'. Null on a primary. */
  faceContentMode?: string | null;
}

export interface DisplaySide<T extends FaceAwareScreenRef = FaceAwareScreenRef> {
  screen: T;
  /** 0 = the primary. */
  index: number;
  /** "Front" / "Back" / "Side 3". */
  label: string;
  /** True when this side shows the primary's content rather than its own. */
  mirrors: boolean;
}

export interface DisplayUnit<T extends FaceAwareScreenRef = FaceAwareScreenRef> {
  /** The primary screen — the id every "same on both sides" publish targets. */
  primary: T;
  /** Every side, primary first, in face order. */
  sides: Array<DisplaySide<T>>;
  /** More than one side. The ONLY flag any UI should branch on. */
  isMultiSided: boolean;
  /**
   * True when every non-primary side mirrors. This is "both sides show the
   * same content" — the default state of a newly created face.
   */
  sidesAreCombined: boolean;
}

/** "Front" / "Back" / "Side 3" — mirrors the server's `faceLabel`. */
export function sideLabel(index: number | null | undefined): string {
  const n = typeof index === 'number' && Number.isFinite(index) ? Math.trunc(index) : 0;
  if (n <= 0) return 'Front';
  if (n === 1) return 'Back';
  return `Side ${n + 1}`;
}

const isFace = (s: FaceAwareScreenRef): boolean =>
  typeof s.faceOfScreenId === 'string' && s.faceOfScreenId.length > 0;

const mirrors = (s: FaceAwareScreenRef): boolean =>
  isFace(s) && String(s.faceContentMode ?? 'MIRROR').trim().toUpperCase() !== 'OWN';

/**
 * Fold a flat screen list into displays.
 *
 * Ordinary screens come back as one-sided units, so a caller never needs a
 * separate code path for "normal" screens — which is what keeps the
 * double-sided feature invisible on a fleet that has none.
 *
 * ORPHAN RULE: a face whose primary is not in the list (filtered out by a
 * search, or not readable) is returned as its OWN unit rather than dropped.
 * A screen that exists must be selectable; silently hiding one is how a
 * publish quietly reaches fewer screens than the operator believes.
 */
export function groupScreensIntoUnits<T extends FaceAwareScreenRef>(
  screens: Array<T | null | undefined> | null | undefined,
): Array<DisplayUnit<T>> {
  const rows = (screens ?? []).filter((s): s is T => !!s && !!s.id);
  const byId = new Map(rows.map((s) => [s.id, s]));

  const facesByPrimary = new Map<string, T[]>();
  for (const s of rows) {
    if (!isFace(s)) continue;
    const primaryId = s.faceOfScreenId as string;
    if (!byId.has(primaryId)) continue; // orphan — handled below
    const list = facesByPrimary.get(primaryId) ?? [];
    list.push(s);
    facesByPrimary.set(primaryId, list);
  }

  const units: Array<DisplayUnit<T>> = [];
  for (const s of rows) {
    // A face is rendered by its primary's unit, unless it is an orphan.
    if (isFace(s) && byId.has(s.faceOfScreenId as string)) continue;

    const faces = (facesByPrimary.get(s.id) ?? []).slice().sort(
      (a, b) => (a.faceIndex ?? 0) - (b.faceIndex ?? 0) || (a.id < b.id ? -1 : 1),
    );
    const sides: Array<DisplaySide<T>> = [
      { screen: s, index: 0, label: sideLabel(0), mirrors: false },
      ...faces.map((f) => ({
        screen: f,
        index: typeof f.faceIndex === 'number' ? f.faceIndex : 1,
        label: sideLabel(f.faceIndex),
        mirrors: mirrors(f),
      })),
    ];
    units.push({
      primary: s,
      sides,
      isMultiSided: sides.length > 1,
      sidesAreCombined: sides.length > 1 && sides.slice(1).every((side) => side.mirrors),
    });
  }
  return units;
}

/** Find the unit a screen id belongs to (by either the primary or a face). */
export function unitForScreenId<T extends FaceAwareScreenRef>(
  units: Array<DisplayUnit<T>>,
  screenId: string,
): DisplayUnit<T> | null {
  return units.find((u) => u.sides.some((s) => s.screen.id === screenId)) ?? null;
}

/**
 * How a publish selection lands on a multi-sided unit.
 *
 *   'none'    — nothing on this display is selected.
 *   'all'     — every side is selected (or the unit is combined and its
 *               primary is selected, which reaches every side).
 *   'partial' — some sides selected, some not. The operator must be told
 *               which side is being left out, not just shown a half-tick.
 */
export type UnitSelection = 'none' | 'all' | 'partial';

export function unitSelection<T extends FaceAwareScreenRef>(
  unit: DisplayUnit<T>,
  selectedIds: Set<string> | ReadonlySet<string>,
): UnitSelection {
  // A combined unit is reached entirely by its primary — the mirroring sides
  // have no schedules of their own, so requiring them to be ticked would be a
  // lie about what publishing does.
  if (unit.sidesAreCombined) return selectedIds.has(unit.primary.id) ? 'all' : 'none';
  const hits = unit.sides.filter((s) => selectedIds.has(s.screen.id)).length;
  if (hits === 0) return 'none';
  return hits === unit.sides.length ? 'all' : 'partial';
}

/**
 * The screen ids a publish must actually target to cover these sides.
 *
 * A MIRRORING side is deliberately EXCLUDED: it has no schedules of its own,
 * so a schedule row pointed at it would be written, stored, and ignored —
 * the "editable field that reaches nothing" trap. It still displays the
 * content, because it resolves the primary's schedules.
 */
export function publishTargetsForSides<T extends FaceAwareScreenRef>(
  sides: Array<DisplaySide<T>>,
): string[] {
  return sides.filter((s) => !s.mirrors).map((s) => s.screen.id);
}

/**
 * Sides that a selection will DISPLAY on, including mirrored ones.
 *
 * This is what the blast radius must count: selecting the front of a
 * combined display puts content on the back too, and an operator who is told
 * "1 screen" when two panes of glass will change is being told a half-truth.
 */
export function displayedSideIds<T extends FaceAwareScreenRef>(
  unit: DisplayUnit<T>,
  selectedIds: Set<string> | ReadonlySet<string>,
): string[] {
  const out: string[] = [];
  for (const side of unit.sides) {
    if (selectedIds.has(side.screen.id)) {
      out.push(side.screen.id);
      continue;
    }
    // A mirroring side follows its primary wherever the primary goes.
    if (side.mirrors && selectedIds.has(unit.primary.id)) out.push(side.screen.id);
  }
  return out;
}
