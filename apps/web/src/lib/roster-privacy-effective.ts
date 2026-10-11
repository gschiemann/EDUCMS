/**
 * What a public board ACTUALLY shows about players: the school's policy AND
 * this game's switches (Muse beta DEV-006 / S-06, 2026-10-07).
 *
 * The roster card's headline said "Showing everything on the roster" from
 * the game's switches alone while an amber note said the school's policy
 * hides names and photos — the card contradicted itself on a FERPA surface.
 * The headline, the note and every option now derive from this one result.
 *
 * Mirrors `studentRosterPrivacy` in apps/api/src/sports/student-privacy.ts
 * (for a student with no opt-out): names hidden unless the school allows
 * them; photos only when the school allows them (and then only students
 * with a photo release); numbers/positions/stats are the game's switches.
 */

export interface GameRosterPolicy {
  names: 'full' | 'last' | 'hidden';
  numbers: boolean;
  photos: boolean;
  positions: boolean;
  stats: boolean;
}

export interface SchoolPolicyLike {
  applies?: boolean;
  names?: { allowed?: boolean } | null;
  photos?: { allowed?: boolean } | null;
}

export interface EffectiveRosterPolicy extends GameRosterPolicy {
  /** The school's policy forces names hidden, whatever this game says. */
  namesLockedBySchool: boolean;
  /** The school's policy forces photos off, whatever this game says. */
  photosLockedBySchool: boolean;
  /** Anything less than the full roster reaches a public screen. */
  restricted: boolean;
  /** Which note explains the school's part, if any. */
  schoolNote: 'namesAndPhotos' | 'names' | 'photos' | null;
}

export function effectiveRosterPolicy(game: GameRosterPolicy, school: SchoolPolicyLike | null | undefined): EffectiveRosterPolicy {
  const applies = !!school?.applies;
  const namesLockedBySchool = applies && school?.names?.allowed !== true;
  const photosLockedBySchool = applies && school?.photos?.allowed !== true;
  const names = namesLockedBySchool ? 'hidden' : game.names;
  const photos = photosLockedBySchool ? false : game.photos;
  const restricted =
    names !== 'full' || !game.numbers || !photos || !game.positions || !game.stats || (applies && !photosLockedBySchool);
  const schoolNote =
    namesLockedBySchool && photosLockedBySchool
      ? 'namesAndPhotos'
      : namesLockedBySchool
        ? 'names'
        : photosLockedBySchool
          ? 'photos'
          : null;
  return {
    names,
    numbers: game.numbers,
    photos,
    positions: game.positions,
    stats: game.stats,
    namesLockedBySchool,
    photosLockedBySchool,
    restricted,
    schoolNote,
  };
}
