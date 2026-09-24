/**
 * mp4-inspect.ts — read a video's encode facts from the FILE, in the browser,
 * before a single byte is uploaded.
 *
 * Greg, 2026-09-24: "shouldnt we show something on the upload window so they
 * see it right away? is there anyway to catch this before they upload?"
 * There is. An MP4/MOV (ISO base media file) keeps everything the grade needs
 * in its `moov` box — codec and profile/level, frame size, frame count and
 * timescale (frame rate), the audio track — and whether that box sits at the
 * FRONT of the file (fast start) or the END is exactly the first thing the
 * box walk finds out. So the upload queue can show the verdict the moment a
 * file is dropped; the server's ffprobe pass confirms it after the upload.
 *
 * Reads are BOUNDED: 16-byte box headers walked with `Blob.slice`, then the
 * `moov` box itself (a few hundred KB even for a long clip; capped at 16 MB).
 * The media data is never read. Never throws — anything unreadable returns
 * facts with nulls, and a null fact never counts against a file.
 *
 * Pure over a `Blob`-like `{ size, slice() }`, so it is unit-tested with
 * synthetic box structures and needs no browser video stack.
 */
import type { VideoEncodeFacts } from '@cms/api-types';

export interface InspectableBlob {
  size: number;
  slice(start: number, end?: number): { arrayBuffer(): Promise<ArrayBuffer> };
}

/** The most `moov` we will read. A normal moov is well under 1 MB. */
export const MOOV_READ_CAP = 16 * 1024 * 1024;
/** The most top-level boxes we will walk before giving up on a strange file. */
const MAX_TOP_LEVEL_BOXES = 64;

export interface Mp4Inspection {
  /** 'mp4' (ISO BMFF, incl. MOV), 'matroska,webm', or null when unrecognised. */
  container: 'mp4' | 'matroska,webm' | null;
  facts: VideoEncodeFacts;
}

const EMPTY: VideoEncodeFacts = {
  codec: null,
  profile: null,
  level: null,
  pixFmt: null,
  width: null,
  height: null,
  fps: null,
  variableFrameRate: null,
  bitrateKbps: null,
  fastStart: null,
  container: null,
  audio: null,
};

async function readRange(blob: InspectableBlob, start: number, end: number): Promise<DataView | null> {
  if (start < 0 || end <= start || start >= blob.size) return null;
  try {
    const buf = await blob.slice(start, Math.min(end, blob.size)).arrayBuffer();
    return new DataView(buf);
  } catch {
    return null;
  }
}

function fourcc(view: DataView, offset: number): string {
  if (offset + 4 > view.byteLength) return '';
  return String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
}

/** Box header at `offset` inside `view`: total size (0 = to end), type, header length. */
function boxHeader(view: DataView, offset: number, remaining: number): { size: number; type: string; header: number } | null {
  if (offset + 8 > view.byteLength) return null;
  let size = view.getUint32(offset);
  const type = fourcc(view, offset + 4);
  let header = 8;
  if (size === 1) {
    if (offset + 16 > view.byteLength) return null;
    const hi = view.getUint32(offset + 8);
    const lo = view.getUint32(offset + 12);
    size = hi * 4294967296 + lo;
    header = 16;
  } else if (size === 0) {
    size = remaining;
  }
  if (!/^[\x20-\x7e]{4}$/.test(type) || size < header) return null;
  return { size, type, header };
}

/**
 * Inspect a file. Recognises ISO BMFF (MP4 / MOV / M4V / 3GP) and Matroska /
 * WebM by their magic; anything else is `container: null` with empty facts.
 */
export async function inspectVideoFile(blob: InspectableBlob): Promise<Mp4Inspection> {
  const head = await readRange(blob, 0, 16);
  if (!head || head.byteLength < 8) return { container: null, facts: { ...EMPTY } };

  // Matroska / WebM: EBML magic. We do not parse it — the container alone is
  // the finding (MP4 plays most reliably).
  if (head.getUint32(0) === 0x1a45dfa3) {
    return { container: 'matroska,webm', facts: { ...EMPTY, container: 'matroska,webm' } };
  }

  const first = boxHeader(head, 0, blob.size);
  if (!first || first.type !== 'ftyp') return { container: null, facts: { ...EMPTY } };

  // Walk the top-level boxes: where is moov, and does mdat come before it?
  let offset = 0;
  let sawMdat = false;
  let moov: { start: number; size: number } | null = null;
  for (let i = 0; i < MAX_TOP_LEVEL_BOXES && offset + 8 <= blob.size; i++) {
    const hv = await readRange(blob, offset, offset + 16);
    if (!hv) break;
    const h = boxHeader(hv, 0, blob.size - offset);
    if (!h) break;
    if (h.type === 'mdat') sawMdat = true;
    if (h.type === 'moov') {
      moov = { start: offset, size: h.size };
      break;
    }
    offset += h.size;
  }

  const facts: VideoEncodeFacts = { ...EMPTY, container: 'mov,mp4,m4a,3gp,3g2,mj2' };
  if (!moov) return { container: 'mp4', facts };
  facts.fastStart = !sawMdat;

  if (moov.size > MOOV_READ_CAP) return { container: 'mp4', facts };
  const mv = await readRange(blob, moov.start, moov.start + moov.size);
  if (!mv) return { container: 'mp4', facts };
  try {
    parseMoov(mv, facts, blob.size);
  } catch {
    /* a malformed moov leaves whatever was parsed so far; nulls never count */
  }
  return { container: 'mp4', facts };
}

// ── moov parsing ────────────────────────────────────────────────────────────

interface Box {
  type: string;
  start: number; // payload start
  end: number; // payload end (exclusive)
}

/** Children of the box whose payload spans [start, end). */
function children(view: DataView, start: number, end: number): Box[] {
  const out: Box[] = [];
  let o = start;
  while (o + 8 <= end) {
    const h = boxHeader(view, o, end - o);
    if (!h || o + h.size > end) break;
    out.push({ type: h.type, start: o + h.header, end: o + h.size });
    o += h.size;
  }
  return out;
}

function child(view: DataView, box: Box, type: string): Box | undefined {
  return children(view, box.start, box.end).find((b) => b.type === type);
}

interface TrackFacts {
  handler: 'vide' | 'soun' | string;
  timescale: number;
  duration: number;
  sampleCount: number;
  /** Distinct sample deltas in stts (for the variable-frame-rate call). */
  deltas: number[];
  entryType: string;
  width: number | null;
  height: number | null;
  avcProfile: number | null;
  avcLevel: number | null;
  hevcProfile: number | null;
  hevcLevel: number | null;
  channels: number | null;
  sampleRate: number | null;
  audioCodec: string | null;
}

function parseMoov(view: DataView, facts: VideoEncodeFacts, fileSize: number): void {
  const root: Box = { type: 'moov', start: 8, end: view.byteLength };
  // The moov header may be a 64-bit box; the caller sliced from the box start.
  const hdr = boxHeader(view, 0, view.byteLength);
  if (hdr) root.start = hdr.header;

  let movieDurationS: number | null = null;
  const mvhd = child(view, root, 'mvhd');
  if (mvhd) {
    const version = view.getUint8(mvhd.start);
    if (version === 1) {
      const timescale = view.getUint32(mvhd.start + 20);
      const dur = view.getUint32(mvhd.start + 24) * 4294967296 + view.getUint32(mvhd.start + 28);
      if (timescale > 0) movieDurationS = dur / timescale;
    } else {
      const timescale = view.getUint32(mvhd.start + 12);
      const dur = view.getUint32(mvhd.start + 16);
      if (timescale > 0) movieDurationS = dur / timescale;
    }
  }

  const tracks = children(view, root.start, root.end)
    .filter((b) => b.type === 'trak')
    .map((t) => parseTrak(view, t))
    .filter((t): t is TrackFacts => !!t);

  const video = tracks.find((t) => t.handler === 'vide');
  const audio = tracks.find((t) => t.handler === 'soun');

  if (video) {
    facts.codec = codecName(video.entryType);
    facts.width = video.width;
    facts.height = video.height;
    if (video.avcProfile != null) {
      facts.profile = avcProfileName(video.avcProfile);
      facts.pixFmt = avcPixFmt(video.avcProfile);
    }
    if (video.avcLevel != null) facts.level = video.avcLevel;
    if (video.hevcProfile != null) {
      facts.profile = hevcProfileName(video.hevcProfile);
      facts.pixFmt = video.hevcProfile === 2 ? 'yuv420p10le' : 'yuv420p';
    }
    if (video.hevcLevel != null) facts.level = video.hevcLevel;
    const durS = video.timescale > 0 ? video.duration / video.timescale : 0;
    if (durS > 0 && video.sampleCount > 0) facts.fps = Math.round((video.sampleCount / durS) * 1000) / 1000;
    if (video.deltas.length > 0) {
      const min = Math.min(...video.deltas);
      const max = Math.max(...video.deltas);
      // Two distinct deltas more than half a percent apart = variable.
      facts.variableFrameRate = video.deltas.length > 1 && max - min > min * 0.005;
    }
  }

  if (audio) {
    facts.audio = { codec: audio.audioCodec, channels: audio.channels, sampleRate: audio.sampleRate };
  }

  const durationS = movieDurationS ?? (video && video.timescale > 0 ? video.duration / video.timescale : null);
  if (durationS && durationS > 0 && fileSize > 0) {
    facts.bitrateKbps = Math.round((fileSize * 8) / durationS / 1000);
  }
}

function parseTrak(view: DataView, trak: Box): TrackFacts | null {
  const mdia = child(view, trak, 'mdia');
  if (!mdia) return null;
  const hdlr = child(view, mdia, 'hdlr');
  const handler = hdlr ? fourcc(view, hdlr.start + 8) : '';
  const mdhd = child(view, mdia, 'mdhd');
  let timescale = 0;
  let duration = 0;
  if (mdhd) {
    const version = view.getUint8(mdhd.start);
    if (version === 1) {
      timescale = view.getUint32(mdhd.start + 20);
      duration = view.getUint32(mdhd.start + 24) * 4294967296 + view.getUint32(mdhd.start + 28);
    } else {
      timescale = view.getUint32(mdhd.start + 12);
      duration = view.getUint32(mdhd.start + 16);
    }
  }
  const minf = child(view, mdia, 'minf');
  const stbl = minf ? child(view, minf, 'stbl') : undefined;
  const out: TrackFacts = {
    handler,
    timescale,
    duration,
    sampleCount: 0,
    deltas: [],
    entryType: '',
    width: null,
    height: null,
    avcProfile: null,
    avcLevel: null,
    hevcProfile: null,
    hevcLevel: null,
    channels: null,
    sampleRate: null,
    audioCodec: null,
  };
  if (!stbl) return out;

  const stts = child(view, stbl, 'stts');
  if (stts) {
    const count = view.getUint32(stts.start + 4);
    let total = 0;
    const deltas = new Set<number>();
    for (let i = 0; i < count && stts.start + 8 + i * 8 + 8 <= stts.end; i++) {
      const n = view.getUint32(stts.start + 8 + i * 8);
      const d = view.getUint32(stts.start + 12 + i * 8);
      total += n;
      // A single trailing sample with an odd delta is normal; only count runs.
      if (n > 1 || count === 1) deltas.add(d);
    }
    out.sampleCount = total;
    out.deltas = [...deltas];
  }

  const stsd = child(view, stbl, 'stsd');
  if (stsd) {
    const entries = children(view, stsd.start + 8, stsd.end);
    const entry = entries[0];
    if (entry) {
      out.entryType = entry.type;
      if (handler === 'vide') {
        // VisualSampleEntry: 6 reserved + 2 data_reference_index + 16 pre-defined/reserved, then width/height.
        out.width = view.getUint16(entry.start + 24);
        out.height = view.getUint16(entry.start + 26);
        // The codec-specific boxes follow the 78-byte visual sample entry.
        const inner = children(view, entry.start + 78, entry.end);
        const avcC = inner.find((b) => b.type === 'avcC');
        if (avcC) {
          out.avcProfile = view.getUint8(avcC.start + 1);
          out.avcLevel = view.getUint8(avcC.start + 3);
        }
        const hvcC = inner.find((b) => b.type === 'hvcC');
        if (hvcC) {
          out.hevcProfile = view.getUint8(hvcC.start + 1) & 0x1f;
          out.hevcLevel = view.getUint8(hvcC.start + 12);
        }
      } else if (handler === 'soun') {
        // AudioSampleEntry: 6 reserved + 2 dri + 8 reserved, channelcount(2), samplesize(2), 4 reserved, samplerate (16.16).
        out.channels = view.getUint16(entry.start + 16);
        out.sampleRate = view.getUint32(entry.start + 24) >>> 16;
        out.audioCodec = audioCodecName(entry.type);
      }
    }
  }
  return out;
}

function codecName(entryType: string): string | null {
  switch (entryType) {
    case 'avc1':
    case 'avc3':
      return 'h264';
    case 'hvc1':
    case 'hev1':
      return 'hevc';
    case 'av01':
      return 'av1';
    case 'vp09':
      return 'vp9';
    case 'vp08':
      return 'vp8';
    case 'mp4v':
      return 'mpeg4';
    case 'apch':
    case 'apcn':
    case 'apcs':
    case 'apco':
    case 'ap4h':
      return 'prores';
    case 'jpeg':
      return 'mjpeg';
    default:
      return entryType ? entryType.toLowerCase() : null;
  }
}

function audioCodecName(entryType: string): string | null {
  switch (entryType) {
    case 'mp4a':
      return 'aac';
    case 'ac-3':
      return 'ac3';
    case 'ec-3':
      return 'eac3';
    case 'Opus':
      return 'opus';
    case 'fLaC':
      return 'flac';
    case 'alac':
      return 'alac';
    case 'lpcm':
    case 'sowt':
    case 'twos':
      return 'pcm';
    default:
      return entryType ? entryType.toLowerCase() : null;
  }
}

function avcProfileName(idc: number): string {
  switch (idc) {
    case 66:
      return 'Baseline';
    case 77:
      return 'Main';
    case 88:
      return 'Extended';
    case 100:
      return 'High';
    case 110:
      return 'High 10';
    case 122:
      return 'High 4:2:2';
    case 244:
      return 'High 4:4:4';
    default:
      return `profile ${idc}`;
  }
}

function avcPixFmt(idc: number): string {
  switch (idc) {
    case 110:
      return 'yuv420p10le';
    case 122:
      return 'yuv422p';
    case 244:
      return 'yuv444p';
    default:
      return 'yuv420p';
  }
}

function hevcProfileName(idc: number): string {
  switch (idc) {
    case 1:
      return 'Main';
    case 2:
      return 'Main 10';
    case 3:
      return 'Main Still Picture';
    default:
      return `profile ${idc}`;
  }
}
