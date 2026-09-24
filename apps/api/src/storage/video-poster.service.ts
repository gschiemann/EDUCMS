import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@cms/database';
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
import {
  describeProbe,
  errorMessage,
  hasCurrentProbe,
  mergeProbeFailure,
  mergeProbeMeta,
  probeVideoFromBuffer,
  probeVideoFromUrl,
  type ProbeOutcome,
} from './video-probe';

/**
 * The background work for ONE uploaded video: a poster frame on
 * `Asset.posterUrl` (2026-09-11) and its real dimensions / duration on
 * `Asset.processingMeta` (2026-09-24). One `kickOff`, two independent jobs.
 *
 * ── THE CONTRACT, IN ONE LINE ───────────────────────────────────────────────
 * This service can fail in any way it likes and the upload it was called from
 * must still succeed. Every public method resolves; none of them reject. A
 * video with no poster is a cosmetic gap and a video with no dimensions is an
 * em dash in a panel — both repaired by the backfill later; an upload that
 * 500s because ffmpeg choked on a weird container is a broken product. Both
 * call sites therefore use `kickOff()` (fire-and-forget, exactly like the
 * alt-text pipeline) so this work adds 0 ms to upload latency.
 *
 * ── TWO JOBS, SHIELDED FROM EACH OTHER ──────────────────────────────────────
 * The probe (ffprobe, headers only, milliseconds) runs first and lands the
 * RESOLUTION tile; the frame grab (ffmpeg, decodes to a keyframe) runs after.
 * Sequential rather than parallel so one upload never runs two decoders at
 * once on a small pod. They write DIFFERENT columns, so they cannot clobber
 * each other, and each is never-throws on its own: a poster that cannot be
 * extracted does not skip the probe, and vice versa.
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
 * ── WHERE THE DIMENSIONS LIVE ───────────────────────────────────────────────
 * `processingMeta.originalDimensions` (DISPLAY size — a portrait phone clip
 * is 1080×1920, not the 1920×1080 it is stored as), `durationMs`, and a
 * `probe` block (`ProbeFacts`, `probeVersion: 2` — codec / profile / level /
 * pixel format / avg + nominal fps / bitrate / rotation / coded size /
 * container / fast-start / first audio stream: everything the signage
 * compatibility grader reads), MERGED over whatever the row already holds
 * (`mergeProbeMeta`). That is the same JSON the sharp optimizer writes for an
 * image, so the media library's `metaDims` reads it with no change. No new
 * column, no migration.
 *
 * ── WHICH SOURCE IT READS ───────────────────────────────────────────────────
 * The multipart path already holds the bytes, so it passes the buffer. The
 * presign path and the backfill only have a storage path, so the tools are
 * pointed at the object URL we rebuild from `SUPABASE_URL` (never at a stored
 * `Asset.fileUrl`, which can be an arbitrary external address via
 * `POST /assets/url`). Over http, ffprobe reads the container index and
 * ffmpeg's input seek range-reads to the first keyframe, so that costs a few
 * hundred KB rather than re-downloading the whole video; if either fails for
 * any reason we fall back to downloading the object — ONCE, shared by both
 * jobs (`VideoSource.download` is memoised) — and work from bytes.
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
    void this.processVideo(args).catch((err: unknown) => {
      // processVideo already swallows everything; this is the belt to its
      // braces, so a future edit can never turn a poster or probe bug into an
      // unhandled rejection that takes the pod down.
      this.logger.warn(
        `[video] unexpected throw for ${args.assetId}: ${errorMessage(err)}`,
      );
    });
  }

  /**
   * Both jobs for one video, each shielded from the other. Resolves what each
   * produced; never throws.
   */
  async processVideo(args: PosterJobArgs): Promise<VideoJobResult> {
    if (!isPosterableVideo(args.mimeType))
      return { probed: false, posterUrl: null };
    const source = this.sourceFor(args);
    const probed = await this.probeForAsset(args, source);
    const posterUrl = await this.generateForAsset(args, source);
    return { probed, posterUrl };
  }

  /**
   * Probe → merge → persist. Resolves true when dimensions were written, false
   * for every failure (already logged). Never throws.
   */
  async probeForAsset(
    args: PosterJobArgs,
    source: VideoSource = this.sourceFor(args),
  ): Promise<boolean> {
    if (!isPosterableVideo(args.mimeType)) return false;

    let outcome: ProbeOutcome;
    try {
      outcome = await this.probe(source);
    } catch (err) {
      const reason = `threw: ${errorMessage(err)}`;
      this.logger.warn(`[probe] ffprobe threw for ${args.assetId}: ${reason}`);
      await this.stampProbeFailure(args, reason);
      return false;
    }

    if (!outcome.ok) {
      // NULL dimensions are a supported state ("—" in the panel). Say why, at
      // warn, once, and STAMP the row so the dashboard stops waiting for
      // facts that are not coming; the backfill gives it one more try per
      // probe version.
      this.logger.warn(
        `[probe] no dimensions for asset ${args.assetId}: ${outcome.reason}`,
      );
      await this.stampProbeFailure(args, outcome.reason);
      return false;
    }

    try {
      // Read → merge → write, because Prisma's Json column has no partial
      // update and every key the probe does not own must survive. Both reads
      // and writes are tenant-scoped: an asset id alone is not a tenant
      // boundary. updateMany, not update, so a row deleted while ffprobe ran
      // (a real race — this runs after the upload response was sent) is a
      // count of 0, not a throw.
      const row = await this.prisma.client.asset.findFirst({
        where: { id: args.assetId, tenantId: args.tenantId },
        select: { processingMeta: true },
      });
      if (!row) {
        this.logger.warn(
          `[probe] asset ${args.assetId} gone before persist; dimensions discarded`,
        );
        return false;
      }
      const merged = mergeProbeMeta(row.processingMeta, outcome);
      const res = await this.prisma.client.asset.updateMany({
        where: { id: args.assetId, tenantId: args.tenantId },
        // The merged value is plain JSON by construction (mergeProbeMeta only
        // ever spreads JSON it read back plus number/string/null leaves); the
        // assertion is what Prisma's NullableJson input type needs to see.
        data: { processingMeta: merged as Prisma.InputJsonObject },
      });
      if (res.count === 0) {
        this.logger.warn(
          `[probe] asset ${args.assetId} gone before persist; dimensions discarded`,
        );
        return false;
      }
    } catch (err) {
      this.logger.warn(
        `[probe] persist failed for ${args.assetId}: ${errorMessage(err)}`,
      );
      return false;
    }

    this.logger.log(
      `[probe] asset ${args.assetId} → ${describeProbe(outcome)}`,
    );
    return true;
  }

  /**
   * A FAILED probe stamps the row: `probedAt` + `probeFailed` (+ the version
   * that failed), merged through the same read → merge → updateMany path a
   * success uses, so every other key survives and the dimensions are never
   * touched. Without this an unreadable file reads "Checking the encoding…"
   * on the dashboard, which polls for facts that are not coming, for ten
   * minutes. Never throws; a row that already carries a current probe is left
   * alone (a stamp must never contradict facts). Resolves true when written.
   */
  private async stampProbeFailure(
    args: PosterJobArgs,
    reason: string,
  ): Promise<boolean> {
    try {
      const row = await this.prisma.client.asset.findFirst({
        where: { id: args.assetId, tenantId: args.tenantId },
        select: { processingMeta: true },
      });
      if (!row) return false;
      if (hasCurrentProbe(row.processingMeta)) return false;
      const merged = mergeProbeFailure(row.processingMeta, reason);
      const res = await this.prisma.client.asset.updateMany({
        where: { id: args.assetId, tenantId: args.tenantId },
        data: { processingMeta: merged as Prisma.InputJsonObject },
      });
      return res.count > 0;
    } catch (err) {
      this.logger.warn(
        `[probe] failure stamp not written for ${args.assetId}: ${errorMessage(err)}`,
      );
      return false;
    }
  }

  /**
   * Extract → store → persist. Resolves the poster's public URL, or null if
   * anything at all went wrong (already logged). Never throws.
   */
  async generateForAsset(
    args: PosterJobArgs,
    source: VideoSource = this.sourceFor(args),
  ): Promise<string | null> {
    if (!isPosterableVideo(args.mimeType)) return null;

    let outcome: PosterOutcome;
    try {
      outcome = await this.extract(source);
    } catch (err) {
      this.logger.warn(
        `[poster] extract threw for ${args.assetId}: ${errorMessage(err)}`,
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
    } catch (err) {
      this.logger.warn(
        `[poster] upload failed for ${args.assetId}: ${errorMessage(err)}`,
      );
      return null;
    }

    try {
      // updateMany, not update: tenant-scoped (the id alone is not a tenant
      // boundary) AND non-throwing if the asset was deleted while ffmpeg ran —
      // a real race, since this runs after the upload response was sent.
      const res = await this.prisma.client.asset.updateMany({
        where: { id: args.assetId, tenantId: args.tenantId },
        data: { posterUrl },
      });
      if (res.count === 0) {
        // Asset vanished mid-flight. Don't leave the orphan behind.
        await this.storage.delete(posterPath).catch(() => undefined);
        this.logger.warn(
          `[poster] asset ${args.assetId} gone before persist; poster discarded`,
        );
        return null;
      }
    } catch (err) {
      await this.storage.delete(posterPath).catch(() => undefined);
      this.logger.warn(
        `[poster] persist failed for ${args.assetId}: ${errorMessage(err)}`,
      );
      return null;
    }

    this.logger.log(
      `[poster] asset ${args.assetId} → ${posterPath} (${outcome.bytes} B, frame @${outcome.seekSeconds}s)`,
    );
    return posterUrl;
  }

  /**
   * One video, two consumers. In-memory bytes when the caller has them; else
   * the object URL WE built (the trusted-prefix contract in video-poster.ts /
   * video-probe.ts) plus a memoised full download, so if both jobs have to
   * fall back to bytes the object is pulled back once, not twice.
   */
  private sourceFor(args: PosterJobArgs): VideoSource {
    const buffer = args.buffer && args.buffer.length > 0 ? args.buffer : null;
    const storagePath = args.storagePath || null;
    let pending: Promise<Buffer | null> | null = null;
    return {
      buffer,
      ext: args.ext ?? null,
      // Trusted prefix = the public-URL shape THIS service builds. Anything
      // that doesn't start with it never reaches a decoder.
      url: storagePath ? this.storage.publicUrlForPath(storagePath) : null,
      trustedPrefix: storagePath ? this.storage.publicUrlForPath('') : '',
      download: () => {
        if (!storagePath) return Promise.resolve(null);
        if (!pending)
          pending = this.storage.download(storagePath).catch(() => null);
        return pending;
      },
    };
  }

  /**
   * Pick the cheapest source that can work: in-memory bytes if the caller has
   * them, otherwise a range-read straight off the object URL, otherwise a full
   * download. Each step degrades into the next.
   */
  private async extract(source: VideoSource): Promise<PosterOutcome> {
    if (source.buffer) {
      return extractVideoPosterFromBuffer(source.buffer, source.ext);
    }
    if (!source.url) return { ok: false, reason: 'no-source' };

    const viaUrl = await extractVideoPosterFromUrl(
      source.url,
      source.trustedPrefix,
    );
    if (viaUrl.ok) return viaUrl;

    // Fallback: pull the bytes back and try locally. Costs egress, so it is
    // second — but a poster we can only get this way is still worth having.
    const bytes = await source.download();
    if (!bytes || bytes.length === 0) {
      return { ok: false, reason: `url:${viaUrl.reason}; download-miss` };
    }
    const viaBytes = await extractVideoPosterFromBuffer(bytes, source.ext);
    if (viaBytes.ok) return viaBytes;
    return {
      ok: false,
      reason: `url:${viaUrl.reason}; bytes:${viaBytes.reason}`,
    };
  }

  /** Same ladder as `extract`, for ffprobe. */
  private async probe(source: VideoSource): Promise<ProbeOutcome> {
    if (source.buffer) return probeVideoFromBuffer(source.buffer, source.ext);
    if (!source.url) return { ok: false, reason: 'no-source' };

    const viaUrl = await probeVideoFromUrl(source.url, source.trustedPrefix);
    if (viaUrl.ok) return viaUrl;

    const bytes = await source.download();
    if (!bytes || bytes.length === 0) {
      return { ok: false, reason: `url:${viaUrl.reason}; download-miss` };
    }
    const viaBytes = await probeVideoFromBuffer(bytes, source.ext);
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

export interface VideoJobResult {
  /** Dimensions/duration were written to `processingMeta`. */
  probed: boolean;
  /** Public URL of the stored poster, or null. */
  posterUrl: string | null;
}

/** The resolved input for one job — see `sourceFor`. */
export interface VideoSource {
  readonly buffer: Buffer | null;
  readonly ext: string | null;
  /** Object URL built from SUPABASE_URL + storage path; null without a path. */
  readonly url: string | null;
  readonly trustedPrefix: string;
  /** Memoised full download of the object; null without a path or on failure. */
  download(): Promise<Buffer | null>;
}
