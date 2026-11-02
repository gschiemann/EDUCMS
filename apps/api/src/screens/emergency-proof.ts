import { z } from 'zod';

const token = () => z.string().regex(/^[A-Za-z0-9._:-]{1,64}$/);
/** Page-observed paint, never inferred from an emergency state or a live event loop. */
export const emergencyPaintSchema = z.strictObject({
  identity: token(),
  documentId: token(),
  challenge: z.string().uuid().optional(),
  nativeRequired: z.boolean().optional(),
  /**
   * The page read the APK's OWN verdict for this challenge over the bridge
   * (`sharedVideoState.emergencyProof.status === 'painted'`, same identity,
   * same document) — the receipt the APK accepted after its window checks
   * (2026-11-02). The heartbeat that carries that verdict to the API rides a
   * 5-minute floor while the page is reporting, so the page relays it.
   */
  nativeAccepted: z.boolean().optional(),
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
export type NativeEmergencyEpisode = NativeEmergencyProof['faces'][number];

const EMERGENCY_HASH = /^(?:pending\||unconfirmed\|)?em:/;

/**
 * A legacy em: signature alone only proves the alert was selected in React.
 *
 * 2026-11-02 (the SECURE drill where not one screen confirmed): the APK
 * accepted every screen's paint receipt within ~400 ms, but the heartbeat
 * carrying that verdict rides the 5-minute floor while the page reports, and
 * the page's own PAINTED post was refused against a stored episode that was
 * still `pending` (or absent) — then gave up after 1.5 s. Two rules close it:
 *  • the page may RELAY the APK's verdict (`nativeAccepted`, read over the
 *    bridge for this exact challenge); only a native verdict against the SAME
 *    challenge can contradict it;
 *  • a stored episode outlives the alert by up to one heartbeat, so it never
 *    grades an ordinary (`pl:` / `idle:`) proof as "alert not painted".
 */
export function emergencyRenderEvidence(hash: string | null | undefined, proof?: EmergencyPaint, episode?: NativeEmergencyEpisode) {
  const emergencyHash = EMERGENCY_HASH.test(hash ?? '');
  if (!proof && !emergencyHash) return null;
  // A native nonce means this page cannot speak for the Android window.
  // Wait for the native side's visibility/surface/foreground validation,
  // including when its first heartbeat has not reached the API yet.
  const nativeExpected = !!episode || !!proof?.challenge || proof?.nativeRequired === true;
  const sameChallenge = !!episode && !!proof?.challenge && proof.challenge === episode.challenge;
  const sameReceipt = sameChallenge && proof!.identity === episode!.identity && proof!.documentId === episode!.documentId;
  const nativeAccepted = sameReceipt && episode!.status === 'painted' && proof!.painted === true;
  // The APK's verdict for THIS challenge, relayed by the page before the
  // heartbeat lands. A stored verdict for the same challenge outranks it:
  // `unconfirmed`, or `painted` under another identity / document.
  const nativeContradicts = sameChallenge && (episode!.status === 'unconfirmed' || (episode!.status === 'painted' && !sameReceipt));
  const relayed = !!proof && proof.painted === true && !!proof.challenge && proof.nativeAccepted === true && !nativeContradicts;
  if (nativeExpected && !nativeAccepted && !relayed) {
    return { hash: `pending|em:${proof?.identity ?? episode!.challenge}`, painted: false };
  }
  const pendingHash = proof ? `pending|em:${proof.identity}` :
    /^(?:unconfirmed\|)?em:/.test(hash ?? '') ? `pending|${hash!.replace(/^unconfirmed\|/, '')}` :
    hash?.startsWith('pending|em:') ? hash : null;
  if (!pendingHash) return null;
  return { hash: proof?.painted ? `${hash?.startsWith('unconfirmed|') ? 'unconfirmed|' : ''}em:${proof.identity}` : pendingHash, painted: proof?.painted === true };
}

/**
 * The native heartbeat's own PAINTED verdict for a face (2026-11-02): the APK
 * accepted the page's receipt (two visible frames, this challenge, this
 * document) AND validated its window (attached, visible, opaque, interactive,
 * foreground, no native surface over it). That is the complete proof, whether
 * or not the page's own post ever got through — it completes the record and
 * the render timestamp exactly once per (challenge, identity).
 */
export function nativePaintedTransition(
  episode: NativeEmergencyEpisode | undefined,
  prior: { challenge?: string; status?: string; identity?: string } | undefined,
  lastRenderedHash: string | null | undefined,
): { hash: string; identity: string; challenge: string } | null {
  if (!episode || episode.status !== 'painted' || !episode.identity) return null;
  if (prior && prior.challenge === episode.challenge && prior.status === 'painted' && prior.identity === episode.identity) return null;
  const hash = `em:${episode.identity}`;
  if (lastRenderedHash === hash) return null;
  return { hash, identity: episode.identity, challenge: episode.challenge };
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
