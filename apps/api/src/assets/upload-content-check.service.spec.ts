/**
 * UploadContentCheckService (2026-10-05): the evidence-gathering half of the
 * upload content check. The policy is pinned in upload-content-verdict.spec.ts;
 * this suite pins the plumbing — the budget, the process-wide limit on
 * ffprobe / ffmpeg children (the API also delivers lockdown alerts), the SSRF
 * prefix, the kill switch — and then runs the WHOLE check against tiny real
 * files over http with the box's own ffmpeg, ffprobe and sharp, including the
 * cases where storage misbehaves.
 */
import { spawn as nodeSpawn } from 'child_process';
import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import { PassThrough } from 'stream';
import { MediaOptimizationService } from '../storage/media-optimization.service';
import {
  CheckSlots,
  runTool,
  UploadContentCheckService,
} from './upload-content-check.service';
import {
  buildUploadCorpus,
  CorpusServer,
  hasMediaTools,
  makeCorpusDir,
  type UploadCorpus,
} from './upload-corpus.fixture-spec';

const PREFIX = 'https://proj.supabase.co/storage/v1/object/public/assets/';

function fakeStorage(over: Record<string, unknown> = {}) {
  return {
    publicUrlForPath: (p: string) => `${PREFIX}${p}`,
    readObjectRange: jest.fn(async () => null),
    ...over,
  } as any;
}

/** A spawn stand-in: each call answers from `script(cmd, args)` after `delayMs`, and counts live children. */
function scriptedSpawn(
  script: (
    cmd: string,
    args: string[],
  ) => { code: number; stdout?: string; stderr?: string },
  delayMs = 5,
) {
  const stats = {
    live: 0,
    maxLive: 0,
    calls: [] as Array<{ cmd: string; args: string[] }>,
  };
  const spawnFn = ((cmd: string, args: string[]) => {
    stats.calls.push({ cmd, args });
    stats.live += 1;
    stats.maxLive = Math.max(stats.maxLive, stats.live);
    const proc = new EventEmitter() as any;
    proc.stdout = new PassThrough();
    proc.stderr = new PassThrough();
    proc.kill = jest.fn();
    const out = script(cmd, args);
    setTimeout(() => {
      if (out.stdout) proc.stdout.write(out.stdout);
      if (out.stderr) proc.stderr.write(out.stderr);
      stats.live -= 1;
      setImmediate(() => proc.emit('close', out.code));
    }, delayMs);
    return proc;
  }) as unknown as typeof nodeSpawn;
  return { spawnFn, stats };
}

const GOOD_PROBE = JSON.stringify({
  streams: [
    {
      codec_type: 'video',
      codec_name: 'h264',
      width: 1280,
      height: 720,
      duration: '4.000000',
    },
  ],
  format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '4.000000' },
});
const ONE_FRAME =
  '#tb 0: 1/25\n0,         62,         62,        1,  1382400, 0x8a6f7a1b\n';

describe("CheckSlots — a process-wide limit on the check's children", () => {
  it('grants up to `max`, queues the rest, and hands a freed slot to the next waiter', async () => {
    const slots = new CheckSlots(2);
    const a = await slots.acquire(Date.now() + 1_000);
    const b = await slots.acquire(Date.now() + 1_000);
    expect([!!a, !!b, slots.inUse]).toEqual([true, true, 2]);
    const waiting = slots.acquire(Date.now() + 1_000);
    a!();
    a!(); // a double release is harmless
    const c = await waiting;
    expect(!!c).toBe(true);
    expect(slots.inUse).toBe(2);
    b!();
    c!();
    expect(slots.inUse).toBe(0);
  });

  it('a waiter whose deadline passes gets null (the check then accepts as "could not check")', async () => {
    const slots = new CheckSlots(1);
    const held = await slots.acquire(Date.now() + 1_000);
    expect(await slots.acquire(Date.now() + 30)).toBeNull();
    expect(await slots.acquire(Date.now() - 1)).toBeNull();
    held!();
    expect(slots.inUse).toBe(0);
  });
});

describe('runTool — never throws', () => {
  it('a missing binary is a spawn error, not a throw', async () => {
    const r = await runTool(
      nodeSpawn,
      'definitely-not-a-binary-edu-cms',
      [],
      2_000,
    );
    expect(r.spawnError).toMatch(/ENOENT/);
    expect(r.timedOut).toBe(false);
  });

  it('a child that outlives its budget is killed and reported as timed out', async () => {
    const started = Date.now();
    const r = await runTool(
      nodeSpawn,
      process.execPath,
      ['-e', 'setTimeout(() => {}, 20000)'],
      200,
    );
    expect(r.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('exit code and output are captured', async () => {
    const r = await runTool(
      nodeSpawn,
      process.execPath,
      [
        '-e',
        'process.stdout.write("out"); process.stderr.write("err"); process.exit(3)',
      ],
      5_000,
    );
    expect([r.exitCode, r.stdout, r.stderr, r.spawnError, r.timedOut]).toEqual([
      3,
      'out',
      'err',
      null,
      false,
    ]);
  });
});

describe('UploadContentCheckService — plumbing', () => {
  afterEach(() => {
    delete process.env.UPLOAD_CONTENT_CHECK_DISABLED;
  });

  it('the kill switch accepts everything without running a tool', async () => {
    process.env.UPLOAD_CONTENT_CHECK_DISABLED = '1';
    const { spawnFn, stats } = scriptedSpawn(() => ({
      code: 1,
      stderr: 'moov atom not found\n',
    }));
    const svc = new UploadContentCheckService(fakeStorage());
    svc.spawnFn = spawnFn;
    const v = await svc.check({
      storagePath: 't/a.mp4',
      mimeType: 'video/mp4',
      storedBytes: 0,
    });
    expect(v).toEqual(
      expect.objectContaining({
        accept: true,
        unchecked: expect.stringMatching(/switched off/),
      }),
    );
    expect(stats.calls).toHaveLength(0);
  });

  it('a definite ffprobe answer refuses without spending a decode', async () => {
    const { spawnFn, stats } = scriptedSpawn(() => ({
      code: 1,
      stderr: 'moov atom not found\nInvalid data found when processing input\n',
    }));
    const svc = new UploadContentCheckService(fakeStorage());
    svc.spawnFn = spawnFn;
    const v = await svc.check({
      storagePath: 't/a.mp4',
      mimeType: 'video/mp4',
      storedBytes: 53,
    });
    expect(v.accept).toBe(false);
    expect(stats.calls.map((c) => c.cmd)).toEqual(['ffprobe']);
    // ffprobe reads the object at the URL WE built.
    expect(stats.calls[0].args[stats.calls[0].args.length - 1]).toBe(
      `${PREFIX}t/a.mp4`,
    );
  });

  it('a healthy probe goes on to ONE end-of-file decode, 1.5 s before the end', async () => {
    const { spawnFn, stats } = scriptedSpawn((cmd) =>
      cmd === 'ffprobe'
        ? { code: 0, stdout: GOOD_PROBE }
        : { code: 0, stdout: ONE_FRAME },
    );
    const svc = new UploadContentCheckService(fakeStorage());
    svc.spawnFn = spawnFn;
    const v = await svc.check({
      storagePath: 't/a.mp4',
      mimeType: 'video/mp4',
      storedBytes: 9_000,
    });
    expect(v).toEqual(
      expect.objectContaining({ accept: true, unchecked: null }),
    );
    expect(stats.calls.map((c) => c.cmd)).toEqual(['ffprobe', 'ffmpeg']);
    expect(stats.calls[1].args).toEqual(
      expect.arrayContaining(['-ss', '2.500', '-frames:v', '1']),
    );
  });

  it('audio is one ffprobe, no decode', async () => {
    const { spawnFn, stats } = scriptedSpawn(() => ({
      code: 0,
      stdout: JSON.stringify({
        streams: [{ codec_type: 'audio', codec_name: 'mp3' }],
        format: { format_name: 'mp3' },
      }),
    }));
    const svc = new UploadContentCheckService(fakeStorage());
    svc.spawnFn = spawnFn;
    expect(
      (
        await svc.check({
          storagePath: 't/a.mp3',
          mimeType: 'audio/mpeg',
          storedBytes: 9,
        })
      ).accept,
    ).toBe(true);
    expect(stats.calls.map((c) => c.cmd)).toEqual(['ffprobe']);
  });

  it('ONE child at a time (UPLOAD_CHECK_MAX_PARALLEL, default 1), however many uploads finish at once', async () => {
    const { spawnFn, stats } = scriptedSpawn(
      (cmd) =>
        cmd === 'ffprobe'
          ? { code: 0, stdout: GOOD_PROBE }
          : { code: 0, stdout: ONE_FRAME },
      20,
    );
    const svc = new UploadContentCheckService(fakeStorage());
    svc.spawnFn = spawnFn;
    const verdicts = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        svc.check({
          storagePath: `t/${i}.mp4`,
          mimeType: 'video/mp4',
          storedBytes: 9,
        }),
      ),
    );
    expect(verdicts.every((v) => v.accept && v.unchecked === null)).toBe(true);
    expect(stats.calls).toHaveLength(16);
    expect(stats.maxLive).toBe(1);
    expect(svc.slots.max).toBe(1);
  });

  it('a file that waits past its budget for a slot is ACCEPTED as unchecked — never refused', async () => {
    const { spawnFn, stats } = scriptedSpawn(
      () => ({ code: 1, stderr: 'moov atom not found\n' }),
      300,
    );
    const svc = new UploadContentCheckService(fakeStorage());
    svc.spawnFn = spawnFn;
    svc.budgetMs = 100;
    // Another upload holds the only slot for longer than this file's whole
    // budget. (2026-10-05: this used to be raced with three checks whose
    // timers all fell due at ~100 ms; when the first child's kill timer fired
    // just before the third's wait timer, the third got the slot with nothing
    // left of its budget and read "ffprobe ran out of time" — about one run in
    // three on a loaded box. Holding the slot directly removes the race.)
    const release = await svc.slots.acquire(Date.now() + 5_000);
    try {
      const v = await svc.check({
        storagePath: 't/3.mp4',
        mimeType: 'video/mp4',
        storedBytes: 9,
      });
      expect(v).toEqual(
        expect.objectContaining({
          accept: true,
          unchecked: expect.stringMatching(/no free check slot/),
        }),
      );
      expect(stats.calls).toHaveLength(0); // it never forked a child
    } finally {
      release?.();
    }
  });

  it('an object URL outside the storage prefix is never handed to a tool', async () => {
    const { spawnFn, stats } = scriptedSpawn(() => ({
      code: 0,
      stdout: GOOD_PROBE,
    }));
    const svc = new UploadContentCheckService(
      fakeStorage({
        publicUrlForPath: (p: string) =>
          p ? `https://elsewhere.example/${p}` : PREFIX,
      }),
    );
    svc.spawnFn = spawnFn;
    const v = await svc.check({
      storagePath: 't/a.mp4',
      mimeType: 'video/mp4',
      storedBytes: 9,
    });
    expect(v).toEqual(
      expect.objectContaining({
        accept: true,
        unchecked: expect.stringMatching(/prefix/),
      }),
    );
    expect(stats.calls).toHaveLength(0);
  });

  it('a PDF is two small range reads — never a download', async () => {
    // 2026-10-05 — 64 KB at each end (the `/Encrypt` look); the header and the
    // %%EOF are still judged on the first 1 KB / last 4 KB of those.
    const size = 30 * 1024 * 1024;
    const storage = fakeStorage({
      readObjectRange: jest.fn(async (_p: string, start: number) =>
        Buffer.from(start === 0 ? '%PDF-1.4\n' : 'trailer\n%%EOF\n'),
      ),
    });
    const svc = new UploadContentCheckService(storage);
    const v = await svc.check({
      storagePath: 't/a.pdf',
      mimeType: 'application/pdf',
      storedBytes: size,
    });
    expect(v.accept).toBe(true);
    expect(
      storage.readObjectRange.mock.calls.map((c: unknown[]) => [c[1], c[2]]),
    ).toEqual([
      [0, 65_535],
      [size - 65_536, size - 1],
    ]);
  });

  it('a small PDF (≤ 64 KB) is ONE read of the whole file', async () => {
    const storage = fakeStorage({
      readObjectRange: jest.fn(async () => Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer\n%%EOF\n')),
    });
    const v = await new UploadContentCheckService(storage).check({
      storagePath: 't/a.pdf',
      mimeType: 'application/pdf',
      storedBytes: 50_000,
    });
    expect(v.accept).toBe(true);
    expect(storage.readObjectRange.mock.calls.map((c: unknown[]) => [c[1], c[2]])).toEqual([[0, 49_999]]);
  });

  it('a PDF that needs a password to open is refused in plain words; owner-password-only is accepted', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { readFileSync } = require('fs') as typeof import('fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { join } = require('path') as typeof import('path');
    const fx = (n: string) => readFileSync(join(__dirname, '../../test/fixtures/pdf-pages', n));
    for (const [name, accept] of [
      ['user-password-aes-256.pdf', false],
      ['user-password-rc4-40.pdf', false],
      ['owner-only-aes-256.pdf', true],
      ['three-pages.pdf', true],
    ] as const) {
      const bytes = fx(name);
      const storage = fakeStorage({
        readObjectRange: jest.fn(async (_p: string, start: number, end: number) => bytes.subarray(start, end + 1)),
      });
      const v = await new UploadContentCheckService(storage).check({
        storagePath: `t/${name}`,
        mimeType: 'application/pdf',
        storedBytes: bytes.length,
      });
      expect([name, v.accept]).toEqual([name, accept]);
      if (!v.accept) {
        expect(v.refusal).toEqual({
          code: 'ASSET_PDF_PASSWORD',
          reason: 'pdf-password',
          message: 'This PDF is password-protected. Remove the password and upload it again.',
        });
      }
    }
  });

  it('a big encrypted PDF is read whole only because it mentions /Encrypt — and then judged', async () => {
    const enc = readEnc();
    // The same bytes, padded to 200 KB in the middle (a comment), so the windows do not overlap.
    const pad = Buffer.alloc(200 * 1024, 0x20);
    const head = enc.subarray(0, 9);
    const big = Buffer.concat([head, Buffer.from('%'), pad, Buffer.from('\n'), enc.subarray(9)]);
    const storage = fakeStorage({
      readObjectRange: jest.fn(async (_p: string, start: number, end: number) => big.subarray(start, end + 1)),
    });
    const v = await new UploadContentCheckService(storage).check({
      storagePath: 't/big.pdf',
      mimeType: 'application/pdf',
      storedBytes: big.length,
    });
    expect(v.accept).toBe(false);
    expect(storage.readObjectRange.mock.calls.map((c: unknown[]) => [c[1], c[2]])).toEqual([
      [0, 65_535],
      [big.length - 65_536, big.length - 1],
      [0, big.length - 1],
    ]);
    function readEnc() {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const fs = require('fs');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const path = require('path');
      return fs.readFileSync(path.join(__dirname, '../../test/fixtures/pdf-pages/user-password-aes-128.pdf')) as Buffer;
    }
  });
});

// ── the whole check, against REAL files and the box's own tools ─────────────
if (!hasMediaTools) {
  console.warn(
    '[upload-content-check.service.spec] ffmpeg/ffprobe not found — the real-file cases are SKIPPED (the production image ships both).',
  );
}

(hasMediaTools ? describe : describe.skip)(
  'the check against REAL files over http (ffmpeg, ffprobe, sharp)',
  () => {
    jest.setTimeout(120_000);
    let dir = '';
    let corpus: UploadCorpus;
    const server = new CorpusServer();
    const mediaOpt = new MediaOptimizationService();
    let svc: UploadContentCheckService;

    beforeAll(async () => {
      dir = await makeCorpusDir();
      corpus = await buildUploadCorpus(dir);
      await server.start();
      for (const [name, f] of Object.entries(corpus))
        server.objects.set(`t/${name}${f.ext}`, f.bytes);
      svc = new UploadContentCheckService({
        publicUrlForPath: (p: string) => server.publicUrlForPath(p),
        readObjectRange: async (p: string, s: number, e: number) =>
          server.range(p, s, e),
      } as any);
    });
    afterAll(async () => {
      await server.stop();
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    });
    afterEach(() => {
      server.mode = 'normal';
    });

    /** Exactly what complete-upload hands the service for this file. */
    async function check(name: string) {
      const f = corpus[name];
      const storagePath = `t/${name}${f.ext}`;
      let image: { bytes: Buffer | null; optimization: any } | undefined;
      if (f.mime.startsWith('image/')) {
        const bytes = server.mode === 'normal' ? f.bytes : null;
        const optimization =
          bytes && mediaOpt.isUploadOptimizableImage(f.mime)
            ? await mediaOpt.optimizeImageForUpload(
                bytes,
                f.mime,
                f.ext,
                undefined,
                undefined,
                { convertNonScreenFormats: true },
              )
            : null;
        image = { bytes, optimization };
      }
      return svc.check({
        storagePath,
        mimeType: f.mime,
        storedBytes: f.bytes.length,
        image,
      });
    }

    it.each([
      ['good-mp4'],
      ['good-mp4-moov-last'],
      ['ts-as-mp4'],
      ['good-jpg'],
      ['good-png'],
      ['anim-gif'],
      ['good-bmp'],
      ['good-pdf'],
      ['good-m4a'],
    ])('ACCEPTS %s', async (name) => {
      const v = await check(name);
      expect(v).toEqual(
        expect.objectContaining({ accept: true, unchecked: null }),
      );
    });

    it('ACCEPTS a good MP3 (when this ffmpeg can write one)', async () => {
      if (!corpus['good-mp3']) return;
      expect(await check('good-mp3')).toEqual(
        expect.objectContaining({ accept: true, unchecked: null }),
      );
    });

    it('ACCEPTS a good WebM and REFUSES the same WebM cut at 90 % (when this ffmpeg has libvpx)', async () => {
      if (!corpus['good-webm']) return;
      expect(await check('good-webm')).toEqual(
        expect.objectContaining({ accept: true, unchecked: null }),
      );
      const cut = await check('trunc90-webm');
      expect(cut.accept).toBe(false);
      if (!cut.accept) expect(cut.refusal.reason).toBe('ends-early');
    });

    it.each([
      ['text-as-mp4', 'ASSET_VIDEO_UNPLAYABLE', 'not-video'],
      ['zip-as-mp4', 'ASSET_VIDEO_UNPLAYABLE', 'not-video'],
      ['trunc50-moov-first', 'ASSET_VIDEO_UNPLAYABLE', 'ends-early'],
      ['trunc90-moov-first', 'ASSET_VIDEO_UNPLAYABLE', 'ends-early'],
      ['trunc97-moov-first', 'ASSET_VIDEO_UNPLAYABLE', 'ends-early'],
      ['trunc50-moov-last', 'ASSET_VIDEO_UNPLAYABLE', 'not-video'],
      ['sound-only-as-mp4', 'ASSET_VIDEO_NO_PICTURE', 'no-picture'],
      ['jpeg-as-mp4', 'ASSET_VIDEO_IS_PICTURE', 'still-image'],
      ['mp4-as-png', 'ASSET_IMAGE_UNREADABLE', 'not-image'],
      ['text-as-jpg', 'ASSET_IMAGE_UNREADABLE', 'not-image'],
      ['html-as-jpg', 'ASSET_IMAGE_UNREADABLE', 'not-image'],
      ['text-as-gif', 'ASSET_IMAGE_UNREADABLE', 'not-image'],
      ['html-as-pdf', 'ASSET_PDF_NOT_PDF', 'not-pdf'],
      ['mp4-as-pdf', 'ASSET_PDF_NOT_PDF', 'not-pdf'],
      ['trunc-pdf', 'ASSET_PDF_INCOMPLETE', 'pdf-incomplete'],
      ['text-as-m4a', 'ASSET_AUDIO_UNPLAYABLE', 'not-audio'],
      ['video-only-as-m4a', 'ASSET_AUDIO_UNPLAYABLE', 'not-audio'],
    ])('REFUSES %s with %s', async (name, code, reason) => {
      const v = await check(name);
      expect(v.accept).toBe(false);
      if (!v.accept)
        expect([v.refusal.code, v.refusal.reason]).toEqual([code, reason]);
      // Bounded: the whole check is well inside its budget on a tiny file.
      expect(v.ms).toBeLessThan(12_000);
    });

    describe('the check could not run → ACCEPTED, never refused', () => {
      it.each([
        'good-mp4',
        'trunc50-moov-first',
        'text-as-mp4',
        'good-m4a',
        'trunc-pdf',
        'good-pdf',
        'text-as-jpg',
      ])('storage answers 500: %s is accepted as unchecked', async (name) => {
        server.mode = 'error500';
        const v = await check(name);
        expect(v).toEqual(
          expect.objectContaining({
            accept: true,
            unchecked: expect.any(String),
          }),
        );
      });

      it.each(['good-mp4', 'good-mp4-moov-last', 'good-m4a'])(
        'NEGATIVE CONTROL — the read drops mid-body: a GOOD %s is never refused',
        async (name) => {
          server.mode = 'cut';
          const v = await check(name);
          expect(v.accept).toBe(true);
        },
      );

      it('nothing listens at the storage address: accepted as unchecked', async () => {
        const dead = new UploadContentCheckService({
          publicUrlForPath: (p: string) =>
            `http://127.0.0.1:9/storage/v1/object/public/assets/${p}`,
          readObjectRange: async () => null,
        } as any);
        for (const name of ['good-mp4', 'text-as-mp4']) {
          const f = corpus[name];
          const v = await dead.check({
            storagePath: `t/${name}${f.ext}`,
            mimeType: f.mime,
            storedBytes: f.bytes.length,
          });
          expect(v).toEqual(
            expect.objectContaining({
              accept: true,
              unchecked: expect.any(String),
            }),
          );
        }
      });

      it('ffprobe / ffmpeg missing on the box: accepted as unchecked', async () => {
        const noTools = new UploadContentCheckService({
          publicUrlForPath: (p: string) => server.publicUrlForPath(p),
        } as any);
        noTools.spawnFn = ((cmd: string, args: string[], opts: any) =>
          nodeSpawn(
            `${cmd}-missing-on-this-box`,
            args,
            opts,
          )) as unknown as typeof nodeSpawn;
        const v = await noTools.check({
          storagePath: 't/text-as-mp4.mp4',
          mimeType: 'video/mp4',
          storedBytes: 40,
        });
        expect(v).toEqual(
          expect.objectContaining({
            accept: true,
            unchecked: expect.stringMatching(/could not start/),
          }),
        );
      });
    });
  },
);
