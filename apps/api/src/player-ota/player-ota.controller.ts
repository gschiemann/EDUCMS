/**
 * Player OTA update endpoints.
 *
 * Two responsibilities:
 *
 * 1) POST /api/v1/player/update-check — the Android kiosk APK polls
 *    this every 6h with its current version + fingerprint + ABI. We
 *    consult `PLAYER_APK_LATEST_VERSION_CODE` + `PLAYER_APK_URL`
 *    env vars (set at release time) and reply with a pointer to the
 *    APK if the caller is stale. The actual APK is served from the
 *    GitHub Release asset URL — Railway never hosts the binary.
 *
 * 2) GET /api/v1/player/apk/latest — dashboard-facing convenience
 *    redirect so the 'Download Player APK' button in settings can
 *    link to a stable path. Issues a 302 to the current release
 *    asset (or `PLAYER_APK_URL`). Zero-auth — the APK itself is
 *    public; sideloading it does nothing without a tenant pairing
 *    code, which IS auth'd.
 *
 * This endpoint is intentionally minimal. Shipping a new version is:
 *   1. Tag a GitHub release, attach the signed APK + manifest.
 *   2. Update PLAYER_APK_URL + PLAYER_APK_LATEST_VERSION_CODE on
 *      Railway.
 *   3. Every paired device pulls the update within 6h (or on next
 *      boot, whichever comes first).
 *
 * Nova Taurus deployment: covered in docs/PLAYER_APK_NOVA_TAURUS.md
 * — the short version is "sideload the arm64-v8a APK via ViPlex
 * Express with auto-launch enabled." Once installed, this OTA flow
 * keeps it current; operators never have to re-sideload.
 */

import { Controller, Post, Get, Body, Res, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { PrismaService } from '../prisma/prisma.service';

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

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Fire-and-forget: record the APK version the caller reported onto
   * their Screen row so the /screens list can show "1.0.8" per kiosk.
   * Debounced to 25 min per screen — the APK polls every 6h anyway,
   * so this write effectively runs at most once per check-in, and
   * never blocks the update-check response. Uses updateMany so
   * missing-row cases (e.g. a preview fingerprint that never paired)
   * no-op instead of throwing.
   */
  private async persistReportedVersion(body: UpdateCheckBody): Promise<void> {
    const fp = (body?.fingerprint || '').trim();
    const vn = (body?.versionName || '').trim();
    if (!fp || !vn) return;
    const vc = Number.isFinite(body?.versionCode as number) ? Number(body?.versionCode) : null;
    try {
      await this.prisma.client.screen.updateMany({
        where: { deviceFingerprint: fp },
        data: {
          playerVersion: vn,
          playerVersionCode: vc,
          playerVersionAt: new Date(),
        },
      });
    } catch (e: any) {
      // Non-fatal — next poll will try again.
      this.logger.warn(`Version persist failed: ${e?.message}`);
    }
  }

  @Post('update-check')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async updateCheck(@Body() body: UpdateCheckBody) {
    // Fire-and-forget; don't block the response path on the write.
    this.persistReportedVersion(body).catch(() => {});

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
    const fpShort = fp ? fp.slice(0, 10) : 'no-fp';
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
    try {
      if (fp) {
        const screen = await this.prisma.client.screen.findFirst({
          where: { deviceFingerprint: fp },
          select: {
            id: true,
            tenantId: true,
            forceApkUpdatePendingAt: true,
            tenant: { select: { autoUpdatePlayerEnabled: true } },
          } as any,
        }) as any;
        if (screen) {
          lookupScreenId = screen.id;
          lookupTenantId = screen.tenantId;
        }
        if (screen?.tenant?.autoUpdatePlayerEnabled) {
          allowUpdate = true;
          allowReason = 'tenant-auto-on';
        } else if (screen?.forceApkUpdatePendingAt) {
          const ageMs = Date.now() - new Date(screen.forceApkUpdatePendingAt).getTime();
          if (ageMs < FORCE_WINDOW_MS) {
            allowUpdate = true;
            allowReason = `force-pending-${Math.round(ageMs / 1000)}s-ago`;
            forcedPendingScreenId = screen.id;
          } else {
            allowReason = `force-pending-stale-${Math.round(ageMs / 60000)}min`;
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
    // Best-effort: clear the pending flag once we hand back a
    // download URL, so the screen doesn't keep returning latest on
    // every subsequent poll within the 30-min window. The kiosk's
    // next poll AFTER install will report a higher versionName and
    // would naturally hit uptoDate, but clearing is cleaner.
    if (forcedPendingScreenId) {
      this.prisma.client.screen
        .update({ where: { id: forcedPendingScreenId }, data: { forceApkUpdatePendingAt: null } as any })
        .catch(() => { /* swallow */ });
    }

    const latestVc = parseInt(process.env.PLAYER_APK_LATEST_VERSION_CODE || '0', 10);
    const latestVn = process.env.PLAYER_APK_LATEST_VERSION_NAME || '';
    const apkUrl = process.env.PLAYER_APK_URL || '';
    const sha256 = process.env.PLAYER_APK_SHA256 || '';
    // Optional: flip this when pushing a mandatory security update. Kiosks
    // that fail the install still get re-tried on the next check.
    const forced = process.env.PLAYER_APK_FORCED === 'true';

    // ── Path A: explicit env-var pinning (production release train) ──
    // Ops set these after a deliberate rollout; wins over auto-resolve.
    if (latestVc && apkUrl) {
      if (callerVc >= latestVc) {
        this.logger.log(
          `[ota] decision=uptoDate-env caller=${callerVn} screen=${lookupScreenId || '-'} ` +
          `latestVc=${latestVc} reason=current-already-at-or-past-pinned-version`,
        );
        return { uptoDate: true, latestVersionCode: latestVc };
      }
      this.logger.log(
        `[ota] decision=install-env caller=${callerVn} screen=${lookupScreenId || '-'} ` +
        `target=v${latestVn || latestVc} url=${apkUrl.slice(0, 80)}`,
      );
      return { latest: { versionCode: latestVc, versionName: latestVn, apkUrl, sha256, forced } };
    }

    // ── Path B: auto-resolve from the latest GitHub Release ──
    // Zero env config required. Mirrors /apk/latest so every tagged
    // player-v* release is live for OTA within ~5 min of publish (the
    // GitHub API lookup cache TTL). Operators just push the tag and
    // every paired kiosk pulls the update on its next 6h poll.
    try {
      const info = await resolveLatestReleaseInfo();
      if (!info) {
        this.logger.warn(
          `[ota] decision=uptoDate-no-release caller=${callerVn} screen=${lookupScreenId || '-'} ` +
          `reason=resolveLatestReleaseInfo-returned-null`,
        );
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
          `screen=${lookupScreenId || '-'} reason=caller-at-or-past-latest-published-tag`,
        );
        return { uptoDate: true, latestVersionName: info.versionName };
      }

      // Return a versionCode strictly greater than the caller's so the
      // APK's own `latestVc <= BuildConfig.VERSION_CODE` gate clears
      // and it proceeds with the download (see OtaUpdateWorker.kt:91).
      // If the derived value is somehow smaller than the caller's —
      // e.g. someone hand-installed a dev build with versionCode 9999 —
      // bump it to caller+1 so they still update to the tag build.
      const derivedVc = Math.max(info.derivedVersionCode, callerVc + 1);

      this.logger.log(
        `[ota] decision=install-gh caller=${callerVn} target=v${info.versionName} ` +
        `screen=${lookupScreenId || '-'} url=${info.apkUrl.slice(0, 80)}`,
      );
      return {
        latest: {
          versionCode: derivedVc,
          versionName: info.versionName,
          apkUrl: info.apkUrl,
          // Empty sha — OtaUpdateWorker.kt:111 skips verification when
          // the field is empty. GitHub downloads over HTTPS so the
          // bytes are integrity-protected by TLS; add server-computed
          // SHA later when we pre-fetch + hash releases on publish.
          sha256: '',
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
   */
  @Get('latest-version')
  async getLatestVersion() {
    // Env override wins.
    const envVn = (process.env.PLAYER_APK_LATEST_VERSION_NAME || '').trim();
    const envVc = parseInt(process.env.PLAYER_APK_LATEST_VERSION_CODE || '0', 10);
    if (envVn && envVc) {
      return {
        versionName: envVn,
        versionCode: envVc,
        source: 'env',
      };
    }
    try {
      const info = await resolveLatestReleaseInfo();
      if (info) {
        return {
          versionName: info.versionName,
          versionCode: info.derivedVersionCode,
          source: 'github',
        };
      }
    } catch (e: any) {
      this.logger.warn(`/latest-version GitHub lookup failed: ${e?.message}`);
    }
    return { versionName: null, versionCode: null, source: 'unknown' };
  }

  @Get('apk/latest')
  async redirectToLatestApk(@Res() res: Response) {
    // Self-healing: prefer an explicit env override, but fall back to
    // pulling the latest release asset from GitHub's public API so the
    // 'Download APK' button works the moment a release is published,
    // with zero Railway env config. Cached 5 min in-memory so we don't
    // hammer GitHub.
    const explicit = process.env.PLAYER_APK_URL;
    if (explicit) {
      res.redirect(302, explicit);
      return;
    }

    try {
      const url = await resolveLatestReleaseApk();
      if (url) {
        res.redirect(302, url);
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
  // Prefers PLAYER_APK_LATEST_VERSION_NAME env if set; otherwise
  // embeds the GitHub artifact id as a fallback "build number".
  const versionTag = process.env.PLAYER_APK_LATEST_VERSION_NAME
    || `build${artifactCache.etag}`;
  const filename = `edu-cms-player-v${versionTag}.apk`;
  res.setHeader('Content-Type', 'application/vnd.android.package-archive');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'public, max-age=600');
  res.setHeader('ETag', artifactCache.etag);
  res.end(artifactCache.buf);
  return true;
}

// ─── GitHub Release asset resolution (cached) ──────────────────────
interface ReleaseCache { url: string | null; fetchedAt: number }
let releaseCache: ReleaseCache | null = null;
const RELEASE_TTL_MS = 5 * 60 * 1000;

async function resolveLatestReleaseApk(): Promise<string | null> {
  const info = await resolveLatestReleaseInfo();
  return info?.apkUrl ?? null;
}

// Richer release lookup used by /update-check — returns the APK URL,
// the tag-derived versionName, AND a derived versionCode in the
// A*10000 + B*100 + C scheme (1.0.5 → 10005) so we can give kiosk
// clients a number strictly greater than the versionCode they shipped
// with (BuildConfig.VERSION_CODE in build.gradle.kts). Same 5-min
// cache as the simple URL lookup to keep anonymous GitHub API usage
// well under the 60 req/hr limit.
interface ReleaseInfo {
  apkUrl: string;
  versionName: string;      // "1.0.5"
  derivedVersionCode: number; // 10005 for "1.0.5"
}
interface ReleaseInfoCache { info: ReleaseInfo | null; fetchedAt: number }
let releaseInfoCache: ReleaseInfoCache | null = null;

async function resolveLatestReleaseInfo(): Promise<ReleaseInfo | null> {
  const now = Date.now();
  if (releaseInfoCache && now - releaseInfoCache.fetchedAt < RELEASE_TTL_MS) {
    return releaseInfoCache.info;
  }
  const repo = process.env.PLAYER_APK_GITHUB_REPO || 'gschiemann/EDUCMS';
  const resp = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { 'User-Agent': 'edu-cms-player-ota' },
  });
  if (!resp.ok) {
    releaseInfoCache = { info: null, fetchedAt: now };
    return null;
  }
  const body = await resp.json() as {
    tag_name?: string;
    name?: string;
    assets?: Array<{ name: string; browser_download_url: string }>;
  };
  const assets = body.assets || [];
  const pick = (pred: (name: string) => boolean) =>
    assets.find((a) => pred(a.name.toLowerCase()));
  const chosen =
    pick((n) => n.includes('arm64-v8a') && n.endsWith('.apk')) ||
    pick((n) => n.includes('universal') && n.endsWith('.apk')) ||
    pick((n) => n.includes('armeabi-v7a') && n.endsWith('.apk')) ||
    pick((n) => n.endsWith('.apk') && !n.includes('x86'));
  const apkUrl = chosen?.browser_download_url ?? null;
  const tag = (body.tag_name || body.name || '').trim();
  // Strip `player-v` / leading `v`, leaving bare semver like "1.0.5".
  const versionName = tag.replace(/^player-v/, '').replace(/^v/, '');
  const match = versionName.match(/^(\d+)\.(\d+)\.(\d+)/);
  const derivedVersionCode = match
    ? parseInt(match[1], 10) * 10000 + parseInt(match[2], 10) * 100 + parseInt(match[3], 10)
    : 0;

  const info: ReleaseInfo | null = apkUrl && versionName && derivedVersionCode
    ? { apkUrl, versionName, derivedVersionCode }
    : null;
  releaseInfoCache = { info, fetchedAt: now };
  // Also fill the legacy URL cache so /apk/latest stays fast.
  releaseCache = { url: apkUrl, fetchedAt: now };
  return info;
}

// Semver-style "a >= b" for 3-part version strings (no pre-release or
// build-metadata support — EduCMS APKs don't use them). Unparseable
// parts compare as 0 so bad input fails safely as "not greater".
function semverGte(a: string, b: string): boolean {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff > 0;
  }
  return true; // equal counts as gte
}
