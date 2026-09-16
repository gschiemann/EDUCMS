/**
 * PER-FACE STORAGE KEYS — the web half of "one token store per side".
 *
 * ⚠️ THE WHOLE FLEET RIDES ON THE FACE-0 LITERALS. Both faces of a
 * double-sided unit share ONE `localStorage` (same origin, same Android
 * process, and `setDataDirectorySuffix` is unavailable on the SDK-25 board),
 * so the namespace has to live in the KEY. That is safe only because face 0
 * derives exactly the strings the fleet already uses — if any one of them
 * drifts, every deployed screen is logged out, re-pairs, and re-downloads its
 * playlist and emergency payload at once.
 *
 * So the literals below are spelled out on purpose. Do NOT "clean this up"
 * into references to the module's own constants: a test that compares a value
 * to itself would stay green through exactly the change that breaks the fleet.
 */

import {
  FACE_PARAM,
  MAX_FACE_INDEX,
  faceFingerprint,
  faceIndexFromSearch,
  faceKey,
  faceKeys,
  isFace,
} from '../faceStorage';

describe('faceKeys — face 0 is the fleet, byte for byte', () => {
  it('derives todays exact literals for the primary', () => {
    expect(faceKeys(0)).toEqual({
      token: 'edu_device_token',
      fingerprint: 'edu_device_fp',
      manifestCache: 'edu_manifest_cache_v1',
      emergencyCache: 'edu_emergency_cache_v1',
      refreshAck: 'edu_refresh_ack',
      apiRoot: 'edu_api_root',
      canvasW: 'edu_canvasW',
      canvasH: 'edu_canvasH',
      posterStandard: 'edu_posterStandard',
    });
  });

  it('leaves a base key untouched at face 0', () => {
    expect(faceKey('edu_device_token', 0)).toBe('edu_device_token');
    expect(faceKey('anything', 0)).toBe('anything');
  });
});

describe('faceKeys — a face can never address the primary slot', () => {
  it('suffixes every key for a secondary face', () => {
    const back = faceKeys(1);
    expect(back.token).toBe('edu_device_token__face1');
    expect(back.fingerprint).toBe('edu_device_fp__face1');
    expect(back.emergencyCache).toBe('edu_emergency_cache_v1__face1');
  });

  it('shares no key with the primary, or with a sibling face', () => {
    // A single shared key here is a hard mutual 401: `persistDeviceToken`
    // writes unconditionally and the server binds a token's `sub` to the
    // screen id, so both panes go content-dead while still reporting ONLINE.
    const all: string[] = [];
    for (let face = 0; face <= MAX_FACE_INDEX; face += 1) {
      all.push(...Object.values(faceKeys(face)));
    }
    expect(new Set(all).size).toBe(all.length);
  });

  it('keeps the refresh-ack per face', () => {
    // REFRESH_WEB is acknowledged by VALUE identity (player rule 6). A shared
    // ack key would let one face's acknowledgement satisfy the other's
    // command, so a face would never actually reload.
    expect(faceKeys(1).refreshAck).not.toBe(faceKeys(0).refreshAck);
  });
});

describe('faceIndexFromSearch', () => {
  it('reads the face the Android shell appended', () => {
    expect(FACE_PARAM).toBe('face');
    expect(faceIndexFromSearch('?face=1')).toBe(1);
    expect(faceIndexFromSearch('?client=android&face=2&token=x')).toBe(2);
  });

  it('answers 0 for anything it cannot read as a face', () => {
    // Every one of these means "we do not know which face this is", and the
    // only safe answer to that is the behaviour every single-sided screen
    // already has.
    for (const search of [
      undefined,
      null,
      '',
      '?client=android',
      '?face=',
      '?face= ',
      '?face=abc',
      '?face=1.5',
      '?face=-1',
      '?face=1e0',
      '?face=%20',
      `?face=${MAX_FACE_INDEX + 1}`,
      '?face=99',
    ]) {
      expect(faceIndexFromSearch(search)).toBe(0);
    }
  });

  it('accepts an explicit face=0 as the primary', () => {
    expect(faceIndexFromSearch('?face=0')).toBe(0);
  });
});

describe('faceFingerprint — DEVAUTH-01', () => {
  it('mirrors the servers derivation exactly', () => {
    // Must equal the API's `faceDeviceFingerprint()` and the APK's
    // `FaceTokenStore.faceFingerprint()`. If the three disagree, a face
    // registers as a screen the dashboard cannot find.
    expect(faceFingerprint('android-abc123def456', 1)).toBe('android-abc123def456::face1');
    expect(faceFingerprint('android-abc123def456', 2)).toBe('android-abc123def456::face2');
  });

  it('passes the primarys fingerprint through untouched', () => {
    expect(faceFingerprint('android-abc123def456', 0)).toBe('android-abc123def456');
  });

  it('cannot collide with the primary or a sibling', () => {
    const primary = 'android-abc123def456';
    const all = [primary];
    for (let face = 1; face <= MAX_FACE_INDEX; face += 1) all.push(faceFingerprint(primary, face));
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('isFace', () => {
  it('is true only for a secondary face', () => {
    expect(isFace(0)).toBe(false);
    expect(isFace(1)).toBe(true);
    expect(isFace(MAX_FACE_INDEX)).toBe(true);
  });
});
