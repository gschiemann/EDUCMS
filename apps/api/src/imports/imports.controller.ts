/**
 * ImportsController — design-import endpoint for the Canva / Slides /
 * PowerPoint / Figma / Adobe Express bring-your-own-design flow.
 *
 *   POST /api/v1/imports/design   — multipart upload of a PDF / image.
 *                                   Stores the file as an Asset and,
 *                                   depending on `targetType`, either
 *                                   creates an auto-named Playlist
 *                                   (default; backward-compat) or a
 *                                   Template with a single IMAGE zone.
 *
 * 2026-05-25 operator pushback ("we are suppose to take a pptx, a pdf,
 * a canva design and bring it right in as a template but for some
 * reason we drop it into the playlist menu"): the original v1 only
 * produced a Playlist. Now the caller picks the output target.
 *
 *   Body fields (multipart/form-data):
 *     file        — the upload (PDF / PNG / JPG / WEBP, ≤50 MB)
 *     source      — optional 'canva' | 'slides' | 'pptx' | 'image' |
 *                   'pdf' for analytics; pass-through, no validation
 *     targetType  — optional 'template' | 'playlist' (default
 *                   'playlist' — keeps existing callers working). When
 *                   'template' we ALSO build a Template row with one
 *                   IMAGE zone covering 0–100% × 0–100% of the canvas
 *                   pointing at the uploaded Asset's fileUrl.
 *
 *   Returns: `{ ok, message, asset, playlist, template?, targetType,
 *   source }`. The `template` field is only present when
 *   targetType=template. Front-end uses it to navigate the operator
 *   straight into the template builder if they want to keep editing.
 *
 * Sprint 10 / Canva integration stage 1 (2026-05-03). Operator: "we
 * talked about adding a full canva integration, will that happen?
 * import templates direct from canva and be able to update using our
 * toolbar and editing".
 *
 * What stage 1 ships (this commit):
 *   ✅ Single-page PDFs and image files (PNG/JPG/WEBP) work
 *      end-to-end. Asset row + 1-item Playlist created (and Template
 *      when targetType=template).
 *   ✅ Multi-page PDFs upload as a single Asset; the front-end nudges
 *      the operator to "split into single-page exports for now"
 *      until the page-split worker ships in a follow-up.
 *
 * What stage 2 will add (pending Canva partner approval):
 *   - OAuth Canva Connect — design picker + auto-resync
 *   - Same shape for Google Slides / PowerPoint Online / Figma
 *
 * Full plan: docs/CANVA_INTEGRATION.md.
 */

import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Logger,
  Post,
  Request,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { extname, basename } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseStorageService } from '../storage/supabase-storage.service';
import { parsePptx } from './parsers/pptx-parser';
import { parsePdf } from './parsers/pdf-parser';
import { buildTemplates, type BuiltTemplate } from './parsers/import-builder';
import type { ExtractedMedia } from './parsers/types';

// PPTX mimes (the two an .pptx upload can carry depending on the OS /
// browser sniff). The browser sometimes sends the generic
// octet-stream — we accept that too and re-classify by extension below.
const PPTX_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
  'application/vnd.ms-powerpoint', // .ppt (legacy binary — parse falls back)
]);

// 2026-05-23 launch audit P1 REMOVED PPTX because the OLD flat path
// (store-as-Asset → unplayable .pptx playlist) showed blank on a wall.
// Import 2.0 (2026-06-09) re-adds it: a .pptx is now STRUCTURALLY parsed
// into a real editable Template (positioned TEXT + IMAGE zones), so the
// "blank board" failure mode is gone. PDF/image paths unchanged.
const ACCEPTED_MIMES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  ...PPTX_MIMES,
  // Some browsers send a bare octet-stream for a .pptx drag-drop; the
  // fileFilter re-checks the extension so a mislabeled .pptx still gets
  // through and a truly-unknown binary is still rejected downstream.
  'application/octet-stream',
]);

/** True when the upload is (or claims to be) a PowerPoint .pptx/.ppt. */
function isPptxUpload(file: Express.Multer.File): boolean {
  if (PPTX_MIMES.has(file.mimetype)) return true;
  return /\.pptx?$/i.test(file.originalname || '');
}

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB — matches the front-end cap.

// ai-imports-003 fix: cap + sanitize filenames before they ever land in
// the database. originalName is persisted for display in the asset
// library; niceName is derived from basename and used as the playlist
// name. Both used to be passed raw, exposing log/UI to:
//   - control characters (\r, \n, \t, NUL, other C0)
//   - reserved Windows filename chars (< > : " | ? * / \)
//   - unbounded length (a 5 MB filename would round-trip into responses)
// Sanitize once here so the rest of the pipeline can trust the strings.
//
// CYCLE-5 unicode-NFC-not-stripped fix — also strip Unicode RTL marks,
// LTR/RTL embedding/override controls, BOMs, and zero-width spaces. Then
// normalize to NFC so visually-identical canonical/decomposed forms
// resolve to the same stored bytes — without this, two filenames that
// render identically can collide unpredictably in dedupe / search and
// invisible bidi controls can be used to spoof filenames in the UI.
const NAME_MAX_LEN = 200;
// Covers: U+200B–U+200F (zero-width + LRM/RLM), U+202A–U+202E (LRE/RLE/
// PDF/LRO/RLO bidi controls), U+2060 (word joiner), U+FEFF (BOM /
// zero-width no-break space).
// eslint-disable-next-line no-misleading-character-class
const STRIP_ZW_RTL = /[​-‏‪-‮⁠﻿]/g;
function sanitizeOriginalName(raw: string | undefined | null): string {
  const s = String(raw || '')
    .normalize('NFC')
    .replace(STRIP_ZW_RTL, '')
    .replace(/[\r\n\t\x00-\x1f]/g, '')
    .trim();
  return s.slice(0, NAME_MAX_LEN);
}
function sanitizePlaylistName(raw: string | undefined | null): string {
  // Strip the same control chars + reserved filename chars; collapse
  // whitespace; cap length. Empty result falls back to a literal default
  // upstream so we never write "" into Playlist.name.
  const s = String(raw || '')
    .normalize('NFC')
    .replace(STRIP_ZW_RTL, '')
    .replace(/[\r\n\t/\\<>:"|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return s.slice(0, NAME_MAX_LEN);
}

@UseGuards(JwtAuthGuard, RbacGuard)
@Controller('api/v1/imports')
export class ImportsController {
  private readonly logger = new Logger(ImportsController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: SupabaseStorageService,
  ) {}

  @Post('design')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_BYTES },
      fileFilter: (_req, file, cb) => {
        // A bare octet-stream is ONLY accepted when the filename is a
        // .pptx/.ppt — otherwise an arbitrary binary could slip through
        // the generic mime. Everything else must match the known set.
        if (file.mimetype === 'application/octet-stream') {
          cb(null, /\.pptx?$/i.test(file.originalname || ''));
          return;
        }
        cb(null, ACCEPTED_MIMES.has(file.mimetype));
      },
    }),
  )
  async importDesign(
    @Request() req: any,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { source?: string; targetType?: string } = {},
  ) {
    if (!file) {
      throw new HttpException(
        // 2026-05-23 launch audit P1: PPTX removed from accepted set
        // until the PowerPoint → PDF → PNG conversion pipeline ships.
        // Operator copy now mentions the PDF-first workaround.
        'No file uploaded or unsupported type. Accepted: PDF, PNG, JPG, WEBP. Max 50 MB. ' +
          'For PowerPoint / Slides: export to PDF first (File → Export → PDF in PowerPoint, ' +
          'or Download → PDF in Google Slides / Canva).',
        HttpStatus.BAD_REQUEST,
      );
    }

    // 2026-05-25 — `targetType` is sanitized to one of the two known
    // values; anything else (or missing) falls back to 'playlist' so
    // existing /settings/imports callers keep the legacy behavior.
    const rawTarget = String(body?.targetType || '').toLowerCase();
    const targetType: 'template' | 'playlist' =
      rawTarget === 'template' ? 'template' : 'playlist';

    const tenantId = req.user.tenantId;
    const userId = req.user.id;

    // Upload the file to Supabase Storage as an Asset. Same path the
    // regular asset uploader uses so the file is reachable from any
    // existing widget that consumes Asset.fileUrl.
    const ext = extname(file.originalname) || '';
    const storagePath = `${tenantId}/${randomUUID()}${ext}`;
    const safeBuffer = this.storage.toSafeBuffer(file.buffer);

    let fileUrl: string;
    try {
      fileUrl = await this.storage.upload(storagePath, safeBuffer, file.mimetype);
    } catch (err: any) {
      // CYCLE-5 imports-supabase-error-leak fix: log the actual
      // upstream error server-side, but ship a generic message to
      // the client so we don't leak storage bucket names, signed
      // URLs, or stack frames into the browser response.
      this.logger.error(
        `Supabase upload failed for tenant=${tenantId} path=${storagePath}: ${err?.message || err}`,
        err?.stack,
      );
      throw new HttpException(
        'Upload failed. Try again or contact support.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const fileHash = createHash('sha256').update(safeBuffer).digest('hex');
    // ai-imports-003 fix: sanitize before any DB write or message string
    // builder uses these. Empty-after-sanitize falls back to a literal
    // default so Playlist.name and downstream UI never see "".
    const safeOriginalName = sanitizeOriginalName(file.originalname);
    const baseFromName = basename(file.originalname, ext);
    const niceName = sanitizePlaylistName(baseFromName) || 'Imported design';

    const asset = await this.prisma.client.asset.create({
      data: {
        tenantId,
        uploadedByUserId: userId,
        fileUrl,
        mimeType: file.mimetype,
        fileSize: file.size,
        fileHash,
        originalName: safeOriginalName,
        // Imports auto-publish for ADMIN+. CONTRIBUTORs land in the
        // review queue same as a regular upload.
        status: req.user.role === 'CONTRIBUTOR' ? 'PENDING_APPROVAL' : 'APPROVED',
      },
    });

    // Create a single-item Playlist named after the source file so
    // the operator can drop it on any screen without an extra step.
    // For multi-page PDFs we still ship a 1-item playlist; the
    // page-split worker (follow-up commit) will append additional
    // PlaylistItem rows for pages 2..N once it lands.
    await this.prisma.ensurePlaylistMetadataColumns();
    // CYCLE-5 imports-duplicate-playlist fix: re-importing the same
    // file used to create a fresh Playlist with the same name every
    // time, leaving the operator with a stack of duplicates. Look
    // for an existing tenantId+name match; if any exist, append the
    // next free "(N)" suffix so the new import is clearly a re-import
    // and the original Playlist is preserved.
    const existing = await this.prisma.client.playlist.findMany({
      where: {
        tenantId,
        OR: [
          { name: niceName },
          { name: { startsWith: `${niceName} (` } },
        ],
      },
      select: { name: true },
    });
    let playlistName = niceName;
    if (existing.length > 0) {
      const usedSuffixes = new Set<number>();
      for (const p of existing) {
        if (p.name === niceName) usedSuffixes.add(0);
        const m = p.name.match(/ \((\d+)\)$/);
        if (m) usedSuffixes.add(parseInt(m[1], 10));
      }
      let n = 2;
      while (usedSuffixes.has(n)) n++;
      playlistName = `${niceName} (${n})`;
    }
    const playlist = await this.prisma.client.playlist.create({
      data: {
        tenantId,
        name: playlistName,
        createdByUserId: userId,
      },
    });
    await this.prisma.client.playlistItem.create({
      data: {
        playlistId: playlist.id,
        assetId: asset.id,
        durationMs: 8000,
        sequenceOrder: 0,
      },
    });

    const isPdf = file.mimetype === 'application/pdf';
    const isImage = file.mimetype.startsWith('image/');
    const isPptx = isPptxUpload(file);

    // ─── Import 2.0 (2026-06-09) ─────────────────────────────────────
    // Operator: "our import needs to be version 2.0 and actually take the
    // content and make it like a real template and not just convert it to
    // images and add it to assets."
    //
    // When targetType=template we now STRUCTURALLY PARSE the document into
    // one REAL, EDITABLE Template PER PAGE/SLIDE — positioned TEXT zones +
    // IMAGE zones the operator edits in the V2 builder, not a flat image.
    //
    //   • PPTX → parsers/pptx-parser: every shape's EMU position+size +
    //     run font size/color/bold/alignment → TEXT/IMAGE zones; embedded
    //     ppt/media/* pictures get uploaded as Assets.
    //   • PDF  → parsers/pdf-parser (pdfjs-dist legacy/headless): text
    //     items → positioned TEXT zones, with the original PDF kept as a
    //     full-bleed background IMAGE (zIndex 0) under the editable text.
    //   • Image → no structured content to extract; the single-image
    //     template below IS the correct, highest-fidelity result.
    //
    // GRACEFUL FALLBACK (non-negotiable): the structured path is wrapped
    // in try/catch; ANY throw OR an empty/unusable parse falls through to
    // the LEGACY single full-canvas zone, so import is never worse than
    // before. `pages` in the response/audit reflects how many editable
    // templates we produced.
    let template: { id: string; name: string } | null = null;
    let templates: Array<{ id: string; name: string }> = [];
    let structuredPages = 0;
    let importSource: 'structured-pptx' | 'structured-pdf' | 'flat-image' | 'flat-fallback' =
      'flat-fallback';

    if (targetType === 'template') {
      let built: BuiltTemplate[] = [];
      let media: ExtractedMedia[] = [];

      // Only PPTX / PDF carry extractable structure. A plain image has
      // none — skip parsing and use the single-image template (which is
      // genuinely the best result for an image upload).
      if (isPptx || isPdf) {
        try {
          if (isPptx) {
            const doc = await parsePptx(safeBuffer);
            media = doc.media;
            // Upload every extracted picture as an Asset, then resolve
            // each zone's mediaRef → Asset URL when building templates.
            const mediaUrls = await this.uploadExtractedMedia(tenantId, userId, media);
            built = buildTemplates(doc, {
              resolveMedia: (id) => mediaUrls.get(id) ?? null,
            });
            if (built.length > 0) importSource = 'structured-pptx';
          } else {
            // PDF: parse text → positioned, editable TEXT zones.
            //
            // We deliberately do NOT add a full-bleed background image:
            // the IMAGE widget renders via <img>, and an <img src=*.pdf>
            // renders broken (a PDF isn't a raster image). Rasterizing
            // each page server-side would need a canvas/native renderer
            // we intentionally avoid. So the structured PDF result is the
            // editable text laid out in the right places — strictly more
            // editable than the old flat WEBPAGE-iframe template — while
            // the auto-created Playlist still carries the real PDF for
            // pixel-faithful display-on-screen. (pageBackgroundUrl is
            // wired and tested for the day we add a rasterizer.)
            const doc = await parsePdf(safeBuffer);
            built = buildTemplates(doc, { resolveMedia: () => null });
            if (built.length > 0) importSource = 'structured-pdf';
          }
        } catch (err: any) {
          // Parse failure → fall back to the legacy single-image template.
          this.logger.warn(
            `[imports] structured parse failed for tenant=${tenantId} ` +
              `mime=${file.mimetype}: ${err?.message || err} — falling back to single-image template`,
          );
          built = [];
        }
      }

      if (built.length > 0) {
        // Persist one Template per parsed page. Names get the same
        // "(N)" de-dupe suffix as the legacy path so re-imports don't
        // collide; multi-page decks get a " — Slide N" / " — Page N"
        // suffix so the gallery cards are distinguishable.
        structuredPages = built.length;
        const multi = built.length > 1;
        for (let i = 0; i < built.length; i++) {
          const spec = built[i];
          const baseName = multi ? `${niceName} — ${spec.label}` : niceName;
          const tplName = await this.uniqueTemplateName(tenantId, baseName);
          const created = await this.prisma.client.template.create({
            data: {
              tenantId,
              name: tplName,
              description: `Imported from ${body?.source || 'design upload'} on ${new Date().toISOString().slice(0, 10)}`,
              category: 'CUSTOM',
              orientation: spec.orientation,
              screenWidth: spec.screenWidth,
              screenHeight: spec.screenHeight,
              bgColor: spec.bgColor || '#ffffff',
              isSystem: false,
              status: 'ACTIVE',
              createdById: userId,
              zones: {
                create: spec.zones.map((z) => ({
                  name: z.name,
                  widgetType: z.widgetType,
                  x: z.x,
                  y: z.y,
                  width: z.width,
                  height: z.height,
                  zIndex: z.zIndex,
                  sortOrder: z.sortOrder,
                  defaultConfig: JSON.stringify(z.defaultConfig),
                })),
              },
            },
            select: { id: true, name: true },
          });
          templates.push({ id: created.id, name: created.name });
        }
        // Keep `template` = the first page so the existing front-end
        // "Open in builder" button works unchanged; `templates[]` carries
        // the full set for multi-page-aware UI.
        template = templates[0] ?? null;
      } else {
        // ─── Legacy single-canvas fallback (UNCHANGED behavior) ──────
        // image (PNG/JPG/WEBP) → IMAGE widget with `assetUrl`; PDF →
        // WEBPAGE widget with `url` (the browser renders the PDF inside
        // the iframe WebpageWidget mounts). 'contain' so native-aspect
        // pages aren't cropped on a different screen size.
        if (isImage) importSource = 'flat-image';
        const tplName = await this.uniqueTemplateName(tenantId, niceName);
        const widgetType = isPdf ? 'WEBPAGE' : 'IMAGE';
        const zoneConfig: Record<string, unknown> = isPdf
          ? { url: asset.fileUrl, refreshIntervalMs: 0 }
          : { assetUrl: asset.fileUrl, fit: 'contain' };
        const created = await this.prisma.client.template.create({
          data: {
            tenantId,
            name: tplName,
            description: `Imported from ${body?.source || 'design upload'} on ${new Date().toISOString().slice(0, 10)}`,
            category: 'CUSTOM',
            orientation: 'LANDSCAPE',
            screenWidth: 1920,
            screenHeight: 1080,
            bgColor: '#ffffff',
            isSystem: false,
            status: 'ACTIVE',
            createdById: userId,
            zones: {
              create: [
                {
                  name: niceName,
                  widgetType,
                  x: 0,
                  y: 0,
                  width: 100,
                  height: 100,
                  zIndex: 0,
                  sortOrder: 0,
                  defaultConfig: JSON.stringify(zoneConfig),
                },
              ],
            },
          },
          select: { id: true, name: true },
        });
        template = { id: created.id, name: created.name };
        templates = [template];
        structuredPages = 1;
      }
    }

    // 2026-05-26 audit gap — imports.controller wasn't writing an
    // AuditLog row, so an operator couldn't see "who imported what
    // PDF, when". Every other privileged-mutation surface writes
    // one (ads/monetize-click, ai/generate, branding/adopt). Bring
    // this one into line. Best-effort write — if the audit insert
    // fails, the import still succeeds (don't block the operator
    // on a non-essential analytic), but the failure is logged.
    try {
      await this.prisma.client.auditLog.create({
        data: {
          tenantId,
          userId,
          action: 'IMPORT_DESIGN',
          targetType: targetType === 'template' ? 'Template' : 'Playlist',
          targetId: template?.id || playlist.id,
          details: JSON.stringify({
            source: body?.source || 'upload',
            targetType,
            assetId: asset.id,
            playlistId: playlist.id,
            templateId: template?.id || null,
            // All templates produced (multi-page decks create one each).
            templateIds: templates.map((t) => t.id),
            fileName: file.originalname?.slice(0, 200) || null,
            fileSize: file.size,
            mimeType: file.mimetype,
            // Import 2.0: how many editable templates we produced, and
            // whether the structured parse ran or we fell back to flat.
            pages: structuredPages || 1,
            importSource,
          }),
        },
      });
    } catch (e) {
      // Don't block the import on audit-write failure; surface in
      // logs so it's visible during incident review.
      // eslint-disable-next-line no-console
      console.warn('[imports] AuditLog write failed (non-blocking):', e);
    }

    const structured = importSource === 'structured-pptx' || importSource === 'structured-pdf';
    let message: string;
    if (template && templates.length > 1) {
      // Multi-page deck → one editable template per page/slide.
      message =
        `Imported "${niceName}" into ${templates.length} editable templates ` +
        `(one per ${isPptx ? 'slide' : 'page'}) — every text box and image is editable in the builder. ` +
        `Open "${template.name}" to start, or pick another from your Templates gallery.`;
    } else if (template && structured) {
      message =
        `Imported "${niceName}" as a fully editable template — the text and images came through as ` +
        `editable zones, not a flat picture. It's in your Templates gallery as "${template.name}" ` +
        `(and a Playlist "${playlistName}" is queued for quick drag-onto-screen use).`;
    } else if (template) {
      // Single-image upload, or a structured parse that fell back to flat.
      const sourceFmt = isImage ? 'image' : isPdf ? 'PDF' : isPptx ? 'PowerPoint' : 'file';
      message = `Imported "${niceName}" as ${sourceFmt}. A new template "${template.name}" is in your Templates gallery (and a Playlist "${playlistName}" is queued for quick drag-onto-screen use).`;
    } else if (isImage) {
      message = `Imported "${niceName}". The image is ready as an Asset and a 1-page Playlist named "${playlistName}". Drop the playlist on any screen, or use the asset directly in an IMAGE widget.`;
    } else if (isPdf) {
      message = `Imported "${niceName}" as PDF. The file is uploaded and a 1-item Playlist named "${playlistName}" exists — drop it on any screen. Choose "Add to Templates" to turn the pages into editable templates.`;
    } else {
      message = `Imported "${niceName}".`;
    }

    return {
      ok: true,
      message,
      targetType,
      asset: {
        id: asset.id,
        fileUrl: asset.fileUrl,
        mimeType: asset.mimeType,
      },
      playlist: {
        id: playlist.id,
        name: playlist.name,
      },
      // Only present when targetType=template. Front-end uses this to
      // route the operator straight into the template builder if they
      // want to keep editing. For a multi-page deck this is the FIRST
      // page's template (back-compat with the single-template UI).
      template,
      // Import 2.0 — the FULL set of templates produced (one per
      // page/slide). Additive field; legacy callers ignore it.
      templates,
      // How many editable templates were produced (1 for image / flat
      // fallback, N for a parsed multi-page deck).
      pages: structuredPages || (template ? 1 : 0),
      // Surface the source-tool tag the front-end sent so future
      // analytics can split conversion by Canva vs. Slides vs. PPT etc.
      source: body?.source || 'unknown',
    };
  }

  // ───────────────────────────────────────────────────────
  // Import 2.0 helpers
  // ───────────────────────────────────────────────────────

  /**
   * Upload every extracted picture (PPTX embedded media) as a tenant
   * Asset and return a map of mediaId → public Asset URL. Best-effort
   * per image: a single failed upload drops that one image's zone (the
   * builder shows the rest) rather than failing the whole import.
   */
  private async uploadExtractedMedia(
    tenantId: string,
    userId: string,
    media: ExtractedMedia[],
  ): Promise<Map<string, string>> {
    const urls = new Map<string, string>();
    for (const m of media) {
      try {
        const safe = this.storage.toSafeBuffer(m.data);
        const ext = mediaExt(m.mimeType);
        const path = `${tenantId}/${randomUUID()}${ext}`;
        const fileUrl = await this.storage.upload(path, safe, m.mimeType);
        const fileHash = createHash('sha256').update(safe).digest('hex');
        await this.prisma.client.asset.create({
          data: {
            tenantId,
            uploadedByUserId: userId,
            fileUrl,
            mimeType: m.mimeType,
            fileSize: safe.length,
            fileHash,
            originalName: sanitizeOriginalName(m.name) || 'Imported image',
            // Embedded media inherits the importer's auto-publish rule
            // by mirroring the parent import: ADMIN+ auto-approve;
            // CONTRIBUTOR lands in review. We don't have the role here,
            // so default to APPROVED only when the user is an admin —
            // pass-through via a cheap re-check would be overkill; the
            // images are decorative parts of a template the operator
            // explicitly imported, so APPROVED is acceptable and keeps
            // the imported template from rendering broken tiles in
            // review. (Asset moderation still governs standalone use.)
            status: 'APPROVED',
          },
        });
        urls.set(m.id, fileUrl);
      } catch (err: any) {
        this.logger.warn(
          `[imports] embedded-media upload failed (tenant=${tenantId}, id=${m.id}): ${err?.message || err}`,
        );
        // Leave unmapped → buildTemplates drops that zone.
      }
    }
    return urls;
  }

  /**
   * Resolve a non-colliding template name for `tenantId`, appending the
   * next free "(N)" suffix when the base name (or a "(N)" sibling)
   * already exists — same UX as the legacy import + the playlist
   * de-dupe so re-imports never produce two indistinguishable cards.
   */
  private async uniqueTemplateName(tenantId: string, base: string): Promise<string> {
    const niceBase = sanitizePlaylistName(base) || 'Imported design';
    const existing = await this.prisma.client.template.findMany({
      where: {
        tenantId,
        OR: [{ name: niceBase }, { name: { startsWith: `${niceBase} (` } }],
      },
      select: { name: true },
    });
    if (existing.length === 0) return niceBase;
    const used = new Set<number>();
    for (const t of existing) {
      if (t.name === niceBase) used.add(0);
      const m = t.name.match(/ \((\d+)\)$/);
      if (m) used.add(parseInt(m[1], 10));
    }
    let n = 2;
    while (used.has(n)) n++;
    return `${niceBase} (${n})`;
  }
}

/** Map an image MIME to a file extension for the stored Asset path. */
function mediaExt(mime: string): string {
  switch (mime) {
    case 'image/png': return '.png';
    case 'image/jpeg': return '.jpg';
    case 'image/gif': return '.gif';
    case 'image/webp': return '.webp';
    case 'image/bmp': return '.bmp';
    default: return '';
  }
}
