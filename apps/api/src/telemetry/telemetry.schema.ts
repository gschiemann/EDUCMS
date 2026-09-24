import { z } from 'zod';

/**
 * telemetry.schema.ts — STRICT validation for the unified player telemetry
 * POST (2026-09-02, efficiency program P0-1 + lead security addendum).
 *
 * Three properties this file exists to guarantee, none of which a
 * hand-rolled `if (typeof x === 'number')` ladder gives you reliably:
 *
 *   1. UNKNOWN KEYS ARE REJECTED, not ignored. Every object is
 *      `z.strictObject`. A device (or something impersonating one) that
 *      sends an extra field gets a 400 instead of having it silently
 *      dropped — so a payload can never drift ahead of the column map
 *      without someone noticing, and a typo'd field name fails loudly at
 *      the first screen instead of being invisible fleet-wide.
 *   2. EVERY VALUE IS BOUNDED at the boundary. Strings have max lengths,
 *      numbers have ranges, and the whole parsed result is a fresh object —
 *      the raw client body never reaches Prisma.
 *   3. THE SHAPE IS THE DOCUMENTATION. `telemetry.types.ts` explains why
 *      each block exists; this file is what the server actually enforces,
 *      and the two are checked against each other by the compiler
 *      (`ScreenTelemetryBody` is inferred from here).
 *
 * ⚠️ Adding a field here is NOT enough to make it persist. The controller
 * writes only keys in its explicit `TELEMETRY_COLUMNS` allowlist, and
 * `telemetry.spec.ts` asserts every written key is in
 * `SCREEN_TELEMETRY_ONLY_FIELDS`. Three gates, on purpose.
 */

/** Hard ceiling on the JSON body, in bytes. Mirrored by the route-scoped
 *  body parser in `main.ts`, which enforces it BEFORE the body is parsed —
 *  this constant is the in-handler backstop for that. A real report is
 *  ~600 bytes; 32 KB is ~50× headroom. */
export const TELEMETRY_MAX_BODY_BYTES = 32 * 1024;

/** A cache tier: two non-negative counters, nothing else. */
const cacheTierSchema = z.strictObject({
  count: z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  bytes: z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
});

/** Frame-locked sync telemetry — same field set `/render-proof` accepts. */
const syncSchema = z.strictObject({
  locked: z.boolean().optional(),
  errMs: z.number().finite().nullable().optional(),
  clockUncertaintyMs: z.number().finite().nullable().optional(),
  rttMs: z.number().finite().nullable().optional(),
  contentSig: z.string().max(64).nullable().optional(),
  renderLeadMs: z.number().finite().nullable().optional(),
  skewPpm: z.number().finite().nullable().optional(),
});

/**
 * Video playback quality (2026-09-24) — ONE sample from the player's
 * `HTMLVideoElement.getVideoPlaybackQuality()` for the clip it most recently
 * finished (or has been looping): how many frames the decoder produced and
 * how many the compositor dropped. Sent only when the player has a NEW sample
 * since its last report; the server keeps the latest one per screen.
 */
const videoSchema = z.strictObject({
  /** The file's URL (or its last path segment) — matched to the asset by the dashboard. */
  url: z.string().max(512),
  totalFrames: z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER),
  droppedFrames: z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER),
  /** Wall-clock span the counters cover, ms. */
  elapsedMs: z.number().finite().min(0).max(86_400_000).optional(),
  width: z.number().finite().min(0).max(16_384).optional(),
  height: z.number().finite().min(0).max(16_384).optional(),
});

export const screenTelemetrySchema = z.strictObject({
  versions: z
    .strictObject({
      player: z.string().max(64).optional(),
      playerCode: z.number().finite().min(0).max(2_147_483_647).optional(),
      // `null`/`''` is the EXPLICIT "Manager is not installed" signal;
      // absent means "this build has no opinion". Both must survive
      // validation as distinct states — see the controller.
      manager: z.string().max(64).nullable().optional(),
      bundleSha: z.string().max(64).optional(),
      // 2026-09-21 — the identity the player actually decides to reload on
      // (a hash of the client-bundle build inputs, not the commit SHA).
      //
      // ⚠️ ROLLOUT ORDER. This object is a `strictObject`, so an API that
      // does not know this key answers 400 to the WHOLE report — which the
      // player grades `failed`, retries every 15 s, and whose render proof
      // then goes stale fleet-wide. The API therefore has to be live BEFORE
      // a player bundle that sends it. Accepting the key is harmless on its
      // own (nothing sends it until the new bundle ships), which is why the
      // API half of this change is a separate, deploy-first commit.
      bundleId: z.string().max(64).optional(),
    })
    .optional(),
  cache: z
    .strictObject({
      playlist: cacheTierSchema.optional(),
      emergency: cacheTierSchema.optional(),
    })
    .optional(),
  render: z
    .strictObject({
      frames: z.number().finite().min(0).optional(),
      hash: z.string().max(256).optional(),
      contentKind: z.string().max(32).optional(),
      sync: syncSchema.optional(),
    })
    .optional(),
  refreshAckMs: z.number().finite().min(0).optional(),
  capsHash: z.string().max(64).optional(),
  video: videoSchema.optional(),
});

export type ScreenTelemetryBody = z.infer<typeof screenTelemetrySchema>;
