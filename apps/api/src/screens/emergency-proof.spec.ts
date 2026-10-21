import { emergencyPaintSchema, emergencyRenderEvidence, nativeEmergencyProofSchema, newEmergencyEvents } from './emergency-proof';
import { nativePowerStateChanged, parseNativeRuntime } from './native-runtime';

const challenge = '00000000-0000-4000-8000-000000000001';
const episode = { face: 0 as const, challenge, heldAtMs: 1000, status: 'pending' as const, step: 0, events: [{ step: 0, atMs: 1000, outcome: 'pending' as const }] };
const paint = { identity: 'abcdef01', documentId: 'document-a', challenge, frames: 2, painted: true };
const runtime = { schema: 1, interactive: true, foreground: true, standbySinceMs: null, elapsedRealtimeMs: 1000, powerOnAck: null };

it('never grades selecting an alert, ordinary content, or a stale challenge as delivered', () => {
  expect(emergencyRenderEvidence('em:lockdown')).toEqual({ hash: 'pending|em:lockdown', painted: false });
  expect(emergencyRenderEvidence('em:abcdef01', { ...paint, painted: false })).toMatchObject({ painted: false });
  expect(emergencyRenderEvidence('pl:old', undefined, episode)).toMatchObject({ painted: false });
  expect(emergencyRenderEvidence('em:abcdef01', { ...paint, challenge: '00000000-0000-4000-8000-000000000002' }, episode)).toMatchObject({ painted: false });
  expect(emergencyRenderEvidence('em:abcdef01', paint, episode)).toMatchObject({ painted: false });
  expect(emergencyRenderEvidence('em:abcdef01', paint)).toMatchObject({ painted: false });
  expect(emergencyRenderEvidence('em:abcdef01', paint, { ...episode, status: 'painted', identity: paint.identity, documentId: paint.documentId })).toEqual({ hash: 'em:abcdef01', painted: true });
  expect(emergencyRenderEvidence('em:abcdef01', { ...paint, challenge: undefined })).toEqual({ hash: 'em:abcdef01', painted: true });
  expect(emergencyRenderEvidence('em:abcdef01', { ...paint, challenge: undefined, nativeRequired: true })).toEqual({ hash: 'pending|em:abcdef01', painted: false });
  expect(emergencyRenderEvidence('pl:normal')).toBeNull();
});

it('requires at least two painted samples and bounds all device fields', () => {
  expect(emergencyPaintSchema.safeParse({ ...paint, frames: 1 }).success).toBe(false);
  expect(emergencyPaintSchema.safeParse({ ...paint, documentId: 'x'.repeat(65) }).success).toBe(false);
  expect(emergencyPaintSchema.safeParse({ ...paint, extra: true }).success).toBe(false);
  expect(nativeEmergencyProofSchema.safeParse({ faces: [episode, episode, episode] }).success).toBe(false);
  expect(nativeEmergencyProofSchema.safeParse({ faces: [{ ...episode, events: Array(8).fill(episode.events[0]) }] }).success).toBe(false);
});

it('preserves every bounded escalation event and deduplicates a repeated status report', () => {
  const next = { faces: [{ ...episode, step: 4, status: 'unconfirmed' as const, events: [...episode.events,
    ...[1, 2, 3, 4].map(step => ({ step, atMs: 1000 + step * 1000, outcome: 'started' as const })),
    { step: 4, atMs: 8000, outcome: 'unconfirmed' as const },
  ] }] };
  expect(newEmergencyEvents(null, next).map(e => e.step)).toEqual([0, 1, 2, 3, 4, 4]);
  expect(newEmergencyEvents(next, next)).toEqual([]);
  expect(newEmergencyEvents(next, { faces: next.faces.map(f => ({ ...f, challenge: '00000000-0000-4000-8000-000000000002' })) })).toEqual([]);
  expect(newEmergencyEvents({ faces: [episode] }, next)).toHaveLength(5);
});

it('accepts two full face histories and forces prompt writes on a state change', () => {
  const faces = [0, 1].map(face => ({ ...episode, face, events: Array.from({ length: 7 }, (_, i) => ({ step: Math.min(i, 4), atMs: 1000 + i, outcome: 'started' })) }));
  const report = parseNativeRuntime(JSON.stringify({ ...runtime, emergencyProof: { faces } }));
  expect(report?.emergencyProof?.faces).toHaveLength(2);
  expect(nativePowerStateChanged(runtime, report!)).toBe(true);
  expect(nativePowerStateChanged(report, report!)).toBe(false);
  expect(parseNativeRuntime(' '.repeat(8193))).toBeNull();
});
