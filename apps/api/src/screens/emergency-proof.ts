import { z } from 'zod';

const token = () => z.string().regex(/^[A-Za-z0-9._:-]{1,64}$/);
/** Page-observed paint, never inferred from an emergency state or a live event loop. */
export const emergencyPaintSchema = z.strictObject({
  identity: token(),
  documentId: token(),
  challenge: z.string().uuid().optional(),
  frames: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  painted: z.boolean(),
}).refine(p => !p.painted || p.frames >= 2);
export type EmergencyPaint = z.infer<typeof emergencyPaintSchema>;

export const nativeEmergencyProofSchema = z.strictObject({
  faces: z.array(z.strictObject({
    face: z.union([z.literal(0), z.literal(1)]),
    challenge: z.string().uuid(),
    heldAtMs: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    status: z.enum(['pending', 'painted', 'unconfirmed']),
    step: z.number().int().min(0).max(4),
    identity: token().optional(),
    documentId: token().optional(),
    events: z.array(z.strictObject({
      step: z.number().int().min(0).max(4),
      atMs: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      outcome: z.enum(['pending', 'started', 'failed', 'painted', 'unconfirmed']),
    })).max(7),
  })).max(2),
});
export type NativeEmergencyProof = z.infer<typeof nativeEmergencyProofSchema>;

/** A legacy em: signature alone only proves the alert was selected in React. */
export function emergencyRenderEvidence(hash: string | null | undefined, proof?: EmergencyPaint, episode?: NativeEmergencyProof['faces'][number]) {
  // A native nonce means this page cannot speak for the Android window.
  // Wait for the native side's visibility/surface/foreground validation,
  // including when its first heartbeat has not reached the API yet.
  const nativeExpected = !!episode || !!proof?.challenge;
  const nativeAccepted = !!episode && episode.status === 'painted' && proof?.painted === true &&
    proof.challenge === episode.challenge && proof.identity === episode.identity && proof.documentId === episode.documentId;
  if (nativeExpected && !nativeAccepted) {
    return { hash: `pending|em:${proof?.identity ?? episode!.challenge}`, painted: false };
  }
  const pendingHash = proof ? `pending|em:${proof.identity}` :
    /^(?:unconfirmed\|)?em:/.test(hash ?? '') ? `pending|${hash!.replace(/^unconfirmed\|/, '')}` :
    hash?.startsWith('pending|em:') ? hash : null;
  if (!pendingHash) return null;
  return { hash: proof?.painted ? `${hash?.startsWith('unconfirmed|') ? 'unconfirmed|' : ''}em:${proof.identity}` : pendingHash, painted: proof?.painted === true };
}

/** Compare durable bounded history; retries cannot silently lose an escalation. */
export function newEmergencyEvents(stored: unknown, next: NativeEmergencyProof) {
  const previous = nativeEmergencyProofSchema.safeParse(stored);
  const key = (face: number, heldAtMs: number, e: {step: number; outcome: string; atMs: number}) =>
    `${face}:${heldAtMs}:${e.step}:${e.outcome}:${e.atMs}`;
  const seen = new Set(previous.success ? previous.data.faces.flatMap(f => f.events.map(e => key(f.face, f.heldAtMs, e))) : []);
  return next.faces.flatMap(f => f.events.filter(e => !seen.has(key(f.face, f.heldAtMs, e))).map(e => ({
    face: f.face, challenge: f.challenge, heldAtMs: f.heldAtMs, ...e,
    evidence: e.outcome === 'painted' ? 'page-overlay-paint' : 'no-overlay-paint-proof',
  })));
}
