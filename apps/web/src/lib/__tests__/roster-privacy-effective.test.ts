import { effectiveRosterPolicy } from '../roster-privacy-effective';

const ALL_ON = { names: 'full' as const, numbers: true, photos: true, positions: true, stats: true };

describe('effectiveRosterPolicy (DEV-006)', () => {
  it('no school policy: the game switches are the whole story', () => {
    const e = effectiveRosterPolicy(ALL_ON, { applies: false });
    expect(e.restricted).toBe(false);
    expect(e.schoolNote).toBeNull();
    expect(effectiveRosterPolicy(ALL_ON, undefined).restricted).toBe(false);
  });

  it('school hides names and photos: effective policy is restricted whatever the game says', () => {
    const e = effectiveRosterPolicy(ALL_ON, { applies: true, names: { allowed: false }, photos: { allowed: false } });
    expect(e).toMatchObject({ names: 'hidden', photos: false, restricted: true, schoolNote: 'namesAndPhotos' });
  });

  it('school allows both: photos still need a per-student release, so it is not "everything"', () => {
    const e = effectiveRosterPolicy(ALL_ON, { applies: true, names: { allowed: true }, photos: { allowed: true } });
    expect(e.namesLockedBySchool).toBe(false);
    expect(e.photosLockedBySchool).toBe(false);
    expect(e.restricted).toBe(true);
  });

  it('a game switch alone restricts', () => {
    expect(effectiveRosterPolicy({ ...ALL_ON, stats: false }, { applies: false }).restricted).toBe(true);
  });
});
