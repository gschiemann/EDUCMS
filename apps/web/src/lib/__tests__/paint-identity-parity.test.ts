/**
 * PAINT-IDENTITY PARITY (2026-11-01) — the API's copy of the player's rule.
 *
 * The synthetic emergency drill (apps/api/src/emergency/drill/) grades a run by
 * comparing a screen's reported `lastRenderedHash` with the identity the alert
 * it sent MUST paint. The API computes that identity with
 * `@cms/api-types/emergency-paint-identity.ts`, a COPY of the player's
 * `emergencyPaintProof.ts` rule (the player keeps its own). If the two ever
 * drift, every drill would read a healthy screen as "painted the wrong alert"
 * (a false FAIL) — or, worse, accept a stale alert. This file holds them
 * identical across every incident type, severity, drill / live and letter
 * case, the shapes that reach `emergencyPaintIdentity` from each wire, and the
 * hash the page posts.
 *
 * It lives OUTSIDE `src/app/player/` on purpose: the player tree is out of
 * bounds for the drill's change (life-safety CHANGE class — the runtime path is
 * untouched), so this test only READS the player's modules.
 */
import {
  emergencyPaintIdentity as playerIdentity,
  emergencyPaintIdentityInput as playerInput,
  emergencyRenderHash as playerRenderHash,
} from '@/app/player/emergencyPaintProof';
import { alertFromOverridePush } from '@/app/player/emergencyRev';
import {
  emergencyPaintIdentity,
  emergencyPaintIdentityInput,
  emergencyRenderHash,
  isEmergencyRenderHash,
  overrideAlertPaintIdentity,
} from '@cms/api-types';

const TYPES = ['lockdown', 'evacuate', 'weather', 'hold', 'secure', 'medical'];
const SEVERITIES = ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'];
const CASES: Array<(s: string) => string> = [
  (s) => s.toLowerCase(),
  (s) => s.toUpperCase(),
  (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase(),
  (s) => ` ${s} `,
];

describe('the API copy of the paint identity equals the player rule', () => {
  it('every type × severity × drill/live × letter case, in every wire shape', () => {
    let compared = 0;
    for (const type of TYPES) {
      for (const severity of SEVERITIES) {
        for (const isDrill of [true, false]) {
          for (const tc of CASES) {
            for (const sc of CASES) {
              const shapes: unknown[] = [
                // The manifest's flat fields (applyManifest's `em`).
                { active: true, type: tc(type), severity: sc(severity), scopeNote: null, scope: 'screen', expiresAt: 1_800_000_000, isDrill },
                // The tenant-row read of the same alert (no expiry).
                { active: true, type: tc(type), severity: sc(severity), scopeNote: null, scope: 'tenant', expiresAt: null, isDrill },
                // A raise from the signed OVERRIDE push.
                alertFromOverridePush({ overrideId: 'ovr_x', type: tc(type), severity: sc(severity), isDrill }),
                // Operator words and a scope note change the picture, so the identity.
                { type: tc(type), severity: sc(severity), isDrill, scopeNote: 'Gym wing', textBlob: 'DRILL — Shelter', title: 'T' },
              ];
              for (const shape of shapes) {
                expect(emergencyPaintIdentityInput(shape)).toEqual(playerInput(shape));
                expect(emergencyPaintIdentity(shape)).toBe(playerIdentity(shape));
                compared += 1;
              }
            }
          }
        }
      }
    }
    expect(compared).toBe(TYPES.length * SEVERITIES.length * 2 * CASES.length * CASES.length * 4);
  });

  it('the drill runner’s expected identity is what the page paints for a device-scoped drill', () => {
    for (const type of TYPES) {
      for (const isDrill of [true, false]) {
        const expected = overrideAlertPaintIdentity({ type, severity: 'CRITICAL', isDrill });
        // From the manifest (the override row's columns, upper-cased type) …
        expect(playerIdentity({ active: true, type: type.toUpperCase(), severity: 'CRITICAL', scopeNote: null, scope: 'screen', expiresAt: 1, isDrill })).toBe(expected);
        // … and from the signed push, before the manifest lands.
        expect(playerIdentity(alertFromOverridePush({ type, severity: 'CRITICAL', isDrill }))).toBe(expected);
      }
    }
    // Drill and live never share an identity (a live alert replacing a drill is a new picture).
    expect(overrideAlertPaintIdentity({ type: 'lockdown', severity: 'CRITICAL', isDrill: true }))
      .not.toBe(overrideAlertPaintIdentity({ type: 'lockdown', severity: 'CRITICAL', isDrill: false }));
  });

  it('pushed messages (carrying their own id) and non-objects hash whole, identically', () => {
    const message = { id: 'bcast_1', type: 'TEXT_BROADCAST', severity: 'WARN', textBlob: 'DRILL — test', mediaUrls: [], audioUrl: null, expiresAt: 1, createdAt: '2026-11-01T10:30:00.000Z' };
    for (const shape of [message, { ...message, severity: 'CRITICAL' }, null, undefined, 'x', 7, [], [1], {}, { type: '' }, { type: '  ' }]) {
      expect(emergencyPaintIdentityInput(shape)).toEqual(playerInput(shape));
      expect(emergencyPaintIdentity(shape)).toBe(playerIdentity(shape));
    }
  });

  it('the posted render hash is the same string in every state', () => {
    const now = 1_800_000_000_000;
    for (const painted of [true, false]) {
      for (const manifestOkAtMs of [0, now, now - 60_000, now - 120_000, now - 120_001]) {
        const proof = { identity: 'abcdef01', documentId: 'd', frames: painted ? 2 : 0, painted };
        const hash = emergencyRenderHash(proof, manifestOkAtMs, now);
        expect(hash).toBe(playerRenderHash(proof, manifestOkAtMs, now));
        expect(isEmergencyRenderHash(hash)).toBe(true);
      }
    }
    expect(isEmergencyRenderHash('pl:abc')).toBe(false);
    expect(isEmergencyRenderHash('stall|pl:abc')).toBe(false);
    expect(isEmergencyRenderHash('idle:playing')).toBe(false);
    expect(isEmergencyRenderHash(null)).toBe(false);
  });
});
