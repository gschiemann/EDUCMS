/**
 * Player OTA update endpoints.
 *
 * Two responsibilities:
 *
 * 1) POST /api/v1/player/update-check — the Android kiosk APK polls
 *    this every 6h with its current version + fingerprint + ABI. We
 *    auto-resolve the latest `player-v*` GitHub Release and reply
 *    with a pointer to the APK if the caller is stale. The APK is
 *    served from the GitHub Release asset URL — Railway never hosts
 *    the binary. Gated by per-screen / per-tenant auto-update flags,
 *    a canary cohort, and an optional maintenance window.
 *
 * 2) GET /api/v1/player/apk/latest — dashboard-facing convenience
 *    redirect so the 'Download Player APK' button in settings can
 *    link to a stable path. Issues a 302 to the current release
 *    asset. Zero-auth — the APK itself is public; sideloading it
 *    does nothing without a tenant pairing code, which IS auth'd.
 *
 * 2026-05-15 — the old `PLAYER_APK_LATEST_VERSION_CODE` /
 * `PLAYER_APK_URL` env-var "Path A" was REMOVED. A stale env var
 * silently pinned the whole fleet to an old build (it happened
 * twice). Shipping a new version is now ONLY:
 *   1. `scripts/release-apk.sh player x.y.z` (bumps + commits + tags)
 *   2. `git push origin master player-vx.y.z`
 *   CI builds + attaches the APK to the GitHub Release; every paired
 *   device pulls it within 6h. No Railway env var to touch or to go
 *   stale. The `apk-version-tag-sync` CI check guards the tag.
 *
 * Nova Taurus deployment: covered in docs/PLAYER_APK_NOVA_TAURUS.md
 * — the short version is "sideload the arm64-v8a APK via ViPlex
 * Express with auto-launch enabled." Once installed, this OTA flow
 * keeps it current; operators never have to re-sideload.
 */

import { Controller, Post, Get, Body, Req, Res, Logger, UseGuards, Param, NotFoundException, HttpException, HttpStatus } from '@nestjs/common';
import type { Request as ExpressReq, Response } from 'express';
import { Readable } from 'node:stream';
import { Throttle } from '@nestjs/throttler';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../realtime/redis.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';
import { isInCanaryCohort } from './canary-cohort';
// 2026-08-03 security wave: OTA-01 (authenticate the destructive write),
// OTA-03/04/05 (provenance pin, URL allowlist, rollback floor + kill switch).
// 2026-08-03 (later, launch fixes): the repo went PRIVATE on 08-01, which
// killed every anonymous GitHub fetch in this file — release lists 404'd,
// SHA fetches came back empty (fail-closed), and the advertised
// `browser_download_url` was un-downloadable by kiosks. All GitHub reads now
// authenticate with GH_TOKEN, and the fleet downloads through OUR versioned
// proxy (/apk/v/:vc, /manager-apk/v/:vc) instead of GitHub's CDN — which
// also retires the anonymous-CDN throttle that made a 12 MB APK take 13
// minutes (2026-05-12). blockedBySigningCutover keeps the pre-v1.1.0
// `-debug` fleet from being offered an update Android must refuse.
import { verifyDeviceForScreen } from '../screens/device-auth';
import {
  evaluateReleaseForFleet,
  evaluateManagerReleaseForFleet,
  isAllowedApkUrl,
  blockedBySigningCutover,
  semverGte,
} from './release-policy';

interface UpdateCheckBody {
  fingerprint?: string;
  versionCode?: number;
  versionName?: string;
  abi?: string;
  device?: string;
  sdk?: number;
}

@Controller('api/v1/player')
export class PlayerOtaController {
  private readonly logger = new Logger('PlayerOTA');
  // panel-user-tap audit dedup — screenId → last audit ms. In-memory and
  // per-replica by design: worst case on multi-replica is one duplicate
  // audit row per replica per 10 min, which is bounded noise, not a
  // correctness input (nothing reads this map but the audit write below).
  private static readonly userTapAuditAt = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * OTA-01 — does this request carry a valid device credential bound to the
   * screen that owns `fingerprint`?
   *
   * Resolves the fingerprint to a screen id first (the OTA client speaks
   * fingerprints, the credential speaks screen ids), then runs the SHARED
   * device verifier — so a revoked, re-homed or deleted screen's token
   * counts as unauthenticated here too, not merely as "wrong screen".
   * Never throws: an unresolvable fingerprint or a DB hiccup is simply
   * "not authenticated", which is the safe direction.
   */
  private async isDeviceAuthenticated(
    req: ExpressReq | undefined,
    fingerprint: string | undefined,
  ): Promise<boolean> {
    const fp = (fingerprint || '').trim();
    if (!req || !fp) return false;
    const auth = req.headers?.authorization;
    if (typeof auth !== 'string' || !auth.toLowerCase().startsWith('bearer ')) return false;
    try {
      const screen = await this.prisma.client.screen.findFirst({
        where: { deviceFingerprint: fp },
        select: { id: true },
      });
      if (!screen) return false;
      const result = await verifyDeviceForScreen(
        { prisma: this.prisma, redis: this.redisService },
        req,
        screen.id,
      );
      return result.ok;
    } catch {
      return false;
    }
  }

  /**
   * Fire-and-forget: record the APK version the caller reported onto
   * their Screen row so the /screens list can show "1.0.8" per kiosk.
   * Debounced to 25 min per screen — the APK polls every 6h anyway,
   * so this write effectively runs at most once per check-in, and
   * never blocks the update-check response. Uses updateMany so
   * missing-row cases (e.g. a preview fingerprint that never paired)
   * no-op instead of throwing.
   */
  private async persistReportedVersion(
    body: UpdateCheckBody,
    ctx: { deviceAuthenticated: boolean } = { deviceAuthenticated: false },
  ): Promise<void> {
    const fp = (body?.fingerprint || '').trim();
    const vn = (body?.versionName || '').trim();
    if (!fp || !vn) return;
    const vc = Number.isFinite(body?.versionCode as number) ? Number(body?.versionCode) : null;
    // Security audit P0-SEC-3 (2026-04-28) — bootstrap calls have no
    // screen row to update; running findFirst + updateMany on every
    // call is a DB-spam amplifier for unauthenticated /update-check.
    // Fast-path: skip the DB read/write entirely when vc=0 (the
    // bootstrap signal — Player not installed yet, no row exists).
    if (!vc || vc === 0) return;
    try {
      // 2026-04-28 — operator: 'i rebooted the player and nothing
      // fucking happened... we are 16 versions of the player in and
      // i asked for OTA on the first version'. ROOT CAUSE: the
      // force-update flag was cleared OPTIMISTICALLY in the update-
      // check response path the first time we handed back a URL,
      // before the kiosk had actually installed. If the install
      // failed silently (permission, download, signature mismatch,
      // anything), the flag was gone and subsequent polls returned
      // uptoDate forever.
      //
      // Fix: stop clearing in update-check (see below). Clear here
      // ONLY when the kiosk reports a versionCode strictly GREATER
      // than what we previously stored — that's actual proof the
      // install succeeded. Until then, the flag persists and every
      // subsequent /update-check from this kiosk returns the latest
      // APK URL.
      const prior = await this.prisma.client.screen.findFirst({
        where: { deviceFingerprint: fp },
        select: { id: true, tenantId: true, playerVersionCode: true, forceApkUpdatePendingAt: true } as any,
      }) as any;
      const claimsInstall = !!(
        prior && prior.forceApkUpdatePendingAt && vc !== null
        && (prior.playerVersionCode == null || vc > Number(prior.playerVersionCode))
      );

      // ── OTA-01 (2026-08-03): clearing a pending push is now PRIVILEGED ──
      //
      // The attack this closes: `POST /player/update-check` takes no
      // authentication of any kind, and this function is what clears
      // `forceApkUpdatePendingAt`. So anyone who knew ONE device
      // fingerprint — a value every CONTRIBUTOR (and, via the RBAC GET
      // pass-through, every RESTRICTED_VIEWER) could read off
      // `GET /screen-groups`, and that anyone with 60 seconds of adb on a
      // single kiosk can read — could POST a fabricated version bump and
      // silently cancel an operator's APK push. Looped, that holds the
      // whole tenant fleet off the patch channel INDEFINITELY, while the
      // dashboard's "push pending" chip clears as if the install had
      // succeeded. That is the exact channel that would ship the fix for
      // the confirmed debuggable-APK / stolen-token CRITICALs.
      //
      // Why not simply require auth on the route: the shipped Kotlin OTA
      // worker sends no Authorization header, and this change cannot ship
      // an APK. Requiring it would take the entire live fleet off updates —
      // the very outcome being defended against. So the READ path stays
      // open (the fleet keeps updating) and the one DESTRUCTIVE write is
      // gated. The real fleet loses nothing: after a successful install the
      // kiosk reports the new versionName, `semverGte` returns uptoDate, so
      // there is no re-download loop; the flag simply lingers until the
      // existing 24 h stale sweep clears it.
      //
      // Flip OTA_REQUIRE_DEVICE_AUTH=true once a token-sending player build
      // is fleet-wide to make this a hard requirement.
      const installed = claimsInstall && ctx.deviceAuthenticated;

      await this.prisma.client.screen.updateMany({
        where: { deviceFingerprint: fp },
        data: {
          playerVersion: vn,
          playerVersionCode: vc,
          playerVersionAt: new Date(),
          // Clear the flag iff a DEVICE-AUTHENTICATED report shows the
          // install actually landed (versionCode bumped). Also clear the
          // maintenance-window override so it doesn't linger past the
          // install it was set for, and the sticky OTA failure stamp
          // (OTA-02) — a real install is the definitive "resolved".
          ...(installed
            ? {
                forceApkUpdatePendingAt: null as any,
                forceApkUpdateOverrideWindow: false as any,
                lastOtaErrorAt: null as any,
                lastOtaErrorMessage: null as any,
                lastOtaErrorAuthenticated: false as any,
              }
            : {}),
        } as any,
      });
      if (installed) {
        this.logger.log(
          `[ota] flag-cleared-on-install screen=${prior.id} ` +
          `prev=${prior.playerVersionCode || 'null'} new=${vc}`,
        );
      } else if (claimsInstall) {
        // Refused. Leave a forensic record — the audit specifically called
        // out that this cancellation left none.
        this.logger.warn(
          `[ota][security] UNAUTHENTICATED install claim for screen=${prior.id} ` +
          `prev=${prior.playerVersionCode || 'null'} claimed=${vc} — pending push ` +
          `NOT cleared (OTA-01). Flag remains set; the 24h sweep will retire it.`,
        );
        this.prisma.client.auditLog.create({
          data: {
            tenantId: (prior as any).tenantId || 'unknown',
            userId: null,
            action: 'OTA_UNAUTHENTICATED_INSTALL_CLAIM',
            targetType: 'Screen',
            targetId: prior.id,
            details: JSON.stringify({
              fingerprint: fp.slice(0, 24),
              priorVersionCode: prior.playerVersionCode ?? null,
              claimedVersionCode: vc,
              claimedVersionName: vn,
            }),
          },
        }).catch(() => { /* audit best-effort */ });
      }
    } catch (e: any) {
      // Non-fatal — next poll will try again.
      this.logger.warn(`Version persist failed: ${e?.message}`);
    }
  }

  @Post('update-check')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async updateCheck(@Body() body: UpdateCheckBody, @Req() req?: ExpressReq) {
    // ── OTA-01 (2026-08-03) — establish whether the caller can PROVE it is
    // the screen it claims to be. The route stays anonymous by necessity
    // (the shipped Kotlin worker sends no Authorization header and this
    // change cannot ship an APK), but the destructive side effect —
    // clearing an operator's pending APK push — is gated on this.
    const deviceAuthenticated = await this.isDeviceAuthenticated(req, body?.fingerprint);
    if (!deviceAuthenticated && process.env.OTA_REQUIRE_DEVICE_AUTH === 'true') {
      // Opt-in hard gate, for after a token-sending player build is
      // fleet-wide. Off by default precisely so enabling it is a deliberate
      // act taken with knowledge of the installed base.
      throw new HttpException(
        { code: 'OTA_DEVICE_AUTH_REQUIRED', message: 'Device authentication required for update-check' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    // Fire-and-forget; don't block the response path on the write.
    this.persistReportedVersion(body, { deviceAuthenticated }).catch(() => {});

    // OTA gating (2026-04-27). Operator: "we shouldnt be auto
    // updating screens unless we check a box or something on
    // that... i would hate to break a perfectly good working
    // screen with an update."
    //
    // Default behavior: NO automatic updates. The kiosk polls and
    // gets `uptoDate: true` even if a newer APK is published. The
    // admin must EITHER:
    //   (a) flip Tenant.autoUpdatePlayerEnabled = true (opt-in
    //       to background updates), OR
    //   (b) click "Push update" on the specific screen, which
    //       writes Screen.forceApkUpdatePendingAt = now() — the
    //       next update-check from THAT screen returns the latest
    //       (within a 30-min window).
    //
    // We resolve the screen by deviceFingerprint, then its tenant.
    // If the fingerprint isn't paired (preview, unpaired install)
    // we conservatively return uptoDate — those installs will be
    // updated when they pair to a tenant whose flag is on.
    // Forensic breadcrumb prefix so an operator looking at Railway
    // logs can grep "[ota]" + a screen/fingerprint/tenant identifier
    // and reconstruct exactly what the API did. Operator (2026-04-27):
    // "make sure we have logs for these things so we can always
    // trouble shoot everything in our apps." Lots of these are
    // single-line so they're greppable; one decision per line.
    const fp = (body?.fingerprint || '').trim();
    const callerVn = String(body?.versionName || '').trim() || '?';
    const callerVc = Number(body?.versionCode) || 0;
    const callerSource = String((body as any)?.source || '').trim();
    const fpShort = fp ? fp.slice(0, 10) : 'no-fp';

    // 2026-04-28 (Architecture audit P0-2) — fresh-install bootstrap
    // bypass. When operator sideloads only Manager v1.0.3 onto a brand-
    // new kiosk, no Player is installed yet → no Screen row exists →
    // gate normally returns uptoDate forever → Player never installs
    // → kiosk requires manual sideload of Player too, defeating the
    // "no more sideloads" promise.
    //
    // Solution: when Manager calls /update-check with versionCode=0
    // (Player not installed) AND source identifies as Manager, return
    // the latest Player APK regardless of force flag / autoUpdate
    // setting / screen row existence. This is the documented bootstrap
    // path the comment header alludes to but never actually implemented.
    const isBootstrapCall = callerVc === 0
      && (callerSource === 'manager' || callerSource === 'manager-self');
    // 24-hour force-pending window. Was 30 min, but old kiosks (pre-
    // v1.0.5, before WebAppBridge.checkForUpdates was added) can't
    // react to the WS push instantly — they only update on their 6h
    // periodic OtaUpdateWorker tick. With a 30-min window the
    // periodic poll usually fires AFTER the flag has expired and
    // returns uptoDate. 24h guarantees the periodic catches the flag
    // exactly once. The flag clears itself the moment we hand back a
    // download URL, so we never re-deliver the same update.
    const FORCE_WINDOW_MS = 24 * 60 * 60_000;
    let allowUpdate = false;
    let allowReason = 'gated';
    let forcedPendingScreenId: string | null = null;
    let lookupScreenId: string | null = null;
    let lookupTenantId: string | null = null;
    let lookupScreenName: string | null = null;
    // Phase B canary — captured at screen-lookup time, defaults to
    // full-rollout (100) when no screen row exists.
    let tenantCanaryPct = 100;
    try {
      if (fp) {
        const screen = await this.prisma.client.screen.findFirst({
          where: { deviceFingerprint: fp },
          select: {
            id: true,
            tenantId: true,
            name: true,
            forceApkUpdatePendingAt: true,
            forceApkUpdateOverrideWindow: true,
            lastOtaState: true,
            lastOtaAt: true,
            tenant: {
              select: {
                autoUpdatePlayerEnabled: true,
                otaWindowStart: true,
                otaWindowEnd: true,
                otaWindowTimezone: true,
                canaryFleetPercent: true,
              },
            },
          } as any,
        }) as any;
        if (screen) {
          lookupScreenId = screen.id;
          lookupTenantId = screen.tenantId;
          // Phase B canary — pull the tenant's current rollout %.
          // Missing/null defaults to 100 (full rollout, no change in
          // behavior for tenants that haven't opted into canary).
          const pct = screen.tenant?.canaryFleetPercent;
          if (typeof pct === 'number' && Number.isFinite(pct)) {
            tenantCanaryPct = Math.max(0, Math.min(100, pct));
          }
        }
        // ── 2026-08-25 — the panel's own Update button must WORK ──────
        // Operator (L55VEC): "it needs to work from a button push."
        // A human standing at the glass tapping Update is the SAME
        // authorization as a dashboard push — rollout pacing (auto-off,
        // canary) exists to bound UNATTENDED fan-out of a bad release,
        // and an explicit operator ask is the opposite of unattended.
        // Spoof-proof per the OTA-01 lesson (this endpoint is otherwise
        // unauthenticated): honored ONLY when the request carries a
        // VALID device token for this exact screen (deviceAuthenticated
        // — the same gate that protects persistReportedVersion). Shipped
        // players never send source='user' (no tap wiring until v1.1.5),
        // so this branch is inert for the current fleet and arms the
        // moment the tap-wired player ships.
        if (screen && deviceAuthenticated && callerSource === 'user') {
          lookupScreenName = screen.name ?? null;
          allowUpdate = true;
          allowReason = 'panel-user-tap';
        } else if (screen?.tenant?.autoUpdatePlayerEnabled) {
          allowUpdate = true;
          allowReason = 'tenant-auto-on';
        } else if (screen?.forceApkUpdatePendingAt) {
          const ageMs = Date.now() - new Date(screen.forceApkUpdatePendingAt).getTime();

          // 2026-05-12 — operator: "my signage keeps refreshing and
          // loading the webpage out of nowhere which can not happen
          // when we are live with customers". Root cause: The Den
          // was stuck at last_ota_state='INSTALLING' for 2h+ because
          // Manager's notification-based install dialog was eaten by
          // the OEM. The forceApkUpdatePendingAt flag stayed set →
          // every periodic worker tick re-downloaded the APK +
          // tried to install + failed → infinite loop chewing
          // bandwidth and triggering WebView reloads.
          //
          // Defensive auto-clear: if last_ota_state has been
          // INSTALLING for > 10 minutes without a versionCode bump,
          // we KNOW the install failed (OEM ate the prompt, signature
          // mismatch, permission denied, whatever). Clear the flag so
          // the kiosk stops retrying. Operator can re-push manually.
          const STALLED_INSTALL_MS = 10 * 60_000;
          const stalled =
            (screen.lastOtaState === 'INSTALLING' || screen.lastOtaState === 'ERROR') &&
            screen.lastOtaAt &&
            (Date.now() - new Date(screen.lastOtaAt).getTime() > STALLED_INSTALL_MS);

          if (stalled) {
            this.logger.warn(
              `[ota] auto-clearing force flag — install stalled at state=${screen.lastOtaState} ` +
              `for ${Math.round((Date.now() - new Date(screen.lastOtaAt).getTime()) / 60000)}min ` +
              `screen=${screen.id}`,
            );
            this.prisma.client.screen
              .update({
                where: { id: screen.id },
                data: { forceApkUpdatePendingAt: null } as any,
              })
              .catch(() => { /* swallow */ });
            allowReason = `force-pending-but-stalled-${screen.lastOtaState}`;
          } else if (ageMs < FORCE_WINDOW_MS) {
            // OTA maintenance-window gate (Sprint 11 Phase A).
            // If tenant has configured a window AND the screen-level
            // override is OFF, only allow the install during the window.
            // Outside it, return uptoDate so the kiosk's worker exits
            // cleanly. Flag stays set; next /update-check call inside
            // the window will see allowUpdate=true.
            //
            // Operator (2026-05-12): "we cant have screens flashing all
            // the time" + "find the bigger picture solution for
            // uninterrupted service across all screens, all customer,
            // all playlists".
            const t = screen.tenant;
            const overrideWindow = !!screen.forceApkUpdateOverrideWindow;
            const windowConfigured = !!(t?.otaWindowStart && t?.otaWindowEnd && t?.otaWindowTimezone);
            const insideWindow = windowConfigured
              ? isInsideMaintenanceWindow(
                  t.otaWindowStart!,
                  t.otaWindowEnd!,
                  t.otaWindowTimezone!,
                )
              : true; // No window configured → always "inside"

            if (overrideWindow || insideWindow) {
              allowUpdate = true;
              allowReason = overrideWindow
                ? `force-pending-${Math.round(ageMs / 1000)}s-ago-override-window`
                : windowConfigured
                  ? `force-pending-${Math.round(ageMs / 1000)}s-ago-inside-window`
                  : `force-pending-${Math.round(ageMs / 1000)}s-ago`;
              forcedPendingScreenId = screen.id;
            } else {
              allowReason = `force-pending-but-outside-window-${t!.otaWindowStart}-${t!.otaWindowEnd}-${t!.otaWindowTimezone}`;
              this.logger.log(
                `[ota] gated by maintenance window — screen=${screen.id} ` +
                `tenant=${screen.tenantId} window=${t!.otaWindowStart}-${t!.otaWindowEnd} ` +
                `${t!.otaWindowTimezone}; flag stays set, will re-evaluate next poll`,
              );
            }
          } else {
            allowReason = `force-pending-stale-${Math.round(ageMs / 60000)}min`;
            // 2026-04-28 (Server audit P0-3) — clean up stale flag.
            // Without this, a permanently-failing kiosk sits forever
            // with a 25h+ old timestamp; subsequent /update-check
            // calls correctly return uptoDate but the dashboard never
            // sees the flag clear.
            this.prisma.client.screen
              .update({ where: { id: screen.id }, data: { forceApkUpdatePendingAt: null } as any })
              .catch(() => { /* swallow */ });
          }
        } else {
          allowReason = screen ? 'no-force-flag' : 'no-screen-row';
        }
      } else {
        allowReason = 'no-fingerprint';
      }
    } catch (e: any) {
      // On lookup error, fall back to the safer default (no update).
      this.logger.warn(`[ota] gate-lookup-failed fp=${fpShort} err=${e?.message}`);
      allowReason = 'lookup-error';
    }
    if (!allowUpdate && isBootstrapCall) {
      // Bootstrap bypass — Manager just sideloaded onto a fresh
      // kiosk needs Player. Skip the gate.
      allowUpdate = true;
      allowReason = 'bootstrap-bypass';
      this.logger.log(
        `[ota] bootstrap-bypass caller=${callerVn} fp=${fpShort} ` +
        `source=${callerSource}`,
      );
    }

    // ── Sprint 11 Phase B canary gate ──
    // Even if the screen-level checks above said allowUpdate=true, the
    // tenant's canary rollout policy can still hold this screen back.
    // canary_fleet_percent < 100 means only the deterministic hash
    // cohort of screens is allowed to install the new build. Everyone
    // else gets uptoDate so a bad release can't fan out to >N% of the
    // fleet in any 30-min window.
    //
    // Bootstrap bypass screens skip the gate (Manager's fresh-install
    // path needs to ALWAYS get a Player APK — it's an empty kiosk
    // by definition and there's nothing to break).
    // panel-user-tap bypasses the canary hold by design — see the branch
    // above: a human explicitly asked, which is what the pacing protects
    // against NOT happening silently.
    if (allowUpdate && !isBootstrapCall && allowReason !== 'panel-user-tap' && lookupScreenId && tenantCanaryPct < 100) {
      const inCohort = isInCanaryCohort(lookupScreenId, tenantCanaryPct);
      if (!inCohort) {
        allowUpdate = false;
        allowReason = `${allowReason}-canary-blocked-pct${tenantCanaryPct}`;
        this.logger.log(
          `[ota] canary-gate-blocked screen=${lookupScreenId} ` +
          `tenant=${lookupTenantId} pct=${tenantCanaryPct}`,
        );
      } else {
        allowReason = `${allowReason}-canary-cohort-pct${tenantCanaryPct}`;
      }
    }

    if (!allowUpdate) {
      this.logger.log(
        `[ota] decision=uptoDate caller=${callerVn} screen=${lookupScreenId || '-'} ` +
        `tenant=${lookupTenantId || '-'} fp=${fpShort} reason=${allowReason}`,
      );
      return { uptoDate: true };
    }
    this.logger.log(
      `[ota] decision=offer-latest caller=${callerVn} screen=${lookupScreenId || '-'} ` +
      `tenant=${lookupTenantId || '-'} fp=${fpShort} reason=${allowReason}`,
    );
    // Forensic parity with dashboard pushes: a panel-tap-authorized offer
    // writes its own audit row, so "who updated this screen" is always
    // answerable. Device-authenticated (see the branch above) → not the
    // unauthenticated audit-spam vector OTA-01 warned about; per-screen
    // 10-min dedup bounds retry noise on a flaky install.
    if (allowReason === 'panel-user-tap' && lookupScreenId && lookupTenantId) {
      const lastAudit = PlayerOtaController.userTapAuditAt.get(lookupScreenId) || 0;
      if (Date.now() - lastAudit > 10 * 60_000) {
        PlayerOtaController.userTapAuditAt.set(lookupScreenId, Date.now());
        this.prisma.client.auditLog
          .create({
            data: {
              action: 'PANEL_USER_UPDATE',
              targetType: 'screen',
              targetId: lookupScreenId,
              tenantId: lookupTenantId,
              userId: null,
              details: JSON.stringify({
                screenName: lookupScreenName,
                source: 'panel-user-tap',
                fromVersion: callerVn,
              }),
            },
          })
          .catch(() => { /* best-effort — never block an offer on audit */ });
      }
    }
    // 2026-04-28 — DO NOT clear the flag here.
    // Operator: 'i rebooted the player and nothing fucking happened
    // ... we are 16 versions of the player in and i asked for OTA
    // on the first version'.
    //
    // Old behavior (BUG): we cleared the flag the moment we handed
    // back a download URL. If the kiosk's install failed silently
    // (permission, download error, signature mismatch, etc), the
    // flag was already gone and subsequent /update-check polls
    // returned uptoDate forever — the kiosk got stuck on an old
    // version with no way for the dashboard to retry.
    //
    // New behavior: keep the flag until persistReportedVersion sees
    // a versionCode bump (above) — that's the only proof the install
    // actually landed. The 24h auto-stale window still applies as a
    // safety net so a permanently-failing kiosk doesn't loop forever.
    if (forcedPendingScreenId) {
      this.logger.log(
        `[ota] flag-kept-until-install-confirms screen=${forcedPendingScreenId}`,
      );
    }

    // 2026-05-15 — Path A (PLAYER_APK_LATEST_VERSION_CODE env-var
    // pinning) REMOVED. It was a footgun: ops had to hand-edit the
    // Railway env vars on every release, the running API process only
    // picked up the change on a redeploy, and a stale env var silently
    // PINNED the whole fleet to an old build — `callerVc >= latestVc`
    // returned `uptoDate` with no error anywhere. This happened twice
    // (fleet stuck at v1.0.55, then again at v1.0.63). Path B below
    // auto-resolves the latest `player-v*` GitHub Release, so a
    // release is now exactly "push the tag" — no Railway touch, no
    // env var to go stale. The PLAYER_APK_* env vars are now inert
    // and should be deleted from Railway.

    // ── Path B: auto-resolve from the latest GitHub Release ──
    // Zero env config required. Mirrors /apk/latest so every tagged
    // player-v* release is live for OTA within ~5 min of publish (the
    // GitHub API lookup cache TTL). Operators just push the tag and
    // every paired kiosk pulls the update on its next 6h poll.

    // Normalise the reported ABI. Trim whitespace; lower-case for
    // case-insensitive asset-name comparisons (P0 audit fix 2026-04-27).
    const callerAbi = String(body?.abi || '').trim().toLowerCase();

    try {
      // Pass the caller's ABI so we select the right per-ABI APK asset
      // (P0 audit fix 2026-04-27 — old code always preferred arm64-v8a
      // regardless of what the device reported, breaking armeabi-v7a
      // Rockchip RK3288 kiosks which would receive an APK that won't
      // install).
      const info = await resolveLatestReleaseInfo(callerAbi);
      if (!info) {
        // resolveLatestReleaseInfo returns null either when GitHub has no
        // player-v* release at all, or when no APK asset is compatible
        // with the caller's ABI. Distinguish in the log so ops can tell
        // "release missing" from "ABI mismatch."
        const noReleaseAtAll = !releaseAssetsCache || releaseAssetsCache.assets.length === 0;
        const reason = noReleaseAtAll
          ? 'resolveLatestReleaseInfo-no-player-release'
          : `no-compatible-apk-for-abi:${callerAbi || 'unknown'}`;
        this.logger.warn(
          `[ota] decision=uptoDate-no-release caller=${callerVn} screen=${lookupScreenId || '-'} ` +
          `abi=${callerAbi || 'not-reported'} reason=${reason}`,
        );
        if (!noReleaseAtAll && callerAbi) {
          // Surface a clear signal to the client: we have a release but
          // not for their ABI. Return uptoDate so they don't loop, but
          // include a diagnostic field.
          return { uptoDate: true, noCompatibleApk: true, reportedAbi: callerAbi };
        }
        return { uptoDate: true };
      }

      // Compare versionNames semver-style. If the caller is already at
      // or past the release tag, no update needed — this is the loop
      // breaker (the client's BuildConfig.VERSION_CODE is typically much
      // smaller than the derived versionCode we return below, so we
      // CANNOT rely on versionCode alone for the uptoDate check).
      if (callerVn && callerVn !== '?' && semverGte(callerVn, info.versionName)) {
        this.logger.log(
          `[ota] decision=uptoDate-gh caller=${callerVn} latest=${info.versionName} ` +
          `screen=${lookupScreenId || '-'} abi=${callerAbi || 'not-reported'} ` +
          `reason=caller-at-or-past-latest-published-tag`,
        );
        return { uptoDate: true, latestVersionName: info.versionName };
      }

      // ── Signing-cutover gate (2026-08-03) ──────────────────────────
      // A pre-v1.1.0 `-debug` install can NEVER take this update: the
      // applicationId and the signing key both changed at v1.1.0, and
      // Android refuses either transition. Offering it anyway means a
      // ~6 MB download + failed install + ERROR report every 6h poll,
      // forever. Answer with needsManualReinstall instead — the
      // dashboard turns that into the reinstall-tour checklist.
      // Bootstrap calls are exempt at this line by construction
      // (isBootstrapCall handled the fresh-kiosk case above, and a
      // fresh install crosses no boundary — it is a NEW package).
      if (!isBootstrapCall && blockedBySigningCutover(callerVn, info.versionName)) {
        this.logger.warn(
          `[ota] decision=uptoDate-signing-cutover caller=${callerVn} ` +
          `target=v${info.versionName} screen=${lookupScreenId || '-'} ` +
          `tenant=${lookupTenantId || '-'} fp=${fpShort} — this screen needs a ` +
          `HANDS-ON reinstall (package id + signing key changed at v1.1.0; ` +
          `runbook apps/player/RELEASE_SIGNING.md)`,
        );
        return {
          uptoDate: true,
          needsManualReinstall: true,
          latestVersionName: info.versionName,
        };
      }

      // Return a versionCode strictly greater than the caller's so the
      // APK's own `latestVc <= BuildConfig.VERSION_CODE` gate clears
      // and it proceeds with the download (see OtaUpdateWorker.kt:91).
      // If the derived value is somehow smaller than the caller's —
      // e.g. someone hand-installed a dev build with versionCode 9999 —
      // bump it to caller+1 so they still update to the tag build.
      const derivedVc = Math.max(info.derivedVersionCode, callerVc + 1);
      // SHA-256 of the artifact, computed from the SAME authenticated
      // bytes our /apk/v/:vc proxy serves (private repo since 2026-08-01:
      // anonymous asset fetches 404, and unauthenticated hashing was
      // theatre anyway). Because the kiosk now downloads THROUGH that
      // proxy, this digest is exact transport integrity: the device
      // installs byte-for-byte what the server hashed, even if the
      // upstream asset is later swapped (the cache is immutable per
      // versionCode). Provenance is still the out-of-band pin below.
      //
      // Fail closed when the digest cannot be computed at all (release
      // missing, GH_TOKEN absent/expired, GitHub 5xx): the kiosk's Kotlin
      // verifier skips checking on an empty SHA, which would leave an
      // install-unverified-APK window.
      const sha256 = await shaViaProxyCache('player', info.derivedVersionCode);
      if (!sha256) {
        this.logger.warn(
          `[ota] decision=uptoDate-no-sha caller=${callerVn} target=v${info.versionName} ` +
          `abi=${callerAbi || 'not-reported'} ` +
          `reason=apk-bytes-unfetchable-for-sha (FAIL-CLOSED — check GH_TOKEN on Railway)`,
        );
        return { uptoDate: true };
      }

      // ── OTA-03/04/05 — the server's own opinion about these bytes ──────
      // URL scheme + host allowlist (evaluated against the UPSTREAM GitHub
      // asset URL — the provenance of the bytes — not the proxy URL we
      // advertise), anti-rollback floor, per-build quarantine, and the
      // out-of-band digest pin. Fail CLOSED and loud: returning uptoDate
      // holds the fleet on its current build, which is always safer than
      // installing bytes we decline to vouch for.
      const verdict = evaluateReleaseForFleet({
        versionName: info.versionName,
        apkUrl: info.apkUrl,
        computedSha: sha256,
      });
      if (!verdict.allowed) {
        this.logger.error(
          `[ota][security] decision=uptoDate-release-refused caller=${callerVn} ` +
          `target=v${info.versionName} screen=${lookupScreenId || '-'} ` +
          `reason=${verdict.reason} (FAIL-CLOSED — nothing advertised)`,
        );
        return { uptoDate: true };
      }

      // Advertise OUR versioned proxy, not GitHub. Three reasons, each
      // sufficient: (1) the repo is private — `browser_download_url` is a
      // 404 for the anonymous kiosk; (2) GitHub's CDN throttles sustained
      // anonymous downloads to a crawl (the 13-minute-APK bug, 2026-05-12);
      // (3) the proxy serves the exact bytes the sha256 above was computed
      // from. Built from the request's own Host — that is by definition the
      // `api_root` the device already validated against its native
      // HostAllowlist, so the download URL passes the same check. NOTE:
      // deliberately info.derivedVersionCode (the real release), not the
      // caller-bumped `derivedVc` — the proxy decodes vc → tag.
      const origin = apiOriginFromRequest(req);
      const advertisedApkUrl = origin
        ? `${origin}/api/v1/player/apk/v/${info.derivedVersionCode}`
        : info.apkUrl;

      this.logger.log(
        `[ota] decision=install-gh caller=${callerVn} target=v${info.versionName} ` +
        `screen=${lookupScreenId || '-'} abi=${callerAbi || 'not-reported'} ` +
        `url=${advertisedApkUrl.slice(0, 80)} sha=${sha256.slice(0, 12)} ` +
        `provenance=${verdict.pinned ? 'sha-pinned' : 'UNPINNED-transport-integrity-only'}`,
      );
      return {
        latest: {
          versionCode: derivedVc,
          versionName: info.versionName,
          apkUrl: advertisedApkUrl,
          sha256,
          forced: false,
        },
      };
    } catch (e: any) {
      this.logger.warn(`GitHub OTA lookup failed, reporting uptoDate: ${e?.message}`);
      return { uptoDate: true };
    }
  }

  /**
   * GET /api/v1/player/latest-version
   *
   * Returns the latest published player APK version so the dashboard
   * can show "Current vX.X.X · Latest vY.Y.Y" + a Push button on each
   * screen card. Resolves from the same source as /update-check
   * (env-pin first, GitHub Releases second). Admin-callable.
   *
   * player-008 fix: previously this endpoint was unauthenticated and
   * unthrottled. Anonymous callers could (a) enumerate the upstream
   * GitHub release URL and SHA, leaking the exact APK build chain, and
   * (b) DoS the GitHub Releases API by churning the cache through the
   * server. Gate behind JwtAuthGuard + RbacGuard (admin roles only —
   * the dashboard's "current vs latest" chip is the only legitimate
   * caller) and add a throttle that matches /update-check's pattern.
   */
  @Get('latest-version')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
  )
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async getLatestVersion() {
    // 2026-05-15 — the PLAYER_APK_* env-var override was removed here
    // too (see /update-check). The latest version is whatever the
    // newest player-v* GitHub Release is — single source of truth.
    // 2026-09-01 (operator: "if the player is on the latest version but the
    // manager is not, there is no way to push the updated manager") — the
    // dashboard's push button graded ONLY the Player version, so a screen on
    // the current Player with a stale Manager showed "On latest" and a
    // disabled button. Carry the latest Manager version alongside so the
    // menu can grade both. Best-effort and independent: a Manager lookup
    // failure never hides the Player answer (null = unknown, never "stale").
    const manager = await this.latestManagerVersionBestEffort('/latest-version');
    try {
      const info = await resolveLatestReleaseInfo();
      if (info) {
        return {
          versionName: info.versionName,
          versionCode: info.derivedVersionCode,
          source: 'github',
          ...manager,
        };
      }
    } catch (e: any) {
      this.logger.warn(`/latest-version GitHub lookup failed: ${e?.message}`);
    }
    return { versionName: null, versionCode: null, source: 'unknown', ...manager };
  }

  /**
   * Latest published Manager APK version, for the dashboard's per-screen
   * "current vs latest" grading of the companion (see /latest-version).
   * Resolves from the same source as /manager-update-check. Never throws;
   * unknown is `null` on both fields so a caller can only ever grade
   * "stale" against a real version.
   */
  private async latestManagerVersionBestEffort(
    route: string,
  ): Promise<{ managerVersionName: string | null; managerVersionCode: number | null }> {
    try {
      const info = await resolveLatestManagerReleaseInfo();
      if (info?.versionName) {
        return {
          managerVersionName: info.versionName,
          managerVersionCode: info.derivedVersionCode ?? null,
        };
      }
    } catch (e: any) {
      this.logger.warn(`${route} Manager GitHub lookup failed: ${e?.message}`);
    }
    return { managerVersionName: null, managerVersionCode: null };
  }

  /**
   * GET /api/v1/player/latest-version-public
   *
   * 2026-05-04 — operator: "why doesnt it know that there is an update
   * pending to go to .44?". Cause: paired kiosks were calling
   * /latest-version (above) which is admin-auth-gated. A device token
   * isn't an admin token, so the fetch failed with 401, `latestApkVersion`
   * stayed null on the splash, and the "Update available" banner never
   * rendered.
   *
   * This route is the public-safe twin: returns ONLY versionName +
   * versionCode (NO apkUrl, NO commit SHA, NO release notes — the
   * security concern from player-008 was leaking the exact build
   * chain. Just the version digits is fine to expose anonymously —
   * any visitor to github.com/gschiemann/EDUCMS/releases sees the
   * same numbers).
   *
   * Throttled aggressively (30/min/IP) to prevent GitHub-API DoS via
   * cache churn. Kiosk's natural call rate is ~1/min so well under.
   */
  @Get('latest-version-public')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async getLatestVersionPublic() {
    // 2026-05-15 — PLAYER_APK_* env-var override removed (see
    // /update-check). Latest = newest player-v* GitHub Release.
    // Version digits only, for both APKs (the Manager digits are as public
    // as the Player's — same Releases page). The kiosk splash uses the
    // Manager pair to say "companion update available" honestly.
    const manager = await this.latestManagerVersionBestEffort('/latest-version-public');
    try {
      const info = await resolveLatestReleaseInfo();
      if (info) {
        return {
          versionName: info.versionName,
          versionCode: info.derivedVersionCode,
          ...manager,
        };
      }
    } catch (e: any) {
      this.logger.warn(`/latest-version-public GitHub lookup failed: ${e?.message}`);
    }
    return { versionName: null, versionCode: null, ...manager };
  }

  /**
   * GET /api/v1/player/manager-apk/latest
   *
   * Returns the URL of the latest published Manager APK as a 302
   * redirect (or pipes it through if no env override).
   *
   * Used by Player's first-launch ManagerBootstrap path so a single
   * "Download Player APK" trip from the dashboard installs both
   * Player AND Manager. Player downloads itself first (the operator's
   * sideload), then on first launch fetches Manager from this URL
   * and installs it (silently if signage hardware grants
   * INSTALL_PACKAGES, with one prompt otherwise).
   *
   * Same caching semantics as /apk/latest — the resolved release URL
   * is cached 5 min in-memory to keep us under GitHub's anonymous
   * 60 req/hr limit.
   */
  @Get('manager-apk/latest')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async redirectToLatestManagerApk(@Res() res: Response) {
    try {
      // 302 to OUR versioned proxy (relative, so it stays on whatever
      // host the caller reached us at). The old redirect went straight to
      // `browser_download_url`, which is a 404 for anonymous callers now
      // that the repo is private — and was CDN-throttled even before.
      const info = await resolveLatestManagerReleaseInfo();
      if (info?.derivedVersionCode) {
        res.redirect(302, `/api/v1/player/manager-apk/v/${info.derivedVersionCode}`);
        return;
      }
    } catch (e: any) {
      this.logger.warn(`GitHub manager release lookup failed: ${e?.message}`);
    }
    res.status(404).json({
      error: 'No Manager APK is published yet. Tag a manager-v* GitHub Release.',
    });
  }

  /**
   * POST /api/v1/player/manager-update-check
   *
   * Manager's self-upgrade endpoint. Mirrors /update-check but for the
   * Manager APK itself (com.educms.manager). The Manager's
   * ManagerSelfUpdateWorker polls this every 30 min so it keeps itself
   * current without sideloading.
   *
   * Operator (2026-04-28): 'i dont want to side load any fucking
   * thing after this next build'. This endpoint + the worker is what
   * makes that promise possible. Once Manager v1.0.2 is sideloaded,
   * every subsequent Manager release auto-installs silently.
   *
   * No flag-gating like /update-check uses for Player — Manager
   * updates are always opt-in (the operator chose to install
   * Manager) and shouldn't surprise anyone, since Manager is a
   * background daemon and updates don't visibly disrupt screens.
   */
  @Post('manager-update-check')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async managerUpdateCheck(@Body() body: UpdateCheckBody, @Req() req?: ExpressReq) {
    const callerVn = String(body?.versionName || '').trim() || '?';
    const callerVc = Number(body?.versionCode) || 0;
    const fp = (body?.fingerprint || '').trim();
    const fpShort = fp ? fp.slice(0, 10) : 'no-fp';
    const callerAbi = String(body?.abi || '').trim().toLowerCase();

    // Persist the reported Manager version to the screen row so the
    // dashboard's chip stays in sync. Best-effort.
    if (fp && callerVn) {
      this.prisma.client.screen
        .updateMany({
          where: { deviceFingerprint: fp },
          data: {
            managerVersion: callerVn,
            managerVersionAt: new Date(),
          } as any,
        })
        .catch(() => { /* swallow */ });
    }

    try {
      const info = await resolveLatestManagerReleaseInfo(callerAbi);
      if (!info) {
        this.logger.warn(
          `[mgr-ota] decision=uptoDate-no-release caller=${callerVn} fp=${fpShort} ` +
          `reason=resolveLatestManagerReleaseInfo-returned-null`,
        );
        return { uptoDate: true };
      }

      // Compare versionNames semver-style. If the caller is already
      // at-or-past, no update needed. Same loop-breaker the Player
      // /update-check uses.
      if (callerVn && callerVn !== '?' && semverGte(callerVn, info.versionName)) {
        this.logger.log(
          `[mgr-ota] decision=uptoDate caller=${callerVn} latest=${info.versionName} fp=${fpShort}`,
        );
        return { uptoDate: true, latestVersionName: info.versionName };
      }

      // Signing-cutover gate — same boundary as the Player path. A
      // `-debug` Manager (com.educms.manager.debug, compromised key) can
      // never install a release-signed manager-v1.1.0+; don't make it
      // download-and-fail every 30 min. No bootstrap exemption here: a
      // fresh kiosk gets its Manager from the bundled asset or
      // /manager-apk/latest, never from this self-update endpoint.
      if (blockedBySigningCutover(callerVn, info.versionName)) {
        this.logger.warn(
          `[mgr-ota] decision=uptoDate-signing-cutover caller=${callerVn} ` +
          `target=v${info.versionName} fp=${fpShort} — hands-on reinstall required`,
        );
        return {
          uptoDate: true,
          needsManualReinstall: true,
          latestVersionName: info.versionName,
        };
      }

      const derivedVc = Math.max(info.derivedVersionCode, callerVc + 1);
      // SHA from the authenticated proxy-cache bytes — same rationale as
      // /update-check (private repo; exact transport integrity). FAIL
      // CLOSED on empty.
      const sha256 = await shaViaProxyCache('manager', info.derivedVersionCode);
      if (!sha256) {
        this.logger.warn(
          `[mgr-ota] decision=uptoDate-no-sha caller=${callerVn} target=v${info.versionName} ` +
          `reason=apk-bytes-unfetchable-for-sha (FAIL-CLOSED — check GH_TOKEN on Railway)`,
        );
        return { uptoDate: true };
      }
      // Full policy gate — parity with the Player path (2026-08-03). The
      // Manager APK is the component that INSTALLS the Player, so it gets
      // the URL allowlist AND the floor / quarantine / pin checks, not
      // just the URL check it had before. Evaluated against the UPSTREAM
      // GitHub asset URL (provenance), not the proxy URL we advertise.
      const verdict = evaluateManagerReleaseForFleet({
        versionName: info.versionName,
        apkUrl: info.apkUrl,
        computedSha: sha256,
      });
      if (!verdict.allowed) {
        this.logger.error(
          `[mgr-ota][security] decision=uptoDate-release-refused caller=${callerVn} ` +
          `target=v${info.versionName} fp=${fpShort} reason=${verdict.reason} (FAIL-CLOSED)`,
        );
        return { uptoDate: true };
      }
      const origin = apiOriginFromRequest(req);
      const advertisedApkUrl = origin
        ? `${origin}/api/v1/player/manager-apk/v/${info.derivedVersionCode}`
        : info.apkUrl;
      this.logger.log(
        `[mgr-ota] decision=install caller=${callerVn} target=v${info.versionName} fp=${fpShort} ` +
        `url=${advertisedApkUrl.slice(0, 80)} sha=${sha256.slice(0, 12)} ` +
        `provenance=${verdict.pinned ? 'sha-pinned' : 'UNPINNED-transport-integrity-only'}`,
      );
      return {
        latest: {
          versionCode: derivedVc,
          versionName: info.versionName,
          apkUrl: advertisedApkUrl,
          sha256,
          forced: false,
        },
      };
    } catch (e: any) {
      this.logger.warn(`[mgr-ota] lookup failed: ${e?.message}`);
      return { uptoDate: true };
    }
  }

  @Get('apk/latest')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async redirectToLatestApk(@Res() res: Response) {
    // Self-healing: prefer an explicit PLAYER_APK_URL override, else
    // auto-track the latest release. When PLAYER_APK_URL is unset we
    // resolve the newest player-v* release and 302 to the FAST Railway
    // proxy (/apk/v/:vc — uncapped egress), NOT GitHub's CDN which
    // throttles unauthenticated downloads to a crawl. This keeps the
    // 'Download APK' button current with zero env config — nothing to
    // set, nothing to go stale on each release. Cached 5 min.
    const explicit = process.env.PLAYER_APK_URL;
    if (explicit) {
      // OTA-04: this 302'd to the env value VERBATIM — no scheme check, no
      // host check. A mis-set (or maliciously set) variable pointed every
      // operator clicking "Download Player APK" at an arbitrary host over
      // plain http. Allow a same-origin relative path (that is the
      // documented `/api/v1/player/apk/v/:vc` self-proxy form) and
      // otherwise require an allowlisted https host.
      const isRelative = explicit.startsWith('/');
      if (isRelative || isAllowedApkUrl(explicit)) {
        res.redirect(302, explicit);
        return;
      }
      this.logger.error(
        `[ota][security] PLAYER_APK_URL is not an allowlisted https URL — ignoring it ` +
        `and falling back to the resolved GitHub release. Fix the env var or add its ` +
        `host to PLAYER_APK_HOST_ALLOWLIST.`,
      );
    }

    try {
      const info = await resolveLatestReleaseInfo();
      if (info?.derivedVersionCode) {
        res.redirect(302, `/api/v1/player/apk/v/${info.derivedVersionCode}`);
        return;
      }
    } catch (e: any) {
      this.logger.warn(`GitHub release lookup failed: ${e?.message}`);
    }

    // Artifact fallback — if no Releases exist yet, serve the most
    // recent successful workflow artifact directly. Requires GH_TOKEN
    // env on Railway (same token scope the release lookup uses).
    // Unlike Releases (public), artifacts require auth even for public
    // repos, so we proxy the bytes through the server. Cached so we
    // don't re-download on every hit.
    try {
      const proxied = await serveLatestArtifactApk(res);
      if (proxied) return;
    } catch (e: any) {
      this.logger.warn(`Artifact proxy failed: ${e?.message}`);
    }

    res.status(503).json({
      error: true,
      message:
        'No player APK is published yet. Tag a GitHub Release on gschiemann/EDUCMS with the built APK attached, or set PLAYER_APK_URL on Railway, or set GH_TOKEN so we can proxy the latest CI artifact.',
    });
  }

  // ─── Versioned APK proxy — fast fiber-egress alternative to GitHub Releases ───
  //
  // Operator (2026-05-12): "the download is crawling, that's a bug somewhere
  // in your workflow, this is a tiny file i download in 2 seconds"
  //
  // Diagnosis: GitHub Releases' object-storage CDN
  // (objects.githubusercontent.com) rate-limits sustained unauthenticated
  // downloads. On The Den's last upgrade we measured a fast burst then a
  // 1.7 KB/s sustained throttle — a 12 MB APK took 13 minutes when the
  // kiosk's fiber could have done it in <1s.
  //
  // Fix: kiosks now download the APK FROM RAILWAY at /api/v1/player/apk/v/:vc.
  // Railway's egress is uncapped on its standard plan. The first fetch
  // for a given versionCode pulls the asset from GitHub (using the
  // GH_TOKEN env so it's an *authenticated* download — those don't
  // throttle) into an in-memory cache, then every subsequent kiosk
  // request streams from cache at full speed.
  //
  // Set PLAYER_APK_URL on Railway to point at this endpoint instead of
  // the GitHub Releases URL: e.g.
  //   PLAYER_APK_URL=https://api-production-39a1.up.railway.app/api/v1/player/apk/v/10054
  // Kiosks will get the bytes through Railway from the moment that env
  // var changes; no APK reissue needed.
  @Get('apk/v/:vc')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async streamApkByVersionCode(
    @Param('vc') vcParam: string,
    @Res() res: Response,
  ): Promise<void> {
    const vc = parseInt(vcParam, 10);
    if (!Number.isFinite(vc) || vc <= 0) {
      throw new NotFoundException({ code: 'PLAYER_OTA_INVALID_VERSION_CODE', message: `Invalid versionCode: ${vcParam}` });
    }
    try {
      const buf = await ensureApkInCache('player', vc);
      if (!buf) {
        throw new NotFoundException({
          code: 'PLAYER_OTA_APK_NOT_FOUND',
          message: `Player APK v${vc} not found. Either no GitHub release exists with that ` +
          `versionCode-derived tag, or GH_TOKEN is missing on Railway.`,
        });
      }
      res.setHeader('Content-Type', 'application/vnd.android.package-archive');
      res.setHeader('Content-Length', String(buf.length));
      // 2026-05-26 — operator: "the apk downloads as edu cms player
      // from settings, that should say VenueOS Player". The legacy
      // filename was a holdover from the EDU CMS rebrand era. Only
      // the OPERATOR-FACING download filename changes here — the
      // GitHub release asset name (line 859) + artifact name (line
      // 912) + Android UA regex in screens.controller.ts stay
      // untouched because they're coordinated with CI + the Kotlin
      // UA emit and renaming them without that coordination would
      // break OTA for the existing fleet.
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="venue-os-player-vc${vc}.apk"`,
      );
      // 24h cache is fine — content is immutable per versionCode.
      res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
      res.end(buf);
    } catch (e: any) {
      if (e instanceof NotFoundException) throw e;
      this.logger.error(`APK proxy v${vc} failed: ${e?.message}`, e?.stack);
      throw new NotFoundException({ code: 'PLAYER_OTA_APK_PROXY_FAILED', message: `APK proxy failed: ${e?.message}` });
    }
  }

  /**
   * GET /api/v1/player/manager-apk/v/:vc — the Manager twin of
   * /apk/v/:vc. Added 2026-08-03: Manager self-update and the
   * /manager-apk/latest bootstrap redirect both used to hand out
   * `browser_download_url`, which anonymous kiosks cannot fetch from a
   * private repo (and which GitHub's CDN throttles regardless). Same
   * authenticated-fetch + in-memory LRU as the Player proxy.
   */
  @Get('manager-apk/v/:vc')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async streamManagerApkByVersionCode(
    @Param('vc') vcParam: string,
    @Res() res: Response,
  ): Promise<void> {
    const vc = parseInt(vcParam, 10);
    if (!Number.isFinite(vc) || vc <= 0) {
      throw new NotFoundException({ code: 'PLAYER_OTA_INVALID_VERSION_CODE', message: `Invalid versionCode: ${vcParam}` });
    }
    try {
      const buf = await ensureApkInCache('manager', vc);
      if (!buf) {
        throw new NotFoundException({
          code: 'PLAYER_OTA_MANAGER_APK_NOT_FOUND',
          message: `Manager APK v${vc} not found. Either no GitHub release exists with that ` +
          `versionCode-derived tag, or GH_TOKEN is missing on Railway.`,
        });
      }
      res.setHeader('Content-Type', 'application/vnd.android.package-archive');
      res.setHeader('Content-Length', String(buf.length));
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="venue-os-manager-vc${vc}.apk"`,
      );
      res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
      res.end(buf);
    } catch (e: any) {
      if (e instanceof NotFoundException) throw e;
      this.logger.error(`Manager APK proxy v${vc} failed: ${e?.message}`, e?.stack);
      throw new NotFoundException({ code: 'PLAYER_OTA_APK_PROXY_FAILED', message: `Manager APK proxy failed: ${e?.message}` });
    }
  }
}

/**
 * The public origin the caller reached this API at — `https://<host>` from
 * the request's own Host header. That host IS the device's `api_root` (the
 * OTA worker POSTs update-check to it), so a download URL built on it is
 * guaranteed to pass the device's native HostAllowlist. Behind Railway,
 * `req.protocol` honors X-Forwarded-Proto via the app's trust-proxy
 * setting; anything non-http is coerced to https (the device refuses plain
 * http anyway, except its compiled-in loopback dev exemption).
 */
function apiOriginFromRequest(req?: ExpressReq): string | null {
  try {
    const host = req?.get?.('host');
    if (!host) return null;
    const proto = req?.protocol === 'http' ? 'http' : 'https';
    return `${proto}://${host}`;
  } catch {
    return null;
  }
}

// ─── APK byte cache (process-local, in-memory) ───
// Keyed by `${kind}:${versionCode}` — the same cache serves the Player
// AND Manager proxies plus the sha computation, so each artifact is
// fetched from GitHub exactly once per process. First fetch
// authenticates against the GitHub API (mandatory since the repo went
// private on 2026-08-01, and rate-limit-free as a bonus); future
// requests serve from cache. APKs are immutable per versionCode so the
// cache never goes stale.
//
// Memory ceiling: 5 entries max (LRU eviction). Each APK is 4–12 MB,
// so worst case ~60 MB resident — well within Railway's container.
type ApkKind = 'player' | 'manager';
interface VersionedApkCache {
  key: string;
  buf: Buffer;
  fetchedAt: number;
}
const versionedApkCache = new Map<string, VersionedApkCache>();
const VERSIONED_APK_CACHE_LIMIT = 5;

/**
 * Shared header set for every GitHub API call in this file. The token is
 * NOT optional in practice: the repo is private, so an unauthenticated
 * call 404s — but we still degrade gracefully (callers fail closed to
 * `uptoDate`) rather than throwing, and every failure log says whether
 * a token was present so ops can tell "missing GH_TOKEN" from a GitHub
 * outage in one glance.
 */
function githubApiHeaders(accept = 'application/vnd.github+json'): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': 'edu-cms-player-ota',
    'Accept': accept,
  };
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

function hasGithubToken(): boolean {
  return !!(process.env.GH_TOKEN || process.env.GITHUB_TOKEN);
}

async function ensureApkInCache(kind: ApkKind, vc: number): Promise<Buffer | null> {
  const key = `${kind}:${vc}`;
  const hit = versionedApkCache.get(key);
  if (hit) {
    // LRU bump — re-insert so it's most-recently-used.
    versionedApkCache.delete(key);
    versionedApkCache.set(key, hit);
    return hit.buf;
  }
  const repo = process.env.PLAYER_APK_GITHUB_REPO || 'gschiemann/EDUCMS';
  // Convert versionCode → vname per the repo's encoding formula
  // major*10000 + minor*100 + patch (e.g. 10054 → 1.0.54).
  const major = Math.floor(vc / 10000);
  const minor = Math.floor((vc % 10000) / 100);
  const patch = vc % 100;
  const versionName = `${major}.${minor}.${patch}`;
  const tag = `${kind}-v${versionName}`;
  const expectedAssetName = `edu-cms-${kind}-v${versionName}.apk`;

  // 1) Resolve tag → release → asset id.
  const relResp = await fetch(
    `https://api.github.com/repos/${repo}/releases/tags/${tag}`,
    { headers: githubApiHeaders() },
  );
  if (!relResp.ok) return null;
  const release = (await relResp.json()) as {
    assets?: Array<{ id: number; name: string; size: number; url: string }>;
  };
  const assets = release.assets || [];
  // Exact CI naming first; fall back to any non-x86 .apk so a renamed
  // asset degrades to "still serveable" instead of a fleet-wide 404
  // (current releases attach exactly ONE universal APK).
  const asset =
    assets.find((a) => a.name === expectedAssetName) ||
    assets.find((a) => a.name.toLowerCase().endsWith('.apk') && !a.name.toLowerCase().includes('x86'));
  if (!asset) return null;

  // 2) Fetch asset bytes. The `url` field on the asset returns metadata
  // by default; setting Accept: application/octet-stream gets the
  // binary. With token, this is the AUTHENTICATED path — no throttle.
  const dlResp = await fetch(asset.url, {
    headers: githubApiHeaders('application/octet-stream'),
    redirect: 'follow',
  });
  if (!dlResp.ok) return null;
  const buf = Buffer.from(await dlResp.arrayBuffer());

  // LRU eviction.
  while (versionedApkCache.size >= VERSIONED_APK_CACHE_LIMIT) {
    const oldestKey = versionedApkCache.keys().next().value as string | undefined;
    if (oldestKey == null) break;
    versionedApkCache.delete(oldestKey);
  }
  versionedApkCache.set(key, { key, buf, fetchedAt: Date.now() });
  // Silence the unused Readable warning if streaming isn't used.
  void Readable;
  return buf;
}

// SHA-256 per artifact, computed from the proxy-cache bytes — i.e. the
// exact bytes a kiosk downloading through /apk/v/:vc will receive.
// Immutable per versionCode, so entries never expire. Tiny (64 hex chars
// per release), so no eviction needed.
const apkShaCache = new Map<string, string>();
async function shaViaProxyCache(kind: ApkKind, vc: number): Promise<string> {
  if (!Number.isFinite(vc) || vc <= 0) return '';
  const key = `${kind}:${vc}`;
  const hit = apkShaCache.get(key);
  if (hit) return hit;
  try {
    const buf = await ensureApkInCache(kind, vc);
    if (!buf) return '';
    const sha = require('crypto').createHash('sha256').update(buf).digest('hex');
    apkShaCache.set(key, sha);
    return sha;
  } catch {
    return '';
  }
}

interface ArtifactCache { buf: Buffer | null; etag: string; ts: number }
let artifactCache: ArtifactCache | null = null;
const ARTIFACT_TTL_MS = 10 * 60 * 1000;

async function serveLatestArtifactApk(res: Response): Promise<boolean> {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) return false;
  const repo = process.env.PLAYER_APK_GITHUB_REPO || 'gschiemann/EDUCMS';
  const now = Date.now();
  if (!artifactCache || now - artifactCache.ts > ARTIFACT_TTL_MS) {
    const listResp = await fetch(
      `https://api.github.com/repos/${repo}/actions/artifacts?name=edu-cms-player-apk&per_page=5`,
      { headers: { 'Authorization': `Bearer ${token}`, 'User-Agent': 'edu-cms-player-ota' } },
    );
    if (!listResp.ok) return false;
    const list = await listResp.json() as { artifacts?: Array<{ id: number; expired: boolean; archive_download_url: string }> };
    const usable = (list.artifacts || []).find((a) => !a.expired);
    if (!usable) return false;
    const dlResp = await fetch(usable.archive_download_url, {
      headers: { 'Authorization': `Bearer ${token}`, 'User-Agent': 'edu-cms-player-ota' },
    });
    if (!dlResp.ok) return false;
    const zipBuf = Buffer.from(await dlResp.arrayBuffer());
    // Extract the .apk from the artifact ZIP (GitHub wraps everything).
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(zipBuf);
    const apkFile = Object.keys(zip.files).find((n) => n.endsWith('.apk'));
    if (!apkFile) return false;
    const apkBuf = Buffer.from(await zip.file(apkFile)!.async('arraybuffer'));
    artifactCache = { buf: apkBuf, etag: String(usable.id), ts: now };
  }
  if (!artifactCache?.buf) return false;
  // Versioned filename so operators can see which build they got.
  // Embeds the GitHub artifact id as the build number. (This is the
  // CI-artifact fallback path — the normal path is a tagged Release
  // whose filename already carries the version.)
  const filename = `edu-cms-player-build${artifactCache.etag}.apk`;
  res.setHeader('Content-Type', 'application/vnd.android.package-archive');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'public, max-age=600');
  res.setHeader('ETag', artifactCache.etag);
  res.end(artifactCache.buf);
  return true;
}

// ─── GitHub Release asset resolution (cached) ──────────────────────
const RELEASE_TTL_MS = 5 * 60 * 1000;
// Module-scope logger for the resolution helpers (they live outside the
// controller class). One WARN per cache window when GitHub says no —
// with the status code and whether we sent a token, so "missing
// GH_TOKEN on a private repo" is diagnosable from a single log line.
const resolveLogger = new Logger('PlayerOTA');

// Richer release lookup used by /update-check — returns the APK URL,
// the tag-derived versionName, AND a derived versionCode in the
// A*10000 + B*100 + C scheme (1.0.5 → 10005) so we can give kiosk
// clients a number strictly greater than the versionCode they shipped
// with (BuildConfig.VERSION_CODE in build.gradle.kts). Same 5-min
// cache as the simple URL lookup to keep anonymous GitHub API usage
// well under the 60 req/hr limit.
//
// `callerAbi` — the ABI string reported by the device in the
// /update-check request body (e.g. "armeabi-v7a", "arm64-v8a",
// "x86_64"). When provided, asset selection prefers an exact-match
// APK before falling back to universal. If no compatible asset exists
// the function returns null so /update-check can return a meaningful
// error rather than silently handing a 32-bit Rockchip an arm64 APK
// that won't install (P0 audit fix 2026-04-27).
interface ReleaseInfo {
  apkUrl: string;
  versionName: string;      // "1.0.5"
  derivedVersionCode: number; // 10005 for "1.0.5"
}
// The raw release payload (assets list) is cached separately from the
// resolved ReleaseInfo so we can re-run ABI selection against the same
// asset list without an extra GitHub round-trip when different devices
// with different ABIs check in during the same 5-min window.
interface ReleaseAssetsCache {
  assets: Array<{ name: string; browser_download_url: string }>;
  tag: string;
  fetchedAt: number;
}
interface ReleaseInfoCache { info: ReleaseInfo | null; fetchedAt: number }
let releaseInfoCache: ReleaseInfoCache | null = null;
let releaseAssetsCache: ReleaseAssetsCache | null = null;

/** Pick the best APK asset for the given ABI.
 *
 *  Priority:
 *   1. Exact ABI match  (e.g. "armeabi-v7a" in the filename)
 *   2. Universal APK    ("universal" in the filename)
 *   3. null             — caller gets a "no compatible APK" response
 *
 *  The old arm64-first hard-code is gone.  arm64-v8a devices still get
 *  arm64-v8a because that's their exact match; armeabi-v7a devices get
 *  armeabi-v7a.  Devices that don't report an ABI (callerAbi is empty)
 *  fall back to universal → arm64-v8a for backwards compat.
 */
function pickApkAsset(
  assets: Array<{ name: string; browser_download_url: string }>,
  callerAbi: string,
): { name: string; browser_download_url: string } | undefined {
  const norm = (s: string) => s.toLowerCase();
  const abi = norm(callerAbi || '');
  const pick = (pred: (n: string) => boolean) =>
    assets.find((a) => pred(norm(a.name)));

  if (abi) {
    // 1. Exact ABI match
    const exact = pick((n) => n.includes(abi) && n.endsWith('.apk'));
    if (exact) return exact;
    // 2. Universal APK
    const universal = pick((n) => n.includes('universal') && n.endsWith('.apk'));
    if (universal) return universal;
    // 3. Generic non-x86 .apk fallback.
    //
    // 2026-04-28 hotfix: previously returned `undefined` here, which
    // bricked the live pilot kiosk in a "stuck on CHECKING" loop. The
    // CI workflow (`find ... -name '*.apk' | head -1`) attaches a
    // SINGLE generically-named APK to each Release (e.g.
    // `edu-cms-manager-v1.0.9.apk`) that has no ABI marker, so the
    // ABI-exact and universal probes both miss. Without this fallback
    // every ABI-aware caller got `needsUpdate=false` even though a
    // real release existed.
    //
    // The fallback excludes `x86` to avoid handing an emulator-only
    // build to an arm device. AGP debug splits with no x86 → only the
    // universal-style single APK is left, which is the right answer.
    const generic = pick((n) => n.endsWith('.apk') && !n.includes('x86'));
    if (generic) return generic;
    return undefined;
  }

  // No ABI reported (legacy callers) — use the old preference chain so
  // existing devices that don't send `abi` continue to work.
  return (
    pick((n) => n.includes('arm64-v8a') && n.endsWith('.apk')) ||
    pick((n) => n.includes('universal') && n.endsWith('.apk')) ||
    pick((n) => n.includes('armeabi-v7a') && n.endsWith('.apk')) ||
    pick((n) => n.endsWith('.apk') && !n.includes('x86'))
  );
}

async function resolveLatestReleaseInfo(callerAbi?: string): Promise<ReleaseInfo | null> {
  const now = Date.now();

  // Fetch + cache the raw release assets if the cache is stale.
  if (!releaseAssetsCache || now - releaseAssetsCache.fetchedAt >= RELEASE_TTL_MS) {
    const repo = process.env.PLAYER_APK_GITHUB_REPO || 'gschiemann/EDUCMS';

    // BUG FIX 2026-04-27: previously hit /releases/latest which returns
    // the single most-recently-published release across ALL tags. After
    // we started shipping Manager releases (manager-v1.0.0, v1.0.1) to
    // the same repo, "latest" became the Manager tag and the player-v
    // strip failed → info=null → both /latest-version and /update-check
    // returned null/uptoDate even though a real Player release existed.
    //
    // Fix: fetch the recent releases list and pick the most recent one
    // tagged player-v*. GitHub returns the list in published-desc order
    // so the first match is the latest Player release.
    const resp = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=30`, {
      headers: githubApiHeaders(),
    });
    if (!resp.ok) {
      resolveLogger.warn(
        `[ota] release-list fetch failed: HTTP ${resp.status} authed=${hasGithubToken()} ` +
        `repo=${repo} — a 404 with authed=false means GH_TOKEN is missing on a PRIVATE repo`,
      );
      releaseInfoCache = { info: null, fetchedAt: now };
      return null;
    }
    const allReleases = await resp.json() as Array<{
      tag_name?: string;
      name?: string;
      draft?: boolean;
      prerelease?: boolean;
      assets?: Array<{ name: string; browser_download_url: string }>;
    }>;
    if (!Array.isArray(allReleases)) {
      releaseInfoCache = { info: null, fetchedAt: now };
      return null;
    }
    // BUG FIX 2026-04-27 part 2: GitHub's /releases endpoint doesn't
    // sort by tag semver — it returns by internal release-id order
    // which does NOT correlate with version number (today's call
    // returned v1.0.9 ahead of v1.0.12 even though v1.0.12 is the
    // most recently published Player release). Sort explicitly.
    const playerReleases = allReleases
      .filter((r) => {
        if (r.draft || r.prerelease) return false;
        const tag = (r.tag_name || r.name || '').trim();
        return tag.startsWith('player-v');
      })
      .map((r) => {
        const tag = (r.tag_name || r.name || '').trim();
        const versionStr = tag.replace(/^player-v/, '');
        const m = versionStr.match(/^(\d+)\.(\d+)\.(\d+)/);
        const sortKey = m
          ? parseInt(m[1], 10) * 1_000_000 + parseInt(m[2], 10) * 1_000 + parseInt(m[3], 10)
          : 0;
        return { release: r, sortKey };
      })
      .filter((x) => x.sortKey > 0)
      .sort((a, b) => b.sortKey - a.sortKey);

    if (playerReleases.length === 0) {
      releaseAssetsCache = { assets: [], tag: '', fetchedAt: now };
      releaseInfoCache = { info: null, fetchedAt: now };
      return null;
    }
    const playerRelease = playerReleases[0].release;
    const tag = (playerRelease.tag_name || playerRelease.name || '').trim();
    releaseAssetsCache = { assets: playerRelease.assets || [], tag, fetchedAt: now };
  }

  // Re-run ABI-aware asset selection against the (possibly cached) asset list.
  const { assets, tag } = releaseAssetsCache;
  const chosen = pickApkAsset(assets, callerAbi || '');
  const apkUrl = chosen?.browser_download_url ?? null;

  // Strip `player-v` / leading `v`, leaving bare semver like "1.0.5".
  const versionName = tag.replace(/^player-v/, '').replace(/^v/, '');
  const match = versionName.match(/^(\d+)\.(\d+)\.(\d+)/);
  const derivedVersionCode = match
    ? parseInt(match[1], 10) * 10000 + parseInt(match[2], 10) * 100 + parseInt(match[3], 10)
    : 0;

  const info: ReleaseInfo | null = apkUrl && versionName && derivedVersionCode
    ? { apkUrl, versionName, derivedVersionCode }
    : null;
  // Cache the arm64 (no-ABI) result for /latest-version + /apk/latest which
  // don't have a caller ABI. Per-ABI lookups are NOT cached separately —
  // they re-run pickApkAsset against the already-cached asset list, which
  // is O(n) on the small assets array and adds no network cost.
  if (!callerAbi) {
    releaseInfoCache = { info, fetchedAt: now };
  }
  return info;
}

// Same pattern but for `manager-v*` tags. Called by the new
// /manager-update-check endpoint that powers Manager's self-upgrade.
let managerReleaseInfoCache: { info: ReleaseInfo | null; fetchedAt: number } | null = null;
let managerReleaseAssetsCache: ReleaseAssetsCache | null = null;
async function resolveLatestManagerReleaseInfo(callerAbi = ''): Promise<ReleaseInfo | null> {
  const now = Date.now();
  const abi = String(callerAbi || '').trim().toLowerCase();
  if (!abi && managerReleaseInfoCache && now - managerReleaseInfoCache.fetchedAt < RELEASE_TTL_MS) {
    return managerReleaseInfoCache.info;
  }

  if (!managerReleaseAssetsCache || now - managerReleaseAssetsCache.fetchedAt >= RELEASE_TTL_MS) {
    const repo = process.env.PLAYER_APK_GITHUB_REPO || 'gschiemann/EDUCMS';
    const resp = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=30`, {
      headers: githubApiHeaders(),
    });
    if (!resp.ok) {
      resolveLogger.warn(
        `[mgr-ota] release-list fetch failed: HTTP ${resp.status} authed=${hasGithubToken()} ` +
        `repo=${repo} — a 404 with authed=false means GH_TOKEN is missing on a PRIVATE repo`,
      );
      managerReleaseInfoCache = { info: null, fetchedAt: now };
      managerReleaseAssetsCache = { assets: [], tag: '', fetchedAt: now };
      return null;
    }
    const allReleases = await resp.json() as Array<{
      tag_name?: string;
      name?: string;
      draft?: boolean;
      prerelease?: boolean;
      assets?: Array<{ name: string; browser_download_url: string }>;
    }>;
    if (!Array.isArray(allReleases)) {
      managerReleaseInfoCache = { info: null, fetchedAt: now };
      managerReleaseAssetsCache = { assets: [], tag: '', fetchedAt: now };
      return null;
    }
    const managerReleases = allReleases
      .filter((r) => {
        if (r.draft || r.prerelease) return false;
        const tag = (r.tag_name || r.name || '').trim();
        return tag.startsWith('manager-v');
      })
      .map((r) => {
        const tag = (r.tag_name || r.name || '').trim();
        const versionStr = tag.replace(/^manager-v/, '');
        const m = versionStr.match(/^(\d+)\.(\d+)\.(\d+)/);
        const sortKey = m
          ? parseInt(m[1], 10) * 1_000_000 + parseInt(m[2], 10) * 1_000 + parseInt(m[3], 10)
          : 0;
        return { release: r, sortKey };
      })
      .filter((x) => x.sortKey > 0)
      .sort((a, b) => b.sortKey - a.sortKey);

    if (managerReleases.length === 0) {
      managerReleaseInfoCache = { info: null, fetchedAt: now };
      managerReleaseAssetsCache = { assets: [], tag: '', fetchedAt: now };
      return null;
    }
    const release = managerReleases[0].release;
    const tag = (release.tag_name || release.name || '').trim();
    managerReleaseAssetsCache = { assets: release.assets || [], tag, fetchedAt: now };
  }

  const { assets, tag } = managerReleaseAssetsCache;
  const chosen = pickApkAsset(assets, abi);
  const apkUrl = chosen?.browser_download_url ?? null;
  const versionName = tag.replace(/^manager-v/, '').replace(/^v/, '');
  const match = versionName.match(/^(\d+)\.(\d+)\.(\d+)/);
  const derivedVersionCode = match
    ? parseInt(match[1], 10) * 10000 + parseInt(match[2], 10) * 100 + parseInt(match[3], 10)
    : 0;

  const info: ReleaseInfo | null = apkUrl && versionName && derivedVersionCode
    ? { apkUrl, versionName, derivedVersionCode }
    : null;
  if (!abi) {
    managerReleaseInfoCache = { info, fetchedAt: now };
  }
  return info;
}

// (The old resolveLatest{Player,Manager}ReleaseSha helpers — which
// anonymously re-fetched `browser_download_url` and hashed whatever came
// back — were removed 2026-08-03. Anonymous asset fetches 404 on the
// now-private repo, and the digest belongs with the exact bytes the
// fleet actually downloads: see shaViaProxyCache above.)

/**
 * Sprint 11 Phase A — OTA maintenance-window check.
 *
 * Returns true if the current time (in `timezone`) is inside the
 * [start, end] window. Wraparound supported: start=22:00, end=04:00
 * means "10 PM to 4 AM next day."
 *
 * Inputs:
 *   start, end — "HH:MM" zero-padded 24-hour strings.
 *   timezone   — IANA name (America/Chicago, America/Los_Angeles, ...).
 *
 * Safety: if any input is malformed we default to TRUE (inside window)
 * so a bad config doesn't accidentally lock the operator out of pushing
 * updates. The schema migration default for these fields is NULL anyway,
 * which the caller treats as "no window configured" — this safety net
 * is for corrupted config rather than first-time setup.
 */
export function isInsideMaintenanceWindow(
  start: string,
  end: string,
  timezone: string,
  now: Date = new Date(),
): boolean {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = fmt.formatToParts(now);
    const hh = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10);
    const mm = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10);
    const nowMinutes = hh * 60 + mm;
    const [sh, sm] = start.split(':').map((n) => parseInt(n, 10));
    const [eh, em] = end.split(':').map((n) => parseInt(n, 10));
    if (![sh, sm, eh, em].every(Number.isFinite)) return true; // malformed → safe default
    const startMin = sh * 60 + sm;
    const endMin = eh * 60 + em;
    if (startMin === endMin) return false; // zero-length window = never
    if (startMin < endMin) {
      // Same-day window (e.g. 02:00 → 04:00).
      return nowMinutes >= startMin && nowMinutes < endMin;
    }
    // Wraparound window (e.g. 22:00 → 04:00). Inside = after start OR before end.
    return nowMinutes >= startMin || nowMinutes < endMin;
  } catch {
    return true; // bad timezone → safe default
  }
}
