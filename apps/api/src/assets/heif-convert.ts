/**
 * heif-convert.ts — an iPhone photo (HEIC) becomes a JPEG BEFORE the asset
 * exists, so nothing downstream ever sees HEIC (2026-10-05).
 *
 * Every iPhone photo since iOS 11 is HEIC, and the upload used to refuse it
 * ("export as JPG"). Competitors convert on their servers. Three things make a
 * real iPhone HEIC hard, and a converter that gets any of them wrong shows the
 * wrong picture:
 *   1. it is TILED — a grid of 512×512 HEVC tiles (48 of them for 12 MP), not one
 *      image; a decoder that reads the first item shows a 512×512 corner;
 *   2. its rotation is the HEIF `irot` property (plus an EXIF Orientation that a
 *      HEIF reader must IGNORE — honouring both turns a portrait sideways);
 *   3. it is Display P3 (an ICC profile in `colr`): written as sRGB numbers
 *      without converting, every colour comes out washed out.
 *
 * WHY libheif (`heif-dec`, Alpine `libheif-tools`) AND NOT ffmpeg — measured
 * 2026-10-05 on the production base image (node:22-alpine, Alpine 3.24.1, ffmpeg
 * 8.1.2) with HEICs written by Apple's own encoder (macOS `sips`): both stitch the
 * tiles and both apply `irot`, but ffmpeg drops the colour profile — the red
 * patch of a P3 test card came out 233,52,35 untagged (washed out); heif-dec
 * keeps the profile, and after the sRGB transform below the same patch is
 * 254,5,0 (truth 255,0,0). The two decodes agree to 70 dB otherwise. sharp's own
 * prebuilt libvips cannot decode HEVC at all.
 *
 * WHAT IS PRODUCED: the upload optimizer's photo profile — at most 3840 px on the
 * long side, JPEG q85 (mozjpeg), sRGB, no EXIF / GPS / XMP. A photo with real
 * transparency (an iOS cut-out "sticker") keeps it as WebP q85 instead.
 * The colour step is `withIccProfile('srgb')`, never sharp's default: a 10-bit
 * HEIC decodes to a 16-bit PNG, and for 16-bit input sharp's default pipeline
 * leaves the P3 numbers as they are (measured: red 234,51,35 — the washed-out
 * result) while `withIccProfile('srgb')` transforms them (254,0,0).
 *
 * BOUNDED, because the process that runs this also delivers lockdown alerts: one
 * heif-dec child at a time through the upload check's limiter (`CheckSlots`),
 * two decoder threads, a whole-file budget (`UPLOAD_HEIC_BUDGET_MS`, default 30 s)
 * covering the wait for a slot, the decode and the encode; the child is SIGKILLed
 * at it. A 12 MP iPhone photo takes ~0.2 s to decode, a 48 MP one ~3 s (peak
 * 250 MB in the CHILD, not in this process).
 *
 * NEVER STORES HEIC: the caller refuses the upload when this fails — `definite`
 * (the file itself: damaged, cut short, an image libheif cannot decode) or not
 * (no slot in time, a time-out, a disk / plugin problem — "try again").
 */
import { spawn as nodeSpawn } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import sharp from 'sharp';
import { uploadFormatForType } from '@cms/api-types';
import {
  UPLOAD_IMAGE_MAX_DIM,
  UPLOAD_JPEG_QUALITY,
  UPLOAD_WEBP_QUALITY,
} from '../storage/media-optimization.service';
import { CheckSlots, errorText, intEnv, runTool } from './tool-runner';
import type { ToolRun } from './upload-content-verdict';

// ── what the bytes are ──────────────────────────────────────────────────────

/** The `ftyp` box at the start of an ISO-BMFF file: major and compatible brands (raw 4-char codes). */
export function isoBrands(
  bytes: Buffer | null | undefined,
): { major: string; compatible: string[] } | null {
  if (!bytes || bytes.length < 16) return null;
  if (bytes.toString('latin1', 4, 8) !== 'ftyp') return null;
  const size = bytes.readUInt32BE(0);
  if (size < 16 || size > 4096) return null;
  const end = Math.min(size, bytes.length);
  const compatible: string[] = [];
  for (let p = 16; p + 4 <= end; p += 4)
    compatible.push(bytes.toString('latin1', p, p + 4));
  return { major: bytes.toString('latin1', 8, 12), compatible };
}

/** HEVC-coded HEIF: Apple's `heic` (+ `heix` 10-bit, `heim`/`heis` multi-layer / scalable) and the HEVC sequence brands. */
const HEVC_HEIF_BRANDS = new Set([
  'heic',
  'heix',
  'heim',
  'heis',
  'hevc',
  'hevx',
  'hevm',
  'hevs',
]);
/** AV1-coded HEIF (AVIF). */
const AV1_HEIF_BRANDS = new Set(['avif', 'avis']);
/** HEIF structure brands that name no codec. */
const HEIF_STRUCTURE_BRANDS = new Set(['mif1', 'mif2', 'msf1', 'miaf']);

export type HeifFamily = 'hevc' | 'av1' | 'heif';

/**
 * Is this a HEIF, and which kind? `hevc` — every iPhone photo; `av1` — AVIF;
 * `heif` — a HEIF that names only its structure. null — not a HEIF at all.
 */
export function heifFamily(
  bytes: Buffer | null | undefined,
): HeifFamily | null {
  const b = isoBrands(bytes);
  if (!b) return null;
  const all = [b.major, ...b.compatible].map((x) => x.trim().toLowerCase());
  if (all.some((x) => HEVC_HEIF_BRANDS.has(x))) return 'hevc';
  if (all.some((x) => AV1_HEIF_BRANDS.has(x))) return 'av1';
  if (all.some((x) => HEIF_STRUCTURE_BRANDS.has(x))) return 'heif';
  return null;
}

/**
 * Must this upload go through the HEIC converter? When it is CALLED a HEIC / HEIF
 * (`.heic`, `image/heic`, `image/heif` …), or when its BYTES are a HEIF that is
 * not AVIF whatever it is called — a HEIC saved as `.jpg` is converted, not
 * refused (the name is not the truth). AVIF under a picture's name is left to the
 * upload optimizer, which reads AVIF itself.
 */
export function needsHeifConversion(
  declaredType: string | null | undefined,
  bytes: Buffer | null | undefined,
): boolean {
  if (uploadFormatForType(declaredType)?.handling === 'convert-at-upload')
    return true;
  const family = heifFamily(bytes);
  return family === 'hevc' || family === 'heif';
}

// ── running heif-dec ────────────────────────────────────────────────────────

/** The one HEIC decoder this converter runs (Dockerfile: `libheif-tools`). */
export const HEIF_DEC = 'heif-dec';

/**
 * The heif-dec argv. Two tile threads and one codec thread: at most two decoder
 * threads (the API also delivers alerts). A fast PNG (level 1): lossless, and the
 * 48 MP case writes in 3.2 s instead of 6.9 s at the default level. libheif's own
 * security limits stay ON (never `--disable-limits` on uploaded files).
 */
export function buildHeifDecArgs(input: string, output: string): string[] {
  return [
    '--quiet',
    '--tile-threads',
    '2',
    '--codec-threads',
    '1',
    '--png-compression-level',
    '1',
    input,
    output,
  ];
}

/**
 * heif-dec said the FILE is broken. Measured: a HEIC cut off at a third decodes
 * with exit code 0 and lines like "Warning: Invalid input: Unexpected end of file:
 * Extent in iloc box references data outside of file bounds" — and the picture has
 * whole tiles missing (solid green). So a warning about the input is a refusal,
 * never a "success".
 */
export const HEIF_DAMAGED =
  /invalid input|unexpected end of file|outside of file bounds|no 'meta' box|not appear to start with a valid box|does not contain|security limit|unsupported (?:feature|codec|color|colour|image)|corrupt|bitstream|could not decode/i;

/**
 * heif-dec could not do its job for a reason that is about THIS SERVER, not the
 * file: a missing decoder plugin ("No decoding plugin installed for this
 * compression format"), memory, the disk ("could not write image" — which heif-dec
 * reports with exit code 0), the temp file vanishing (exit 10). Never a verdict.
 */
export const HEIF_ENVIRONMENT =
  /no decoding plugin|error while loading plugin|plugin|memory|cannot allocate|could not write|can't open|no space|enospc|permission denied|input file does not exist|no such file/i;

export type HeifDecFinding =
  | { ok: true; warnings: string }
  | { ok: false; definite: boolean; why: string };

/** What one heif-dec run means. `outputBytes` is the size of the PNG it left (0 / null = none). */
export function classifyHeifDecRun(
  run: ToolRun,
  outputBytes: number | null,
): HeifDecFinding {
  if (run.spawnError)
    return {
      ok: false,
      definite: false,
      why: `heif-dec could not start (${run.spawnError})`,
    };
  if (run.timedOut)
    return { ok: false, definite: false, why: 'heif-dec ran out of time' };
  const said = oneLine(`${run.stderr} ${run.stdout}`);
  // The environment wins over anything else it printed: "could not write" after a
  // perfectly good decode is the disk, not the photo.
  if (HEIF_ENVIRONMENT.test(said))
    return { ok: false, definite: false, why: `heif-dec: ${said}` };
  if (HEIF_DAMAGED.test(said))
    return { ok: false, definite: true, why: `heif-dec: ${said}` };
  if (run.exitCode !== 0) {
    return {
      ok: false,
      definite: true,
      why: `heif-dec exited ${run.exitCode}: ${said || 'no message'}`,
    };
  }
  if (!outputBytes)
    return {
      ok: false,
      definite: false,
      why: `heif-dec wrote no picture${said ? `: ${said}` : ''}`,
    };
  return { ok: true, warnings: said };
}

// ── the conversion ──────────────────────────────────────────────────────────

export interface HeifConverted {
  ok: true;
  buffer: Buffer;
  mimeType: 'image/jpeg' | 'image/webp';
  ext: '.jpg' | '.webp';
  /** The stored picture. */
  width: number;
  height: number;
  /** The photo as decoded — upright, before the 3840 px cap. */
  sourceWidth: number;
  sourceHeight: number;
  /** heif-dec for a HEIF; sharp alone for a file that only CLAIMED to be one (a JPEG named .heic). */
  decoder: 'heif-dec' | 'sharp';
  ms: number;
}

export interface HeifNotConverted {
  ok: false;
  /** true — the file itself (damaged, cut short, undecodable); false — the conversion could not run just now. */
  definite: boolean;
  why: string;
  ms: number;
}

export type HeifConversion = HeifConverted | HeifNotConverted;

export interface HeifConverterOptions {
  /** The limiter shared with the upload content check. */
  slots: CheckSlots;
  /** Test seam: production spawns the real heif-dec. Read on every call. */
  spawnFn?: () => typeof nodeSpawn;
  budgetMs?: number;
  tmpRoot?: () => string;
}

/** sharp gave up for a reason that is about the SERVER's limits, not the file. */
const SHARP_RESOURCE_LIMIT =
  /pixel limit|out of memory|memory allocation|cannot allocate|enomem|timeout/i;

export class HeifConverter {
  readonly budgetMs: number;
  private readonly slots: CheckSlots;
  private readonly spawnFn: () => typeof nodeSpawn;
  private readonly tmpRoot: () => string;

  constructor(opts: HeifConverterOptions) {
    this.slots = opts.slots;
    this.spawnFn = opts.spawnFn ?? (() => nodeSpawn);
    this.budgetMs = opts.budgetMs ?? intEnv('UPLOAD_HEIC_BUDGET_MS', 30_000);
    this.tmpRoot = opts.tmpRoot ?? (() => os.tmpdir());
  }

  /** Never throws. */
  async convert(bytes: Buffer | null | undefined): Promise<HeifConversion> {
    const started = Date.now();
    const deadline = started + this.budgetMs;
    const failed = (definite: boolean, why: string): HeifNotConverted => ({
      ok: false,
      definite,
      why,
      ms: Date.now() - started,
    });
    if (!bytes)
      return failed(false, 'the file could not be read back from storage');
    if (bytes.length === 0) return failed(true, 'the file is empty');

    let dir: string | null = null;
    try {
      // Not a HEIF at all (a JPEG or PNG that was only CALLED .heic): sharp reads
      // it directly, honouring its own EXIF orientation.
      if (heifFamily(bytes) === null)
        return await this.encode(bytes, {
          autoOrient: true,
          decoder: 'sharp',
          deadline,
          started,
          failed,
        });

      const release = await this.slots.acquire(deadline);
      if (!release)
        return failed(false, 'no free conversion slot within the time budget');
      let finding: HeifDecFinding;
      let output = '';
      try {
        dir = await fs.mkdtemp(path.join(this.tmpRoot(), 'edu-heif-'));
        const input = path.join(dir, 'in.heic');
        output = path.join(dir, 'out.png');
        await fs.writeFile(input, bytes);
        const run = await runTool(
          this.spawnFn(),
          HEIF_DEC,
          buildHeifDecArgs(input, output),
          deadline - Date.now(),
        );
        const written = await fs
          .stat(output)
          .then((s) => s.size)
          .catch(() => 0);
        finding = classifyHeifDecRun(run, written);
      } finally {
        release();
      }
      if (!finding.ok) return failed(finding.definite, finding.why);
      // libheif has applied the HEIF transforms (irot / imir / clap) and resets the
      // EXIF orientation it writes to 1: the picture is upright as it stands, and
      // honouring an EXIF tag here could only turn it a second time.
      return await this.encode(output, {
        autoOrient: false,
        decoder: 'heif-dec',
        deadline,
        started,
        failed,
      });
    } catch (err) {
      // Disk, a temp directory, anything this code did not expect: never the file.
      return failed(false, `the conversion could not run: ${errorText(err)}`);
    } finally {
      if (dir)
        await fs
          .rm(dir, { recursive: true, force: true })
          .catch(() => undefined);
    }
  }

  /** The upload optimizer's photo profile, colour-managed to sRGB, metadata stripped. */
  private async encode(
    input: Buffer | string,
    o: {
      autoOrient: boolean;
      decoder: HeifConverted['decoder'];
      deadline: number;
      started: number;
      failed: (definite: boolean, why: string) => HeifNotConverted;
    },
  ): Promise<HeifConversion> {
    const seconds = () =>
      Math.max(1, Math.ceil((o.deadline - Date.now()) / 1000));
    let meta: sharp.Metadata;
    try {
      meta = await sharp(input, { failOn: 'none' }).metadata();
    } catch (err) {
      const why = `sharp: ${oneLine(errorText(err))}`;
      return o.failed(!SHARP_RESOURCE_LIMIT.test(why), why);
    }
    if (!meta.width || !meta.height)
      return o.failed(true, 'the decoded picture has no size');
    const swaps =
      o.autoOrient &&
      typeof meta.orientation === 'number' &&
      meta.orientation >= 5;
    const sourceWidth = swaps ? meta.height : meta.width;
    const sourceHeight = swaps ? meta.width : meta.height;
    try {
      const transparent =
        meta.hasAlpha === true &&
        !(
          await sharp(input, { failOn: 'none' })
            .timeout({ seconds: seconds() })
            .stats()
        ).isOpaque;
      let pipeline = sharp(input, { failOn: 'none' }).timeout({
        seconds: seconds(),
      });
      if (o.autoOrient) pipeline = pipeline.rotate();
      pipeline = pipeline
        .resize({
          width: UPLOAD_IMAGE_MAX_DIM,
          height: UPLOAD_IMAGE_MAX_DIM,
          fit: 'inside',
          withoutEnlargement: true,
        })
        // Transform FROM the embedded profile (Display P3 on an iPhone) TO sRGB —
        // see the header for why this is not left to sharp's default.
        .withIccProfile('srgb');
      const { data, info } = transparent
        ? await pipeline
            .webp({ quality: UPLOAD_WEBP_QUALITY })
            .toBuffer({ resolveWithObject: true })
        : await pipeline
            .removeAlpha()
            .jpeg({ quality: UPLOAD_JPEG_QUALITY, mozjpeg: true })
            .toBuffer({ resolveWithObject: true });
      if (!data.length || !info.width || !info.height)
        return o.failed(false, 'the encoder wrote nothing');
      return {
        ok: true,
        buffer: data,
        mimeType: transparent ? 'image/webp' : 'image/jpeg',
        ext: transparent ? '.webp' : '.jpg',
        width: info.width,
        height: info.height,
        sourceWidth,
        sourceHeight,
        decoder: o.decoder,
        ms: Date.now() - o.started,
      };
    } catch (err) {
      const why = `sharp: ${oneLine(errorText(err))}`;
      return o.failed(!SHARP_RESOURCE_LIMIT.test(why), why);
    }
  }
}

function oneLine(s: string): string {
  return String(s)
    .replace(/\s+/g, ' ')
    .replace(/\/\S*edu-heif-\S*/g, '<file>')
    .trim()
    .slice(0, 300);
}
