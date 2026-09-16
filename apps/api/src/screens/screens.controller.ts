import { Controller, Post, Get, Put, Delete, Body, Param, Query, Req, Res, UseGuards, Request, HttpException, HttpStatus } from '@nestjs/common';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import type { Request as ExpressReq, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { withDbRetry } from '../prisma/with-db-retry';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';
// 2026-05-27 — player-hardware catalog. Used by PUT /screens/:id to
// validate hardwareModel against the known SKU list.
import {
  HARDWARE_CATALOG,
  HARDWARE_MODELS,
  resolveHardwareModel,
  type HardwareModel,
} from '@cms/api-types';
// 2026-09-16 — double-sided displays. One face = one Screen row; a face
// either MIRRORs its primary's content or resolves its OWN schedules. All
// the rules (and every refusal) live in this pure module.
import {
  DEFAULT_FACE_CONTENT_MODE,
  MAX_FACES_PER_UNIT,
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
import * as crypto from 'crypto';
import { safeFetch } from '../branding/safe-fetch';
import * as jwt from 'jsonwebtoken';
import { RedisService } from '../realtime/redis.service';
import { WebsocketSignerService } from '../security/websocket-signer.service';
import { LicenseService } from '../license/license.service';
import { StripeService } from '../billing/stripe.service';
// Menu-mgmt-at-scale (2026-05-29) — device-authed GET /screens/:id/menu
// resolves the screen's location → per-location menu via MenuService.
import { MenuService } from '../pos/menu.service';
import { requireSecret } from '../security/required-secret';
import { clientIpFromRequest } from '../security/client-ip';
import {
  getTenantState,
  setTenantState,
  shouldSkipLastPingWrite,
  markLastPingWritten,
  shouldSkipEmergencyAudit,
  markEmergencyAuditWritten,
  shouldSkipCacheReportWrite,
  markCacheReportWritten,
  shouldSkipRenderProofWrite,
  markRenderProofWritten,
  currentManifestContentRev,
  getManifestCache,
  setManifestCache,
  getManifestPreamble,
  setManifestPreamble,
} from './manifest-hot-cache';
import type { ManifestScreenRow } from './manifest-hot-cache';
// 2026-09-02 (efficiency P0-2/P0-3) — the cheap emergency-revision token
// served by GET /:id/emergency-rev. The manifest handler RECORDS what it
// decided (zero extra queries — every input was already read); the revision
// endpoint then answers "has anything changed?" from Redis + memory without
// touching Postgres, so the player stops paying for a full manifest build
// every 10 s just to learn that nothing happened.
import {
  emergencySignature,
  noteScreenEmergencyState,
  noteScreenScheduleBoundary,
  resolveEmergencyRev,
} from './emergency-rev';
// 2026-08-30 — deterministic manifest schedule ordering (reliability W1-8):
// effective replace winner first, labeled mode/pin, replica-stable ties.
import { orderSchedulesForManifest } from './effective-schedule';
// 2026-09-16 — "keep screens in sync" moved from ScreenGroup.syncMode to
// Playlist.syncPlayback. One rule, shared by the manifest and the fleet list,
// so they can never disagree about who is frame-locked.
import { resolveScreenSync, readSyncActiveTargets, isScreenSyncActive } from './screen-sync';
// 2026-09-02 (efficiency program P0-1) — the ONLINE grace is now paired with
// the unified telemetry cadence and lives in ONE place that documents the
// relationship. It was three inline `35 * 1000` literals sized for a 30 s
// heartbeat; a screen now reports once a minute, and 35 s against a 60 s
// cadence would read the entire healthy fleet as OFFLINE. See online-grace.ts
// for the derivation and for the detection-speed cost it accepts.
import { SCREEN_ONLINE_GRACE_MS } from '../telemetry/online-grace';
// 2026-08-13 — display control. The manifest's `display` block carries the
// on/off windows the player arms as LOCAL AlarmManager alarms (a screen with
// the network cut must still blank at 22:00 and wake at 07:00) plus the
// vendor-recipe catalog it matches against its own Build.* identity.
// Surfaced on every manifest branch (emergency / sports / normal) for the
// same reason `gpio` is: a screen sitting in emergency or scoreboard mode
// must not be handed a manifest that looks like "no schedules" and disarm
// its alarms. Every field is stable and DB-sourced — see the header of
// display-manifest.ts before adding anything to it.
import { buildDisplayManifestBlock } from '../display/display-manifest';
// 2026-05-27 — Goodview EP6N GPIO state. Surfaced on every manifest
// branch (emergency / sports / normal) so the player applies the
// out1 / out2 lamp + horn states regardless of which path served it.
import { readGpioState } from './gpio.service';
// 2026-05-27 round 2 — auto-detect hardwareModel from the userAgent
// the player sends on /register. Closes the loop on the pair-modal
// strip (commit f293f99): operator no longer types a hardware model,
// so the server has to infer it. inferIfUnknown() returns null when
// the column is already set, so we never overwrite a manual override.
import { inferIfUnknown } from './hardware-detect';
// 2026-05-29 — render-proof heartbeat (proof-of-display). Surfaces a
// frozen-but-TCP-reachable kiosk as degraded/RED on the fleet list even
// when lastPingAt is fresh. Pure helper so the verdict is unit-tested
// without a Prisma client (same discipline as ScreenWedgeDetectorCron.decide).
import { deriveRenderHealth } from './render-proof';
import { recordPushDeployment, type RecordPushDeploymentOpts } from './deployment-record';
// 2026-08-03 security wave (DT-01…DT-05): the single device-credential
// verification path + the revocation writer. Read `device-auth.ts` before
// touching anything device-authenticated in this file.
import {
  verifyDeviceForScreen as verifyDeviceForScreenShared,
  invalidateDeviceCredentialCache,
  isEpochAcceptable,
  epochFromClaim,
  decodeDeviceTokenUnsafe,
  isUnprovenDeviceClaim,
  DEVICE_JWT_ALGORITHMS,
  DEVICE_TOKEN_TTL_PAIRED,
  DEVICE_TOKEN_TTL_UNPAIRED,
  DEVICE_TOKEN_TTL_UNPROVEN,
  DEVICE_TOKEN_AUD_BOOTSTRAP,
  CREDENTIAL_SHARED_TTL_SECONDS,
  setDeviceCredentialSharedStore,
  publishDeviceCredentialState,
} from './device-auth';
import { revokeScreenCredentials, rotateScreenCredentialEpoch } from './device-credentials';
// 2026-09-08 (school-security audit item 3 / internal F-D) — the
// per-fingerprint admission floor for `GET /screens/status/:fp`. Composes with
// the global per-IP throttler and the P0-7 per-device key; read that file's
// header before changing the cap.
import { acceptStatusPoll } from './status-poll-throttle';
import { mintStreamTicket } from './stream-ticket';
// 2026-08-03 — district-wide emergency propagation. The emergency branch of
// the manifest resolves a screen's alert from its OWN tenant row; this bound
// lets it fall back to the nearest ANCESTOR tenant that is in emergency. See
// `resolveAncestorEmergencyState` below and `emergency/tenant-hierarchy.ts`.
import { MAX_TENANT_TREE_DEPTH } from '../emergency/tenant-hierarchy';
import { ADMIN_ROLES_FOR_SCREEN_SECRETS } from '../security/screen-secrets';

const PAIRING_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// DT-04's role set now lives in ../security/screen-secrets so every route
// that returns Screen rows shares ONE rule. It was a private const here, and
// the consequence was AUTHZ-01: `GET /screen-groups` embeds the same rows and
// never got the strip, so the fingerprint kept leaking to CONTRIBUTOR and
// RESTRICTED_VIEWER on a sibling route. Import it; do not re-declare it.

/**
 * AUTHZ-03 (2026-08-04) — collapse CR/LF before interpolating a
 * client-controlled value into a log line.
 *
 * `POST /screens/status/:fp/crash-report` is unauthenticated by design, and its
 * body is echoed into the Railway stream the operator actually scans. Without
 * this, a forged report can embed newlines and write convincing fake entries
 * beneath its own — log injection against the one surface where this data is
 * read today.
 */
export function oneLineLog(value: string | null | undefined): string {
  return String(value ?? '').replace(/[\r\n\u2028\u2029]+/g, ' ');
}

/**
 * Parse a device-reported resolution string into pixel dimensions.
 *
 * Players report "2160×3840" using U+00D7 MULTIPLICATION SIGN, not an ASCII
 * 'x' — an ASCII-only parser silently matches nothing and every caller
 * quietly falls back to its default. Accept both, plus '*'.
 */
export function parseReportedResolution(
  resolution: string | null | undefined,
): { w: number; h: number } | null {
  const m = /^\s*(\d{2,6})\s*[x×X*]\s*(\d{2,6})\s*$/.exec(
    typeof resolution === 'string' ? resolution : '',
  );
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return { w, h };
}

/**
 * Resolve the orientation value the MANIFEST should carry for a screen.
 *
 * ⚠️ WHY 'AUTO' CANNOT SIMPLY BE PASSED THROUGH (2026-08-24).
 *
 * 'AUTO' maps, on the device, to SCREEN_ORIENTATION_UNSPECIFIED — "release the
 * lock and let the sensor decide". **Signage panels have no accelerometer.**
 * So on this hardware AUTO is not auto-detection at all; it is a no-op that
 * defers to whatever the firmware defaults to, which is frequently landscape
 * even on a physically portrait panel. The player's CSS rotate fallback — the
 * safety net for ROMs that ignore the Android orientation API outright — is
 * ALSO gated on the literal value 'PORTRAIT', so an AUTO screen gets no
 * fallback either. Operator, on two 2160×3840 panels: "2160x3840 is
 * portrait....make them auto and have it work properly."
 *
 * He is right that AUTO should mean "figure it out", so we figure it out here,
 * where we know the panel: the device reports `resolution` from the APK's
 * WindowManager.maximumWindowMetrics — the REAL physical pixel count, not the
 * DPI-scaled CSS value and not the currently-rendered viewport. Both portrait
 * boxes reported 2160×3840 while actively being forced to render landscape,
 * which is what makes it a trustworthy signal rather than a circular one.
 *
 * The stored column is NOT changed — the operator's intent ("auto") is
 * preserved and still shown as Auto in the dashboard. Only the value handed to
 * the device is resolved, so the existing, proven PORTRAIT path (native
 * request + CSS fallback) does the work.
 *
 * An explicit LANDSCAPE/PORTRAIT is always passed through untouched: an
 * operator overriding their panel (a deliberately sideways-mounted screen) must
 * win over anything we infer.
 *
 * If the resolution is missing or unparseable we return 'AUTO' unchanged rather
 * than guessing — deferring is honest; asserting an orientation we cannot
 * justify is the bug this whole area keeps producing.
 *
 * Manifest-cache safe: derived purely from two stable Screen columns, with no
 * per-request or clock-derived input (CLAUDE.md manifest content cache rule 7).
 */
export function resolveManifestOrientation(
  orientation: string | null | undefined,
  resolution: string | null | undefined,
  hardwareModel?: string | null,
): 'LANDSCAPE' | 'PORTRAIT' | 'AUTO' {
  // ── A NovaStar LED poster NEVER rotates natively (2026-09-02, "Foldable LED"
  // field find). The LED shows the top-left of the controller's frame buffer;
  // a native setRequestedOrientation(PORTRAIT) rotates that buffer and the
  // glass goes black. The poster's shape comes from the pinned LED canvas
  // (posterCanvas.ts), not from Android orientation — so whatever the row
  // says (an operator tap on the on-device buttons, an old registration
  // derivation), the manifest tells the player AUTO, which releases any lock.
  if (hardwareModel === 'novastar-taurus') return 'AUTO';
  const raw = typeof orientation === 'string' ? orientation.toUpperCase() : '';
  if (raw === 'LANDSCAPE' || raw === 'PORTRAIT') return raw;
  if (raw !== 'AUTO') return 'LANDSCAPE'; // null/empty/unknown → historical default

  // ⭐ THE CHASSIS BEATS THE FRAMEBUFFER (2026-08-24).
  //
  // Some hardware only exists one way up. A MAXHUB L55VEC is a floor-standing
  // portrait kiosk that CANNOT be mounted landscape — and it reports a
  // 3840x2160 LANDSCAPE framebuffer, so the resolution check below gets it
  // exactly backwards and an operator had to set portrait by hand on a unit
  // that is only ever portrait.
  //
  // When the catalog says a chassis has a fixed orientation, that is a
  // hardware fact and outranks anything the panel reports about itself. Only
  // models that genuinely cannot be rotated carry `nativeOrientation`; a panel
  // an operator MIGHT hang either way stays undeclared and falls through, so
  // this can never override a real installation choice.
  const native = hardwareModel
    ? HARDWARE_CATALOG[hardwareModel as HardwareModel]?.nativeOrientation
    : undefined;
  if (native) return native;

  const dims = parseReportedResolution(resolution);
  if (!dims) return 'AUTO';
  return dims.h > dims.w ? 'PORTRAIT' : 'LANDSCAPE';
}

/**
 * The tenant's standard LED poster module size for the manifest
 * (2026-09-01). NovaStar TB posters cannot report their LED size and the
 * controller's OS resolution floors at 600 wide, so the PLAYER derives a
 * poster-class screen's canvas from this standard + the OS width
 * (apps/web/src/app/player/posterCanvas.ts) whenever no explicit canvas is
 * set. Null columns = the built-in 320×1080 (1.86 mm) default. A stable
 * tenant column, never a clock — safe for the verbatim-replayed manifest
 * cache (busts on the Tenant write like every other tenant field here).
 */
export function manifestPosterStandard(
  tenant: { posterStandardW?: number | null; posterStandardH?: number | null } | null | undefined,
): { w: number; h: number } {
  const w = Number(tenant?.posterStandardW);
  const h = Number(tenant?.posterStandardH);
  if (Number.isFinite(w) && Number.isFinite(h) && w >= 32 && h >= 32 && w <= 8192 && h <= 8192) {
    return { w: Math.round(w), h: Math.round(h) };
  }
  return { w: 320, h: 1080 };
}

function generatePairingCode(length: number = 6): string {
  // sec-fix(wave1) #3: use crypto.randomInt (CSPRNG) instead of
  // Math.random() (predictable xorshift). Same alphabet; default
  // length 6 — but FIX (player-009) callers can request length 8
  // when collision-retry exhausts the 6-char namespace.
  let code = '';
  for (let i = 0; i < length; i++) {
    code += PAIRING_CODE_ALPHABET[crypto.randomInt(0, PAIRING_CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * Device auth for this controller.
 *
 * 2026-08-03 (DT-05): the inline copy that used to live here checked only
 * `signature + kind + sub`. It skipped the revocation list, the
 * `status === 'REVOKED'` check, and the live-row read that the
 * `JwtAuthGuard` path enforces — on nine routes, including `/gpio-event`
 * (fabricate a LOCKDOWN) and `/unpair/:fp` (delete every schedule on the
 * screen). There is now exactly ONE implementation, in `./device-auth`,
 * and every device-authenticated route in the app calls it. See that file
 * for the full check order and the fleet-grandfathering rules.
 */
type DeviceAuthOutcome = Awaited<ReturnType<typeof verifyDeviceForScreenShared>>;

/**
 * What `heartbeatProvesDevice` answers for the anonymous-by-design
 * `status/:deviceFingerprint` family.
 *
 * THREE STATES, NOT TWO — this is the whole point (school-security audit item
 * 3 / internal F-D, 2026-09-08). The old boolean collapsed "brought no
 * credential" and "brought a credential that does not verify" into the same
 * `false`, so a caller who presented a forged, expired or foreign token was
 * handed the anonymous path — and the anonymous path used to WRITE.
 *
 *   presented=false            → a bare, credential-less poll. Legitimate: the
 *                                pairing splash and the shipped Kotlin
 *                                `HeartbeatService` both send no header.
 *   presented=true, proved=false → the caller ASSERTED an identity and the
 *                                assertion failed. On a paired screen this is
 *                                a 401, never a downgrade to anonymity.
 *   proved=true                → `verifyDeviceForScreen` accepted it against
 *                                the LIVE row (signature, kind/sub, denylist,
 *                                `status !== 'REVOKED'`, credential epoch,
 *                                and SEC-001's unproven refusal).
 */
interface HeartbeatCredentialVerdict {
  /** Did the request carry ANY device-credential material at all? */
  presented: boolean;
  /** Did it verify against this screen's live row? */
  proved: boolean;
  /** `verifyDeviceForScreen`'s refusal reason, for the 401 body. */
  reason: string | null;
}

// sec-fix(P0 #7) Defense 1: per-fingerprint registration cooldown.
// @Throttle keys on IP, which is sufficient for the bulk case, but a
// single attacker with one IP rotating fingerprints could still enumerate.
// This Map adds a server-side 15-minute cooldown per fingerprint so that
// each guessed fingerprint can only be attempted once per window.
// In-memory is intentional: this is a rate-control fence, not an audit
// log. A server restart resets it, but the attacker still faces the IP
// throttle (5/hr) as the primary guard.
// Exported for unit-test access only — do not use outside this module.
export const _registerFpCooldown = new Map<string, number>(); // fingerprint → last-register ms
// 2026-05-06 (third attempt) — operator: STILL 429 even with 60 s
// cooldown. Root cause: the React app's exponential backoff caps
// at 30 s, so attempts 2/3/4 ALL fire inside the 60-s cooldown
// window from attempt 1. Once a fingerprint enters cooldown, the
// retry chain can't escape it without a 60+ s gap which the
// backoff never produces.
//
// FINAL fix: drop cooldown to 5 SECONDS. That's enough to slow
// a malicious enumeration cycle (max 1 FP attempt every 5 s = 720
// /hr per FP, well below the per-IP register cap of 300/hr) but
// short enough that ANY natural kiosk retry chain (2-30 s
// backoffs) escapes the cooldown on its very next tick.
//
// Per-FP cooldown is now a "rapid-fire same-FP" defense, not a
// "first-time bring-up gate". Aligned with how rate-limits should
// actually work for legitimate kiosks.
export const REGISTER_FP_COOLDOWN_MS = 5 * 1000; // 5 seconds (was 60 s, was 15 min)

// Sprint 13 — per-screen rate floor for CTS game-state POSTs. Map
// of screenId → last accepted POST timestamp (ms). Read + written
// only by the postGameState handler. Map is bounded at 500 entries
// with a 60s eviction sweep inside the handler.
// Exported for unit-test access only — do not use outside this module.
export const _gameStateRateMap = new Map<string, number>();

@Controller('api/v1/screens')
export class ScreensController {
  /** Most ids stored on a Deployment row. `targetCount` always carries the
   *  real number, so a fleet past this cap still reports honestly — only the
   *  live convergence read is bounded to the stored slice. */
  private static readonly DEPLOYMENT_TARGET_ID_CAP = 1000;

  /** Above this target count a push writes NO per-screen ScreenEvent rows
   *  (the Deployment row still records it). One operator click must not
   *  become thousands of inserts. */
  private static readonly DEPLOYMENT_EVENT_FANOUT_CAP = 200;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly signer: WebsocketSignerService,
    private readonly license: LicenseService,
    private readonly stripe: StripeService,
    private readonly menu: MenuService,
  ) {
    // 2026-09-02 (efficiency P0-2) — hand `device-auth.ts` a cross-replica
    // home for the credential snapshot. This is where a Redis handle and that
    // module first meet in the graph. Two effects, both required by the
    // emergency-revision endpoint:
    //   • READ (opt-in, extended-window callers only) so the 10 s revision
    //     poll is not one indexed Postgres read per screen per poll;
    //   • DEL on every `invalidateDeviceCredentialCache`, so a revoke on ANY
    //     replica is enforced on every other replica's very next request
    //     rather than at the end of a TTL.
    // Registration is idempotent and safe to repeat (one controller instance).
    //
    // FEATURE-DETECTED, not assumed. `RedisService` is injected in a dozen
    // shapes across the test suite and could be an older build in a partial
    // deploy; registering a store whose methods do not exist would throw
    // inside `loadCredentialState` — i.e. inside EVERY device-authenticated
    // route, not just this one. If the trio is not there, no store is
    // registered and every read falls through to Postgres exactly as before.
    const redisAny = this.redisService as unknown as Record<string, unknown>;
    const hasStringStore =
      typeof redisAny?.getString === 'function' &&
      typeof redisAny?.setString === 'function' &&
      typeof redisAny?.delKey === 'function';
    setDeviceCredentialSharedStore(
      hasStringStore
        ? {
            get: (screenId) => this.redisService.getString(`venueos:devcred:${screenId}`),
            set: (screenId, value, ttlSeconds) =>
              this.redisService.setString(`venueos:devcred:${screenId}`, value, ttlSeconds),
            // A real DEL, never a tombstone: writing 'null' here would be read
            // back as a NEGATIVE snapshot ("this screen does not exist") and
            // 401 a perfectly valid device for the length of the TTL.
            del: (screenId) => this.redisService.delKey(`venueos:devcred:${screenId}`),
          }
        : null,
    );
  }

  /**
   * Credential-snapshot age the emergency-revision endpoint may accept on its
   * CHEAP (unchanged) path. Capped at the shared-store TTL so the two tiers
   * cannot disagree. Any revision CHANGE re-verifies at the normal 5 s
   * freshness before anything is disclosed — see `getEmergencyRev`.
   */
  private static readonly EMERGENCY_REV_CREDENTIAL_MAX_AGE_MS =
    CREDENTIAL_SHARED_TTL_SECONDS * 1000;

  /**
   * Per-screen floor between revision polls. The player's FASTEST cadence is
   * 5 s, so this is 2.5x headroom for a healthy device and a hard wall for a
   * stolen token trying to use the cheapest authenticated endpoint we have as
   * a hammer. In-process (numReplicas = 1) — the global 600/min per-IP
   * throttler still applies on top.
   */
  private static readonly EMERGENCY_REV_MIN_INTERVAL_MS = 2_000;

  private static readonly emergencyRevLastServed = new Map<string, number>();

  /**
   * Device auth, one place. Delegates to the shared verifier so the
   * revocation / REVOKED-status / credential-epoch checks can never drift
   * apart between routes again (DT-05).
   */
  private deviceAuth(
    req: ExpressReq,
    screenId: string,
    // `credentialMaxAgeMs` is an OPT-IN longer window on the live-row snapshot
    // (never shorter than the 5 s default). Exactly one caller passes it —
    // `GET /:id/emergency-rev`, whose unchanged path must do zero Postgres
    // work — and that caller re-verifies at normal freshness the moment the
    // revision moves. Do not spread it to other routes.
    // `allowUnproven` (SEC-001, 2026-09-04) is deliberately NOT surfaced here:
    // no route in this controller may accept a credential minted from a
    // fingerprint alone. Adding it would need a code change AND a route-
    // inventory decision (screens.device-route-inventory.spec.ts).
    opts?: { allowUnpaired?: boolean; credentialMaxAgeMs?: number },
  ): Promise<DeviceAuthOutcome> {
    return verifyDeviceForScreenShared(
      { prisma: this.prisma, redis: this.redisService },
      req,
      screenId,
      opts,
    );
  }

  private async notifySync(tenantId: string) {
    try {
      const message = this.signer.signMessage('SYNC', { source: 'screen_update' });
      await this.redisService.publish(`tenant:${tenantId}`, message);
    } catch (e) {}
  }

  // ─── PUBLIC: Device self-registration (no auth) ───
  // The player opens, sends its device info, gets back a pairing code
  // sec-fix(P0 #7) Defense 1: per-IP throttle on the register endpoint
  // + per-fingerprint 15-minute cooldown (enforced below in handler —
  // ONLY for unpaired fingerprints; see hotfix history).
  //
  // Throttle history:
  //   v1: 5/hr   — bricked a pilot kiosk during an OTA-driven
  //                re-register loop (2026-04-28 hotfix → 30/hr).
  //   v2: 30/hr  — bricked a school's NEW kiosk install on
  //                2026-05-06: school NAT means all ~10-30 existing
  //                kiosks + dashboard users share ONE public IP, and
  //                normal OTA / reboot churn easily exceeds 30/hr per
  //                IP. The new kiosk's register fired → 429 → web
  //                player stuck on "Reconnecting Registration HTTP
  //                429" with no path forward (operator has no way
  //                to reset the per-IP counter).
  //   v3: 300/hr — bricks a single hot kiosk in retry-storm mode.
  //   v4: 1500/hr — operator's IP STILL hit it after a multi-hour
  //                retry storm on a fresh TB40 sideload (cumulative
  //                count over the rolling window).
  //   v5: REMOVED — per-IP throttle dropped ENTIRELY via @SkipThrottle().
  //                The v5 comment claimed "global 600/min throttle on the
  //                controller (catches bulk bursts)" was still a defense —
  //                that was WRONG: @SkipThrottle() removes the global
  //                throttler too, so there was NO IP-based limit of ANY
  //                kind on this endpoint. Combined with the per-FP cooldown
  //                exempting brand-new/unknown fingerprints (the cooldown
  //                only slows a REPEAT of the SAME fp; a flood of UNIQUE
  //                fingerprints never trips it), a single unauthenticated
  //                source could create unbounded Screen rows (DB bloat /
  //                resource exhaustion, fills tenant screen lists).
  //                (sec P2 — 2026-07-03.)
  //   v6: 120/min PER IP (@Throttle, this window). Restores a per-IP wall
  //                that is GENEROUS enough to never brick a legit rollout
  //                yet stops the flood:
  //                • This is a PER-MINUTE window (ttl 60_000, matching the
  //                  global throttler + trust-proxy-1 → keys on the real
  //                  client IP via X-Forwarded-For). It RESETS every minute,
  //                  so unlike the old v1-v4 HOURLY windows it never
  //                  accumulates over a multi-hour retry storm — the exact
  //                  cause of the v2/v4 NAT bricking is gone.
  //                • 120/min matches player-ota `update-check` — the OTHER
  //                  public endpoint every kiosk in a NAT'd building hits on
  //                  boot. A synchronized reboot/OTA of a large building
  //                  (dozens of kiosks + dashboard users on ONE public IP)
  //                  registers ~once per kiosk; even with a retry or two it
  //                  stays well under 120/min since register is called far
  //                  LESS often than update-check. Legit installs of dozens
  //                  of screens succeed.
  //                • An attacker spamming UNIQUE fingerprints from one source
  //                  is now capped at 120 Screen rows/min/IP instead of
  //                  unbounded (600/min+ before). Defense-in-depth still
  //                  includes the per-FP 5 s cooldown (rapid same-fp) and the
  //                  natural DB-write cost. Paired kiosks re-registering are
  //                  unaffected functionally — only the rare over-limit burst
  //                  from ONE IP is 429'd, and the client retries.
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Post('register')
  async register(@Body() body: {
    deviceFingerprint: string;
    resolution?: string;
    osInfo?: string;
    browserInfo?: string;
    userAgent?: string;
    /** sec-fix(P0 #5): Paired re-registration — caller sends its currently
     *  stored device JWT to prove possession of the prior credential.
     *  Present in kiosk builds ≥ v1.0.34. A caller that omits it now always
     *  receives a 1-hour token + `requiresRePair` (DT-04 removed the
     *  STRICT_REPAIR_AUTH escape hatch that used to make omitting it mint a
     *  full-lifetime credential by default). */
    priorDeviceToken?: string;
  }, @Req() req: ExpressReq) {
    if (!body.deviceFingerprint) {
      throw new HttpException({ code: 'SCREEN_FINGERPRINT_REQUIRED', message: 'Device fingerprint is required' }, HttpStatus.BAD_REQUEST);
    }

    // Preview mode fingerprints (set by the dashboard's "Open in Browser" button)
    // must NEVER create a Screen row or update lastPingAt on an existing row.
    // Return a synthetic not-paired payload so the preview player can still
    // render content via the manifest endpoint (using its admin JWT).
    if (body.deviceFingerprint.startsWith('preview-')) {
      return {
        screenId: null,
        pairingCode: null,
        paired: false,
        name: 'Preview',
        deviceToken: null,
        isPreview: true,
      };
    }

    // Check if this device is already registered. We do this BEFORE the
    // per-fingerprint cooldown so paired kiosks can re-register freely
    // (no enumeration risk: the FP is already known + claimed).
    const existing = await this.prisma.client.screen.findUnique({
      where: { deviceFingerprint: body.deviceFingerprint },
    });

    // sec-fix(P0 #7) Defense 1: per-fingerprint cooldown — ONLY for
    // unpaired/unknown fingerprints. The cooldown defends against an
    // attacker cycling fingerprint guesses to enumerate Screen rows.
    // An already-paired kiosk re-registering (e.g. after OTA install,
    // localStorage wipe, or webview restart) is legitimate and must not
    // be blocked: that loop would brick the kiosk on every upgrade.
    // 2026-04-28 hotfix: this exemption was missing; pilot kiosk hit a
    // 429 register loop the moment v1.0.35 force-pushed.
    const fpKey = body.deviceFingerprint;
    if (!existing || !existing.tenantId) {
      const lastRegTs = _registerFpCooldown.get(fpKey);
      if (lastRegTs !== undefined && Date.now() - lastRegTs < REGISTER_FP_COOLDOWN_MS) {
        throw new HttpException({ code: 'SCREEN_REGISTER_RATE_LIMITED', message: 'Too Many Requests: fingerprint registered a moment ago, retry in a few seconds' }, HttpStatus.TOO_MANY_REQUESTS);
      }
      _registerFpCooldown.set(fpKey, Date.now());
      // Prune stale entries to avoid unbounded growth.
      if (_registerFpCooldown.size > 10_000) {
        const cutoff = Date.now() - REGISTER_FP_COOLDOWN_MS;
        for (const [k, ts] of _registerFpCooldown) {
          if (ts < cutoff) _registerFpCooldown.delete(k);
        }
      }
    }

    // Device JWT — tied to this screenId + fingerprint. Browser players
    // have no /devices/pair code-exchange flow (the pairing code is null'd
    // as soon as an admin claims), so /screens/register mints the token
    // here and the player stores it. Before admin claim the token can't
    // see any tenant data (manifest 404s); after claim the same token
    // gains access to the newly-bound tenant's manifest automatically.
    //
    // sec-fix(P0 #7) Defense 2: unpaired tokens expire in 15 minutes so a
    // stolen or guessed pre-claim token is worthless once the window lapses.
    //
    // sec-fix(P0 #5) Graduated trust for paired re-registration, as it
    // stands after the 2026-08-03 wave:
    //   - Caller proves possession of a CURRENT prior device JWT → 180-day
    //     token, and the credential epoch ROTATES (DT-02).
    //   - Caller presents a SUPERSEDED/revoked credential → 1-hour token +
    //     requiresRePair, audited as a fork. Deliberately not a 401: a hard
    //     reject would let whoever rotates first deliberately black out a
    //     real screen.
    //   - Caller has fingerprint only → 1-hour token + requiresRePair.
    //   - Prior token INVALID (wrong screenId) → hard 401.
    //   - Prior token EXPIRED → downgrade to 1-hour fallback (don't reject,
    //     legitimate kiosk may have had its token expire mid-day).
    //
    // 2026-08-03 (DT-04) — the `STRICT_REPAIR_AUTH=false` legacy branch is
    // GONE. It was a fleet-migration ramp for kiosks ≤ v1.0.33 that could
    // not send `priorDeviceToken`; prod has been pinned at v1.0.63 since
    // 2026-07-18, so the ramp is finished. While it existed, a bare device
    // FINGERPRINT — a value `GET /screens` hands to every CONTRIBUTOR and,
    // via the RBAC GET pass-through, every RESTRICTED_VIEWER — minted a
    // full-lifetime device credential for any screen in the tenant. The
    // insecure behaviour was the DEFAULT (the env var is absent from
    // .env.example and from the CLAUDE.md table), so every re-provision,
    // new region, staging stack and self-hosted install silently landed on
    // it. Strict is now unconditional: fingerprint-only re-registration
    // gets a 1-hour token and `requiresRePair`, never a long-lived one.

    const deviceJwtSecret = requireSecret('DEVICE_JWT_SECRET', { devFallback: 'dev_only_device_jwt_secret_CHANGE_ME' });

    // CYCLE-3 emergency-011: include `deviceId` and `tenantId` in the payload.
    // The realtime gateway (apps/api/src/realtime/realtime.gateway.ts:125-127)
    // reads `decoded.deviceId` / `decoded.tenantId` to populate ClientContext
    // and route signed WS broadcasts via broadcastToScope. Without these
    // fields the match `ctx.deviceId === id` / `ctx.tenantId === id` always
    // fails in production and every emergency event drops on the WS path
    // (players fall back to 10s HTTP polling — life-safety regression).
    //
    // `sub` and `deviceId` carry the same screenId — `sub` is the JWT
    // standard claim and is preserved so existing verifiers
    // (player-logs.controller, verifyDeviceForScreen, verifyPriorToken,
    // JwtAuthGuard) continue to work unchanged. The dev-only
    // `dev_<screenId>_<tenantId>` token branch in the gateway already
    // populates these fields, which masked the prod bug.
    //
    // BACKWARD COMPAT: existing paired kiosks hold tokens minted before
    // this fix that lack deviceId/tenantId. Those tokens still parse
    // (additive payload only), but their WS broadcastToScope match will
    // continue to fail until the device re-fetches a token via the next
    // /screens/register or /devices/pair round-trip. HTTP-polling
    // fallback keeps those screens functional in the meantime.
    //
    // For unpaired devices (no tenant claim yet) tenantId is omitted —
    // they aren't subscribed to any tenant scope until claimed.
    //
    // 2026-08-03 (DT-02):
    //   • `ep` — the screen's credential epoch. This is what makes the
    //     credential revocable at all (see device-auth.ts). A token minted
    //     before this claim existed reads as epoch 0, which is the column
    //     default, so the whole deployed fleet keeps working untouched.
    //   • the `fp` claim is GONE. It made the token carry its own renewal
    //     key: base64-decode the payload (no secret needed), read the
    //     fingerprint, POST it back to /register, receive a brand-new
    //     full-lifetime token, repeat forever. Nothing in the API reads
    //     `fp` off a device principal, so dropping it is inert for
    //     behaviour and removes the self-renewal primitive.
    //   • paired TTL is 180 d, not 365 d. See DEVICE_TOKEN_TTL_PAIRED.
    const mintDeviceJwt = (
      screenId: string,
      isPaired: boolean,
      ttl?: string,
      tenantId?: string | null,
      credentialEpoch?: number,
    ) => {
      const expiresIn = (ttl
        ?? (isPaired ? DEVICE_TOKEN_TTL_PAIRED : DEVICE_TOKEN_TTL_UNPAIRED)
      ) as import('jsonwebtoken').SignOptions['expiresIn'];
      const payload: Record<string, unknown> = {
        sub: screenId,
        deviceId: screenId,
        kind: 'device',
        ep: Math.max(0, Math.floor(credentialEpoch ?? 0)),
      };
      // DEVAUTH-01 (2026-08-04) — MARK THE UNPROVEN CREDENTIAL.
      //
      // A bare `POST /screens/register {deviceFingerprint}` — no pairing code,
      // no prior token — mints a short-lived credential and sets
      // `requiresRePair: true` in the RESPONSE. But that flag was only ever a
      // hint to the client; the TOKEN itself was byte-identical to a fully
      // paired one apart from `exp`. So `verifyPriorToken` happily accepted it
      // as proof of possession, and two anonymous requests turned knowledge of
      // a fingerprint into a 180-day, self-renewing device credential:
      //
      //   1. POST /screens/register {deviceFingerprint}      -> 1h token
      //   2. POST /screens/register {priorDeviceToken: <it>} -> 180d token
      //
      // Stamping the token's own privilege level into the token is what makes
      // step 2 refusable. Additive and grandfathering-safe: every credential
      // issued before this claim existed simply lacks it and keeps behaving
      // exactly as it does today.
      //
      // SEC-001 (2026-09-04) — AND IT IS NOT A DEVICE CREDENTIAL AT ALL.
      //
      // DEVAUTH-01 stamped the claim but the shared verifier never read it, so
      // this token still authenticated every device route: manifest, emergency
      // assets, stream tickets, telemetry, render proof, display control and
      // `POST /screens/unpair/:fingerprint`, which clears the screen's tenant,
      // deletes its schedules, rotates its credential epoch and cuts it out of
      // its emergency channel. Knowledge of a fingerprint — a value the
      // dashboard shows with a copy button — was a bearer credential for a
      // paired, life-safety screen.
      //
      // It is now marked as a BOOTSTRAP credential on two independent axes so
      // a future mint path that forgets one is still refused by the other, and
      // it carries NO TENANT: the live Screen row is the only source of tenant
      // identity on every path that matters (`verifyDeviceForScreen` since
      // DT-03, `DeviceIdentityInterceptor`, and the WS gateway, which
      // overwrites `decoded.tenantId` from the row it just read), so dropping
      // the claim removes a stale-identity primitive and changes no routing.
      const bootstrapOnly = ttl === DEVICE_TOKEN_TTL_UNPROVEN;
      if (bootstrapOnly) {
        payload.unproven = true;
        payload.aud = DEVICE_TOKEN_AUD_BOOTSTRAP;
      }
      if (tenantId && !bootstrapOnly) payload.tenantId = tenantId;
      return jwt.sign(payload, deviceJwtSecret, { expiresIn, algorithm: DEVICE_JWT_ALGORITHMS[0] });
    };

    /**
     * Validate priorDeviceToken (if supplied) against the live screen row.
     * Returns:
     *   'valid'   — signature ok, kind=device, sub matches, NOT expired,
     *               AND the epoch it carries is still acceptable for this
     *               screen (current, or the previous one inside the
     *               rotation grace window)
     *   'stale'   — everything above except the epoch: this credential was
     *               superseded or revoked. Downgrade, do not hard-reject —
     *               a hard 401 here would let an attacker who renews first
     *               deliberately black out a real screen, and a dark screen
     *               is the failure mode this product exists to prevent.
     *   'expired' — bound to the right screen but past its exp
     *   'invalid' — wrong screenId or tampered (hard 401)
     *   'absent'  — no priorDeviceToken sent
     *
     * 2026-08-03 (DT-02): the epoch check is the piece that stops a stolen
     * token renewing itself forever. Renewal now requires the screen to
     * still exist, still be paired, not be REVOKED, and to still recognise
     * the credential being presented.
     */
    const verifyPriorToken = (
      screen: { id: string; status?: string | null; tenantId?: string | null; credentialEpoch?: number | null; credentialEpochRotatedAt?: Date | null },
    ): 'valid' | 'valid-grace' | 'unproven-restorable' | 'stale' | 'expired' | 'invalid' | 'absent' => {
      if (!body.priorDeviceToken) return 'absent';
      const epochState = {
        credentialEpoch: Number(screen.credentialEpoch ?? 0) || 0,
        credentialEpochRotatedAt: screen.credentialEpochRotatedAt ?? null,
      };
      try {
        const decoded = jwt.verify(body.priorDeviceToken, deviceJwtSecret, {
          algorithms: DEVICE_JWT_ALGORITHMS,
        }) as any;
        if (decoded?.kind !== 'device') return 'invalid';
        if (decoded?.sub !== screen.id) return 'invalid';
        // DEVAUTH-01 (2026-08-04) — an UNPROVEN credential is not proof of
        // possession. It was minted to a caller who supplied nothing but a
        // fingerprint, so treating it as evidence that the caller holds the
        // screen is circular: it would upgrade a guess into a 180-day
        // credential (and rotate the epoch, locking the real screen out).
        // 'stale' rather than 'invalid' so the caller is told to re-pair,
        // which is exactly the state they are in.
        //
        // ── OPERATOR-REPAIR RESTORE (2026-08-30, deep-audit B-P1-7) ──────
        // ONE narrow exception, or dashboard re-pair can never heal a
        // REPAIR_REQUIRED screen: the screen stays in 'playing' (no pairing
        // code ever shows), its unproven token can't upgrade, and the only
        // remedy was a physical-ish unpair-then-pair. When ALL of these
        // hold, the unproven token is accepted as a renewal:
        //   • the OPERATOR JUST RE-PAIRED this screen — `authState` is
        //     'PROVEN' (written only by the pair endpoint and proven
        //     renewals) AND the pair's epoch rotation happened within the
        //     grace window (`isEpochAcceptable` below enforces it);
        //   • the presented token carries the PRE-pair epoch (current-1) —
        //     i.e. it was minted BEFORE the operator's action. A token
        //     minted at the CURRENT epoch (e.g. by a post-pair anonymous
        //     register) stays refusable, so this grants nothing an
        //     anonymous caller could farm after the pair.
        // SECURITY EQUIVALENCE, stated for review: the existing FIRST-pair
        // exchange already accepts an UNPAIRED token (also minted to
        // whoever registered the fingerprint first) at current-1 within
        // the same grace window after the operator pairs. In both flows
        // the authorizer is the operator's fresh dashboard action; the
        // token only proves "the same caller who was already talking to us
        // as this screen." This adds no new capability class and leaves
        // DEVAUTH-01 fully intact outside the operator-pair window.
        //
        // SEC-001 (2026-09-04) — asked through the SHARED predicate so the
        // renewal gate and the request gate can never disagree about what a
        // bootstrap credential is (a second copy of this test is exactly how
        // DT-05 happened). It now also catches the `aud` marker.
        if (isUnprovenDeviceClaim(decoded)) {
          const operatorJustPaired =
            (existing as any).authState === 'PROVEN' &&
            isEpochAcceptable(epochFromClaim(decoded), epochState) &&
            epochFromClaim(decoded) === epochState.credentialEpoch - 1;
          return operatorJustPaired ? 'unproven-restorable' : 'stale';
        }
        if (!isEpochAcceptable(epochFromClaim(decoded), epochState)) return 'stale';
        // 2026-08-30 (deep-audit B-P1-6) — distinguish "holds the CURRENT
        // epoch" from "accepted via the rotation grace window". A
        // grace-window register is a DUPLICATE (the same device racing its
        // own concurrent register, or a reload landing mid-rotation), not
        // a fresh renewal: rotating AGAIN for it forks the epoch — two
        // valid-looking tokens exist and whichever response the device
        // persists last can be the superseded one, which turns into a
        // hard 401 exactly one grace-window later and a permanent
        // REPAIR_REQUIRED. The caller converges it to the current epoch
        // WITHOUT rotating.
        return epochFromClaim(decoded) === epochState.credentialEpoch ? 'valid' : 'valid-grace';
      } catch (e: any) {
        if (e?.name === 'TokenExpiredError') {
          // Decode without verification to check screenId binding.
          const decoded = jwt.decode(body.priorDeviceToken) as any;
          if (!decoded || decoded?.kind !== 'device') return 'invalid';
          if (decoded?.sub !== screen.id) return 'invalid';
          return 'expired';
        }
        return 'invalid';
      }
    };

    if (existing) {
      // ── Paired re-registration — graduated trust (sec-fix P0 #5) ──────────
      if (existing.tenantId) {
        // 2026-08-03 (DT-01/DT-02): a REVOKED screen may not re-register
        // itself back into service. Revocation is an operator decision;
        // the way back is an operator re-pairing the screen with a fresh
        // pairing code, not the compromised device asking nicely.
        if ((existing as any).status === 'REVOKED') {
          throw new HttpException(
            { code: 'SCREEN_CREDENTIAL_REVOKED', message: 'This screen’s credential was revoked by an administrator. Re-pair it from the dashboard.' },
            HttpStatus.FORBIDDEN,
          );
        }

        const priorStatus = verifyPriorToken(existing as any);

        if (priorStatus === 'invalid') {
          // Caller supplied a token but it binds to a different screen →
          // hard reject. Fingerprint alone is not enough to prove identity
          // when a token was actively presented.
          throw new HttpException({ code: 'SCREEN_TOKEN_MISMATCH', message: 'Invalid prior device token: screenId mismatch' }, HttpStatus.UNAUTHORIZED);
        }

        // Determine issued TTL (DT-02/DT-04):
        //   valid prior token → 180d + ROTATE the credential epoch
        //   stale prior token → 1h + requiresRePair (superseded/revoked
        //                       credential — a fork; audited, not 401'd)
        //   expired prior token → 1h + requiresRePair
        //   absent prior token → 1h + requiresRePair (was 365d by default
        //                       before DT-04 removed the legacy branch)
        let issuedTtl: string;
        let requiresRePair = false;
        let renewed = false;

        if (priorStatus === 'valid' || priorStatus === 'valid-grace' || priorStatus === 'unproven-restorable') {
          issuedTtl = DEVICE_TOKEN_TTL_PAIRED;
          renewed = true;
        } else {
          issuedTtl = DEVICE_TOKEN_TTL_UNPROVEN;
          requiresRePair = true;
        }

        // 2026-05-27 — back-fill hardwareModel if it's still null on
        // an already-paired screen (every screen paired before the
        // auto-detect landed). inferIfUnknown returns null when the
        // column already has a value, so this NEVER overwrites a
        // manual override an admin set via the dashboard.
        const detectedHardware = inferIfUnknown(
          { userAgent: body.userAgent || existing.userAgent, osInfo: body.osInfo || existing.osInfo },
          (existing as any).hardwareModel,
        );
        // 2026-08-30 (reliability W1-2 / audit P0-5) — stamp the server's
        // trust verdict on the row, server-side, at the same instant the
        // token is minted. This is what lets the dashboard say "re-pair
        // required" instead of a green ONLINE while a screen lives on
        // 1-hour downgraded tokens. Written only on CHANGE so the
        // boot-wave re-register stays a telemetry-only write (both columns
        // are in SCREEN_TELEMETRY_ONLY_FIELDS — no manifest-cache churn).
        const newAuthState = renewed ? 'PROVEN' : 'REPAIR_REQUIRED';
        // ten-ok: device re-registration. There is no caller tenant — the
        // principal is the screen itself, and `existing` was resolved from the
        // presented credential / fingerprint above, so the id IS the identity.
        // The row's `tenantId` is READ here to be sealed into the minted JWT,
        // which is the opposite of a value to compare a caller against; the
        // write touches only this row's own telemetry + authState columns.
        const updated = await this.prisma.client.screen.update({
          where: { id: existing.id },
          data: {
            resolution: body.resolution || existing.resolution,
            osInfo: body.osInfo || existing.osInfo,
            browserInfo: body.browserInfo || existing.browserInfo,
            userAgent: body.userAgent || existing.userAgent,
            ipAddress: clientIpFromRequest(req),
            lastPingAt: new Date(),
            status: 'ONLINE',
            ...(detectedHardware ? { hardwareModel: detectedHardware } : {}),
            ...(newAuthState !== (existing as any).authState
              ? { authState: newAuthState, authStateChangedAt: new Date() }
              : {}),
          },
        });

        // ── Credential timeline (2026-08-31, Fleet Command Phase 2) ────
        // TRANSITIONS ONLY. Every screen re-registers on a 10-minute timer,
        // so a row per register would bury the two moments that matter
        // under a fleet-wide flood — and the dashboard needs to show WHEN a
        // screen lost or regained proven trust, not that it keeps checking.
        //   repair-required     — the verdict just flipped INTO
        //                         REPAIR_REQUIRED (the token was downgraded
        //                         to 1 hour; content may still be playing,
        //                         but the credential is no longer proven).
        //   credential-restored — trust was re-minted: either the verdict
        //                         flipped back to PROVEN, or the
        //                         operator-repair restore verdict accepted a
        //                         token that could not otherwise renew.
        //                         That restore is one-shot by construction —
        //                         it requires the PRE-pair epoch, and
        //                         accepting it rotates past that epoch.
        const priorAuthState = ((existing as any).authState ?? null) as string | null;
        const credentialEventKind =
          newAuthState === 'REPAIR_REQUIRED' && priorAuthState !== 'REPAIR_REQUIRED'
            ? 'repair-required'
            : (newAuthState === 'PROVEN' && priorAuthState !== 'PROVEN') ||
                priorStatus === 'unproven-restorable'
              ? 'credential-restored'
              : null;
        if (credentialEventKind) {
          // Best-effort, and try/catch rather than a trailing `.catch()`:
          // the credential decision is already made and the token is about
          // to be minted, so NOTHING here — including a synchronous throw —
          // may fail a register and strand a screen.
          try {
            await this.prisma.client.screenEvent.create({
              data: {
                screenId: existing.id,
                tenantId: existing.tenantId,
                kind: credentialEventKind,
                detail: { priorAuthState, authState: newAuthState, priorStatus },
              },
            });
          } catch { /* timeline best-effort */ }
        }

        // ── Credential rotation (DT-02) ───────────────────────────────
        // A screen that proved possession gets a NEW epoch, so the token
        // it just handed us is retired the moment the new one is issued
        // (subject to the grace window that keeps a lost response from
        // locking a real kiosk out — see CREDENTIAL_EPOCH_GRACE_MS).
        // This is what turns "a stolen copy renews itself forever" into
        // "two parties cannot both hold the current credential, and the
        // fork is visible."
        let issuedEpoch = Number((existing as any).credentialEpoch ?? 0) || 0;
        if (priorStatus === 'valid' || priorStatus === 'unproven-restorable') {
          try {
            issuedEpoch = await rotateScreenCredentialEpoch(
              { prisma: this.prisma, redis: this.redisService },
              existing.id,
            );
          } catch {
            /* rotation is best-effort: never fail a live kiosk's boot on it */
          }
        } else if (priorStatus === 'valid-grace') {
          // B-P1-6 (2026-08-30): a grace-window register is a duplicate of a
          // rotation that ALREADY happened — mint on the CURRENT epoch and
          // do NOT rotate again, so a concurrent-register fork converges
          // instead of escalating (see verifyPriorToken). issuedEpoch is
          // already the current epoch from the row read above.
          invalidateDeviceCredentialCache(existing.id);
        } else {
          // Downgraded credentials do NOT rotate — otherwise an attacker
          // could force-rotate a screen out of its own credential just by
          // spamming /register with no token at all.
          invalidateDeviceCredentialCache(existing.id);
        }

        // Renewal is a privileged event and used to write no AuditLog at
        // all, so a self-renewal chain was invisible in forensics. Wrapped
        // in try/catch, not just `.catch()`: an audit write must never be
        // able to fail a live kiosk's boot, synchronously or otherwise.
        try {
          this.prisma.client.auditLog.create({
            data: {
              tenantId: existing.tenantId,
              userId: null,
              action: renewed ? 'SCREEN_TOKEN_RENEWED' : 'SCREEN_TOKEN_DOWNGRADED',
              targetType: 'Screen',
              targetId: existing.id,
              details: JSON.stringify({
                priorTokenStatus: priorStatus,
                issuedTtl,
                credentialEpoch: issuedEpoch,
                requiresRePair,
                ip: clientIpFromRequest(req),
                fingerprint: body.deviceFingerprint.slice(0, 24),
              }),
            },
          }).catch(() => { /* audit best-effort */ });
        } catch { /* audit best-effort */ }

        return {
          screenId: updated.id,
          pairingCode: updated.pairingCode,
          paired: true,
          name: updated.name,
          deviceToken: mintDeviceJwt(updated.id, true, issuedTtl, existing.tenantId, issuedEpoch),
          ...(requiresRePair ? { requiresRePair: true } : {}),
        };
      }

      // ── Unpaired re-registration (no tenantId yet) ────────────────────────
      // 2026-05-27 — same hardware auto-detect as the paired branch.
      // inferIfUnknown returns null when the column already has a
      // value so this is back-fill-only.
      const detectedHardwareUnpaired = inferIfUnknown(
        { userAgent: body.userAgent || existing.userAgent, osInfo: body.osInfo || existing.osInfo },
        (existing as any).hardwareModel,
      );
      // ten-ok: the UNPAIRED branch, by construction — this is the code path
      // for a screen that has no tenantId yet (it is sitting on the pairing
      // splash). There is no tenant to scope to on either side, and adding one
      // would make the pre-claim boot unwritable.
      const updated = await this.prisma.client.screen.update({
        where: { id: existing.id },
        data: {
          resolution: body.resolution || existing.resolution,
          osInfo: body.osInfo || existing.osInfo,
          browserInfo: body.browserInfo || existing.browserInfo,
          userAgent: body.userAgent || existing.userAgent,
          ipAddress: clientIpFromRequest(req),
          lastPingAt: new Date(),
          status: 'PENDING',
          ...(detectedHardwareUnpaired ? { hardwareModel: detectedHardwareUnpaired } : {}),
        },
      });
      return {
        screenId: updated.id,
        pairingCode: updated.pairingCode,
        paired: false,
        name: updated.name,
        // sec-fix(P0 #7): unpaired → 15m TTL. The epoch must come from the
        // LIVE row: an unpair bumps it, and minting at a hard-coded 0 would
        // hand back a credential the verifier immediately rejects.
        deviceToken: mintDeviceJwt(updated.id, false, undefined, null, Number((updated as any).credentialEpoch ?? 0) || 0),
      };
    }

    // New device — create with pairing code.
    // FIX (player-009): the previous retry budget was 10 attempts — on
    // the 11th collision the controller fell through to a unique-index
    // 500 because the duplicate pairingCode hit the DB. The 6-char code
    // in a 32-char alphabet has a 32^6 ≈ 1.07B namespace; a real fleet
    // of 100k unpaired screens has a per-code collision rate of <1e-4,
    // and 100 retries at that rate is effectively zero (1e-400-ish).
    // We also fall back to an 8-char code after 50 collisions in case
    // the namespace is artificially exhausted (test seeding, malicious
    // pre-claiming, etc) so that an unpaired kiosk NEVER receives 500.
    let pairingCode = generatePairingCode();
    let pairingCodeLength = 6;
    for (let attempt = 0; attempt < 100; attempt++) {
      const exists = await this.prisma.client.screen.findUnique({ where: { pairingCode } });
      if (!exists) break;
      // After 50 collisions at length 6, escalate to length 8 — same
      // alphabet, ~1.1T-entry namespace. This branch is essentially
      // unreachable in practice but keeps the failure mode bounded.
      if (attempt >= 50 && pairingCodeLength === 6) {
        pairingCodeLength = 8;
      }
      pairingCode = generatePairingCode(pairingCodeLength);
    }

    // 2026-05-27 — auto-detect hardware model from the userAgent on
    // first register. existingHardwareModel is undefined here (brand
    // new row), so inferIfUnknown returns the detected value when the
    // UA matches a known device, else null (which we coerce to
    // undefined so Prisma doesn't write a null instead of skipping the
    // column default).
    const detectedHardware = inferIfUnknown(
      { userAgent: body.userAgent, osInfo: body.osInfo },
      undefined,
    );

    // 2026-08-24 — DERIVE ORIENTATION FROM THE PANEL THE DEVICE JUST REPORTED.
    //
    // THE BUG THIS FIXES. `Screen.orientation` is `@default("LANDSCAPE")`, so
    // every auto-created row claimed landscape no matter what the hardware
    // said. The manifest hands that value to the player, which applies it via
    // setRequestedOrientation — so a PORTRAIT panel got actively forced into
    // landscape. Observed on two 2160×3840 signage panels the day the fleet
    // moved to v1.1.2: one letterboxed its content into a landscape strip in
    // the middle of the glass, the other rendered the whole UI rotated 90°.
    // Both were unreadable, and neither was "not yet configured" — the server
    // was asserting the wrong answer.
    //
    // It only surfaced now because every previously-paired screen had been set
    // to AUTO by hand long ago; a brand-new row is the only way to meet the
    // raw default. The device reports `resolution` on this very request, so
    // guessing is unnecessary — h > w is portrait, and nothing else needs to
    // be true for that to hold on a fixed-mount panel.
    //
    // Landscape resolves to the same value the column default already had, so
    // this changes behaviour for portrait hardware ONLY. An unparseable or
    // absent resolution falls through to the column default untouched — an
    // operator can still override per-screen either way.
    const derivedOrientation = ((): 'PORTRAIT' | 'LANDSCAPE' | null => {
      // A NovaStar LED poster is never derived into a native rotation — see
      // resolveManifestOrientation. null → the row's AUTO default.
      if (detectedHardware === 'novastar-taurus') return null;
      // ⭐ CHASSIS FIRST. A fixed-orientation product (the MAXHUB L55VEC
      // portrait kiosk) reports a LANDSCAPE framebuffer, so the resolution
      // rule below would write an explicit 'LANDSCAPE' into the column —
      // and an explicit value short-circuits resolveManifestOrientation,
      // permanently defeating the catalog lookup for every unit of that
      // model. The model is the trustworthy signal here; the panel is not.
      const nativeFromChassis = detectedHardware
        ? HARDWARE_CATALOG[detectedHardware as HardwareModel]?.nativeOrientation
        : undefined;
      if (nativeFromChassis) return nativeFromChassis;

      const raw = typeof body.resolution === 'string' ? body.resolution : '';
      // Players report "2160×3840" with U+00D7, not an ASCII 'x'. Accept both
      // (plus '*') so a client that changes its separator cannot silently
      // reintroduce the forced-landscape bug.
      const m = raw.match(/^\s*(\d{2,6})\s*[x×X*]\s*(\d{2,6})\s*$/);
      if (!m) return null;
      const w = Number(m[1]);
      const h = Number(m[2]);
      if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
      return h > w ? 'PORTRAIT' : 'LANDSCAPE';
    })();

    const screen = await this.prisma.client.screen.create({
      data: {
        name: `Screen-${pairingCode}`,
        deviceFingerprint: body.deviceFingerprint,
        pairingCode,
        status: 'PENDING',
        resolution: body.resolution || null,
        ...(derivedOrientation ? { orientation: derivedOrientation } : {}),
        osInfo: body.osInfo || null,
        browserInfo: body.browserInfo || null,
        userAgent: body.userAgent || null,
        ipAddress: clientIpFromRequest(req),
        lastPingAt: new Date(),
        ...(detectedHardware ? { hardwareModel: detectedHardware } : {}),
      },
    });

    return {
      screenId: screen.id,
      pairingCode: screen.pairingCode,
      paired: false,
      name: screen.name,
      // sec-fix(P0 #7): unpaired → 15m TTL. Brand-new row → epoch 0.
      deviceToken: mintDeviceJwt(screen.id, false, undefined, null, Number((screen as any).credentialEpoch ?? 0) || 0),
    };
  }

  /**
   * POST /api/v1/screens/:id/stream-ticket
   *
   * DT-08 (2026-08-03) — mint a 60-second, single-purpose ticket the player
   * can put in the SSE URL instead of its 180-day device credential.
   *
   * `EventSource` cannot set request headers, which is why the device token
   * ended up in `?token=` in the first place. That put a fleet credential
   * into Railway/Vercel HTTP access logs, on-path proxy logs and Android
   * WebView history — none of which anyone treats as a credential store.
   * The fix is not to move the same credential elsewhere; it is to stop
   * putting a long-lived credential in a URL at all. This route is a normal
   * authenticated POST (header auth, no EventSource limitation) and returns
   * a ticket that grants exactly one thing — "open the event stream for
   * this one screen" — for 60 seconds, and dies with the screen's
   * credential epoch.
   *
   * The consuming half is wired: `GET /api/v1/realtime/sse?ticket=…` verifies
   * the ticket, refuses a REVOKED screen, and requires the ticket's epoch to
   * still equal the screen's live `credentialEpoch`.
   */
  @Post(':id/stream-ticket')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async issueStreamTicket(@Param('id') id: string, @Req() req: ExpressReq) {
    // SEC-001 (2026-09-04) — `allowUnpaired: true` is this route's PRIOR
    // behaviour, now stated rather than inherited from a permissive default.
    // A screen on the pairing splash opens its event stream before it is
    // claimed. The credential must still be PROVEN: a stream ticket is a
    // SECONDARY credential, and minting one from a device fingerprint is
    // exactly the escalation SEC-001 closes.
    const auth = await this.deviceAuth(req, id, { allowUnpaired: true });
    if (!auth.ok) {
      throw new HttpException(
        { code: 'SCREEN_DEVICE_AUTH_REQUIRED', message: `Device auth required (${auth.reason})` },
        HttpStatus.UNAUTHORIZED,
      );
    }
    const { ticket, expiresAt } = mintStreamTicket(id, auth.screen.credentialEpoch);
    return { ticket, expiresAt, expiresInMs: expiresAt - Date.now() };
  }

  /**
   * Does this heartbeat prove possession of the screen's own credential?
   *
   * DT-09 (2026-08-03) — `GET /screens/status/:fp` is anonymous by design
   * (see the route comment) and used to hand back `Screen.pairingCode` to
   * whoever asked. The pairing code is the claim credential: an unclaimed
   * screen's code, typed into `POST /screens/pair`, moves that physical
   * display into the typist's tenant. Device fingerprints are not secrets in
   * practice — the dashboard shows one with a copy button, `GET /screens`
   * carries them, and they appear in support tickets and OTA logs — so
   * "gated by fingerprint secrecy" was gating nothing.
   *
   * This returns TRUE only when the caller presented the screen's device
   * credential, which `verifyDeviceForScreen` checks against the LIVE row:
   * signature, `kind`/`sub`, the token denylist, `status !== 'REVOKED'`, and
   * the current `credentialEpoch`. So a revoked screen cannot read its own
   * code back either — a revoke is exactly when an attacker would want it.
   *
   * Cost control: the auth path is skipped entirely when the request carries
   * no credential material at all, which is every caller today. A kiosk
   * heartbeats this route every 30-45 s, so an unconditional DB+Redis round
   * trip here would be a fleet-scale regression for a field nobody reads.
   */
  private async heartbeatProvesDevice(
    req: any,
    screenId: string,
  ): Promise<HeartbeatCredentialVerdict> {
    const auth = req?.headers?.authorization;
    const hmac = req?.headers?.['x-device-auth'];
    const presented =
      (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) ||
      typeof hmac === 'string';
    if (!presented) return { presented: false, proved: false, reason: null };
    try {
      const verdict = await this.deviceAuth(req as ExpressReq, screenId, { allowUnpaired: true });
      return {
        presented: true,
        proved: verdict.ok,
        reason: verdict.ok ? null : (verdict as { ok: false; reason: string }).reason,
      };
    } catch {
      // Never let an auth-path FAULT break the heartbeat itself — the
      // dashboard's ONLINE/OFFLINE signal depends on this route answering.
      // `proved: false` is the safe answer: it withholds the pairing code and
      // refuses the writes; it is `presented: true` so the paired-screen
      // branch in `deviceStatus` still refuses rather than downgrading.
      return { presented: true, proved: false, reason: 'auth_path_error' };
    }
  }

  // ─── PUBLIC: Device heartbeat / status check ───
  //
  // ── HEARTBEAT FORGERY (school-security audit item 3 / internal F-D) ─────
  // 2026-09-08. This route accepted ANY caller and then WROTE to the screen
  // row: `lastPingAt`, `status`, `playerVersion`/`playerVersionCode`,
  // `managerVersion`, and — on a version bump — it cleared
  // `forceApkUpdatePendingAt` while stamping `lastOtaState='INSTALLED'`,
  // `lastOtaProgress=100`. The only gate on the route was DT-09's, and that
  // one gates the pairing code in the RESPONSE, not the write.
  //
  // With nothing but a fingerprint — a value the dashboard renders with a copy
  // button, `GET /screens` carries, and support tickets and OTA logs are full
  // of — a stranger could therefore:
  //   • hold a dead, stolen or unplugged screen at ONLINE forever, defeating
  //     the offline detection an operator relies on to know a screen is NOT
  //     showing their emergency content;
  //   • falsify the fleet's own view of what firmware is deployed;
  //   • forge OTA completion, so a failed rollout reads as successful.
  //
  // THE RULE NOW, and the reasoning for each half:
  //
  //   PAIRED screen (`tenantId` set) — every write requires the device
  //   credential. A paired screen already reports liveness, versions and OTA
  //   state through the device-authenticated `POST /screens/:id/telemetry`
  //   (see telemetry.controller.ts, which writes the SAME columns under the
  //   SAME 25 s debounce), so the anonymous stamp was redundant on the happy
  //   path and forgeable on every other. Anonymous callers still get the READ:
  //   `paired`, `name`, `ota`, `versions` and `forceUpdatePending` are
  //   unchanged, so the OTA polling fallback (the reason the native heartbeat
  //   reads this response at all) keeps working with no credential.
  //
  //   UNPAIRED screen (`tenantId` null) — an anonymous poll may still stamp
  //   `lastPingAt` + `status='PENDING'`, and NOTHING else. Deliberate:
  //     · This IS the pairing poll. The screen has no device credential worth
  //       the name yet, the installer's proof that the panel reached the
  //       server is the PENDING dot, and there is no offline-detection promise
  //       to defeat — an unclaimed row shows nobody's emergency content. The
  //       worst an attacker achieves is keeping an unclaimed row's PENDING
  //       timestamp fresh, which grants nothing and reveals nothing.
  //     · Version / manager / OTA stamping is NOT defensible even here. Those
  //       columns are fleet-visible state that feeds the dashboard's firmware
  //       view and the OTA rollout gate; the pairing flow does not need them,
  //       and an unpaired screen that wants them written can present the
  //       credential `POST /screens/register` minted for it (this route's
  //       device auth passes `allowUnpaired: true` for exactly that reason).
  //
  // ⚠️ WHAT THIS DOES NOT CLOSE. `POST /screens/register` still stamps
  // `lastPingAt` + `status='ONLINE'` for a caller holding only a fingerprint
  // (it does mark such a row `authState='REPAIR_REQUIRED'`, which the fleet UI
  // grades on, so the forged ONLINE is at least labelled). Changing that is a
  // separate decision about the boot path and is deliberately out of scope
  // here — see the fix report.
  //
  // ⚠️ FLEET COST, stated rather than discovered. The shipped Kotlin
  // `HeartbeatService` sends no `Authorization` header, so on an already-
  // installed APK this route stops being that screen's liveness writer. A
  // healthy screen is unaffected — its WebView's telemetry POST stamps
  // liveness every 60 s. What is lost until an APK carrying the header is
  // fleet-wide is the INDEPENDENT proof of the Android process for a screen
  // whose WebView is wedged: that screen now reads OFFLINE instead of
  // ONLINE-but-no-render-proof. That is less diagnostic fidelity and more
  // honesty; a screen the server cannot authenticate is not a screen the
  // server should call ONLINE.
  @Get('status/:deviceFingerprint')
  async deviceStatus(
    @Param('deviceFingerprint') fingerprint: string,
    @Query('v') versionName?: string,
    @Query('vc') versionCode?: string,
    @Query('mv') managerVersionName?: string,
    @Request() req?: any,
  ) {
    // Preview fingerprints must never write lastPingAt — they would push
    // the real paired kiosk's status to ONLINE even after closing the tab.
    if (fingerprint.startsWith('preview-')) {
      return { screenId: null, paired: false, name: 'Preview', pairingCode: null, isPreview: true };
    }

    // ── Per-fingerprint admission floor, BEFORE any database work ───────
    // The audit's fourth impact: one unbounded `Screen` read (and, before the
    // gate below, one UPDATE) per request, with no per-target cap of any kind.
    // The global per-IP throttler bounds a BUILDING; this bounds a ROW. See
    // status-poll-throttle.ts for the sizing (the 3 s unpaired pairing poll is
    // the binding constraint, not the 30-45 s paired heartbeat) and for why a
    // caller with a verified device credential skips it.
    if (!acceptStatusPoll(fingerprint, req)) {
      throw new HttpException(
        {
          code: 'SCREEN_STATUS_TOO_FREQUENT',
          message: 'Too many status polls for this device fingerprint',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Phase B — wrap the 3 DB hits in this hot endpoint with bounded
    // retry. The Supabase pooler trips on prepared-statement reuse a
    // few times per hour; without retry, those become a 500 → kiosk
    // briefly shows OFFLINE on the dashboard. With retry, the second
    // attempt almost always succeeds inside 100ms and the user sees
    // nothing. See with-db-retry.ts for the transient-error classifier.
    const screen = await withDbRetry(
      () => this.prisma.client.screen.findUnique({
        where: { deviceFingerprint: fingerprint },
      }),
      { label: 'screen.findUnique[fp]' },
    );
    if (!screen) throw new HttpException({ code: 'SCREEN_NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);

    const paired = !!screen.tenantId;

    // ── ONE credential verdict, two gates ───────────────────────────────
    // It gates the WRITES below and DT-09's pairing-code disclosure at the
    // bottom. It used to be computed only when `screen.pairingCode` was set,
    // because the disclosure gate was its only consumer; the write gate needs
    // it on every row. Cost is unchanged for the caller that matters: a
    // credential-less poll short-circuits before any Redis or Postgres work
    // (`heartbeatProvesDevice`), which is still every shipped kiosk.
    const credential = await this.heartbeatProvesDevice(req, screen.id);

    // A PRESENTED credential that fails to verify is an ERROR on a paired
    // screen, never a silent downgrade to the anonymous path. Otherwise
    // "attach a junk token" would be a way to reach anonymity while looking
    // authenticated, and a screen whose credential has genuinely died would go
    // on reporting healthy instead of surfacing the one problem it has.
    //
    // Unpaired rows deliberately fall through to the anonymous path instead:
    // that is the pairing splash, where a screen routinely holds a token that
    // has expired (unpaired credentials live 15 minutes) or that was minted
    // before a re-register, and refusing it would break the one flow on this
    // route with no alternative.
    if (paired && credential.presented && !credential.proved) {
      throw new HttpException(
        {
          code: 'SCREEN_DEVICE_AUTH_REQUIRED',
          message: `Device auth failed (${credential.reason ?? 'unknown'})`,
        },
        HttpStatus.UNAUTHORIZED,
      );
    }

    // WHO MAY WRITE WHAT. See the route comment for the reasoning; these two
    // booleans are the whole policy and every write below is gated on one.
    const mayStampLiveness = credential.proved || !paired;
    const mayStampFirmware = credential.proved;

    // Update lastPingAt — and if the kiosk passed its app version on
    // this heartbeat, capture it too. Operator (2026-04-27): "we
    // shouldnt have to wait 6 hours to see an updated version, why
    // not grab that everytime the screen checks in?"
    //
    // The Kotlin HeartbeatService sends ?v=BuildConfig.VERSION_NAME
    // (and optionally ?vc=BuildConfig.VERSION_CODE) on every 30s
    // heartbeat — same fields the OTA endpoint already accepts but
    // 720× more often. Old kiosks that don't pass the params still
    // work; they just won't update the version field until their
    // next /update-check.
    //
    // `lastPingAt` / `status` are NOT seeded here any more: they are added at
    // the write site below, and only when `mayStampLiveness` holds. Seeding
    // them unconditionally is what made an anonymous poll a liveness writer.
    const data: any = {};
    const vn = mayStampFirmware ? (versionName || '').trim() : '';
    if (vn) {
      data.playerVersion = vn;
      data.playerVersionAt = new Date();
      const vc = Number(versionCode);
      if (Number.isFinite(vc) && vc > 0) {
        data.playerVersionCode = vc;
        const priorVc = Number((screen as any).playerVersionCode || 0);
        if ((screen as any).forceApkUpdatePendingAt && vc > priorVc) {
          data.forceApkUpdatePendingAt = null;
          data.lastOtaState = 'INSTALLED';
          data.lastOtaProgress = 100;
          data.lastOtaMessage = `Installed v${vn}`;
          data.lastOtaAt = new Date();
        }
      }
    }
    // v1.0.13 — Manager APK version, queried by Player via
    // PackageManager and passed as ?mv=. v1.0.18+ Player ALSO sends
    // ?mv= (with empty value) when Manager isn't installed — that
    // empty value is the explicit "Manager was uninstalled" signal,
    // which we now use to clear the field. Operator (2026-04-28):
    // "i deleted the old manager so cant be" — dashboard chip was
    // showing v1.0.1 long after they uninstalled because we
    // intentionally never cleared the column.
    //
    //   undefined  → param NOT in query (Player v1.0.12 or earlier
    //                that doesn't know about Manager) — leave alone
    //   ''         → Player explicitly says "no Manager installed" — clear
    //   '1.0.3'    → set
    if (mayStampFirmware && managerVersionName !== undefined) {
      const mv = managerVersionName.trim();
      if (mv) {
        data.managerVersion = mv;
        data.managerVersionAt = new Date();
      } else {
        // Explicit empty — Manager uninstalled. Clear so dashboard
        // chip reflects reality.
        data.managerVersion = null;
        data.managerVersionAt = null;
      }
    }
    // Diagnostic logging — used to fire on EVERY heartbeat (every 3s
    // per kiosk = ~28k Railway log lines per screen per day). 2026-05-23
    // launch audit P0 efficiency: tighten to "log only when something
    // CHANGED" so we keep the diagnostic value (which was added to
    // catch the v1.0.11 OTA-chip-stuck-blank bug on 2026-04-27) without
    // flooding logs at fleet scale.
    const fpShort = fingerprint.slice(0, 18);
    const versionChanged = vn && vn !== screen.playerVersion;
    const rawUrl = req?.originalUrl || req?.url || '(unknown)';
    const userAgent = req?.headers?.['user-agent'] || '(no-ua)';
    const isApkUa = /EduCmsPlayer/i.test(userAgent);
    if (versionChanged) {
      // Real signal: the kiosk just rolled to a new player version.
      // Worth the log line for forensics + dashboard chip diagnostics.
      console.log(
        `[heartbeat] fp=${fpShort}… v=${vn || '(NONE)'} vc=${versionCode || '(NONE)'} ` +
        `prior=${screen.playerVersion || '(none)'} changed=${versionChanged} ` +
        `apk-ua=${isApkUa} url=${String(rawUrl).slice(0, 200)}`,
      );
    }
    // Write-amplification fix (audit P0): the player heartbeats every 3s and
    // sends ?v= every time, so the old code wrote lastPingAt + playerVersion
    // on EVERY poll and then did a SECOND findUnique to re-read OTA state —
    // 3 sequential round-trips per screen per 3s (~43M queries/day at 500
    // screens) on the connection_limit=10 pool. Collapse it:
    //   • WRITE only when something meaningful changed (version / manager /
    //     OTA-install-clear) OR the 25s ping debounce is due — the same
    //     shouldSkipLastPingWrite() debounce the manifest path already uses
    //     (lastPingAt is at most ~25s stale, well within the 2-min offline
    //     threshold).
    //   • Return the OTA fields from the update's OWN select, so the third
    //     query disappears. When we skip the write, the row already fetched
    //     above (full select) serves the response.
    // Result: 1 query on the common poll (unchanged version, debounced),
    // 2 on a write — never 3. forceApkUpdatePendingAt is read from the
    // always-fresh findUnique above, so OTA pushes are still detected
    // immediately even on a debounced poll.
    const OTA_SELECT = {
      lastOtaState: true,
      lastOtaProgress: true,
      lastOtaMessage: true,
      lastOtaAt: true,
      playerVersion: true,
      managerVersion: true,
      forceApkUpdatePendingAt: true,
    } as const;

    const managerChanged =
      mayStampFirmware &&
      managerVersionName !== undefined &&
      (data.managerVersion ?? null) !== ((screen as any).managerVersion ?? null);
    const otaCleared = data.forceApkUpdatePendingAt === null;
    // Every `mustWrite` input is already gated on `mayStampFirmware`, so
    // mustWrite ⇒ proved ⇒ mayStampLiveness. Stated rather than relied on.
    const mustWrite = mayStampFirmware && (!!versionChanged || managerChanged || otaCleared);
    const pingDue = mayStampLiveness && !shouldSkipLastPingWrite(screen.id);

    let screenAfterUpdate: any = screen;
    if (mustWrite || pingDue) {
      if (mayStampLiveness) {
        markLastPingWritten(screen.id);
        data.lastPingAt = new Date();
        data.status = paired ? 'ONLINE' : 'PENDING';
      }
      screenAfterUpdate = await withDbRetry(
        // ten-ok: fingerprint-keyed device heartbeat. The caller is the screen
        // (or its pre-claim splash), so no caller tenant exists; `screen.id` is
        // whatever the fingerprint lookup above resolved, and the write is
        // confined to that row's own telemetry columns (lastPingAt, player /
        // manager version, OTA flag).
        () => this.prisma.client.screen.update({
          where: { id: screen.id },
          data,
          select: OTA_SELECT as any,
        }),
        { label: 'screen.update[heartbeat]' },
      );
    }
    // 2026-04-29 — operator (push went silent on v1.0.30 kiosk):
    // "pushed, nothing happened anywhere" + dashboard showed
    // "waiting for kiosk (≤ 35 min via periodic check)". WS push
    // is fragile — kiosk's WebSocket re-handshake after the prior
    // install can miss messages. Yodeck/Rise/etc. poll instead.
    //
    // Fix: surface forceUpdatePending on this heartbeat response.
    // Web player checks this every ~30s and fires bridge.
    // checkForUpdates locally if set. Recovers any failed-WS push
    // within one heartbeat tick. The 24h freshness window matches
    // the server-side gate in /update-check so we don't fire
    // forever on a stale flag.
    const forceAt = (screenAfterUpdate as any)?.forceApkUpdatePendingAt;
    const FORCE_FRESH_MS = 24 * 60 * 60 * 1000;
    const forceUpdatePending = !!forceAt &&
      (Date.now() - new Date(forceAt).getTime()) < FORCE_FRESH_MS;

    // DT-09 — the pairing code goes ONLY to a caller that proved possession
    // of this screen's device credential. See heartbeatProvesDevice above for
    // the threat model; see the fix report for the two-method sweep proving
    // no shipped client reads this field (the pairing splash sources its code
    // from the `POST /screens/register` response, not from here).
    const provedDevice = screen.pairingCode ? credential.proved : false;

    return {
      screenId: screen.id,
      paired: !!screen.tenantId,
      name: screen.name,
      pairingCode: provedDevice ? screen.pairingCode : null,
      // Say so rather than lying with a bare null, so an operator debugging
      // with curl isn't told a screen has no code when it does.
      ...(screen.pairingCode && !provedDevice ? { pairingCodeWithheld: true } : {}),
      ota: screenAfterUpdate ? {
        state: (screenAfterUpdate as any).lastOtaState || null,
        progress: (screenAfterUpdate as any).lastOtaProgress ?? null,
        message: (screenAfterUpdate as any).lastOtaMessage || null,
        at: (screenAfterUpdate as any).lastOtaAt || null,
      } : null,
      versions: screenAfterUpdate ? {
        player: (screenAfterUpdate as any).playerVersion || null,
        manager: (screenAfterUpdate as any).managerVersion || null,
      } : null,
      // Heartbeat-driven polling fallback for missed WS pushes.
      forceUpdatePending,
      forceUpdatePendingAt: forceAt ? new Date(forceAt).toISOString() : null,
    };
  }

  // ─── PUBLIC: Per-phase OTA state report from the device ──────────
  // Called by OtaUpdateWorker on the Android player at each phase of
  // an OTA install so the dashboard can show real progress instead of
  // stopwatch theater.
  //
  // Body shape (all optional except state):
  //   { state: 'CHECKING'|'DOWNLOADING'|'VERIFYING'|'INSTALLING'|'INSTALLED'
  //            |'UP_TO_DATE'|'ERROR',
  //     progress?: 0-100,   // download %, only meaningful during DOWNLOADING
  //     message?: string }  // human-readable detail (used for ERROR)
  //
  // 2026-08-14 — UP_TO_DATE added. It is the TERMINAL state of a healthy
  // check: the player reports CHECKING at the head of every cycle and, until
  // this landed, returned silently when the server had nothing newer — so a
  // perfectly healthy screen sat on CHECKING forever and was indistinguishable
  // from a wedged one (all four pilot boxes were in exactly that state).
  // Old APKs that never send it are unaffected; they simply keep the legacy
  // pinned-CHECKING behaviour until they take an OTA.
  //
  // Public (no auth) for the same reason /screens/status is public:
  // the kiosk has a device JWT but using it adds latency; this
  // endpoint just records non-sensitive progress + is rate-limited
  // implicitly by the caller's heartbeat cadence (a worker firing
  // every minute would still only generate 5-7 reports per OTA).
  @Post('status/:deviceFingerprint/ota-state')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async reportOtaState(
    @Param('deviceFingerprint') fingerprint: string,
    @Body() body: { state?: string; progress?: number; message?: string },
    @Req() req?: ExpressReq,
  ) {
    if (fingerprint.startsWith('preview-')) return { ok: true, ignored: 'preview' };
    const screen = await this.prisma.client.screen.findUnique({
      where: { deviceFingerprint: fingerprint },
      select: { id: true, name: true, lastOtaState: true, playerVersionCode: true },
    });
    if (!screen) throw new HttpException({ code: 'SCREEN_NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);

    // ── OTA-02 (2026-08-03) — is this report device-authenticated? ──────
    // The shipped Kotlin OTA worker sends NO Authorization header on this
    // route, and this change cannot ship an APK, so REQUIRING auth here
    // would take the whole fleet's OTA progress reporting dark. Instead the
    // route stays open and we record WHETHER the caller proved possession
    // of the screen's credential; the canary auto-promote gate weights the
    // two differently (an authenticated ERROR always halts a rollout, an
    // anonymous one is subject to a cohort error-rate threshold, so a
    // single forged ERROR can no longer hold a tenant's patch pipeline
    // closed forever). Once a token-sending APK is fleet-wide this becomes
    // a hard requirement — see OTA_REQUIRE_DEVICE_AUTH in
    // player-ota.controller.ts.
    let deviceAuthenticated = false;
    if (req) {
      try {
        // SEC-001 — prior behaviour, stated. An UNPAIRED screen still reports
        // OTA progress (that is how a kiosk updates itself before it is
        // claimed); an UNPROVEN one no longer writes fleet-visible state.
        const auth = await this.deviceAuth(req, screen.id, { allowUnpaired: true });
        deviceAuthenticated = auth.ok;
      } catch {
        deviceAuthenticated = false;
      }
    }

    const ALLOWED = new Set([
      'CHECKING', 'DOWNLOADING', 'VERIFYING', 'INSTALLING', 'INSTALLED',
      // Terminal success state of a check that found nothing to install.
      // Never a fault — the dashboard must render it green, not red.
      'UP_TO_DATE',
      // 2026-09-01 — the install LANDED but Android refused to let the app
      // relaunch itself; `message` names the missing grant. Not an ERROR
      // (nothing failed to install) and not INSTALLED (the new build is not
      // running yet) — a distinct state that needs a person, not a retry.
      'RELAUNCH_BLOCKED',
      'ERROR',
    ]);
    const state = String(body?.state || '').toUpperCase().trim();
    if (!ALLOWED.has(state)) {
      throw new HttpException({ code: 'SCREEN_OTA_STATE_INVALID', message: `Invalid state: ${state}` }, HttpStatus.BAD_REQUEST);
    }
    const progress = typeof body?.progress === 'number' && Number.isFinite(body.progress)
      ? Math.max(0, Math.min(100, Math.round(body.progress)))
      : null;
    const message = body?.message ? String(body.message).slice(0, 500) : null;

    // 2026-05-12 — operator: "the text says update complete to .54 but
    // the installed version says .52 still". Root cause: Manager's
    // SELF-update worker calls reportOtaState(INSTALLED, "Manager v...
    // (up to date)") on every periodic tick to clear its own stale
    // ERROR banner. That OVERWRITES the Player OTA state column —
    // which was sitting on INSTALLING from the actual Player upgrade
    // attempt. The web splash UI fires "Update complete to v1.0.54"
    // when it sees state=INSTALLED, regardless of whether the
    // playerVersionCode actually changed.
    //
    // Fix: discard Manager-self-update noise from the Player OTA state
    // column. Manager reports its own state with messages like
    // "Manager v1.0.17-debug (up to date)" — those are about MANAGER,
    // not Player, and must not pollute the Player upgrade state UI.
    //
    // We detect Manager self-update by the message prefix the worker
    // uses (apps/player/manager/.../ManagerSelfUpdateWorker.kt lines
    // 120, 127). If the API needs richer routing later, add a source
    // field to the request body; the prefix check is enough today.
    const isManagerSelfReport = !!message && /^Manager v/i.test(message);
    if (isManagerSelfReport) {
      console.log(
        `[ota-state] fp=${fingerprint.slice(0, 18)}… IGNORED Manager-self-update ` +
        `noise (state=${state} msg="${(message || '').slice(0, 60)}") — would have ` +
        `falsely overwritten Player OTA state column`,
      );
      return { ok: true, ignored: 'manager-self-update-noise' };
    }

    // 2026-05-12 — also guard against state=INSTALLED being written
    // when the kiosk's reported playerVersionCode hasn't actually
    // increased. The kiosk reports versionCode every heartbeat; the
    // ONLY proof an install really landed is the versionCode bump.
    // If a worker over-eagerly reports INSTALLED without an actual
    // upgrade, downgrade it to the prior state so the splash banner
    // doesn't lie. The legitimate INSTALLED is written by the
    // persistReportedVersion path (line ~500 of this file) when a
    // genuine versionCode bump is detected.
    if (state === 'INSTALLED') {
      console.log(
        `[ota-state] fp=${fingerprint.slice(0, 18)}… INSTALLED received but ` +
        `playerVersionCode=${(screen as any).playerVersionCode ?? '?'} — only ` +
        `version-bump path writes INSTALLED, ignoring this report to prevent ` +
        `false "Update complete" banner`,
      );
      return { ok: true, ignored: 'installed-without-version-bump' };
    }

    // ── OTA-02: the failure signal is STICKY ────────────────────────────
    // `lastOtaState` is last-writer-wins, and the player reports CHECKING
    // at the head of EVERY OTA cycle — so a genuine ERROR was routinely
    // erased by the device's own next poll, long before the 24 h canary
    // soak expired, and could be erased deliberately by any anonymous
    // caller. The canary gate now reads `lastOtaErrorAt`, which only an
    // ERROR sets and which NO state report can clear. It is cleared by
    // exactly two things: a confirmed install (a real versionCode bump, in
    // player-ota's persistReportedVersion) or an operator re-push / canary
    // re-arm. `lastOtaState` keeps its existing last-writer-wins semantics
    // because the dashboard's live progress UI depends on them.
    // ten-ok: device OTA-state report, keyed by the fingerprint resolved
    // above. No caller tenant exists on this path, and the write only touches
    // that same row's own OTA telemetry columns.
    await this.prisma.client.screen.update({
      where: { id: screen.id },
      data: {
        lastOtaState: state,
        lastOtaProgress: progress,
        lastOtaMessage: message,
        lastOtaAt: new Date(),
        ...(state === 'ERROR'
          ? {
              lastOtaErrorAt: new Date(),
              lastOtaErrorMessage: message,
              lastOtaErrorAuthenticated: deviceAuthenticated,
            }
          : {}),
      } as any,
    });

    console.log(
      `[ota-state] fp=${fingerprint.slice(0, 18)}… state=${state} ` +
      `progress=${progress ?? '-'} authed=${deviceAuthenticated} ` +
      `message=${(message || '').slice(0, 80)}`,
    );

    return { ok: true };
  }

  // ─── PUBLIC: Crash report from Player or Manager APK (Phase 2) ───
  // Called by an UncaughtExceptionHandler in each APK when something
  // throws fatally. Dashboard surfaces the most recent crash so we
  // can correlate with versionCode and ship a fix without waiting
  // for an operator to hand-walk through logcat.
  //
  // Body shape:
  //   { source: 'player'|'manager',
  //     versionName: string,
  //     versionCode?: number,
  //     message: string,
  //     stack: string }
  //
  // Stack trace truncated at 8KB on the server side — large enough
  // for any Kotlin trace, small enough to keep Postgres rows from
  // bloating. Operator can pull the full trace via the existing
  // PlayerLogger.uploadDiagnostics path if more depth is needed.
  @Post('status/:deviceFingerprint/crash-report')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async reportCrash(
    @Param('deviceFingerprint') fingerprint: string,
    @Body() body: {
      source?: string;
      versionName?: string;
      versionCode?: number;
      message?: string;
      stack?: string;
    },
    @Req() req?: ExpressReq,
  ) {
    if (fingerprint.startsWith('preview-')) return { ok: true, ignored: 'preview' };
    const screen = await this.prisma.client.screen.findUnique({
      where: { deviceFingerprint: fingerprint },
      select: { id: true, name: true },
    });
    if (!screen) throw new HttpException({ code: 'SCREEN_NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);

    const source = (body?.source || '').toLowerCase().trim();
    if (source !== 'player' && source !== 'manager') {
      throw new HttpException({ code: 'SCREEN_CRASH_SOURCE_INVALID', message: `Invalid source: ${source} (expected player or manager)` }, HttpStatus.BAD_REQUEST);
    }
    const message = (body?.message || '').slice(0, 500) || null;
    const stack = (body?.stack || '').slice(0, 8 * 1024) || null;
    const versionName = body?.versionName ? String(body.versionName).slice(0, 40) : null;

    // ten-ok: device crash report, keyed by the fingerprint resolved above.
    // No caller tenant exists; the write only touches that row's own crash
    // telemetry columns.
    await this.prisma.client.screen.update({
      where: { id: screen.id },
      data: {
        lastCrashAt: new Date(),
        lastCrashSource: source,
        lastCrashVersion: versionName,
        lastCrashMessage: message,
        lastCrashStack: stack,
      } as any,
    });

    // AUTHZ-03 (2026-08-04) — this route is anonymous BY DESIGN and stays that
    // way. Both shipped APKs' crash uploaders send no Authorization header, a
    // crash report comes from a dying process (the worst place to add an auth
    // dependency), and no server change can retrofit a header onto already
    // installed players. Hard-requiring auth would simply take fleet crash
    // reporting dark.
    //
    // What we CAN do is stop treating every report as equally trustworthy.
    // `heartbeatProvesDevice` is free when no credential is presented (it
    // returns false before doing any work), so this costs nothing on the
    // common path and records whether the caller actually proved possession of
    // this screen's credential — mirroring the ota-state sibling above.
    //
    // Recorded in the log line rather than a Screen column on purpose:
    // nothing in apps/web renders the lastCrash* fields today, so a new column
    // would be a schema migration plus the SCREEN_TELEMETRY_ONLY_FIELDS entry
    // in manifest-hot-cache.ts — and forgetting that entry is the documented
    // trap that silently recreates the 25 GB/mo Supabase egress bug. Not worth
    // it for a field with no consumer. Revisit if a crash panel is ever built.
    const authed = req ? (await this.heartbeatProvesDevice(req, screen.id)).proved : false;

    // Loud Railway log — these are real crashes; we want them
    // visible in the operator's daily-glance scroll, not buried.
    //
    // Every interpolated field is client-controlled on an unauthenticated
    // route, so CR/LF is stripped first: without it a forged report can embed
    // newlines and write convincing fake entries into the operator's log
    // stream, which is the only place this data is read today.
    console.error(
      `[crash] fp=${oneLineLog(fingerprint).slice(0, 18)}… authed=${authed} source=${source} ` +
      `version=${oneLineLog(versionName) || '-'} ` +
      `message="${oneLineLog(message).slice(0, 200)}"`,
    );

    return { ok: true };
  }

  // ─── BOOT + REGISTRATION DIAGNOSTIC (2026-09-02, P0-2) ──────────────
  //
  // The APK raises a NATIVE diagnostic screen when a panel loads the player
  // page and never actually starts playing — no client-JS boot, no
  // registration attempt, no registration answer, or two consecutive
  // transport-class failures. This is where that verdict becomes visible
  // off-site, so an operator does not have to be told by an installer
  // standing in front of the wall.
  //
  // ANONYMOUS, like its `crash-report` sibling above and for a sharper
  // reason: a screen that never registered HAS NO DEVICE CREDENTIAL. An
  // authenticated route here would go dark in precisely the case it exists
  // for. `heartbeatProvesDevice` still records whether the caller happened
  // to prove possession, so the log line says how much to trust the row.
  //
  // ⚠️ THE THREE COLUMNS ARE IN `SCREEN_TELEMETRY_ONLY_FIELDS`
  // (manifest-hot-cache.ts). Removing them from that set would let a
  // morning power-on wave of boot failures bump the process-wide manifest
  // content rev once per screen — the documented 25 GB/mo egress trap.
  @Post('status/:deviceFingerprint/boot-diagnostic')
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  async reportBootDiagnostic(
    @Param('deviceFingerprint') fingerprint: string,
    @Body() body: {
      reason?: string;
      versionName?: string;
      versionCode?: number;
      detail?: unknown;
    },
    @Req() req?: ExpressReq,
  ) {
    if (fingerprint.startsWith('preview-')) return { ok: true, ignored: 'preview' };
    const screen = await this.prisma.client.screen.findUnique({
      where: { deviceFingerprint: fingerprint },
      select: { id: true },
    });
    if (!screen) {
      throw new HttpException(
        { code: 'SCREEN_NOT_FOUND', message: 'Not found' },
        HttpStatus.NOT_FOUND,
      );
    }

    // The APK's own vocabulary. Anything else is recorded as UNKNOWN rather
    // than rejected: this route's job is to capture what a broken screen
    // managed to say, and a 400 would throw that away over a spelling.
    const REASONS = new Set([
      'NO_CLIENT_BOOT',
      'NO_REGISTER_ATTEMPT',
      'NO_REGISTER_RESULT',
      'REPEATED_TRANSPORT_FAILURE',
    ]);
    const rawReason = String(body?.reason ?? '').trim().toUpperCase();
    const reason = REASONS.has(rawReason) ? rawReason : 'UNKNOWN';
    // Bounded by construction — the body is unauthenticated input.
    let detail: string | null = null;
    try {
      detail = body?.detail ? JSON.stringify(body.detail).slice(0, 4 * 1024) : null;
    } catch {
      detail = null;
    }

    // Defensive: the columns are additive and nullable, and this API can be
    // deployed before the migration is applied. A failed telemetry write
    // must never turn into a 500 for a screen that is already broken — the
    // card on the glass is the primary artefact, this row is the bonus.
    try {
      // ten-ok: device boot-diagnostic report, keyed by the fingerprint
      // resolved above. No caller tenant exists; the write only touches that
      // row's own boot-diagnostic columns.
      await this.prisma.client.screen.update({
        where: { id: screen.id },
        data: {
          lastBootDiagAt: new Date(),
          lastBootDiagReason: reason,
          lastBootDiagDetail: detail,
        } as any,
      });
    } catch (e: any) {
      console.warn(`[boot-diagnostic] could not persist: ${oneLineLog(e?.message ?? '')}`);
    }

    const authed = req ? (await this.heartbeatProvesDevice(req, screen.id)).proved : false;
    const versionName = body?.versionName ? String(body.versionName).slice(0, 40) : null;
    // Every interpolated field is client-controlled on an anonymous route,
    // so CR/LF is stripped — otherwise a forged report can write convincing
    // fake entries into the log stream this is read in.
    console.warn(
      `[boot-diagnostic] fp=${oneLineLog(fingerprint).slice(0, 18)}… authed=${authed} ` +
      `reason=${reason} version=${oneLineLog(versionName) || '-'} ` +
      `detail=${oneLineLog(detail ?? '').slice(0, 400)}`,
    );

    return { ok: true };
  }

  /**
   * Parse the Chromium major version out of a stored User-Agent. We already
   * capture the full UA at register/heartbeat (Screen.userAgent); this surfaces
   * the version so operators see real per-screen browser-engine compatibility
   * instead of us guessing from a months-old incident. Returns null if the UA
   * has no Chrome token (e.g. desktop Safari dev browsers).
   *
   * Engine cutoffs that matter for our widget CSS (so the dashboard can warn):
   *   < 87  → no CSS `inset` shorthand        (swept; long-hand everywhere)
   *   < 84  → no flex `gap`                    (runtime polyfill on the player)
   *   < 105 → no container-query units (cqmin/cqh) and no `:has()`
   * The lowest live box (NovaStar/rk356x LED controller) reports Chrome 83.
   */
  private chromiumMajor(ua?: string | null): number | null {
    if (!ua || typeof ua !== 'string') return null;
    const m = /Chrome\/(\d+)/.exec(ua);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    return Number.isFinite(n) ? n : null;
  }

  // ─── ADMIN: List all screens in tenant ───
  @UseGuards(JwtAuthGuard, RbacGuard)
  @Get()
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async list(@Request() req: any, @Res({ passthrough: true }) res?: any) {
    // Force-no-cache — the fleet list is a live feed. Without this some
    // intermediaries / service workers were serving the same payload
    // for minutes after it changed, so a user who uninstalled an APK
    // still saw ONLINE until they manually cleared site data.
    if (res?.setHeader) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
    }
    const rows = await this.prisma.client.screen.findMany({
      where: { tenantId: req.user.tenantId },
      // syncMode (2026-07-28): the list view badges frame-locked groups —
      // one extra scalar on an already-joined row, no new query.
      // address/latitude/longitude: the list's effective geo is screen > GROUP >
      // tenant like the fleet route's (2026-09-14) — it used to skip the group,
      // so a group's address never placed its screens on the Screens page map.
      include: { screenGroup: { select: { id: true, name: true, syncMode: true, address: true, latitude: true, longitude: true } as any } },
      orderBy: { name: 'asc' },
    });
    // Pull the tenant's saved address/coords once so every screen WITHOUT
    // its own per-screen lat/lng can fall back to the building location
    // on the fleet map. Operator expectation: "I set the building's
    // address — every screen there should show up at that pin." See
    // ScreenMap.tsx for how `effectiveLatitude/Longitude` and `geoSource`
    // are consumed. Per-screen "Set location" still wins because we
    // keep `latitude/longitude` as the screen-specific coords.
    const tenantGeo = await this.prisma.client.tenant.findUnique({
      where: { id: req.user.tenantId },
      select: { latitude: true, longitude: true, address: true },
    });
    // 2026-09-16 — which screens are ACTUALLY frame-locked right now. The sync
    // trim control and the calibration wizard used to gate on the group's
    // syncMode; with that toggle retired they gate on this. ONE query for the
    // whole fleet list, never one per row, and it never throws — a blip falls
    // back to the legacy group flag alone, which is the pre-change behaviour.
    const syncTargets = await readSyncActiveTargets(this.prisma, req.user.tenantId);
    // Compute live online/offline from lastPingAt recency. The stored
    // `status` column only flips on register/pair/ping and never back,
    // so a player that dies silently was showing ONLINE forever. Two
    // minutes matches the heartbeat cadence (30s) + 4x grace.
    // Near-real-time fleet status. Heartbeat cadence is 30s; grace is
    // tightened to 35s (was 45s) so a dead player flips OFFLINE ~5s after
    // its first missed ping. Paired with the dashboard's 10s refetch,
    // worst case device-dies → admin-sees-OFFLINE is ~45s (previously
    // 55s). 5s buffer is enough for normal network jitter without
    // causing false offlines; a screen that legitimately loses a single
    // ping will recover by the next 30s tick.
    const STALE_MS = SCREEN_ONLINE_GRACE_MS;
    const now = Date.now();
    return rows.map((s) => {
      // If a device is actively pinging, mark ONLINE regardless of
      // stored column. If stale, flip to OFFLINE unless the stored
      // state is something stronger (PENDING means never paired, keep;
      // REVOKED trumps all; ONLINE that's gone stale becomes OFFLINE).
      let liveStatus: string = s.status;
      if (s.status !== 'REVOKED') {
        const last = s.lastPingAt ? new Date(s.lastPingAt).getTime() : 0;
        const isAlive = last && (now - last) < STALE_MS;
        if (isAlive && s.tenantId) liveStatus = 'ONLINE';
        else if (s.status === 'ONLINE' || s.tenantId) liveStatus = 'OFFLINE';
      }
      // ── Render-proof overlay (2026-05-29) ───────────────────────────
      // ADDITIVE: `liveStatus` (ONLINE/OFFLINE/PENDING/REVOKED) is computed
      // above from lastPingAt EXACTLY as before — untouched. Render-proof
      // is a SEPARATE `renderHealth` field that catches the failure
      // lastPingAt structurally CANNOT: a kiosk that's TCP-reachable
      // (fresh ping → ONLINE) but whose renderer is wedged showing a
      // stuck/black frame. The player advances a paint counter only when
      // it actually composites a frame and POSTs it to /render-proof; a
      // stale lastRenderedAt on an ONLINE screen means "looks online,
      // shows nothing" → STALE/RED. We do NOT mutate `status` for this
      // (the fleet map keys OFFLINE off `status !== 'ONLINE'`, and a
      // frozen screen is reachable, not offline) — UIs read renderHealth.
      const renderProof = deriveRenderHealth({
        isLiveOnline: liveStatus === 'ONLINE',
        lastRenderedAtMs: (s as any).lastRenderedAt
          ? new Date((s as any).lastRenderedAt).getTime()
          : null,
        // An IDLE proof is posted on a 5-minute cadence, not 30 s — judging
        // it against the playing window painted every screen with nothing
        // scheduled as "No picture confirmed" (2026-09-03).
        lastRenderedHash: (s as any).lastRenderedHash ?? null,
        nowMs: now,
      });
      // Strip heavyweight columns from the LIST response. The dashboard
      // polls /screens every 10s; at fleet scale these fields dominate
      // egress without ever being read by the list view:
      //   - lastCrashStack: up to 8KB Kotlin/JS stack from the player
      //     APK's last crash. Surfaced only on the per-screen detail
      //     drill-in, which fetches the screen by id directly.
      //   - lastSelfTestReport / userAgent: similar — drill-in only.
      //
      // 1k screens × 8KB stack = 8 MB per poll. With 100 admins online
      // that's 80 MB/s of pure egress on a field nobody reads from the
      // list. We deliberately KEEP lastCacheReport (used by the Map
      // view's per-pin emergency-cache badge in apps/web/src/components/
      // screens/ScreenMap.tsx) and lastBundleSha/lastBundleShaAt — 12 bytes
      // that the Screens list reads on EVERY row for the "Page bundle out
      // of date" chip (2026-08-25). Do not strip them.
      const { lastCrashStack: _stack, lastSelfTestReport: _self, ...rest } = s as any;
      // ── DT-04 (2026-08-03): stop handing pairing secrets to low-privilege
      // roles. `deviceFingerprint` and `pairingCode` are the two values
      // that let a caller act as, or claim, a screen: the fingerprint is
      // the key to `POST /screens/register` and to the anonymous OTA write
      // plane (`/player/update-check`, `/screens/status/:fp/ota-state`),
      // and the pairing code claims the screen outright. This list route
      // is @RequireRoles(..., CONTRIBUTOR) and RESTRICTED_VIEWER reaches
      // it through the RBAC GET pass-through, so both values were readable
      // by the two lowest-privilege roles in the product. The list view
      // renders neither — the pair modal and the per-screen detail route
      // fetch them, and those are admin-gated.
      if (!ADMIN_ROLES_FOR_SCREEN_SECRETS.has(req.user?.role)) {
        delete (rest as any).deviceFingerprint;
        delete (rest as any).pairingCode;
      }
      const chromiumMajor = this.chromiumMajor((s as any).userAgent);
      // Effective geo for the fleet map — screen > GROUP > tenant, the same
      // precedence the fleet route applies (2026-08-30 / aligned 2026-09-14):
      // an explicit screen pin wins, a group's address places every screen in
      // it, the tenant's building is the fallback, none → off the map.
      // geoSource lets the UI badge "building location" for the fallback.
      const grp = (s as any).screenGroup ?? null;
      const hasScreenCoords = s.latitude != null && s.longitude != null;
      const hasGroupCoords = grp?.latitude != null && grp?.longitude != null;
      const hasTenantCoords =
        tenantGeo?.latitude != null && tenantGeo?.longitude != null;
      const effectiveLatitude = hasScreenCoords
        ? s.latitude
        : hasGroupCoords ? grp.latitude : (hasTenantCoords ? tenantGeo!.latitude : null);
      const effectiveLongitude = hasScreenCoords
        ? s.longitude
        : hasGroupCoords ? grp.longitude : (hasTenantCoords ? tenantGeo!.longitude : null);
      const effectiveAddress = hasScreenCoords
        ? (s as any).address ?? null
        : hasGroupCoords ? (grp.address ?? null) : (hasTenantCoords ? tenantGeo!.address ?? null : null);
      const geoSource: 'screen' | 'group' | 'tenant' | 'none' = hasScreenCoords
        ? 'screen'
        : hasGroupCoords ? 'group' : (hasTenantCoords ? 'tenant' : 'none');
      return {
        ...rest,
        status: liveStatus,
        effectiveLatitude,
        effectiveLongitude,
        effectiveAddress,
        geoSource,
        // 2026-09-16 — frame-locked right now, by the SAME rule the manifest
        // answers with (screen-sync.ts). The dashboard shows the trim control
        // and the "Calibrate sync…" entry off this, so a playlist-locked
        // screen gets both and a legacy group-locked one keeps them.
        syncActive: isScreenSyncActive(
          { id: s.id, screenGroupId: s.screenGroupId ?? null, groupSyncMode: grp?.syncMode ?? null },
          syncTargets,
        ),
        // Render-proof (2026-05-29). Additive; status above is unchanged.
        //   renderHealth: 'OK'      — painted a frame within the window
        //                 'STALE'   — ONLINE (fresh ping) but NOT painting → RED
        //                 'UNKNOWN' — never reported render-proof (older build /
        //                              fresh pair / offline) — do NOT alarm
        //   renderStale: true only for the frozen-but-reachable case. A fresh
        //   ping ALONE never makes a screen OK or STALE here — only an actual
        //   render-proof POST does.
        renderHealth: renderProof.renderHealth,
        renderStale: renderProof.renderStale,
        renderStaleSeconds: renderProof.renderStaleSeconds,
        // 2026-09-03 — consumers grade with `deriveRenderTrustGrade`, which
        // reads the `idle:` prefix to tell "nothing scheduled" from "should
        // be painting and isn't". Without it every idle screen graded
        // `not-painting` and opened a district incident. Already fetched.
        lastRenderedAt: (s as any).lastRenderedAt ?? null,
        lastRenderedHash: (s as any).lastRenderedHash ?? null,
        // Push-channel health (2026-07-31 poll-only-dongle incident).
        //   'live'    — WS/SSE stamped within 10 min: instant commands reach it
        //   'stale'   — had a push channel once, silent now → poll-only
        //   'unknown' — never stamped (pre-feature build / never connected)
        // A poll-only screen still plays + gets emergencies via the 5-10s
        // HTTP backstop — this flags that PUSH (refresh, instant delivery)
        // won't arrive. Keep the 10-min rule in sync with the fleet mapper
        // below + ScreenWedgeDetectorCron.PUSH_STALE_MS.
        pushChannel: (s as any).lastPushConnectedAt
          ? (now - new Date((s as any).lastPushConnectedAt).getTime() < 10 * 60_000 ? 'live' : 'stale')
          : 'unknown',
        // Real browser-engine version + a flag the dashboard uses to warn
        // "this screen can't render container-query templates" etc.
        chromiumMajor,
        cssCompat: chromiumMajor == null
          ? null
          : {
              flexGap: chromiumMajor >= 84,
              inset: chromiumMajor >= 87,
              containerQueryUnits: chromiumMajor >= 105,
              has: chromiumMajor >= 105,
            },
      };
    });
  }

  // ─── Fleet-learned sync-trim presets (tier-2, 2026-07-28) ─────────────
  // docs/research/2026-07-28-multiscreen-sync/00-DESIGN.md §8 follow-up.
  // Different display models carry different FIXED glass latencies; when
  // operators trim them (PUT :id/sync-offset) the platform LEARNS: median
  // trim per hardware model across the whole fleet. A new screen of a
  // known-slow model gets a one-tap suggested starting trim instead of a
  // blind hunt. Returns aggregate numbers only.
  @UseGuards(JwtAuthGuard, RbacGuard)
  @Get('sync-trim-suggestions')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async syncTrimSuggestions() {
    // ten-ok: intentional CROSS-TENANT numeric aggregate — returns only
    // (hardware model, median trim ms, sample count); no tenant ids, no
    // screen ids, no names, nothing attributable. The whole point is that
    // venue B benefits from venue A having measured the same panel model
    // (the Waze model: anonymized fleet telemetry). HAVING >= 3 keeps any
    // single venue's setup from being inferable.
    const rows = await this.prisma.client.$queryRaw<
      Array<{ hardware_model: string; median_trim_ms: number; sample_count: number }>
    >`
      SELECT
        hardware_model,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY sync_offset_ms)::float8 AS median_trim_ms,
        count(*)::int AS sample_count
      FROM screens
      WHERE sync_offset_ms IS NOT NULL
        AND hardware_model IS NOT NULL
      GROUP BY hardware_model
      HAVING count(*) >= 3
    `;
    return {
      suggestions: rows.map((r) => ({
        hardwareModel: r.hardware_model,
        medianTrimMs: Math.round(r.median_trim_ms),
        sampleCount: r.sample_count,
      })),
    };
  }

  // ─── ADMIN: Fleet roll-up — HQ sees every store's screens (read-only) ───
  //
  // Manager-console pattern (Google MCC / AWS Orgs / NinjaOne): the parent
  // ("Corporate") reads ALL of its child locations' screens into ONE map +
  // list. ASYMMETRIC + READ-ONLY: a parent reads across its DIRECT children
  // (children stay sealed from each other); this endpoint NEVER mutates — any
  // action is taken by switching into the owning store (the frontend
  // deep-links into /[storeSlug]/screens). Isolation + blast-radius stay
  // intact; only the overview spans the chain. A leaf location (no children)
  // resolves to just its own screens — no cross-tenant read.
  @UseGuards(JwtAuthGuard, RbacGuard)
  @Get('fleet')
  // SCHOOL_ADMIN added 2026-08-31 (child-location Fleet Command): a leaf
  // admin's readable set is just [self], so the same endpoint serves the
  // single-location dashboard with zero extra scope.
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async fleet(
    @Request() req: any,
    @Res({ passthrough: true }) res?: any,
    @Query('tenantId') tenantIdRaw?: string,
  ) {
    if (res?.setHeader) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
    }
    // ?tenantId= re-roots the read at a child location (2026-08-31): the
    // child-location dashboard shows the SAME surface scoped to itself, and
    // an HQ admin browsing /child-slug/dashboard must see the child's info,
    // not the whole org. Validated against the caller's readable set —
    // never a free cross-tenant read.
    const rootId = await this.resolveFleetRoot(req.user.tenantId as string, tenantIdRaw);
    const sel = { id: true, name: true, slug: true, vertical: true, latitude: true, longitude: true, address: true } as const;
    const self = await this.prisma.client.tenant.findUnique({ where: { id: rootId }, select: sel });
    const children = await this.prisma.client.tenant.findMany({
      // archivedAt: null — an archived child location must NOT count toward the
      // fleet, or a parent with only archived/test children reads as a
      // multi-location "HQ" and the dashboard map appears when it shouldn't
      // (the 2026-07-23 Dodgers incident: two archived test children).
      where: { parentId: rootId, archivedAt: null },
      select: sel,
      orderBy: { name: 'asc' },
    });
    const tenants = [self, ...children].filter(Boolean) as Array<{
      id: string; name: string; slug: string; vertical: string | null;
      latitude: number | null; longitude: number | null; address: string | null;
    }>;
    const tenantIds = tenants.map((t) => t.id);
    // Per-location logos (2026-08-31 — operator: "every school has its own
    // icon but your using the district icon for everything"): each location
    // row carries ITS OWN branding logo so map pins can wear it; the org
    // logo stays the web-side fallback for locations without one.
    const brandings = await this.prisma.client.tenantBranding.findMany({
      where: { tenantId: { in: tenantIds } },
      select: { tenantId: true, logoUrl: true },
    });
    const logoByTenant = new Map(brandings.map((b) => [b.tenantId, b.logoUrl]));
    const geoByTenant = new Map(tenants.map((t) => [t.id, { latitude: t.latitude, longitude: t.longitude, address: t.address }]));
    const metaByTenant = new Map(tenants.map((t) => [t.id, { id: t.id, name: t.name, slug: t.slug, vertical: t.vertical ?? null }]));

    const rows = await this.prisma.client.screen.findMany({
      where: { tenantId: { in: tenantIds } },
      include: { screenGroup: { select: { id: true, name: true, address: true, latitude: true, longitude: true } } },
      orderBy: [{ tenantId: 'asc' }, { name: 'asc' }],
    });

    // Live status from lastPingAt recency — MUST mirror list()'s rule
    // (35s = 30s heartbeat + grace). Keep in sync with the GET / mapper.
    const STALE_MS = SCREEN_ONLINE_GRACE_MS;
    const now = Date.now();
    const screens = rows.map((s) => {
      let liveStatus: string = s.status;
      if (s.status !== 'REVOKED') {
        const last = s.lastPingAt ? new Date(s.lastPingAt).getTime() : 0;
        const isAlive = last && (now - last) < STALE_MS;
        if (isAlive && s.tenantId) liveStatus = 'ONLINE';
        else if (s.status === 'ONLINE' || s.tenantId) liveStatus = 'OFFLINE';
      }
      // Render-proof overlay — IDENTICAL derivation to list()'s (see the long
      // note there). ADDITIVE: `liveStatus` above is untouched, so the fleet
      // map's `status !== 'ONLINE' ⇒ OFFLINE` logic keeps working unchanged.
      // Costs ZERO extra queries — `lastRenderedAt` is already a column on the
      // rows we just fetched. Without this, the district rollup could see
      // "reachable" but never "reachable and NOT painting", which is the
      // failure a district admin most needs surfaced across 40 schools.
      const renderProof = deriveRenderHealth({
        isLiveOnline: liveStatus === 'ONLINE',
        lastRenderedAtMs: (s as any).lastRenderedAt
          ? new Date((s as any).lastRenderedAt).getTime()
          : null,
        // An IDLE proof is posted on a 5-minute cadence, not 30 s — judging
        // it against the playing window painted every screen with nothing
        // scheduled as "No picture confirmed" (2026-09-03).
        lastRenderedHash: (s as any).lastRenderedHash ?? null,
        nowMs: now,
      });
      const tg = geoByTenant.get(s.tenantId as string) ?? null;
      // Geo precedence (2026-08-30): screen > GROUP > tenant. A group of
      // screens is often a physical site; its address places every screen
      // in it without per-device entry, while an explicit screen pin and
      // the tenant fallback keep their existing meanings.
      const grp = (s as any).screenGroup ?? null;
      const hasScreenCoords = s.latitude != null && s.longitude != null;
      const hasGroupCoords = grp?.latitude != null && grp?.longitude != null;
      const hasTenantCoords = tg?.latitude != null && tg?.longitude != null;
      const effectiveLatitude = hasScreenCoords ? s.latitude : hasGroupCoords ? grp.latitude : (hasTenantCoords ? tg!.latitude : null);
      const effectiveLongitude = hasScreenCoords ? s.longitude : hasGroupCoords ? grp.longitude : (hasTenantCoords ? tg!.longitude : null);
      const effectiveAddress = hasScreenCoords ? ((s as any).address ?? null) : hasGroupCoords ? (grp.address ?? null) : (hasTenantCoords ? (tg!.address ?? null) : null);
      const geoSource: 'screen' | 'group' | 'tenant' | 'none' = hasScreenCoords ? 'screen' : hasGroupCoords ? 'group' : (hasTenantCoords ? 'tenant' : 'none');
      return {
        id: s.id,
        name: s.name,
        status: liveStatus,
        screenGroup: (s as any).screenGroup ?? null,
        lastPingAt: s.lastPingAt,
        lastCacheReport: (s as any).lastCacheReport ?? null,
        // Same three fields GET /screens carries per row, so a fleet-wide
        // consumer can derive render-trust with the SAME deriveRenderTrust()
        // helper the Screens list uses (apps/web/src/components/screens/
        // renderTrust.ts) instead of re-implementing the precedence.
        renderHealth: renderProof.renderHealth,
        renderStale: renderProof.renderStale,
        renderStaleSeconds: renderProof.renderStaleSeconds,
        // 2026-09-03 — consumers grade with `deriveRenderTrustGrade`, which
        // reads the `idle:` prefix to tell "nothing scheduled" from "should
        // be painting and isn't". Without it every idle screen graded
        // `not-painting` and opened a district incident. Already fetched.
        lastRenderedAt: (s as any).lastRenderedAt ?? null,
        lastRenderedHash: (s as any).lastRenderedHash ?? null,
        // Keep the 10-min rule in sync with list()'s pushChannel above.
        pushChannel: (s as any).lastPushConnectedAt
          ? (now - new Date((s as any).lastPushConnectedAt).getTime() < 10 * 60_000 ? 'live' : 'stale')
          : 'unknown',
        // Fleet Command (2026-08-31) — the "content current" assurance
        // signal. Columns are already fetched by this findMany; mapping
        // them costs bytes, not queries. Ack semantics are VALUE-identity
        // (refreshAckMs echoes pendingRefreshAt's epoch-ms — never clock
        // comparison; see the durable-refresh design in CLAUDE.md rule 6).
        lastBundleSha: (s as any).lastBundleSha ?? null,
        pendingRefreshAtMs: (s as any).pendingRefreshAt
          ? new Date((s as any).pendingRefreshAt).getTime()
          : null,
        refreshAckMs: (s as any).refreshAckMs ?? null,
        effectiveLatitude,
        effectiveLongitude,
        effectiveAddress,
        geoSource,
        // Which store this screen belongs to — drives the map cluster label
        // + the click→switch deep-link (frontend routes to its slug).
        sourceTenant: metaByTenant.get(s.tenantId as string) ?? null,
      };
    });

    const online = screens.filter((s) => s.status === 'ONLINE').length;
    const offline = screens.filter((s) => s.status === 'OFFLINE').length;
    return {
      root: metaByTenant.get(rootId) ?? null,
      // Location rows carry the tenant's OWN geo (2026-08-31, Network Atlas):
      // the dashboard's map pins used to derive position ONLY from screens'
      // effective coordinates, so a location with an address but no screens
      // yet could never appear on the map at all — the operator's "the
      // others don't even exist" bug. The screen-effective chain still wins
      // when present; this is the fallback truth for screenless locations.
      locations: tenants.map((t) => ({
        id: t.id, name: t.name, slug: t.slug,
        latitude: t.latitude, longitude: t.longitude,
        address: t.address, vertical: t.vertical ?? null,
        logoUrl: logoByTenant.get(t.id) ?? null,
      })),
      stats: { total: screens.length, online, offline, locationCount: tenants.length },
      screens,
    };
  }

  /**
   * The tenant set an admin may read across: itself plus its DIRECT,
   * non-archived children. Mirrors `fleet()`'s scope exactly — including
   * the `archivedAt: null` filter, without which a parent whose only
   * children are archived test tenants reads as a multi-location HQ (the
   * 2026-07-23 Dodgers incident). Reads only; nothing here mutates a child.
   */
  /** Resolve the tenant a fleet-scoped read roots at. No override (or the
   *  caller's own id) → the caller. A different id must sit inside the
   *  caller's readable set (self + direct non-archived children) or the
   *  read is refused — the TEN-001 shape: explicit membership check, never
   *  trust a client-supplied tenant id. */
  private async resolveFleetRoot(callerTenantId: string, requested?: string): Promise<string> {
    const want = (requested ?? '').trim();
    if (!want || want === callerTenantId) return callerTenantId;
    const readable = await this.readableTenantIds(callerTenantId);
    if (!readable.includes(want)) {
      throw new HttpException(
        { code: 'SCREEN_TENANT_SCOPE', message: 'That location is not part of your fleet' },
        HttpStatus.FORBIDDEN,
      );
    }
    return want;
  }

  private async readableTenantIds(rootId: string): Promise<string[]> {
    const children = await this.prisma.client.tenant.findMany({
      where: { parentId: rootId, archivedAt: null },
      select: { id: true },
    });
    return [rootId, ...children.map((c) => c.id)];
  }

  // ─── ADMIN: Recent deployments + LIVE convergence (Fleet Command Ph.2) ───
  //
  // One row per operator push. The question this answers is the one the
  // dashboard could never answer before: "I clicked update — did it land?"
  //
  // Convergence is computed LIVE on every read, never stored, so a row can
  // never claim a screen landed when the screen itself disagrees:
  //   converged — the target no longer carries THIS command's value. Either
  //               it acked (pendingRefreshAt cleared by the value-match on
  //               render-proof) or a LATER command superseded it. Both mean
  //               this deployment is no longer outstanding on that screen.
  //   painting  — the stronger claim: the screen is reachable AND has
  //               proven a painted frame recently. Derived with the same
  //               deriveRenderHealth() + 35s live-status rules the fleet
  //               list uses, so the two surfaces can never disagree.
  // Deliberately two separate numbers: "took the command" and "is showing
  // something" are different facts, and CLAUDE.md forbids letting one stand
  // in for the other.
  @UseGuards(JwtAuthGuard, RbacGuard)
  @Get('deployments')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async deployments(
    @Request() req: any,
    @Query('limit') limitRaw?: string,
    @Query('tenantId') tenantIdRaw?: string,
  ) {
    const callerId = req.user.tenantId as string;
    if (!callerId) throw new HttpException({ code: 'SCREEN_NO_TENANT_CONTEXT', message: 'No tenant context' }, HttpStatus.BAD_REQUEST);
    // Same child-location re-rooting as fleet() — a child dashboard's
    // deployment banner must follow that location's pushes only.
    const rootId = await this.resolveFleetRoot(callerId, tenantIdRaw);
    const limit = Math.min(Math.max(Number.parseInt(limitRaw ?? '', 10) || 10, 1), 50);
    const tenantIds = await this.readableTenantIds(rootId);

    const rows = await this.prisma.client.deployment.findMany({
      where: { tenantId: { in: tenantIds } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    if (rows.length === 0) return { deployments: [] };

    // ONE screen read for the whole page — the union of every row's
    // targets, de-duplicated. Re-scoped by tenant (TEN-001) so a stray or
    // tampered id inside a stored targetIds array can never surface a
    // screen from another tenant.
    const parseIds = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    const union = new Set<string>();
    for (const r of rows) for (const id of parseIds(r.targetIds)) union.add(id);
    const targets = await this.prisma.client.screen.findMany({
      where: { id: { in: [...union] }, tenantId: { in: tenantIds } },
      select: {
        id: true,
        status: true,
        lastPingAt: true,
        lastRenderedAt: true,
        pendingRefreshAt: true,
      },
    });
    const byId = new Map(targets.map((t) => [t.id, t]));

    // Same 35s live-ONLINE rule as list()/fleet() — keep the three in sync.
    const now = Date.now();
    const STALE_MS = SCREEN_ONLINE_GRACE_MS;

    return {
      deployments: rows.map((r) => {
        const ids = parseIds(r.targetIds);
        const valueMs = new Date(r.value).getTime();
        let converged = 0;
        let painting = 0;
        for (const id of ids) {
          const t = byId.get(id);
          if (!t) {
            // Target gone (deleted, unpaired, moved out of scope). It can't
            // still be waiting on this command, so it is not outstanding —
            // but it is provably not painting either.
            converged++;
            continue;
          }
          const pending = t.pendingRefreshAt ? new Date(t.pendingRefreshAt).getTime() : null;
          if (pending === null || pending !== valueMs) converged++;
          const last = t.lastPingAt ? new Date(t.lastPingAt).getTime() : 0;
          const isLiveOnline =
            t.status !== 'REVOKED' && !!last && now - last < STALE_MS;
          const rp = deriveRenderHealth({
            isLiveOnline,
            lastRenderedAtMs: t.lastRenderedAt ? new Date(t.lastRenderedAt).getTime() : null,
            lastRenderedHash: (t as any).lastRenderedHash ?? null,
            nowMs: now,
          });
          if (rp.renderHealth === 'OK' && !rp.renderStale && isLiveOnline) painting++;
        }
        return {
          id: r.id,
          // The location this push was fired INTO (a push is always scoped to
          // one tenant — see recordPushDeployment). Lets the fleet table
          // attribute "Last push" per location instead of org-wide.
          tenantId: r.tenantId,
          label: r.label,
          createdAt: r.createdAt,
          valueMs,
          targetCount: r.targetCount,
          convergence: {
            converged,
            painting,
            // Measured against the REAL target count, not the stored id
            // slice: a fan-out past DEPLOYMENT_TARGET_ID_CAP keeps reading
            // "not done" because we genuinely cannot prove the unstored
            // targets landed. Under-claiming is the correct direction.
            done: converged >= r.targetCount,
          },
        };
      }),
    };
  }

  // ─── ADMIN: One screen's operational timeline ───
  // The "what happened to THIS screen" strip: refresh requested (by an
  // operator or the wedge cron), acked, credential lost, credential
  // restored. Newest first. Read-only.
  @UseGuards(JwtAuthGuard, RbacGuard)
  @Get(':id/events')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async screenEvents(
    @Request() req: any,
    @Param('id') id: string,
    @Query('limit') limitRaw?: string,
  ) {
    const rootId = req.user.tenantId as string;
    if (!rootId) throw new HttpException({ code: 'SCREEN_NO_TENANT_CONTEXT', message: 'No tenant context' }, HttpStatus.BAD_REQUEST);
    const limit = Math.min(Math.max(Number.parseInt(limitRaw ?? '', 10) || 20, 1), 100);
    const tenantIds = await this.readableTenantIds(rootId);

    // Ownership is proven against the SCREEN row, not the event rows: an
    // event carries a tenantId, but the screen is the thing the caller is
    // asking about and the only authority on who owns it.
    const screen = await this.prisma.client.screen.findFirst({
      where: { id, tenantId: { in: tenantIds } },
      select: { id: true },
    });
    if (!screen) throw new HttpException({ code: 'SCREEN_NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);

    const events = await this.prisma.client.screenEvent.findMany({
      where: { screenId: id },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, kind: true, detail: true, createdAt: true },
    });
    return { events };
  }

  // ─── ADMIN: Pair a screen by code ───
  // NOTE: this endpoint also handles re-pairing an existing tenant's
  // screen (e.g. the operator regenerates a code and another admin in
  // the same tenant claims it). When the resulting tenantId differs
  // from the previously-bound tenantId we publish a TENANT_CHANGED
  // signal on the OLD tenant's channel so the device wipes its USB
  // key + cache before binding to the new tenant — closes the
  // cross-tenant content leak (audit fix #6).
  @UseGuards(JwtAuthGuard, RbacGuard)
  @Post('pair')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async pair(
    @Request() req: any,
    @Body() body: { pairingCode: string; name?: string; screenGroupId?: string },
  ) {
    const code = body.pairingCode?.trim().toUpperCase();
    if (!code) throw new HttpException({ code: 'SCREEN_PAIRING_CODE_REQUIRED', message: 'Pairing code is required' }, HttpStatus.BAD_REQUEST);

    const screen = await this.prisma.client.screen.findUnique({
      where: { pairingCode: code },
    });

    if (!screen) throw new HttpException({ code: 'SCREEN_PAIRING_CODE_INVALID', message: 'Invalid pairing code. Make sure the code matches what is shown on the screen.' }, HttpStatus.NOT_FOUND);

    if (screen.tenantId && screen.tenantId !== req.user.tenantId) {
      throw new HttpException({ code: 'SCREEN_ALREADY_PAIRED', message: 'This screen is already paired to another organization' }, HttpStatus.CONFLICT);
    }

    // ISO-01 / EM-04 (2026-08-04) — the group named at claim time must belong
    // to this tenant. Checked BEFORE the seat transaction so a bad group id
    // costs nothing and cannot consume a licence seat on its way to failing.
    await this.assertScreenGroupOwned(body.screenGroupId, req.user.tenantId);

    // Audit fix #10: wrap the seat-availability check + the screen claim
    // in a SERIALIZABLE transaction so two admins can't simultaneously pass
    // assertSeatAvailable and overshoot the seat limit. Two admins racing
    // the last seat each fall inside the other's predicate → PG SSI aborts
    // one (40001 → Prisma P2034). The seat ceiling always holds.
    //
    // P2-B fix: wrap the whole SERIALIZABLE tx in withDbRetry so the loser
    // of that race gets a clean retry instead of an unhandled 500. P2034 is
    // in withDbRetry's transient set, so it re-runs the ENTIRE thunk (the
    // assertSeatAvailable count AND the screen.update write) against a fresh
    // serializable snapshot. On retry either a seat has freed (succeeds) or
    // the ceiling is still hit and assertSeatAvailable throws a structured
    // 402 LICENSE_EXHAUSTED — which is a plain HttpException, NOT a transient
    // DB error, so withDbRetry re-throws it immediately (no wasteful retry).
    // The success path is unchanged: a tx that commits on the first attempt
    // returns its value with no added latency.
    // Re-pairing a screen that already belongs to this tenant is free.
    const isNewPair = !screen.tenantId;
    const updated = await withDbRetry(
      () =>
        this.prisma.client.$transaction(
          async (tx) => {
            if (isNewPair) {
              await this.license.assertSeatAvailable(req.user.tenantId, tx);
            }
            // ten-ok: the tenant scope IS here, in the `OR` (the static gate
            // reads only the top level of `where`). This claim CANNOT carry a
            // plain `tenantId: req.user.tenantId` predicate: the normal case is
            // an UNCLAIMED screen whose tenantId is still null, which such a
            // predicate would never match. The OR states the real rule the
            // handler already enforces above — claimable iff unowned, or
            // already mine (re-pair) — and makes it a compare-and-swap: the
            // pairing-code lookup happens OUTSIDE this transaction, so if
            // another org claimed the same code in between, this update now
            // matches nothing instead of overwriting their claim.
            return tx.screen.update({
              where: {
                id: screen.id,
                OR: [{ tenantId: null }, { tenantId: req.user.tenantId }],
              },
              data: {
                tenantId: req.user.tenantId,
                name: body.name?.trim() || screen.name,
                screenGroupId: body.screenGroupId || null,
                status: 'ONLINE',
                pairedAt: new Date(),
                pairingCode: null, // Clear the code after pairing
                // 2026-08-03 (DT-01/DT-03): claiming a screen retires every
                // credential minted for it under its previous owner. This is
                // what stops a token issued to School A from continuing to
                // authenticate — and to carry School A's tenantId claim —
                // after the physical screen is re-deployed to School B.
                // It also clears an operator revoke: re-pairing IS the
                // supported way back from `status='REVOKED'`.
                credentialEpoch: { increment: 1 },
                credentialEpochRotatedAt: new Date(),
                credentialRevokedAt: null,
                // 2026-08-30 (reliability W1-2) — an operator re-pair IS the
                // supported way back to trust: reset the credential verdict
                // so the dashboard stops saying "re-pair required" the
                // moment the re-pair actually happens. The device's next
                // re-register (inside the epoch grace window) renews to a
                // proven 180 d token and keeps it PROVEN.
                authState: 'PROVEN',
                authStateChangedAt: new Date(),
              } as any,
              include: { screenGroup: { select: { id: true, name: true } } },
            });
          },
          {
            isolationLevel: 'Serializable',
            // Default is 5s but Supabase's pgbouncer + SERIALIZABLE can
            // push past that on first connection. Raise to 20s so we
            // don't 500 on slow networks; user sees a crisp error either
            // way if the actual work exceeds 20s (which means something
            // is very wrong). maxWait bumps the pool acquisition timeout
            // so we don't fail before the transaction even starts.
            timeout: 20000,
            maxWait: 10000,
          },
        ),
      { label: 'screen.pair.seatClaim' },
    );

    // Audit fix #6: if this re-pair changed the tenant, blast a
    // TENANT_CHANGED message so the physical device wipes its DataStore
    // (token, tenantId, usbIngestKey) and its filesDir/usb-cache before
    // re-pairing against the new tenant. Without this, a kiosk physically
    // moved between districts would keep serving its old tenant's emergency
    // assets from disk.
    //
    // R-05 (2026-08-01): this used to publish on `tenant:<previousTenantId>`.
    // The payload names ONE screenId, but a tenant-scoped channel reaches
    // EVERY screen in the old district — and the player's TENANT_CHANGED
    // handler wipes its device token, manifest cache, emergency cache and SW
    // tiers. That is a district-wide kill switch. The message is per-device,
    // so it goes on the per-device channel.
    const previousTenantId = screen.tenantId;
    if (previousTenantId && previousTenantId !== req.user.tenantId) {
      try {
        const signed = this.signer.signMessage('TENANT_CHANGED', {
          screenId: screen.id,
          previousTenantId,
          newTenantId: req.user.tenantId,
        });
        await this.redisService.publish(`device:${screen.id}`, signed);
      } catch (e) {
        console.warn('[pair] failed to notify previous tenant of TENANT_CHANGED', e);
      }
    }

    invalidateDeviceCredentialCache(screen.id);
    this.notifySync(req.user.tenantId);
    // Keep the tenant's Stripe subscription quantity in lockstep with
    // live paired-screen usage (Stripe auto-prorates). Fire-and-forget
    // — a Stripe hiccup must never block pairing. A cross-tenant
    // re-pair also re-syncs the tenant that just lost the screen.
    this.stripe.syncSubscriptionQuantity(req.user.tenantId).catch(() => {});
    if (previousTenantId && previousTenantId !== req.user.tenantId) {
      this.stripe.syncSubscriptionQuantity(previousTenantId).catch(() => {});
    }
    return updated;
  }

  /**
   * Device-initiated unpair. The player calls this when the operator
   * taps "Unpair" on the kiosk overlay. Without it, clearing the
   * device's local token + reloading just re-registers under the same
   * stable Android fingerprint and the SERVER returns paired:true
   * again — the visible "unpair" did nothing.
   *
   * Effect:
   *   - tenantId cleared → next register returns paired:false
   *   - new pairingCode generated → screen can be re-paired from any
   *     dashboard the operator has access to
   *   - schedules for this screen deleted (no point in firing alerts
   *     at a now-disowned device, and a future re-pair starts fresh)
   *   - status flipped to PENDING
   *
   * Auth: requires a valid device JWT in `Authorization: Bearer ...`
   * that binds to the same screenId as the fingerprint we found.
   * Anyone with a fingerprint alone can't unpair someone else's screen.
   *
   * 2026-05-13 — operator: "i tried to unpair a device and it didnt
   * unpair". Root cause was the missing server-side step described
   * above; this endpoint closes the loop.
   */
  @Post('unpair/:deviceFingerprint')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async deviceInitiatedUnpair(
    @Param('deviceFingerprint') fingerprint: string,
    @Req() req: ExpressReq,
  ) {
    if (fingerprint.startsWith('preview-')) {
      return { ok: true, ignored: 'preview' };
    }
    const screen = await this.prisma.client.screen.findUnique({
      where: { deviceFingerprint: fingerprint },
    });
    if (!screen) {
      // Nothing to unpair — return success (idempotent).
      return { ok: true, alreadyUnpaired: true };
    }
    // Verify the caller actually owns this screen via device JWT.
    // SEC-001 (2026-09-04) — THE headline route. The doc comment above has
    // always claimed "anyone with a fingerprint alone can't unpair someone
    // else's screen", and until now that was false: two anonymous requests
    // (register with the fingerprint -> 1 h `unproven` token -> unpair)
    // cleared a paired screen's tenant, deleted its schedules, rotated its
    // credential epoch and cut it out of its emergency channel. The shared
    // verifier now refuses an unproven credential by default, so the comment
    // is true. `allowUnpaired: true` is prior behaviour and stays: unpairing
    // an already-unpaired screen is idempotent, which is what the kiosk
    // overlay's "Unpair" needs.
    const verified = await this.deviceAuth(req, screen.id, { allowUnpaired: true });
    if (!verified.ok) {
      throw new HttpException({ code: 'SCREEN_UNPAIR_UNAUTHORIZED', message: `Unauthorized: ${verified.reason}` }, HttpStatus.UNAUTHORIZED);
    }

    const previousTenantId = screen.tenantId;

    // Generate a fresh pairing code (retry on rare collision — same
    // loop as @Post('register')'s new-device path).
    let newPairingCode = generatePairingCode();
    let codeLength = 6;
    for (let attempt = 0; attempt < 50; attempt++) {
      const exists = await this.prisma.client.screen.findUnique({
        where: { pairingCode: newPairingCode },
      });
      if (!exists || exists.id === screen.id) break;
      if (attempt >= 25 && codeLength === 6) codeLength = 8;
      newPairingCode = generatePairingCode(codeLength);
    }

    await this.prisma.client.$transaction(async (tx) => {
      // Drop schedules — operator is repurposing the screen.
      await tx.schedule.deleteMany({ where: { screenId: screen.id } });
      // Clear tenant + reissue pairing code; flip status to PENDING.
      //
      // 2026-08-03 (DT-01): unpairing now also RETIRES THE CREDENTIAL.
      // Before this, an unpaired screen's 365-day token kept authenticating
      // on nine routes and kept carrying the old tenantId claim — a screen
      // pulled out of a school went on reading that school's live emergency
      // traffic for up to a year. Bumping the epoch inside the same
      // transaction means the disown and the credential kill either both
      // land or neither does.
      // ten-ok: identity-derived. `deviceAuth(req, screen.id)` above proved
      // the presented credential names THIS screen (expectedScreenId), so the
      // id is the authenticated principal and there is no caller tenant. A
      // `tenantId` predicate would also be self-defeating here: this write is
      // the disown itself (tenantId -> null), and the route is deliberately
      // idempotent for a screen whose tenantId is already null.
      await tx.screen.update({
        where: { id: screen.id },
        data: {
          tenantId: null,
          screenGroupId: null,
          pairingCode: newPairingCode,
          status: 'PENDING',
          lastPingAt: new Date(),
          credentialEpoch: { increment: 1 },
          credentialEpochRotatedAt: new Date(),
        } as any,
      });
      await tx.auditLog.create({
        data: {
          tenantId: previousTenantId || 'unknown',
          userId: null,
          action: 'SCREEN_UNPAIRED_BY_DEVICE',
          targetType: 'Screen',
          targetId: screen.id,
          details: JSON.stringify({
            name: screen.name,
            fingerprint,
            previousTenantId,
            // SDE-03 (2026-08-04) — NEVER persist the fresh pairing code here.
            //
            // This row is written under the tenant that just LOST the screen,
            // and `GET /api/v1/audit` is tenantId-scoped to exactly that tenant
            // and returns `details` verbatim to any SCHOOL_ADMIN or
            // DISTRICT_ADMIN of it. The pairing code is a live claim
            // credential: `POST /screens/pair` looks a screen up by it and
            // moves it into the caller's tenant, and right after an unpair the
            // row's tenantId is null, so the SCREEN_ALREADY_PAIRED guard does
            // not fire. Persisting it handed the previous owner a permanent key
            // back into a display they no longer possess.
            //
            // A truncated prefix is NOT an acceptable middle ground: two
            // characters of a six-character code cuts the search space by
            // ~1000x, and no support workflow reads this field. A boolean
            // marker keeps the forensic signal ("the code was rotated") with
            // none of the credential. The code still goes out in the HTTP
            // response below — to the device that just proved possession,
            // which is the one correct recipient.
            pairingCodeRotated: true,
          }),
        },
      }).catch(() => { /* non-fatal */ });
    });

    // The epoch moved — this replica must stop honouring the retired
    // credential immediately, not after the snapshot cache TTL.
    invalidateDeviceCredentialCache(screen.id);

    // Belt-and-braces (DT-01): the unpairing request PRESENTED its token,
    // so record that exact string in the DURABLE revocation store too. Its
    // expiry is derived from the JWT's own `exp` claim — 180 days for a
    // device token, not the 30-day user-session ceiling that made
    // `jwt_revoked_list` structurally unusable for this credential class.
    //
    // Scope note, stated honestly: `RedisService` exposes no `sadd`, so the
    // hot Redis set itself is not written here and this row is consulted
    // only on the Redis-down fallback path. That is fine — it is NOT the
    // control. The control is `Screen.credentialEpoch`, which lives in
    // Postgres with no TTL and is checked on every device-authenticated
    // request whether Redis is up or not.
    if (verified.ok && verified.token) {
      this.redisService.mirrorRevokedTokenDurable(verified.token).catch(() => {});
    }

    // Notify the prior tenant's dashboard so the screen list refreshes.
    if (previousTenantId) {
      try { this.notifySync(previousTenantId); } catch { /* ignore */ }
      // The prior tenant just freed a seat — re-sync its Stripe quantity.
      this.stripe.syncSubscriptionQuantity(previousTenantId).catch(() => {});
    }

    return { ok: true, screenId: screen.id, newPairingCode };
  }

  /**
   * ISO-01 / EM-04 (2026-08-04) — a screen may only join a ScreenGroup that
   * belongs to its OWN tenant.
   *
   * Both write sites (`PUT /screens/:id` and the pair/claim endpoint) took
   * `body.screenGroupId` on trust and wrote it straight to the row. Nothing
   * checked the group's tenant, and ScreenGroup ids are opaque cuids, so an
   * admin who learned one — a support thread, a shared screenshot, a former
   * employer — could bind their own screen into another tenant's group.
   *
   * That is not cosmetic. Schedule resolution matches a screen by its group
   * (`scheduleTargetOr.push({ screenGroupId: screen.screenGroupId })`, further
   * down this file), so the screen starts playing the OTHER tenant's playlists
   * on hardware the attacker physically controls — a pull-based cross-tenant
   * content read. Group scope is also a targeting unit for emergency
   * broadcasts and for frame-locked sync.
   *
   * Every other controller that accepts a screenGroupId already validates it
   * this way (schedules.controller.ts:146-153, screen-groups, emergency,
   * sports). This file was the gap.
   *
   * Fails as NOT_FOUND rather than FORBIDDEN on purpose: a distinct 403 would
   * confirm the id exists in some other tenant, turning the endpoint into an
   * id-probing oracle.
   */
  private async assertScreenGroupOwned(
    screenGroupId: string | null | undefined,
    tenantId: string,
  ): Promise<void> {
    // undefined = field absent (leave unchanged); null / '' = clear the group.
    // Neither can move a screen INTO another tenant, so neither needs a lookup.
    if (!screenGroupId) return;
    const owned = await this.prisma.client.screenGroup.findFirst({
      where: { id: screenGroupId, tenantId },
      select: { id: true },
    });
    if (!owned) {
      throw new HttpException(
        { code: 'SCREEN_GROUP_NOT_FOUND', message: 'Screen group not found' },
        HttpStatus.NOT_FOUND,
      );
    }
  }

  // ─── ADMIN: Update a screen ───
  @UseGuards(JwtAuthGuard, RbacGuard)
  @Put(':id')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async update(
    @Request() req: any,
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      location?: string;
      screenGroupId?: string | null;
      // 2026-05-27 — hardware identification (Agent A, c175aab). Either
      // a known model id from HARDWARE_CATALOG, OR null to clear it
      // back to "unassigned". An unknown / typo'd string returns 400.
      hardwareModel?: HardwareModel | string | null;
      // 2026-05-27 — open-shape hardware config (Agent B, 8ac813b).
      // EP6N wiring + future per-hardware keys. Allow-listed by the
      // merge step below so a stale client can't bloat the row.
      config?: Record<string, unknown> | null;
    },
  ) {
    // Fleet-scoped since 2026-08-31 (dashboard device drawer): an HQ admin
    // fixing a child location's screen from the dashboard edits basics
    // (name etc.) without switching tenants — the same parent→child window
    // refresh-web already opens. Membership is the readable set (self +
    // direct non-archived children); anything else stays a 404.
    const readable = await this.readableTenantIds(req.user.tenantId);
    const screen = await this.prisma.client.screen.findFirst({
      where: { id, tenantId: { in: readable } },
    });
    if (!screen) throw new HttpException({ code: 'SCREEN_NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);

    // ISO-01 / EM-04 (2026-08-04) — the target group must belong to the
    // SCREEN'S OWN tenant (not the caller's — a parent moving a child's
    // screen into one of the parent's groups would cross the boundary).
    await this.assertScreenGroupOwned(body.screenGroupId, screen.tenantId as string);

    // Resolve hardwareModel against the catalog (Agent A). Permissive
    // case/whitespace normalization via resolveHardwareModel; unknown
    // strings return 400.
    let nextHardwareModel: string | null | undefined = undefined;
    if (body.hardwareModel === null) {
      nextHardwareModel = null;
    } else if (typeof body.hardwareModel === 'string' && body.hardwareModel.trim()) {
      const resolved = resolveHardwareModel(body.hardwareModel);
      const normalized = body.hardwareModel.trim().toLowerCase();
      const isKnown = (HARDWARE_MODELS as readonly string[]).includes(normalized);
      if (!isKnown) {
        throw new HttpException(
          {
            error: 'INVALID_HARDWARE_MODEL',
            message:
              'hardwareModel must be one of: ' + HARDWARE_MODELS.join(', '),
            received: body.hardwareModel,
          },
          HttpStatus.BAD_REQUEST,
        );
      }
      nextHardwareModel = resolved;
      if (!HARDWARE_CATALOG[resolved]) {
        throw new HttpException({ code: 'SCREEN_HARDWARE_CATALOG_DRIFT', message: 'hardware-models catalog drift detected — please report this bug' }, HttpStatus.INTERNAL_SERVER_ERROR);
      }
    }

    // 2026-05-27 — Goodview EP6N WiringPanel + future hardware-config
    // payloads (Agent B). Merge incoming `config` into the existing
    // Screen.config JSON column, but only allow-listed keys, so a
    // stale client can't bloat the row. `config: null` wipes the
    // column; sending an inner key as null deletes just that key.
    // Allow-list covers EP6N wiring today; reserved keys are documented
    // intentions for upcoming hardware features (NOT wired yet).
    const CONFIG_ALLOW_LIST = new Set([
      'wiring',          // EP6N RS232 + RS485 + GPIO routing (Agent B)
      'consoleProfile',  // which scoreboard console drives this screen
                         //   ('cts-gen6' | 'cts-wttc' | 'daktronics-allsport').
                         //   CtsBridge reads it (via the manifest) to pick
                         //   the serial settings + default tty + decoder.
      'gpioState',       // GPIO OUT live state (Agent C) — server-driven
                         //                                  but allowed
                         //                                  here for
                         //                                  forensic
                         //                                  manual edits
      'hdmiInSource',    // EP6N HDMI input passthrough (reserved)
      'audioOut',        // future per-screen audio routing (reserved)
      'usbLayout',       // future USB peripheral mapping (reserved)
    ]);

    let mergedConfig: Record<string, unknown> | null | undefined = undefined;
    if (body.config !== undefined) {
      if (body.config === null) {
        mergedConfig = null;
      } else if (typeof body.config === 'object' && !Array.isArray(body.config)) {
        const current: Record<string, unknown> = (screen as any).config
          && typeof (screen as any).config === 'object'
          && !Array.isArray((screen as any).config)
          ? { ...(screen as any).config }
          : {};
        for (const [key, value] of Object.entries(body.config)) {
          if (!CONFIG_ALLOW_LIST.has(key)) continue;
          if (value === null) {
            delete current[key];
          } else {
            current[key] = value;
          }
        }
        mergedConfig = current;
      } else {
        throw new HttpException({ code: 'SCREEN_CONFIG_INVALID', message: 'config must be an object (or null to clear)' }, HttpStatus.BAD_REQUEST);
      }
    }

    const updated = await this.prisma.client.screen.update({
      // SEC-009: the tenant window rides the WRITE, not only the read above.
      // It is the FLEET window (`readable` = the caller's tenant plus its own
      // non-archived children), NOT `req.user.tenantId` — a district admin
      // editing a child school's screen is a supported, exercised path, and
      // narrowing it here would 404 them.
      where: { id, tenantId: { in: readable } },
      data: {
        name: body.name?.trim() || screen.name,
        location: body.location !== undefined ? (body.location?.trim() || null) : screen.location,
        screenGroupId: body.screenGroupId !== undefined ? (body.screenGroupId || null) : screen.screenGroupId,
        // Only patch each hardware field when it was actually present
        // in the body — `undefined` preserves the existing column value.
        ...(nextHardwareModel !== undefined ? { hardwareModel: nextHardwareModel } : {}),
        ...(mergedConfig !== undefined ? { config: mergedConfig as any } : {}),
      },
      include: { screenGroup: { select: { id: true, name: true } } },
    });
    // A group move changes `screenGroupId`, which the credential snapshot
    // carries (the interceptor copies it onto the device principal) and the
    // manifest identity preamble caches. The Prisma mutation hook now catches
    // this too, but the explicit call is what makes THIS replica exact on the
    // very next request rather than relying on a hook that arms at boot
    // (2026-09-03, efficiency L1).
    invalidateDeviceCredentialCache(id);
    // The SCREEN's tenant, not the caller's — a cross-location edit must
    // bust the manifest cache where the screen actually lives.
    this.notifySync(screen.tenantId as string);
    return updated;
  }

  // ─── 2026-05-24 — per-screen orientation lock ───
  // Replaces the old "let the device sensor decide" behavior on
  // stationary signage hardware (Goodview / NovaStar Taurus / BrightSign
  // / no-name Android boxes mounted on a wall) that has no useful
  // accelerometer. Operator flips orientation from the dashboard; the
  // change broadcasts via signed WS to the kiosk and persists in DB so
  // a cold-boot picks the same value from the manifest.
  //
  // Player APK maps the three string values to ActivityInfo constants:
  //   LANDSCAPE → SCREEN_ORIENTATION_LANDSCAPE
  //   PORTRAIT  → SCREEN_ORIENTATION_PORTRAIT
  //   AUTO      → SCREEN_ORIENTATION_UNSPECIFIED  (back to sensor)
  // If a stubborn ROM ignores setRequestedOrientation, the /player route
  // applies a CSS transform:rotate fallback within 2s.
  @Put(':id/orientation')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async setOrientation(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { orientation?: string; reason?: string },
  ) {
    const target = String(body.orientation || '').toUpperCase().trim();
    const ALLOWED = new Set(['LANDSCAPE', 'PORTRAIT', 'AUTO']);
    if (!ALLOWED.has(target)) {
      throw new HttpException({ code: 'SCREEN_ORIENTATION_INVALID', message: 'orientation must be one of: LANDSCAPE, PORTRAIT, AUTO' }, HttpStatus.BAD_REQUEST);
    }

    // Fleet-scoped since 2026-08-31 (dashboard device drawer) — same
    // parent→child window as update()/refresh-web above.
    const orientationReadable = await this.readableTenantIds(req.user.tenantId);
    const screen = await this.prisma.client.screen.findFirst({
      where: { id, tenantId: { in: orientationReadable } },
      select: { id: true, name: true, orientation: true, tenantId: true },
    });
    if (!screen) throw new HttpException({ code: 'SCREEN_NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);

    // Update + audit in a single transaction so partial state is
    // impossible. Same pattern as the OAuth-purge audit-log sweep
    // shipped earlier today.
    const updated = await this.prisma.client.$transaction(async (tx) => {
      const u = await tx.screen.update({
        // SEC-009: same fleet window as the read above (parent -> child), in
        // the write itself.
        where: { id, tenantId: { in: orientationReadable } },
        data: { orientation: target },
      });
      await tx.auditLog.create({
        data: {
          // The SCREEN's own tenant — a cross-location change must land in
          // the affected location's audit trail (same convention as the
          // fleet-scoped refresh-web events). The readable-set WHERE means a
          // matched row always carries a tenant; the fallback only satisfies
          // the nullable column type.
          tenantId: screen.tenantId ?? req.user.tenantId,
          userId: req.user?.id ?? null,
          action: 'SCREEN_ORIENTATION_CHANGED',
          targetType: 'Screen',
          targetId: id,
          details: JSON.stringify({
            from: screen.orientation,
            to: target,
            reason: body.reason ?? null,
          }),
        },
      });
      return u;
    });

    // Signed WS broadcast so any connected player flips immediately.
    // The player APK handler also re-applies on next manifest poll, so
    // a kiosk that missed the WS message (offline / Redis blip) still
    // converges within the manifest poll window (~10s).
    const signed = this.signer.signMessage('ORIENTATION_CHANGE', {
      screenId: id,
      orientation: target,
      reason: body.reason ?? null,
    });
    try {
      await this.redisService.publish(`device:${id}`, signed);
    } catch {
      // Redis blip is non-fatal — the manifest is the source of truth.
      // Player will pick up the new orientation on next manifest poll.
    }

    return updated;
  }

  /**
   * 2026-05-26 — per-screen LED canvas dimensions. Operator:
   * "put it on the screen settings from the dashboard itself".
   *
   * Some LED controllers (NovaStar Taurus, SMART LED POSTER) ship a
   * frame buffer (typically 1920×1080) that's wider than the physical
   * LED's visible pixel range. A single 320×1080 portrait panel only
   * lights the leftmost 320 px of the 1920-wide source. Daisy-chained
   * panels add 320 to the visible width per panel (1=320, 2=640, ...
   * 6=1920). When the operator picks the panel count on the dashboard,
   * we persist canvasW/canvasH here AND signed-WS broadcast to the
   * device so the kiosk applies the new canvas without waiting for
   * the next manifest poll.
   *
   * canvasW / canvasH null = use the controller's native viewport
   * (fine for regular landscape kiosks; only narrow LED chains need
   * the override).
   */
  @Put(':id/canvas')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async setCanvas(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { canvasW?: number | null; canvasH?: number | null; repeats?: number; reason?: string },
  ) {
    // Accept null to CLEAR; otherwise clamp to a sane range. 32px floor
    // catches typo "0", 8192px ceiling catches typo "32000" — anything
    // outside that range is almost certainly wrong.
    const validate = (n: any): number | null => {
      if (n === null || n === undefined || n === '') return null;
      const parsed = parseInt(String(n), 10);
      if (!isFinite(parsed) || parsed < 32 || parsed > 8192) {
        throw new HttpException({ code: 'SCREEN_CANVAS_INVALID', message: 'canvasW/canvasH must be null OR an integer between 32 and 8192' }, HttpStatus.BAD_REQUEST);
      }
      return parsed;
    };
    const w = validate(body.canvasW);
    const h = validate(body.canvasH);
    // 2026-05-26 — repeats: 1..12. 1 = no tiling. Operator picks 4 for
    // a 40ft ribbon that should show the same content every 10ft.
    let repeats = 1;
    if (body.repeats !== undefined && body.repeats !== null) {
      const r = parseInt(String(body.repeats), 10);
      if (!isFinite(r) || r < 1 || r > 12) {
        throw new HttpException({ code: 'SCREEN_CANVAS_REPEATS_INVALID', message: 'repeats must be an integer between 1 and 12' }, HttpStatus.BAD_REQUEST);
      }
      repeats = r;
    }

    const screen = await this.prisma.client.screen.findFirst({
      where: { id, tenantId: req.user.tenantId },
      select: { id: true, name: true, tenantId: true, canvasW: true, canvasH: true, repeats: true },
    });
    if (!screen) throw new HttpException({ code: 'SCREEN_NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);

    const updated = await this.prisma.client.$transaction(async (tx) => {
      const u = await tx.screen.update({
        // SEC-009: tenant predicate in the write, matching the read above.
        where: { id, tenantId: req.user.tenantId },
        data: { canvasW: w, canvasH: h, repeats },
      });
      await tx.auditLog.create({
        data: {
          tenantId: req.user.tenantId,
          userId: req.user?.id ?? null,
          action: 'SCREEN_CANVAS_CHANGED',
          targetType: 'Screen',
          targetId: id,
          details: JSON.stringify({
            from: { w: screen.canvasW, h: screen.canvasH, repeats: screen.repeats },
            to: { w, h, repeats },
            reason: body.reason ?? null,
          }),
        },
      });
      return u;
    });

    // Signed WS broadcast — kiosk applies the new canvas immediately
    // (sets --led-w / --led-h CSS vars + reloads splash) without
    // waiting for the next 10s manifest poll. Same pattern as
    // ORIENTATION_CHANGE.
    const signed = this.signer.signMessage('CANVAS_CHANGE', {
      screenId: id,
      canvasW: w,
      canvasH: h,
      repeats,
      reason: body.reason ?? null,
    });
    try {
      await this.redisService.publish(`device:${id}`, signed);
    } catch {
      // Manifest poll converges within ~10s.
    }

    return updated;
  }

  /**
   * 2026-07-28 — frame-locked multi-screen sync: per-screen latency trim.
   * docs/research/2026-07-28-multiscreen-sync/00-DESIGN.md §7-8.
   *
   * Different display models add different FIXED pipeline latencies (LED
   * controller scaling, TV motion smoothing adds 30-80ms) that no browser
   * can see — two perfectly clock-synced players can still be a frame+
   * apart on glass. This is the AVR-lip-sync-style knob: the operator
   * points a phone camera at both screens and nudges until aligned.
   * Applied player-side as an offset on the shared clock (manifest
   * `sync.trimMs`); manifest ETag covers it, so screens converge within a
   * poll. Null clears back to 0. Clamped ±2000ms (a display pipeline
   * beyond 2s is broken hardware, not a trim).
   */
  @Put(':id/sync-offset')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async setSyncOffset(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { syncOffsetMs?: number | null },
  ) {
    let offset: number | null = null;
    if (body.syncOffsetMs !== null && body.syncOffsetMs !== undefined) {
      const parsed = Math.round(Number(body.syncOffsetMs));
      if (!Number.isFinite(parsed) || Math.abs(parsed) > 2000) {
        throw new HttpException(
          { code: 'SCREEN_SYNC_OFFSET_INVALID', message: 'syncOffsetMs must be null OR an integer between -2000 and 2000' },
          HttpStatus.BAD_REQUEST,
        );
      }
      offset = parsed;
    }

    const screen = await this.prisma.client.screen.findFirst({
      where: { id, tenantId: req.user.tenantId },
      select: { id: true, name: true, tenantId: true, syncOffsetMs: true } as any,
    });
    if (!screen) throw new HttpException({ code: 'SCREEN_NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);

    return this.prisma.client.$transaction(async (tx) => {
      const updated = await tx.screen.update({
        // SEC-009: tenant predicate in the write, matching the read above.
        where: { id, tenantId: req.user.tenantId },
        data: { syncOffsetMs: offset } as any,
      });
      await tx.auditLog.create({
        data: {
          tenantId: req.user.tenantId,
          userId: req.user?.id ?? null,
          action: 'SCREEN_SYNC_OFFSET_CHANGED',
          targetType: 'Screen',
          targetId: id,
          details: JSON.stringify({
            from: (screen as any).syncOffsetMs ?? null,
            to: offset,
          }),
        },
      });
      return updated;
    });
  }

  /**
   * 2026-05-25 — device-authenticated companion to PUT /:id/orientation.
   *
   * The pairing-splash orientation picker on the player runs BEFORE an
   * operator has claimed the kiosk, so the player can't authenticate as
   * an admin yet. It can however prove device identity via the device
   * JWT it received at boot. This endpoint accepts that token, verifies
   * the JWT.sub matches the targeted screenId, and applies the same
   * persistence + signed WS broadcast + audit-log writes as the
   * operator endpoint.
   *
   * Authorization model is the same as
   * /:id/manifest + /:id/emergency-assets — verifyDeviceForScreen. Any
   * device that tries to write a different screen's orientation is
   * rejected at the auth gate.
   *
   * AuditLog row carries `source: 'device'` so a forensic reader can
   * tell operator-driven changes from kiosk-driven ones.
   */
  @Put(':id/orientation/device')
  async setOrientationFromDevice(
    @Param('id') id: string,
    @Req() req: ExpressReq,
    @Body() body: { orientation?: string; reason?: string },
  ) {
    // SEC-001 — prior behaviour, stated. Pre-claim orientation is the whole
    // reason the permissive default existed (a screen picks portrait vs
    // landscape on the pairing splash, before any tenant exists).
    const auth = await this.deviceAuth(req, id, { allowUnpaired: true });
    if (!auth.ok) {
      throw new HttpException({ code: 'SCREEN_DEVICE_AUTH_REQUIRED', message: `Device auth required (${auth.reason})` }, HttpStatus.UNAUTHORIZED);
    }

    const target = String(body.orientation || '').toUpperCase().trim();
    const ALLOWED = new Set(['LANDSCAPE', 'PORTRAIT', 'AUTO']);
    if (!ALLOWED.has(target)) {
      throw new HttpException({ code: 'SCREEN_ORIENTATION_INVALID', message: 'orientation must be one of: LANDSCAPE, PORTRAIT, AUTO' }, HttpStatus.BAD_REQUEST);
    }

    // ten-ok: identity-derived. `deviceAuth(req, id, { allowUnpaired: true })`
    // above proved the credential names THIS screen. The route exists for the
    // PRE-CLAIM case (a panel picks portrait vs landscape on the pairing
    // splash), so the row's tenantId is legitimately null and there is no
    // tenant on either side to scope against.
    const screen = await this.prisma.client.screen.findUnique({
      where: { id },
      select: { id: true, tenantId: true, orientation: true, name: true },
    });
    if (!screen) throw new HttpException({ code: 'SCREEN_NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);

    const updated = await this.prisma.client.$transaction(async (tx) => {
      // ten-ok: same identity-derived invariant as the read directly above —
      // device-proved screen id, pre-claim screens have no tenant.
      const u = await tx.screen.update({
        where: { id },
        data: { orientation: target },
      });
      // Only audit when there's a tenant — pre-pair screens (tenantId
      // null) still get a row but with a sentinel tenantId to keep the
      // FK happy. AuditLog requires tenantId NOT NULL per schema; for
      // pre-pair changes we skip the audit row — the persisted value
      // alone is enough forensic signal for "what did the screen pick
      // during setup" since the next manifest poll will reveal it.
      if (screen.tenantId) {
        await tx.auditLog.create({
          data: {
            tenantId: screen.tenantId,
            userId: null,
            action: 'SCREEN_ORIENTATION_CHANGED',
            targetType: 'Screen',
            targetId: id,
            details: JSON.stringify({
              from: screen.orientation,
              to: target,
              source: 'device',
              reason: body.reason ?? null,
            }),
          },
        });
      }
      return u;
    });

    // Signed WS broadcast — even though the player IS the one that
    // requested the change, broadcasting closes the loop with any
    // dashboard tabs currently watching this screen + keeps the
    // device:<id> channel as the single source of truth.
    const signed = this.signer.signMessage('ORIENTATION_CHANGE', {
      screenId: id,
      orientation: target,
      source: 'device',
      reason: body.reason ?? null,
    });
    try {
      await this.redisService.publish(`device:${id}`, signed);
    } catch { /* non-fatal — manifest poll converges */ }

    return updated;
  }

  /**
   * Sprint 13 — CTS scoreboard bridge POST endpoint.
   *
   * The Beelink mini PC running the CTS bridge POSTs decoded
   * snapshots here (see apps/web/src/components/player/CtsBridge.tsx).
   * The API signs + publishes a GAME_STATE message on the
   * `device:<screenId>` Redis channel; every player connected to
   * that screen receives the snapshot via WS within ~150ms and the
   * scoreboard widget re-renders.
   *
   * Auth: device JWT (verifyDeviceForScreen) — same model as the
   * existing /:id/manifest + /:id/emergency-assets endpoints. The
   * Beelink already holds a device token from pairing. We deliberately
   * do NOT also accept the admin JwtAuthGuard path; the bridge is the
   * only legit caller and it authenticates as the device.
   *
   * Persistence: NONE in v1. Game state is ephemeral (full snapshot
   * arrives every ~125ms while a game is live); persisting every
   * update would write ~30,000 rows / hour with no downstream reader
   * needing them. Replay is captured via the existing AuditLog stream
   * when a future Sprint 13 phase adds a `GameEvent` table.
   *
   * Rate limit: SkipThrottle + an in-handler floor (max 16 Hz per
   * screen) so a misbehaving bridge can't DOS the WS bus. The bridge
   * already throttles at 8 Hz client-side; 16 Hz here is double that
   * to absorb burst.
   */
  @Post(':id/game-state')
  @SkipThrottle()
  async postGameState(
    @Param('id') id: string,
    @Req() req: ExpressReq,
    @Body() body: { source?: string; snapshot?: Record<string, unknown> },
  ) {
    // SEC-001 — prior behaviour, stated. Tightening this to `false` is a
    // candidate follow-up (game state is tenant data), deliberately NOT
    // bundled into a security fix that must not change what plays.
    const auth = await this.deviceAuth(req, id, { allowUnpaired: true });
    if (!auth.ok) {
      throw new HttpException({ code: 'SCREEN_DEVICE_AUTH_REQUIRED', message: `Device auth required (${auth.reason})` }, HttpStatus.UNAUTHORIZED);
    }
    if (!body || typeof body !== 'object' || !body.snapshot || typeof body.snapshot !== 'object') {
      throw new HttpException({ code: 'SCREEN_GAME_STATE_SNAPSHOT_REQUIRED', message: 'snapshot is required' }, HttpStatus.BAD_REQUEST);
    }

    // Per-screen rate floor: 16 Hz max. Reuses the in-memory rate
    // pattern from manifest-hot-cache.ts (single replica safe; multi-
    // replica is fine because Redis is the broadcast bus, not the
    // dedup point). Misbehaving bridges get silently capped — we
    // return 200 with `throttled: true` rather than 429 so the
    // bridge's `postCount` UI doesn't redline visually.
    const now = Date.now();
    const last = _gameStateRateMap.get(id) ?? 0;
    if (now - last < 62) {
      return { ok: true, throttled: true };
    }
    _gameStateRateMap.set(id, now);
    // Cap the in-memory map at a sane bound — most installs have <50
    // screens with CTS bridges, but in case someone bulk-installs:
    if (_gameStateRateMap.size > 500) {
      const cutoff = now - 60_000;
      for (const [k, v] of _gameStateRateMap) {
        if (v < cutoff) _gameStateRateMap.delete(k);
      }
    }

    const signed = this.signer.signMessage('GAME_STATE', {
      screenId: id,
      source: typeof body.source === 'string' ? body.source : 'cts',
      snapshot: body.snapshot,
    });
    try {
      await this.redisService.publish(`device:${id}`, signed);
    } catch {
      // Redis blip: snapshot is ephemeral, the next snapshot (≤ 125ms
      // away) will retry. No fallback needed for game state — unlike
      // emergencies, a dropped frame is a missed render, not a safety
      // issue.
    }
    return { ok: true };
  }

  /**
   * Sprint 13 — CTS celebration MANUAL cue trigger.
   *
   * Operator (or Stream Deck button, or phone tap) wants to fire a
   * specific celebration cue on a specific ribbon screen RIGHT NOW,
   * regardless of what the CTS bridge sees. This endpoint takes the
   * cueId and broadcasts a CTS_MANUAL_CUE on the device channel; the
   * player page handles it by dispatching the same
   * `edu:cts-celebration-preview` window event the orchestrator's
   * Properties-panel test buttons fire.
   *
   * Auth: admin / contributor JWT. SUPER_ADMIN / DISTRICT_ADMIN /
   * SCHOOL_ADMIN / CONTRIBUTOR — same scope as fireCue on the existing
   * scoreboard celebration system.
   *
   * Stream Deck integration: configure a Stream Deck button with the
   * Web Request action, POST to this URL with the Bearer token of a
   * dashboard user that has CONTRIBUTOR+ role, body
   * `{"cueId":"CEL_SOCCER_GOAL","team":"home"}`. Show caller hits
   * one button → ribbon fires the cinematic instantly.
   *
   * AuditLog row written on every fire so a forensics review can
   * answer "who fired which cue at what time on which screen".
   */
  @Post(':id/cts-manual-cue')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  async ctsManualCue(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { cueId?: string; team?: 'home' | 'away' | 'horn' },
  ) {
    if (!body || typeof body !== 'object' || !body.cueId || typeof body.cueId !== 'string') {
      throw new HttpException({ code: 'SCREEN_GAME_STATE_CUE_ID_REQUIRED', message: 'cueId is required' }, HttpStatus.BAD_REQUEST);
    }
    const cueId = String(body.cueId).slice(0, 64);
    const team: 'home' | 'away' | 'horn' = body.team === 'away' ? 'away' : body.team === 'horn' ? 'horn' : 'home';

    // Verify the operator's tenant owns this screen — prevents a
    // contributor on tenant A from firing a cue on tenant B's ribbon.
    const screen = await this.prisma.client.screen.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!screen) {
      throw new HttpException({ code: 'SCREEN_NOT_FOUND', message: 'Screen not found' }, HttpStatus.NOT_FOUND);
    }

    const signed = this.signer.signMessage('CTS_MANUAL_CUE', {
      screenId: id,
      cueId,
      team,
      source: 'manual',
      firedByUserId: req.user.id,
    });
    try {
      await this.redisService.publish(`device:${id}`, signed);
    } catch {
      // Redis blip: the operator can tap again; manual cues are not
      // retried server-side (the next tap is the retry).
    }
    // Forensic audit — immutable record of every manual cue fire.
    try {
      await this.prisma.client.auditLog.create({
        data: {
          tenantId: req.user.tenantId,
          userId: req.user.id,
          action: 'CTS_MANUAL_CUE_FIRED',
          targetType: 'Screen',
          targetId: id,
          details: JSON.stringify({ cueId, team }),
        },
      });
    } catch {
      // Best-effort — never let an audit failure block the cue.
    }
    return { ok: true, cueId, team };
  }

  // ─── Sprint 8 — set screen geo location (map view) ───
  // Admin types an address (or pastes lat/lng); we forward to the
  // OpenStreetMap Nominatim public endpoint to geocode, store all three.
  // Nominatim is rate-limited to ~1 req/sec per IP; the request fires
  // server-side from this NestJS process, so the rate limit is per-deploy
  // and easily fits typical admin usage.
  //
  // No third-party API key required. If Nominatim is offline or refuses,
  // we still save the raw address and any caller-provided coordinates.
  @UseGuards(JwtAuthGuard, RbacGuard)
  @Put(':id/location')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async setLocation(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { address?: string | null; latitude?: number | null; longitude?: number | null; photoUrl?: string | null },
  ) {
    const screen = await this.prisma.client.screen.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!screen) throw new HttpException({ code: 'SCREEN_NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);

    // Cap the address — it is interpolated into a Nominatim query string
    // and persisted to a DB column; an unbounded value bloats both.
    // Real postal addresses are short.
    if (typeof body.address === 'string' && body.address.length > 300) {
      throw new HttpException({ code: 'SCREEN_ADDRESS_TOO_LONG', message: 'Address is too long (max 300 characters).' }, HttpStatus.BAD_REQUEST);
    }

    let lat = body.latitude ?? screen.latitude ?? null;
    let lng = body.longitude ?? screen.longitude ?? null;
    const addressChanged = body.address !== undefined && body.address !== screen.address;

    // Geocode if the operator gave us a fresh address but no explicit
    // coordinates. Use OSM Nominatim (free, no key). Polite single
    // request with a descriptive User-Agent (their ToS).
    //
    // 2026-05-23 launch audit P2 #8: route through safeFetch so the
    // hostname is DNS-pinned and a private-IP / link-local redirect
    // can't exfil internal metadata. Nominatim is a fixed public
    // hostname so the risk is low, but the project's documented rule
    // is "never call fetch(url) directly in the API" (see
    // branding/safe-fetch.ts header comment) and this was the last
    // un-audited outbound HTTP call.
    if (addressChanged && body.address && body.latitude === undefined && body.longitude === undefined) {
      try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(body.address)}`;
        const r = await safeFetch(url, {
          userAgent: 'EduCMS/1.0 (+https://educms.app)',
          timeoutMs: 5000,
          maxBytes: 64 * 1024, // tiny JSON response, cap defensively
          accept: 'application/json',
        });
        if (r.status >= 200 && r.status < 300) {
          const arr = JSON.parse(r.body.toString('utf8')) as Array<{ lat: string; lon: string }>;
          if (arr[0]) {
            lat = parseFloat(arr[0].lat);
            lng = parseFloat(arr[0].lon);
          }
        }
      } catch {
        // Geocode failure (including timeout / SSRF reject / body too
        // large) is non-fatal — the admin can still set lat/lng manually.
      }
    }

    const updated = await this.prisma.client.screen.update({
      // SEC-009: tenant predicate in the write, matching the read above.
      where: { id, tenantId: req.user.tenantId },
      data: {
        address: body.address !== undefined ? (body.address?.trim() || null) : screen.address,
        latitude: lat,
        longitude: lng,
        photoUrl: body.photoUrl !== undefined ? (body.photoUrl?.trim() || null) : screen.photoUrl,
      },
      include: { screenGroup: { select: { id: true, name: true } } },
    });
    this.notifySync(req.user.tenantId);
    return updated;
  }

  // ─── Sprint 8b — per-screen emergency content config ───
  // Lets the operator set, for each of the 6 emergency types
  // (LOCKDOWN / EVACUATE / WEATHER / HOLD / SECURE / MEDICAL), either:
  //   • a specific Playlist id  → that playlist plays on THIS screen
  //                              when this type fires
  //   • null                    → falls back to Tenant.panic*PlaylistId
  // The manifest endpoint resolves these per-screen settings BEFORE
  // the tenant defaults so "different content per room" works without
  // a manual trigger event.
  //
  // Body shape — all 6 keys optional. Pass null to clear an override
  // (resume tenant default). Unspecified keys are left untouched.
  @UseGuards(JwtAuthGuard, RbacGuard)
  @Put(':id/emergency-content')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async setEmergencyContent(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: {
      lockdownPlaylistId?: string | null;
      evacuatePlaylistId?: string | null;
      weatherPlaylistId?: string | null;
      holdPlaylistId?: string | null;
      securePlaylistId?: string | null;
      medicalPlaylistId?: string | null;
      // Per-type custom asset URL — single uploaded image/video shown
      // full-screen for that emergency. Setting either playlistId OR
      // assetUrl for a type wins over tenant defaults; manifest checks
      // playlist first, falls back to asset, falls back to tenant.
      lockdownAssetUrl?: string | null;
      evacuateAssetUrl?: string | null;
      weatherAssetUrl?: string | null;
      holdAssetUrl?: string | null;
      secureAssetUrl?: string | null;
      medicalAssetUrl?: string | null;
      // Portrait variants. Same six types again. Manifest picks
      // landscape vs portrait based on the screen's physical
      // resolution. Operator usually configures both so the right
      // poster shows on each kiosk regardless of orientation.
      lockdownPortraitPlaylistId?: string | null;
      evacuatePortraitPlaylistId?: string | null;
      weatherPortraitPlaylistId?: string | null;
      holdPortraitPlaylistId?: string | null;
      securePortraitPlaylistId?: string | null;
      medicalPortraitPlaylistId?: string | null;
      lockdownPortraitAssetUrl?: string | null;
      evacuatePortraitAssetUrl?: string | null;
      weatherPortraitAssetUrl?: string | null;
      holdPortraitAssetUrl?: string | null;
      securePortraitAssetUrl?: string | null;
      medicalPortraitAssetUrl?: string | null;
    },
  ) {
    const tenantId = req.user.tenantId;
    const screen = await this.prisma.client.screen.findFirst({ where: { id, tenantId } });
    if (!screen) throw new HttpException({ code: 'SCREEN_NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);

    // Validate every supplied playlist id belongs to the same tenant.
    // Cross-tenant assignment is silently dropped to null with an
    // audit log entry so we know about it.
    const ids: string[] = [
      body.lockdownPlaylistId, body.evacuatePlaylistId, body.weatherPlaylistId,
      body.holdPlaylistId, body.securePlaylistId, body.medicalPlaylistId,
      body.lockdownPortraitPlaylistId, body.evacuatePortraitPlaylistId, body.weatherPortraitPlaylistId,
      body.holdPortraitPlaylistId, body.securePortraitPlaylistId, body.medicalPortraitPlaylistId,
    ].filter((v): v is string => typeof v === 'string' && v.length > 0);
    let validIds = new Set<string>();
    if (ids.length > 0) {
      const playlists = await this.prisma.client.playlist.findMany({
        where: { id: { in: ids }, tenantId },
        select: { id: true },
      });
      validIds = new Set(playlists.map((p) => p.id));
    }
    const sanitize = (v: string | null | undefined): string | null | undefined => {
      if (v === undefined) return undefined;     // leave field untouched
      if (v === null || v === '') return null;   // clear override
      return validIds.has(v) ? v : null;         // unknown id → drop to null
    };
    // Asset URLs are validated lightly — must be a non-empty string
    // that looks like a URL. The asset itself was uploaded via
    // /assets/upload (which already enforces tenant scoping + MIME
    // allowlist), so we trust the URL it returned.
    const sanitizeUrl = (v: string | null | undefined): string | null | undefined => {
      if (v === undefined) return undefined;
      if (v === null || v === '') return null;
      const s = v.trim();
      if (!/^(https?:\/\/|\/)/.test(s)) return null;  // reject mailto:, data:, etc.
      return s.slice(0, 2048);
    };

    const data: any = {};
    if (body.lockdownPlaylistId !== undefined) data.emergencyLockdownPlaylistId = sanitize(body.lockdownPlaylistId);
    if (body.evacuatePlaylistId !== undefined) data.emergencyEvacuatePlaylistId = sanitize(body.evacuatePlaylistId);
    if (body.weatherPlaylistId  !== undefined) data.emergencyWeatherPlaylistId  = sanitize(body.weatherPlaylistId);
    if (body.holdPlaylistId     !== undefined) data.emergencyHoldPlaylistId     = sanitize(body.holdPlaylistId);
    if (body.securePlaylistId   !== undefined) data.emergencySecurePlaylistId   = sanitize(body.securePlaylistId);
    if (body.medicalPlaylistId  !== undefined) data.emergencyMedicalPlaylistId  = sanitize(body.medicalPlaylistId);
    if (body.lockdownAssetUrl   !== undefined) data.emergencyLockdownAssetUrl   = sanitizeUrl(body.lockdownAssetUrl);
    if (body.evacuateAssetUrl   !== undefined) data.emergencyEvacuateAssetUrl   = sanitizeUrl(body.evacuateAssetUrl);
    if (body.weatherAssetUrl    !== undefined) data.emergencyWeatherAssetUrl    = sanitizeUrl(body.weatherAssetUrl);
    if (body.holdAssetUrl       !== undefined) data.emergencyHoldAssetUrl       = sanitizeUrl(body.holdAssetUrl);
    if (body.secureAssetUrl     !== undefined) data.emergencySecureAssetUrl     = sanitizeUrl(body.secureAssetUrl);
    if (body.medicalAssetUrl    !== undefined) data.emergencyMedicalAssetUrl    = sanitizeUrl(body.medicalAssetUrl);
    // Portrait variants — same model, _portrait suffix on the column.
    if (body.lockdownPortraitPlaylistId !== undefined) data.emergencyLockdownPortraitPlaylistId = sanitize(body.lockdownPortraitPlaylistId);
    if (body.evacuatePortraitPlaylistId !== undefined) data.emergencyEvacuatePortraitPlaylistId = sanitize(body.evacuatePortraitPlaylistId);
    if (body.weatherPortraitPlaylistId  !== undefined) data.emergencyWeatherPortraitPlaylistId  = sanitize(body.weatherPortraitPlaylistId);
    if (body.holdPortraitPlaylistId     !== undefined) data.emergencyHoldPortraitPlaylistId     = sanitize(body.holdPortraitPlaylistId);
    if (body.securePortraitPlaylistId   !== undefined) data.emergencySecurePortraitPlaylistId   = sanitize(body.securePortraitPlaylistId);
    if (body.medicalPortraitPlaylistId  !== undefined) data.emergencyMedicalPortraitPlaylistId  = sanitize(body.medicalPortraitPlaylistId);
    if (body.lockdownPortraitAssetUrl   !== undefined) data.emergencyLockdownPortraitAssetUrl   = sanitizeUrl(body.lockdownPortraitAssetUrl);
    if (body.evacuatePortraitAssetUrl   !== undefined) data.emergencyEvacuatePortraitAssetUrl   = sanitizeUrl(body.evacuatePortraitAssetUrl);
    if (body.weatherPortraitAssetUrl    !== undefined) data.emergencyWeatherPortraitAssetUrl    = sanitizeUrl(body.weatherPortraitAssetUrl);
    if (body.holdPortraitAssetUrl       !== undefined) data.emergencyHoldPortraitAssetUrl       = sanitizeUrl(body.holdPortraitAssetUrl);
    if (body.securePortraitAssetUrl     !== undefined) data.emergencySecurePortraitAssetUrl     = sanitizeUrl(body.securePortraitAssetUrl);
    if (body.medicalPortraitAssetUrl    !== undefined) data.emergencyMedicalPortraitAssetUrl    = sanitizeUrl(body.medicalPortraitAssetUrl);

    const updated = await this.prisma.client.screen.update({
      // SEC-009: tenant predicate in the write. This row decides what a screen
      // shows during a lockdown, so the boundary belongs in the query and not
      // only in the `findFirst` gate at the top of the handler.
      where: { id, tenantId },
      data,
      select: {
        id: true,
        emergencyLockdownPlaylistId: true,
        emergencyEvacuatePlaylistId: true,
        emergencyWeatherPlaylistId: true,
        emergencyHoldPlaylistId: true,
        emergencySecurePlaylistId: true,
        emergencyMedicalPlaylistId: true,
        emergencyLockdownAssetUrl: true,
        emergencyEvacuateAssetUrl: true,
        emergencyWeatherAssetUrl: true,
        emergencyHoldAssetUrl: true,
        emergencySecureAssetUrl: true,
        emergencyMedicalAssetUrl: true,
        emergencyLockdownPortraitPlaylistId: true,
        emergencyEvacuatePortraitPlaylistId: true,
        emergencyWeatherPortraitPlaylistId: true,
        emergencyHoldPortraitPlaylistId: true,
        emergencySecurePortraitPlaylistId: true,
        emergencyMedicalPortraitPlaylistId: true,
        emergencyLockdownPortraitAssetUrl: true,
        emergencyEvacuatePortraitAssetUrl: true,
        emergencyWeatherPortraitAssetUrl: true,
        emergencyHoldPortraitAssetUrl: true,
        emergencySecurePortraitAssetUrl: true,
        emergencyMedicalPortraitAssetUrl: true,
      } as any,
    });

    // Audit log — operator changed which playlist plays on a specific
    // screen during a specific emergency type. Record what they set.
    try {
      await this.prisma.client.auditLog.create({
        data: {
          tenantId,
          userId: req.user.id,
          action: 'UPDATE_SCREEN_EMERGENCY_CONTENT',
          targetType: 'screen',
          targetId: id,
          details: JSON.stringify({ patch: data }),
        },
      });
    } catch { /* swallow */ }

    this.notifySync(tenantId);
    return updated;
  }

  // ─── ADMIN: Push an OTA update check to paired screens ───
  // When an admin clicks "Push APK update" in the dashboard we fire a
  // signed CHECK_FOR_UPDATES WebSocket message scoped to either one
  // screen or the whole tenant. The web player's WS handler relays to
  // the native APK shell via WebAppBridge.checkForUpdates → enqueues a
  // one-shot OtaUpdateWorker run on the kiosk. Requires APK ≥ 1.0.6
  // (the bridge method didn't exist before that build); older installs
  // silently ignore the event and pick up the update on their next
  // 6h periodic poll instead.
  @UseGuards(JwtAuthGuard, RbacGuard)
  @Post('force-update')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async forceUpdateAll(@Request() req: any) {
    const tenantId = req.user.tenantId;
    if (!tenantId) throw new HttpException({ code: 'SCREEN_NO_TENANT_CONTEXT', message: 'No tenant context' }, HttpStatus.BAD_REQUEST);
    // Mark every screen in the tenant as force-pending so the next
    // /update-check from each one gets the latest APK (gated 30 min).
    // Safe even when tenant.autoUpdatePlayerEnabled is false — the
    // force flag is the explicit opt-in for THIS push only.
    await this.prisma.client.screen.updateMany({
      where: { tenantId },
      data: {
        forceApkUpdatePendingAt: new Date(),
        // OTA-02: an operator deliberately re-pushing IS the "resolved,
        // try again" signal. It is one of only two things that clears the
        // sticky OTA failure stamp (the other is a confirmed install).
        lastOtaErrorAt: null,
        lastOtaErrorMessage: null,
        lastOtaErrorAuthenticated: false,
      } as any,
    }).catch((e) => {
      console.warn('[force-update] forceApkUpdatePendingAt write failed', (e as Error).message);
    });
    const signed = this.signer.signMessage('CHECK_FOR_UPDATES', {
      scope: 'tenant',
      scopeId: tenantId,
      requestedBy: req.user.userId || req.user.id || null,
    });
    try {
      await this.redisService.publish(`tenant:${tenantId}`, signed);
    } catch (e) {
      console.warn('[force-update] redis publish failed', (e as Error).message);
    }
    await this.prisma.client.auditLog.create({
      data: {
        action: 'FORCE_APK_UPDATE',
        targetType: 'tenant',
        targetId: tenantId,
        tenantId,
        userId: req.user.id,
        details: JSON.stringify({ scope: 'tenant' }),
      },
    }).catch(() => { /* audit best-effort */ });
    return { ok: true, scope: 'tenant' };
  }

  @UseGuards(JwtAuthGuard, RbacGuard)
  @Post(':id/force-update')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async forceUpdateOne(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body?: { overrideWindow?: boolean },
  ) {
    const screen = await this.prisma.client.screen.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!screen) throw new HttpException({ code: 'SCREEN_NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);
    const overrideWindow = !!body?.overrideWindow;

    // 2026-04-29 — Correlation ID for end-to-end OTA tracing.
    // Operator: "how did everyone miss these issues on the last 4
    // builds". Answer: every layer logged in its own silo with no
    // shared identifier, so we couldn't trace a push from dashboard
    // → server → WS → kiosk → worker → server → install. This corrId
    // gets stamped into every log line in the chain. Grep one
    // value, see the entire push lifetime.
    const corrId = `ota-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const fpShort = (screen.deviceFingerprint || '').slice(0, 18);
    console.log(
      `[OTA ${corrId}] force-update REQUEST screenId=${id} fp=${fpShort}… ` +
      `screenName="${screen.name}" tenantId=${screen.tenantId} ` +
      `requestedBy=${req.user.userId || req.user.id}`,
    );

    // Set the per-screen force flag — the next update-check from
    // this kiosk returns the latest APK (gated 30 min).
    // Sprint 11 Phase A: overrideWindow=true bypasses the tenant's
    // maintenance window for this one-shot push (emergency hotfix).
    await this.prisma.client.screen.update({
      // SEC-009: tenant predicate in the write, matching the read above.
      where: { id, tenantId: req.user.tenantId },
      data: {
        forceApkUpdatePendingAt: new Date(),
        forceApkUpdateOverrideWindow: overrideWindow,
        // OTA-02: re-arming a push clears the sticky failure stamp.
        lastOtaErrorAt: null,
        lastOtaErrorMessage: null,
        lastOtaErrorAuthenticated: false,
      } as any,
    }).catch((e) => {
      console.warn(`[OTA ${corrId}] forceApkUpdatePendingAt write FAILED: ${(e as Error).message}`);
    });
    console.log(`[OTA ${corrId}] forceApkUpdatePendingAt SET (overrideWindow=${overrideWindow})`);

    const signed = this.signer.signMessage('CHECK_FOR_UPDATES', {
      scope: 'screen',
      scopeId: id,
      tenantId: screen.tenantId,
      requestedBy: req.user.userId || req.user.id || null,
      // Embed corrId in the WS payload so the kiosk can stamp it
      // into ITS logs + later /ota-state POSTs. Closes the loop.
      corrId,
    });
    // Publish on the tenant channel — all kiosks receive, but only the
    // targeted screen acts on it (the payload includes scopeId).
    try {
      await this.redisService.publish(`tenant:${screen.tenantId}`, signed);
      console.log(`[OTA ${corrId}] WS broadcast PUBLISHED on tenant:${screen.tenantId}`);
    } catch (e) {
      console.warn(`[OTA ${corrId}] redis publish FAILED: ${(e as Error).message}`);
    }

    await this.prisma.client.auditLog.create({
      data: {
        action: 'FORCE_APK_UPDATE',
        targetType: 'screen',
        targetId: id,
        tenantId: screen.tenantId!,
        userId: req.user.id,
        details: JSON.stringify({ scope: 'screen', screenName: screen.name, corrId }),
      },
    }).catch(() => { /* audit best-effort */ });
    return { ok: true, scope: 'screen', screenId: id, corrId };
  }

  // ─── ADMIN: Force web-bundle reload (Sprint 11 Phase B) ───
  // The kiosk's WebView keeps running whatever JS bundle it loaded at boot.
  // When we ship a fix to apps/web and Vercel deploys it, running kiosks
  // stay on the OLD bundle forever — there's no mechanism to push new JS to
  // an already-loaded page. Operators previously had to walk up to each
  // kiosk, tap the in-player "Sync Now" splash button (which force-reloads
  // the WebView), or wait for a power-cycle.
  //
  // These endpoints publish a signed REFRESH_WEB message on the tenant
  // channel. The web player's WS handler picks it up, optionally jitters
  // a few seconds, then calls EduCmsNative.reload() (Android shell) or
  // window.location.reload() (browser fallback). Result: fleet-wide
  // bundle refresh from one dashboard click.
  //
  // Per-screen variant for surgical reloads during pilots.
  // Tenant variant for fleet refreshes after a hotfix deploy.
  //
  // Jitter window of 8s spreads N kiosks across that window so a 1000-
  // device fleet doesn't all hit Vercel + the API simultaneously and
  // re-trigger the DATABASE_ERROR storm we just fixed.
  /** Thin delegate — the shared implementation lives in deployment-record.ts
   *  so the playlist publish flow can mint the same tracked deployments
   *  without a controller-constructor change across 19 spec files. */
  private recordPushDeployment(opts: RecordPushDeploymentOpts): Promise<void> {
    return recordPushDeployment(this.prisma, opts, {
      targetIdCap: ScreensController.DEPLOYMENT_TARGET_ID_CAP,
      eventFanoutCap: ScreensController.DEPLOYMENT_EVENT_FANOUT_CAP,
    });
  }

  @UseGuards(JwtAuthGuard, RbacGuard)
  @Post('refresh-web')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async refreshWebAll(@Request() req: any) {
    const tenantId = req.user.tenantId;
    if (!tenantId) throw new HttpException({ code: 'SCREEN_NO_TENANT_CONTEXT', message: 'No tenant context' }, HttpStatus.BAD_REQUEST);
    const corrId = `rw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    // FLEET SCOPE (2026-08-31): the dashboard's "Push content" says
    // "Confirm · all N screens" and counts the whole fleet — but this
    // endpoint only ever pushed the CALLER's own tenant, silently skipping
    // every child location. Now it covers the same self + direct
    // non-archived children set every fleet read uses. A leaf tenant
    // resolves to just itself — unchanged behavior.
    const tenantIds = await this.readableTenantIds(tenantId);
    // ONE instant for the whole fan-out: the value every target is stamped
    // with, the value the Deployment row records, and the value each player
    // echoes back to ack. Identity, not a clock comparison.
    const value = new Date();
    for (const tid of tenantIds) {
      const signed = this.signer.signMessage('REFRESH_WEB', {
        scope: 'tenant',
        scopeId: tid,
        requestedBy: req.user.userId || req.user.id || null,
        jitterMs: 8000,
        corrId,
      });
      try {
        await this.redisService.publish(`tenant:${tid}`, signed);
      } catch (e) {
        console.warn(`[refresh-web ${corrId}] redis publish failed for ${tid}:`, (e as Error).message);
      }
    }
    // ── DUAL-PATH DELIVERY (2026-08-31, Fleet Command Phase 2) ──────────
    // Until now the operator's push rode Redis ONLY, so a screen whose WS/SSE
    // channel was dead simply never got it — the same hole the wedge cron
    // closed for its OWN pushes on 2026-08-30 (AUTO_RECOVERY_PUSH_DEAD).
    // This extends that proven durable ride to operator pushes: the flag
    // lands in the screen's manifest as `refreshRequestedAt` and the screen
    // picks it up on its next poll (CLAUDE.md player rule 6).
    //
    // Rule 12 applies — this DOES change what operators observe (a push now
    // reaches a push-dead screen), so it ships named and tested, never
    // silently. Everything below is best-effort: the push has already left
    // on the Redis path, and a bookkeeping failure must not fail the click.
    await this.recordPushDeployment({
      tenantId,
      targetTenantIds: tenantIds,
      createdById: req.user.id ?? null,
      value,
      corrId,
      scope: 'tenant',
    });
    await this.prisma.client.auditLog.create({
      data: {
        action: 'REFRESH_WEB',
        targetType: 'tenant',
        targetId: tenantId,
        tenantId,
        userId: req.user.id,
        details: JSON.stringify({ scope: 'tenant', corrId, targetTenants: tenantIds.length }),
      },
    }).catch(() => { /* audit best-effort */ });
    return { ok: true, scope: 'tenant', corrId };
  }

  @UseGuards(JwtAuthGuard, RbacGuard)
  @Post(':id/refresh-web')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async refreshWebOne(@Request() req: any, @Param('id') id: string) {
    // Fleet scope (2026-08-31): HQ may push one screen at a child location
    // — same readableTenantIds set as every fleet read. This also un-breaks
    // the proof drawer's per-screen "Push again" from HQ, which 404'd here.
    const screen = await this.prisma.client.screen.findFirst({
      where: { id, tenantId: { in: await this.readableTenantIds(req.user.tenantId) } },
    });
    if (!screen) throw new HttpException({ code: 'SCREEN_NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);
    const corrId = `rw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const value = new Date();
    const signed = this.signer.signMessage('REFRESH_WEB', {
      scope: 'screen',
      scopeId: id,
      tenantId: screen.tenantId,
      requestedBy: req.user.userId || req.user.id || null,
      // Single-screen refreshes don't need jitter — they're already
      // a fleet-of-one. Snappy reload feedback for the operator.
      jitterMs: 0,
      corrId,
    });
    try {
      await this.redisService.publish(`tenant:${screen.tenantId}`, signed);
    } catch (e) {
      console.warn(`[refresh-web ${corrId}] redis publish failed:`, (e as Error).message);
    }
    // Same durable ride as the tenant-wide push above — see the long note
    // there. Best-effort; a bookkeeping failure never fails the click.
    await this.recordPushDeployment({
      tenantId: screen.tenantId!,
      targetTenantIds: [screen.tenantId!],
      createdById: req.user.id ?? null,
      value,
      corrId,
      scope: 'screen',
      screenIds: [id],
      label: `Push update · ${screen.name}`,
    });
    await this.prisma.client.auditLog.create({
      data: {
        action: 'REFRESH_WEB',
        targetType: 'screen',
        targetId: id,
        tenantId: screen.tenantId!,
        userId: req.user.id,
        details: JSON.stringify({ scope: 'screen', screenName: screen.name, corrId }),
      },
    }).catch(() => { /* audit best-effort */ });
    return { ok: true, scope: 'screen', screenId: id, corrId };
  }

  /**
   * ─── ADMIN: Revoke a screen's device credential ─────────────────────
   *
   * 2026-08-03 (DT-01). Until this endpoint existed there was NO
   * proportionate response to a compromised screen. `Screen.status =
   * 'REVOKED'` was read in eight places and written in exactly zero;
   * `jwt_revoked_list` had no device writer and carried a 30-day TTL on a
   * credential that lived a year. The only working kill switch was
   * DELETING the screen — which also destroyed its schedules and its
   * telemetry history. An operator whose kiosk went missing had to choose
   * between losing the configuration and leaving a live credential in a
   * dumpster.
   *
   * This flips `status` to REVOKED (the state the manifest endpoint has
   * always checked) AND bumps `credentialEpoch`, which retires every token
   * ever minted for the screen — including ones nobody is holding, which a
   * token-string denylist could never reach. The screen row, its
   * schedules, its group membership and its history all survive; re-pairing
   * with a fresh pairing code brings it back.
   */
  @UseGuards(JwtAuthGuard, RbacGuard)
  @Post(':id/revoke-credential')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async revokeCredential(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { reason?: string } = {},
  ) {
    const isSuper = req.user?.role === AppRole.SUPER_ADMIN;
    const screen = await this.prisma.client.screen.findFirst({
      where: isSuper ? { id } : { id, tenantId: req.user.tenantId },
      select: { id: true, name: true, tenantId: true, credentialEpoch: true } as any,
    });
    if (!screen) throw new HttpException({ code: 'SCREEN_NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);

    const { credentialEpoch } = await revokeScreenCredentials(
      { prisma: this.prisma, redis: this.redisService },
      {
        screenId: id,
        reason: 'admin_revoke',
        markRevokedStatus: true,
        tenantId: (screen as any).tenantId,
        userId: req.user?.id ?? null,
        details: {
          screenName: (screen as any).name,
          operatorReason: typeof body?.reason === 'string' ? body.reason.slice(0, 200) : null,
        },
      },
    );

    if ((screen as any).tenantId) this.notifySync((screen as any).tenantId);
    return { revoked: true, screenId: id, credentialEpoch };
  }

  /**
   * ─── ADMIN: Restore a REPAIR_REQUIRED screen's credential trust ──────
   *
   * 2026-09-01. The heal path designed in deep-audit B-P1-7 shipped
   * server-side (see `verifyPriorToken`'s `unproven-restorable` branch in
   * POST /register) but only the PAIR endpoint could ever ARM it — and
   * pairing needs a pairing code, which a REPAIR_REQUIRED screen never
   * shows because it is still happily playing content on renewed 1-hour
   * unproven tokens. So the fleet chip and the on-glass banner both said
   * "re-pair from the dashboard" and the dashboard had no control that
   * did it. Five production screens sat in that state. This is that
   * control: the SAME two writes the re-pair makes to arm the heal, and
   * nothing else.
   *
   * SECURITY EQUIVALENCE, stated for review (B-P1-7):
   *   • The AUTHORIZER is the operator's authenticated, tenant-scoped,
   *     admin-roled dashboard action — exactly as it is for POST /pair.
   *     This route mints nothing and hands nothing back to a device.
   *   • The DEVICE still has to prove itself the same way: on its next
   *     register it must present the token minted BEFORE this rotation
   *     (epoch current-1) inside `CREDENTIAL_EPOCH_GRACE_MS`. A token
   *     minted at the CURRENT epoch — e.g. by an anonymous register that
   *     races in after this call — is still refused, so this grants
   *     nothing an attacker could farm after the operator acts.
   *   • DEVAUTH-01 is untouched: fingerprint knowledge still never
   *     upgrades a credential. `verifyPriorToken` and every register path
   *     are unchanged by this endpoint — zero edits there.
   *   • It is NOT a revoke escape hatch: a REVOKED screen is refused
   *     (409) and `credentialRevokedAt` is never written here. Revocation
   *     stays an operator decision undone only by a full re-pair.
   */
  @UseGuards(JwtAuthGuard, RbacGuard)
  @Post(':id/restore-trust')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async restoreTrust(@Request() req: any, @Param('id') id: string) {
    const callerTenantId = req.user?.tenantId as string | undefined;
    // Fail CLOSED on a tenantless principal. `readableTenantIds(undefined)`
    // would hand Prisma `parentId: undefined`, which DROPS the filter and
    // returns every tenant — a silent cross-tenant scope. Same guard the
    // deployments read carries.
    if (!callerTenantId) {
      throw new HttpException(
        { code: 'SCREEN_NO_TENANT_CONTEXT', message: 'No tenant context' },
        HttpStatus.BAD_REQUEST,
      );
    }
    // Same readable set as every other per-screen operator recovery action
    // (refreshWebOne): HQ may heal a screen at a child location, a leaf
    // admin's set is just [self]. Out-of-scope ids 404 rather than 403 —
    // scope-hiding, like the siblings.
    const screen = await this.prisma.client.screen.findFirst({
      where: { id, tenantId: { in: await this.readableTenantIds(callerTenantId) } },
      select: { id: true, name: true, tenantId: true, status: true, authState: true } as any,
    });
    if (!screen) throw new HttpException({ code: 'SCREEN_NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);

    if ((screen as any).status === 'REVOKED') {
      throw new HttpException(
        {
          code: 'SCREEN_CREDENTIAL_REVOKED',
          message: 'This screen’s credential was revoked. Re-pair it with a fresh pairing code — restoring trust cannot undo a revoke.',
        },
        HttpStatus.CONFLICT,
      );
    }

    const priorAuthState = ((screen as any).authState ?? null) as string | null;
    // Already trusted → do nothing. Rotating the epoch on a healthy
    // credential would retire the token the device is holding RIGHT NOW and
    // push it through a renewal it did not need — the opposite of the goal.
    if (priorAuthState === 'PROVEN') {
      return {
        success: true,
        alreadyProven: true,
        screenId: id,
        message: 'This screen’s credential is already fully trusted — nothing to restore.',
      };
    }

    // The re-pair's credential fields, and ONLY those: no tenant move, no
    // pairing-code mint, no revoke clear. Rotating the epoch is what puts
    // the device's currently-held token at current-1 so the next register
    // lands on the `unproven-restorable` branch and renews to a proven
    // 180-day token.
    await this.prisma.client.screen.update({
      where: { id, tenantId: (screen as any).tenantId },
      data: {
        credentialEpoch: { increment: 1 },
        credentialEpochRotatedAt: new Date(),
        authState: 'PROVEN',
        authStateChangedAt: new Date(),
      } as any,
    });
    // Drop this replica's cached credential snapshot so it stops honouring
    // the pre-rotation epoch at the end of the 5s TTL instead of now.
    invalidateDeviceCredentialCache((screen as any).id);

    await this.prisma.client.auditLog.create({
      data: {
        action: 'SCREEN_TRUST_RESTORED',
        targetType: 'screen',
        targetId: id,
        tenantId: (screen as any).tenantId!,
        userId: req.user.id,
        details: JSON.stringify({ screenName: (screen as any).name, priorAuthState }),
      },
    }).catch(() => { /* audit best-effort — mirrors refreshWebOne */ });

    if ((screen as any).tenantId) this.notifySync((screen as any).tenantId);

    return {
      success: true,
      screenId: id,
      message:
        'Trust restored — the screen re-proves its credential on its next check-in (within ~10 minutes).',
    };
  }

  // ─── ADMIN: Delete a screen ───
  @UseGuards(JwtAuthGuard, RbacGuard)
  // ═══ Double-sided displays (2026-09-16) ════════════════════════════════
  //
  // Greg installed the first double-sided unit: "i need to be able to show
  // individual content on each side, sometimes the same but at times
  // different so i need that option."
  //
  // One face = one Screen row. These three routes are the whole server-side
  // surface: read a display's sides, add a side, and switch a side between
  // "same as the front" (MIRROR) and "its own content" (OWN). Everything
  // else — scheduling, publishing, fleet health, emergency delivery — works
  // because a face is an ordinary Screen and needs no new code at all.

  /** Resolve the PRIMARY of the unit `id` belongs to, tenant-scoped. */
  private async loadDisplayUnit(req: any, id: string) {
    const screen = await this.prisma.client.screen.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!screen) {
      throw new HttpException({ code: 'SCREEN_NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);
    }
    // Addressing a FACE addresses its display: the physical thing in the room
    // is the display, not the pane, so every one of these routes accepts
    // either id and answers about the same unit.
    const primaryId = (screen as any).faceOfScreenId || screen.id;
    const primary =
      primaryId === screen.id
        ? screen
        : await this.prisma.client.screen.findFirst({
            where: { id: primaryId, tenantId: req.user.tenantId },
          });
    if (!primary) {
      // A face whose primary is gone or lives in another tenant is not a
      // unit — treat the face as its own display rather than crossing a
      // tenant boundary to complete it.
      return { primary: screen, faces: [] as any[] };
    }
    const faces = await this.prisma.client.screen.findMany({
      where: { faceOfScreenId: primary.id, tenantId: req.user.tenantId },
      orderBy: { faceIndex: 'asc' },
    });
    return { primary, faces };
  }

  /**
   * GET /api/v1/screens/:id/faces
   *
   * What the dashboard needs to draw the sides control, including whether
   * this hardware can even HAVE a second side. `hardwareReportsSecondDisplay`
   * comes from the device's own probe inventory (the only place a list of
   * displays exists) and is FALSE for anything that has never reported —
   * "we do not know" must never render as "this display has two sides".
   */
  @Get(':id/faces')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async listFaces(@Request() req: any, @Param('id') id: string) {
    const { primary, faces } = await this.loadDisplayUnit(req, id);

    let hardwareReportsSecondDisplay = false;
    try {
      const inv = await (this.prisma.client as any).screenDeviceInventory.findUnique({
        where: { screenId: primary.id },
      });
      hardwareReportsSecondDisplay = reportsSecondDisplay(inv?.report);
    } catch {
      // Inventory is an optional diagnostic; a read failure must not break
      // the sides panel. It simply means we cannot claim a second display.
    }

    const sides = [
      {
        screenId: primary.id,
        name: primary.name,
        status: primary.status,
        faceIndex: 0,
        label: faceLabel(0),
        isPrimary: true,
        contentMode: 'OWN' as const,
      },
      ...faces.map((f: any) => ({
        screenId: f.id,
        name: f.name,
        status: f.status,
        faceIndex: f.faceIndex ?? 1,
        label: faceLabel(f.faceIndex),
        isPrimary: false,
        contentMode: faceContentMode(f),
      })),
    ];

    return {
      unitScreenId: primary.id,
      sides,
      hardwareReportsSecondDisplay,
      // Offer "add a side" only when the hardware says it has one AND there
      // is room. An operator can still be blocked by neither and simply see
      // a one-sided display, which is the truth for most of the fleet.
      canAddFace: hardwareReportsSecondDisplay && sides.length < MAX_FACES_PER_UNIT,
      maxSides: MAX_FACES_PER_UNIT,
    };
  }

  /**
   * POST /api/v1/screens/:id/faces
   *
   * Add a side to a display. The new row is a full Screen: its own name, its
   * own credential (minted the ordinary way when its player registers), its
   * own orientation and canvas, its own proof of play — and, because it is a
   * Screen in this tenant, its own emergency reach with no extra wiring.
   *
   * It starts in MIRROR mode deliberately: a side that has never been
   * assigned content must show the front's content, not black.
   *
   * ⚠️ It starts PENDING, not ONLINE. A row the server invented has not
   * proved anything yet; it flips ONLINE when a player actually registers
   * against it. Inventing an ONLINE screen would be exactly the "looks
   * healthy, shows nothing" lie the player-reliability program exists to kill.
   */
  @Post(':id/faces')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async addFace(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { name?: string; contentMode?: string },
  ) {
    const { primary, faces } = await this.loadDisplayUnit(req, id);

    if (isFaceScreen(primary as any)) {
      throw new HttpException(
        { code: 'SCREEN_FACE_NESTED', message: 'A side cannot itself have sides' },
        HttpStatus.BAD_REQUEST,
      );
    }
    if (faces.length + 1 >= MAX_FACES_PER_UNIT) {
      throw new HttpException(
        { code: 'SCREEN_FACE_LIMIT', message: `A display may have at most ${MAX_FACES_PER_UNIT} sides` },
        HttpStatus.BAD_REQUEST,
      );
    }
    if (body.contentMode !== undefined && !isValidFaceContentMode(body.contentMode)) {
      throw new HttpException(
        { code: 'SCREEN_FACE_MODE_INVALID', message: "contentMode must be 'MIRROR' or 'OWN'" },
        HttpStatus.BAD_REQUEST,
      );
    }

    const index = nextFaceIndex(faces.map((f: any) => f.faceIndex));
    const mode = body.contentMode
      ? normalizeFaceContentMode(body.contentMode)
      : DEFAULT_FACE_CONTENT_MODE;
    const name = String(body.name ?? '').trim() || defaultFaceName(primary.name, index);

    const created = await this.prisma.client.$transaction(async (tx) => {
      const row = await tx.screen.create({
        data: {
          tenantId: primary.tenantId,
          // Same group as the front, so a group-scoped publish — and a
          // group-scoped LOCKDOWN — reaches both sides from the first second
          // this row exists.
          screenGroupId: primary.screenGroupId,
          name,
          deviceFingerprint: faceDeviceFingerprint(primary.deviceFingerprint, index),
          status: 'PENDING',
          // The panel cannot report how it is mounted (the 2026-08-24
          // orientation limit), and this side is a different physical
          // surface from the front — so AUTO, and the operator sets it.
          orientation: 'AUTO',
          faceOfScreenId: primary.id,
          faceIndex: index,
          faceContentMode: mode,
        } as any,
      });
      await tx.auditLog.create({
        data: {
          tenantId: req.user.tenantId,
          userId: req.user?.id ?? null,
          action: 'SCREEN_FACE_ADDED',
          targetType: 'Screen',
          targetId: row.id,
          details: JSON.stringify({
            unitScreenId: primary.id,
            faceIndex: index,
            contentMode: mode,
            name,
          }),
        },
      });
      return row;
    });

    // Two panes of glass are two screens. Keep the seat count honest rather
    // than quietly shipping a free one (same call the delete path makes when
    // a seat is freed).
    this.stripe.syncSubscriptionQuantity(req.user.tenantId).catch(() => {});
    this.notifySync(req.user.tenantId);

    return {
      ...created,
      label: faceLabel(index),
      contentMode: mode,
    };
  }

  /**
   * PUT /api/v1/screens/:id/face-content
   *
   * The whole "same or different" choice, in one call: MIRROR (this side
   * shows the front's content) or OWN (this side has its own schedules).
   *
   * :id is the SIDE, not the display — the caller has both ids and this way
   * a three-sided unit needs no extra addressing scheme.
   *
   * There is no cache to invalidate by hand: `Screen` is in
   * MANIFEST_FED_MODELS and `faceContentMode` is deliberately NOT in
   * SCREEN_TELEMETRY_ONLY_FIELDS, so the Prisma mutation hook busts the
   * manifest hot cache and the change lands on the side's very next poll.
   */
  @Put(':id/face-content')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async setFaceContentMode(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { mode?: string; reason?: string },
  ) {
    if (!isValidFaceContentMode(body?.mode)) {
      throw new HttpException(
        { code: 'SCREEN_FACE_MODE_INVALID', message: "mode must be 'MIRROR' or 'OWN'" },
        HttpStatus.BAD_REQUEST,
      );
    }
    const mode = normalizeFaceContentMode(body.mode);

    const face = await this.prisma.client.screen.findFirst({
      where: { id, tenantId: req.user.tenantId },
      select: { id: true, name: true, faceOfScreenId: true, faceContentMode: true },
    });
    if (!face) {
      throw new HttpException({ code: 'SCREEN_NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);
    }
    if (!isFaceScreen(face as any)) {
      // The FRONT has no content mode — it is what a mirroring side mirrors.
      // Answering 400 here (rather than silently no-op'ing) is what stops a
      // UI from believing it switched something it did not.
      throw new HttpException(
        {
          code: 'SCREEN_NOT_A_FACE',
          message: 'This screen is a display, not one of its sides. Set the mode on the side.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const previous = faceContentMode(face as any);
    const updated = await this.prisma.client.$transaction(async (tx) => {
      const u = await tx.screen.update({
        // SEC-009: tenant predicate in the write, matching the read above.
        where: { id, tenantId: req.user.tenantId },
        data: { faceContentMode: mode } as any,
      });
      await tx.auditLog.create({
        data: {
          tenantId: req.user.tenantId,
          userId: req.user?.id ?? null,
          action: 'SCREEN_FACE_CONTENT_MODE_CHANGED',
          targetType: 'Screen',
          targetId: id,
          details: JSON.stringify({
            unitScreenId: (face as any).faceOfScreenId,
            from: previous,
            to: mode,
            reason: body.reason ?? null,
          }),
        },
      });
      return u;
    });

    return { ...updated, contentMode: mode };
  }

  @Delete(':id')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async remove(@Request() req: any, @Param('id') id: string) {
    const screen = await this.prisma.client.screen.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!screen) throw new HttpException({ code: 'SCREEN_NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);

    // Double-sided displays (2026-09-16): the face rows cascade with the
    // primary (`onDelete: Cascade` on the self-relation), but their
    // SCHEDULES do not — `Schedule.screen` has no cascade, which is why the
    // line below exists for the primary in the first place. Deleting the
    // primary's schedules while leaving a face's behind would strand rows
    // pointing at a screen that no longer exists.
    const faceIds = (
      await this.prisma.client.screen.findMany({
        where: { faceOfScreenId: id, tenantId: req.user.tenantId },
        select: { id: true },
      })
    ).map((f) => f.id);
    await this.prisma.client.schedule.deleteMany({
      where: { screenId: { in: [id, ...faceIds] } },
    });
    await this.prisma.client.screen.delete({ where: { id, tenantId: req.user.tenantId } });
    // Each face held its own device credential; drop the cached snapshots so
    // this replica stops honouring them inside the 5 s TTL (same reasoning as
    // the primary's invalidation below).
    for (const faceId of faceIds) invalidateDeviceCredentialCache(faceId);
    // 2026-08-03 (DT-01): deleting the row IS a complete credential kill —
    // every device-authenticated path now re-reads the live Screen row and
    // refuses when it is gone (`screen_not_found`). Drop the cached
    // credential snapshot so this replica stops honouring the token inside
    // the 5 s TTL rather than at the end of it.
    invalidateDeviceCredentialCache(id);
    this.notifySync(req.user.tenantId);
    // Deleting a paired screen frees a seat — re-sync Stripe quantity.
    this.stripe.syncSubscriptionQuantity(req.user.tenantId).catch(() => {});
    return { deleted: true };
  }

  // ─── VenueOS Sports — synthetic scoreboard manifest ───
  // Builds a normal-shaped manifest playlist array with ONE full-screen
  // WEBPAGE zone pointing at the live scoreboard page (direct mode, so
  // the player iframes it un-proxied). The player renders this through
  // the existing template pipeline — zero player-code change.
  private buildScoreboardManifest(screen: any, game: any, surface?: string): any[] {
    // Match the synthetic template to the panel's resolution so the
    // WEBPAGE zone gets a correctly-shaped box; the surface page scales
    // its own scene to fit either way. Default to 1080p landscape.
    let w = 1920;
    let h = 1080;
    // Prefer the operator's explicit LED canvas dims (canvasW/canvasH) over the
    // device resolution. A narrow LED poster (e.g. 960×1080) reports its DEVICE
    // resolution as 1920×1080 but only physically shows the top-left
    // canvasW×canvasH region the LED controller maps; sizing the synthetic
    // scoreboard template to the canvas (not the resolution) is what makes the
    // /board surface FIT the panel instead of rendering 1920-wide and getting
    // cut off. Falls back to the parsed resolution, then 1080p. (2026-06-24 —
    // live water-polo install: scoreboard cut off on a 960×1080 LED poster.)
    const cwN = Number((screen as any).canvasW);
    const chN = Number((screen as any).canvasH);
    if (cwN > 0 && chN > 0) {
      w = Math.floor(cwN);
      h = Math.floor(chN);
    } else {
      const m = String(screen.resolution || '').trim().match(/^(\d+)\s*[x×]\s*(\d+)$/i);
      if (m) {
        w = parseInt(m[1], 10);
        h = parseInt(m[2], 10);
      }
    }
    // Which sports surface this screen renders. The operator picks it
    // per-screen (BOARD full scoreboard / RIBBON LED strip / SCOREBUG
    // broadcast overlay); each is a public route the WEBPAGE zone loads
    // directly. Null / unknown reads as BOARD (back-compat).
    const s = String(surface || 'BOARD').toUpperCase();
    const route = s === 'RIBBON' ? 'ribbon' : s === 'SCOREBUG' ? 'scorebug' : 'board';
    const surfaceName =
      s === 'RIBBON' ? 'Live Ribbon' : s === 'SCOREBUG' ? 'Live Scorebug' : 'Live Scoreboard';
    return [{
      id: `${route}-${game.id}`,
      name: surfaceName,
      schedule: { daysOfWeek: null, timeStart: null, timeEnd: null, mutedOverride: null },
      totalBytes: 0,
      template: {
        // Stable per game + surface so the player's template signature
        // doesn't churn; changes when a different game OR surface is
        // pushed (so a board→ribbon switch forces a clean reload).
        id: `${route}-tpl-${game.id}`,
        name: surfaceName,
        screenWidth: w,
        screenHeight: h,
        bgColor: '#000000',
        bgGradient: null,
        bgImage: null,
        isTouchEnabled: false,
        idleResetMs: undefined,
        zones: [{
          id: `${route}-zone-${game.id}`,
          name: surfaceName,
          widgetType: 'WEBPAGE',
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          zIndex: 0,
          sortOrder: 0,
          touchAction: null,
          sceneId: null,
          defaultConfig: { url: `/${route}/${game.id}`, direct: true },
        }],
        scenes: [],
      },
      items: [],
    }];
  }

  /**
   * The exact Tenant columns the manifest's emergency branch reads. Shared
   * between the screen's own tenant lookup and the ancestor walk so both
   * populate the SAME shape into the 2s `getTenantState` cache — a cache
   * entry written by one path and read by the other must never be missing a
   * field the reader depends on.
   *
   * `parentId` is what makes district inheritance possible; `id` is carried
   * so a resolved ancestor can be named in the manifest for diagnostics.
   */
  private static readonly MANIFEST_TENANT_EMERGENCY_SELECT = {
    id: true,
    parentId: true,
    // `archivedAt` keeps inheritance consistent with the fan-out, which
    // excludes archived (soft-deleted) locations. Without it a district
    // lockdown would light up every archived test tenant's leftover screens
    // — 120 of them exist in production — while the audit trail and the
    // pub/sub fan-out say those tenants were never involved.
    archivedAt: true,
    emergencyStatus: true,
    emergencyType: true,
    emergencyPlaylistId: true,
    emergencyPortraitPlaylistId: true,
    locationBasedEmergencyEnabled: true,
  } as const;

  /**
   * DISTRICT-WIDE EMERGENCY INHERITANCE — the manifest-side safety net
   * (2026-08-03).
   *
   * The authoritative mechanism for a district lockdown is the FAN-OUT in
   * `emergency.controller.ts`: a district trigger writes every descendant
   * tenant's own row, so a screen booting mid-lockdown reads its own tenant
   * and sees the alert with zero extra work. This walk exists for the cases
   * the fan-out provably cannot cover:
   *
   *   - a school tenant CREATED after the district trigger fired;
   *   - a school row reset out-of-band (Studio edit, seed script, a partial
   *     restore) while the district is still in emergency;
   *   - a SCHOOL_ADMIN clearing their own school during a DISTRICT-wide
   *     lockdown. That must NOT drop the district alert — one building's
   *     admin does not get to cancel a district-wide incident — and this
   *     walk is what re-asserts it on the very next poll.
   *
   * COST: only runs when the screen's own tenant is INACTIVE **and** has a
   * parent, and every hop goes through the same 2s `getTenantState` cache
   * that the screen's own tenant read uses. A 38-screen / 7-school district
   * polling every 5s adds at most one cached district read per 2s — far
   * below the fan-out savings, and nowhere near the manifest content
   * fan-out that caused the July-2026 Supabase overage.
   *
   * Depth-bounded and cycle-guarded: `Tenant.parentId` is an unconstrained
   * self-FK, and the life-safety path must never be what discovers a cycle.
   *
   * Returns the nearest ancestor tenant row that is in an active emergency,
   * or null.
   */
  private async resolveAncestorEmergencyState(parentId: string | null | undefined): Promise<any | null> {
    let cursor: string | null = parentId ?? null;
    const seen = new Set<string>();

    for (let hop = 0; hop < MAX_TENANT_TREE_DEPTH && cursor; hop++) {
      if (seen.has(cursor)) break; // cycle guard
      seen.add(cursor);

      let ancestor = getTenantState(cursor) as any;
      if (!ancestor) {
        ancestor = (await this.prisma.client.tenant.findUnique({
          where: { id: cursor },
          select: ScreensController.MANIFEST_TENANT_EMERGENCY_SELECT as any,
        })) as any;
        if (ancestor) setTenantState(cursor, ancestor);
      }
      if (!ancestor) return null;
      // Stop at an archived ancestor for the same reason the fan-out skips
      // archived tenants: a retired location is not part of the live
      // hierarchy, and inheriting THROUGH one would contradict the audit
      // trail, which records no involvement for it.
      if (ancestor.archivedAt) return null;

      if (ancestor.emergencyStatus && ancestor.emergencyStatus !== 'INACTIVE') {
        return ancestor;
      }
      cursor = ancestor.parentId ?? null;
    }

    return null;
  }

  // ─── Cheap emergency revision (the HTTP backstop's change detector) ───
  //
  // WHAT IT REPLACES (efficiency audit 2026-09-02, P0-2/P0-3). The web player
  // used to satisfy its HTTP emergency backstop by fetching the FULL manifest
  // every 10 s (5 s while an alert was up or the push channel was degraded) —
  // measured at 45.5 % of all production API traffic and, at 1 000 screens,
  // ~8 640 manifest builds per screen per day to learn that nothing had
  // changed. It now polls THIS endpoint on the same cadence and fetches the
  // manifest only when the revision moves.
  //
  // WHAT IT IS NOT. Not a delivery path, and it carries no alert content: the
  // two independent emergency paths are unchanged (signed WS/SSE push, and
  // the manifest — still the sole arbiter of lockdown). This only decides
  // WHEN the second one is worth asking. A player that cannot reach it, or
  // gets any answer it does not understand, falls straight back to the old
  // behaviour: full manifest fetch at the current cadence. So a broken or
  // absent revision endpoint can slow nothing down and hide nothing.
  //
  // COST CONTRACT. On the unchanged path this must perform ZERO Postgres
  // queries. That means the AUTH path too — the manifest's three pre-cache
  // reads (screen + screenGroup + tenant) are exactly what made the old poll
  // expensive, so the credential snapshot is served from the in-process cache
  // backed by a 30 s Redis tier (`device-auth.ts`). Correctness does not rest
  // on that TTL: every revocation writer already calls
  // `invalidateDeviceCredentialCache`, which now DELs the shared copy too, so
  // a revoked device 403s on its very next poll on any replica.
  //
  // AND — the extended snapshot age applies ONLY while the revision is
  // UNCHANGED. Any change re-verifies the credential at the normal 5 s
  // freshness before a single byte is disclosed, so the cheap path can never
  // become the cheap path for a credential we have stopped trusting.
  @Get(':id/emergency-rev')
  async getEmergencyRev(@Param('id') id: string, @Req() req: ExpressReq, @Res() res: Response) {
    // Same non-storable posture as the manifest (2026-07-31 stuck-lockdown
    // dongle): an intermediary that cached a revision could pin a screen to
    // "nothing has changed" straight through an alert.
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');

    // Per-screen floor. Checked BEFORE auth work so a token-hammering client
    // cannot make us do crypto either. The player never polls faster than 5 s.
    const now = Date.now();
    const lastServed = ScreensController.emergencyRevLastServed.get(id);
    if (lastServed !== undefined && now - lastServed < ScreensController.EMERGENCY_REV_MIN_INTERVAL_MS) {
      res.setHeader('Retry-After', '1');
      return res.status(HttpStatus.TOO_MANY_REQUESTS).json({
        code: 'SCREEN_EMERGENCY_REV_TOO_FAST',
        message: 'Emergency revision polled faster than the per-screen floor',
      });
    }
    ScreensController.emergencyRevLastServed.set(id, now);
    if (ScreensController.emergencyRevLastServed.size > 10_000) {
      const oldest = ScreensController.emergencyRevLastServed.keys().next().value;
      if (oldest !== undefined) ScreensController.emergencyRevLastServed.delete(oldest);
    }

    // Pass 1 — the cheap gate. Signature + `sub === :id` are pure crypto; the
    // revocation-list check is Redis; the live-row checks come from the
    // snapshot tier. `allowUnpaired: false` because a revision is meaningless
    // without a tenant, and a 401 simply returns the player to full fetches.
    const cheap = await this.deviceAuth(req, id, {
      allowUnpaired: false,
      credentialMaxAgeMs: ScreensController.EMERGENCY_REV_CREDENTIAL_MAX_AGE_MS,
    });
    if (!cheap.ok) {
      return res.status(HttpStatus.UNAUTHORIZED).json({
        code: 'SCREEN_DEVICE_AUTH_REQUIRED',
        message: `Device auth required (${cheap.reason})`,
      });
    }

    // Tenant scoping is structural, not a check we could forget: the tenant
    // comes from the LIVE screen row (the DT-03 defence), the per-screen
    // record is rejected unless its recorded tenant matches, and the epoch is
    // read from a per-tenant key. A screen can only ever read its own.
    const answer = await resolveEmergencyRev({ redis: this.redisService }, id, cheap.tenantId, now);
    res.setHeader('ETag', answer.rev);

    const ifNoneMatch = req.headers['if-none-match'];
    if (typeof ifNoneMatch === 'string' && ifNoneMatch === answer.rev) {
      // THE HOT PATH. No Prisma call has been made and none will be.
      return res.status(304).end();
    }

    // Pass 2 — something moved, so re-verify at normal freshness before we
    // tell the device anything. This is the one place the endpoint may touch
    // Postgres, and only when there is real news.
    const fresh = await this.deviceAuth(req, id, { allowUnpaired: false });
    if (!fresh.ok) {
      return res.status(HttpStatus.UNAUTHORIZED).json({
        code: 'SCREEN_DEVICE_AUTH_REQUIRED',
        message: `Device auth required (${fresh.reason})`,
      });
    }
    // A re-home between the two passes invalidates the revision we computed
    // from the old tenant — recompute rather than answer for a tenant this
    // screen no longer belongs to.
    const finalAnswer =
      fresh.tenantId === cheap.tenantId
        ? answer
        : await resolveEmergencyRev({ redis: this.redisService }, id, fresh.tenantId, now);
    res.setHeader('ETag', finalAnswer.rev);

    // ── RAISE FAST PATH (P0-7 #2, 2026-09-05) ───────────────────────────
    // MEASURED: with Redis stopped, a lockdown reached all 1 000 screens at
    // p50 7.6 s / p95 21.7 s / max 45.1 s (vs p95 343 ms with push), because
    // every screen answered the moved revision with a FULL emergency-manifest
    // fetch and the herd queued on a CPU-saturated API. `emergency-rev` p95
    // through the same window was 33 ms. So when a tenant-scoped alert is up
    // and this screen is not already showing one, the descriptor rides THIS
    // response — the round trip the player is already making.
    //
    // SIGNED AT THE BOUNDARY, not stored signed: a stored envelope minted at
    // trigger time would be minutes old by the time a rebooting screen asked
    // for it, and the player's shared push gate would (correctly) drop it as
    // stale. Minting here gives a fresh `timestamp`, a unique `eventId` for
    // the player's replay LRU, and the same HMAC every WS/SSE push carries,
    // so the player can run it through `checkSensitivePush` unchanged rather
    // than through a bespoke trust rule.
    //
    // RAISE ONLY. There is no "clear" descriptor; `resolveEmergencyRev`
    // withholds this whenever the screen's own last manifest build already
    // recorded an alert, and its ABSENCE never means all-clear — only the
    // manifest releases (CLAUDE.md player rule 11). Nothing here changes what
    // the manifest says; the player still reconciles on the same tick.
    let alertEnvelope: unknown = undefined;
    if (finalAnswer.alert) {
      try {
        alertEnvelope = this.signer.signMessage('OVERRIDE', {
          ...finalAnswer.alert,
          active: true,
          screenId: id,
          // Names the delivery path in the player's console line and in any
          // captured bug report, so "how did this screen learn?" is answerable
          // from the device side without server logs.
          via: 'emergency-rev',
        });
      } catch {
        // The signer is the only thing that can fail here, and a raise that
        // cannot be signed must simply not be offered — the manifest fetch
        // this response also triggers is the unchanged path.
        alertEnvelope = undefined;
      }
    }

    return res.status(200).json({
      rev: finalAnswer.rev,
      active: finalAnswer.active,
      ...(alertEnvelope ? { alert: alertEnvelope } : {}),
    });
  }

  /**
   * The Tenant columns the manifest payload reads off the screen's own
   * tenant. `name` surfaces "paired with: <tenant>" on the player info card;
   * the poster-standard pair is what `manifestPosterStandard` resolves the
   * LED poster canvas from.
   *
   * ⚠️ 2026-09-03 — `posterStandardW/H` are NEW here and this is a BUG FIX
   * with observable effect. The projection was narrowed to `{ name: true }`
   * on 2026-08-16 (commit 1e582f79, the round-trip split); the poster
   * standard shipped on 2026-09-01 and read from this same object, so
   * `manifestPosterStandard` has been receiving `undefined` and returning its
   * 320×1080 built-in default on EVERY manifest branch since. A tenant that
   * configured a different module size has never had it reach a screen.
   * Adding the columns makes the feature work as designed; it changes the
   * emitted `posterStandard` only for a tenant that explicitly set one.
   */
  private static readonly MANIFEST_TENANT_SELECT = {
    name: true,
    posterStandardW: true,
    posterStandardH: true,
  } as const;

  /**
   * Read the Screen row + its group + its tenant projection — the three
   * queries every manifest poll used to pay before the content cache was
   * consulted (efficiency L1, 2026-09-03).
   *
   * Returns the SAME assembled shape the old inline code produced
   * (`screen.screenGroup` / `screen.tenant` attached), so every downstream
   * branch is byte-for-byte unchanged. Returns null when the row is gone.
   *
   * The snapshot is a fresh shallow copy per call, so a caller that attaches
   * or overwrites a top-level key cannot write through into the cache.
   */
  private async loadManifestPreamble(
    req: ExpressReq,
    id: string,
    revAtStart: number,
  ): Promise<ManifestScreenRow | null> {
    const cached = getManifestPreamble(id);
    if (cached) {
      return { ...cached.screen, screenGroup: cached.screenGroup, tenant: cached.tenant };
    }

    // Phase B — same retry treatment as deviceStatus. Manifest fetch is the
    // call whose failure cascades all the way to nativeReload on the kiosk
    // (5 consecutive failures → WebView hard reload).
    const screen = await withDbRetry(
      // ten-ok: this row IS the credential evidence. The manifest preamble
      // reads it precisely so the tenant binding, REVOKED status and
      // credential epoch can be verified AGAINST it further down the same
      // request — scoping the read would require the tenant it exists to
      // produce. Load-bearing emergency-delivery path; do not restructure.
      () => this.prisma.client.screen.findUnique({ where: { id } }),
      { label: 'screen.findUnique[manifest]' },
    );
    if (!screen) return null;

    // This row is the freshest credential evidence in the process. Publishing
    // it means the epoch check further down this same request, and any
    // device-auth in the memo window after it, are answered without a second
    // read of a row we are holding. Live-row only — never a cached one — so
    // it cannot launder a stale snapshot into a fresher tier.
    publishDeviceCredentialState(req, id, screen as any);

    // 2026-05-19 — screenGroup carries syncMode for the frame-locked sync
    // block. FKs come off the authoritative just-read screen row — exactly
    // the rows the old `include` joined server-side.
    const [manifestScreenGroup, manifestTenant] = await withDbRetry(
      () =>
        Promise.all([
          (screen as any).screenGroupId
            ? // ten-ok: FK sourced from the device's own authoritative Screen row (self-scoped manifest read)
              this.prisma.client.screenGroup.findUnique({ where: { id: (screen as any).screenGroupId } })
            : Promise.resolve(null),
          (screen as any).tenantId
            ? // ten-ok: FK sourced from the device's own authoritative Screen row (self-scoped manifest read)
              this.prisma.client.tenant.findUnique({
                where: { id: (screen as any).tenantId },
                select: ScreensController.MANIFEST_TENANT_SELECT as any,
              })
            : Promise.resolve(null),
        ]),
      { label: 'screen.relations[manifest]' },
    );

    // `revAtStart` was captured before the first of these reads, so a mutation
    // that landed mid-read stores an already-stale rev and the next poll
    // re-reads — rows that never coexisted can never be served twice.
    setManifestPreamble(
      id,
      {
        screen: screen as unknown as ManifestScreenRow,
        screenGroup: manifestScreenGroup as Record<string, unknown> | null,
        tenant: manifestTenant as Record<string, unknown> | null,
      },
      revAtStart,
    );
    return {
      ...(screen as unknown as ManifestScreenRow),
      screenGroup: manifestScreenGroup,
      tenant: manifestTenant,
    };
  }

  /**
   * Re-read the Screen row from Postgres for a branch that must never be
   * assembled from a snapshot: EMERGENCY and the sports scoreboard.
   *
   * `manifest-hot-cache.ts` has always promised that those two branches are
   * "rebuilt from the freshly-read Screen row on every poll" — they read
   * `resolution` (the portrait-vs-landscape emergency playlist pick),
   * `orientation`, the canvas pair and `displayCapabilities`, and several of
   * those are telemetry-only columns that do NOT move the content rev. The
   * preamble snapshot keeps that promise true by stepping out of the way the
   * moment one of those branches is taken. This costs one read on a poll that
   * is already doing life-safety work, and zero on every other poll.
   *
   * Falls back to the snapshot the caller already holds if the re-read fails
   * or the row has vanished mid-request: an alert must never be lost to a
   * pool blip (same fail-safe direction as `buildDisplayManifestBlock`).
   */
  private async readManifestScreenLive(
    id: string,
    fallback: ManifestScreenRow,
  ): Promise<ManifestScreenRow> {
    try {
      // ten-ok: identity-derived self-lookup — `id` is the verified device JWT sub (checked above) and this re-reads THAT screen's own row
      const fresh = await this.prisma.client.screen.findUnique({ where: { id } });
      if (!fresh) return fallback;
      return {
        ...(fresh as unknown as ManifestScreenRow),
        screenGroup: fallback.screenGroup,
        tenant: fallback.tenant,
      };
    } catch {
      return fallback;
    }
  }

  // ─── Player manifest (what the screen device fetches) ───
  //
  // SEC-001 (2026-09-04) — THE ONE DEVICE READ AN UNPROVEN CREDENTIAL KEEPS,
  // and it is a decision, not an oversight. This route is the documented
  // HTTP-polling backstop for the emergency system (CLAUDE.md safeguard #4):
  // it carries the live `emergency` block, so it is how a lockdown reaches a
  // screen whose credential has gone unproven — a state legitimate screens
  // reach routinely (APK re-sideload, cleared WebView storage, a token expired
  // over summer break, a superseded epoch). Refusing it would convert this
  // security fix into a dark screen, which is the failure mode the product
  // exists to prevent.
  //
  // What that costs, stated plainly: someone holding a leaked fingerprint can
  // read this screen's content assignment and emergency state. What it does
  // NOT let them do — because `DeviceIdentityInterceptor` refuses every
  // unproven WRITE, and `verifyDeviceForScreen` refuses the credential
  // outright — is mint a stream ticket, forge render proof or telemetry,
  // enumerate emergency media, drive the display, or unpair the screen.
  // Closing the read needs an operator-approved recovery flow (see the
  // SEC-001 report), not a wider denylist.
  @UseGuards(JwtAuthGuard)
  @Get(':id/manifest')
  async getManifest(@Param('id') id: string, @Req() req: ExpressReq, @Res() res: Response) {
    // LIFE-SAFETY (2026-07-31, Greg's stuck-lockdown dongle): the manifest
    // previously shipped an ETag but NO Cache-Control on ANY branch —
    // heuristically cacheable. An Android WebView HTTP cache or a school
    // web proxy (Squid/ZScaler) could re-serve a cached EMERGENCY manifest
    // after all-clear (screen stuck on lockdown) or a stale normal manifest
    // after content removal (deleted template keeps playing). Every branch
    // of this handler — emergency, cached, empty, full, even the 304s —
    // must be explicitly non-storable by intermediaries; freshness comes
    // from our own ETag + the server-side hot cache, never from HTTP caches
    // we don't control. Set once here so no future branch can miss it.
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    const activeDeviceHash = req.headers['if-none-match'];
    // Content-rev snapshot BEFORE any row is read (manifest content cache,
    // 2026-07-30): if a mutation lands while this build is in flight, the
    // entry we store carries an already-stale rev and the next poll
    // rebuilds — torn data can never be served twice.
    const manifestRevAtStart = currentManifestContentRev();

    // Phase B — same retry treatment as deviceStatus. Manifest fetch
    // is the call whose failure cascades all the way to nativeReload
    // on the kiosk (5 consecutive failures → WebView hard reload),
    // so a transient pool blip here is the single most visible
    // failure mode for the kiosk experience.
    // 2026-08-16 (efficiency audit) — this read runs on EVERY poll of every
    // screen, and the old `include: { screenGroup, tenant }` made Prisma emit
    // THREE sequential statements inside an implicit transaction — at the
    // measured ~212ms/round-trip that was >600ms of pure serialization on
    // the fleet's hottest endpoint. Split: fetch the screen alone (also the
    // fastest possible 403 for a revoked device), then load the two
    // relations IN PARALLEL and reattach. The assembled object is
    // shape-identical to the include, so the manifest payload — and
    // therefore the ETag and the hot-cache contract — are byte-for-byte
    // unchanged.
    //
    // 2026-09-03 (efficiency L1) — and those three now come from the identity
    // preamble snapshot (manifest-hot-cache.ts) when nothing has changed, so
    // an unchanged poll pays ZERO of them. Freshness is the content rev, i.e.
    // identical to the manifest content cache the fan-out already uses: any
    // write to the Screen row (bar telemetry columns), its group or its
    // tenant lands on the very next poll. What is NOT snapshot-served:
    //   • the 403 below, which is taken against the credential snapshot every
    //     revocation writer invalidates (and the global DeviceIdentity-
    //     Interceptor has already 401'd a revoked device before this line);
    //   • the EMERGENCY and SPORTS branches, which re-read the row live —
    //     see `readManifestScreenLive`.
    // `let`, not `const`: the EMERGENCY and SPORTS branches below re-bind it
    // to a live re-read before they build anything (`readManifestScreenLive`).
    let screen = await this.loadManifestPreamble(req, id, manifestRevAtStart);

    if (!screen || screen.status === 'REVOKED') {
      return res.status(403).json({ error: 'Device invalid or revoked' });
    }

    // Any successful manifest fetch means the device is alive + talking
    // to us — touch lastPingAt so the dashboard list endpoint (which
    // derives ONLINE/OFFLINE from lastPingAt < 2min) reflects reality.
    // DEBOUNCED to at most once per 25s per screen: the 2min ONLINE
    // threshold tolerates up to 25s of staleness, and the previous
    // unthrottled write-per-poll pattern was saturating the Supabase
    // pool (500 screens × 5s polls = 100 writes/sec, each grabbing a
    // connection). Non-blocking either way — if Prisma hiccups we
    // still return the manifest; next fetch re-checks the debounce.
    if (!shouldSkipLastPingWrite(screen.id)) {
      markLastPingWritten(screen.id);
      // ten-ok: fire-and-forget lastPingAt stamp on the screen this request
      // has already authenticated as (device credential verified in the
      // preamble). No caller tenant; the write touches one telemetry column on
      // that same row. Load-bearing manifest path; do not restructure.
      this.prisma.client.screen
        // select:{id} — fire-and-forget telemetry; without it Prisma RETURNINGs
        // all ~88 columns (incl. the crash-stack and cache-report blobs) back
        // over the wire on every debounced ping, to be thrown away.
        .update({ where: { id: screen.id }, data: { lastPingAt: new Date() }, select: { id: true } })
        .catch(() => { /* non-fatal; next manifest fetch will retry */ });
    }

    // MED-1 audit fix: tenant-scope the read so a user from Tenant A can't
    // fetch Tenant B's manifest by guessing the screen UUID. Three valid
    // callers:
    //   1. Device JWT (kind: 'device', sub: screenId) — must match this
    //      screen.id directly.
    //   2. SUPER_ADMIN — cross-tenant by design.
    //   3. User JWT — req.user.tenantId must match screen.tenantId.
    const u: any = (req as any).user;
    if (u) {
      const isDeviceJwt = u.kind === 'device';
      const isSuper = u.role === AppRole.SUPER_ADMIN;
      if (isDeviceJwt) {
        if (u.sub !== screen.id) {
          return res.status(403).json({ error: 'Device token does not match screen' });
        }
        // 2026-08-03 (DT-01): honour the credential epoch. `JwtAuthGuard`
        // verifies the signature but knows nothing about revocation state,
        // so without this a token retired by an unpair / re-pair / operator
        // revoke would keep pulling this screen's manifest — including its
        // live `emergency` block — until it expired on its own.
        //
        // Read the claim off the bearer token rather than off `req.user`:
        // the global DeviceIdentityInterceptor already rejects a stale
        // epoch, and this defence-in-depth check must not silently invert
        // into a false 403 if that interceptor is ever reordered or
        // unregistered. The signature is already established by the guard.
        const deviceClaims = decodeDeviceTokenUnsafe(
          typeof req.headers.authorization === 'string' ? req.headers.authorization : '',
        );
        if (!isEpochAcceptable(epochFromClaim(deviceClaims), screen as any)) {
          return res.status(403).json({ error: 'Device credential revoked' });
        }
      } else if (!isSuper) {
        const callerTenantId = u.schoolId || u.tenantId || u.districtId;
        if (!screen.tenantId || screen.tenantId !== callerTenantId) {
          return res.status(404).json({ error: 'Screen not found' }); // 404 not 403 to avoid existence-leak
        }
      }
    }

    // ─── Sprint 8b — per-screen emergency override (PRECEDES tenant-wide) ───
    // The player checks for a row in ScreenEmergencyOverride scoped to
    // this exact screen FIRST. If one exists and isn't expired, we
    // synthesize the same emergency state shape the tenant-wide path
    // produces, but using the override's type/severity/playlist. The
    // tenant-wide block below stays untouched — if no per-screen
    // override is active we fall through to it like always.
    //
    // This is the load-bearing change for Sprint 8b: "different alert
    // per room" works because the manifest path always picks per-screen
    // before tenant. No additional protocol on the player side — same
    // emergencyStatus shape goes out the door.
    let activeScreenOverride: any = null;
    try {
      activeScreenOverride = await (this.prisma.client as any).screenEmergencyOverride.findUnique({
        where: { screenId: screen.id },
      });
      if (activeScreenOverride?.expiresAt) {
        const exp = new Date(activeScreenOverride.expiresAt).getTime();
        if (Number.isFinite(exp) && exp < Date.now()) {
          // Expired override — treat as cleared. Don't delete here
          // (manifest endpoint should be read-only); a janitor / cron
          // can prune. Just ignore for this manifest fetch.
          activeScreenOverride = null;
        }
      }
    } catch { /* schema mismatch / missing table — fall back to tenant-wide */ }

    if (screen.tenantId) {
      // Hot-path cache: the emergency-state lookup for this tenant is
      // shared across every screen in the tenant polling manifest.
      // Cache for 2s; emergency controllers explicitly invalidate on
      // trigger/all-clear so the state propagates faster than TTL.
      //
      // The select is MANIFEST_TENANT_EMERGENCY_SELECT — it pulls both
      // orientation pointers (so we can pick the right one for this
      // screen), the INCIDENT TYPE (2026-07-25: without it
      // `tenant.emergencyType` is undefined and the manifest silently
      // falls back to the severity, rendering "CRITICAL PROTOCOL ACTIVE"
      // instead of LOCKDOWN), the Sprint-8b `locationBasedEmergencyEnabled`
      // toggle, and `parentId` for the district-inheritance walk below.
      // Cast through `any` so the controller compiles even before
      // @prisma/client picks up the emergency_portrait_playlist_id column.
      let tenant = getTenantState(screen.tenantId) as any;
      if (!tenant) {
        tenant = await this.prisma.client.tenant.findUnique({
          where: { id: screen.tenantId },
          select: ScreensController.MANIFEST_TENANT_EMERGENCY_SELECT as any,
        }) as any;
        if (tenant) setTenantState(screen.tenantId, tenant);
      }

      // ── DISTRICT INHERITANCE SAFETY NET (2026-08-03) ────────────────────
      // A district trigger FANS OUT and writes this school's own row, so in
      // the normal case the check below finds an active emergency already
      // and this walk never runs. It exists for the cases fan-out cannot
      // reach — see resolveAncestorEmergencyState for the full list. The
      // inherited state is merged into a LOCAL copy: never write the merged
      // object back through setTenantState or we would poison this school's
      // cache entry with its district's status.
      // An ARCHIVED (soft-deleted) location never inherits — the fan-out
      // skips it, so inheriting would put a district lockdown on the
      // leftover screens of a retired/test tenant that no audit row, no
      // webhook and no pub/sub message ever named.
      let inheritedFromTenantId: string | null = null;
      if (
        tenant &&
        !tenant.archivedAt &&
        (!tenant.emergencyStatus || tenant.emergencyStatus === 'INACTIVE') &&
        tenant.parentId
      ) {
        const ancestor = await this.resolveAncestorEmergencyState(tenant.parentId);
        if (ancestor) {
          inheritedFromTenantId = ancestor.id ?? tenant.parentId;
          tenant = {
            ...tenant,
            emergencyStatus: ancestor.emergencyStatus,
            emergencyType: ancestor.emergencyType,
            emergencyPlaylistId: ancestor.emergencyPlaylistId,
            emergencyPortraitPlaylistId: ancestor.emergencyPortraitPlaylistId,
            // NOT inherited: locationBasedEmergencyEnabled stays this
            // school's own opt-in, because the per-screen emergency config
            // it gates lives on THIS school's screens.
          };
        }
      }

      // Sprint 8b — per-screen override wins over tenant-wide. If we
      // found a non-expired ScreenEmergencyOverride for this screen
      // above, treat the manifest as if an emergency is active
      // EVEN WHEN the tenant-wide status is INACTIVE. The override's
      // type becomes the surfaced emergencyStatus; its playlist (if
      // set) is preferred over the tenant default. Critical: a
      // per-screen override may also be in effect during a tenant-wide
      // alert — in that case the per-screen content trumps. e.g.,
      // tenant is in WEATHER but the gym screen carries a LOCKDOWN
      // override because of a localized incident. The gym renders
      // LOCKDOWN, every other screen renders WEATHER.
      const emergencyActiveForThisScreen =
        !!activeScreenOverride ||
        (tenant?.emergencyStatus && tenant.emergencyStatus !== 'INACTIVE');

      // ── Record the decision for GET /:id/emergency-rev (2026-09-02) ──────
      // Placed HERE, before the branch split, so every branch — emergency,
      // scoreboard, normal, empty — records the same fact from the state this
      // poll already read. Zero extra queries. `tenant` at this point is the
      // LOCAL merged copy, i.e. it already carries any inherited district
      // alert, so a school whose only alert comes from its district still
      // records a signature that moves when the district's does.
      //
      // The override's `expiresAt` is a boundary: it changes what belongs on
      // glass with no write at all, so the revision must move when it passes.
      try {
        noteScreenEmergencyState(screen.id, {
          tenantId: screen.tenantId,
          active: !!emergencyActiveForThisScreen,
          sig: emergencySignature({
            overrideId: activeScreenOverride?.id ?? null,
            overrideType: activeScreenOverride?.type ?? null,
            overrideSeverity: activeScreenOverride?.severity ?? null,
            overridePlaylistId: activeScreenOverride?.playlistId ?? null,
            overrideScopeNote: activeScreenOverride?.scopeNote ?? null,
            overrideExpiresAtMs: activeScreenOverride?.expiresAt
              ? new Date(activeScreenOverride.expiresAt).getTime()
              : null,
            tenantStatus: tenant?.emergencyStatus ?? null,
            tenantType: tenant?.emergencyType ?? null,
            tenantPlaylistId: tenant?.emergencyPlaylistId ?? null,
            tenantPortraitPlaylistId: tenant?.emergencyPortraitPlaylistId ?? null,
            inheritedFromTenantId,
          }),
          boundaryAt: activeScreenOverride?.expiresAt
            ? new Date(activeScreenOverride.expiresAt).getTime()
            : null,
        });
      } catch {
        // Revision bookkeeping must never be able to fail a manifest poll.
        // A missing record reads as `cold`, i.e. the screen fetches — the
        // safe direction.
      }

      if (emergencyActiveForThisScreen) {
        // LIFE-SAFETY (2026-09-03, efficiency L1): everything from here down
        // is built from a row read from Postgres on THIS request, never from
        // the identity preamble snapshot. Keeps manifest-hot-cache.ts's
        // standing promise — "the emergency branch is rebuilt from the
        // freshly-read Screen row on every poll" — literally true rather than
        // an argument about which columns bust the content rev. One read, and
        // only on a poll that is already doing alert work.
        screen = await this.readManifestScreenLive(id, screen);
        let playlists: any[] = [];

        // Parse the screen's stored resolution ("2160×3840" / "2160x3840")
        // to decide which playlist variant to serve. Portrait = height
        // strictly greater than width. If resolution is null or
        // unparseable we default to landscape (safe: the original
        // emergencyPlaylistId is what every tenant already has wired up).
        const isPortrait = (() => {
          // Prefer the operator's explicit LED canvas dims: a 960×1080 poster
          // reports DEVICE resolution 1920×1080 (landscape) but is physically
          // portrait — same precedence the scoreboard manifest + board page use.
          // Fall back to stored resolution when no canvas is configured.
          const cw = Number((screen as any).canvasW);
          const ch = Number((screen as any).canvasH);
          if (Number.isFinite(cw) && Number.isFinite(ch) && cw > 0 && ch > 0) return ch > cw;
          const r = (screen.resolution || '').trim();
          const m = r.match(/^(\d+)\s*[x×]\s*(\d+)$/i);
          if (!m) return false;
          return parseInt(m[2], 10) > parseInt(m[1], 10);
        })();

        // Sprint 8b — per-screen emergency content config takes
        // priority over the tenant defaults. FOUR tiers, in order:
        //   1. Per-trigger override `playlistId`  (manual incident)
        //   2. Per-screen `emergency*PlaylistId`   (config column)
        //   3. Per-screen `emergency*AssetUrl`     (single uploaded file)
        //   4. Tenant-wide `panic*PlaylistId`      (school-wide default)
        // Operator can mix-and-match: gym screens can show a custom
        // "evacuate via north exit" playlist on EVACUATE while every
        // other screen uses the tenant default — no manual trigger
        // required, configured once and forgotten.
        const screenAny = screen as any;
        const emergencyTypeKey = (activeScreenOverride?.type || tenant?.emergencyStatus || '').toUpperCase();
        // Operator can configure separate landscape + portrait variants
        // per emergency type per screen. The screen's actual physical
        // orientation (computed below from `screen.resolution`) decides
        // which set the manifest reads. We FALL BACK to the other
        // orientation if only one was configured — mirrors the tenant-
        // wide behavior where a single configured orientation covers
        // every kiosk regardless of mounting.
        const perScreenForType = ((): string | null => {
          if (isPortrait) {
            switch (emergencyTypeKey) {
              case 'LOCKDOWN': return screenAny.emergencyLockdownPortraitPlaylistId || screenAny.emergencyLockdownPlaylistId || null;
              case 'EVACUATE': return screenAny.emergencyEvacuatePortraitPlaylistId || screenAny.emergencyEvacuatePlaylistId || null;
              case 'WEATHER':  return screenAny.emergencyWeatherPortraitPlaylistId  || screenAny.emergencyWeatherPlaylistId  || null;
              case 'HOLD':     return screenAny.emergencyHoldPortraitPlaylistId     || screenAny.emergencyHoldPlaylistId     || null;
              case 'SECURE':   return screenAny.emergencySecurePortraitPlaylistId   || screenAny.emergencySecurePlaylistId   || null;
              case 'MEDICAL':  return screenAny.emergencyMedicalPortraitPlaylistId  || screenAny.emergencyMedicalPlaylistId  || null;
              default:         return null;
            }
          }
          switch (emergencyTypeKey) {
            case 'LOCKDOWN': return screenAny.emergencyLockdownPlaylistId || screenAny.emergencyLockdownPortraitPlaylistId || null;
            case 'EVACUATE': return screenAny.emergencyEvacuatePlaylistId || screenAny.emergencyEvacuatePortraitPlaylistId || null;
            case 'WEATHER':  return screenAny.emergencyWeatherPlaylistId  || screenAny.emergencyWeatherPortraitPlaylistId  || null;
            case 'HOLD':     return screenAny.emergencyHoldPlaylistId     || screenAny.emergencyHoldPortraitPlaylistId     || null;
            case 'SECURE':   return screenAny.emergencySecurePlaylistId   || screenAny.emergencySecurePortraitPlaylistId   || null;
            case 'MEDICAL':  return screenAny.emergencyMedicalPlaylistId  || screenAny.emergencyMedicalPortraitPlaylistId  || null;
            default:         return null;
          }
        })();
        const perScreenAssetForType = ((): string | null => {
          if (isPortrait) {
            switch (emergencyTypeKey) {
              case 'LOCKDOWN': return screenAny.emergencyLockdownPortraitAssetUrl || screenAny.emergencyLockdownAssetUrl || null;
              case 'EVACUATE': return screenAny.emergencyEvacuatePortraitAssetUrl || screenAny.emergencyEvacuateAssetUrl || null;
              case 'WEATHER':  return screenAny.emergencyWeatherPortraitAssetUrl  || screenAny.emergencyWeatherAssetUrl  || null;
              case 'HOLD':     return screenAny.emergencyHoldPortraitAssetUrl     || screenAny.emergencyHoldAssetUrl     || null;
              case 'SECURE':   return screenAny.emergencySecurePortraitAssetUrl   || screenAny.emergencySecureAssetUrl   || null;
              case 'MEDICAL':  return screenAny.emergencyMedicalPortraitAssetUrl  || screenAny.emergencyMedicalAssetUrl  || null;
              default:         return null;
            }
          }
          switch (emergencyTypeKey) {
            case 'LOCKDOWN': return screenAny.emergencyLockdownAssetUrl || screenAny.emergencyLockdownPortraitAssetUrl || null;
            case 'EVACUATE': return screenAny.emergencyEvacuateAssetUrl || screenAny.emergencyEvacuatePortraitAssetUrl || null;
            case 'WEATHER':  return screenAny.emergencyWeatherAssetUrl  || screenAny.emergencyWeatherPortraitAssetUrl  || null;
            case 'HOLD':     return screenAny.emergencyHoldAssetUrl     || screenAny.emergencyHoldPortraitAssetUrl     || null;
            case 'SECURE':   return screenAny.emergencySecureAssetUrl   || screenAny.emergencySecurePortraitAssetUrl   || null;
            case 'MEDICAL':  return screenAny.emergencyMedicalAssetUrl  || screenAny.emergencyMedicalPortraitAssetUrl  || null;
            default:         return null;
          }
        })();

        // Sprint 8b mode gate. Per-screen config columns (and per-screen
        // custom uploads) only matter if the tenant has opted into
        // location-based mode. The columns themselves are kept (so
        // toggling the mode back on is non-destructive), but the
        // manifest behaves like they're empty until the flag flips.
        // Per-trigger ScreenEmergencyOverride entries are ALWAYS
        // honored — those are explicit, audit-logged operator actions
        // that pre-date the per-screen-config layer and must never be
        // gated by a settings toggle.
        const locationModeOn = !!tenant?.locationBasedEmergencyEnabled;
        const effectivePerScreenPlaylist = locationModeOn ? perScreenForType : null;
        const effectivePerScreenAsset    = locationModeOn ? perScreenAssetForType : null;

        // Pick the playlist for this screen's orientation. Graceful
        // fallback in BOTH directions: a portrait screen uses the
        // landscape playlist if no portrait was configured, and
        // vice-versa.
        const chosenPlaylistId =
          activeScreenOverride?.playlistId ||                          // 1. manual trigger override (always honored)
          effectivePerScreenPlaylist ||                                 // 2. per-screen config (gated by location mode)
          (isPortrait                                                   // 3. tenant default
            ? (tenant?.emergencyPortraitPlaylistId || tenant?.emergencyPlaylistId || null)
            : (tenant?.emergencyPlaylistId || tenant?.emergencyPortraitPlaylistId || null));

        if (chosenPlaylistId) {
          // ten-ok: `chosenPlaylistId` is not caller-supplied — it is read from
          // this screen's own emergency columns (which setEmergencyContent
          // validates against the screen's tenant and drops cross-tenant ids to
          // null) or from the screen's own tenant defaults. Both sources are
          // already tenant-derived. Deliberately NOT given a predicate: this is
          // the lockdown/evacuate delivery path, and a predicate that ever
          // failed to match would blank an emergency board rather than fall
          // back. Load-bearing emergency path; do not restructure.
          const emergencyPlaylist = await this.prisma.client.playlist.findUnique({
            where: { id: chosenPlaylistId },
            include: {
              items: {
                // Sprint 1.5 approval gate. Issue #1: previously the
                // manifest delivered every item regardless of asset
                // approval state — meaning a CONTRIBUTOR's pending
                // asset reached screens before any admin approved it.
                // Filter to PUBLISHED only. Emergency assets are
                // admin-uploaded and auto-publish so this is a strict
                // tightening with no behavior change for the existing
                // admin-content path.
                where: { asset: { status: 'PUBLISHED' } },
                include: { asset: true },
                orderBy: { sequenceOrder: 'asc' }
              }
            }
          });

          if (emergencyPlaylist && emergencyPlaylist.items.length > 0) {
            playlists = [{
              id: emergencyPlaylist.id,
              name: emergencyPlaylist.name,
              items: emergencyPlaylist.items.map(item => ({
                item_id: item.id,
                asset_id: item.assetId,
                asset_hash: item.asset.fileHash ?? null,
                url: item.asset.fileUrl,
                duration_ms: item.durationMs,
                sequence: item.sequenceOrder,
                mime_type: item.asset.mimeType ?? null,
                transition_type: item.transitionType ?? null,
              }))
            }];
          }
        }

        // If no playlist was selected/found AND the operator uploaded a
        // single custom asset for this emergency type, synthesize a
        // one-item playlist around it. The player renders the asset
        // full-screen for the standard emergency duration. Image vs
        // video MIME is inferred from the URL extension. Gated by the
        // same location-mode toggle as the playlist column above —
        // see `effectivePerScreenAsset` for rationale.
        const effectiveOverrideAsset = activeScreenOverride?.mediaUrl || null;
        if (playlists.length === 0 && (effectiveOverrideAsset || effectivePerScreenAsset)) {
          const url = (effectiveOverrideAsset || effectivePerScreenAsset)!;
          const ext = (url.split('?')[0].split('#')[0].split('.').pop() || '').toLowerCase();
          const mime =
            ['mp4','mov','webm','m4v'].includes(ext) ? `video/${ext === 'mov' ? 'quicktime' : ext}` :
            ['png','jpg','jpeg','webp','gif','svg','bmp'].includes(ext) ? `image/${ext === 'jpg' ? 'jpeg' : ext}` :
            ext === 'pdf' ? 'application/pdf' :
            null;
          playlists = [{
            id: `screen-asset-${emergencyTypeKey.toLowerCase()}`,
            name: `${emergencyTypeKey} (custom asset)`,
            items: [{
              item_id: `screen-asset-${screen.id}-${emergencyTypeKey.toLowerCase()}`,
              asset_id: null,
              asset_hash: null,
              url,
              duration_ms: 60_000,  // 60s default for a single-asset emergency loop
              sequence: 0,
              mime_type: mime,
              transition_type: null,
            }],
          }];
        }

        // Effective emergency type for THIS screen — per-screen
        // override wins; falls back to the tenant-wide emergencyStatus.
        // Per-screen override wins; then the tenant's INCIDENT TYPE; only then
        // the legacy emergencyStatus (which holds the SEVERITY, so it renders
        // "CRITICAL PROTOCOL ACTIVE" — kept last purely for rows written before
        // Tenant.emergencyType existed).
        const effectiveType =
          activeScreenOverride?.type ||
          (tenant as any)?.emergencyType ||
          tenant?.emergencyStatus ||
          'EMERGENCY';
        const effectiveSeverity =
          activeScreenOverride?.severity ||
          tenant?.emergencyStatus ||
          'HIGH';

        // BULLETPROOF FALLBACK: If the admin failed to assign an emergency playlist or it was empty,
        // we MUST still lock the screen down to protect the school.
        // Swap template width/height for portrait screens so the TEXT
        // zone fills the full canvas correctly (1920×1080 → 1080×1920).
        // The per-screen override's textBlob (operator-typed message)
        // and scope_note land in the fallback content so the rendered
        // text matches the trigger UX exactly.
        if (playlists.length === 0) {
          // 2026-06-28 (Greg live P0 — lockdown rendered at 1920 on the
          // 960×1080 LED): the fallback template MUST be authored at the
          // screen's REAL visible canvas, not a hardcoded 1920/1080. The
          // player's TemplateScaler sizes the scene to designW=template.
          // screenWidth; when that was 1920 the lockdown was laid out for a
          // 1920 frame buffer and only the left ~960 showed on the panel. Use
          // the operator-set canvasW/canvasH (e.g. 960×1080) so the fallback
          // emergency fills the actual LED exactly; fall back to the
          // portrait/landscape default only when the screen has no canvas set.
          const canvasW =
            screen.canvasW && screen.canvasW > 0 ? screen.canvasW : (isPortrait ? 1080 : 1920);
          const canvasH =
            screen.canvasH && screen.canvasH > 0 ? screen.canvasH : (isPortrait ? 1920 : 1080);
          // Pick the most specific text we have — operator's textBlob
          // first, then the scope_note ("Gym wing — hold position"),
          // then a SYSTEM DEFAULT message that includes the type.
          const fallbackContent =
            activeScreenOverride?.textBlob
              ? activeScreenOverride.textBlob
              : activeScreenOverride?.scopeNote
                ? `${effectiveType} — ${activeScreenOverride.scopeNote}\n\nFollow standard procedures.`
                : `EMERGENCY NOTIFICATION\n\n${effectiveType} PROTOCOL ACTIVE\n\nPlease follow standard procedures`;
          const fallbackBg =
            effectiveSeverity === 'CRITICAL' ? '#dc2626' :
            effectiveSeverity === 'HIGH'     ? '#dc2626' :
            effectiveSeverity === 'MEDIUM'   ? '#d97706' :
            '#d97706';
          playlists = [{
             id: "DEFAULT_EMERGENCY",
             name: `SYSTEM DEFAULT - ${effectiveType}`,
             template: {
               name: "EMERGENCY OVERRIDE",
               bgColor: fallbackBg,
               screenWidth: canvasW,
               screenHeight: canvasH,
               zones: [
                 {
                   id: "emergency-zone",
                   x: 0, y: 0, width: 100, height: 100, zIndex: 1,
                   widgetType: "TEXT",
                   // 2026-06-27 (LANE 1 life-safety) — route through the
                   // signage-design ENGINE text path (`sizeMode: 'absolute'`)
                   // so the message ALWAYS fits its zone via FitScaler
                   // (measure + transform:scale, Chromium-83/Taurus-safe),
                   // never clipping. The legacy TEXT path hard-CLAMPS
                   // fontSize to 3em (~48px) AND wraps inside an
                   // `overflow:hidden` box with NO shrink — so a long
                   // operator-typed lockdown message (textBlob) was cut off
                   // top/bottom on any canvas where the wrapped text ran
                   // taller than the zone (the exact clip class Greg caught
                   // on the 960×1080 LED). `fontSize` here is the INTENDED
                   // size; FitScaler shrinks it down to fit. fontWeight 800
                   // replaces the legacy `bold` flag (the absolute path reads
                   // a numeric weight, not the toggle).
                   defaultConfig: {
                     sizeMode: "absolute",
                     content: fallbackContent,
                     fontSize: isPortrait ? 140 : 100,
                     fontWeight: 800,
                     color: "white",
                     alignment: "center",
                     lineHeight: 1.15
                   }
                 }
               ]
             },
             items: []
          }];
        }

        return res.status(200).json({
          screenId: screen.id,
          generatedAt: new Date().toISOString(),
          isEmergency: true,
          // Sprint 8b — surface the active type so the player can show
          // the right banner / icon. Per-screen wins over tenant.
          emergencyType: effectiveType,
          emergencySeverity: effectiveSeverity,
          // Operator-typed scope note ("Gym — hold position") so the
          // player can render it as a sub-banner. Empty when only the
          // tenant-wide alert is active.
          emergencyScopeNote: activeScreenOverride?.scopeNote || null,
          // Tells the player whether it's running a per-screen or
          // tenant-wide override. Useful for the Stopped splash too.
          // Deliberately still 'tenant' for an INHERITED district alert:
          // from this screen's point of view it IS a tenant-wide alert, and
          // introducing a new enum value here would change a player-visible
          // field on a life-safety path for no behavioural gain. The
          // provenance rides the additive field below instead.
          emergencyScope: activeScreenOverride ? 'screen' : 'tenant',
          // 2026-08-03 — which tenant this alert actually originates from
          // when it was INHERITED from an ancestor (district) rather than
          // set on this screen's own tenant. Null in every other case, so
          // existing players ignore it and support can tell "this school
          // was locked down by its district" from a single manifest dump.
          emergencyInheritedFromTenantId: activeScreenOverride ? null : inheritedFromTenantId,
          // 2026-05-26 audit — surface the per-screen override's expiry
          // (UNIX seconds) so the player's emergency-cache layer at
          // apps/web/.../player/page.tsx:451 anchors the cache TTL to
          // the server-issued absolute time instead of the device's
          // wall clock. The reader (page.tsx:2711) already expects this
          // field; only emit it when there's actually a per-screen
          // override with an expiry (tenant-wide alerts don't auto-
          // expire — they last until explicit ALL_CLEAR). Null when
          // absent so the player falls through to its 4h fallback TTL,
          // matching pre-existing behavior for tenant-wide alerts.
          emergencyExpiresAt: activeScreenOverride?.expiresAt
            ? Math.floor(new Date(activeScreenOverride.expiresAt).getTime() / 1000)
            : null,
          orientation: isPortrait ? 'portrait' : 'landscape',
          // 2026-06-25 — carry the LED canvas dims + tile-repeat on the
          // EMERGENCY manifest too (scoreboard + normal playlist branches
          // already do). Without these the player's TemplateScaler renders the
          // emergency playlist at device resolution (1920) → the alert is cut
          // off on a narrow LED poster (e.g. the live 960×1080 water-polo wall).
          // Life-safety: an alert that doesn't fit is an alert unseen.
          canvasW: (screen as any).canvasW ?? null,
          canvasH: (screen as any).canvasH ?? null,
          posterStandard: manifestPosterStandard((screen as any).tenant),
          repeats: (screen as any).repeats ?? 1,
          // 2026-05-27 — EP6N GPIO output state. The player applies
          // these to the Phoenix terminal's relay outputs. Emergency
          // branch must carry the same state as the normal branch so
          // a status lamp that was lit via gpio-set doesn't blink
          // off when the screen flips into emergency mode.
          gpio: (() => {
            const s = readGpioState((screen as any).config);
            return { out1: s.out1, out2: s.out2 };
          })(),
          // 2026-08-13 — display on/off windows + vendor recipes. Same
          // argument as `gpio` directly above: the emergency branch must
          // carry the same device state as the normal branch, or a screen
          // that flips into emergency mode would see a manifest with no
          // `display` block and could disarm its local blank/wake alarms —
          // and then stay dark past the incident. Memoised per screen
          // against the manifest content rev, so this costs one indexed
          // query per screen per minute at worst, not one per poll.
          display: await buildDisplayManifestBlock(
            this.prisma,
            {
              id: screen.id,
              tenantId: screen.tenantId ?? null,
              screenGroupId: (screen as any).screenGroupId ?? null,
              // 2026-08-25 — the LIVE verdict decides whether this screen's
              // windows ride the HARD or the SOFT schedule array. Read from the
              // screen row this poll already fetched; never from a cache.
              displayCapabilities: (screen as any).displayCapabilities ?? null,
            },
            manifestRevAtStart,
          ),
          playlists
        });
      }
    }

    // ─── VenueOS Sports — scoreboard push (PRECEDED by emergency) ───
    // If an operator pushed a live game to this screen, serve the
    // synthetic scoreboard manifest instead of the scheduled playlist.
    // This is reached ONLY when no emergency is active — the emergency
    // branch above already returned if one was — so an alert always
    // wins. A stale / cross-tenant game id is ignored and we fall
    // through to the normal scheduled-content path below.
    if (screen.tenantId && (screen as any).activeBoardGameId) {
      const boardGame = await this.prisma.client.game.findFirst({
        where: { id: (screen as any).activeBoardGameId, tenantId: screen.tenantId },
        select: { id: true },
      });
      if (boardGame) {
        // Same rule as the emergency branch: a live-score surface is built
        // from a row read on THIS request, never from the identity preamble
        // snapshot (2026-09-03, efficiency L1).
        screen = await this.readManifestScreenLive(id, screen);
        const boardPayload: Record<string, any> = {
          version: '1.0',
          screenId: id,
          tenantId: screen.tenantId,
          tenantName: (screen as any).tenant?.name || null,
          generatedAt: new Date().toISOString(),
          // 2026-05-24 — orientation lock for sports-mode screens too.
          orientation: resolveManifestOrientation((screen as any).orientation, (screen as any).resolution, (screen as any).hardwareModel),
          // 2026-06-24 — carry the LED canvas dims + tile-repeat on the
          // SCOREBOARD manifest too (the normal playlist branch already does).
          // Without these the player's TemplateScaler keeps a stale/empty
          // canvas and renders the board at the device resolution (1920) →
          // cut off on a narrow LED poster (960×1080). Pairs with the
          // canvas-aware synthetic-template sizing in buildScoreboardManifest.
          canvasW: (screen as any).canvasW ?? null,
          canvasH: (screen as any).canvasH ?? null,
          posterStandard: manifestPosterStandard((screen as any).tenant),
          repeats: (screen as any).repeats ?? 1,
          // 2026-05-27 — EP6N GPIO output state (status lamp / horn).
          // Same shape across every manifest branch.
          gpio: (() => {
            const s = readGpioState((screen as any).config);
            return { out1: s.out1, out2: s.out2 };
          })(),
          // 2026-08-13 — display on/off windows + vendor recipes, for the
          // same reason as `gpio` above: a board pushed to a screen must not
          // look like "no display schedule" and disarm its local alarms.
          // Part of the hashed board payload below (only `generatedAt` is
          // excluded), so a schedule edit busts this branch's ETag too.
          display: await buildDisplayManifestBlock(
            this.prisma,
            {
              id: screen.id,
              tenantId: screen.tenantId ?? null,
              screenGroupId: (screen as any).screenGroupId ?? null,
              // 2026-08-25 — the LIVE verdict decides whether this screen's
              // windows ride the HARD or the SOFT schedule array. Read from the
              // screen row this poll already fetched; never from a cache.
              displayCapabilities: (screen as any).displayCapabilities ?? null,
            },
            manifestRevAtStart,
          ),
          playlists: this.buildScoreboardManifest(
            screen,
            boardGame,
            (screen as any).activeBoardSurface,
          ),
        };
        // 2026-07-02 (efficiency #2 pre-req) — hash the WHOLE payload minus
        // the per-request timestamp, not just playlists. A playlists-only
        // hash 304s away orientation / canvas / gpio changes the moment a
        // client actually sends If-None-Match (which the player now does).
        const { generatedAt: _volatileBoardTs, ...hashableBoardPayload } = boardPayload;
        const boardHash = crypto
          .createHash('sha256')
          .update(JSON.stringify(hashableBoardPayload) + id)
          .digest('hex');
        res.setHeader('ETag', boardHash);
        if (activeDeviceHash === boardHash) {
          return res.status(304).send();
        }
        boardPayload['hash'] = boardHash;
        return res.status(200).json(boardPayload);
      }
    }

    // ─── Manifest content cache (Supabase egress diet — 2026-07-30) ───
    // Every early-return above (revoked, auth mismatch, EMERGENCY branch,
    // sports scoreboard) has already run, so a cache hit can only ever
    // serve the normal scheduled-content manifest. The screen row, the
    // per-screen override row and the tenant emergency state were still
    // read LIVE on this very poll; what a hit skips is the schedule→
    // playlist→items→asset→template→zones fan-out (~7 queries, ~100 KB DB
    // egress per poll — ~25 GB/mo at five always-on screens, the entire
    // July-2026 Supabase overage). Invalidation contract (see
    // manifest-hot-cache.ts): any content mutation via Prisma busts on the
    // next poll; scheduled go-lives/stops land on time via boundaryAt;
    // TTL bounds everything else. ETag semantics identical to a rebuild —
    // same hashable payload object, same sha256.
    const cachedManifest = getManifestCache(screen.id);
    if (cachedManifest) {
      if (cachedManifest.kind === 'empty') {
        return res.status(200).json(cachedManifest.body);
      }
      res.setHeader('ETag', cachedManifest.etag);
      if (activeDeviceHash === cachedManifest.etag) {
        return res.status(304).send();
      }
      return res.status(200).json({
        ...cachedManifest.hashablePayload,
        generatedAt: new Date().toISOString(),
        hash: cachedManifest.etag,
      });
    }

    const now = new Date();
    // SECURITY (multi-tenant isolation): a schedule targets exactly
    // ONE thing — a specific screen (screenId) or a group
    // (screenGroupId); schedule creation enforces one or the other.
    // The group clause must ONLY be added when this screen is actually
    // in a group: Prisma treats `{ screenGroupId: null }` as "match
    // every row whose screenGroupId IS NULL", and EVERY screen-pinned
    // schedule carries screenGroupId = null — so a groupless screen
    // matching `{ screenGroupId: screen.screenGroupId }` with a null
    // group would inherit every screen-pinned schedule, in EVERY
    // tenant (a freshly-added screen would auto-play another account's
    // content). The query is tenant-scoped too, as defense in depth.
    // ── Double-sided displays: whose schedules feed this face? ───────────
    //
    // A face in MIRROR mode resolves its PRIMARY's schedules, so a newly
    // added second side shows what the first side shows with zero operator
    // action ("sometimes the same"); an OWN face resolves its own ("at times
    // different"). `resolveFaceContentTarget` owns every rule and every
    // refusal — see screen-faces.ts.
    //
    // THE COST IS BOUNDED WHERE IT SHOULD BE. `needsPrimaryForContent` is
    // false for every ordinary screen, so the single-sided fleet pays ZERO
    // extra queries; and this block runs only on a cache MISS, never on a
    // served poll. The one extra read is a 3-column lookup on a primary key.
    //
    // LIFE-SAFETY: the EMERGENCY branch has already returned far above this
    // line, so no mirroring state — not even a corrupt one — can reach an
    // alert decision. Mirroring borrows exactly one thing, the schedule
    // target; the face keeps its own orientation, canvas, credential, render
    // proof and emergency resolution.
    let contentTarget = resolveFaceContentTarget(screen as any, null);
    if (needsPrimaryForContent(screen as any)) {
      let primaryRow: any = null;
      try {
        // ten-ok: FK sourced from the device's own authoritative Screen row
        // (self-scoped manifest read). The resolver independently re-checks
        // that this row really is THIS face's primary and shares its tenant
        // before inheriting anything from it — a manifest read must not
        // depend on a past write having been correct.
        primaryRow = await this.prisma.client.screen.findUnique({
          where: { id: (screen as any).faceOfScreenId as string },
          select: { id: true, tenantId: true, screenGroupId: true, faceOfScreenId: true },
        });
      } catch {
        // A pool blip must not blank a face. Falling through resolves the
        // face's OWN content, which is at worst the honest "waiting for
        // assignment" manifest — never another tenant's content.
        primaryRow = null;
      }
      contentTarget = resolveFaceContentTarget(screen as any, primaryRow);
    }

    const scheduleTargetOr: any[] = [{ screenId: contentTarget.screenId }];
    if (contentTarget.screenGroupId) {
      scheduleTargetOr.push({ screenGroupId: contentTarget.screenGroupId });
    }
    const schedulesUnordered = await this.prisma.client.schedule.findMany({
      where: {
        AND: [
          ...(screen.tenantId ? [{ tenantId: screen.tenantId }] : []),
          { OR: scheduleTargetOr },
          { startTime: { lte: now } },
          { OR: [{ endTime: { gte: now } }, { endTime: null }] },
          { isActive: true },
        ]
      },
      include: {
        playlist: {
          include: {
            // Sprint 1.5 approval gate (Issue #1). PENDING_APPROVAL
            // assets are silently dropped from the manifest so a
            // CONTRIBUTOR's submitted-but-not-yet-approved content
            // never reaches a screen. Approve flips the asset's status
            // PENDING_APPROVAL→PUBLISHED and the next manifest poll
            // includes it. All admin-uploaded assets land directly at
            // PUBLISHED so this is a strict tightening with no impact
            // on the existing admin-content flow.
            items: {
              where: { asset: { status: 'PUBLISHED' } },
              orderBy: { sequenceOrder: 'asc' },
              include: { asset: true },
            },
            template: {
              include: {
                zones: { orderBy: { sortOrder: 'asc' } },
                // 2026-05-14 — D2 touch-scenes were stored on the
                // Template but never INCLUDED in the manifest query,
                // so the player couldn't filter zones by sceneId or
                // handle goto-template touch actions. Same audit as
                // the isTouchEnabled / touchAction passthrough fix.
                scenes: { orderBy: { sortOrder: 'asc' } },
              },
            },
          }
        }
      }
    });

    // 2026-08-30 (reliability program W1-8) — deterministic manifest order.
    // The bag above has NO orderBy: row order was whatever the database
    // returned, per replica, per plan — and the player's old "any template
    // wins" rule turned that into the group-template-shadows-new-screen-
    // media stale-content path. The effective replace winner now rides
    // FIRST (screen-pin > group, priority desc, newest startTime, stable
    // id), append rows after; each mapped playlist below carries
    // `schedule.mode` + `schedule.pin` so the player can pick the first
    // window-open replace row instead of guessing.
    const schedules = orderSchedulesForManifest(schedulesUnordered as any) as typeof schedulesUnordered;

    // Next schedule boundary for THIS screen's targets: the earliest
    // future startTime (a scheduled go-live) or future endTime (an active
    // window expiring). The cached manifest must not outlive it — a
    // campaign scheduled for 3:00 must appear on the first poll after
    // 3:00 exactly like the uncached path did. Two 1-row indexed lookups,
    // and they only run on a REBUILD (cache miss), never on a hit.
    // (Fine-grained daysOfWeek/timeStart windows are evaluated player-side
    // from fields already in the payload — no server rebuild needed.)
    let nextScheduleBoundaryAt: number | null = null;
    try {
      const boundaryWhereBase: any = {
        AND: [
          ...(screen.tenantId ? [{ tenantId: screen.tenantId }] : []),
          { OR: scheduleTargetOr },
          { isActive: true },
        ],
      };
      const [nextStart, nextEnd] = await Promise.all([
        this.prisma.client.schedule.findFirst({
          where: { ...boundaryWhereBase, startTime: { gt: now } },
          orderBy: { startTime: 'asc' },
          select: { startTime: true },
        }),
        this.prisma.client.schedule.findFirst({
          where: { ...boundaryWhereBase, endTime: { gt: now } },
          orderBy: { endTime: 'asc' },
          select: { endTime: true },
        }),
      ]);
      const boundaryCandidates = [nextStart?.startTime, nextEnd?.endTime]
        .filter((d): d is Date => !!d)
        .map((d) => new Date(d).getTime())
        .filter((t) => Number.isFinite(t));
      if (boundaryCandidates.length) nextScheduleBoundaryAt = Math.min(...boundaryCandidates);
    } catch {
      // Boundary probe failed (transient DB blip) — cache only briefly so
      // a pending go-live can't be missed for long.
      nextScheduleBoundaryAt = Date.now() + 60_000;
    }

    // 2026-09-02 — the SAME boundary the manifest hot cache uses now also
    // moves the emergency revision, so a 15:00 go-live reaches the player
    // within one revision poll (≤10 s) instead of waiting out the reconcile.
    // Merged (earliest wins) with any override expiry recorded above.
    try {
      noteScreenScheduleBoundary(screen.id, nextScheduleBoundaryAt);
    } catch {
      /* bookkeeping must never fail a manifest poll */
    }

    // Built OUTSIDE the payload literals so the `await` is obvious in review,
    // and hoisted above the empty-manifest branch so BOTH bodies carry it: a
    // screen with no playlist assigned still has to blank at 22:00 and wake
    // at 07:00. Memoised per screen against the manifest content rev, so a
    // schedule edit shows up on the next poll while a steady fleet pays one
    // indexed query per screen per minute at worst.
    const displayBlock = await buildDisplayManifestBlock(
      this.prisma,
      {
        id: screen.id,
        tenantId: screen.tenantId ?? null,
        screenGroupId: (screen as any).screenGroupId ?? null,
        // 2026-08-25 — the LIVE verdict decides whether this screen's
        // windows ride the HARD or the SOFT schedule array. Read from the
        // screen row this poll already fetched; never from a cache.
        displayCapabilities: (screen as any).displayCapabilities ?? null,
      },
      manifestRevAtStart,
    );

    if (!schedules.length) {
      // 200 with empty playlists — NOT 404. A paired screen with no
      // scheduled content is a valid "waiting for assignment" state,
      // not a connection failure. Previously the player saw 404 and
      // displayed 'Unable to Connect' which looked identical to a
      // real network/auth error — admin had no way to tell the
      // difference.
      const emptyBody = {
        screenId: screen.id,
        tenantId: screen.tenantId,
        tenantName: (screen as any).tenant?.name || null,
        playlists: [],
        // 2026-05-26 P0-2 — be explicit about no-emergency so the
        // player's manifest handler can clear any stale local state
        // without needing to infer from absence-of-fields.
        isEmergency: false,
        emergencyStatus: 'INACTIVE',
        emptyReason: 'NO_SCHEDULE',
        message: 'This screen is paired but no playlist is scheduled. Assign a playlist from the dashboard.',
        // ⚠️ 2026-08-24 — SCREEN IDENTITY MUST RIDE THE EMPTY BODY TOO.
        //
        // THE BUG THIS FIXES. This branch omitted `orientation`, so a paired
        // screen with no schedule received a manifest with NO orientation
        // field. The player gates on
        //   `orient === 'LANDSCAPE' || 'PORTRAIT' || 'AUTO'`
        // and `undefined` fails all three, so it never called setOrientation
        // AND never set `manifestOrientation` — which also disarms the CSS
        // rotate fallback, since that is keyed on the value being 'PORTRAIT'.
        // Net effect: a brand-new screen sat at whatever the ROM defaulted to,
        // and NOTHING the server did could move it. Two 2160×3840 portrait
        // panels rendered landscape for hours while three separate server-side
        // orientation fixes were deployed — every one of them wrote a value
        // that never reached the wire. Confirmed by fetching the live
        // manifest: `orientation=undefined` on both, `"LANDSCAPE"` on the one
        // screen that HAD content and therefore took the full-body path.
        //
        // This is the same reasoning already written above for `display`
        // ("no content scheduled is NOT no display schedule") — a screen
        // waiting for an assignment still has to be the right way up, on the
        // right canvas, and know its own hardware. The splash is a real
        // rendering surface, not a placeholder.
        //
        // All four are stable Screen columns — no clock, no per-request value
        // — so the verbatim-replayed cache stays hash-stable.
        orientation: resolveManifestOrientation((screen as any).orientation, (screen as any).resolution, (screen as any).hardwareModel),
        canvasW: (screen as any).canvasW ?? null,
        canvasH: (screen as any).canvasH ?? null,
        // 2026-09-01 — the tenant's standard LED poster size; the player's
        // poster-canvas rule reads it (see manifestPosterStandard).
        posterStandard: manifestPosterStandard((screen as any).tenant),
        repeats: (screen as any).repeats ?? 1,
        hardwareModel: (screen as any).hardwareModel ?? null,
        // 2026-08-30 (reliability W1-11) — durable REFRESH_WEB. A stable
        // column value (not a clock): set by the wedge detector, cleared on
        // the next render-proof, so the cached body stays hash-stable
        // between command edges and the ETag busts exactly when a command
        // must reach a polling-only screen.
        refreshRequestedAt: (screen as any).pendingRefreshAt
          ? new Date((screen as any).pendingRefreshAt).getTime()
          : null,
        // 2026-08-13 — "no content scheduled" is NOT "no display schedule".
        // A screen waiting for an assignment must still power its panel
        // down overnight, so the display block rides this body too. It is
        // part of the verbatim-replayed cached body, and DisplaySchedule is
        // in MANIFEST_FED_MODELS, so an edit busts the entry.
        display: displayBlock,
        // Same contract as the full body above: a face waiting for an
        // assignment is still a face, and the splash is a real rendering
        // surface (2026-08-24). Absent on every ordinary screen.
        ...(isFaceScreen(screen as any)
          ? {
              face: {
                index: (screen as any).faceIndex ?? 1,
                label: faceLabel((screen as any).faceIndex as number | null),
                contentMode: faceContentMode(screen as any),
                mirroredFrom: contentTarget.mirroredFromScreenId,
              },
            }
          : {}),
        hash: 'empty',
      };
      // Fully static body — cache and replay verbatim until content
      // changes or the next schedule boundary (an upcoming go-live is
      // exactly the transition that turns this empty manifest non-empty).
      setManifestCache(
        screen.id,
        { kind: 'empty', body: emptyBody, boundaryAt: nextScheduleBoundaryAt },
        manifestRevAtStart,
      );
      return res.status(200).json(emptyBody);
    }

    // Sum item file sizes per playlist so the player can show operators
    // how much disk a playlist uses from the Stopped splash. Items with
    // no captured fileSize (e.g. URL-type assets, pre-hash uploads)
    // simply contribute 0.
    const dynamicPlaylists = schedules.map(s => {
    // 2026-05-05 — schedule-level audio override.
    // Null = honor each PlaylistItem.muted (current behavior).
    // True = force every video on this schedule muted.
    // False = force every video unmuted.
    // Lets one playlist publish to lobby muted + cafeteria with
    // sound from the same source content.
    const scheduleMute = (s as any).mutedOverride;
    return ({
      id: s.playlistId,
      // Name + schedule metadata — lets the player surface "what's
      // loaded and when it plays" without a separate API round-trip.
      // Operator-facing fields, not load-bearing for playback, so
      // omitting any of them is safe.
      name: s.playlist.name,
      schedule: {
        daysOfWeek: s.daysOfWeek || null,  // "Mon,Tue,Wed,Thu,Fri" or null
        timeStart: s.timeStart || null,    // "08:00" or null
        timeEnd: s.timeEnd || null,        // "15:00" or null
        mutedOverride: scheduleMute ?? null, // operator-facing
        // 2026-08-30 (reliability W1-8) — the player's effective-content
        // selection keys on these: first window-open replace row wins,
        // append rows only contribute items. Older players ignore them.
        mode: (s as any).mode ?? 'replace',
        pin: s.screenId ? 'screen' : 'group',
        priority: s.priority ?? 0,
      },
      totalBytes: s.playlist.items.reduce(
        (sum, pi) => sum + (pi.asset.fileSize || 0),
        0,
      ),
      // Include template data when playlist is template-based
      ...(s.playlist.template ? {
        template: {
          id: s.playlist.template.id,
          name: s.playlist.template.name,
          screenWidth: s.playlist.template.screenWidth,
          screenHeight: s.playlist.template.screenHeight,
          bgColor: s.playlist.template.bgColor,
          bgGradient: s.playlist.template.bgGradient,
          bgImage: s.playlist.template.bgImage,
          // 2026-05-14 — operator: "i created a touch template and
          // everytime i tap the screen this menu pops up, something
          // is very broken in our touch workflow". Root cause was
          // here: isTouchEnabled + idleResetMs were stored on the
          // Template row but NEVER serialized into the manifest
          // payload, so the player's `playlist.template.isTouchEnabled`
          // read as undefined → falsy → the canvas onClick fell back
          // to the operator-info overlay toggle instead of letting
          // taps reach the touch widgets. Wiring them in here is the
          // whole fix.
          isTouchEnabled: !!(s.playlist.template as any).isTouchEnabled,
          idleResetMs: (s.playlist.template as any).idleResetMs ?? undefined,
          zones: s.playlist.template.zones.map(z => ({
            id: z.id,
            name: z.name,
            widgetType: z.widgetType,
            x: z.x,
            y: z.y,
            width: z.width,
            height: z.height,
            zIndex: z.zIndex,
            sortOrder: z.sortOrder,
            // Surface touchAction on each zone too — D1 phase added
            // per-zone tap dispatchers. Same audit miss as above:
            // the field existed in the DB + builder but never made
            // it through the manifest serializer.
            touchAction: (z as any).touchAction ?? null,
            // sceneId from D2 touch-scene support. Player groups
            // zones by sceneId for the active-scene render filter.
            sceneId: (z as any).sceneId ?? null,
            defaultConfig: z.defaultConfig ? JSON.parse(z.defaultConfig) : null,
          })),
          // Scene metadata for D2 touch-navigation. Empty array for
          // non-multi-scene templates.
          scenes: Array.isArray((s.playlist.template as any).scenes)
            ? (s.playlist.template as any).scenes
            : [],
        },
      } : {}),
      items: s.playlist.items.map(pi => ({
        item_id: pi.id,
        asset_id: pi.assetId,
        asset_hash: pi.asset.fileHash ?? null,
        url: pi.asset.fileUrl,
        duration_ms: pi.durationMs,
        sequence: pi.sequenceOrder,
        // Surface mimeType so the player knows whether to render the
        // item as <video>, <img>, or <iframe>. Without this the player
        // had to guess from the URL extension (`/\.(mp4|webm)$/i`),
        // which breaks for URL assets (text/html — no extension match
        // → silently rendered as a broken <img>) and PDF assets.
        // The Asset row always has a real mimeType set: 'text/html'
        // for URL assets via /assets/url, 'application/pdf' for PDFs,
        // 'video/*' or 'image/*' for uploads.
        mime_type: pi.asset.mimeType ?? null,
        transition_type: pi.transitionType ?? null,
        // 2026-05-05 — final muted resolution.
        // Precedence: schedule.mutedOverride > item.muted > true.
        // Operator can publish the SAME playlist to two screens with
        // different audio settings by flipping mutedOverride at the
        // schedule level — no per-item edits required.
        muted: typeof scheduleMute === 'boolean'
          ? scheduleMute
          : ((pi as any).muted ?? true),
      }))
    });
    });

    // 2026-08-30 (reliability W1-7 / audit P0-4) — content revision. The
    // player's template apply-signature used to be just `tpl:<id|name>`, so
    // editing zones/config/scenes/colors under the SAME template id never
    // re-applied until a full page reload (the manifest ETag changed, the
    // body shipped, and the player refused to act on it). `contentRev` is a
    // pure hash of the exact render-affecting subtree served below —
    // deterministic for identical content, so it cannot destabilize the
    // ETag; the player folds it into the signature (`tpl:<id>:<rev>`).
    for (const pl of dynamicPlaylists as any[]) {
      pl.contentRev = crypto
        .createHash('sha1')
        .update(JSON.stringify({ t: pl.template ?? null, i: pl.items }))
        .digest('hex')
        .slice(0, 12);
    }

    const manifestPayload: Record<string, any> = {
      version: "1.0",
      screenId: id,
      tenantId: screen.tenantId,
      tenantName: (screen as any).tenant?.name || null,
      generatedAt: now.toISOString(),
      // 2026-05-26 P0-2 — explicit no-emergency signal so the player
      // can confidently clear any stale local emergency state without
      // inferring from absence-of-fields. The "isEmergency: true" branch
      // above (line ~2277) returns early; reaching this normal-manifest
      // path means there's definitively no emergency.
      isEmergency: false,
      // 2026-05-24 — operator-controlled orientation lock. Player APK
      // applies on boot and on every manifest poll (cheap setter — only
      // calls setRequestedOrientation if the value changed). Older APKs
      // (no orientation field expected) ignore unknown fields.
      orientation: resolveManifestOrientation((screen as any).orientation, (screen as any).resolution, (screen as any).hardwareModel),
      // 2026-05-26 — LED canvas dimensions for narrow-chain panels.
      // Null = use controller's native viewport. Player reads these
      // on every manifest poll and applies via document.documentElement
      // CSS vars + reloads splash. Operator sets via dashboard
      // /screens UI; signed WS broadcast (CANVAS_CHANGE) also pushes
      // the new value within ~150ms of the operator's tap.
      canvasW: (screen as any).canvasW ?? null,
      canvasH: (screen as any).canvasH ?? null,
      // 2026-05-26 — content tile-repeat count for ribbons. Default 1
      // = no tiling. > 1 = player wraps content in flex grid with N
      // children, each rendering same template at canvasW/repeats.
      // Operator's 40ft × 1m ribbon with repeats=4: each 10ft segment
      // gets the same score / sponsor / celebration. Viewing angle
      // problem solved (no one's far from a visible repeat).
      repeats: (screen as any).repeats ?? 1,
      // 2026-05-27 — Goodview EP6N hardware state surfaced to the player.
      //   gpio   — current OUT pin state (Agent C). Player applies
      //            out1 / out2 to the Phoenix terminal's relay outputs.
      //   wiring — operator-set serial / RS485 / GPIO mappings (Agent B).
      //            CtsBridge reads wiring.rs232_1 / rs232_2 to route
      //            CTS vs Stream Deck vs aux-debug.
      // Older hardware models (Taurus / Pi5 / generic Android / web)
      // ignore unknown manifest fields. Defaults: gpio out=low,
      // wiring=null (CtsBridge treats null as the legacy single-port
      // path — backward compatible).
      gpio: (() => {
        const s = readGpioState((screen as any).config);
        return { out1: s.out1, out2: s.out2 };
      })(),
      wiring: ((screen as any).config && typeof (screen as any).config === 'object'
        && !Array.isArray((screen as any).config)
        && (screen as any).config.wiring
        && typeof (screen as any).config.wiring === 'object')
        ? (screen as any).config.wiring
        : null,
      // 2026-06-01 — which scoreboard console drives this screen, from
      // Screen.config.consoleProfile. CtsBridge reads it to pick the
      // serial settings + default tty (Gen 6/Daktronics → native ttyS1;
      // WTTC → USB-serial ttyUSB0) + decoder. Null = CtsBridge default
      // ('cts-gen6'), so existing installs are unchanged. Older APKs
      // ignore unknown manifest keys.
      consoleProfile: ((screen as any).config && typeof (screen as any).config === 'object'
        && !Array.isArray((screen as any).config)
        && typeof (screen as any).config.consoleProfile === 'string')
        ? (screen as any).config.consoleProfile
        : null,
      // 2026-05-27 — surface the chosen hardware model so the player /
      // KioskSplash can gate hardware-specific UI:
      //  - Suppresses the "LED canvas not set" banner on LCD-driven
      //    boxes (goodview-ep6n, pi5, generic-android, web) where the
      //    daisy-chained-panels math doesn't apply.
      //  - Drives the per-model integration affordances (dual RS232 on
      //    EP6N, no GPIO on Taurus, etc).
      // Older APKs ignore unknown manifest keys, so this is safe to
      // ship without a player-side migration.
      hardwareModel: (screen as any).hardwareModel ?? null,
      // 2026-08-30 (reliability W1-11) — durable REFRESH_WEB; same contract
      // as the empty-body copy above (stable column value, ETag busts on
      // command edges only). Older players ignore unknown manifest keys.
      refreshRequestedAt: (screen as any).pendingRefreshAt
        ? new Date((screen as any).pendingRefreshAt).getTime()
        : null,
      // ── Double-sided displays (2026-09-16) ─────────────────────────────
      // Emitted ONLY on a face's own manifest. Every ordinary screen's
      // payload — and therefore its ETag — stays byte-for-byte what it was
      // before this feature existed, so shipping it busts no 304s fleet-wide.
      //
      // `mirroredFrom` is the diagnostic that earns its place: an operator
      // looking at a back panel showing the "wrong" thing must be able to
      // SEE that it is mirroring the front rather than infer it. Every field
      // is a stable column value — no clock, nothing per-request — so the
      // hashed payload keeps its no-volatile-fields invariant.
      ...(isFaceScreen(screen as any)
        ? {
            face: {
              index: (screen as any).faceIndex ?? 1,
              label: faceLabel((screen as any).faceIndex as number | null),
              contentMode: faceContentMode(screen as any),
              mirroredFrom: contentTarget.mirroredFromScreenId,
            },
          }
        : {}),
      // 2026-07-28 — frame-locked multi-screen sync config
      // (docs/research/2026-07-28-multiscreen-sync/00-DESIGN.md §7).
      //
      // 2026-09-16 — the COHORT moved from the screen group to the PLAYLIST
      // (docs/research/2026-09-16-sync-to-playlists-build/). Operator: "if i
      // have different playlists assigned to screens in the same group it
      // doesnt make sense saying to keep them in sync". `resolveScreenSync`
      // owns the whole rule — ANY playlist scheduled onto this screen with
      // syncPlayback on, OR the legacy group flag — and screen-sync.ts states
      // why it is ANY rather than ALL, and why the legacy arm is what makes
      // this deploy safe for the groups that are locked today.
      //
      // THE BLOCK SHAPE IS UNCHANGED, deliberately: every deployed player
      // reads {enabled, groupId, trimMs}, so this needs no player migration
      // and the frame-lock invariant is untouched.
      //
      // trimMs ⟵ Screen.syncOffsetMs (per-screen display-latency trim).
      // Older players ignore unknown manifest keys (same contract as
      // hardwareModel/gpio above). Deliberately part of the hashed payload:
      // turning a playlist's sync on or nudging the trim busts the ETag so
      // screens pick it up on their next poll (Playlist is already a
      // manifest-fed model, so the write busts the hot cache with no new
      // wiring). No volatile clock field here — players sample the clock via
      // WS TIME_PING or GET /realtime/time, never the manifest (breaks 304s).
      sync: (() => {
        const g: any = (screen as any).screenGroup;
        const resolved = resolveScreenSync({
          groupSyncMode: g?.syncMode ?? null,
          // `schedules` is this screen's live set (active, started, unexpired)
          // — the same rows the playlists below are built from, already read.
          scheduledPlaylistSync: schedules.map((s: any) => s?.playlist?.syncPlayback),
        });
        if (!resolved.enabled) return { enabled: false };
        return {
          enabled: true,
          // Kept for the player's log line and for backward compatibility; it
          // has never fed any sync math (01-SYNC-CODE-MAP.md §2). Null when a
          // playlist locks an ungrouped screen — a case the group flag could
          // not express at all.
          groupId: g?.id ?? null,
          trimMs: (screen as any).syncOffsetMs ?? 0,
        };
      })(),
      // 2026-08-13 — display control: the on/off windows the player arms as
      // LOCAL AlarmManager alarms (network-independent by design) plus the
      // vendor-recipe catalog it matches against its own Build.* identity.
      //
      // Deliberately part of the hashed payload — editing a schedule must
      // bust the ETag so screens pick it up on their next poll. EVERY FIELD
      // IS STABLE: no clock value, no "ms until next off", nothing derived
      // from Screen.displayCapabilities (which is telemetry-only and must
      // never move this hash). Read display-manifest.ts's header before
      // adding a field here — the same rule that governs `sync` above.
      display: displayBlock,
      playlists: dynamicPlaylists
    };

    // 2026-07-02 (efficiency #2 pre-req) — the hash MUST cover every field
    // applyManifest consumes (isEmergency, orientation, canvasW/H, repeats,
    // gpio, wiring, consoleProfile, hardwareModel, playlists…), minus the
    // per-request generatedAt timestamp. The old playlists-only hash was
    // harmless while no client sent If-None-Match, but the player now does —
    // and a 304 computed from playlists alone would suppress the emergency
    // ALL-CLEAR (isEmergency:false) on the HTTP polling backstop. (The
    // emergency-ACTIVE branch above always returns a full 200 with no ETag,
    // so triggering is never suppressed; the client clears its stored ETag
    // on any 200 without one.)
    const { generatedAt: _volatileTs, ...hashablePayload } = manifestPayload;
    const signatureString = JSON.stringify(hashablePayload) + id;
    const versionHash = crypto.createHash('sha256').update(signatureString).digest('hex');
    // Store the freshly-built manifest for subsequent polls (see the cache
    // block above the fan-out). hashablePayload is exactly what the ETag
    // covers, so cached serves are hash-stable with rebuilds.
    setManifestCache(
      screen.id,
      { kind: 'full', hashablePayload, etag: versionHash, boundaryAt: nextScheduleBoundaryAt },
      manifestRevAtStart,
    );
    res.setHeader('ETag', versionHash);

    if (activeDeviceHash === versionHash) {
      return res.status(304).send();
    }

    manifestPayload['hash'] = versionHash;
    return res.status(200).json(manifestPayload);
  }

  // ─── Admin: per-screen cache readiness report ───
  // Surfaces in the dashboard so admins can verify each screen has actually
  // pre-cached the emergency assets. The screen reports back via
  // POST /:id/cache-status; we just read what was last reported.
  @Get(':id/cache-status')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async getCacheStatus(@Param('id') id: string, @Request() req: any) {
    const screen = await this.prisma.client.screen.findFirst({
      where: { id, tenantId: req.user.tenantId },
      select: { id: true, name: true, lastCacheReport: true, lastCacheReportAt: true },
    });
    if (!screen) throw new HttpException({ code: 'SCREEN_NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);

    const report = (screen.lastCacheReport as any) || null;
    return {
      screenId: screen.id,
      screenName: screen.name,
      reportedAt: screen.lastCacheReportAt,
      report,
      // Compute "all emergency assets cached?" against the current emergency
      // asset set so the dashboard can show a green check or red warning.
      emergencyReady: !!(report && report.emergency && report.emergency.count > 0),
    };
  }

  // The player POSTs a small status payload here ~every 30s so admins can
  // see which screens are actually serving offline.
  //
  // sec-fix(wave1) #5: now requires a device JWT whose `sub` equals the
  // screenId. Without this, any unauthenticated client could spoof
  // "offline" or "emergency cached" statuses for any screen in the fleet
  // and cripple the admin dashboard's ability to detect real outages.
  @Post(':id/cache-status')
  async reportCacheStatus(
    @Param('id') id: string,
    @Req() req: ExpressReq,
    @Body() body: { playlist?: { count: number; bytes: number }; emergency?: { count: number; bytes: number } },
  ) {
    // SEC-001 — prior behaviour, stated. An unpaired screen still reports its
    // cache state (the pairing splash's ONLINE dot); an unproven one cannot,
    // because a spoofable health channel masks a dead life-safety screen.
    const authResult = await this.deviceAuth(req, id, { allowUnpaired: true });
    if (!authResult.ok) {
      throw new HttpException({ code: 'SCREEN_DEVICE_AUTH_REQUIRED', message: `Device auth required (${authResult.reason})` }, HttpStatus.UNAUTHORIZED);
    }
    // DB-efficiency (2026-06-15): coalesce the every-30s identical cache report.
    // Same payload within 120s → no DB at all (was ~42% of total DB time). A
    // content change or the 120s window elapsing writes through; the 5-min
    // wedge detector tolerates the gap.
    const sig = JSON.stringify(body ?? {});
    if (shouldSkipCacheReportWrite(id, sig)) return { ok: true };
    // ten-ok: identity-derived — `deviceAuth(req, id)` above proved the
    // credential names THIS screen, and `allowUnpaired` means a pre-claim
    // screen (tenantId null) legitimately reports here.
    const screen = await this.prisma.client.screen.findUnique({ where: { id }, select: { id: true } });
    if (!screen) throw new HttpException({ code: 'SCREEN_NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);
    await withDbRetry(() =>
      // ten-ok: same device-proved screen id as the read above; the write is
      // confined to that row's own cache-report telemetry columns.
      this.prisma.client.screen.update({
        where: { id },
        data: {
          lastCacheReport: body as any,
          lastCacheReportAt: new Date(),
        },
        // Fire-and-forget telemetry — don't RETURNING the whole 88-column row.
        select: { id: true },
      }),
    );
    markCacheReportWritten(id, sig);
    return { ok: true };
  }

  // ─── PUBLIC: Render-proof heartbeat (proof-of-display) ───────────────
  // Closes the #1 player-reliability gap: a frozen kiosk still answers TCP
  // reads, so lastPingAt stays fresh and the fleet map shows it ONLINE/green
  // while it's actually showing a stuck / black frame.
  //
  // The player advances a requestAnimationFrame-driven paint counter that
  // ONLY increments when the browser/WebView actually composites a frame
  // (rAF callbacks are suppressed when the renderer is frozen, the tab is
  // hidden, or the compositor is wedged) and POSTs it here every ~30s WHILE
  // it is rendering content. We record lastRenderedAt (server clock) so the
  // fleet list (deriveRenderHealth) can flag the screen render-STALE/RED when
  // this timestamp goes stale EVEN IF lastPingAt is fresh.
  //
  // Auth: device JWT bound to this screenId (or the short-lived HMAC fallback)
  // — IDENTICAL to /cache-status. Without this, any unauthenticated client
  // could spoof a fresh render-proof and mask a real freeze for any screen in
  // the fleet, defeating the whole point of the signal.
  //
  // Strictly additive + safe: this is a NEW endpoint + 3 NEW nullable columns.
  // It touches NOTHING about lastPingAt, status, the emergency path, or the
  // manifest. It does NOT update lastPingAt (so it can never paper over a real
  // network outage) and is best-effort from the player's side — if it never
  // POSTs, the screen reads renderHealth UNKNOWN, never falsely RED.
  //
  // Body shape (all optional):
  //   { frames?: number,    // monotonic painted-frame counter (forensics/liveness delta)
  //     hash?: string,      // short signature of the content on screen (proof-of-display)
  //     contentKind?: string, // 'template' | 'video' | 'image' | 'emergency' | 'url' (diagnostics)
  //     bundleSha?: string }  // commit SHA of the PAGE BUNDLE the player is running
  //
  // 2026-08-25 — `bundleSha` closes the "the dashboard lied to me" gap. A
  // player fix ships in the WEB bundle and each panel picks it up on its own
  // schedule (bundle-drift detector, deferred while content plays), so
  // freshly-fixed code is indistinguishable from a dead button until the
  // reload lands. Nothing in telemetry recorded WHICH bundle a panel was on,
  // so the only way to reason about it was to infer panel state from deploy
  // timestamps. It rides THIS post — already device-authed, already ~every
  // 30s, already the "what is this panel actually doing" channel — rather
  // than a new endpoint or (forbidden) a manifest field.
  @Post(':id/render-proof')
  // 2026-07-25 — was `limit: 10`, which SILENTLY KILLED proof-of-display at every
  // multi-screen site. The throttler's default tracker keys on the client's
  // public IP, and a venue's whole fleet shares one NAT address; each screen
  // POSTs ~2/min, so any site with >=6 screens blew a 10/min cap and got 429s.
  // The bigger the fleet, the more certainly its render health went blind —
  // exactly backwards. Sized for a ~300-screen site (600/min ≈ 10 rps from one
  // IP) so it still bounds an accidental flood.
  //
  // The RIGHT fix is a per-device tracker (this route is device-authenticated
  // and carries the screen id in the path). That is systemic — EVERY per-route
  // @Throttle in the app is IP-keyed, so every limit is per-SITE not per-device.
  // Tracked in docs/research/2026-07-25-launch-readiness-audit/00-AUDIT.md.
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  async reportRenderProof(
    @Param('id') id: string,
    @Req() req: ExpressReq,
    @Body() body: {
      frames?: number;
      hash?: string;
      contentKind?: string;
      /** Commit SHA of the page bundle the player is running (2026-08-25). */
      bundleSha?: string;
      // 2026-07-28 — frame-locked sync telemetry (optional; only sent
      // while the screen's group has syncMode='locked'). Stored on
      // Screen.lastSyncReport for the dashboard's "IN SYNC ±Xms" badge.
      sync?: {
        locked?: boolean;
        errMs?: number | null;
        clockUncertaintyMs?: number | null;
        rttMs?: number | null;
        contentSig?: string | null;
        renderLeadMs?: number | null;
        skewPpm?: number | null;
      };
      /** 2026-08-30 — durable-REFRESH ack: the exact `refreshRequestedAt`
       *  value (ms) this page has acted on. Value identity, never a clock
       *  comparison. */
      refreshAckMs?: number;
    },
  ) {
    // SEC-001 — prior behaviour, stated. Render proof is the fleet's claim
    // that content is on the glass; an unproven credential must never be
    // able to make it, or a screen nobody can authenticate reports healthy.
    const authResult = await this.deviceAuth(req, id, { allowUnpaired: true });
    if (!authResult.ok) {
      throw new HttpException({ code: 'SCREEN_DEVICE_AUTH_REQUIRED', message: `Device auth required (${authResult.reason})` }, HttpStatus.UNAUTHORIZED);
    }
    // Page-bundle SHA (2026-08-25). Sanitized with the same hostile-device
    // posture as everything else on this route, and normalized by exactly
    // the rule both web-side copies use (apps/web/src/app/player/bundleSha.ts
    // and components/screens/bundleSkew.ts): a single bounded token,
    // lowercased, truncated to the 12-char short form /api/build-info and the
    // drift detector compare on. Bounded rather than hex-only on purpose —
    // the same rule gates the player's auto-reload, so narrowing it to "looks
    // like a git SHA" would switch that off for self-hosted builds that stamp
    // a tag or build number. What it DOES reject is what matters downstream:
    // whitespace, markup, path separators, and anything long enough to bloat
    // the row. A value that fails is dropped to null — "unknown", which the
    // dashboard renders as NOTHING, never a false alarm.
    const rawBundleSha =
      typeof body?.bundleSha === 'string' ? body.bundleSha.trim() : '';
    const bundleSha =
      rawBundleSha && /^[A-Za-z0-9._-]{1,64}$/.test(rawBundleSha)
        ? rawBundleSha.toLowerCase().slice(0, 12)
        : null;

    // DB-efficiency (2026-06-15): coalesce the every-30s render-proof write to
    // ≤1 per 40s (was ~17% of total DB time). lastRenderedAt stays < ~60s old
    // so a healthy screen never false-REDs (STALE window is 90s); a real freeze
    // stops the POSTs entirely, so this never masks one.
    //
    // The SHA is passed so a CHANGED bundle writes through immediately — a
    // panel that just reloaded onto the fix must stop reading "out of date"
    // on the dashboard at once, not up to 40s later.
    if (shouldSkipRenderProofWrite(id, bundleSha ?? '')) return { ok: true };
    // ten-ok: identity-derived — `deviceAuth(req, id)` above proved the
    // credential names THIS screen. `tenantId` is selected so the refresh-ack
    // timeline row can be written against the SCREEN's own tenant, not a
    // caller's; there is no caller tenant on a device route.
    const screen = await this.prisma.client.screen.findUnique({
      where: { id },
      // tenantId is read for the ack timeline row below — same row, no
      // extra round trip.
      select: { id: true, tenantId: true, pendingRefreshAt: true },
    });
    if (!screen) throw new HttpException({ code: 'SCREEN_NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);

    // 2026-08-30 (reliability W1-11) — durable-REFRESH acknowledgment. The
    // player echoes the exact `refreshRequestedAt` VALUE it acted on
    // (value identity, deliberately no clock comparison — Android signage
    // boxes routinely run minutes of skew and a timestamp inequality would
    // reload-loop them). Matching ack → command completed → clear the flag
    // (which also re-stabilizes the manifest ETag).
    const refreshAckMs =
      typeof body?.refreshAckMs === 'number' && Number.isFinite(body.refreshAckMs)
        ? Math.floor(body.refreshAckMs)
        : null;
    const clearPendingRefresh =
      refreshAckMs !== null &&
      (screen as any).pendingRefreshAt !== null &&
      new Date((screen as any).pendingRefreshAt).getTime() === refreshAckMs;

    // Sanitize: clamp the frame counter to a sane non-negative int and cap
    // the content hash so a misbehaving / hostile device can't bloat the row.
    const frames =
      typeof body?.frames === 'number' && Number.isFinite(body.frames) && body.frames >= 0
        ? Math.min(Math.floor(body.frames), Number.MAX_SAFE_INTEGER)
        : null;
    const hash = body?.hash ? String(body.hash).slice(0, 128) : null;

    // Frame-locked sync telemetry — sanitize with the same hostile-device
    // posture as frames/hash: every number clamped, every string sliced,
    // whole object rebuilt (never store the raw client payload).
    let syncReport: Record<string, unknown> | null = null;
    if (body?.sync && typeof body.sync === 'object') {
      const s: any = body.sync;
      const num = (v: unknown, lo: number, hi: number): number | null =>
        typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : null;
      syncReport = {
        locked: s.locked === true,
        errMs: num(s.errMs, 0, 60_000),
        clockUncertaintyMs: num(s.clockUncertaintyMs, 0, 600_000),
        rttMs: num(s.rttMs, 0, 60_000),
        contentSig: s.contentSig ? String(s.contentSig).slice(0, 32) : null,
        // Tier-1 self-calibration readouts (2026-07-28).
        renderLeadMs: num(s.renderLeadMs, 0, 1_000),
        skewPpm: num(s.skewPpm, -500, 500),
      };
    }

    await withDbRetry(() =>
      // ten-ok: same device-proved screen id as the read above; the write is
      // confined to that row's own render-proof telemetry columns.
      this.prisma.client.screen.update({
      where: { id },
      data: {
        lastRenderedAt: new Date(),
        ...(frames != null ? { lastRenderedFrames: frames } : {}),
        ...(hash != null ? { lastRenderedHash: hash } : {}),
        ...(bundleSha != null
          ? { lastBundleSha: bundleSha, lastBundleShaAt: new Date() }
          : {}),
        ...(syncReport ? { lastSyncReport: syncReport, lastSyncReportAt: new Date() } : {}),
        ...(clearPendingRefresh ? { pendingRefreshAt: null } : {}),
      } as any,
      // Fire-and-forget telemetry — don't RETURNING the whole 88-column row.
      select: { id: true },
      }),
    );
    // The ack is the ONLY moment we can prove a refresh command completed —
    // there is no persisted ack column, the clear IS the ack — so record it
    // on the timeline before the evidence is gone. Written only on the
    // value-match clear, never on an ordinary render proof. Best-effort:
    // the command has already completed, and a failed row must not turn a
    // successful ack into a 500 that makes the player retry forever.
    if (clearPendingRefresh && screen.tenantId) {
      try {
        await this.prisma.client.screenEvent.create({
          data: {
            screenId: id,
            tenantId: screen.tenantId,
            kind: 'refresh-acked',
            detail: { valueMs: refreshAckMs },
          },
        });
      } catch { /* timeline best-effort */ }
    }
    markRenderProofWritten(id, bundleSha ?? '');
    return { ok: true };
  }

  // ─── PUBLIC: Emergency assets list (for offline pre-cache) ───
  // The player calls this on startup AND after every successful manifest sync
  // to keep its `emergency-assets` Service-Worker cache tier hot. The cache
  // tier is NEVER evicted, so when an emergency fires the player can serve
  // every asset from local disk in under a second — no network required.
  //
  // Returns assets across all 4 panic-type playlists configured on the
  // tenant (lockdown / evacuate / weather / emergency-default), each with a
  // SHA-256 hash so the SW can detect tampered or stale files and re-download.
  @Get(':id/emergency-assets')
  async getEmergencyAssets(@Param('id') id: string, @Req() req: ExpressReq) {
    // sec-fix(wave1) #4: this endpoint previously had NO auth — any
    // unauthenticated caller could enumerate emergency media URLs for
    // any screen in any tenant. Now requires a device JWT bound to the
    // screenId (or the short-lived HMAC fallback for backward compat).
    // Every successful fetch is audit-logged so we can forensically
    // answer "who asked for the lockdown video set, and when?"
    // SEC-001 — prior behaviour, stated. An unproven credential is refused:
    // this route enumerates every emergency media URL for the tenant, which
    // is precisely what sec-fix wave1 #4 authenticated it to prevent. The
    // screen keeps receiving alerts through the manifest (the documented
    // HTTP-polling backstop); only the offline pre-cache degrades.
    const authResult = await this.deviceAuth(req, id, { allowUnpaired: true });
    if (!authResult.ok) {
      throw new HttpException({ code: 'SCREEN_DEVICE_AUTH_REQUIRED', message: `Device auth required (${authResult.reason})` }, HttpStatus.UNAUTHORIZED);
    }

    // 2026-05-23 launch audit P0 (efficiency): previously this fetched
    // the screen, THEN the tenant — two sequential DB round-trips just
    // to read the screen's per-screen-emergency columns + the tenant's
    // tenant-wide-emergency columns. Collapse into one Prisma query
    // with `include: { tenant: { select: ... } }` so it's a single
    // round-trip. Saves ~1 RTT (~40ms at typical Supabase pooler
    // latency) per emergency-asset poll (every 5 min per kiosk).
    const screen = await (this.prisma.client.screen as any).findUnique({
      where: { id },
      select: {
        tenantId: true,
        emergencyLockdownPlaylistId: true,
        emergencyEvacuatePlaylistId: true,
        emergencyWeatherPlaylistId: true,
        emergencyHoldPlaylistId: true,
        emergencySecurePlaylistId: true,
        emergencyMedicalPlaylistId: true,
        emergencyLockdownPortraitPlaylistId: true,
        emergencyEvacuatePortraitPlaylistId: true,
        emergencyWeatherPortraitPlaylistId: true,
        emergencyHoldPortraitPlaylistId: true,
        emergencySecurePortraitPlaylistId: true,
        emergencyMedicalPortraitPlaylistId: true,
        emergencyLockdownAssetUrl: true,
        emergencyEvacuateAssetUrl: true,
        emergencyWeatherAssetUrl: true,
        emergencyHoldAssetUrl: true,
        emergencySecureAssetUrl: true,
        emergencyMedicalAssetUrl: true,
        emergencyLockdownPortraitAssetUrl: true,
        emergencyEvacuatePortraitAssetUrl: true,
        emergencyWeatherPortraitAssetUrl: true,
        emergencyHoldPortraitAssetUrl: true,
        emergencySecurePortraitAssetUrl: true,
        emergencyMedicalPortraitAssetUrl: true,
        tenant: {
          select: {
            id: true,
            // 2026-09-01 — the tenant's standard LED poster module size
            // (NovaStar TB posters; see manifest `posterStandard`).
            posterStandardW: true,
            posterStandardH: true,
            emergencyPlaylistId: true,
            emergencyPortraitPlaylistId: true,
            panicLockdownPlaylistId: true,
            panicEvacuatePlaylistId: true,
            panicWeatherPlaylistId: true,
            panicHoldPlaylistId: true,
            panicSecurePlaylistId: true,
            panicMedicalPlaylistId: true,
            panicLockdownPortraitPlaylistId: true,
            panicEvacuatePortraitPlaylistId: true,
            panicWeatherPortraitPlaylistId: true,
            panicHoldPortraitPlaylistId: true,
            panicSecurePortraitPlaylistId: true,
            panicMedicalPortraitPlaylistId: true,
          },
        },
      },
    });
    if (!screen?.tenantId) {
      throw new HttpException({ code: 'SCREEN_NOT_FOUND', message: 'Screen not found or not paired' }, HttpStatus.NOT_FOUND);
    }
    const tenant = (screen as any).tenant;
    if (!tenant) {
      throw new HttpException({ code: 'SCREEN_TENANT_NOT_FOUND', message: 'Tenant not found' }, HttpStatus.NOT_FOUND);
    }

    const playlistIds = [
      tenant.emergencyPlaylistId,
      (tenant as any).emergencyPortraitPlaylistId,
      tenant.panicLockdownPlaylistId,
      tenant.panicEvacuatePlaylistId,
      tenant.panicWeatherPlaylistId,
      (tenant as any).panicHoldPlaylistId,
      (tenant as any).panicSecurePlaylistId,
      (tenant as any).panicMedicalPlaylistId,
      (tenant as any).panicLockdownPortraitPlaylistId,
      (tenant as any).panicEvacuatePortraitPlaylistId,
      (tenant as any).panicWeatherPortraitPlaylistId,
      (tenant as any).panicHoldPortraitPlaylistId,
      (tenant as any).panicSecurePortraitPlaylistId,
      (tenant as any).panicMedicalPortraitPlaylistId,
      (screen as any).emergencyLockdownPlaylistId,
      (screen as any).emergencyEvacuatePlaylistId,
      (screen as any).emergencyWeatherPlaylistId,
      (screen as any).emergencyHoldPlaylistId,
      (screen as any).emergencySecurePlaylistId,
      (screen as any).emergencyMedicalPlaylistId,
      (screen as any).emergencyLockdownPortraitPlaylistId,
      (screen as any).emergencyEvacuatePortraitPlaylistId,
      (screen as any).emergencyWeatherPortraitPlaylistId,
      (screen as any).emergencyHoldPortraitPlaylistId,
      (screen as any).emergencySecurePortraitPlaylistId,
      (screen as any).emergencyMedicalPortraitPlaylistId,
    ].filter((x): x is string => !!x);

    const assets: Array<{ url: string; sha256: string | null; size: number; kind: string }> = [];
    const seen = new Set<string>();

    if (playlistIds.length > 0) {
      const playlists = await this.prisma.client.playlist.findMany({
        where: { id: { in: playlistIds } },
        include: {
          items: {
            include: {
              asset: { select: { fileUrl: true, fileSize: true, mimeType: true, fileHash: true } },
            },
          },
        },
      });
      for (const pl of playlists) {
        for (const item of pl.items) {
          if (!item.asset?.fileUrl) continue;
          if (seen.has(item.asset.fileUrl)) continue;
          seen.add(item.asset.fileUrl);
          // P0-1 (2026-05-28): ship the canonical SHA-256 of the file BODY,
          // never a URL-derived digest. The SW recomputes the digest from the
          // downloaded bytes and refuses to cache on mismatch
          // (sw-player.js fetchAndStore). A URL-derived hash can NEVER equal
          // the body's real SHA-256, so synthesizing one guaranteed every
          // such emergency asset failed the integrity check, degraded the
          // screen to text-only, and (because the set-hash never committed)
          // re-attempted the full precache every 5 min forever.
          //
          // When `Asset.fileHash` is genuinely null (legacy / external-URL
          // rows the upload pipeline never hashed), send `sha256: null`. The
          // SW skips the integrity check for null-hash assets and caches the
          // body as-is, rather than computing a fake hash it would then
          // reject. (Recommend backfilling fileHash for null rows — see
          // report; do NOT fabricate one here.)
          assets.push({
            url: item.asset.fileUrl,
            sha256: item.asset.fileHash ?? null,
            size: item.asset.fileSize ?? 0,
            kind: item.asset.mimeType?.startsWith('video/') ? 'video' : 'image',
          });
        }
      }
    }

    const screenAssetUrls = [
      (screen as any).emergencyLockdownAssetUrl,
      (screen as any).emergencyEvacuateAssetUrl,
      (screen as any).emergencyWeatherAssetUrl,
      (screen as any).emergencyHoldAssetUrl,
      (screen as any).emergencySecureAssetUrl,
      (screen as any).emergencyMedicalAssetUrl,
      (screen as any).emergencyLockdownPortraitAssetUrl,
      (screen as any).emergencyEvacuatePortraitAssetUrl,
      (screen as any).emergencyWeatherPortraitAssetUrl,
      (screen as any).emergencyHoldPortraitAssetUrl,
      (screen as any).emergencySecurePortraitAssetUrl,
      (screen as any).emergencyMedicalPortraitAssetUrl,
    ].filter((url): url is string => typeof url === 'string' && url.trim().length > 0);

    // P0-1 (2026-05-28): per-screen emergency asset URLs (Sprint 8b scoped
    // media — "evacuate via north exit" etc.) are stored as raw URL strings on
    // the Screen row, not FK references. Previously we UNCONDITIONALLY
    // synthesized a `${url}:screen-emergency` digest as the sha256 — which the
    // SW's body-recompute integrity check could never match, so per-screen
    // emergency media NEVER cached and the screen silently degraded to
    // text-only in exactly the localized-threat scenarios these assets exist
    // for. Look up the owning Asset.fileHash by fileUrl and ship the real body
    // hash; fall back to `sha256: null` (SW skips verification) when the asset
    // wasn't hashed or isn't a managed Asset row. Single batched query — no
    // N+1.
    const screenAssetHashByUrl = new Map<string, string | null>();
    const uncachedScreenUrls = screenAssetUrls.filter((url) => !seen.has(url));
    if (uncachedScreenUrls.length > 0) {
      try {
        const ownedAssets = await this.prisma.client.asset.findMany({
          where: { fileUrl: { in: uncachedScreenUrls } },
          select: { fileUrl: true, fileHash: true, fileSize: true },
        });
        for (const a of ownedAssets) {
          // First match wins; fileUrl should be unique per asset row.
          if (!screenAssetHashByUrl.has(a.fileUrl)) {
            screenAssetHashByUrl.set(a.fileUrl, a.fileHash ?? null);
          }
        }
      } catch (e) {
        // Non-fatal: if the lookup fails we ship null hashes (SW caches
        // without integrity check) rather than blocking emergency precache.
        console.warn('[emergency-assets] per-screen asset hash lookup failed', (e as Error).message);
      }
    }

    for (const url of screenAssetUrls) {
      if (seen.has(url)) continue;
      seen.add(url);
      const clean = url.split('?')[0].split('#')[0].toLowerCase();
      const kind = /\.(mp4|webm|mov|m4v)$/.test(clean) ? 'video'
        : /\.pdf$/.test(clean) ? 'pdf'
          : 'image';
      assets.push({
        url,
        // Real body SHA-256 when this URL maps to a managed Asset row;
        // otherwise null so the SW skips integrity verification (it cannot
        // verify a hash we don't have) rather than rejecting a fabricated one.
        sha256: screenAssetHashByUrl.has(url) ? screenAssetHashByUrl.get(url)! : null,
        size: 0,
        kind,
      });
    }

    // Stable hash of the whole asset set so the player can short-circuit
    // pre-cache when nothing has changed. A null body-hash contributes the
    // literal token "null" — deterministic, so the set-change short-circuit
    // still works for null-hash (unhashed) assets.
    const setHash = crypto
      .createHash('sha256')
      .update(assets.map(a => `${a.url}:${a.sha256 ?? 'null'}`).sort().join('|'))
      .digest('hex');

    // sec-fix(wave1) #4: audit every emergency-asset fetch. Forensically
    // crucial — if someone abuses a stolen device token to enumerate
    // lockdown media, we need the log trail.
    //
    // 2026-04-24: Debounce the write to at-most-once-per-(screen,setHash)
    // per 15 minutes. A paired screen re-calls this every 5 minutes by
    // design; without the debounce the audit table (and the dashboard's
    // Recent Activity card) was filling with identical entries. A genuine
    // content change produces a different setHash and therefore a fresh
    // audit row, so we don't lose the forensic signal.
    try {
      if (!shouldSkipEmergencyAudit(id, setHash)) {
        markEmergencyAuditWritten(id, setHash);
        await this.prisma.client.auditLog.create({
          data: {
            action: 'DEVICE_FETCH_EMERGENCY_ASSETS',
            targetType: 'screen',
            targetId: id,
            tenantId: tenant.id,
            details: JSON.stringify({ assetCount: assets.length, setHash }),
          },
        });
      }
    } catch (e) {
      // Non-fatal: we prefer to serve the player even if audit logging
      // is degraded.
      console.warn('[emergency-assets] audit log failed', (e as Error).message);
    }

    return {
      tenantId: tenant.id,
      screenId: id,
      generatedAt: new Date().toISOString(),
      assets,
      assetCount: assets.length,
      totalBytes: assets.reduce((sum, a) => sum + a.size, 0),
      setHash,
    };
  }

  // ─── DEVICE-AUTHED: per-location resolved menu ─────────────────────
  //
  // Menu-mgmt-at-scale (2026-05-29) — the Tier-0 unblock. Before this,
  // MenuBoardWidget on a real kiosk fetched the SESSION-authed
  // /api/v1/pos/items with a token the player doesn't have → 403 →
  // hardcoded DEMO_ITEMS on every wall. This endpoint accepts a DEVICE
  // token (the same `verifyDeviceForScreen` model as /:id/manifest and
  // /:id/emergency-assets) and returns the RESOLVED menu for the
  // screen's location: per-location prices, 86'd items hidden,
  // dayparted sections filtered by the location's local time.
  //
  // Location resolution (no client input — all from the verified screen):
  //   • location tenant = the screen's posLocation.locationTenantId if
  //     the screen is mapped to a POS location, else the screen's own
  //     tenantId.
  //   • catalog-owning (chain) tenant = the location tenant's parent
  //     (Tenant.parentId) if it has one, else the location tenant itself.
  //   This lets a 50-store chain design ONE catalog on the parent tenant
  //   and have every store screen resolve its own per-location prices.
  @Get(':id/menu')
  async getMenu(
    @Param('id') id: string,
    @Req() req: ExpressReq,
    @Query('includeUnavailable') includeUnavailable?: string,
  ) {
    // SEC-001 — prior behaviour, stated. Live POS prices are tenant data;
    // an unproven credential no longer reads them.
    const authResult = await this.deviceAuth(req, id, { allowUnpaired: true });
    if (!authResult.ok) {
      throw new HttpException({ code: 'SCREEN_DEVICE_AUTH_REQUIRED', message: `Device auth required (${authResult.reason})` }, HttpStatus.UNAUTHORIZED);
    }

    // When set (?includeUnavailable=1|true), 86'd / sold-out items are
    // INCLUDED in the feed flagged `available:false` so a menu board can
    // grey them out instead of dropping them. Default (absent) keeps the
    // existing behavior: unavailable items are omitted entirely.
    const wantUnavailable = includeUnavailable === '1' || includeUnavailable === 'true';

    // Single round-trip: the screen + its POS-location mapping + the
    // location-tenant's parent (chain) id.
    const screen = await (this.prisma.client.screen as any).findUnique({
      where: { id },
      select: {
        tenantId: true,
        posLocationId: true,
        posLocation: { select: { locationTenantId: true } },
        tenant: { select: { id: true, parentId: true } },
      },
    });
    if (!screen?.tenantId) {
      throw new HttpException({ code: 'SCREEN_NOT_FOUND', message: 'Screen not found or not paired' }, HttpStatus.NOT_FOUND);
    }

    // The screen's effective location tenant: the POS-location mapping
    // wins (operator assigned this screen to a specific store), else the
    // screen's own tenant is the location.
    const locationTenantId: string =
      screen.posLocation?.locationTenantId || screen.tenantId;

    // The chain (catalog-owning) tenant: the screen tenant's parent if
    // any, else the location tenant itself (single-location operator).
    // resolveMenuForLocation scopes catalogs to BOTH this tenant AND the
    // location tenant — a school/location under a parent that connects
    // its OWN POS owns its catalogs itself, and resolving only the
    // parent's left those walls empty (POS sandbox bug #2, 2026-08-04).
    const catalogTenantId: string =
      screen.tenant?.parentId || locationTenantId;

    const resolved = await this.menu.resolveMenuForLocation(locationTenantId, {
      catalogTenantId,
      includeUnavailable: wantUnavailable,
    });

    // Shape compatible with what MenuBoardWidget maps (name / description
    // / priceCents / badges). `badges` mirrors PosMenuItem's contract so
    // the existing renderer drops in; we alias allergens+tags → badges.
    return {
      screenId: id,
      tenantId: screen.tenantId,
      locationTenantId,
      generatedAt: resolved.generatedAt,
      categories: resolved.categories,
      items: resolved.items.map((it) => ({
        id: it.id,
        externalId: it.externalId,
        name: it.name,
        description: it.description ?? undefined,
        priceCents: it.priceCents,
        priceOverridden: it.priceOverridden,
        category: it.category ?? undefined,
        imageUrl: it.imageUrl ?? undefined,
        // The widget reads `badges`; surface allergens + tags there.
        badges: [...it.allergens, ...it.tags],
        allergens: it.allergens,
        tags: it.tags,
        // Pass through the resolver's flags. When includeUnavailable is
        // off, every item is available:true (86'd items were dropped);
        // when on, 86'd items appear flagged available:false so the board
        // can grey them out. soldOut distinguishes a timed temp-86.
        available: it.available,
        soldOut: it.soldOut,
        ...(it.variants ? { variants: it.variants } : {}),
      })),
    };
  }
}
