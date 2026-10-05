/**
 * upload-content-verdict.ts — IS THIS FILE WHAT ITS NAME SAYS, AND CAN A SCREEN
 * PLAY IT? (2026-10-05, the media beta test: docs/research/2026-10-04-media-matrix/
 * limits-findings.md PART A, img-findings.md ANSWER 1.)
 *
 * The Media Library decided a file's type from its NAME — the extension, or the
 * type the browser derived from it — and never looked at the bytes. A 53-byte
 * text file named .mp4, an executable and a ZIP named .mp4, HTML named .jpg, MP4
 * bytes named .png, an MP4 cut off at 10/50/90 %: all were stored in the public
 * bucket and shown "Ready". On a screen a broken video freezes the rotation, a
 * broken picture sits black for its whole slot, and one non-picture in a playlist
 * refused the whole publish on every 1080p screen.
 *
 * Owner's rule: "support as many files as possible but they must work 100% of the
 * time" — a file plays, or it is refused clearly at upload.
 *
 * ── THE TWO-SIDED RULE (why this file is pure functions) ────────────────────
 *   • REFUSE only on a DEFINITE content verdict: the tool ran on the bytes and
 *     said "this is not X", or "the data ends early".
 *   • When the check itself could not run — storage unreachable, ffprobe
 *     missing, a time-out, a dropped read, an answer that is ambiguous — ACCEPT
 *     exactly as before and log a warning. A storage blip must never refuse a
 *     good file.
 *
 * The second rule is measured, not assumed (2026-10-05): a GOOD video read through
 * a connection that drops mid-body makes ffmpeg's demuxer print `Packet corrupt`,
 * `Invalid NAL unit size` and `partial file` — the very lines a truncated upload
 * prints — next to the http layer's `Stream ends prematurely at X, should be Y`.
 * So a read-failure marker VETOES every refusal (`READ_FAILURE`).
 *
 * No I/O, no Nest. `UploadContentCheckService` runs the tools and gathers the
 * evidence; `decideUploadContent` is the one decision.
 */
import { buildScreenStamp, type ScreenStampJson } from '@cms/api-types';
import {
  parseProbe,
  screenCompatibilityIssues,
  type ScreenCompatibilityIssue,
} from '../storage/video-transcode/transcode-profile';

/** What a file is checked as, from its (declared, then stored) MIME type. */
export type UploadContentKind = 'image' | 'video' | 'audio' | 'pdf';

export function uploadContentKind(
  mimeType: string | null | undefined,
): UploadContentKind | null {
  const m = (mimeType || '').split(';')[0].trim().toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  if (m === 'application/pdf') return 'pdf';
  return null;
}

/** Why a file is refused. Each maps to one operator-facing message (UPLOAD_REFUSALS). */
export type BadReason =
  /** Zero bytes. */
  | 'empty'
  /** The bytes are no picture a screen can draw (text, HTML, a video, a damaged file…). */
  | 'not-image'
  /** An Apple HEIC photo under a picture's name: neither the server nor a screen decodes HEVC. */
  | 'heic'
  /** Not a media container at all, or one with nothing to show. */
  | 'not-video'
  /** The container promises more than the data holds: the end does not decode (truncated). */
  | 'ends-early'
  /** Sound but no picture — an audio-only file under a video's name. */
  | 'no-picture'
  /** A picture (JPEG, PNG, GIF…) under a video's name. */
  | 'still-image'
  | 'not-audio'
  /** No `%PDF-` header: some other file under a .pdf name. */
  | 'not-pdf'
  /** A PDF header but no `%%EOF` at the end: cut short. */
  | 'pdf-incomplete';

/** What one look at the file concluded. */
export type Finding =
  | { status: 'ok'; detail: string }
  | { status: 'bad'; reason: BadReason; detail: string }
  /** The check could not run, or its answer was ambiguous — never a reason to refuse. */
  | { status: 'unknown'; why: string };

const ok = (detail: string): Finding => ({ status: 'ok', detail });
const bad = (reason: BadReason, detail: string): Finding => ({
  status: 'bad',
  reason,
  detail,
});
const unknown = (why: string): Finding => ({ status: 'unknown', why });

/** One run of ffprobe or ffmpeg as the runner saw it. */
export interface ToolRun {
  /** Exit code; null when the process was killed or never started. */
  exitCode: number | null;
  stdout: string;
  stderr: string;
  /** The binary could not be started (missing, not executable). */
  spawnError: string | null;
  /** Killed at its time budget. */
  timedOut: boolean;
}

export interface ImageEvidence {
  /** The stored bytes; null when they could not be read back from storage. */
  bytes: Buffer | null;
  /** The format sharp recognised: 'jpeg' | 'png' | 'webp' | 'gif' | 'heif' | 'svg' | 'tiff' | …; null = none. */
  sharpFormat: string | null;
  /** sharp's `compression` for a HEIF container: 'hevc' (Apple HEIC) or 'av1' (AVIF). */
  sharpCompression: string | null;
  /** What sharp threw while reading or decoding the bytes; null when it did not throw. */
  sharpError: string | null;
  /** The optimizer stores its OWN re-encode (a JPEG / PNG / WebP sharp wrote) in place of these bytes. */
  replacedByReencode: boolean;
}

export interface VideoEvidence {
  probe: ToolRun | null;
  /** The bounded decode of the last seconds; null when it was not run. */
  tail: ToolRun | null;
}

export interface PdfEvidence {
  /** The first bytes of the object; null = they could not be read. */
  head: Buffer | null;
  /** The last bytes of the object; null = they could not be read (or the size is unknown). */
  tail: Buffer | null;
}

export interface ContentEvidence {
  kind: UploadContentKind;
  /** The size storage recorded for the object; null when unknown. */
  storedBytes: number | null;
  image?: ImageEvidence;
  video?: VideoEvidence;
  audio?: { probe: ToolRun | null };
  pdf?: PdfEvidence;
  /** Set when the check could not run at all (no free slot, an untrusted URL, …). */
  skipped?: string;
}

// ── markers in ffprobe / ffmpeg output ──────────────────────────────────────

/**
 * The READ failed — network, storage, TLS. Never evidence about the file, and it
 * vetoes every refusal: a dropped read makes a good file look exactly like a
 * truncated one (see the header).
 */
export const READ_FAILURE =
  /stream ends prematurely|error reading http response|connection (?:refused|reset|timed out)|operation timed out|timed out|server returned|http error|failed to resolve|name or service not known|nodename nor servname|network is unreachable|no route to host|input\/output error|i\/o error|broken pipe|\btls\b|\bssl\b|certificate|protocol not found|will reconnect/i;

/** The bytes are not a media container ffmpeg can open, or hold nothing it can decode. */
export const NOT_MEDIA =
  /invalid data found when processing input|moov atom not found|ebml header parsing failed|could not find codec parameters|cannot determine format of input|does not contain any stream|unknown format|detected only with low score/i;

/** The data stops before the container's index says it does (a cut-off upload). */
export const ENDS_EARLY =
  /packet corrupt|corrupt input packet|partial file|file ended prematurely|invalid nal unit size|truncat|premature end|missing picture in access unit|error splitting the input into nal units/i;

/**
 * The DEMUXER found less data than the index promised — said while reading
 * packets, not while decoding them. In an indexed container (below) on a read
 * that did not fail, this is the cut itself: an MP4 cut at 90 / 97 / 99 % decodes
 * its frame 1.5 s before the end perfectly and then prints `Packet corrupt` /
 * `partial file` (a WebM: `File ended prematurely`) when the copy reaches the
 * missing tail. Measured 2026-10-05; good files print none of it.
 */
export const DATA_MISSING =
  /packet corrupt|corrupt input packet|partial file|file ended prematurely|truncat|premature end/i;

/**
 * Containers whose index (MP4's `moov`, Matroska / WebM's element sizes) says
 * where the data ends — so "the data stops early" is a fact there, not a guess.
 * MPEG-TS and friends carry no such promise (their length is estimated), and
 * their packets can legitimately carry continuity errors.
 */
export function hasIndexedLayout(
  formatName: string | null | undefined,
): boolean {
  return (formatName || '')
    .toLowerCase()
    .split(',')
    .some((t) =>
      ['mov', 'mp4', 'm4a', '3gp', '3g2', 'mj2', 'matroska', 'webm'].includes(
        t.trim(),
      ),
    );
}

/**
 * Containers that hold PICTURES, not video: ffmpeg's image demuxers
 * (`image2`, every `*_pipe` — jpeg_pipe, png_pipe, webp_pipe, bmp_pipe …), GIF
 * and APNG. A JPEG named .mp4 probes as `jpeg_pipe` with an "mjpeg video" stream.
 */
export function isPictureContainer(
  formatName: string | null | undefined,
): boolean {
  return (formatName || '')
    .toLowerCase()
    .split(',')
    .some((t) => {
      const f = t.trim();
      return (
        f === 'image2' || f === 'gif' || f === 'apng' || f.endsWith('_pipe')
      );
    });
}

/** Seconds before the end the tail decode starts at — the last GOP or two, never the whole file. */
export const TAIL_MARGIN_S = 1.5;

/**
 * Where the end-of-file decode seeks to: `duration − 1.5 s`, or 0 for a clip too
 * short (or of unknown length) — then it simply proves the FIRST frame decodes.
 */
export function tailSeekSeconds(durationS: number | null | undefined): number {
  return typeof durationS === 'number' &&
    Number.isFinite(durationS) &&
    durationS > TAIL_MARGIN_S + 0.25
    ? Math.round((durationS - TAIL_MARGIN_S) * 1000) / 1000
    : 0;
}

/**
 * The argv for the end-of-file check — ONE read of the last seconds, TWO outputs:
 *   1. ONE decoded frame at the seek point, written as `framecrc` on stdout (a
 *      line per decoded frame) — proof the picture decodes;
 *   2. a stream COPY of the rest of the video into the null muxer — no decoding,
 *      just every remaining packet read — proof the data runs to the end the
 *      index promises (a cut inside the last 1.5 s is invisible to output 1).
 * An INPUT seek (`-ss` before `-i`): over http ffmpeg range-reads from the
 * keyframe before the seek point, never the whole file. Capital V skips cover
 * art. Two decoder threads: the API also delivers lockdown alerts.
 *
 * `readToEnd: false` (a container with no index — `hasIndexedLayout`) drops
 * output 2: "the data ends early" is no verdict there, so reading to the end
 * would only cost egress.
 */
export function buildTailDecodeArgs(
  input: string,
  seekS: number,
  readToEnd = true,
): string[] {
  const video = ['-map', '0:V:0', '-an', '-sn', '-dn'];
  return [
    '-hide_banner',
    '-nostdin',
    '-v',
    'warning',
    '-threads',
    '2',
    ...(seekS > 0 ? ['-ss', seekS.toFixed(3)] : []),
    '-i',
    input,
    ...video,
    '-frames:v',
    '1',
    '-f',
    'framecrc',
    'pipe:1',
    ...(readToEnd ? [...video, '-c', 'copy', '-f', 'null', '-'] : []),
  ];
}

/** Decoded frames in `-f framecrc` output: every line that is not a `#` header. */
export function countDecodedFrames(stdout: string): number {
  return stdout.split('\n').filter((l) => l.trim() !== '' && !l.startsWith('#'))
    .length;
}

// ── video ───────────────────────────────────────────────────────────────────

export type ProbeStep =
  | { done: Finding; seekS?: undefined; formatName?: undefined }
  /** ffprobe found a real video stream: check the end of the file from `seekS`. */
  | { done?: undefined; seekS: number; formatName: string | null };

/**
 * What ffprobe's answer means for a file uploaded AS A VIDEO, and whether the end
 * still needs decoding. A video stream with a picture container (a JPEG named
 * .mp4) is a picture; no video stream at all is sound-only or nothing; an index
 * that ffprobe could read says nothing about whether the data behind it is all
 * there — that is the tail decode's job (a truncated MP4 with its index first
 * probes as a healthy 4-second clip).
 */
export function videoProbeStep(run: ToolRun): ProbeStep {
  if (run.spawnError)
    return { done: unknown(`ffprobe could not start (${run.spawnError})`) };
  if (run.timedOut) return { done: unknown('ffprobe ran out of time') };
  const readFailed = READ_FAILURE.test(run.stderr);
  const doc = parseJson(run.stdout);
  if (run.exitCode !== 0 || !doc) {
    if (!readFailed && NOT_MEDIA.test(run.stderr))
      return { done: bad('not-video', toolLines(run.stderr)) };
    return {
      done: unknown(
        `ffprobe exited ${run.exitCode}: ${toolLines(run.stderr) || 'no message'}`,
      ),
    };
  }
  const probe = parseProbe(doc);
  if (probe.hasVideo) {
    if (isPictureContainer(probe.formatName)) {
      return readFailed
        ? { done: unknown('the read failed while ffprobe looked at the file') }
        : { done: bad('still-image', `container ${probe.formatName}`) };
    }
    // A container with no index (MPEG-TS, AVI, FLV, WMV, MPEG-PS … under a
    // video name) cannot be seeked reliably — measured 2026-10-05: an MPEG-TS
    // whose timestamps start at 1.47 s decodes NOTHING after `-ss 1.5`, and
    // gives no reason. "Ends early" is no verdict there anyway, so decode its
    // FIRST frame instead: proof it is a video that decodes (it is converted
    // to MP4 later).
    return {
      seekS: hasIndexedLayout(probe.formatName)
        ? tailSeekSeconds(videoStreamDurationS(doc) ?? probe.durationS)
        : 0,
      formatName: probe.formatName,
    };
  }
  if (readFailed)
    return { done: unknown('the read failed before a video stream was seen') };
  return {
    done: bad(
      probe.hasAudio ? 'no-picture' : 'not-video',
      `streams: ${describeStreams(doc)}`,
    ),
  };
}

/**
 * The end-of-file check (`buildTailDecodeArgs`). A read that failed decides
 * nothing. In an indexed container, the demuxer saying data is missing IS the
 * verdict, whether or not the frame at the seek point decoded. Otherwise one
 * decoded frame is proof; no frame plus a reason is a verdict; no frame and no
 * reason (a clip whose last frame sits before the seek point) is not.
 */
export function classifyTailDecode(
  run: ToolRun,
  seekS: number,
  formatName: string | null = null,
): Finding {
  if (run.spawnError)
    return unknown(`ffmpeg could not start (${run.spawnError})`);
  if (run.timedOut)
    return unknown('ffmpeg ran out of time reading the end of the file');
  if (READ_FAILURE.test(run.stderr))
    return unknown('the read failed while reading the end of the file');
  const indexed = hasIndexedLayout(formatName);
  const frames = countDecodedFrames(run.stdout);
  if (indexed && DATA_MISSING.test(run.stderr)) {
    return bad('ends-early', `from ${seekS} s: ${toolLines(run.stderr)}`);
  }
  if (frames >= 1)
    return ok(
      indexed
        ? `a frame decodes at ${seekS} s and the data runs to the end`
        : `its first frame decodes (${formatName ?? 'no index'})`,
    );
  if (NOT_MEDIA.test(run.stderr) || (indexed && ENDS_EARLY.test(run.stderr))) {
    return bad(
      seekS > 0 && indexed ? 'ends-early' : 'not-video',
      `no frame at ${seekS} s: ${toolLines(run.stderr)}`,
    );
  }
  return unknown(
    `no frame at ${seekS} s and no reason given (exit ${run.exitCode})`,
  );
}

export function classifyVideo(e: VideoEvidence): Finding {
  if (!e.probe) return unknown('ffprobe did not run');
  const step = videoProbeStep(e.probe);
  if (step.done) return step.done;
  if (!e.tail) return unknown('the end of the file was not checked in time');
  return classifyTailDecode(e.tail, step.seekS, step.formatName);
}

// ── audio ───────────────────────────────────────────────────────────────────

export function classifyAudioProbe(run: ToolRun): Finding {
  if (run.spawnError)
    return unknown(`ffprobe could not start (${run.spawnError})`);
  if (run.timedOut) return unknown('ffprobe ran out of time');
  const readFailed = READ_FAILURE.test(run.stderr);
  const doc = parseJson(run.stdout);
  if (run.exitCode !== 0 || !doc) {
    if (!readFailed && NOT_MEDIA.test(run.stderr))
      return bad('not-audio', toolLines(run.stderr));
    return unknown(
      `ffprobe exited ${run.exitCode}: ${toolLines(run.stderr) || 'no message'}`,
    );
  }
  if (parseProbe(doc).hasAudio) return ok('an audio stream');
  if (readFailed)
    return unknown('the read failed before an audio stream was seen');
  return bad('not-audio', `streams: ${describeStreams(doc)}`);
}

// ── images ──────────────────────────────────────────────────────────────────

/** Formats every screen draws from an `<img>` whatever the file is called (browsers sniff the bytes). */
export const SCREEN_IMAGE_FORMATS: ReadonlySet<string> = new Set([
  'jpeg',
  'png',
  'webp',
  'gif',
]);

/**
 * BMP and ICO by their signatures. sharp cannot read either (its prebuilt libvips
 * has no loader for them — measured: every BMP and ICO in the beta-test corpus
 * throws "unsupported image format"), yet browsers draw both. So sharp's answer
 * is never a verdict on them.
 */
export function sniffBmpOrIco(buf: Buffer): 'bmp' | 'ico' | null {
  if (buf.length >= 26 && buf[0] === 0x42 && buf[1] === 0x4d) {
    // "BM" + the DIB header size every BMP variant writes at offset 14.
    if ([12, 16, 40, 52, 56, 64, 108, 124].includes(buf.readUInt32LE(14)))
      return 'bmp';
  }
  if (
    buf.length >= 22 &&
    buf[0] === 0 &&
    buf[1] === 0 &&
    (buf[2] === 1 || buf[2] === 2) &&
    buf[3] === 0
  ) {
    // ICONDIR (reserved 0, type 1 = icon / 2 = cursor, count) + its directory entries.
    const count = buf.readUInt16LE(4);
    if (count >= 1 && buf.length >= 6 + 16 * count) return 'ico';
  }
  return null;
}

const SHARP_UNSUPPORTED = /unsupported image format/i;
/** sharp gave up for a reason that is about the SERVER's limits, not the file. */
const SHARP_RESOURCE_LIMIT =
  /pixel limit|out of memory|memory allocation|cannot allocate|enomem/i;
/** sharp recognised the format and failed decoding it: the data is broken (or HEVC, which it cannot decode). */
const SHARP_DECODE_FAILURE =
  /heif|bad seek|vipsjpeg|jpegload|pngload|vipspng|libspng|webpload|gifload|tiffload|svgload|corrupt|premature|invalid|read error|load error|not a known|bad (?:huffman|marker)|decod/i;

const isHeic = (e: ImageEvidence) =>
  e.sharpFormat === 'heif' && e.sharpCompression !== 'av1';

export function classifyImage(e: ImageEvidence): Finding {
  if (!e.bytes) return unknown('the file could not be read back from storage');
  if (e.bytes.length === 0) return bad('empty', '0 bytes');
  // What is stored is then sharp's own JPEG / PNG / WebP — always drawable.
  if (e.replacedByReencode)
    return ok("stored as the optimizer's own re-encode");
  const signature = sniffBmpOrIco(e.bytes);
  if (e.sharpError) {
    if (SHARP_UNSUPPORTED.test(e.sharpError)) {
      return signature
        ? ok(`a ${signature} file`)
        : bad('not-image', `sharp: ${oneLine(e.sharpError)}`);
    }
    if (SHARP_RESOURCE_LIMIT.test(e.sharpError))
      return unknown(`sharp: ${oneLine(e.sharpError)}`);
    if (isHeic(e)) return bad('heic', `sharp: ${oneLine(e.sharpError)}`);
    if (SHARP_DECODE_FAILURE.test(e.sharpError))
      return bad('not-image', `sharp: ${oneLine(e.sharpError)}`);
    return unknown(`sharp: ${oneLine(e.sharpError)}`);
  }
  if (signature) return ok(`a ${signature} file`);
  if (e.sharpFormat && SCREEN_IMAGE_FORMATS.has(e.sharpFormat))
    return ok(`a ${e.sharpFormat} file`);
  if (isHeic(e)) return bad('heic', 'a HEIC (HEVC) photo');
  // sharp read it, and it is a format no screen draws (svg, tiff, avif, jp2 …).
  if (e.sharpFormat)
    return bad(
      'not-image',
      `a ${e.sharpFormat} file, which screens cannot draw`,
    );
  return unknown('sharp named no format');
}

// ── PDF ─────────────────────────────────────────────────────────────────────

/** `%PDF-` must sit in the first KB (the PDF spec's own tolerance for leading junk). */
export const PDF_HEAD_BYTES = 1024;
/**
 * `%%EOF` must sit in the last bytes. The spec asks for the last 1 KB; 4 KB is
 * lenient about trailing junk and still catches a cut-off file, whose tail is
 * missing outright. (A file cut just after an EARLIER `%%EOF` is a complete older
 * revision, which a viewer opens anyway.)
 */
export const PDF_TAIL_BYTES = 4096;

export function classifyPdf(e: PdfEvidence): Finding {
  if (!e.head) return unknown('the start of the file could not be read');
  if (e.head.length === 0) return bad('empty', '0 bytes');
  if (e.head.subarray(0, PDF_HEAD_BYTES).indexOf('%PDF-', 0, 'latin1') < 0) {
    return bad(
      'not-pdf',
      `starts ${JSON.stringify(e.head.subarray(0, 12).toString('latin1'))}`,
    );
  }
  if (!e.tail) return unknown('the end of the file could not be read');
  if (e.tail.lastIndexOf('%%EOF', undefined, 'latin1') < 0)
    return bad('pdf-incomplete', `no %%EOF in the last ${e.tail.length} bytes`);
  return ok('a %PDF- header and a %%EOF end marker');
}

// ── the decision ────────────────────────────────────────────────────────────

export interface UploadRefusal {
  /** Stable machine code — the web translates by it. */
  code: string;
  reason: BadReason;
  /** Plain words for a non-technical operator, saying what to do. */
  message: string;
}

const VIDEO_UNPLAYABLE =
  "This isn't a playable video — the file may be damaged or incomplete. Export it again and upload the new copy.";

/** Every refusal, its code and its words. The web carries the same words in en / es / zh (`directUpload.*`). */
export const UPLOAD_REFUSALS: Readonly<
  Record<BadReason, { code: string; message: string }>
> = {
  empty: {
    code: 'ASSET_FILE_EMPTY',
    message:
      'This file is empty (0 bytes). Export it again and upload the new copy.',
  },
  'not-image': {
    code: 'ASSET_IMAGE_UNREADABLE',
    message:
      "This isn't a picture screens can show — the file may be damaged, or it may be another kind of file saved with a picture's name. Export it again as JPG or PNG and upload the new copy.",
  },
  heic: {
    code: 'ASSET_IMAGE_HEIC',
    message:
      "This photo is in Apple's HEIC format (saved with a different name), and screens can't show HEIC. Export it as JPG and upload the new copy.",
  },
  'not-video': { code: 'ASSET_VIDEO_UNPLAYABLE', message: VIDEO_UNPLAYABLE },
  'ends-early': { code: 'ASSET_VIDEO_UNPLAYABLE', message: VIDEO_UNPLAYABLE },
  'no-picture': {
    code: 'ASSET_VIDEO_NO_PICTURE',
    message:
      'This file has sound but no picture, so a screen would show nothing. Export it again as a video and upload the new copy.',
  },
  'still-image': {
    code: 'ASSET_VIDEO_IS_PICTURE',
    message:
      'This is a picture saved with a video name. Upload it under its real picture name (for example .jpg or .png).',
  },
  'not-audio': {
    code: 'ASSET_AUDIO_UNPLAYABLE',
    message:
      "This isn't a playable audio file — the file may be damaged or incomplete. Export it again and upload the new copy.",
  },
  'not-pdf': {
    code: 'ASSET_PDF_NOT_PDF',
    message:
      "This isn't a PDF — it may be another kind of file saved with a .pdf name. Save or export it as a PDF again and upload the new copy.",
  },
  'pdf-incomplete': {
    code: 'ASSET_PDF_INCOMPLETE',
    message:
      'This PDF is incomplete — the file may be damaged or cut short. Save or export it again and upload the new copy.',
  },
};

export function refusalFor(reason: BadReason): UploadRefusal {
  return { reason, ...UPLOAD_REFUSALS[reason] };
}

export type UploadVerdict =
  /** `unchecked` says why nothing was proved (logged at warn); null = the file checked out. */
  | { accept: true; unchecked: string | null; finding: Finding }
  | { accept: false; refusal: UploadRefusal; finding: Finding };

/** What the evidence says about the file, before it becomes accept / refuse. */
export function findingFor(e: ContentEvidence): Finding {
  if (e.storedBytes === 0) return bad('empty', 'storage recorded 0 bytes');
  if (e.skipped) return unknown(e.skipped);
  switch (e.kind) {
    case 'image':
      return e.image
        ? classifyImage(e.image)
        : unknown('the picture was not checked');
    case 'video':
      return e.video
        ? classifyVideo(e.video)
        : unknown('the video was not checked');
    case 'audio':
      return e.audio?.probe
        ? classifyAudioProbe(e.audio.probe)
        : unknown('the audio was not checked');
    case 'pdf':
      return e.pdf ? classifyPdf(e.pdf) : unknown('the PDF was not checked');
    default:
      return unknown('not a kind of file that is checked');
  }
}

/**
 * THE decision. Refuse on a definite verdict only; everything the check could not
 * establish is accepted exactly as before, with the reason attached for the log.
 */
export function decideUploadContent(e: ContentEvidence): UploadVerdict {
  const finding = findingFor(e);
  if (finding.status === 'bad')
    return { accept: false, refusal: refusalFor(finding.reason), finding };
  return {
    accept: true,
    unchecked: finding.status === 'unknown' ? finding.why : null,
    finding,
  };
}

// ── can every screen play it AS UPLOADED? (2026-10-05, the screen-ready gate) ──

/** What the upload's own ffprobe says about screen compatibility. */
export interface UploadScreenVerdict {
  /** No compatibility issue: every player decodes the file as uploaded. */
  ready: boolean;
  /** `screenCompatibilityIssues` of the probe — empty when ready. */
  issues: ScreenCompatibilityIssue[];
}

/**
 * The screen-compatibility verdict for a VIDEO, from the ffprobe document the
 * content check already fetched — no second probe. It is the transcode's own
 * rule (`screenCompatibilityIssues`) on the same `parseProbe` of the same
 * `buildProbeArgs` output the transcode pipeline reads from its local copy, so
 * the upload and the conversion can never disagree about a file.
 *
 * NULL — no verdict, never an invented one — unless the probe ran CLEANLY: it
 * started, finished in time, exited 0, printed a JSON document, read without a
 * network failure (a read that broke mid-way can leave out a stream), and found
 * a real video stream with dimensions in a container that is not a picture
 * format. Whether the END of the file decodes is the integrity check's business
 * (`classifyTailDecode`), not this one's: a format verdict needs headers only.
 */
export function uploadScreenVerdict(e: ContentEvidence): UploadScreenVerdict | null {
  if (e.kind !== 'video' || e.skipped || e.storedBytes === 0) return null;
  const run = e.video?.probe;
  if (!run || run.spawnError || run.timedOut || run.exitCode !== 0) return null;
  if (READ_FAILURE.test(run.stderr)) return null;
  const doc = parseJson(run.stdout);
  if (!doc) return null;
  const probe = parseProbe(doc);
  if (!probe.hasVideo || !probe.width || !probe.height) return null;
  if (isPictureContainer(probe.formatName)) return null;
  const issues = screenCompatibilityIssues(probe);
  return { ready: issues.length === 0, issues };
}

/**
 * The `processingMeta.screen` stamp the new Asset row is CREATED with
 * (`POST /assets/complete-upload`), or null for none:
 *
 *   • screen-safe as uploaded            → `{ ready: true }`;
 *   • must be converted, and a conversion is being queued
 *                                         → `{ ready: false, pending: true, issues }`
 *     — the manifest leaves it out until the transcode stamps the converted copy;
 *   • must be converted but NO conversion will run (`VIDEO_TRANSCODE_DISABLED=1`,
 *     a build without the transcode) → null. Nothing would ever settle a
 *     `pending` there, and the kill switch stays subtractive: with it on, a video
 *     is delivered exactly as before this verdict existed;
 *   • no verdict (the probe did not run cleanly) → null: unknown stays unknown.
 */
export function uploadScreenStamp(
  verdict: UploadScreenVerdict | null,
  conversionQueued: boolean,
  nowMs: number,
): ScreenStampJson | null {
  if (!verdict) return null;
  if (verdict.ready) return buildScreenStamp({ ready: true }, nowMs);
  if (!conversionQueued) return null;
  return buildScreenStamp(
    { ready: false, pending: true, issues: verdict.issues },
    nowMs,
  );
}

// ── helpers ─────────────────────────────────────────────────────────────────

function parseJson(s: string): unknown {
  try {
    const v: unknown = JSON.parse(s);
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

/**
 * The video stream's OWN duration — not the container's, which is the longest
 * stream (audio that outlasts the picture would put the tail seek past the last
 * frame). Matroska keeps it in a `DURATION` tag ("00:00:03.016000000").
 */
export function videoStreamDurationS(doc: unknown): number | null {
  const v = streamsOf(doc).find(
    (s) =>
      s.codec_type === 'video' && recordOf(s.disposition).attached_pic !== 1,
  );
  if (!v) return null;
  const d = Number(v.duration);
  if (Number.isFinite(d) && d > 0) return d;
  const tag = recordOf(v.tags).DURATION;
  const m =
    typeof tag === 'string'
      ? /^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(tag.trim())
      : null;
  if (m) {
    const s = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    return s > 0 ? s : null;
  }
  return null;
}

function describeStreams(doc: unknown): string {
  const streams = streamsOf(doc);
  return streams.length
    ? streams
        .map(
          (s) =>
            `${typeof s.codec_type === 'string' ? s.codec_type : '?'}:${typeof s.codec_name === 'string' ? s.codec_name : '?'}`,
        )
        .join(' ')
    : 'none';
}

function recordOf(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function streamsOf(doc: unknown): Array<Record<string, unknown>> {
  const streams = recordOf(doc).streams;
  return Array.isArray(streams) ? streams.map(recordOf) : [];
}

function oneLine(s: string): string {
  return String(s).replace(/\s+/g, ' ').trim().slice(0, 240);
}

/** ffmpeg's lines for a log: no object addresses, no input URL, one line, capped. */
export function toolLines(stderr: string): string {
  return oneLine(
    String(stderr)
      .replace(/ @ 0x[0-9a-f]+/gi, '')
      .replace(/https?:\/\/\S+/g, '<input>'),
  );
}
