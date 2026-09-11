import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseStorageService } from './supabase-storage.service';
import {
  extractVideoPosterFromBuffer,
  extractVideoPosterFromUrl,
  isPosterableVideo,
  POSTER_EXT,
  POSTER_MIME,
  type PosterOutcome,
} from './video-poster';

/**
 * Turns an uploaded video into a poster frame and hangs it on `Asset.posterUrl`.
 *
 * ── THE CONTRACT, IN ONE LINE ───────────────────────────────────────────────
 * This service can fail in any way it likes and the upload it was called from
 * must still succeed. Every public method resolves; none of them reject. A
 * video with no poster is a cosmetic gap the backfill can repair later; an
 * upload that 500s because ffmpeg choked on a weird container is a broken
 * product. Both call sites therefore use `kickOff()` (fire-and-forget, exactly
 * like the alt-text pipeline) so poster work adds 0 ms to upload latency.
 *
 * ── WHERE THE POSTER LIVES ──────────────────────────────────────────────────
 * `<tenantId>/posters/<uuid>.jpg` in the SAME public `assets` bucket the video
 * is in, written through `SupabaseStorageService.upload()` — i.e. the existing
 * chain: `toSafeBuffer` normalisation, the REST transport with its node:https
 * fallback, and the immutable `cache-control` header. The path is deliberately
 * TWO segments after the tenant prefix, which makes it un-mintable by
 * `isMintedUploadPath` (upload-path.ts): `POST /assets/complete-upload` can
 * therefore never name a poster object, so the UPLD-02 hijack-delete class
 * cannot reach one.
 *
 * ── WHICH SOURCE IT READS ───────────────────────────────────────────────────
 * The multipart path already holds the bytes, so it passes the buffer. The
 * presign path and the backfill only have a storage path, so ffmpeg is pointed
 * at the object URL we rebuild from `SUPABASE_URL` (never at a stored
 * `Asset.fileUrl`, which can be an arbitrary external address via
 * `POST /assets/url`). An input seek range-reads, so that costs a few hundred
 * KB rather than re-downloading up to the 50 MB per-video cap; if it fails for
 * any reason we fall back to downloading the object and extracting from bytes.
 */
@Injectable()
export class VideoPosterService {
  private readonly logger = new Logger(VideoPosterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: SupabaseStorageService,
  ) {}

  /** `<tenantId>/posters/<uuid>.jpg` — see the class comment for why not one segment. */
  posterStoragePath(tenantId: string): string {
    return `${tenantId}/posters/${randomUUID()}${POSTER_EXT}`;
  }

  /**
   * Fire-and-forget wrapper. Returns void immediately; the never-throws
   * guarantee is enforced here so no call site has to remember `.catch()`.
   */
  kickOff(args: PosterJobArgs): void {
    if (!isPosterableVideo(args.mimeType)) return;
    void this.generateForAsset(args).catch((err) => {
      // generateForAsset already swallows everything; this is the belt to its
      // braces, so a future edit can never turn a poster bug into an
      // unhandled rejection that takes the pod down.
      this.logger.warn(
        `[poster] unexpected throw for ${args.assetId}: ${err?.message ?? err}`,
      );
    });
  }

  /**
   * Extract → store → persist. Resolves the poster's public URL, or null if
   * anything at all went wrong (already logged). Never throws.
   */
  async generateForAsset(args: PosterJobArgs): Promise<string | null> {
    if (!isPosterableVideo(args.mimeType)) return null;

    let outcome: PosterOutcome;
    try {
      outcome = await this.extract(args);
    } catch (err: any) {
      this.logger.warn(
        `[poster] extract threw for ${args.assetId}: ${err?.message ?? err}`,
      );
      return null;
    }

    if (!outcome.ok) {
      // A NULL poster is a supported state — say why, at warn, once, and move
      // on. The backfill retries NULL rows, so nothing is lost permanently.
      this.logger.warn(
        `[poster] no poster for asset ${args.assetId}: ${outcome.reason}`,
      );
      return null;
    }

    const posterPath = this.posterStoragePath(args.tenantId);
    let posterUrl: string;
    try {
      posterUrl = await this.storage.upload(
        posterPath,
        outcome.buffer,
        POSTER_MIME,
      );
    } catch (err: any) {
      this.logger.warn(
        `[poster] upload failed for ${args.assetId}: ${err?.message ?? err}`,
      );
      return null;
    }

    try {
      // updateMany, not update: tenant-scoped (the id alone is not a tenant
      // boundary) AND non-throwing if the asset was deleted while ffmpeg ran —
      // a real race, since this runs after the upload response was sent.
      const res = await this.prisma.client.asset.updateMany({
        where: { id: args.assetId, tenantId: args.tenantId },
        data: { posterUrl } as any,
      });
      if (res.count === 0) {
        // Asset vanished mid-flight. Don't leave the orphan behind.
        await this.storage.delete(posterPath).catch(() => undefined);
        this.logger.warn(
          `[poster] asset ${args.assetId} gone before persist; poster discarded`,
        );
        return null;
      }
    } catch (err: any) {
      await this.storage.delete(posterPath).catch(() => undefined);
      this.logger.warn(
        `[poster] persist failed for ${args.assetId}: ${err?.message ?? err}`,
      );
      return null;
    }

    this.logger.log(
      `[poster] asset ${args.assetId} → ${posterPath} (${outcome.bytes} B, frame @${outcome.seekSeconds}s)`,
    );
    return posterUrl;
  }

  /**
   * Pick the cheapest source that can work: in-memory bytes if the caller has
   * them, otherwise a range-read straight off the object URL, otherwise a full
   * download. Each step degrades into the next.
   */
  private async extract(args: PosterJobArgs): Promise<PosterOutcome> {
    if (args.buffer && args.buffer.length > 0) {
      return extractVideoPosterFromBuffer(args.buffer, args.ext ?? null);
    }
    if (!args.storagePath) return { ok: false, reason: 'no-source' };

    // Trusted prefix = the public-URL shape THIS service builds. Anything that
    // doesn't start with it never reaches ffmpeg (see video-poster.ts).
    const trustedPrefix = this.storage.publicUrlForPath('');
    const url = this.storage.publicUrlForPath(args.storagePath);
    const viaUrl = await extractVideoPosterFromUrl(url, trustedPrefix);
    if (viaUrl.ok) return viaUrl;

    // Fallback: pull the bytes back and try locally. Costs egress, so it is
    // second — but a poster we can only get this way is still worth having.
    const bytes = await this.storage
      .download(args.storagePath)
      .catch(() => null);
    if (!bytes || bytes.length === 0) {
      return { ok: false, reason: `url:${viaUrl.reason}; download-miss` };
    }
    const viaBytes = await extractVideoPosterFromBuffer(
      bytes,
      args.ext ?? null,
    );
    if (viaBytes.ok) return viaBytes;
    return {
      ok: false,
      reason: `url:${viaUrl.reason}; bytes:${viaBytes.reason}`,
    };
  }
}

export interface PosterJobArgs {
  assetId: string;
  tenantId: string;
  mimeType: string;
  /** Bucket-relative path of the VIDEO (not the poster). Used when bytes aren't in hand. */
  storagePath?: string | null;
  /** In-memory video bytes, when the caller already has them (multipart upload). */
  buffer?: Buffer | null;
  /** Original file extension, only a demuxer hint for the temp file. */
  ext?: string | null;
}
