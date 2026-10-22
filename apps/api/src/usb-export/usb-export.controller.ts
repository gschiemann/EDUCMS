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
 *
 * 2026-10-22 (Greg: "just allow people to download the playlist to a USB by
 * default"): there is no USB setting any more. Any admin can export; the
 * signing key is minted silently (usb-signing-key.ts) and a paired screen
 * fetches it with its own credential. The operator copies the downloaded
 * .zip (or the unpacked folder) onto a stick and plugs it in — the player
 * finds it, verifies it and plays it with the playlist's own settings.
 *
 * Every playlist in `playlists[]` is ALSO a player manifest playlist: the
 * same item fields the live `/screens/:id/manifest` sends (item_id,
 * asset_hash, asset_size, mime_type, muted, media dims), the template with
 * scenes / touch settings, a `schedule` block and a `contentRev`, so the web
 * player applies a USB playlist through its ordinary manifest path. The
 * legacy `asset` sub-object stays for older readers.
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
import { redactTypedStudentNames } from '../sports/typed-student-names';
import { pdfDelivery, withheldFromScreens } from '@cms/api-types';
import { pdfPageManifestItems } from '../screens/pdf-page-items';
import { manifestMediaDims } from '../screens/screens.controller';
import { ensureUsbSigningKey } from './usb-signing-key';

/** When the package plays — the same three fields a Schedule row carries. */
interface BundleSchedule {
  daysOfWeek?: string | null;
  timeStart?: string | null;
  timeEnd?: string | null;
}

interface BundleBody {
  screenId?: string;
  playlistIds: string[];
  includeEmergency?: boolean;
  bundleLabel?: string;
  /**
   * Optional window (the create wizard passes the one the operator just
   * picked). Absent → the playlist's own published window when every active
   * rule agrees on one, else always on.
   */
  schedule?: BundleSchedule | null;
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
  touchAction: unknown;
  sceneId: string | null;
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
  isTouchEnabled: boolean;
  idleResetMs?: number;
  scenes: unknown[];
  zones: ManifestZone[];
}

interface ManifestPlaylistItem {
  url: string;
  duration_ms: number;
  sequence: number;
  transition_type: string | null;
  asset: ManifestAsset;
  // Player manifest fields (same names as /screens/:id/manifest).
  item_id: string;
  asset_id: string | null;
  asset_hash: string;
  asset_size: number;
  mime_type: string;
  muted: boolean;
  media_w?: number;
  media_h?: number;
}

interface ManifestPlaylist {
  id: string;
  name: string;
  template?: ManifestTemplate;
  items: ManifestPlaylistItem[];
  schedule: {
    daysOfWeek: string | null;
    timeStart: string | null;
    timeEnd: string | null;
    mutedOverride: null;
    mode: 'replace';
    pin: 'screen';
    priority: number;
  };
  contentRev: string;
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
  skippedFiles: number;
}

const MAX_ASSETS_PER_BUNDLE = 500;
const MAX_BYTES_PER_BUNDLE = 2 * 1024 * 1024 * 1024; // 2GB
// Per-file ceiling = the upload ceiling (500 MB) plus headroom. It was 200 MB,
// which silently dropped every large video from the package.
const MAX_ASSET_BYTES = 600 * 1024 * 1024;
const MAX_ASSET_FETCH_TIMEOUT_MS = 120_000;
// Informational only: nothing refuses an old package (an offline site may run
// one stick for a whole term).
const BUNDLE_VALID_DAYS = 365;
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAYS = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)(,(Mon|Tue|Wed|Thu|Fri|Sat|Sun))*$/;

/** A schedule window, cleaned: unknown shapes become "no limit", never a throw. */
export function cleanBundleSchedule(s: BundleSchedule | null | undefined): {
  daysOfWeek: string | null; timeStart: string | null; timeEnd: string | null;
} {
  const days = typeof s?.daysOfWeek === 'string' && DAYS.test(s.daysOfWeek.trim()) ? s.daysOfWeek.trim() : null;
  const start = typeof s?.timeStart === 'string' && HH_MM.test(s.timeStart) ? s.timeStart : null;
  const end = typeof s?.timeEnd === 'string' && HH_MM.test(s.timeEnd) ? s.timeEnd : null;
  // A window needs both ends; one alone would read as "never".
  return { daysOfWeek: days, timeStart: start && end ? start : null, timeEnd: start && end ? end : null };
}

/** Already-compressed media is STORED, not deflated — same bytes, far less CPU. */
function zipOptionsFor(ext: string): { compression: 'STORE' | 'DEFLATE' } {
  return ['jpg', 'png', 'webp', 'gif', 'mp4', 'webm', 'mp3', 'pdf'].includes(ext)
    ? { compression: 'STORE' }
    : { compression: 'DEFLATE' };
}

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
  @Throttle({ default: { limit: 30, ttl: 60 * 60_000 } })
  async bundle(
    @Req() req: Request & { user: any },
    @Res() res: Response,
    @Body() body: BundleBody,
  ) {
    const tenantId = req.user.tenantId;

    const tenant = await this.prisma.client.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true, slug: true,
        // Tenant-wide DEFAULT emergency playlist. The per-screen per-type
        // boards (lockdown/evacuate/weather/hold/secure/medical + portrait
        // variants) live on the Screen model and are folded into
        // emergencyIds below when body.screenId is set (S13) — so an
        // offline kiosk gets the exact life-safety board it would show live.
        emergencyPlaylistId: true,
      },
    });
    if (!tenant) throw new HttpException({ code: 'USB_EXPORT_TENANT_NOT_FOUND', message: 'Tenant not found' }, HttpStatus.NOT_FOUND);

    // No USB setting (2026-10-22): the key is minted on first use, invisibly.
    const usbIngestKey = await ensureUsbSigningKey(this.prisma as any, tenantId);
    if (!usbIngestKey) {
      throw new HttpException({ code: 'USB_EXPORT_KEY_UNAVAILABLE', message: 'Could not prepare the USB package. Try again.' }, HttpStatus.SERVICE_UNAVAILABLE);
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
        where: { id: body.screenId, tenantId },
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
    let skipped = 0;

    // When each playlist plays: the wizard's window if it sent one, else the
    // playlist's own published window when every active rule agrees on one,
    // else always on. A read failure means "always on", never a failed export.
    const windowFor = new Map<string, { daysOfWeek: string | null; timeStart: string | null; timeEnd: string | null }>();
    if (body.schedule) {
      const w = cleanBundleSchedule(body.schedule);
      for (const id of playlistIds) windowFor.set(id, w);
    } else {
      try {
        const rules: any[] = await this.prisma.client.schedule.findMany({
          where: { tenantId, playlistId: { in: playlistsRaw.map((p) => p.id) }, isActive: true },
          select: { playlistId: true, daysOfWeek: true, timeStart: true, timeEnd: true },
        });
        for (const p of playlistsRaw) {
          const mine = rules.filter((r) => r.playlistId === p.id).map((r) => cleanBundleSchedule(r));
          const keys = new Set(mine.map((w) => JSON.stringify(w)));
          if (mine.length > 0 && keys.size === 1) windowFor.set(p.id, mine[0]);
        }
      } catch (e: any) {
        this.logger.warn(`[usb-export] schedule read failed — packaging as always-on: ${e?.message}`);
      }
    }

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
        // Same template fields the live manifest serializes (touch + scenes).
        isTouchEnabled: !!t.isTouchEnabled,
        idleResetMs: t.idleResetMs ?? undefined,
        scenes: Array.isArray(t.scenes) ? t.scenes : [],
        zones: (t.zones || []).map((z: any) => ({
          id: z.id,
          name: z.name,
          widgetType: z.widgetType,
          x: z.x, y: z.y, width: z.width, height: z.height,
          zIndex: z.zIndex,
          sortOrder: z.sortOrder ?? null,
          touchAction: z.touchAction ?? null,
          sceneId: z.sceneId ?? null,
          // defaultConfig is stored as JSON string in Prisma — parse it so
          // the player doesn't receive double-encoded JSON. Mirrors
          // screens.controller.ts:601.
          defaultConfig: z.defaultConfig ? tryParse(z.defaultConfig) : null,
        })),
      };
    };

    /**
     * Download one file into the package (deduped by content hash) and return
     * its hash + package path, or null when the bytes could not be fetched.
     * The hash is ALWAYS computed from the bytes written — the player verifies
     * every file against it, so a stale stored hash must never name a file.
     */
    const addFile = async (
      url: string,
      mime: string,
      storedHash: string,
      assetId: string | null,
    ): Promise<{ hash: string; path: string; size: number } | null> => {
      const ext = extFromMimeOrUrl(mime, url);
      if (storedHash && seenHashes.has(storedHash)) {
        const known = topLevelAssets.find((a) => a.sha256 === storedHash);
        if (known) return { hash: storedHash, path: known.localPath, size: known.sizeBytes };
      }
      if (assetCount >= MAX_ASSETS_PER_BUNDLE) { truncated = true; return null; }
      let bytes: Buffer | null = null;
      try {
        const fetched = await safeFetch(url, { maxBytes: MAX_ASSET_BYTES, timeoutMs: MAX_ASSET_FETCH_TIMEOUT_MS });
        bytes = fetched.body;
      } catch (e: any) {
        this.logger.warn(`Asset fetch failed for ${url}: ${e?.message}`);
      }
      if (!bytes) { skipped += 1; return null; }
      const hash = createHash('sha256').update(bytes).digest('hex');
      if (assetId && hash !== storedHash) {
        // Self-heal: persist the real hash so the next export (and the live
        // manifest) carry it. Best-effort, tenant-scoped (SEC-009).
        this.prisma.client.asset
          .update({ where: { id: assetId, tenantId }, data: { fileHash: hash } })
          .catch(() => { /* non-fatal: the package is correct regardless */ });
      }
      const path = `assets/${hash}.${ext}`;
      if (!seenHashes.has(hash)) {
        if (totalBytes + bytes.byteLength > MAX_BYTES_PER_BUNDLE) { truncated = true; return null; }
        assetsDir.file(`${hash}.${ext}`, bytes, zipOptionsFor(ext));
        seenHashes.add(hash);
        totalBytes += bytes.byteLength;
        assetCount += 1;
        topLevelAssets.push({ url, sha256: hash, localPath: path, mimeType: mime, sizeBytes: bytes.byteLength });
      }
      return { hash, path, size: bytes.byteLength };
    };

    const processPlaylist = async (p: any, regular: boolean): Promise<ManifestPlaylist> => {
      const items: ManifestPlaylistItem[] = [];
      const orientation = p.template && p.template.screenHeight > p.template.screenWidth ? 'portrait' : 'landscape';
      for (const it of p.items) {
        const asset = it.asset;
        if (!asset?.fileUrl) continue;
        // The live manifest's screen-ready gate (normal content only): a file
        // a screen cannot play — still converting, failed conversion, a PDF
        // whose pages are not ready — is left out exactly as it is live.
        if (regular && (withheldFromScreens(asset) || pdfDelivery(asset) === 'withhold')) continue;
        const muted = it.muted ?? true;
        // A PDF with pages plays as one picture per page, as it does live.
        const sources: Array<{ itemId: string; url: string; mime: string; hash: string }> =
          regular && pdfDelivery(asset) === 'pages'
            ? pdfPageManifestItems(it, { orientation, small1080: false }, muted).map((pg: any) => ({
                itemId: String(pg.item_id), url: String(pg.url), mime: String(pg.mime_type), hash: String(pg.asset_hash || ''),
              }))
            : [{ itemId: it.id, url: asset.fileUrl, mime: asset.mimeType || 'application/octet-stream', hash: asset.fileHash?.trim() || '' }];
        for (const src of sources) {
          if (truncated) break;
          const file = await addFile(src.url, src.mime, src.hash, src.itemId === it.id ? asset.id : null);
          if (!file) {
            if (!truncated) this.logger.warn(`Skipping ${src.url} — its bytes could not be fetched`);
            continue;
          }
          items.push({
            url: src.url,
            duration_ms: it.durationMs,
            sequence: it.sequenceOrder,
            transition_type: it.transitionType ?? null,
            asset: {
              url: src.url,
              storagePath: file.path,
              sha256: file.hash,
              mimeType: src.mime,
              sizeBytes: file.size,
            },
            item_id: src.itemId,
            asset_id: it.assetId ?? asset.id ?? null,
            asset_hash: file.hash,
            asset_size: file.size,
            mime_type: src.mime,
            muted,
            ...manifestMediaDims(asset.processingMeta),
          });
        }
        if (truncated) break;
      }
      const w = windowFor.get(p.id) ?? { daysOfWeek: null, timeStart: null, timeEnd: null };
      const out: ManifestPlaylist = {
        id: p.id,
        name: p.name,
        items,
        schedule: { ...w, mutedOverride: null, mode: 'replace', pin: 'screen', priority: 0 },
        contentRev: '',
      };
      const tpl = serializeTemplate((p as any).template);
      if (tpl) out.template = tpl;
      return out;
    };

    const playlists: ManifestPlaylist[] = [];
    for (const p of playlistsRaw) playlists.push(await processPlaylist(p, true));
    // K-12 sports launch, lane B4 — a USB bundle is a real screen too: a
    // student name TYPED into a template field is blanked when the school's
    // student-privacy policy hides it, exactly as in the live manifest
    // (sports/typed-student-names.ts). The emergency boards below are left
    // byte-for-byte alone — they carry no typed-name fields.
    {
      const redactedTemplates = await redactTypedStudentNames(
        this.prisma.client as any,
        tenant.id,
        playlists.map((p) => p.template ?? null),
      );
      playlists.forEach((p, i) => {
        if (p.template) p.template = redactedTemplates[i] ?? undefined;
      });
    }
    const emergencyPlaylists: ManifestPlaylist[] = [];
    for (const p of emergencyRaw) emergencyPlaylists.push(await processPlaylist(p, false));
    // Same content revision the live manifest computes (template + items), so
    // the player's apply-signature re-applies when a package's content changes.
    for (const p of [...playlists, ...emergencyPlaylists]) {
      p.contentRev = createHash('sha1')
        .update(JSON.stringify({ t: p.template ?? null, i: p.items }))
        .digest('hex')
        .slice(0, 12);
    }

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
      skippedFiles: skipped,
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
        'VenueOS — USB playlist',
        `Tenant: ${tenant.slug || tenant.id}`,
        `Created: ${manifest.createdAt}`,
        `Playlists: ${playlists.length}${emergencyPlaylists.length ? ` (+ ${emergencyPlaylists.length} emergency)` : ''}`,
        `Assets:  ${assetCount}  (${(totalBytes / 1024 / 1024).toFixed(1)} MB)`,
        truncated ? '⚠ TRUNCATED — bundle hit size/count cap. Consider splitting across multiple USBs.' : '',
        '',
        skipped ? `${skipped} file(s) could not be downloaded and were left out.` : '',
        '',
        'How to use:',
        '  1. Copy this file (or the whole edu-cms-content folder) onto a USB stick.',
        '  2. Plug the stick into a VenueOS screen that has been paired once.',
        '  3. The screen finds the playlist, checks it, copies it and starts',
        '     playing it. You can remove the stick afterwards.',
        '',
        'The screen checks a signature and every file before it plays anything,',
        'so do not edit the files on the stick.',
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
    const filename = `VenueOS-USB-${stamp}-${shortSig}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Bundle-Signature', shortSig);
    res.setHeader('X-Bundle-Asset-Count', String(assetCount));
    res.setHeader('X-Bundle-Truncated', truncated ? 'true' : 'false');
    res.setHeader('X-Bundle-Skipped', String(skipped));
    res.end(zipBuffer);
  }
}
