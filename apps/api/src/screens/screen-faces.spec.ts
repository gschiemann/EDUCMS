/**
 * Double-sided displays — the content-resolution rules (2026-09-16).
 *
 * `screen-faces.ts` decides ONE thing: which screen's schedules feed a face.
 * Everything downstream (the manifest fan-out, the wizard's per-side
 * assignment, the emergency device fan-out) is built on these answers, so
 * they are pinned here where they run in microseconds rather than only
 * through the controller.
 *
 * The cases that matter are the refusals. A mirroring face inherits content
 * from another row, which is the only place in this feature where one
 * screen's configuration can change what a DIFFERENT screen displays — so
 * every way that inheritance could go wrong (missing primary, wrong primary,
 * cross-tenant primary, a chain of faces) must resolve to the face's OWN
 * content rather than to something unverified.
 */

import {
  DEFAULT_FACE_CONTENT_MODE,
  deviceScopeScreenIds,
  defaultFaceName,
  faceContentMode,
  faceDeviceFingerprint,
  faceLabel,
  isFaceScreen,
  isValidFaceContentMode,
  needsPrimaryForContent,
  nextFaceIndex,
  normalizeFaceContentMode,
  reportsSecondDisplay,
  resolveFaceContentTarget,
} from './screen-faces';

const PRIMARY = {
  id: 'screen-primary',
  tenantId: 'tenant-1',
  screenGroupId: 'group-1',
  faceOfScreenId: null,
  faceIndex: null,
  faceContentMode: null,
};

const face = (over: Record<string, unknown> = {}) => ({
  id: 'screen-face-1',
  tenantId: 'tenant-1',
  screenGroupId: 'group-1',
  faceOfScreenId: 'screen-primary',
  faceIndex: 1,
  faceContentMode: 'MIRROR',
  ...over,
});

describe('identity', () => {
  it('a primary and an ordinary screen are not faces', () => {
    expect(isFaceScreen(PRIMARY)).toBe(false);
    expect(isFaceScreen({ id: 'plain', faceOfScreenId: null })).toBe(false);
    expect(isFaceScreen({ id: 'plain', faceOfScreenId: '' })).toBe(false);
    expect(isFaceScreen(null)).toBe(false);
  });

  it('a row with a primary IS a face', () => {
    expect(isFaceScreen(face())).toBe(true);
  });

  it('a NON-face always resolves its own content, never MIRROR', () => {
    // Answering MIRROR for a screen with no primary would invite a caller to
    // look for a row that does not exist.
    expect(faceContentMode(PRIMARY)).toBe('OWN');
    expect(faceContentMode({ id: 'plain', faceContentMode: 'MIRROR' })).toBe('OWN');
  });
});

describe('content mode', () => {
  it('MIRROR is the default, and unreadable input fails safe to it', () => {
    expect(DEFAULT_FACE_CONTENT_MODE).toBe('MIRROR');
    // The fail-safe direction for a face is "show side A", never "show nothing".
    expect(normalizeFaceContentMode(undefined)).toBe('MIRROR');
    expect(normalizeFaceContentMode(null)).toBe('MIRROR');
    expect(normalizeFaceContentMode('nonsense')).toBe('MIRROR');
    expect(faceContentMode(face({ faceContentMode: null }))).toBe('MIRROR');
  });

  it('OWN is honoured, case- and whitespace-insensitively', () => {
    expect(normalizeFaceContentMode('OWN')).toBe('OWN');
    expect(normalizeFaceContentMode(' own ')).toBe('OWN');
    expect(faceContentMode(face({ faceContentMode: 'own' }))).toBe('OWN');
  });

  it('the endpoint validator accepts only the two real modes', () => {
    expect(isValidFaceContentMode('OWN')).toBe(true);
    expect(isValidFaceContentMode('mirror')).toBe(true);
    expect(isValidFaceContentMode('SAME')).toBe(false);
    expect(isValidFaceContentMode(null)).toBe(false);
    expect(isValidFaceContentMode('')).toBe(false);
  });
});

describe('resolveFaceContentTarget — which schedules feed this screen', () => {
  it('an ordinary screen resolves itself', () => {
    expect(resolveFaceContentTarget(PRIMARY, null)).toEqual({
      screenId: 'screen-primary',
      screenGroupId: 'group-1',
      mirroredFromScreenId: null,
    });
  });

  it("a MIRROR face resolves the PRIMARY's id AND the primary's group", () => {
    // The group half matters as much as the id: side A's content usually
    // arrives through a group-scoped schedule, and a face that matched only
    // the primary's PIN would mirror nothing in the common case.
    const target = resolveFaceContentTarget(
      face({ screenGroupId: null }),
      { ...PRIMARY, screenGroupId: 'group-lobby' },
    );
    expect(target).toEqual({
      screenId: 'screen-primary',
      screenGroupId: 'group-lobby',
      mirroredFromScreenId: 'screen-primary',
    });
  });

  it('an OWN face resolves its own id and its own group — the primary is ignored', () => {
    const target = resolveFaceContentTarget(
      face({ faceContentMode: 'OWN', screenGroupId: 'group-back-hall' }),
      PRIMARY,
    );
    expect(target).toEqual({
      screenId: 'screen-face-1',
      screenGroupId: 'group-back-hall',
      mirroredFromScreenId: null,
    });
  });

  // ── the refusals ──────────────────────────────────────────────────────

  it('an unreadable primary falls back to OWN, never to inherited content', () => {
    // Deleted mid-request, or a pool blip. Showing the face's own content
    // (or the honest "waiting for assignment" manifest) beats showing
    // something we could not verify.
    expect(resolveFaceContentTarget(face(), null).mirroredFromScreenId).toBeNull();
    expect(resolveFaceContentTarget(face(), undefined).screenId).toBe('screen-face-1');
  });

  it('a primary row that is not THIS face’s primary is refused', () => {
    const wrong = { ...PRIMARY, id: 'some-other-screen' };
    const target = resolveFaceContentTarget(face(), wrong);
    expect(target.screenId).toBe('screen-face-1');
    expect(target.mirroredFromScreenId).toBeNull();
  });

  it('a CROSS-TENANT primary is refused even though the FK points at it', () => {
    // The FK is written by a tenant-checked endpoint, but a manifest read
    // must not depend on a past write having been correct.
    const target = resolveFaceContentTarget(face(), { ...PRIMARY, tenantId: 'tenant-2' });
    expect(target.screenId).toBe('screen-face-1');
    expect(target.mirroredFromScreenId).toBeNull();
  });

  it('a face may not mirror another face — one hop, so a chain can never cycle', () => {
    const chained = { ...PRIMARY, faceOfScreenId: 'screen-grandparent' };
    const target = resolveFaceContentTarget(face(), chained);
    expect(target.screenId).toBe('screen-face-1');
    expect(target.mirroredFromScreenId).toBeNull();
  });
});

describe('needsPrimaryForContent — the single-sided fleet pays nothing', () => {
  it('is false for every ordinary screen', () => {
    expect(needsPrimaryForContent(PRIMARY)).toBe(false);
    expect(needsPrimaryForContent({ id: 'plain' })).toBe(false);
    expect(needsPrimaryForContent(null)).toBe(false);
  });

  it('is true only for a MIRRORING face', () => {
    expect(needsPrimaryForContent(face())).toBe(true);
    expect(needsPrimaryForContent(face({ faceContentMode: 'OWN' }))).toBe(false);
  });
});

describe('deviceScopeScreenIds — a device-scoped alert reaches the whole display', () => {
  const unit = [
    { id: 'screen-primary', faceOfScreenId: null },
    { id: 'screen-face-1', faceOfScreenId: 'screen-primary' },
    { id: 'screen-face-2', faceOfScreenId: 'screen-primary' },
  ];

  it('naming the PRIMARY reaches every face', () => {
    // A lockdown that lit the front while the back kept running the lunch
    // menu is the exact failure this product exists to prevent.
    expect(deviceScopeScreenIds('screen-primary', unit).sort()).toEqual([
      'screen-face-1',
      'screen-face-2',
      'screen-primary',
    ]);
  });

  it('naming a FACE reaches the primary and its siblings', () => {
    // The physical display is the thing in the room, not the pane.
    expect(deviceScopeScreenIds('screen-face-1', unit).sort()).toEqual([
      'screen-face-1',
      'screen-face-2',
      'screen-primary',
    ]);
  });

  it('an ordinary single-sided screen reaches exactly itself', () => {
    expect(deviceScopeScreenIds('screen-plain', [{ id: 'screen-plain', faceOfScreenId: null }]))
      .toEqual(['screen-plain']);
  });

  it('names the screen even when no rows could be read', () => {
    // A failed lookup must never SHRINK the set an alert reaches.
    expect(deviceScopeScreenIds('screen-primary', [])).toEqual(['screen-primary']);
  });
});

describe('naming and fingerprints', () => {
  it('labels faces in the words an operator standing at the display uses', () => {
    expect(faceLabel(0)).toBe('Front');
    expect(faceLabel(null)).toBe('Front');
    expect(faceLabel(1)).toBe('Back');
    expect(faceLabel(2)).toBe('Side 3');
  });

  it('names a new face after its display', () => {
    expect(defaultFaceName('DH43', 1)).toBe('DH43 — Back');
    expect(defaultFaceName('  ', 1)).toBe('Display — Back');
  });

  it('derives a face fingerprint that cannot collide with the primary', () => {
    expect(faceDeviceFingerprint('abc123', 1)).toBe('abc123::face1');
    expect(faceDeviceFingerprint('abc123', 2)).toBe('abc123::face2');
    expect(faceDeviceFingerprint('abc123', 1)).not.toBe('abc123');
  });

  it('picks the next free face index, skipping holes left by a deleted face', () => {
    expect(nextFaceIndex([])).toBe(1);
    expect(nextFaceIndex([1])).toBe(2);
    expect(nextFaceIndex([2])).toBe(1);
    expect(nextFaceIndex([1, 2, null])).toBe(3);
  });
});

/**
 * A report in the shape the PROBE ACTUALLY SENDS.
 *
 * DisplayCapabilityProbe.kt:201 is `section(root, "displays") { displaySurface(ctx) }`
 * and displaySurface ends `out.put("displays", arr)` — so the array is nested
 * one level deeper than the key name suggests:
 *
 *     report.displays          = { available: true, displays: [ … ] }
 *     report.displays.displays = [ … ]
 *
 * The first version of these tests passed `{ displays: [ … ] }` — the shape the
 * CODE wanted — under a comment claiming it was "as the probe actually reported
 * it". It wasn't. Every test passed and the feature was dead on all hardware.
 * Fixtures go through this helper so the shape can only be wrong in one place,
 * and that place is checked against the Kotlin.
 */
const probeReport = (displays: unknown[]) => ({
  battery: { available: false },
  displays: { available: true, displays },
});

/** One display row, with the eight keys the probe derives per display. */
const displayRow = (over: Record<string, unknown> = {}) => ({
  id: 0,
  name: 'Built-in Screen',
  state: 2,
  width: 1920,
  height: 1080,
  refreshRate: 60,
  rotation: 0,
  flags: 0,
  isPresentation: false,
  isPrivate: false,
  isSecure: true,
  realWidth: 1920,
  realHeight: 1080,
  isValid: true,
  ...over,
});

describe('reportsSecondDisplay — offer a second side only when the hardware has one', () => {
  it('accepts a real presentation display IN THE PROBE’S OWN SHAPE', () => {
    // The DH43: the built-in panel plus the HDMI-driven back side. This is the
    // case that was returning false on every unit in the field.
    expect(
      reportsSecondDisplay(
        probeReport([
          displayRow({ id: 0, name: 'Built-in Screen', isPresentation: false }),
          displayRow({ id: 1, name: 'HDMI Screen', flags: 8, isPresentation: true, isPrivate: false }),
        ]),
      ),
    ).toBe(true);
  });

  it('refuses a PRIVATE presentation display — that is a virtual surface, not a panel', () => {
    // A screen-recorder or a vendor mirror sets FLAG_PRIVATE alongside
    // FLAG_PRESENTATION. Offering "add the back side" there invents hardware.
    expect(
      reportsSecondDisplay(
        probeReport([
          displayRow(),
          displayRow({ id: 1, name: 'ScreenRecorder', isPresentation: true, isPrivate: true }),
        ]),
      ),
    ).toBe(false);
  });

  it('refuses a mirror, and refuses "we have never been told"', () => {
    // A device that never reported must render as nothing, never as a display
    // with two sides.
    expect(reportsSecondDisplay(probeReport([displayRow()]))).toBe(false);
    expect(reportsSecondDisplay(probeReport([]))).toBe(false);
    expect(reportsSecondDisplay({ displays: { available: false } })).toBe(false);
    expect(reportsSecondDisplay({})).toBe(false);
    expect(reportsSecondDisplay(null)).toBe(false);
    expect(reportsSecondDisplay(undefined)).toBe(false);
    expect(reportsSecondDisplay({ displays: 'two' })).toBe(false);
    expect(reportsSecondDisplay({ displays: { displays: 'two' } })).toBe(false);
  });

  it('still accepts an already-unwrapped array, so a caller that unwraps is not silently wrong', () => {
    expect(
      reportsSecondDisplay({ displays: [displayRow({ isPresentation: true })] }),
    ).toBe(true);
    expect(reportsSecondDisplay({ displays: [] })).toBe(false);
  });

  /**
   * THE GUARD THAT WOULD HAVE CAUGHT THIS.
   *
   * The bug was not in the boolean logic — it was that the fixture and the
   * producer disagreed about the payload, and nothing compared them. This reads
   * the Kotlin and fails if the nesting it depends on ever moves.
   */
  it('the nesting this depends on is still what the Kotlin probe emits', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { readFileSync } = require('fs') as typeof import('fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { join } = require('path') as typeof import('path');
    const probe = readFileSync(
      join(
        __dirname,
        '../../../../apps/player/app/src/main/java/com/educms/player/display/DisplayCapabilityProbe.kt',
      ),
      'utf8',
    );
    // The section wrapper: report.displays is displaySurface's object…
    expect(probe).toContain('section(root, "displays") { displaySurface(ctx) }');
    // …and displaySurface puts the ARRAY at its own "displays" key.
    expect(probe).toContain('out.put("displays", arr)');
    // The two flags the verdict reads are still derived as booleans.
    expect(probe).toContain('"isPresentation"');
    expect(probe).toContain('"isPrivate"');
  });
});
