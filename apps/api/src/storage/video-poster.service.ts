import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@cms/database';
import { createHash, randomUUID } from 'crypto';
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
  type ProbeSuccess,
} from './video-probe';
import {
  alreadyFastStart,
  buildRemuxMeta,
  mergeRemuxMeta,
  needsFastStartRemux,
  probedReplacedOriginal,
  remuxFastStart,
  remuxParityProblem,
  remuxStoragePath,
  REMUX_MIME,
  REMUX_OUTPUT_EXT,
} from './video-remux';

/**
 * The background work for ONE uploaded video: a poster frame on
 * `Asset.posterUrl` (2026-09-11), its real dimensions / duration on
 * `Asset.processingMeta` (2026-09-24), and — when the probe reads an MP4 whose
 * index sits at the end — a lossless fast-start re-mux (2026-09-24). One
 * `kickOff`, three jobs.
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
 * any reason we fall back to downloading the object — ONCE, shared by every
 * job (`VideoSource.download` is memoised) — and work from bytes.
 *
 * ── THE FAST-START RE-MUX ───────────────────────────────────────────────────
 * An MP4 whose index (`moov`) sits after its samples cannot show a frame
 * until the whole file has arrived, and the playback grade used to tell the
 * operator to re-export. Now, when the probe reads exactly that
 * (`needsFastStartRemux`), the file is re-muxed losslessly (video-remux.ts —
 * `-c copy -movflags +faststart`, no re-encode), the copy is PROVED to be the
 * same media with its index in front (`remuxParityProblem`), stored BESIDE the
 * original under a fresh name, and the row is swapped onto it in ONE
 * tenant-scoped write guarded by the URL the re-mux started from — with a new
 * `fileHash`, because the player's cache refuses bytes that do not match it.
 * Async by default: the probe answer lands first, the fixed file seconds later.
 *
 * The ORIGINAL IS KEPT, deliberately. The row is not the only holder of its
 * URL: the template builder writes the picked video's URL into the widget
 * config (`assetUrl` / `assetUrls`) the moment the upload returns — while this
 * re-mux is still running, often before the template is even saved — and
 * per-screen emergency media, template versions and fleet-distributed rows
 * hold copies too. Deleting the original would turn every one of them into a
 * 404 on glass; keeping it costs storage. `processingMeta.remux
 * .previousStoragePath` records it, and deleting the asset deletes it
 * (assets.controller.ts).
 *
 * Never re-muxed: emergency content (a URL change would leave the never-evict
 * cache tier without the file it now points at), a file shared with another
 * asset row (fleet distribution — one object, a row per location), a file
 * outside the row's own tenant folder, and everything while the kill switch
 * `VIDEO_FASTSTART_REMUX_DISABLED=1` is set. At most ONE re-mux runs per
 * process at a time: each holds ~3× the file in memory, on the pod that also
 * carries emergency delivery.
 *
 * ORDER WITH THE SIGNAGE TRANSCODE (storage/video-transcode, 2026-09-24): a
 * re-mux is DEFERRED while a `video_transcode_jobs` row for the asset is
 * queued or running — checked before it starts and again right before the
 * swap. The transcode's swap is conditional on the row still serving the URL
 * it was queued with, so a re-mux first would make it `source-changed`; its
 * output is `+faststart` anyway, and when it KEEPS the original (not smaller,
 * already optimal, a failed encode) its worker runs this pass itself.
 */
/**
 * Largest object the in-memory download fallback will pull (2026-09-23): the
 * multipart upload ceiling, i.e. the most this path ever held before direct
 * uploads reached 2 GB. Bounds BOTH jobs — the probe and the poster share the
 * one memoised download (`sourceFor`).
 */
export const POSTER_FALLBACK_MAX_BYTES = 500 * 1024 * 1024;

@Injectable()
export class VideoPosterService {
  private readonly logger = new Logger(VideoPosterService.name);
  /** One re-mux at a time per process — see the class comment. */
  private remuxTail: Promise<unknown> = Promise.resolve();
  /** Assets with a re-mux queued or running on THIS replica. */
  private readonly remuxInFlight = new Set<string>();

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
   * The fast-start re-mux, when the probe asks for one, is queued (`'async'`).
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
   * Every job for one video, each shielded from the others: probe, poster,
   * then the fast-start re-mux (`opts.remux`, default `'async'`). Resolves
   * what each produced; never throws.
   */
  async processVideo(
    args: PosterJobArgs,
    opts: VideoJobOptions = {},
  ): Promise<VideoJobResult> {
    if (!isPosterableVideo(args.mimeType))
      return { probed: false, posterUrl: null, remux: 'not-needed' };
    const source = this.sourceFor(args);
    const probe = await this.probeAndPersist(args, source);
    const posterUrl =
      opts.poster === false ? null : await this.generateForAsset(args, source);
    const remux = await this.fastStart(
      args,
      source,
      probe,
      opts.remux ?? 'async',
    );
    return { probed: probe.persisted, posterUrl, remux };
  }

  /**
   * Probe → merge → persist. Resolves true when dimensions were written, false
   * for every failure (already logged). Never throws.
   */
  async probeForAsset(
    args: PosterJobArgs,
    source: VideoSource = this.sourceFor(args),
  ): Promise<boolean> {
    return (await this.probeAndPersist(args, source)).persisted;
  }

  /**
   * The probe half, returning the facts it read as well as whether they were
   * saved — the re-mux decision needs both. Never throws.
   */
  private async probeAndPersist(
    args: PosterJobArgs,
    source: VideoSource,
  ): Promise<ProbeStep> {
    if (!isPosterableVideo(args.mimeType))
      return { persisted: false, outcome: null };

    let outcome: ProbeOutcome;
    try {
      outcome = await this.probe(source);
    } catch (err) {
      const reason = `threw: ${errorMessage(err)}`;
      this.logger.warn(`[probe] ffprobe threw for ${args.assetId}: ${reason}`);
      await this.stampProbeFailure(args, reason);
      return { persisted: false, outcome: null };
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
      return { persisted: false, outcome: null };
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
        return { persisted: false, outcome };
      }
      if (probedReplacedOriginal(row.processingMeta, args.storagePath)) {
        // The row moved onto its fast-start copy while this probe read the
        // original: its facts describe a file the row no longer plays.
        this.logger.log(
          `[probe] asset ${args.assetId}: read the original, but the row now plays its fast-start copy — facts kept`,
        );
        return { persisted: false, outcome: null };
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
        return { persisted: false, outcome };
      }
    } catch (err) {
      this.logger.warn(
        `[probe] persist failed for ${args.assetId}: ${errorMessage(err)}`,
      );
      return { persisted: false, outcome };
    }

    this.logger.log(
      `[probe] asset ${args.assetId} → ${describeProbe(outcome)}`,
    );
    return { persisted: true, outcome };
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
   * Resolves once every re-mux queued on this replica has finished. For tests
   * and an orderly shutdown; nothing on the request path waits on it.
   */
  whenRemuxIdle(): Promise<void> {
    return this.remuxTail.then(() => undefined);
  }

  /**
   * Decide the fast-start step for this call and, when it runs, queue it
   * behind this process's single re-mux slot. `'sync'` waits for the outcome;
   * `'async'` returns `'scheduled'` at once. Never throws.
   */
  private async fastStart(
    args: PosterJobArgs,
    source: VideoSource,
    probe: ProbeStep,
    mode: RemuxMode,
  ): Promise<RemuxStatus> {
    const facts = probe.outcome;
    if (!facts || !needsFastStartRemux(facts)) return 'not-needed';
    if (mode === 'skip')
      return this.remuxSkipped(args, 'this call asked for no re-mux');
    if (process.env.VIDEO_FASTSTART_REMUX_DISABLED === '1')
      return this.remuxSkipped(
        args,
        'disabled via env (VIDEO_FASTSTART_REMUX_DISABLED=1)',
      );
    if (!probe.persisted)
      return this.remuxSkipped(args, 'its probe could not be saved');
    const transcode = await this.transcodePending(args.assetId);
    if (transcode !== null)
      return this.remuxSkipped(args, describeTranscodeDeferral(transcode));
    if (this.remuxInFlight.has(args.assetId))
      return this.remuxSkipped(args, 'a re-mux of it is already queued here');

    this.remuxInFlight.add(args.assetId);
    const job = this.enqueueRemux(() =>
      this.remuxForAsset(args, source, facts),
    ).finally(() => {
      this.remuxInFlight.delete(args.assetId);
    });
    if (mode === 'sync') return job;
    // remuxForAsset resolves on every path; this catch is the belt to its
    // braces, so a future edit cannot turn it into an unhandled rejection.
    void job.catch((err: unknown) => {
      this.logger.warn(
        `[remux] unexpected throw for ${args.assetId}: ${errorMessage(err)}`,
      );
    });
    return 'scheduled';
  }

  /** Chain `job` behind whatever re-mux this process is already running. */
  private enqueueRemux(job: () => Promise<RemuxStatus>): Promise<RemuxStatus> {
    const run = this.remuxTail.then(job);
    this.remuxTail = run.catch(() => undefined);
    return run;
  }

  /**
   * Read the row → guards → bytes → re-mux → prove → store beside → swap.
   * Resolves what happened, never throws; anything but `'remuxed'` leaves the
   * row exactly as it was (and never stamps `probeFailed` — the probe was
   * fine, only the fix did not happen).
   */
  private async remuxForAsset(
    args: PosterJobArgs,
    source: VideoSource,
    original: ProbeSuccess,
  ): Promise<RemuxStatus> {
    let copyInStorage: string | null = null;
    try {
      // 1. The row as it is NOW, tenant-scoped like every read here.
      const row = await this.prisma.client.asset.findFirst({
        where: { id: args.assetId, tenantId: args.tenantId },
        select: { fileUrl: true, processingMeta: true },
      });
      if (!row) return this.remuxSkipped(args, 'the asset is gone');
      if (alreadyFastStart(row.processingMeta))
        return this.remuxSkipped(args, 'it is already fast-start');
      const oldUrl = row.fileUrl;
      const oldPath = this.storage.extractPath(oldUrl);
      if (!oldPath)
        return this.remuxSkipped(args, 'a linked URL, not a file we store');
      if (!oldPath.startsWith(`${args.tenantId}/`))
        return this.remuxSkipped(
          args,
          "the file is outside this tenant's storage folder",
        );
      if (args.storagePath && args.storagePath !== oldPath)
        return this.remuxSkipped(args, 'its file changed after the probe');

      // 2. What must never be re-pointed.
      const emergency = await this.emergencyUse(args.assetId, oldUrl);
      if (emergency) return this.skippedAsEmergency(args, emergency);
      const shared = await this.otherRowsUsing(args.assetId, oldUrl);
      if (shared !== 0)
        return this.remuxSkipped(
          args,
          shared === null
            ? 'could not confirm that no other asset row uses the file'
            : `the file is shared with ${shared} other asset row(s) (fleet distribution)`,
        );

      // 3. Bytes → re-mux → prove it is the same media, index in front.
      const input = source.buffer ?? (await source.download());
      if (!input || input.length === 0)
        return this.remuxFailed(args, 'could not read the file');
      const remuxed = await remuxFastStart({ buffer: input, ext: source.ext });
      if (!remuxed.ok) return this.remuxFailed(args, remuxed.reason);
      const reprobe = await probeVideoFromBuffer(
        remuxed.buffer,
        REMUX_OUTPUT_EXT,
      );
      const problem = remuxParityProblem(original, reprobe);
      if (problem || !reprobe.ok)
        return this.remuxFailed(
          args,
          problem ?? 'the re-muxed file does not probe',
        );

      // 4. Store the copy beside the original, under a name unique to this
      //    attempt — never an overwrite of a published object.
      const newPath = remuxStoragePath(oldPath);
      let newUrl: string;
      try {
        newUrl = await this.storage.upload(newPath, remuxed.buffer, REMUX_MIME);
      } catch (err) {
        await this.discardCopy(newPath);
        return this.remuxFailed(args, `upload: ${errorMessage(err)}`);
      }
      copyInStorage = newPath;

      // 5. One more look right before the swap: an operator can put the
      //    video into an emergency playlist while ffmpeg runs.
      const late = await this.emergencyUse(args.assetId, oldUrl);
      if (late) {
        await this.discardCopy(newPath);
        return this.skippedAsEmergency(args, late);
      }
      //    …and a signage transcode can be (re-)queued for it meanwhile: its
      //    swap must find the row unchanged, so it wins and this copy goes.
      const lateTranscode = await this.transcodePending(args.assetId);
      if (lateTranscode !== null) {
        await this.discardCopy(newPath);
        return this.remuxSkipped(
          args,
          `during the re-mux, ${describeTranscodeDeferral(lateTranscode)}`,
        );
      }

      // 6. The swap.
      return await this.swapOntoCopy(args, {
        oldUrl,
        oldPath,
        newUrl,
        newPath,
        bytes: remuxed.buffer,
        bytesBefore: remuxed.bytesBefore,
        reprobe,
      });
    } catch (err) {
      // Nothing above throws by design. If something did after the copy was
      // stored, we cannot prove the row does not point at it — keep it.
      return this.remuxFailed(
        args,
        `threw: ${errorMessage(err)}` +
          (copyInStorage ? `; kept ${copyInStorage}` : ''),
      );
    }
  }

  /**
   * ONE write moves the row onto the copy: tenant-scoped, and guarded by the
   * URL the re-mux started from, so if anything re-pointed the row meanwhile
   * (another replica's re-mux won) it is a count of 0 and nothing changes.
   * The copy is deleted only when a read PROVES no row points at it.
   */
  private async swapOntoCopy(
    args: PosterJobArgs,
    s: {
      oldUrl: string;
      oldPath: string;
      newUrl: string;
      newPath: string;
      bytes: Buffer;
      bytesBefore: number;
      reprobe: ProbeSuccess;
    },
  ): Promise<RemuxStatus> {
    const where = { id: args.assetId, tenantId: args.tenantId };
    let count: number;
    try {
      // Read → merge → write, like the probe persist: every key the swap does
      // not own survives, and probe.fastStart comes from the NEW bytes.
      const current = await this.prisma.client.asset.findFirst({
        where,
        select: { processingMeta: true },
      });
      if (!current) {
        await this.discardCopy(s.newPath);
        return this.remuxSkipped(
          args,
          'the asset was deleted during the re-mux',
        );
      }
      const processingMeta = mergeRemuxMeta(
        current.processingMeta,
        s.reprobe,
        buildRemuxMeta({
          previousStoragePath: s.oldPath,
          bytesBefore: s.bytesBefore,
          bytesAfter: s.bytes.length,
        }),
      );
      const res = await this.prisma.client.asset.updateMany({
        where: { ...where, fileUrl: s.oldUrl },
        data: {
          fileUrl: s.newUrl,
          fileSize: s.bytes.length,
          // The player's cache verifies every download against this digest
          // and REFUSES bytes that do not match — a new file needs its own.
          fileHash: createHash('sha256').update(s.bytes).digest('hex'),
          processingMeta: processingMeta as Prisma.InputJsonObject,
        },
      });
      count = res.count;
    } catch (err) {
      // A throw does not prove the write did not land (a connection can drop
      // after the commit), so ask the row before touching the copy.
      const pointsAtCopy = await this.rowPointsAt(args, s.newUrl);
      if (pointsAtCopy === true) return this.remuxDone(args, s);
      if (pointsAtCopy === false) await this.discardCopy(s.newPath);
      return this.remuxFailed(
        args,
        `swap: ${errorMessage(err)}` +
          (pointsAtCopy === null
            ? `; kept ${s.newPath} (could not confirm the row does not use it)`
            : ''),
      );
    }
    if (count === 0) {
      // The copy's name is unique to this attempt: nothing else points at it.
      await this.discardCopy(s.newPath);
      return this.remuxSkipped(
        args,
        'the row changed or was deleted during the re-mux',
      );
    }
    return this.remuxDone(args, s);
  }

  /**
   * Is a signage transcode (storage/video-transcode) on its way for this
   * asset? 'queued' | 'running' when one is, null when none is, 'unknown'
   * when the read failed (treated as "yes" — fail closed). The transcode's
   * swap is conditional on the row STILL serving the URL it was queued with,
   * so a re-mux that moved the row first would turn the transcode into
   * `source-changed` and cost the file its smaller copy; the transcode's own
   * output is `+faststart`, and its worker calls back into `processVideo`
   * (`VideoTranscodePipeline.remuxKeptOriginal`) when it keeps the original.
   */
  private async transcodePending(
    assetId: string,
  ): Promise<'queued' | 'running' | 'unknown' | null> {
    try {
      const job = await this.prisma.client.videoTranscodeJob.findFirst({
        where: { assetId, status: { in: ['queued', 'running'] } },
        select: { status: true },
      });
      if (!job) return null;
      return job.status === 'running' ? 'running' : 'queued';
    } catch {
      return 'unknown';
    }
  }

  /**
   * Is this asset emergency content by ANY path the alert pipeline reads? The
   * same columns `GET /screens/:id/emergency-assets` builds the never-evict
   * cache tier from (14 tenant playlists, 12 per-screen playlists, 12
   * per-screen media URLs), plus protected playlists and live overrides /
   * messages. Returns a short label, or null. Deliberately NOT tenant-scoped:
   * a district playlist can hold a school's asset, and a wider look only makes
   * this guard more careful. Fails CLOSED — a check that cannot run is a
   * reason to leave the file alone.
   */
  private async emergencyUse(
    assetId: string,
    fileUrl: string,
  ): Promise<string | null> {
    const db = this.prisma.client;
    try {
      const items = await db.playlistItem.findMany({
        where: { assetId },
        select: { playlistId: true },
      });
      const ids = [...new Set(items.map((i) => i.playlistId))];
      if (ids.length > 0) {
        const inIds = { in: ids };
        const guarded = await db.playlist.findFirst({
          where: { id: inIds, isProtected: true },
          select: { id: true },
        });
        if (guarded) return `protected playlist ${guarded.id}`;
        const tenant = await db.tenant.findFirst({
          where: {
            OR: TENANT_EMERGENCY_PLAYLIST_FIELDS.map(
              (f) => ({ [f]: inIds }) as Prisma.TenantWhereInput,
            ),
          },
          select: { id: true },
        });
        if (tenant) return `an emergency playlist of tenant ${tenant.id}`;
        const screen = await db.screen.findFirst({
          where: {
            OR: SCREEN_EMERGENCY_PLAYLIST_FIELDS.map(
              (f) => ({ [f]: inIds }) as Prisma.ScreenWhereInput,
            ),
          },
          select: { id: true },
        });
        if (screen) return `an emergency playlist of screen ${screen.id}`;
      }
      const screenMedia = await db.screen.findFirst({
        where: {
          OR: SCREEN_EMERGENCY_MEDIA_URL_FIELDS.map(
            (f) => ({ [f]: fileUrl }) as Prisma.ScreenWhereInput,
          ),
        },
        select: { id: true },
      });
      if (screenMedia) return `the emergency media of screen ${screenMedia.id}`;
      const override = await db.screenEmergencyOverride.findFirst({
        where: {
          OR: [
            { mediaUrl: fileUrl },
            ...(ids.length > 0 ? [{ playlistId: { in: ids } }] : []),
          ],
        },
        select: { id: true },
      });
      if (override) return `live screen override ${override.id}`;
      const message = await db.emergencyMessage.findFirst({
        where: {
          clearedAt: null,
          OR: [{ audioUrl: fileUrl }, { mediaUrls: { contains: fileUrl } }],
        },
        select: { id: true },
      });
      if (message) return `live emergency message ${message.id}`;
      return null;
    } catch (err) {
      return `the emergency check could not run: ${errorMessage(err)}`;
    }
  }

  /** OTHER asset rows (any tenant) pointing at this file; null when unknown. */
  private async otherRowsUsing(
    assetId: string,
    fileUrl: string,
  ): Promise<number | null> {
    try {
      return await this.prisma.client.asset.count({
        where: { fileUrl, id: { not: assetId } },
      });
    } catch {
      return null;
    }
  }

  /** Does the row point at `url`? true / false when a read answers; null when it cannot. */
  private async rowPointsAt(
    args: PosterJobArgs,
    url: string,
  ): Promise<boolean | null> {
    try {
      const row = await this.prisma.client.asset.findFirst({
        where: { id: args.assetId, tenantId: args.tenantId },
        select: { fileUrl: true },
      });
      return row ? row.fileUrl === url : false;
    } catch {
      return null;
    }
  }

  /** Best-effort delete of OUR copy — only ever a path this attempt minted that no row uses. */
  private async discardCopy(path: string): Promise<void> {
    await this.storage.delete(path).catch(() => undefined);
  }

  private remuxDone(
    args: PosterJobArgs,
    s: { oldPath: string; newPath: string; bytes: Buffer; bytesBefore: number },
  ): 'remuxed' {
    this.logger.log(
      `[remux] asset ${args.assetId} → ${s.newPath}: index moved to the front ` +
        `(${s.bytesBefore} → ${s.bytes.length} B); the original ${s.oldPath} is kept`,
    );
    return 'remuxed';
  }

  private skippedAsEmergency(args: PosterJobArgs, use: string): 'skipped' {
    return this.remuxSkipped(
      args,
      `emergency content (${use}) — a new URL would leave the never-evict cache without it`,
    );
  }

  private remuxSkipped(args: PosterJobArgs, why: string): 'skipped' {
    this.logger.log(`[remux] asset ${args.assetId} not re-muxed: ${why}`);
    return 'skipped';
  }

  private remuxFailed(args: PosterJobArgs, why: string): 'failed' {
    this.logger.warn(
      `[remux] asset ${args.assetId} re-mux failed, file left as it was: ${why}`,
    );
    return 'failed';
  }

  /**
   * One video, several consumers. In-memory bytes when the caller has them;
   * else the object URL WE built (the trusted-prefix contract in
   * video-poster.ts / video-probe.ts) plus a memoised full download, so if
   * several jobs fall back to bytes the object is pulled back once, not twice.
   */
  private sourceFor(args: PosterJobArgs): VideoSource {
    const buffer = args.buffer && args.buffer.length > 0 ? args.buffer : null;
    const storagePath = args.storagePath || null;
    let pending: Promise<Buffer | null> | null = null;
    const source: VideoSource = {
      buffer,
      ext: args.ext ?? null,
      // Trusted prefix = the public-URL shape THIS service builds. Anything
      // that doesn't start with it never reaches a decoder.
      url: storagePath ? this.storage.publicUrlForPath(storagePath) : null,
      trustedPrefix: storagePath ? this.storage.publicUrlForPath('') : '',
      downloadSkipped: null,
      download: () => {
        if (!storagePath) return Promise.resolve(null);
        if (!pending) pending = this.boundedDownload(storagePath, source);
        return pending;
      },
    };
    return source;
  }

  /**
   * The ONE full download both jobs fall back to — BOUNDED (2026-09-23).
   * `download()` holds the WHOLE object in this process's memory, and direct
   * uploads now reach 2 GB. Above the multipart ceiling (the most this path
   * ever held before) the fallback is skipped rather than risk the API's
   * heap: the probe and the poster each report `too-large-for-download-
   * fallback`, and a NULL poster / no dimensions is a supported state. The
   * size comes from one HEAD-style object read; a storage that cannot answer
   * it falls through to the download exactly as before.
   */
  private async boundedDownload(
    storagePath: string,
    source: VideoSource,
  ): Promise<Buffer | null> {
    const info =
      typeof this.storage.getObjectInfo === 'function'
        ? await this.storage.getObjectInfo(storagePath).catch(() => null)
        : null;
    if (
      typeof info?.size === 'number' &&
      info.size > POSTER_FALLBACK_MAX_BYTES
    ) {
      source.downloadSkipped = `too-large-for-download-fallback (${Math.round(info.size / (1024 * 1024))} MB)`;
      return null;
    }
    return this.storage.download(storagePath).catch(() => null);
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
    // The download is BOUNDED (`sourceFor`): above POSTER_FALLBACK_MAX_BYTES
    // it resolves null and says why, and a NULL poster is a supported state.
    const bytes = await source.download();
    if (!bytes || bytes.length === 0) {
      return {
        ok: false,
        reason: `url:${viaUrl.reason}; ${source.downloadSkipped ?? 'download-miss'}`,
      };
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
      return {
        ok: false,
        reason: `url:${viaUrl.reason}; ${source.downloadSkipped ?? 'download-miss'}`,
      };
    }
    const viaBytes = await probeVideoFromBuffer(bytes, source.ext);
    if (viaBytes.ok) return viaBytes;
    return {
      ok: false,
      reason: `url:${viaUrl.reason}; bytes:${viaBytes.reason}`,
    };
  }
}

/**
 * Every column the alert pipeline reads a playlist or a file from — the same
 * lists `GET /screens/:id/emergency-assets` (screens.controller.ts) builds the
 * never-evict cache tier from. `satisfies` keeps every name a real column.
 */
const TENANT_EMERGENCY_PLAYLIST_FIELDS = [
  'emergencyPlaylistId',
  'emergencyPortraitPlaylistId',
  'panicLockdownPlaylistId',
  'panicEvacuatePlaylistId',
  'panicWeatherPlaylistId',
  'panicHoldPlaylistId',
  'panicSecurePlaylistId',
  'panicMedicalPlaylistId',
  'panicLockdownPortraitPlaylistId',
  'panicEvacuatePortraitPlaylistId',
  'panicWeatherPortraitPlaylistId',
  'panicHoldPortraitPlaylistId',
  'panicSecurePortraitPlaylistId',
  'panicMedicalPortraitPlaylistId',
] as const satisfies readonly (keyof Prisma.TenantWhereInput)[];

const SCREEN_EMERGENCY_PLAYLIST_FIELDS = [
  'emergencyLockdownPlaylistId',
  'emergencyEvacuatePlaylistId',
  'emergencyWeatherPlaylistId',
  'emergencyHoldPlaylistId',
  'emergencySecurePlaylistId',
  'emergencyMedicalPlaylistId',
  'emergencyLockdownPortraitPlaylistId',
  'emergencyEvacuatePortraitPlaylistId',
  'emergencyWeatherPortraitPlaylistId',
  'emergencyHoldPortraitPlaylistId',
  'emergencySecurePortraitPlaylistId',
  'emergencyMedicalPortraitPlaylistId',
] as const satisfies readonly (keyof Prisma.ScreenWhereInput)[];

const SCREEN_EMERGENCY_MEDIA_URL_FIELDS = [
  'emergencyLockdownAssetUrl',
  'emergencyEvacuateAssetUrl',
  'emergencyWeatherAssetUrl',
  'emergencyHoldAssetUrl',
  'emergencySecureAssetUrl',
  'emergencyMedicalAssetUrl',
  'emergencyLockdownPortraitAssetUrl',
  'emergencyEvacuatePortraitAssetUrl',
  'emergencyWeatherPortraitAssetUrl',
  'emergencyHoldPortraitAssetUrl',
  'emergencySecurePortraitAssetUrl',
  'emergencyMedicalPortraitAssetUrl',
] as const satisfies readonly (keyof Prisma.ScreenWhereInput)[];

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

/**
 * How `processVideo` treats the fast-start re-mux:
 *   'async' (default) — queue it after the probe + poster and return. The
 *           upload path, the auto-heal cron and "Check this file" use this.
 *   'sync'  — run it before returning (tests, scripts).
 *   'skip'  — no re-mux on this call.
 */
export type RemuxMode = 'sync' | 'async' | 'skip';

export interface VideoJobOptions {
  remux?: RemuxMode;
  /**
   * `false` runs the probe and the fast-start step without cutting a poster —
   * for a pass over a file that already has one (the transcode worker's
   * `remuxKeptOriginal`). Default `true`.
   */
  poster?: boolean;
}

/** The one line the log carries when a re-mux stands aside for the transcode. */
function describeTranscodeDeferral(
  state: 'queued' | 'running' | 'unknown',
): string {
  return state === 'unknown'
    ? 'could not confirm that no signage transcode is queued for it'
    : `a signage transcode is ${state} for it — its output is fast-start, and the worker runs this pass itself if it keeps the original`;
}

/** What the fast-start step did on this call. Anything but 'remuxed' left the row as it was. */
export type RemuxStatus =
  /** Not an MP4 whose index was read to be at the end (or no probe facts). */
  | 'not-needed'
  /** It is, but a guard said no — the `[remux]` log line says which. */
  | 'skipped'
  /** 'async': queued behind this replica's single re-mux slot. */
  | 'scheduled'
  /** The row now points at the fast-start copy. */
  | 'remuxed'
  /** Tried and failed; the asset is exactly as it was. */
  | 'failed';

export interface VideoJobResult {
  /** Dimensions/duration were written to `processingMeta`. */
  probed: boolean;
  /** Public URL of the stored poster, or null. */
  posterUrl: string | null;
  /** The fast-start re-mux — see `RemuxStatus`. */
  remux: RemuxStatus;
}

/** What the probe half produced: whether it was saved, and the facts it read (null on failure). */
interface ProbeStep {
  persisted: boolean;
  outcome: ProbeSuccess | null;
}

/** The resolved input for one job — see `sourceFor`. */
export interface VideoSource {
  readonly buffer: Buffer | null;
  readonly ext: string | null;
  /** Object URL built from SUPABASE_URL + storage path; null without a path. */
  readonly url: string | null;
  readonly trustedPrefix: string;
  /** Memoised full download of the object; null without a path, on failure, or when over the bound. */
  download(): Promise<Buffer | null>;
  /** Set when `download()` was skipped for size, so both ladders can say why instead of `download-miss`. */
  downloadSkipped: string | null;
}
