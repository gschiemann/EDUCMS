/**
 * The in-browser MP4 reader: builds real ISO BMFF box structures in memory
 * and checks the facts the grade needs come out — codec, profile/level,
 * size, frame rate, audio, bitrate, and whether the index (moov) leads or
 * trails the media (fast start).
 */
import { inspectVideoFile, MOOV_READ_CAP, type InspectableBlob } from '../mp4-inspect';

// ── tiny box builder ───────────────────────────────────────────────────────
// jsdom has no TextEncoder; the box types are ASCII, so a byte per char is exact.
const enc = { encode: (str: string) => Uint8Array.from(str, (c) => c.charCodeAt(0)) };
function u32(n: number): number[] {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
}
function u16(n: number): number[] {
  return [(n >>> 8) & 255, n & 255];
}
function box(type: string, ...parts: Array<number[] | Uint8Array>): Uint8Array {
  const body = concat(parts.map((p) => (p instanceof Uint8Array ? p : Uint8Array.from(p))));
  return concat([Uint8Array.from(u32(8 + body.length)), enc.encode(type), body]);
}
function concat(arrs: Uint8Array[]): Uint8Array {
  const len = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const a of arrs) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}
const zeros = (n: number) => new Array<number>(n).fill(0);

function ftyp() {
  return box('ftyp', enc.encode('isom'), u32(512), enc.encode('isomiso2avc1mp41'));
}
function mdat(bytes: number) {
  return box('mdat', zeros(bytes));
}
function mvhd(timescale: number, duration: number) {
  return box('mvhd', [0, 0, 0, 0], u32(0), u32(0), u32(timescale), u32(duration), zeros(80));
}
function mdhd(timescale: number, duration: number) {
  return box('mdhd', [0, 0, 0, 0], u32(0), u32(0), u32(timescale), u32(duration), u16(0), u16(0));
}
function hdlr(kind: string) {
  return box('hdlr', [0, 0, 0, 0], u32(0), enc.encode(kind), zeros(12), [0]);
}
function stts(entries: Array<[count: number, delta: number]>) {
  return box('stts', [0, 0, 0, 0], u32(entries.length), ...entries.map(([c, d]) => [...u32(c), ...u32(d)]));
}
function avc1(width: number, height: number, profile: number, level: number) {
  const avcC = box('avcC', [1, profile, 0, level, 0xff, 0xe1, 0, 0, 1, 0]);
  return box('avc1', zeros(6), u16(1), zeros(16), u16(width), u16(height), u32(0x00480000), u32(0x00480000), u32(0), u16(1), zeros(32), u16(24), u16(0xffff), avcC);
}
function hvc1(width: number, height: number, profile: number, level: number) {
  const hvcC = box('hvcC', [1, profile, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, level, 0xf0, 0, 0xfc, 0xfd, 0xf8, 0xf8, 0, 0, 0x0f, 0]);
  return box('hvc1', zeros(6), u16(1), zeros(16), u16(width), u16(height), u32(0x00480000), u32(0x00480000), u32(0), u16(1), zeros(32), u16(24), u16(0xffff), hvcC);
}
function mp4a(channels: number, sampleRate: number) {
  return box('mp4a', zeros(6), u16(1), zeros(8), u16(channels), u16(16), u32(0), u32(sampleRate << 16));
}
function stsd(entry: Uint8Array) {
  return box('stsd', [0, 0, 0, 0], u32(1), entry);
}
function trak(kind: 'vide' | 'soun', timescale: number, duration: number, entry: Uint8Array, sttsEntries: Array<[number, number]>) {
  return box('trak', box('mdia', mdhd(timescale, duration), hdlr(kind), box('minf', box('stbl', stsd(entry), stts(sttsEntries)))));
}
function moov(...traks: Uint8Array[]) {
  return box('moov', mvhd(1000, 71_000), ...traks);
}
function blobOf(bytes: Uint8Array): InspectableBlob {
  return {
    size: bytes.length,
    slice: (start: number, end?: number) => ({
      arrayBuffer: () => Promise.resolve(bytes.slice(start, end).buffer),
    }),
  };
}

// 71 s of 30 fps video: 2130 frames at a 30000 timescale, 1001-tick deltas (29.97).
const VIDEO_30 = trak('vide', 30_000, 2_130 * 1_001, avc1(1280, 720, 100, 31), [[2_130, 1_001]]);
const AUDIO = trak('soun', 48_000, 71 * 48_000, mp4a(2, 48_000), [[3_328, 1_024]]);

describe('inspectVideoFile', () => {
  it('reads a fast-start MP4: codec, profile/level, size, frame rate, audio, index at the front, bitrate from size ÷ duration', async () => {
    const file = concat([ftyp(), moov(VIDEO_30, AUDIO), mdat(48_800_000 - 2_000)]);
    const out = await inspectVideoFile(blobOf(file));
    expect(out.container).toBe('mp4');
    expect(out.facts).toMatchObject({
      codec: 'h264',
      profile: 'High',
      level: 31,
      pixFmt: 'yuv420p',
      width: 1280,
      height: 720,
      fps: 29.97,
      variableFrameRate: false,
      fastStart: true,
      container: 'mov,mp4,m4a,3gp,3g2,mj2',
      audio: { codec: 'aac', channels: 2, sampleRate: 48_000 },
    });
    // 48.8 MB over 71 s ≈ 5,500 kbps.
    expect(out.facts.bitrateKbps).toBeGreaterThan(5_400);
    expect(out.facts.bitrateKbps).toBeLessThan(5_600);
  });

  it('sees the index at the END of the file when mdat comes first — the 720p clip that stuttered', async () => {
    const file = concat([ftyp(), mdat(1_000_000), moov(VIDEO_30, AUDIO)]);
    const out = await inspectVideoFile(blobOf(file));
    expect(out.facts.fastStart).toBe(false);
    expect(out.facts.codec).toBe('h264');
    expect(out.facts.width).toBe(1280);
  });

  it('reads HEVC Main 10 as 10-bit, and a 60 fps track with a mixed cadence as variable', async () => {
    const vfr = trak('vide', 60_000, 3_000 * 1_000, hvc1(3840, 2160, 2, 153), [[2_000, 1_000], [1_000, 1_100]]);
    const out = await inspectVideoFile(blobOf(concat([ftyp(), moov(vfr), mdat(10)])));
    expect(out.facts).toMatchObject({ codec: 'hevc', profile: 'Main 10', pixFmt: 'yuv420p10le', level: 153, width: 3840, height: 2160, variableFrameRate: true });
    expect(out.facts.fps).toBe(60);
  });

  it('never reads the media: only the headers and the moov are sliced', async () => {
    const file = concat([ftyp(), mdat(50_000_000), moov(VIDEO_30)]);
    const blob = blobOf(file);
    const reads: Array<[number, number]> = [];
    const spy: InspectableBlob = {
      size: blob.size,
      slice: (s, e) => {
        reads.push([s, e ?? blob.size]);
        return blob.slice(s, e);
      },
    };
    await inspectVideoFile(spy);
    const largest = Math.max(...reads.map(([s, e]) => e - s));
    expect(largest).toBeLessThan(2_000);
    expect(reads.every(([s, e]) => e - s <= MOOV_READ_CAP)).toBe(true);
  });

  it('recognises WebM by magic and reports only the container', async () => {
    const out = await inspectVideoFile(blobOf(Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0])));
    expect(out).toEqual({ container: 'matroska,webm', facts: expect.objectContaining({ container: 'matroska,webm', codec: null, fastStart: null }) });
  });

  it('is unknown, never a throw, for something that is not a video container or is truncated', async () => {
    expect((await inspectVideoFile(blobOf(enc.encode('GIF89a......')))).container).toBeNull();
    expect((await inspectVideoFile(blobOf(new Uint8Array(3)))).container).toBeNull();
    const truncated = concat([ftyp(), Uint8Array.from(u32(5_000_000)), enc.encode('moov'), Uint8Array.from(zeros(20))]);
    const out = await inspectVideoFile(blobOf(truncated));
    expect(out.container).toBe('mp4');
    expect(out.facts.codec).toBeNull();
    const failing: InspectableBlob = { size: 100, slice: () => ({ arrayBuffer: () => Promise.reject(new Error('io')) }) };
    expect((await inspectVideoFile(failing)).container).toBeNull();
  });
});
