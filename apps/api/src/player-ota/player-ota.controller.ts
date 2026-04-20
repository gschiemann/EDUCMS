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

  @Post('update-check')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  updateCheck(@Body() body: UpdateCheckBody) {
    const latestVc = parseInt(process.env.PLAYER_APK_LATEST_VERSION_CODE || '0', 10);
    const latestVn = process.env.PLAYER_APK_LATEST_VERSION_NAME || '';
    const apkUrl = process.env.PLAYER_APK_URL || '';
    const sha256 = process.env.PLAYER_APK_SHA256 || '';
    // Optional: flip this when pushing a mandatory security update. Kiosks
    // that fail the install still get re-tried on the next check.
    const forced = process.env.PLAYER_APK_FORCED === 'true';

    if (!latestVc || !apkUrl) {
      // Not configured yet — tell the device everything's fine.
      return { uptoDate: true };
    }

    const current = Number(body?.versionCode) || 0;
    if (current >= latestVc) {
      return { uptoDate: true, latestVersionCode: latestVc };
    }

    this.logger.log(
      `[ota] upgrade ${current}→${latestVc} | fp=${(body?.fingerprint || '').slice(0, 10)} | abi=${body?.abi}`,
    );

    return {
      latest: {
        versionCode: latestVc,
        versionName: latestVn,
        apkUrl,
        sha256,
        forced,
      },
    };
  }

  @Get('apk/latest')
  redirectToLatestApk(@Res() res: Response) {
    const apkUrl = process.env.PLAYER_APK_URL;
    if (!apkUrl) {
      res.status(503).json({
        error: true,
        message:
          'Player APK URL not configured on this deployment. Set PLAYER_APK_URL to the GitHub Release asset URL.',
      });
      return;
    }
    res.redirect(302, apkUrl);
  }
}
