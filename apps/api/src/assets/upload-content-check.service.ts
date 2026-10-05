import { Injectable } from '@nestjs/common';
import { spawn as nodeSpawn } from 'child_process';
import { extname } from 'path';
import sharp from 'sharp';
import { SupabaseStorageService } from '../storage/supabase-storage.service';
import {
  adoptsReencode,
  type OptimizedMedia,
} from '../storage/media-optimization.service';
import { buildProbeArgs } from '../storage/video-transcode/transcode-profile';
import {
  buildTailDecodeArgs,
  decideUploadContent,
  hasIndexedLayout,
  PDF_HEAD_BYTES,
  PDF_TAIL_BYTES,
  uploadContentKind,
  uploadScreenVerdict,
  videoProbeStep,
  type ContentEvidence,
  type ImageEvidence,
  type PdfEvidence,
  type ToolRun,
  type UploadContentKind,
  type UploadScreenVerdict,
  type UploadVerdict,
} from './upload-content-verdict';
import { CheckSlots, errorText, intEnv, runTool } from './tool-runner';
import { HeifConverter, type HeifConversion } from './heif-convert';

/**
 * What `check` answers: the accept / refuse decision, plus — for a VIDEO
 * whose probe ran cleanly — whether every screen can play it as uploaded
 * (`screen`, null otherwise; see `uploadScreenVerdict`).
 */
export type UploadCheckResult = UploadVerdict & {
  ms: number;
  screen: UploadScreenVerdict | null;
};

/**
 * The content check `POST /assets/complete-upload` runs on the bytes that just
 * landed in storage, before an Asset row exists (2026-10-05). The POLICY — what
 * counts as a definite verdict, what is merely "could not check" — is
 * upload-content-verdict.ts; this service only gathers the evidence, cheaply and
 * on a hard budget:
 *
 *   • picture — the controller already reads the bytes back and runs the upload
 *     optimizer on them (it always did); its sharp result IS the evidence. GIF /
 *     BMP / ICO are never re-encoded, so sharp reads their header here, and a
 *     byte signature covers the two formats sharp cannot read at all.
 *   • video — ONE ffprobe of the stored object over its URL (headers only), then
 *     ONE ffmpeg decode of a single frame ~1.5 s before the end (an input seek, so
 *     ffmpeg range-reads the last GOP, never the file). A truncated MP4 whose index
 *     sits in front probes as a healthy clip; only its end gives it away.
 *   • audio — the same ffprobe; it must find an audio stream.
 *   • PDF — two range reads of a few KB: `%PDF-` at the start, `%%EOF` at the end.
 *
 * BOUNDED, because the process that runs this also delivers lockdown alerts:
 *   • one budget per file (`UPLOAD_CHECK_BUDGET_MS`, default 12 s) covering the
 *     wait for a slot, the probe and the decode; every child is SIGKILLed at it;
 *   • ONE ffprobe/ffmpeg child from this service at a time, process-wide
 *     (`CheckSlots`, `UPLOAD_CHECK_MAX_PARALLEL`, default 1): a video's probe and
 *     its end-of-file read run one after the other inside the same slot. The page
 *     runs three uploads at once per operator; a busy box makes the next file wait
 *     (inside its budget), never fork another child.
 *
 * NEVER THROWS, and anything that is not a definite verdict — no slot in time,
 * a tool missing, a time-out, a storage read that failed — comes back ACCEPTED
 * with the reason, which the caller logs. `UPLOAD_CONTENT_CHECK_DISABLED=1` turns
 * the whole check off (every upload is accepted exactly as before it existed).
 *
 * HEIC (2026-10-05): `convertHeif` turns an iPhone photo into a JPEG before the
 * asset exists (heif-convert.ts), through the SAME limiter — one child at a time,
 * ffprobe, ffmpeg or heif-dec. It is not part of the check and the switch above
 * does not turn it off: a HEIC is converted or refused, never stored as HEIC.
 */
@Injectable()
export class UploadContentCheckService {
  /** Test seams — production uses the real spawn and the env budgets. */
  spawnFn: typeof nodeSpawn = nodeSpawn;
  budgetMs = intEnv('UPLOAD_CHECK_BUDGET_MS', 12_000);
  probeTimeoutMs = intEnv('UPLOAD_CHECK_PROBE_MS', 6_000);
  readonly slots = new CheckSlots(intEnv('UPLOAD_CHECK_MAX_PARALLEL', 1));
  /** The HEIC converter, on this service's limiter and spawn seam. */
  readonly heif = new HeifConverter({
    slots: this.slots,
    spawnFn: () => this.spawnFn,
  });

  constructor(private readonly storage: SupabaseStorageService) {}

  static disabled(): boolean {
    return process.env.UPLOAD_CONTENT_CHECK_DISABLED === '1';
  }

  /** HEIC / HEIF → JPEG (or WebP with transparency). Never throws; see heif-convert.ts. */
  convertHeif(bytes: Buffer | null | undefined): Promise<HeifConversion> {
    return this.heif.convert(bytes);
  }

  async check(input: UploadCheckInput): Promise<UploadCheckResult> {
    const started = Date.now();
    const kind = uploadContentKind(input.mimeType);
    const unchecked = (why: string): UploadCheckResult => ({
      accept: true,
      unchecked: why,
      finding: { status: 'unknown', why },
      screen: null,
      ms: Date.now() - started,
    });
    if (!kind) return unchecked('not a kind of file that is checked');
    if (UploadContentCheckService.disabled())
      return unchecked(
        'the check is switched off (UPLOAD_CONTENT_CHECK_DISABLED=1)',
      );
    let evidence: ContentEvidence;
    try {
      evidence = await this.gather(kind, input, started + this.budgetMs);
    } catch (err) {
      // Nothing above throws by design; if it ever does, that is the check
      // failing — never the file.
      evidence = {
        kind,
        storedBytes: input.storedBytes,
        skipped: `the check threw: ${errorText(err)}`,
      };
    }
    return {
      ...decideUploadContent(evidence),
      // 2026-10-05 — the same ffprobe document, read for the screen-ready
      // verdict too: never a second probe (null when it did not run cleanly).
      // With the stored object's type and extension, as the transcode plans:
      // MP4 bytes saved as `.mov` must be converted here as well as there.
      screen: uploadScreenVerdict(evidence, {
        mimeType: input.mimeType,
        extension: extname(input.storagePath || ''),
      }),
      ms: Date.now() - started,
    };
  }

  private async gather(
    kind: UploadContentKind,
    input: UploadCheckInput,
    deadline: number,
  ): Promise<ContentEvidence> {
    const base = { kind, storedBytes: input.storedBytes };
    // Zero bytes is decided by the size alone.
    if (input.storedBytes === 0) return base;
    if (kind === 'image')
      return { ...base, image: await this.imageEvidence(input) };
    if (kind === 'pdf')
      return { ...base, pdf: await this.pdfEvidence(input, deadline) };

    // Video / audio: the tools read the object over its URL — the URL WE build
    // from SUPABASE_URL + the storage path, under the prefix we built (the same
    // SSRF contract as video-probe.ts / video-poster.ts).
    const url = this.storage.publicUrlForPath(input.storagePath);
    const prefix = this.storage.publicUrlForPath('');
    if (!prefix || !url.startsWith(prefix))
      return {
        ...base,
        skipped: 'the object URL is not under the storage prefix',
      };
    const release = await this.slots.acquire(deadline);
    if (!release)
      return { ...base, skipped: 'no free check slot within the time budget' };
    try {
      const probe = await this.run(
        'ffprobe',
        buildProbeArgs(url),
        Math.min(this.probeTimeoutMs, deadline - Date.now()),
      );
      if (kind === 'audio') return { ...base, audio: { probe } };
      const step = videoProbeStep(probe);
      if (step.done) return { ...base, video: { probe, tail: null } };
      const remaining = deadline - Date.now();
      if (remaining < 500) return { ...base, video: { probe, tail: null } };
      const tail = await this.run(
        'ffmpeg',
        buildTailDecodeArgs(url, step.seekS, hasIndexedLayout(step.formatName)),
        remaining,
      );
      return { ...base, video: { probe, tail } };
    } finally {
      release();
    }
  }

  private async imageEvidence(input: UploadCheckInput): Promise<ImageEvidence> {
    const bytes = input.image?.bytes ?? null;
    const none: ImageEvidence = {
      bytes,
      sharpFormat: null,
      sharpCompression: null,
      sharpError: null,
      replacedByReencode: false,
    };
    if (!bytes) return none;
    const opt = input.image?.optimization ?? null;
    if (opt) {
      // JPEG / PNG / WebP: the upload optimizer already read these bytes — what
      // it recognised, what it threw, and whether its re-encode replaces them.
      return {
        bytes,
        sharpFormat: opt.sourceFormat ?? null,
        sharpCompression: opt.sourceCompression ?? null,
        sharpError: opt.decodeFailure ?? null,
        replacedByReencode: adoptsReencode(opt, bytes.length),
      };
    }
    // GIF / BMP / ICO are stored as uploaded (re-encoding a GIF drops its
    // animation): ask sharp what the bytes are — a header read, no decode.
    try {
      const meta = await sharp(bytes, { failOn: 'none' }).metadata();
      return {
        ...none,
        sharpFormat: meta.format ?? null,
        sharpCompression:
          typeof (meta as { compression?: unknown }).compression === 'string'
            ? ((meta as { compression?: string }).compression as string)
            : null,
      };
    } catch (err) {
      return { ...none, sharpError: errorText(err) };
    }
  }

  private async pdfEvidence(
    input: UploadCheckInput,
    deadline: number,
  ): Promise<PdfEvidence> {
    const timeout = Math.max(500, Math.min(5_000, deadline - Date.now()));
    const size = input.storedBytes;
    const [head, tail] = await Promise.all([
      this.storage.readObjectRange(
        input.storagePath,
        0,
        PDF_HEAD_BYTES - 1,
        timeout,
      ),
      typeof size === 'number' && size > 0
        ? this.storage.readObjectRange(
            input.storagePath,
            Math.max(0, size - PDF_TAIL_BYTES),
            size - 1,
            timeout,
          )
        : Promise.resolve(null),
    ]);
    return { head, tail };
  }

  /** Spawn one tool with a hard kill timer. Never throws; output is capped. */
  private run(
    cmd: 'ffprobe' | 'ffmpeg',
    args: string[],
    timeoutMs: number,
  ): Promise<ToolRun> {
    return runTool(this.spawnFn, cmd, args, timeoutMs);
  }
}

export interface UploadCheckInput {
  /** Bucket-relative path of the object just uploaded. */
  storagePath: string;
  /** The type storage recorded (else the declared one) — what the file is checked as. */
  mimeType: string;
  /** The size storage recorded; null when unknown. */
  storedBytes: number | null;
  /** Pictures: the bytes the controller read back, and what the upload optimizer made of them (null for GIF / BMP / ICO). */
  image?: { bytes: Buffer | null; optimization: OptimizedMedia | null };
}

// The child runner and the limiter live in tool-runner.ts (shared with the HEIC
// converter); re-exported so existing imports keep working.
export { CheckSlots, runTool } from './tool-runner';
