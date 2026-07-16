/**
 * POST /api/v1/usb-export/bundle
 *
 * Builds a signed USB content bundle in memory and streams it back as a
 * ZIP attachment. Bundle is playback-identical to a live publish: the
 * manifest's `playlists[]` shape matches `/screens/:id/manifest`
 * exactly (template + zones + defaultConfig + per-item duration), so
 * the Android player renders a USB-sourced bundle with the same code
 * path it uses for network-scheduled content. Custom text, slide
 * durations, countdown dates, menu items — all carried in
 * template.zones[*].defaultConfig.
 *
 * ZIP layout (matches CLAUDE.md Sprint 7 spec):
 *   edu-cms-content/
 *     manifest.json      ← JSON, includes template + zones + config
 *     manifest.sig       ← HMAC-SHA256(manifest.json, tenant.usbIngestKey)
 *     assets/<sha256>.<ext>   ← one file per unique asset
 *     README.txt         ← operator-readable summary
 */

import {
  Controller,
  Post,
  Body,
  Req,
  Res,
  UseGuards,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { createHash, createHmac } from 'crypto';
import JSZip from 'jszip';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';
import { safeFetch } from '../branding/safe-fetch';

interface BundleBody {
  screenId?: string;
  playlistIds: string[];
  includeEmergency?: boolean;
  bundleLabel?: string;
}

interface ManifestAsset {
  url: string;
  storagePath: string;
  sha256: string;
  mimeType: string;
  sizeBytes: number;
}

interface ManifestZone {
  id: string;
  name: string;
  widgetType: string;
  x: number; y: number; width: number; height: number;
  zIndex: number;
  sortOrder: number | null;
  defaultConfig: any;
}

interface ManifestTemplate {
  id: string;
  name: string;
  screenWidth: number;
  screenHeight: number;
  bgColor: string | null;
  bgGradient: string | null;
  bgImage: string | null;
  zones: ManifestZone[];
}

interface ManifestPlaylistItem {
  url: string;
  duration_ms: number;
  sequence: number;
  transition_type: string | null;
  asset: ManifestAsset;
}

interface ManifestPlaylist {
  id: string;
  name: string;
  template?: ManifestTemplate;
  items: ManifestPlaylistItem[];
}

/**
 * Flat, top-level asset descriptor — THE contract the Android player reads.
 * `UsbIngester.kt` verifies `{ sha256, localPath }`; `UsbCacheIndex.kt` maps
 * `url → localPath` so the WebView serves the on-disk copy. `localPath` is the
 * path relative to the bundle root (`assets/<sha>.<ext>`), split on '/' into
 * exactly two parts by the ingester.
 */
interface TopLevelAsset {
  url: string;
  sha256: string;
  localPath: string;
  mimeType: string;
  sizeBytes: number;
}

interface SignedManifest {
  // Android contract fields (UsbIngester.kt) — REQUIRED for the player to
  // accept the bundle. `schema` is the exact string the ingester gates on;
  // `bundleVersion` is a monotonic epoch-ms string for old-bundle rejection;
  // `assets` is the flat array both the ingester and UsbCacheIndex read.
  schema: 'edu-cms-usb-bundle/v1';
  bundleVersion: string;
  assets: TopLevelAsset[];
  // Rich rendering fields — the WebView player renders playlists/templates
  // from these. `version` stays for the renderer's own schema tracking; it is
  // NOT what the ingester checks (that's `schema`).
  version: 1;
  tenantId: string;
  tenantSlug: string | null;
  screenId: string | null;
  bundleLabel: string | null;
  createdAt: string;
  expiresAt: string;
  playlists: ManifestPlaylist[];
  emergencyPlaylists: ManifestPlaylist[];
  assetCount: number;
  totalBytes: number;
  exporterUserId: string;
  truncated: boolean;
}

const MAX_ASSETS_PER_BUNDLE = 500;
const MAX_BYTES_PER_BUNDLE = 2 * 1024 * 1024 * 1024; // 2GB
const MAX_ASSET_FETCH_TIMEOUT_MS = 30_000;
const BUNDLE_VALID_DAYS = 30;

function tryParse(s: any): any {
  if (typeof s !== 'string') return s;
  try { return JSON.parse(s); } catch { return s; }
}

function extFromMimeOrUrl(mime: string | null | undefined, url: string): string {
  const m = (mime || '').toLowerCase();
  if (m.includes('png')) return 'png';
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
  if (m.includes('webp')) return 'webp';
  if (m.includes('gif')) return 'gif';
  if (m.includes('svg')) return 'svg';
  if (m.includes('mp4')) return 'mp4';
  if (m.includes('webm')) return 'webm';
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  if (m.includes('pdf')) return 'pdf';
  const dot = url.match(/\.([a-z0-9]{2,5})(?:\?|#|$)/i);
  return (dot?.[1] || 'bin').toLowerCase();
}

@Controller('api/v1/usb-export')
@UseGuards(JwtAuthGuard, RbacGuard)
export class UsbExportController {
  private readonly logger = new Logger('UsbExport');
  constructor(private readonly prisma: PrismaService) {}

  @Post('bundle')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  @Throttle({ default: { limit: 5, ttl: 60 * 60_000 } })
  async bundle(
    @Req() req: Request & { user: any },
    @Res() res: Response,
    @Body() body: BundleBody,
  ) {
    const tenantId = req.user.tenantId;

    const tenant = await this.prisma.client.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true, slug: true, usbIngestEnabled: true, usbIngestKey: true,
        // Tenant-wide DEFAULT emergency playlist. The per-screen per-type
        // boards (lockdown/evacuate/weather/hold/secure/medical + portrait
        // variants) live on the Screen model and are folded into
        // emergencyIds below when body.screenId is set (S13) — so an
        // offline kiosk gets the exact life-safety board it would show live.
        emergencyPlaylistId: true,
      },
    });
    if (!tenant) throw new HttpException({ code: 'USB_EXPORT_TENANT_NOT_FOUND', message: 'Tenant not found' }, HttpStatus.NOT_FOUND);

    // FIX (player-003): refuse the export when usbIngestEnabled is false.
    // The previous behavior silently flipped the flag AND minted an HMAC
    // key on first call, contradicting CLAUDE.md Sprint 7's "default false;
    // admins must opt in" stance. USB ingest is an attack surface (signed
    // bundles can update emergency content) and must remain an explicit
    // operator decision made in Settings -> USB. Once the flag is on, we
    // still mint the signing key on demand if it's missing — that's an
    // implementation detail of having USB enabled, not a separate consent.
    if (!tenant.usbIngestEnabled) {
      throw new HttpException(
        {
          error: 'USB_INGEST_DISABLED',
          message:
            'USB ingest is disabled for this tenant. An admin must enable it in Settings -> USB before bundles can be exported.',
        },
        HttpStatus.FORBIDDEN,
      );
    }

    let usbIngestKey = tenant.usbIngestKey;
    if (!usbIngestKey) {
      const { randomBytes } = await import('crypto');
      usbIngestKey = randomBytes(32).toString('hex');
      await this.prisma.client.tenant.update({
        where: { id: tenantId },
        data: {
          usbIngestKey,
          usbIngestKeyRotatedAt: new Date(),
        },
      });
      this.logger.log(
        `[usb-export] minted signing key for tenant ${tenantId} (ingest already enabled)`,
      );
    }

    const playlistIds = Array.isArray(body.playlistIds) ? body.playlistIds : [];
    if (playlistIds.length === 0) {
      throw new HttpException({ code: 'USB_EXPORT_PLAYLIST_IDS_REQUIRED', message: 'playlistIds is required (non-empty)' }, HttpStatus.BAD_REQUEST);
    }

    let screen:
      | {
          id: string;
          tenantId: string | null;
          // Per-screen per-type emergency playlists (S13). Landscape + portrait.
          emergencyLockdownPlaylistId: string | null;
          emergencyEvacuatePlaylistId: string | null;
          emergencyWeatherPlaylistId: string | null;
          emergencyHoldPlaylistId: string | null;
          emergencySecurePlaylistId: string | null;
          emergencyMedicalPlaylistId: string | null;
          emergencyLockdownPortraitPlaylistId: string | null;
          emergencyEvacuatePortraitPlaylistId: string | null;
          emergencyWeatherPortraitPlaylistId: string | null;
          emergencyHoldPortraitPlaylistId: string | null;
          emergencySecurePortraitPlaylistId: string | null;
          emergencyMedicalPortraitPlaylistId: string | null;
        }
      | null = null;
    if (body.screenId) {
      screen = await this.prisma.client.screen.findUnique({
        where: { id: body.screenId },
        select: {
          id: true,
          tenantId: true,
          // Life-safety boards this specific screen would show on each panic
          // type — folded into emergencyIds so an offline USB bundle carries
          // the evacuate/lockdown/etc. board, not just the tenant default.
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
        },
      });
      if (!screen || screen.tenantId !== tenantId) {
        throw new HttpException({ code: 'USB_EXPORT_SCREEN_NOT_FOUND', message: 'Screen not found in your tenant' }, HttpStatus.NOT_FOUND);
      }
    }

    // IDENTICAL include() shape to screens.controller.ts getManifest() so
    // the USB-sourced manifest renders in the player via the same code
    // path as a scheduled publish. template.zones carries every widget
    // config (custom text, slide timings, countdown dates, menu items).
    const playlistInclude = {
      items: {
        include: { asset: true },
        orderBy: { sequenceOrder: 'asc' as const },
      },
      template: {
        include: { zones: { orderBy: { sortOrder: 'asc' as const } } },
      },
    };

    const playlistsRaw = await this.prisma.client.playlist.findMany({
      where: { id: { in: playlistIds }, tenantId },
      include: playlistInclude,
    });
    if (playlistsRaw.length === 0) {
      throw new HttpException({ code: 'USB_EXPORT_NO_MATCHING_PLAYLISTS', message: 'No matching playlists in this tenant' }, HttpStatus.NOT_FOUND);
    }

    // S13: bundle every emergency board this screen could show, not just the
    // tenant default. When a screen is targeted we also pull its per-type
    // (lockdown/evacuate/weather/hold/secure/medical) playlists + portrait
    // variants. Deduped (a screen may reuse the tenant default), then the
    // findMany's `tenantId` where-clause drops any that don't resolve.
    const emergencyIds = body.includeEmergency
      ? Array.from(
          new Set(
            [
              tenant.emergencyPlaylistId,
              screen?.emergencyLockdownPlaylistId,
              screen?.emergencyEvacuatePlaylistId,
              screen?.emergencyWeatherPlaylistId,
              screen?.emergencyHoldPlaylistId,
              screen?.emergencySecurePlaylistId,
              screen?.emergencyMedicalPlaylistId,
              screen?.emergencyLockdownPortraitPlaylistId,
              screen?.emergencyEvacuatePortraitPlaylistId,
              screen?.emergencyWeatherPortraitPlaylistId,
              screen?.emergencyHoldPortraitPlaylistId,
              screen?.emergencySecurePortraitPlaylistId,
              screen?.emergencyMedicalPortraitPlaylistId,
            ].filter((x): x is string => !!x),
          ),
        )
      : [];
    const emergencyRaw = emergencyIds.length
      ? await this.prisma.client.playlist.findMany({
          where: { id: { in: emergencyIds }, tenantId },
          include: playlistInclude,
        })
      : [];

    // ───────── Download assets + assemble ZIP ─────────
    const zip = new JSZip();
    const root = zip.folder('edu-cms-content')!;
    const assetsDir = root.folder('assets')!;
    const seenHashes = new Set<string>();
    // The flat top-level asset array the Android player reads (deduped by
    // hash, same set as the files written into assets/).
    const topLevelAssets: TopLevelAsset[] = [];
    let totalBytes = 0;
    let assetCount = 0;
    let truncated = false;

    const serializeTemplate = (t: any): ManifestTemplate | undefined => {
      if (!t) return undefined;
      return {
        id: t.id,
        name: t.name,
        screenWidth: t.screenWidth,
        screenHeight: t.screenHeight,
        bgColor: t.bgColor,
        bgGradient: t.bgGradient,
        bgImage: t.bgImage,
        zones: (t.zones || []).map((z: any) => ({
          id: z.id,
          name: z.name,
          widgetType: z.widgetType,
          x: z.x, y: z.y, width: z.width, height: z.height,
          zIndex: z.zIndex,
          sortOrder: z.sortOrder ?? null,
          // defaultConfig is stored as JSON string in Prisma — parse it so
          // the player doesn't receive double-encoded JSON. Mirrors
          // screens.controller.ts:601.
          defaultConfig: z.defaultConfig ? tryParse(z.defaultConfig) : null,
        })),
      };
    };

    const processPlaylist = async (p: any): Promise<ManifestPlaylist> => {
      const items: ManifestPlaylistItem[] = [];
      for (const it of p.items) {
        const asset = it.asset;
        if (!asset?.fileUrl) continue;

        const ext = extFromMimeOrUrl(asset.mimeType, asset.fileUrl);
        // The stored SHA-256 (computed at upload time). May be absent — the
        // /assets presign path never sends one, so a freshly-uploaded asset
        // has a null fileHash. S12: instead of DROPPING those (which left the
        // offline kiosk playing a playlist with silently-missing items), we
        // hash the bytes we download below and self-heal the DB.
        let hash: string = asset.fileHash?.trim() || '';

        // Fast path: known hash already bundled → reuse the on-disk copy, no
        // re-fetch. (Preserves the original dedup optimization exactly.)
        if (hash && seenHashes.has(hash)) {
          items.push({
            url: asset.fileUrl,
            duration_ms: it.durationMs,
            sequence: it.sequenceOrder,
            transition_type: it.transitionType ?? null,
            asset: {
              url: asset.fileUrl,
              storagePath: `assets/${hash}.${ext}`,
              sha256: hash,
              mimeType: asset.mimeType || 'application/octet-stream',
              sizeBytes: asset.fileSize || 0,
            },
          });
          continue;
        }

        // We need the bytes: either to write a not-yet-seen asset, or to
        // compute a missing hash. Same safeFetch the known-hash path uses.
        if (assetCount >= MAX_ASSETS_PER_BUNDLE) { truncated = true; break; }
        let body: Buffer | null = null;
        try {
          const fetched = await safeFetch(asset.fileUrl, {
            maxBytes: 200 * 1024 * 1024,
            timeoutMs: MAX_ASSET_FETCH_TIMEOUT_MS,
          });
          body = fetched.body;
        } catch (e: any) {
          this.logger.warn(`Asset fetch failed for ${asset.fileUrl}: ${e?.message}`);
        }

        if (!hash) {
          // No stored hash → the ONLY way to identify/name this asset is to
          // hash the bytes we just downloaded. If the fetch failed we can't,
          // so we skip (can't fabricate a content hash) — but that's the rare
          // failure case, not the routine "fresh upload has no hash" case.
          if (!body) {
            this.logger.warn(`Skipping asset ${asset.id} — no fileHash and fetch failed`);
            continue;
          }
          hash = createHash('sha256').update(body).digest('hex');
          // Self-heal: persist the computed hash so the next export dedups
          // without a re-fetch. Best-effort — a failed write never blocks the
          // bundle (the bundle is already correct with the computed hash).
          this.prisma.client.asset
            .update({ where: { id: asset.id }, data: { fileHash: hash } })
            .catch(() => { /* non-fatal: bundle is correct regardless */ });
        }
        const storagePath = `assets/${hash}.${ext}`;

        // Write the file + record the flat top-level entry on first sight of a
        // hash. A null-hash asset whose bytes re-hash to an already-seen value
        // (true duplicate) skips the write here but still gets its item below.
        if (body && !seenHashes.has(hash)) {
          if (totalBytes + body.byteLength > MAX_BYTES_PER_BUNDLE) {
            truncated = true;
            break;
          }
          assetsDir.file(`${hash}.${ext}`, body);
          seenHashes.add(hash);
          totalBytes += body.byteLength;
          assetCount += 1;
          topLevelAssets.push({
            url: asset.fileUrl,
            sha256: hash,
            localPath: storagePath, // "assets/<sha>.<ext>"
            mimeType: asset.mimeType || 'application/octet-stream',
            sizeBytes: body.byteLength,
          });
        }

        items.push({
          url: asset.fileUrl,
          duration_ms: it.durationMs,
          sequence: it.sequenceOrder,
          transition_type: it.transitionType ?? null,
          asset: {
            url: asset.fileUrl,
            storagePath,
            sha256: hash,
            mimeType: asset.mimeType || 'application/octet-stream',
            sizeBytes: asset.fileSize || (body ? body.byteLength : 0),
          },
        });
      }
      const out: ManifestPlaylist = { id: p.id, name: p.name, items };
      const tpl = serializeTemplate((p as any).template);
      if (tpl) out.template = tpl;
      return out;
    };

    const playlists: ManifestPlaylist[] = [];
    for (const p of playlistsRaw) playlists.push(await processPlaylist(p));
    const emergencyPlaylists: ManifestPlaylist[] = [];
    for (const p of emergencyRaw) emergencyPlaylists.push(await processPlaylist(p));

    const now = Date.now();
    const manifest: SignedManifest = {
      // ── Android ingester contract (UsbIngester.kt / UsbCacheIndex.kt) ──
      schema: 'edu-cms-usb-bundle/v1',
      // Monotonic, comparable version so the player can reject a bundle older
      // than what it already has. Epoch-ms as a string (the ingester reads it
      // as an opaque string; numeric string sorts/compares correctly).
      bundleVersion: String(now),
      assets: topLevelAssets,
      // ── Rich renderer fields (unchanged) ──
      version: 1,
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      screenId: screen?.id ?? null,
      bundleLabel: (body.bundleLabel || '').slice(0, 200) || null,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + BUNDLE_VALID_DAYS * 86400_000).toISOString(),
      playlists,
      emergencyPlaylists,
      assetCount,
      totalBytes,
      exporterUserId: req.user.id,
      truncated,
    };
    const manifestJson = JSON.stringify(manifest, null, 2);
    const signature = createHmac('sha256', Buffer.from(usbIngestKey!, 'hex'))
      .update(manifestJson, 'utf-8')
      .digest('hex');

    root.file('manifest.json', manifestJson);
    root.file('manifest.sig', signature);
    root.file(
      'README.txt',
      [
        'EDU CMS — USB Content Bundle',
        `Tenant: ${tenant.slug || tenant.id}`,
        `Created: ${manifest.createdAt}`,
        `Expires: ${manifest.expiresAt}`,
        `Playlists: ${playlists.length}${emergencyPlaylists.length ? ` (+ ${emergencyPlaylists.length} emergency)` : ''}`,
        `Assets:  ${assetCount}  (${(totalBytes / 1024 / 1024).toFixed(1)} MB)`,
        truncated ? '⚠ TRUNCATED — bundle hit size/count cap. Consider splitting across multiple USBs.' : '',
        '',
        'How to use:',
        '  1. Enable USB ingest for this screen (Settings -> USB) and pair it,',
        '     so the player holds this tenant\'s signing key.',
        '  2. Plug this USB stick into the paired EDU CMS player.',
        '  3. Confirm the ingest prompt. The player verifies the tenant, the',
        '     manifest signature, and every asset hash before accepting.',
        '  4. Content stays on-device and keeps playing offline.',
        '',
        'Security: ingest is gated by the per-tenant USB feature flag and this',
        'HMAC-signed manifest — NOT by a PIN. Do NOT modify manifest.json or',
        'manifest.sig; the player rejects any bundle whose signature or asset',
        'hashes do not match.',
      ].filter(Boolean).join('\n'),
    );

    await this.prisma.client.auditLog.create({
      data: {
        tenantId,
        userId: req.user.id,
        action: 'USB_BUNDLE_EXPORTED',
        targetType: 'Tenant',
        targetId: tenantId,
        details: JSON.stringify({
          screenId: screen?.id,
          playlistIds: playlists.map((p) => p.id),
          emergencyPlaylistIds: emergencyPlaylists.map((p) => p.id),
          assetCount,
          totalBytes,
          truncated,
          label: manifest.bundleLabel,
        }),
      },
    }).catch(() => { /* audit write failure shouldn't block export */ });

    const zipBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const shortSig = signature.slice(0, 8);
    const filename = `edu-cms-bundle-${stamp}-${shortSig}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Bundle-Signature', shortSig);
    res.setHeader('X-Bundle-Asset-Count', String(assetCount));
    res.setHeader('X-Bundle-Truncated', truncated ? 'true' : 'false');
    res.end(zipBuffer);
  }
}
