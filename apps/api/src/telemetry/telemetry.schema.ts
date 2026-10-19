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

/**
 * The large file the player is downloading right now (2026-09-27, download
 * visibility). A file ≥ 8 MiB plays only once it is completely on disk
 * (readiness-gated playback, CLAUDE.md player rule 17), so until it is the
 * screen either shows its own "Downloading content" splash or keeps the
 * previous content on glass — and before this field the dashboard could not
 * tell either from "nothing scheduled". Sent only while a download is in
 * flight; the server keeps it inside `lastCacheReport` (no column of its own).
 *
 *   file           — the last path segment of the file's URL (the player caps
 *                    it at 120 chars; 256 here is headroom, the controller
 *                    re-caps at 120 and strips control characters)
 *   bytesLoaded    — bytes staged so far
 *   bytesTotal     — the file's size, when the player knows it
 *   deferredCommit — the NEW playlist is held back and the previous content
 *                    stays on glass until one of its files is complete
 *
 * ⚠️ ROLLOUT ORDER — same rule as `versions.bundleId` and `video.stalls`:
 * `cache` is a `strictObject`, so an API that does not know `downloading`
 * answers 400 to the WHOLE report. This API ships before the player bundle
 * that sends it (the player also drops the block for the rest of its session
 * if a report carrying it is refused — see `telemetry.ts` on the web side).
 */
const cacheDownloadingSchema = z.strictObject({
  file: z.string().max(256),
  bytesLoaded: z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER),
  bytesTotal: z
    .number()
    .finite()
    .min(0)
    .max(Number.MAX_SAFE_INTEGER)
    .nullable()
    .optional(),
  deferredCommit: z.boolean().optional(),
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
 *
 * `stalls` / `stalledMs` — the REBUFFER pauses in the same stretch: how many
 * times playback stopped mid-clip for lack of data, and the wall-clock time
 * it spent stopped. Dropped frames cannot see this at all — a file whose MP4
 * index sits at the end (no fast start) can drop nothing and still freeze
 * while the next bytes arrive. Optional: a player that predates the counter
 * sends neither, and absence means "not counted", never "never paused".
 *
 * ⚠️ ROLLOUT ORDER — same rule as `versions.bundleId`: this object is a
 * `strictObject`, so an API that does not know `stalls`/`stalledMs` answers
 * 400 to the WHOLE report. This API has to be live before a player bundle
 * that sends them.
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
  /** Rebuffer pauses in this stretch. */
  stalls: z.number().finite().min(0).max(1_000_000).optional(),
  /** Wall-clock ms spent inside those pauses. */
  stalledMs: z.number().finite().min(0).max(86_400_000).optional(),
  /**
   * Video guarantee, step 1 (2026-10-11) — what the per-file playback record
   * needs (`screen_file_playback`): the manifest digest of the file played,
   * which engine played it, whether it played from the verified offline cache,
   * how many videos were decoding in the document at report time, and whether
   * this is the first stretch after the clip went on glass. All optional;
   * absent means "the player did not say". ⚠️ Same rollout rule as `stalls`:
   * this API must be live before a bundle that sends them — and the bundle
   * drops them for a while after a 400 (`videoExtrasRefused`).
   */
  sha256: z.string().regex(/^[0-9a-fA-F]{64}$/).optional(),
  engine: z.enum(['native', 'continuous', 'twodeck', 'deck']).optional(),
  cached: z.boolean().optional(),
  first: z.boolean().optional(),
  concurrent: z.number().finite().min(0).max(64).optional(),
});

/**
 * What the WebView DECLARES it decodes smoothly (2026-10-11, video guarantee
 * step 1): `navigator.mediaCapabilities.decodingInfo` for four canonical H.264
 * configs, sent once per page boot. Optimistic by nature — see
 * `declaredMaxShortEdge` in @cms/api-types. ⚠️ Rollout: as above.
 */
const mediaCapsSchema = z.strictObject({
  webviewMajor: z.number().finite().min(0).max(10_000).optional(),
  configs: z
    .array(
      z.strictObject({
        id: z.enum(['1080p30-landscape', '1080p30-portrait', '2160p30-landscape', '2160p30-portrait']),
        supported: z.boolean(),
        smooth: z.boolean(),
        powerEfficient: z.boolean(),
      }),
    )
    .max(8),
});

/**
 * Loop-boundary quality (2026-09-29, video-loop audit F1/F2). What the player
 * MEASURED at the seam where a solo video starts over: how long the picture was
 * held past one frame period (`hold`) and how much of the opening/closing was
 * trimmed by a hand-off (`skip`), over a bounded window of recent boundaries.
 * Evidence is `requestVideoFrameCallback` — a frame reached the compositor, not
 * a camera pointed at the panel — so the dashboard must word it that way.
 *
 * ⚠️ ROLLOUT ORDER — same rule as `video.stalls`: this is a `strictObject`, so
 * an API that does not know `loop` answers 400 to the WHOLE report. This API
 * ships before the player bundle that sends it.
 */
const loopBoundarySchema = z.strictObject({
  /** `native` = the browser's own loop (a seek); `twodeck` = a prepared second element takes over. */
  backend: z.enum(['native', 'twodeck', 'continuous']),
  evidence: z.enum(['rvfc']),
  /** Boundaries observed in the window. */
  boundaries: z.number().finite().min(0).max(1_000_000_000),
  /** Worst / 95th-percentile / latest hold past one frame period, ms. */
  maxHoldMs: z.number().finite().min(0).max(600_000),
  p95HoldMs: z.number().finite().min(0).max(600_000),
  lastHoldMs: z.number().finite().min(0).max(600_000),
  /** Worst content trimmed by a hand-off (two-deck only; 0 for native), ms. */
  maxSkipMs: z.number().finite().min(0).max(600_000),
  /** Hand-offs completed / times the two-deck path gave up. */
  swaps: z.number().finite().min(0).max(1_000_000_000).optional(),
  fallbacks: z.number().finite().min(0).max(1_000_000_000).optional(),
  /** Why the two-deck path is not in use on this screen, when it is not. */
  fallbackReason: z.string().max(64).optional(),
});

/**
 * `POST /screens/:id/refresh-ack` — the ENTIRE body. One number: the exact
 * `refreshRequestedAt` value (ms) the page acted on. Value identity, never a
 * clock comparison (player rule 6).
 */
export const REFRESH_ACK_MAX_BODY_BYTES = 1024;
export const refreshAckSchema = z.strictObject({
  refreshAckMs: z.number().finite().min(0).max(8_640_000_000_000_000),
});

const safeCount = () => z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const code = () => z.string().regex(/^[a-z0-9-]{1,64}$/i);
/** `modeId:WxH@Hz` of an Android Display.Mode, as the APK formats it. */
const displayMode = () => z.string().regex(/^[0-9]{1,6}:[0-9]{1,5}x[0-9]{1,5}@[0-9]{1,4}(?:\.[0-9]{1,3})?$/);
/** Exactly the 16 interval buckets (NativeVideoTiming.kt): centred on k × P/4, bucket 4 = the source frame period. */
const intervalBuckets = () => z.array(safeCount()).length(16);
const compositionMode = () => z.enum(['dynamic_above', 'static_above']);
const layerMode = () => z.enum(['under_window', 'queued', 'revealing', 'above_window', 'retired']);

/**
 * 1.1.41 (2026-10-17, plan §4E / Astra STAB-01) — the glass-side measurement
 * on the native `timing` block: the render-callback interval histogram, the
 * display the surface lands on, the decoder's own drops, and the APK's
 * persisted history of recent sessions (bounded queue + explicit overflow).
 * All optional — every APK before 1.1.41 sends only the nine counters.
 * ⚠️ `strictObject`: the web reader copies only the keys named here, so an
 * APK field this API does not know never reaches it; and a page meeting an
 * OLDER API holds these keys back after a 400 (`videoExtrasRefused`).
 */
const nativeTimingMeasurement = {
  droppedFrames: safeCount().optional(),
  sourceFps: z.number().finite().gt(0).max(240).optional(),
  refreshRate: z.number().finite().min(0).max(1000).optional(),
  displayMode: displayMode().optional(),
  intervalUnitNs: safeCount().optional(),
  intervalBuckets: intervalBuckets().optional(),
  intervalCount: safeCount().optional(),
  intervalMinNs: safeCount().optional(),
  intervalMaxNs: safeCount().optional(),
  intervalLastNs: safeCount().optional(),
  intervalMeanNs: safeCount().optional(),
  // 1.1.42 (plan §4E, pacing): experiment 4's vsync snap — frames snapped, the
  // snap error (max / mean, µs), the cumulative SIGNED media-clock slew (the
  // measured drift between the clip's clock and the panel's vsync), the grid
  // (period in µs, samples) — experiment 5's mode request, and the window's
  // KEEP_SCREEN_ON flag as observed while the session presented.
  snappedFrames: safeCount().optional(),
  snapErrorMaxUs: safeCount().optional(),
  snapErrorMeanUs: safeCount().optional(),
  clockSlewUs: z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER).optional(),
  vsyncPeriodUs: safeCount().optional(),
  vsyncSamples: safeCount().optional(),
  // 1.1.43: the grid-sized release lead the session ran with (0.8 P on a 30 Hz grid, 0.5 P on 60 Hz).
  releaseLeadUs: safeCount().optional(),
  preferredModeApplied: z.number().int().min(0).max(1_000_000).optional(),
  keepScreenOn: z.boolean().optional(),
};
/** 1.1.43: what the panel FIRMWARE lists (sysfs, read-only, bounded, stripped to a safe set by the APK). */
const sysDisplayMode = () => z.string().regex(/^[A-Za-z0-9:_.*+/@-]{1,48}$/);
const sysDisplayCaps = () => z.array(z.string().regex(/^[A-Za-z0-9:_.*+/@-]{1,32}$/)).max(16);
/** Every mode the panel offers, `modeId:WxH@Hz`, as read when the session attached; bounded. */
const supportedModes = () => z.array(displayMode()).max(16);

const nativeTimingHistoryEntrySchema = z.strictObject({
  at: safeCount(),
  uptimeMs: safeCount().optional(),
  face: z.number().int().min(0).max(1).optional(),
  sha8: z.string().regex(/^[a-f0-9]{8}$/).optional(),
  build: z.string().regex(/^[0-9A-Za-z.+_-]{1,40}$/).optional(),
  protocol: z.union([z.literal(2), z.literal(3)]).optional(),
  composition: compositionMode().optional(),
  layer: layerMode().optional(),
  reason: code().optional(),
  recovered: z.boolean().optional(),
  /** Android BOOT_COUNT at write time: tells a device reboot from a process death on recovery. */
  bootCount: safeCount().optional(),
  elapsedMs: safeCount().optional(),
  fps: z.number().finite().gt(0).max(240).optional(),
  decodedFrames: safeCount().optional(),
  submittedFrames: safeCount().optional(),
  lateFrames: safeCount().optional(),
  maxLateUs: safeCount().optional(),
  maxSubmitGapMs: safeCount().optional(),
  loops: safeCount().optional(),
  uniqueFrames: safeCount().optional(),
  codecName: z.string().regex(/^[a-z0-9_.-]{1,128}$/i).optional(),
  webviewInvisible: z.boolean().optional(),
  surfaceFrameRate: code().optional(),
  // 1.1.42: whether the snap was applied, and experiment 5's result code, per session.
  vsyncSnap: z.boolean().optional(),
  prefer60hz: code().optional(),
  ...nativeTimingMeasurement,
});

/** The device class the APK resolved itself into (DeviceClassPolicy.kt), 1.1.41. */
const nativeDeviceClassSchema = z.strictObject({
  class: z.string().regex(/^[a-z]+\/android-[0-9]{1,2}$/),
  fleet: z.string().min(1).max(96).optional(),
  soc: z.enum(['amlogic', 'rockchip', 'novastar', 'other']),
  sdk: z.number().int().min(0).max(100),
  webviewMajor: z.number().int().min(0).max(10_000),
  nativeSolo: z.boolean(),
  composition: compositionMode().optional(),
  protocol3: z.boolean(),
  // Two values only (owner 2026-10-17: the Manager is never device owner).
  silentUpdate: z.enum(['installer-of-record', 'tap']),
  qualified: z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/).optional(),
  // 1.1.42: what the default display runs and offers, read live on every reply.
  refreshRate: z.number().finite().min(0).max(1000).optional(),
  activeMode: z.union([displayMode(), z.literal('')]).optional(),
  supportedModes: supportedModes().optional(),
  // 1.1.43: what the panel firmware itself lists (Amlogic `display/mode` + `disp_cap`, Rockchip `fb0/modes`).
  sysDisplayMode: sysDisplayMode().optional(),
  sysDisplayCaps: sysDisplayCaps().optional(),
});

const experimentFlags = z.strictObject({
  webviewInvisible: z.literal(true).optional(),
  surfaceFrameRate: z.literal(true).optional(),
  decoderRotation: z.literal(true).optional(),
  // 1.1.42
  vsyncSnap: z.literal(true).optional(),
  prefer60hz: z.literal(true).optional(),
});
const guardCodes = () => z.strictObject({
  webviewInvisible: code().optional(), surfaceFrameRate: code().optional(), vsyncSnap: code().optional(), prefer60hz: code().optional(),
});
const guardCounts = () => z.strictObject({
  webviewInvisible: safeCount().optional(), surfaceFrameRate: safeCount().optional(), vsyncSnap: safeCount().optional(), prefer60hz: safeCount().optional(),
});
/** The native experiments on this session (1.1.41 / 1.1.42): requested, applied, and the process-wide fault guard. */
const nativeExperimentsSchema = z.strictObject({
  requested: experimentFlags,
  applied: z.strictObject({
    webviewInvisible: z.boolean(), surfaceFrameRate: code().optional(),
    vsyncSnap: z.boolean().optional(), prefer60hz: code().optional(),
  }),
  guard: z.strictObject({ disabled: guardCodes(), applied: guardCounts() }),
});

/** Own native SurfaceView output callbacks; never HTML dropped-frame counters or panel illumination. */
const nativeVideoSchema = z.strictObject({
  timing: z.strictObject({
    decodedFrames: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    submittedFrames: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    lateFrames: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    lastLateUs: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    maxLateUs: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    maxSubmitGapMs: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    leadUs: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    sourceWidth: z.number().int().min(1).max(16_384),
    sourceHeight: z.number().int().min(1).max(16_384),
    ...nativeTimingMeasurement,
    // 1.1.42: the panel's mode list (live block only) and experiment 5's result code.
    supportedModes: supportedModes().optional(),
    preferredModeResult: code().optional(),
    history: z.strictObject({
      entries: z.array(nativeTimingHistoryEntrySchema).max(8),
      overflow: safeCount(),
      capacity: z.number().int().min(1).max(64).optional(),
    }).optional(),
  }).optional(),
  device: nativeDeviceClassSchema.optional(),
  experiments: nativeExperimentsSchema.optional(),
  version: z.literal(1), state: z.enum(['preparing','ready','presenting','failed']),
  sessionId: z.string().uuid(), revision: z.string().min(1).max(128),
  sha256: z.string().regex(/^[a-f0-9]{64}$/), faceIndex: z.number().int().min(0).max(1),
  reason: z.string().regex(/^[a-z0-9-]{1,64}$/i).optional(),
  codecName: z.string().regex(/^[a-z0-9_.-]{1,128}$/i).optional(),
  sessionProtocol: z.union([z.literal(2), z.literal(3)]).optional(),
  elapsedMs: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  stalls: z.number().int().min(0).max(1_000_000).optional(),
  loops: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  // Protocol 3 (2026-10-12): late frames the native renderer dropped, the
  // protocol the APK answered, and one bounded row per native SLOT (a mixed
  // playlist item or a template zone) so native and web can be compared per
  // screen type. Optional: a protocol-2 page never sends them.
  drops: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  protocol: z.number().int().min(1).max(3).optional(),
  zones: z.array(z.strictObject({
    slot: z.string().regex(/^(item|zone):[A-Za-z0-9_-]{1,64}$/),
    state: z.enum(['preparing','ready','presenting','failed']),
    held: z.boolean().optional(),
    ended: z.boolean().optional(),
    reason: z.string().regex(/^[a-z0-9-]{1,64}$/i).optional(),
    codecName: z.string().regex(/^[a-z0-9_.-]{1,128}$/i).optional(),
    uniqueFrames: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    drops: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    loops: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    elapsedMs: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    width: z.number().int().min(0).max(16_384).optional(),
    height: z.number().int().min(0).max(16_384).optional(),
  })).max(8).optional(),
  output: z.strictObject({
    attached: z.boolean(), visible: z.boolean(), hardwareAccelerated: z.boolean(),
    layerMode: z.enum(['under_window','queued','revealing','above_window','retired']).optional(),
    compositionMode: z.enum(['under_window','dynamic_above','static_above']).optional(),
    viewUpdates: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    uniqueFrames: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    sourcePtsUs: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    width: z.number().int().min(0).max(16_384), height: z.number().int().min(0).max(16_384),
    lastUpdateElapsedMs: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    ageMs: z.number().int().min(0).max(86_400_000),
  }).optional(),
});

/**
 * Off-hours web-bundle update, applied (2026-10-10). The document that came
 * up after the player reloaded itself onto a new bundle reports — ONCE, after
 * operator content was back on its glass — which window applied it, the zone
 * the window was read in, how the reload was covered, and the gaps it
 * measured. The controller records it on the screen's timeline
 * (`screen_events`, kind `update-applied`): one row per deploy per screen,
 * no column.
 *
 * ⚠️ ROLLOUT ORDER — `strictObject`: this API must be live before a player
 * bundle that sends it, or every report from that bundle is a 400.
 */
const updateAppliedSchema = z.strictObject({
  fromBundleId: z.string().max(64).nullable(),
  toBundleId: z.string().max(64).nullable(),
  window: z.enum(['display-off', 'idle', 'nightly']),
  boundary: z.enum(['now', 'item']),
  zone: z.string().max(64),
  zoneSource: z.enum(['schedule', 'device', 'utc']),
  capture: z.enum(['live', 'refetch', 'color', 'none']),
  blankMs: z.number().finite().min(0).max(86_400_000).nullable(),
  coverMs: z.number().finite().min(0).max(86_400_000).nullable(),
  converged: z.boolean(),
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
      downloading: cacheDownloadingSchema.optional(),
      // Native-first (design §6, 2026-10-19): where a v4 face's readiness
      // came from — the app's verified store or the service worker. Same
      // rollout as `downloading`: this API half ships first; a player
      // holds the key back for its session after a 400 that carried it.
      source: z.enum(['store', 'worker']).optional(),
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
  mediaCaps: mediaCapsSchema.optional(),
  nativeVideo: nativeVideoSchema.optional(),
  loop: loopBoundarySchema.optional(),
  update: updateAppliedSchema.optional(),
});

export type ScreenTelemetryBody = z.infer<typeof screenTelemetrySchema>;
