/**
 * HEIC → JPEG at upload (2026-10-05, heif-convert.ts).
 *
 *   1. what the bytes are: the `ftyp` brands decide HEIC / AVIF / not-a-HEIF, and
 *      a HEIC under ANY name is converted (the name is not the truth);
 *   2. what a heif-dec run means — every message below is heif-dec 1.23.4's own,
 *      captured on the production base image (Alpine 3.24.1): a HEIC cut short
 *      decodes with EXIT CODE 0 and missing tiles, so a warning about the input is
 *      a refusal; a missing plugin, a full disk or a vanished temp file is "could
 *      not run", never a verdict on the photo;
 *   3. the conversion itself, through a STAND-IN heif-dec (a real child process
 *      that writes the PNG heif-dec would write) and the REAL sharp: Display P3 →
 *      sRGB for 8-bit AND 16-bit decodes (a 16-bit one is washed out by sharp's
 *      default pipeline — the negative control proves the test would see it), the
 *      3840 px cap, transparency kept as WebP, no EXIF / GPS, the HEIF path never
 *      turned a second time by an EXIF tag, the limiter, the time budget, and no
 *      temp files left behind;
 *   4. the REAL heif-dec on HEICs written by Apple's own encoder (`sips`): tiled,
 *      rotated (`irot` + EXIF 6, exactly an iPhone portrait shot) and Display P3.
 *      It needs `sips` (macOS) and a heif-dec: the box's own, or — opt-in, for a
 *      developer Mac — the PRODUCTION image's, run through Docker
 *      (HEIF_TEST_DOCKER_IMAGE=<image>). Skipped, with the reason logged, otherwise.
 */
import {
  execFileSync,
  spawn as nodeSpawn,
  type SpawnOptions,
} from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import sharp from 'sharp';
import {
  buildHeifDecArgs,
  classifyHeifDecRun,
  HeifConverter,
  heifFamily,
  isoBrands,
  needsHeifConversion,
} from './heif-convert';
import { CheckSlots } from './tool-runner';
import type { ToolRun } from './upload-content-verdict';

const run = (over: Partial<ToolRun> = {}): ToolRun => ({
  exitCode: 0,
  stdout: '',
  stderr: '',
  spawnError: null,
  timedOut: false,
  ...over,
});

/** An ISO-BMFF `ftyp` box with these brands, then padding. */
function ftyp(major: string, compatible: string[], pad = 64): Buffer {
  const size = 16 + 4 * compatible.length;
  const b = Buffer.alloc(size + pad);
  b.writeUInt32BE(size, 0);
  b.write('ftyp', 4, 'latin1');
  b.write(major, 8, 'latin1');
  compatible.forEach((c, i) => b.write(c, 16 + 4 * i, 'latin1'));
  return b;
}

describe('what the bytes are', () => {
  it('reads the ftyp brands of an iPhone HEIC', () => {
    expect(isoBrands(ftyp('heic', ['mif1', 'miaf', 'MiHB', 'heic']))).toEqual({
      major: 'heic',
      compatible: ['mif1', 'miaf', 'MiHB', 'heic'],
    });
  });

  it.each<[string, Buffer, string | null]>([
    ['an iPhone HEIC', ftyp('heic', ['mif1', 'miaf', 'MiHB', 'heic']), 'hevc'],
    ['a 10-bit HEIC (heix)', ftyp('heix', ['mif1', 'heix']), 'hevc'],
    [
      'a HEIF that names its codec only in the compatible list',
      ftyp('mif1', ['mif1', 'heic']),
      'hevc',
    ],
    ['an AVIF', ftyp('avif', ['mif1', 'miaf', 'avif']), 'av1'],
    [
      'a HEIF that names only its structure',
      ftyp('mif1', ['mif1', 'miaf']),
      'heif',
    ],
    ['an MP4', ftyp('isom', ['isom', 'iso2', 'avc1', 'mp41']), null],
    ['a QuickTime movie', ftyp('qt  ', ['qt  ']), null],
    [
      'a JPEG',
      Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...new Array<number>(60).fill(0)]),
      null,
    ],
    ['text', Buffer.from('this is not a photo at all, just words\n'), null],
    ['nothing', Buffer.alloc(0), null],
  ])('%s → %s', (_name, bytes, family) => {
    expect(heifFamily(bytes)).toBe(family);
  });

  it('an absurd ftyp size is not trusted', () => {
    const b = ftyp('heic', ['heic']);
    b.writeUInt32BE(1_000_000, 0);
    expect(isoBrands(b)).toBeNull();
  });

  it('converts what is CALLED a HEIC, and HEIC bytes under any picture name — not AVIF, not a real JPEG', () => {
    const heic = ftyp('heic', ['mif1', 'heic']);
    expect(needsHeifConversion('image/heic', null)).toBe(true);
    expect(needsHeifConversion('image/heif', Buffer.from('anything'))).toBe(
      true,
    );
    expect(needsHeifConversion('image/HEIC; foo=1', null)).toBe(true);
    expect(needsHeifConversion('image/jpeg', heic)).toBe(true); // a HEIC saved as .jpg
    expect(needsHeifConversion('image/png', ftyp('mif1', ['mif1']))).toBe(true);
    expect(
      needsHeifConversion('image/jpeg', ftyp('avif', ['mif1', 'avif'])),
    ).toBe(false); // the optimizer reads AVIF
    expect(
      needsHeifConversion(
        'image/jpeg',
        Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...new Array<number>(60).fill(0)]),
      ),
    ).toBe(false);
    expect(needsHeifConversion('image/jpeg', null)).toBe(false);
    expect(needsHeifConversion('video/mp4', ftyp('isom', ['isom']))).toBe(
      false,
    );
  });
});

describe('the heif-dec argv', () => {
  it('quiet, two decoder threads at most, a fast lossless PNG — and libheif’s security limits left ON', () => {
    const args = buildHeifDecArgs('/t/in.heic', '/t/out.png');
    expect(args).toEqual([
      '--quiet',
      '--tile-threads',
      '2',
      '--codec-threads',
      '1',
      '--png-compression-level',
      '1',
      '/t/in.heic',
      '/t/out.png',
    ]);
    expect(args.join(' ')).not.toMatch(/disable-limits/);
  });
});

describe('what a heif-dec run means (heif-dec 1.23.4’s own words, production base image)', () => {
  it('a clean run that wrote a picture is a success', () => {
    expect(classifyHeifDecRun(run(), 1_825_131)).toEqual({
      ok: true,
      warnings: '',
    });
  });

  it('a HEIC CUT SHORT exits 0 with tiles missing — the warning makes it a refusal, not a success', () => {
    const stderr =
      'Warning: Invalid input: Unexpected end of file: Extent in iloc box references data outside of file bounds (points to file position 134339)\n' +
      'Warning: Invalid input: Unexpected end of file: Extent in iloc box references data outside of file bounds (points to file position 362432)\n';
    expect(classifyHeifDecRun(run({ stderr }), 575_150)).toEqual(
      expect.objectContaining({ ok: false, definite: true }),
    );
  });

  it.each([
    [
      "Could not read HEIF/AVIF file: Invalid input: No 'meta' box: Cannot read full meta box",
      1,
    ],
    ['Input file does not appear to start with a valid box length.', 1],
    ['Could not decode image: Unsupported feature: Unsupported codec', 1],
    ['Could not decode image: Invalid input: Security limit exceeded: …', 1],
    ['something else entirely went wrong', 3],
  ])('the FILE: %j (exit %d) is a definite refusal', (stderr, exitCode) => {
    expect(classifyHeifDecRun(run({ stderr, exitCode }), 0)).toEqual(
      expect.objectContaining({ ok: false, definite: true }),
    );
  });

  it.each<[string, Partial<ToolRun>, number]>([
    [
      'the HEVC plugin is missing',
      {
        exitCode: 1,
        stderr:
          'Could not decode image: Error while loading plugin: No decoding plugin installed for this compression format: HEVC (a suitable decoder plugin is libde265)',
      },
      0,
    ],
    [
      'the PNG could not be written (heif-dec exits 0!)',
      {
        exitCode: 0,
        stderr:
          "Can't open /x/out.png: No such file or directory\ncould not write image\n",
      },
      0,
    ],
    [
      'the temp file vanished',
      { exitCode: 10, stderr: 'Input file does not exist.\n' },
      0,
    ],
    [
      'heif-dec is not installed',
      { exitCode: null, spawnError: 'spawn heif-dec ENOENT' },
      0,
    ],
    ['it ran out of time', { exitCode: null, timedOut: true }, 0],
    ['memory', { exitCode: 1, stderr: 'Memory allocation error: …' }, 0],
    ['exit 0, no message, and no picture', { exitCode: 0 }, 0],
  ])(
    'THIS SERVER, not the photo — %s: "could not run", never a verdict',
    (_name, over, bytes) => {
      expect(classifyHeifDecRun(run(over), bytes)).toEqual(
        expect.objectContaining({ ok: false, definite: false }),
      );
    },
  );
});

// ── the conversion, with a stand-in heif-dec and the real sharp ──────────────

const PATCHES: Array<[number, number, number]> = [
  [255, 0, 0],
  [0, 255, 0],
  [0, 0, 255],
  [255, 128, 0],
  [224, 172, 105],
  [128, 128, 128],
];
const PATCH = 200;

/** Six flat sRGB patches in a row, 1200×200 (raw RGB). */
function patchesRaw(): Buffer {
  const W = PATCH * PATCHES.length;
  const raw = Buffer.alloc(W * PATCH * 3);
  for (let y = 0; y < PATCH; y++)
    for (let x = 0; x < W; x++) {
      const [r, g, b] = PATCHES[Math.floor(x / PATCH)];
      const o = (y * W + x) * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  return raw;
}

/** The centre of each patch, whatever size the picture came out at. */
async function sampleRow(
  buf: Buffer,
): Promise<Array<[number, number, number]>> {
  const { data, info } = await sharp(buf)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return PATCHES.map((_, i) => {
    const x = Math.round(((i + 0.5) * info.width) / PATCHES.length);
    const y = Math.round(info.height / 2);
    const o = (y * info.width + x) * info.channels;
    return [data[o], data[o + 1], data[o + 2]];
  });
}

const maxError = (got: Array<[number, number, number]>) =>
  Math.max(
    ...got.flatMap((p, i) => p.map((v, c) => Math.abs(v - PATCHES[i][c]))),
  );

/**
 * A stand-in for heif-dec: a REAL child process (so `runTool` runs for real) that
 * copies a prepared PNG to the output path heif-dec was given, prints what it is
 * told to, and exits — or hangs.
 */
function standInHeifDec(
  b: { png?: string; stderr?: string; exitCode?: number; hang?: boolean },
  calls: string[][] = [],
) {
  return (() =>
    ((cmd: string, args: string[], opts: SpawnOptions) => {
      calls.push([cmd, ...args]);
      const script =
        "const fs=require('fs');const [png,out,stderr,code,hang]=process.argv.slice(1);" +
        'if(stderr)process.stderr.write(stderr);if(png)fs.copyFileSync(png,out);' +
        "if(hang==='1')setInterval(()=>{},1000);else process.exit(Number(code));";
      return nodeSpawn(
        process.execPath,
        [
          '-e',
          script,
          b.png ?? '',
          args[args.length - 1],
          b.stderr ?? '',
          String(b.exitCode ?? 0),
          b.hang ? '1' : '0',
        ],
        opts,
      );
    }) as unknown as typeof nodeSpawn) as () => typeof nodeSpawn;
}

describe('HeifConverter — the conversion (stand-in heif-dec, real sharp)', () => {
  jest.setTimeout(60_000);
  let dir = '';
  let tmpRoot = '';
  const HEIC = ftyp('heic', ['mif1', 'miaf', 'MiHB', 'heic'], 4096); // what the stand-in is "decoding"
  const files: Record<string, string> = {};

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'heif-convert-spec-'));
    tmpRoot = path.join(dir, 'tmp');
    await fs.mkdir(tmpRoot);
    const raw = {
      raw: {
        width: PATCH * PATCHES.length,
        height: PATCH,
        channels: 3 as const,
      },
    };
    // What heif-dec writes for an iPhone photo: Display-P3 numbers + the P3 profile.
    files.p3 = path.join(dir, 'p3.png');
    await sharp(patchesRaw(), raw).withIccProfile('p3').png().toFile(files.p3);
    // …and for a 10-bit HEIC: the same, 16 bits per channel.
    files.p3x16 = path.join(dir, 'p3-16.png');
    await sharp(files.p3)
      .keepIccProfile()
      .removeAlpha()
      .toColourspace('rgb16')
      .png()
      .toFile(files.p3x16);
    // A 48 MP-class decode: bigger than the 3840 px cap on its long side.
    files.big = path.join(dir, 'big.png');
    await sharp({
      create: {
        width: 5000,
        height: 3750,
        channels: 3,
        background: { r: 30, g: 120, b: 200 },
      },
    })
      .png({ compressionLevel: 1 })
      .toFile(files.big);
    // A cut-out "sticker": left half orange, right half fully transparent.
    const rgba = Buffer.alloc(400 * 300 * 4);
    for (let y = 0; y < 300; y++)
      for (let x = 0; x < 200; x++)
        rgba.set([255, 128, 0, 255], (y * 400 + x) * 4);
    files.alpha = path.join(dir, 'alpha.png');
    await sharp(rgba, { raw: { width: 400, height: 300, channels: 4 } })
      .png()
      .toFile(files.alpha);
    // RGBA but every pixel opaque: still a photo → JPEG.
    files.opaqueRgba = path.join(dir, 'opaque-rgba.png');
    await sharp({
      create: {
        width: 400,
        height: 300,
        channels: 4,
        background: { r: 10, g: 200, b: 10, alpha: 1 },
      },
    })
      .png()
      .toFile(files.opaqueRgba);
    // A decode that still carries EXIF Orientation 6 + a GPS position: the HEIF path
    // must neither turn it nor keep the tags.
    files.tagged = path.join(dir, 'tagged.png');
    await sharp({
      create: {
        width: 400,
        height: 300,
        channels: 3,
        background: { r: 200, g: 50, b: 50 },
      },
    })
      .withExif({ IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '41/1 30/1 0/1' } })
      .withMetadata({ orientation: 6 })
      .png()
      .toFile(files.tagged);
  });
  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  });

  const converter = (
    b: Parameters<typeof standInHeifDec>[0],
    over: { budgetMs?: number; slots?: CheckSlots; calls?: string[][] } = {},
  ) =>
    new HeifConverter({
      slots: over.slots ?? new CheckSlots(1),
      spawnFn: standInHeifDec(b, over.calls),
      budgetMs: over.budgetMs ?? 20_000,
      tmpRoot: () => tmpRoot,
    });

  const leftovers = async () =>
    (await fs.readdir(tmpRoot)).filter((n) => n.startsWith('edu-heif-'));

  it('NEGATIVE CONTROL: sharp’s DEFAULT pipeline leaves a 16-bit P3 decode washed out — the failure this converter exists to avoid', async () => {
    const naive = await sharp(files.p3x16).jpeg().toBuffer();
    expect(maxError(await sampleRow(naive))).toBeGreaterThan(40);
  });

  it.each([
    ['an 8-bit Display-P3 decode (every iPhone photo)', 'p3'],
    ['a 16-bit Display-P3 decode (a 10-bit HEIC)', 'p3x16'],
  ])(
    '%s becomes an sRGB JPEG with the right colours — no EXIF, nothing left behind',
    async (_name, key) => {
      const calls: string[][] = [];
      const conv = await converter({ png: files[key] }, { calls }).convert(
        HEIC,
      );
      if (!conv.ok) throw new Error(conv.why);
      expect(calls[0][0]).toBe('heif-dec');
      expect(conv).toMatchObject({
        mimeType: 'image/jpeg',
        ext: '.jpg',
        width: 1200,
        height: 200,
        sourceWidth: 1200,
        sourceHeight: 200,
        decoder: 'heif-dec',
      });
      expect(maxError(await sampleRow(conv.buffer))).toBeLessThanOrEqual(6);
      const meta = await sharp(conv.buffer).metadata();
      expect(meta.format).toBe('jpeg');
      expect(meta.exif).toBeUndefined();
      expect(meta.orientation).toBeUndefined();
      expect(await leftovers()).toEqual([]);
    },
  );

  it('a decode bigger than 3840 px is brought down to the cap, aspect kept', async () => {
    const conv = await converter({ png: files.big }).convert(HEIC);
    if (!conv.ok) throw new Error(conv.why);
    expect([conv.width, conv.height]).toEqual([3840, 2880]);
    expect([conv.sourceWidth, conv.sourceHeight]).toEqual([5000, 3750]);
  });

  it('real transparency is kept (WebP); an RGBA photo with no transparent pixel is still a JPEG', async () => {
    const cut = await converter({ png: files.alpha }).convert(HEIC);
    if (!cut.ok) throw new Error(cut.why);
    expect(cut).toMatchObject({ mimeType: 'image/webp', ext: '.webp' });
    const m = await sharp(cut.buffer).metadata();
    expect(m.hasAlpha).toBe(true);
    const { data, info } = await sharp(cut.buffer)
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(data[(150 * info.width + 350) * 4 + 3]).toBe(0); // the right half is still transparent
    const opaque = await converter({ png: files.opaqueRgba }).convert(HEIC);
    if (!opaque.ok) throw new Error(opaque.why);
    expect(opaque.mimeType).toBe('image/jpeg');
  });

  it('the HEIF path is never turned a second time by an EXIF tag, and no tag (no GPS) survives', async () => {
    // The fixture really carries the tags (else this test would prove nothing).
    const fixture = await sharp(files.tagged).metadata();
    expect(fixture.orientation).toBe(6);
    // GPSInfo (tag 0x8825) points at the GPS block, in either byte order.
    const gpsTag = (b?: Buffer) =>
      !!b &&
      (b.includes(Buffer.from([0x88, 0x25])) ||
        b.includes(Buffer.from([0x25, 0x88])));
    expect(gpsTag(fixture.exif)).toBe(true);
    const conv = await converter({ png: files.tagged }).convert(HEIC);
    if (!conv.ok) throw new Error(conv.why);
    expect([conv.width, conv.height]).toEqual([400, 300]); // libheif already applied irot
    const m = await sharp(conv.buffer).metadata();
    expect(m.exif).toBeUndefined();
    expect(m.orientation).toBeUndefined();
  });

  it('a file only CALLED .heic (a real JPEG) is converted by sharp alone — its own EXIF orientation honoured', async () => {
    const jpeg = await sharp(await fs.readFile(files.tagged))
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    expect((await sharp(jpeg).metadata()).orientation).toBe(6);
    const calls: string[][] = [];
    const conv = await converter({}, { calls }).convert(jpeg);
    if (!conv.ok) throw new Error(conv.why);
    expect(calls).toEqual([]); // heif-dec never ran
    expect(conv).toMatchObject({
      decoder: 'sharp',
      width: 300,
      height: 400,
      mimeType: 'image/jpeg',
    });
  });

  it('text called .heic is a definite refusal — heif-dec never runs', async () => {
    const calls: string[][] = [];
    const conv = await converter({}, { calls }).convert(
      Buffer.from('this is not a photo at all\n'),
    );
    expect(conv).toEqual(
      expect.objectContaining({ ok: false, definite: true }),
    );
    expect(calls).toEqual([]);
  });

  it('a HEIC heif-dec decodes only partly (exit 0 + "Invalid input") is REFUSED — the half-grey picture is never stored', async () => {
    const conv = await converter({
      png: files.p3,
      stderr:
        'Warning: Invalid input: Unexpected end of file: Extent in iloc box references data outside of file bounds (points to file position 134339)\n',
    }).convert(HEIC);
    expect(conv).toEqual(
      expect.objectContaining({ ok: false, definite: true }),
    );
    expect(await leftovers()).toEqual([]);
  });

  it('a missing decoder plugin is "could not run" (try again), not a verdict on the photo', async () => {
    const conv = await converter({
      exitCode: 1,
      stderr:
        'Could not decode image: Error while loading plugin: No decoding plugin installed for this compression format: HEVC (a suitable decoder plugin is libde265)\n',
    }).convert(HEIC);
    expect(conv).toEqual(
      expect.objectContaining({ ok: false, definite: false }),
    );
  });

  it('a heif-dec that hangs is SIGKILLed at the budget: "could not run", temp files gone', async () => {
    const started = Date.now();
    const conv = await converter({ hang: true }, { budgetMs: 1_500 }).convert(
      HEIC,
    );
    expect(conv).toEqual(
      expect.objectContaining({
        ok: false,
        definite: false,
        why: 'heif-dec ran out of time',
      }),
    );
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(await leftovers()).toEqual([]);
  });

  it('ONE child at a time: with the shared limiter busy, the next conversion waits inside its budget, then gives up as "could not run"', async () => {
    const slots = new CheckSlots(1);
    const release = await slots.acquire(Date.now() + 1000);
    const calls: string[][] = [];
    const conv = await converter(
      { png: files.p3 },
      { slots, budgetMs: 400, calls },
    ).convert(HEIC);
    expect(conv).toEqual(
      expect.objectContaining({
        ok: false,
        definite: false,
        why: 'no free conversion slot within the time budget',
      }),
    );
    expect(calls).toEqual([]); // never forked a second child
    release!();
    // …and once the slot is free the same photo converts.
    expect(
      (await converter({ png: files.p3 }, { slots }).convert(HEIC)).ok,
    ).toBe(true);
    expect(slots.inUse).toBe(0);
  });

  it('bytes that could not be read back are "could not run"; zero bytes are a verdict', async () => {
    expect(await converter({}).convert(null)).toEqual(
      expect.objectContaining({ ok: false, definite: false }),
    );
    expect(await converter({}).convert(Buffer.alloc(0))).toEqual(
      expect.objectContaining({ ok: false, definite: true }),
    );
  });
});

// ── the REAL heif-dec on Apple's own tiled HEICs ────────────────────────────

const hasTool = (cmd: string, args: string[]) => {
  try {
    execFileSync(cmd, args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};
const DOCKER_IMAGE = process.env.HEIF_TEST_DOCKER_IMAGE || '';
const hasSips = process.platform === 'darwin' && hasTool('sips', ['--help']);
const localHeifDec = hasTool('heif-dec', ['--version']);
const dockerHeifDec =
  !!DOCKER_IMAGE && hasTool('docker', ['image', 'inspect', DOCKER_IMAGE]);
const realReady = hasSips && (localHeifDec || dockerHeifDec);
if (!realReady) {
  console.warn(
    `[heif-convert.spec] the REAL-HEIC cases are SKIPPED: ${hasSips ? '' : 'no macOS sips to write Apple HEICs; '}` +
      `${localHeifDec || dockerHeifDec ? '' : 'no heif-dec on this box (set HEIF_TEST_DOCKER_IMAGE to an image that has it, e.g. the production image)'}` +
      ' — the production image ships heif-dec and the Dockerfile proves it decodes at build time.',
  );
}

(realReady ? describe : describe.skip)(
  'HeifConverter — the REAL heif-dec on HEICs written by Apple’s encoder (sips)',
  () => {
    jest.setTimeout(180_000);
    let dir = '';
    const heic: Record<string, Buffer> = {};
    const sipsHeic = async (src: string, out: string) => {
      execFileSync('sips', ['-s', 'format', 'heic', src, '--out', out], {
        stdio: 'ignore',
      });
      return fs.readFile(out);
    };

    beforeAll(async () => {
      dir = await fs.mkdtemp(path.join(os.tmpdir(), 'heif-real-'));
      // 1. Big enough to be TILED: 4032×3024 (Apple writes a grid of 48 512×512 tiles),
      //    with a red block top-left, green top-right, blue bottom-left.
      const W = 4032,
        H = 3024;
      const land = await sharp({
        create: {
          width: W,
          height: H,
          channels: 3,
          background: { r: 128, g: 128, b: 128 },
        },
      })
        .composite([
          {
            input: {
              create: {
                width: 600,
                height: 400,
                channels: 3,
                background: { r: 255, g: 0, b: 0 },
              },
            },
            left: 0,
            top: 0,
          },
          {
            input: {
              create: {
                width: 600,
                height: 400,
                channels: 3,
                background: { r: 0, g: 255, b: 0 },
              },
            },
            left: W - 600,
            top: 0,
          },
          {
            input: {
              create: {
                width: 600,
                height: 400,
                channels: 3,
                background: { r: 0, g: 0, b: 255 },
              },
            },
            left: 0,
            top: H - 400,
          },
        ])
        .jpeg({ quality: 95 })
        .toBuffer();
      await fs.writeFile(path.join(dir, 'land.jpg'), land);
      heic.tiled = await sipsHeic(
        path.join(dir, 'land.jpg'),
        path.join(dir, 'tiled.heic'),
      );
      // 2. The same pixels with EXIF Orientation 6: sips writes `irot` + EXIF 6 — an iPhone portrait.
      await fs.writeFile(
        path.join(dir, 'portrait.jpg'),
        await sharp(land)
          .withMetadata({ orientation: 6 })
          .jpeg({ quality: 95 })
          .toBuffer(),
      );
      heic.portrait = await sipsHeic(
        path.join(dir, 'portrait.jpg'),
        path.join(dir, 'portrait.heic'),
      );
      // 3. Display P3: the patch card, colour-matched into P3 by sharp and tagged.
      const card = await sharp(patchesRaw(), {
        raw: { width: PATCH * PATCHES.length, height: PATCH, channels: 3 },
      })
        .resize(PATCH * PATCHES.length * 3, PATCH * 3, { kernel: 'nearest' })
        .withIccProfile('p3')
        .png()
        .toBuffer();
      await fs.writeFile(path.join(dir, 'p3.png'), card);
      heic.p3 = await sipsHeic(
        path.join(dir, 'p3.png'),
        path.join(dir, 'p3.heic'),
      );
    });
    afterAll(async () => {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    });

    const realConverter = () => {
      const tmpRoot = dir;
      const spawnFn = localHeifDec
        ? () => nodeSpawn
        : () =>
            ((cmd: string, args: string[], opts: SpawnOptions) =>
              nodeSpawn(
                'docker',
                [
                  'run',
                  '--rm',
                  '-v',
                  `${tmpRoot}:${tmpRoot}`,
                  '--entrypoint',
                  cmd,
                  DOCKER_IMAGE,
                  ...args,
                ],
                opts,
              )) as unknown as typeof nodeSpawn;
      return new HeifConverter({
        slots: new CheckSlots(1),
        spawnFn,
        budgetMs: 120_000,
        tmpRoot: () => tmpRoot,
      });
    };

    const corner = async (buf: Buffer, fx: number, fy: number) => {
      const { data, info } = await sharp(buf)
        .raw()
        .toBuffer({ resolveWithObject: true });
      const x = Math.round(fx * (info.width - 1)),
        y = Math.round(fy * (info.height - 1));
      const o = (y * info.width + x) * info.channels;
      const [r, g, b] = [data[o], data[o + 1], data[o + 2]];
      return r > 180 && g < 90 && b < 90
        ? 'red'
        : g > 180 && r < 90 && b < 90
          ? 'green'
          : b > 180 && r < 90 && g < 90
            ? 'blue'
            : `${r},${g},${b}`;
    };

    it('Apple wrote them the way an iPhone does: a tiled grid; a NON-ZERO irot; a P3 profile', () => {
      for (const b of Object.values(heic)) expect(heifFamily(b)).toBe('hevc');
      const text = (b: Buffer) => b.toString('latin1');
      expect(text(heic.tiled)).toContain('grid');
      // The `irot` box: its one payload byte's low two bits are the angle in 90° steps (CCW).
      const irotAngle = (b: Buffer) => {
        const at = b.indexOf('irot', 0, 'latin1');
        return at < 0 ? null : (b[at + 4] & 3) * 90;
      };
      expect(irotAngle(heic.tiled)).toBe(0);
      expect(irotAngle(heic.portrait)).toBe(270); // = 90° clockwise, EXIF 6
      expect(text(heic.p3)).toContain('prof');
    });

    it('TILED: the whole 4032×3024 photo, every corner where it was — not one 512×512 tile', async () => {
      const conv = await realConverter().convert(heic.tiled);
      if (!conv.ok) throw new Error(conv.why);
      expect(conv).toMatchObject({
        decoder: 'heif-dec',
        mimeType: 'image/jpeg',
        sourceWidth: 4032,
        sourceHeight: 3024,
        width: 3840,
        height: 2880,
      });
      expect(await corner(conv.buffer, 0.02, 0.02)).toBe('red');
      expect(await corner(conv.buffer, 0.98, 0.02)).toBe('green');
      expect(await corner(conv.buffer, 0.02, 0.98)).toBe('blue');
    });

    it('PORTRAIT (irot + EXIF 6): upright 3024×4032, turned exactly ONCE', async () => {
      const conv = await realConverter().convert(heic.portrait);
      if (!conv.ok) throw new Error(conv.why);
      expect([conv.sourceWidth, conv.sourceHeight]).toEqual([3024, 4032]);
      expect([conv.width, conv.height]).toEqual([2880, 3840]);
      // Stored top-left (red) → shown top-right; top-right (green) → bottom-right; bottom-left (blue) → top-left.
      expect(await corner(conv.buffer, 0.98, 0.02)).toBe('red');
      expect(await corner(conv.buffer, 0.98, 0.98)).toBe('green');
      expect(await corner(conv.buffer, 0.02, 0.02)).toBe('blue');
      expect((await sharp(conv.buffer).metadata()).orientation).toBeUndefined();
    });

    it('DISPLAY P3: the colours come back right in sRGB — not washed out, not oversaturated', async () => {
      const conv = await realConverter().convert(heic.p3);
      if (!conv.ok) throw new Error(conv.why);
      expect(maxError(await sampleRow(conv.buffer))).toBeLessThanOrEqual(12);
    });
  },
);
