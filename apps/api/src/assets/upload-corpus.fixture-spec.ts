/**
 * Test-only fixture for the upload content check (2026-10-05). Named
 * `*.fixture-spec.ts` so the build leaves it out (`**\/*spec.ts`) and Jest does
 * not run it as a suite (`.spec.ts` only).
 *
 *   • `buildUploadCorpus` makes TINY REAL files with the box's own ffmpeg —
 *     never committed binaries — the same classes the media beta test uploaded
 *     (docs/research/2026-10-04-media-matrix/limits-findings.md PART A): good
 *     MP4s (index first and last), the same cut at 50 / 90 %, sound-only, a
 *     picture / text / ZIP named .mp4, MP4 bytes named .png, HTML named .jpg
 *     and .pdf, a cut-off PDF, and good JPEG / PNG / animated GIF / BMP / audio /
 *     PDF controls.
 *   • `CorpusServer` serves them over http the way Supabase Storage does — byte
 *     ranges, 206, 416 past the end — and can misbehave on purpose: answer 500,
 *     or drop the connection a third of the way into the body, which is what
 *     proves the check never refuses a GOOD file over a bad read.
 */
import { execFileSync } from 'child_process';
import { promises as fs } from 'fs';
import * as http from 'http';
import type { AddressInfo } from 'net';
import * as os from 'os';
import * as path from 'path';

export const hasMediaTools = (() => {
  try {
    execFileSync('ffmpeg', ['-hide_banner', '-version'], { stdio: 'ignore' });
    execFileSync('ffprobe', ['-hide_banner', '-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

function hasEncoder(name: string): boolean {
  if (!hasMediaTools) return false;
  try {
    return execFileSync('ffmpeg', ['-hide_banner', '-encoders'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .split('\n')
      .some((line) => line.trim().split(/\s+/)[1] === name);
  } catch {
    return false;
  }
}

export interface CorpusFile {
  /** What the browser would declare for its name. */
  mime: string;
  /** Extension the upload path carries. */
  ext: string;
  bytes: Buffer;
}

/** Every file, by case name. */
export type UploadCorpus = Record<string, CorpusFile>;

/** A minimal, valid one-page PDF (an empty page) with a correct xref table. */
export function minimalPdf(): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 320 240] >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(body, 'latin1'));
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets)
    body += `${String(off).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

/**
 * Build the corpus in `dir`. Videos carry moving noise so a cut lands inside
 * picture data, the way a real interrupted upload does.
 */
export async function buildUploadCorpus(dir: string): Promise<UploadCorpus> {
  const ff = (args: string[]) =>
    execFileSync('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      ...args,
    ]);
  const file = (name: string) => path.join(dir, name);
  const vcodec = hasEncoder('libx264')
    ? ['-c:v', 'libx264', '-preset', 'ultrafast', '-g', '25']
    : ['-c:v', 'mpeg4', '-g', '25'];
  const acodec = ['-c:a', 'aac'];
  const src = [
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=320x240:rate=25,noise=alls=40:allf=t',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:sample_rate=48000',
    '-t',
    '4',
    '-map',
    '0:v',
    '-map',
    '1:a',
    ...vcodec,
    '-pix_fmt',
    'yuv420p',
    '-b:v',
    '600k',
    ...acodec,
  ];
  ff([...src, '-movflags', '+faststart', file('good.mp4')]);
  ff([...src, file('good-moovlast.mp4')]);
  // MPEG-TS (no index; ffmpeg's muxer starts its timestamps at ~1.4 s, like the
  // corpus file codec-name-ts-h264-bytes.mp4), later uploaded under a .mp4 name.
  ff([...src, '-f', 'mpegts', file('good.ts')]);
  ff([
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=330:sample_rate=48000',
    '-t',
    '2',
    ...acodec,
    file('sound-only.mp4'),
  ]);
  ff([
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=320x240:rate=25',
    '-frames:v',
    '1',
    file('good.jpg'),
  ]);
  ff([
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=320x240:rate=25',
    '-frames:v',
    '1',
    file('good.png'),
  ]);
  ff([
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=160x120:rate=5',
    '-t',
    '1',
    file('anim.gif'),
  ]);
  ff([
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=64x48:rate=25',
    '-frames:v',
    '1',
    file('good.bmp'),
  ]);
  ff([
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=320x240:rate=25',
    '-t',
    '2',
    ...vcodec,
    '-pix_fmt',
    'yuv420p',
    '-an',
    file('picture-only.mp4'),
  ]);
  const mp3 = hasEncoder('libmp3lame');
  if (mp3)
    ff([
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=44100',
      '-t',
      '2',
      '-c:a',
      'libmp3lame',
      file('good.mp3'),
    ]);
  const vpx = hasEncoder('libvpx-vp9')
    ? 'libvpx-vp9'
    : hasEncoder('libvpx')
      ? 'libvpx'
      : null;
  if (vpx) {
    ff([
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=320x240:rate=25,noise=alls=40:allf=t',
      '-t',
      '4',
      '-c:v',
      vpx,
      '-deadline',
      'realtime',
      '-b:v',
      '600k',
      '-g',
      '25',
      '-an',
      file('good.webm'),
    ]);
  }

  const read = (n: string) => fs.readFile(file(n));
  const goodMp4 = await read('good.mp4');
  const moovLast = await read('good-moovlast.mp4');
  const pdf = minimalPdf();
  const html = Buffer.from(
    '<!doctype html><html><body>not media</body></html>\n',
  );
  const corpus: UploadCorpus = {
    // ── controls: every one of these must be ACCEPTED ──
    'good-mp4': { mime: 'video/mp4', ext: '.mp4', bytes: goodMp4 },
    'good-mp4-moov-last': { mime: 'video/mp4', ext: '.mp4', bytes: moovLast },
    // A real video in a container with no index under a .mp4 name: converted later, never refused here.
    'ts-as-mp4': {
      mime: 'video/mp4',
      ext: '.mp4',
      bytes: await read('good.ts'),
    },
    'good-jpg': {
      mime: 'image/jpeg',
      ext: '.jpg',
      bytes: await read('good.jpg'),
    },
    'good-png': {
      mime: 'image/png',
      ext: '.png',
      bytes: await read('good.png'),
    },
    'anim-gif': {
      mime: 'image/gif',
      ext: '.gif',
      bytes: await read('anim.gif'),
    },
    'good-bmp': {
      mime: 'image/bmp',
      ext: '.bmp',
      bytes: await read('good.bmp'),
    },
    'good-pdf': { mime: 'application/pdf', ext: '.pdf', bytes: pdf },
    // An AAC track in an .m4a is the audio control that every ffmpeg build can write.
    'good-m4a': {
      mime: 'audio/mp4',
      ext: '.m4a',
      bytes: await read('sound-only.mp4'),
    },
    // ── must be REFUSED ──
    'text-as-mp4': {
      mime: 'video/mp4',
      ext: '.mp4',
      bytes: Buffer.from('this is a text file, not a video at all\n'),
    },
    'zip-as-mp4': {
      mime: 'video/mp4',
      ext: '.mp4',
      bytes: Buffer.concat([
        Buffer.from([0x50, 0x4b, 0x03, 0x04]),
        Buffer.alloc(200, 0x41),
      ]),
    },
    'trunc50-moov-first': {
      mime: 'video/mp4',
      ext: '.mp4',
      bytes: goodMp4.subarray(0, Math.floor(goodMp4.length * 0.5)),
    },
    'trunc90-moov-first': {
      mime: 'video/mp4',
      ext: '.mp4',
      bytes: goodMp4.subarray(0, Math.floor(goodMp4.length * 0.9)),
    },
    // Cut INSIDE the last second: the frame 1.5 s before the end still decodes.
    'trunc97-moov-first': {
      mime: 'video/mp4',
      ext: '.mp4',
      bytes: goodMp4.subarray(0, Math.floor(goodMp4.length * 0.97)),
    },
    'trunc50-moov-last': {
      mime: 'video/mp4',
      ext: '.mp4',
      bytes: moovLast.subarray(0, Math.floor(moovLast.length * 0.5)),
    },
    'sound-only-as-mp4': {
      mime: 'video/mp4',
      ext: '.mp4',
      bytes: await read('sound-only.mp4'),
    },
    'jpeg-as-mp4': {
      mime: 'video/mp4',
      ext: '.mp4',
      bytes: await read('good.jpg'),
    },
    'mp4-as-png': { mime: 'image/png', ext: '.png', bytes: goodMp4 },
    'text-as-jpg': {
      mime: 'image/jpeg',
      ext: '.jpg',
      bytes: Buffer.from('not a picture\n'),
    },
    'html-as-jpg': { mime: 'image/jpeg', ext: '.jpg', bytes: html },
    'text-as-gif': {
      mime: 'image/gif',
      ext: '.gif',
      bytes: Buffer.from('GIF? no — plain text\n'),
    },
    'html-as-pdf': { mime: 'application/pdf', ext: '.pdf', bytes: html },
    'mp4-as-pdf': { mime: 'application/pdf', ext: '.pdf', bytes: goodMp4 },
    'trunc-pdf': {
      mime: 'application/pdf',
      ext: '.pdf',
      bytes: pdf.subarray(0, Math.floor(pdf.length * 0.6)),
    },
    'text-as-m4a': {
      mime: 'audio/mp4',
      ext: '.m4a',
      bytes: Buffer.from('not audio either\n'),
    },
    'video-only-as-m4a': {
      mime: 'audio/mp4',
      ext: '.m4a',
      bytes: await read('picture-only.mp4'),
    },
  };
  if (mp3)
    corpus['good-mp3'] = {
      mime: 'audio/mpeg',
      ext: '.mp3',
      bytes: await read('good.mp3'),
    };
  if (vpx) {
    const webm = await read('good.webm');
    corpus['good-webm'] = { mime: 'video/webm', ext: '.webm', bytes: webm };
    corpus['trunc90-webm'] = {
      mime: 'video/webm',
      ext: '.webm',
      bytes: webm.subarray(0, Math.floor(webm.length * 0.9)),
    };
  }
  return corpus;
}

export async function makeCorpusDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'edu-upload-corpus-'));
}

/** How the server misbehaves for the "the check could not run" cases. */
export type ServeMode = 'normal' | 'error500' | 'cut';

/**
 * A storage stand-in on 127.0.0.1 with S3 Range semantics. Objects are
 * registered by their bucket path; URLs are `<base>/storage/v1/object/public/assets/<path>`.
 */
export class CorpusServer {
  mode: ServeMode = 'normal';
  readonly objects = new Map<string, Buffer>();
  private server: http.Server | null = null;
  base = '';

  async start(): Promise<void> {
    this.server = http.createServer((req, res) => this.handle(req, res));
    await new Promise<void>((resolve) =>
      this.server!.listen(0, '127.0.0.1', () => resolve()),
    );
    this.base = `http://127.0.0.1:${(this.server!.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = null;
  }

  publicUrlForPath(p: string): string {
    return `${this.base}/storage/v1/object/public/assets/${p}`;
  }

  /** The bytes a Range read of the registered object returns (what the service's storage call yields). */
  range(p: string, start: number, endInclusive: number): Buffer | null {
    if (this.mode !== 'normal') return null;
    const buf = this.objects.get(p);
    if (!buf || start >= buf.length) return null;
    return buf.subarray(start, Math.min(buf.length, endInclusive + 1));
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const prefix = '/storage/v1/object/public/assets/';
    const url = decodeURIComponent((req.url || '').split('?')[0]);
    const buf = url.startsWith(prefix)
      ? this.objects.get(url.slice(prefix.length))
      : undefined;
    if (!buf) {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    if (this.mode === 'error500') {
      res.statusCode = 500;
      res.end('storage is having a bad day');
      return;
    }
    const size = buf.length;
    let start = 0;
    let end = size - 1;
    let status = 200;
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
    if (m) {
      if (m[1] === '') start = Math.max(0, size - Number(m[2]));
      else {
        start = Number(m[1]);
        if (m[2] !== '') end = Math.min(size - 1, Number(m[2]));
      }
      if (start >= size) {
        res.statusCode = 416;
        res.setHeader('Content-Range', `bytes */${size}`);
        res.end();
        return;
      }
      status = 206;
    }
    const body = buf.subarray(start, end + 1);
    res.statusCode = status;
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', String(body.length));
    if (status === 206)
      res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    if (this.mode === 'cut') {
      // Headers and a third of the body, then the connection drops.
      res.flushHeaders();
      res.write(body.subarray(0, Math.floor(body.length / 3)), () =>
        setTimeout(() => res.destroy(), 30),
      );
      return;
    }
    res.end(body);
  }
}
