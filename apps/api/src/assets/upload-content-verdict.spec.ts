/**
 * The upload content verdict, both directions (2026-10-05).
 *
 * REFUSE only on a definite content verdict; ACCEPT (with a reason for the log)
 * whenever the check could not run or its answer is ambiguous. The tool output
 * below is RECORDED from ffprobe / ffmpeg 8.1.1 and sharp 0.35.4 run against the
 * media beta-test corpus (docs/research/2026-10-04-media-matrix/limits-findings.md
 * PART A) over an http Range server — the same way the service reads storage.
 * The real-binary run of the same policy is upload-content-check.real.spec.ts.
 */
import {
  buildTailDecodeArgs,
  classifyAudioProbe,
  classifyImage,
  classifyPdf,
  classifyTailDecode,
  countDecodedFrames,
  decideUploadContent,
  hasIndexedLayout,
  isPictureContainer,
  sniffBmpOrIco,
  storedTypeScreenVerdict,
  tailSeekSeconds,
  UPLOAD_REFUSALS,
  uploadContentKind,
  uploadScreenStamp,
  uploadScreenVerdict,
  videoProbeStep,
  videoStreamDurationS,
  type ContentEvidence,
  type ImageEvidence,
  type ToolRun,
} from './upload-content-verdict';
import { readFileSync } from 'fs';
import * as path from 'path';
import { readScreenStamp, withheldFromScreens } from '@cms/api-types';
import { parseProbe, planTranscode } from '../storage/video-transcode/transcode-profile';

const run = (over: Partial<ToolRun>): ToolRun => ({
  exitCode: 0,
  stdout: '',
  stderr: '',
  spawnError: null,
  timedOut: false,
  ...over,
});

const probeJson = (
  streams: object[],
  format: object = {
    format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
    duration: '4.000000',
  },
) => JSON.stringify({ streams, format });

const H264 = {
  index: 0,
  codec_type: 'video',
  codec_name: 'h264',
  width: 1280,
  height: 720,
  duration: '4.000000',
  disposition: { attached_pic: 0 },
};
const AAC = {
  index: 1,
  codec_type: 'audio',
  codec_name: 'aac',
  channels: 2,
  sample_rate: '48000',
  duration: '4.000000',
};

// ── recorded stderr (ffmpeg 8.1.1, read over http) ──────────────────────────
const MOOV_NOT_FOUND =
  '[mov,mp4,m4a,3gp,3g2,mj2 @ 0x78eec14000] moov atom not found\nhttp://127.0.0.1:63112/limits-a04-textfile.mp4: Invalid data found when processing input\n';
const ZIP_INVALID =
  'http://127.0.0.1:63112/limits-a25-zip-as.mp4: Invalid data found when processing input\n';
const SERVER_5XX =
  'http://127.0.0.1:63184/base-noisy.mp4: Server returned 5XX Server Error reply\n';
const REFUSED =
  '[tcp @ 0x767f058000] Connection to tcp://127.0.0.1:9 failed: Connection refused\nhttp://127.0.0.1:9/x.mp4: Connection refused\n';
const CUT_HEADER =
  '[http @ 0x7577034000] Stream ends prematurely at 4164075, should be 4167296\n[mov,mp4,m4a,3gp,3g2,mj2 @ 0x7577030000] error reading header\nhttp://127.0.0.1:63211/base-noisy-moovend.mp4: End of file\n';
/** A05–A07: an MP4 cut at 10/50/90 % with its index in front, decoded 1.5 s before the end. */
const TRUNCATED_TAIL =
  '[in#0/mov,mp4,m4a,3gp,3g2,mj2 @ 0x767f020000] Packet corrupt (stream = 0, dts = 2560).\n[h264 @ 0x767ec38e00] Invalid NAL unit size (246308 > 39810).\n[h264 @ 0x767ec38e00] missing picture in access unit with size 39814\n[in#0/mov,mp4,m4a,3gp,3g2,mj2 @ 0x767cc10000] corrupt input packet in stream 0\n';
/** The NEGATIVE CONTROL: a GOOD file whose read dropped mid-body. Same demuxer lines — plus the http line. */
const GOOD_FILE_DROPPED_READ =
  '[http @ 0x78d6c18000] Stream ends prematurely at 1389098, should be 4167296\n[in#0/mov,mp4,m4a,3gp,3g2,mj2 @ 0x78d701c000] Packet corrupt (stream = 0, dts = 1024).\n[h264 @ 0x78d704ce00] Invalid NAL unit size (280508 > 154782).\n[h264 @ 0x78d704ce00] missing picture in access unit with size 154786\n';
const GOOD_FILE_DROPPED_READ_2 =
  '[http @ 0x7734c02f80] Stream ends prematurely at 20243, should be 60729\n[in#0/mov,mp4,m4a,3gp,3g2,mj2 @ 0x773501c000] stream 0, offset 0x4f46: partial file\n[in#0/mov,mp4,m4a,3gp,3g2,mj2 @ 0x7735018000] Error during demuxing: Input/output error\n';
/** A14: a video track with no frames, decoded from the start. */
const ZERO_FRAME_TRACK =
  "[in#0/mov,mp4,m4a,3gp,3g2,mj2 @ 0x74cf020000] Could not find codec parameters for stream 0 (Video: h264 (avc1 / 0x31637661), none, 640x360): unspecified pixel format\nConsider increasing the value for the 'analyzeduration' (0) and 'probesize' (5000000) options\n[vf#0:0 @ 0x7bd7088000] Cannot determine format of input 0:0 after EOF\n";
const ONE_FRAME =
  '#tb 0: 1/25\n#media_type 0: video\n#codec_id 0: rawvideo\n#dimensions 0: 1280x720\n#sar 0: 1/1\n0,         62,         62,        1,  1382400, 0x8a6f7a1b\n';

describe('uploadContentKind — what a file is checked as', () => {
  it.each([
    ['image/jpeg', 'image'],
    ['image/x-icon', 'image'],
    ['video/mp4', 'video'],
    ['video/webm', 'video'],
    ['audio/mpeg', 'audio'],
    ['application/pdf', 'pdf'],
    ['APPLICATION/PDF; charset=binary', 'pdf'],
    ['text/plain', null],
    ['', null],
  ])('%s → %s', (mime, kind) => expect(uploadContentKind(mime)).toBe(kind));
});

describe('video: ffprobe', () => {
  describe('REFUSES on a definite answer', () => {
    it.each([
      [
        'a text file named .mp4 (exit 1, moov atom not found)',
        run({ exitCode: 1, stderr: MOOV_NOT_FOUND }),
        'not-video',
      ],
      [
        'a ZIP named .mp4 (exit 1, invalid data)',
        run({ exitCode: 1, stderr: ZIP_INVALID }),
        'not-video',
      ],
      [
        'an index with its body zeroed: no streams at all (A12)',
        run({
          stdout: probeJson([]),
          stderr:
            '[mov,mp4,m4a,3gp,3g2,mj2 @ 0x79a2c10000] Invalid mvhd time scale 0, defaulting to 1\n',
        }),
        'not-video',
      ],
      ['sound only (A15)', run({ stdout: probeJson([AAC]) }), 'no-picture'],
      [
        'a text track only (A16)',
        run({
          stdout: probeJson([
            { codec_type: 'subtitle', codec_name: 'mov_text' },
          ]),
        }),
        'not-video',
      ],
      [
        'a JPEG named .mp4 (A17: jpeg_pipe)',
        run({
          stdout: probeJson(
            [
              {
                codec_type: 'video',
                codec_name: 'mjpeg',
                width: 1280,
                height: 720,
              },
            ],
            { format_name: 'jpeg_pipe' },
          ),
        }),
        'still-image',
      ],
      [
        'an animated GIF named .mp4',
        run({
          stdout: probeJson(
            [
              {
                codec_type: 'video',
                codec_name: 'gif',
                width: 320,
                height: 240,
              },
            ],
            { format_name: 'gif', duration: '1.0' },
          ),
        }),
        'still-image',
      ],
      [
        'cover art only — an M4A with a picture is not a video',
        run({
          stdout: probeJson([
            AAC,
            {
              codec_type: 'video',
              codec_name: 'png',
              width: 600,
              height: 600,
              disposition: { attached_pic: 1 },
            },
          ]),
        }),
        'no-picture',
      ],
    ])('%s', (_label, r, reason) => {
      const step = videoProbeStep(r);
      expect(step.done).toEqual(
        expect.objectContaining({ status: 'bad', reason }),
      );
    });
  });

  describe('ACCEPTS (as "could not check") when the check itself failed', () => {
    it.each([
      ['storage answered 500', run({ exitCode: 1, stderr: SERVER_5XX })],
      ['the connection was refused', run({ exitCode: 1, stderr: REFUSED })],
      [
        'the read dropped while reading the header',
        run({ exitCode: 1, stderr: CUT_HEADER }),
      ],
      [
        'ffprobe is not installed',
        run({ exitCode: null, spawnError: 'spawn ffprobe ENOENT' }),
      ],
      ['ffprobe ran out of time', run({ exitCode: null, timedOut: true })],
      [
        'exit 1 with a message we do not recognise',
        run({ exitCode: 1, stderr: 'something unexpected\n' }),
      ],
      ['exit 0 but no JSON', run({ stdout: 'not json' })],
      [
        'no streams — but the read had failed',
        run({
          stdout: probeJson([]),
          stderr: 'Stream ends prematurely at 10, should be 99\n',
        }),
      ],
      [
        'a picture container — but the read had failed',
        run({
          stdout: probeJson(
            [{ codec_type: 'video', codec_name: 'mjpeg', width: 9, height: 9 }],
            { format_name: 'jpeg_pipe' },
          ),
          stderr: 'Connection reset by peer\n',
        }),
      ],
    ])('%s', (_label, r) => {
      const step = videoProbeStep(r);
      expect(step.done?.status).toBe('unknown');
    });

    it('a "not media" line next to a read failure is NOT a verdict', () => {
      expect(
        videoProbeStep(
          run({ exitCode: 1, stderr: `${SERVER_5XX}${MOOV_NOT_FOUND}` }),
        ).done?.status,
      ).toBe('unknown');
    });
  });

  it('a real video stream goes on to the end-of-file check, 1.5 s before the end of the VIDEO stream', () => {
    const MP4 = 'mov,mp4,m4a,3gp,3g2,mj2';
    expect(videoProbeStep(run({ stdout: probeJson([H264, AAC]) }))).toEqual({
      seekS: 2.5,
      formatName: MP4,
    });
    // The audio outlasts the picture: the seek follows the video stream, not the container.
    expect(
      videoProbeStep(
        run({
          stdout: probeJson([{ ...H264, duration: '3.000000' }, AAC], {
            format_name: 'mov,mp4',
            duration: '9.0',
          }),
        }),
      ),
    ).toEqual({ seekS: 1.5, formatName: 'mov,mp4' });
    // Matroska keeps the stream's length in a DURATION tag.
    expect(
      videoProbeStep(
        run({
          stdout: probeJson(
            [
              {
                codec_type: 'video',
                codec_name: 'vp9',
                width: 1280,
                height: 720,
                tags: { DURATION: '00:00:03.016000000' },
              },
            ],
            { format_name: 'matroska,webm', duration: '3.016' },
          ),
        }),
      ),
    ).toEqual({ seekS: 1.516, formatName: 'matroska,webm' });
    // A clip too short to seek into: decode its first frame.
    expect(
      videoProbeStep(
        run({ stdout: probeJson([{ ...H264, duration: '1.2' }]) }),
      ),
    ).toEqual({ seekS: 0, formatName: MP4 });
    // A video stream with no size yet (a late SPS): not a verdict — the decode decides.
    expect(
      videoProbeStep(
        run({
          stdout: probeJson([
            { codec_type: 'video', codec_name: 'h264', duration: '4.0' },
          ]),
        }),
      ),
    ).toEqual({ seekS: 2.5, formatName: MP4 });
  });

  it('a container with NO index decodes its FIRST frame — cut from the corpus file that seeked to nothing', () => {
    // codec-name-ts-h264-bytes.mp4 (the media beta-test codec corpus): MPEG-TS
    // bytes under a .mp4 name, timestamps starting at 1.47 s. `-ss 1.5` gave
    // 0 frames and no reason ("could not check"); from the start it decodes.
    const ts = probeJson(
      [
        {
          codec_type: 'video',
          codec_name: 'h264',
          width: 1920,
          height: 1080,
          start_time: '1.466667',
          duration: '3.000000',
        },
        {
          codec_type: 'audio',
          codec_name: 'ac3',
          start_time: '1.461333',
          duration: '3.008000',
        },
      ],
      { format_name: 'mpegts', start_time: '1.461333', duration: '3.008000' },
    );
    expect(videoProbeStep(run({ stdout: ts }))).toEqual({
      seekS: 0,
      formatName: 'mpegts',
    });
    for (const format_name of ['avi', 'flv', 'asf', 'mpeg']) {
      expect(
        videoProbeStep(
          run({
            stdout: probeJson([{ ...H264, duration: '30.0' }], {
              format_name,
              duration: '30.0',
            }),
          }),
        ),
      ).toEqual({ seekS: 0, formatName: format_name });
    }
    // …and with no read to the end: "ends early" is no verdict there.
    expect(buildTailDecodeArgs('https://x/y.mp4', 0, false)).toEqual([
      '-hide_banner',
      '-nostdin',
      '-v',
      'warning',
      '-threads',
      '2',
      '-i',
      'https://x/y.mp4',
      '-map',
      '0:V:0',
      '-an',
      '-sn',
      '-dn',
      '-frames:v',
      '1',
      '-f',
      'framecrc',
      'pipe:1',
    ]);
  });
});

describe('video: the end-of-file check', () => {
  const MP4 = 'mov,mp4,m4a,3gp,3g2,mj2';
  /** An MP4 cut at 90 / 97 / 99 %: the frame 1.5 s before the end decodes, then the copy hits the cut. */
  const CUT_IN_LAST_SECONDS =
    '[in#0/mov,mp4,m4a,3gp,3g2,mj2] Packet corrupt (stream = 0, dts = 33280).\n[h264] Invalid NAL unit size (1013 > 9).\n[h264] missing picture in access unit with size 13\n[in#0/mov,mp4,m4a,3gp,3g2,mj2] corrupt input packet in stream 0\n[in#0/mov,mp4,m4a,3gp,3g2,mj2] stream 0, offset 0x88af7: partial file\n';
  const WEBM_CUT =
    '[in#0/matroska,webm] File ended prematurely\n    Last message repeated 1 times\n';

  it('ONE decoded frame and a clean read to the end is proof', () => {
    expect(countDecodedFrames(ONE_FRAME)).toBe(1);
    expect(
      classifyTailDecode(run({ stdout: ONE_FRAME }), 2.5, MP4).status,
    ).toBe('ok');
    expect(
      classifyTailDecode(run({ stdout: ONE_FRAME }), 2.5, 'matroska,webm')
        .status,
    ).toBe('ok');
  });

  it('REFUSES a cut-off MP4 whose index is in front (A05–A07): no frame, and the data stops', () => {
    expect(
      classifyTailDecode(
        run({ stdout: '#tb 0: 1/25\n', stderr: TRUNCATED_TAIL }),
        2.5,
        MP4,
      ),
    ).toEqual(expect.objectContaining({ status: 'bad', reason: 'ends-early' }));
  });

  it('REFUSES a cut INSIDE the last 1.5 s — the frame decodes, the copy to the end finds the data missing', () => {
    expect(
      classifyTailDecode(
        run({ stdout: ONE_FRAME, stderr: CUT_IN_LAST_SECONDS }),
        2.5,
        MP4,
      ),
    ).toEqual(expect.objectContaining({ status: 'bad', reason: 'ends-early' }));
    expect(
      classifyTailDecode(
        run({ stdout: ONE_FRAME, stderr: WEBM_CUT }),
        2.5,
        'matroska,webm',
      ),
    ).toEqual(expect.objectContaining({ status: 'bad', reason: 'ends-early' }));
  });

  it('a container with no index (MPEG-TS) never gets an "ends early" verdict from packet warnings', () => {
    expect(
      classifyTailDecode(
        run({ stdout: ONE_FRAME, stderr: CUT_IN_LAST_SECONDS }),
        2.5,
        'mpegts',
      ).status,
    ).toBe('ok');
    expect(
      classifyTailDecode(
        run({ stdout: '', stderr: TRUNCATED_TAIL }),
        2.5,
        'mpegts',
      ).status,
    ).toBe('unknown');
  });

  it('REFUSES a video track with no frames at all (A14), decoded from the start', () => {
    expect(
      classifyTailDecode(
        run({ exitCode: 183, stderr: ZERO_FRAME_TRACK }),
        0,
        MP4,
      ),
    ).toEqual(expect.objectContaining({ status: 'bad', reason: 'not-video' }));
  });

  it('NEGATIVE CONTROL: a GOOD file read through a dropped connection is never refused', () => {
    // These lines contain every truncation marker — and the http layer's own line.
    expect(
      classifyTailDecode(run({ stderr: GOOD_FILE_DROPPED_READ }), 2.5, MP4)
        .status,
    ).toBe('unknown');
    expect(
      classifyTailDecode(run({ stderr: GOOD_FILE_DROPPED_READ_2 }), 1.5, MP4)
        .status,
    ).toBe('unknown');
    expect(
      classifyTailDecode(
        run({ stdout: ONE_FRAME, stderr: GOOD_FILE_DROPPED_READ }),
        2.5,
        MP4,
      ).status,
    ).toBe('unknown');
  });

  it.each([
    [
      'ffmpeg is not installed',
      run({ exitCode: null, spawnError: 'spawn ffmpeg ENOENT' }),
    ],
    ['ffmpeg ran out of time', run({ exitCode: null, timedOut: true })],
    [
      'no frame and no reason (the last frame sits before the seek point)',
      run({ stdout: '#tb 0: 1/25\n' }),
    ],
  ])('ACCEPTS when %s', (_label, r) => {
    expect(classifyTailDecode(r, 2.5, MP4).status).toBe('unknown');
  });

  it('ONE read, two outputs: one decoded frame on stdout + a stream copy to the end into the null muxer', () => {
    expect(buildTailDecodeArgs('https://x/y.mp4', 2.5)).toEqual([
      '-hide_banner',
      '-nostdin',
      '-v',
      'warning',
      '-threads',
      '2',
      '-ss',
      '2.500',
      '-i',
      'https://x/y.mp4',
      '-map',
      '0:V:0',
      '-an',
      '-sn',
      '-dn',
      '-frames:v',
      '1',
      '-f',
      'framecrc',
      'pipe:1',
      '-map',
      '0:V:0',
      '-an',
      '-sn',
      '-dn',
      '-c',
      'copy',
      '-f',
      'null',
      '-',
    ]);
    expect(buildTailDecodeArgs('in.mp4', 0)).not.toContain('-ss');
  });

  it('hasIndexedLayout: MP4 / MOV family and Matroska / WebM only', () => {
    for (const f of [MP4, 'matroska,webm', 'mov'])
      expect(hasIndexedLayout(f)).toBe(true);
    for (const f of ['mpegts', 'avi', 'flv', 'h264', null])
      expect(hasIndexedLayout(f)).toBe(false);
  });

  it('tailSeekSeconds', () => {
    expect(tailSeekSeconds(4)).toBe(2.5);
    expect(tailSeekSeconds(1.75)).toBe(0);
    expect(tailSeekSeconds(null)).toBe(0);
    expect(tailSeekSeconds(Number.NaN)).toBe(0);
    expect(tailSeekSeconds(600.0333)).toBe(598.533);
  });

  it('isPictureContainer: image demuxers, GIF and APNG — never MP4 / WebM / MPEG-TS', () => {
    for (const f of [
      'jpeg_pipe',
      'png_pipe',
      'webp_pipe',
      'bmp_pipe',
      'image2',
      'gif',
      'apng',
    ])
      expect(isPictureContainer(f)).toBe(true);
    for (const f of [
      'mov,mp4,m4a,3gp,3g2,mj2',
      'matroska,webm',
      'mpegts',
      'h264',
      null,
    ])
      expect(isPictureContainer(f)).toBe(false);
  });

  it('videoStreamDurationS reads the stream, then the Matroska tag; never the container', () => {
    expect(videoStreamDurationS({ streams: [H264] })).toBe(4);
    expect(
      videoStreamDurationS({
        streams: [
          { codec_type: 'video', tags: { DURATION: '00:01:02.500000000' } },
        ],
      }),
    ).toBe(62.5);
    expect(
      videoStreamDurationS({ streams: [AAC], format: { duration: '9' } }),
    ).toBeNull();
    expect(videoStreamDurationS('garbage')).toBeNull();
  });
});

describe('audio: ffprobe must find an audio stream', () => {
  it('accepts an MP3 / AAC stream', () => {
    expect(
      classifyAudioProbe(
        run({
          stdout: probeJson([{ codec_type: 'audio', codec_name: 'mp3' }], {
            format_name: 'mp3',
          }),
        }),
      ).status,
    ).toBe('ok');
  });
  it('refuses a text file and a picture-only video named as audio', () => {
    expect(
      classifyAudioProbe(run({ exitCode: 1, stderr: ZIP_INVALID })),
    ).toEqual(expect.objectContaining({ status: 'bad', reason: 'not-audio' }));
    expect(classifyAudioProbe(run({ stdout: probeJson([H264]) }))).toEqual(
      expect.objectContaining({ status: 'bad', reason: 'not-audio' }),
    );
  });
  it('accepts when the check could not run', () => {
    expect(
      classifyAudioProbe(run({ exitCode: 1, stderr: SERVER_5XX })).status,
    ).toBe('unknown');
    expect(
      classifyAudioProbe(run({ exitCode: null, spawnError: 'ENOENT' })).status,
    ).toBe('unknown');
    expect(
      classifyAudioProbe(
        run({
          stdout: probeJson([H264]),
          stderr: 'Stream ends prematurely at 1, should be 9\n',
        }),
      ).status,
    ).toBe('unknown');
  });
});

describe('pictures', () => {
  const img = (over: Partial<ImageEvidence>): ImageEvidence => ({
    bytes: Buffer.from('x'.repeat(64)),
    sharpFormat: null,
    sharpCompression: null,
    sharpError: null,
    replacedByReencode: false,
    ...over,
  });
  const BMP = Buffer.concat([
    Buffer.from('BM'),
    Buffer.alloc(12),
    Buffer.from([40, 0, 0, 0]),
    Buffer.alloc(40),
  ]);
  const ICO = Buffer.concat([
    Buffer.from([0, 0, 1, 0, 1, 0]),
    Buffer.alloc(16),
    Buffer.alloc(40),
  ]);

  it('REFUSES what sharp cannot read and no signature claims (text, HTML, MP4 bytes)', () => {
    expect(
      classifyImage(
        img({ sharpError: 'Input buffer contains unsupported image format' }),
      ),
    ).toEqual(expect.objectContaining({ status: 'bad', reason: 'not-image' }));
  });

  it('REFUSES a HEIC under a picture name — it reads, then cannot be decoded', () => {
    expect(
      classifyImage(
        img({
          sharpFormat: 'heif',
          sharpCompression: 'hevc',
          sharpError:
            'source: bad seek to 3608\nheif: Decoder plugin generated an error: Unspecified (7.0)',
        }),
      ),
    ).toEqual(expect.objectContaining({ status: 'bad', reason: 'heic' }));
  });

  it('REFUSES a format sharp reads but no screen draws, when nothing converts it (an SVG named .gif)', () => {
    expect(classifyImage(img({ sharpFormat: 'svg' }))).toEqual(
      expect.objectContaining({ status: 'bad', reason: 'not-image' }),
    );
    expect(
      classifyImage(img({ sharpFormat: 'heif', sharpCompression: 'hevc' })),
    ).toEqual(expect.objectContaining({ reason: 'heic' }));
  });

  it('ACCEPTS BMP and ICO by signature — sharp cannot read them, browsers can', () => {
    expect(sniffBmpOrIco(BMP)).toBe('bmp');
    expect(sniffBmpOrIco(ICO)).toBe('ico');
    expect(
      sniffBmpOrIco(Buffer.from('BMxxxxxxxxxxxxxxxxxxxxxxxxxxxx')),
    ).toBeNull();
    expect(
      classifyImage(
        img({
          bytes: BMP,
          sharpError: 'Input buffer contains unsupported image format',
        }),
      ).status,
    ).toBe('ok');
    expect(
      classifyImage(
        img({
          bytes: ICO,
          sharpError: 'Input buffer contains unsupported image format',
        }),
      ).status,
    ).toBe('ok');
  });

  it('ACCEPTS every format a screen draws, whatever the file is called', () => {
    for (const f of ['jpeg', 'png', 'webp', 'gif'])
      expect(classifyImage(img({ sharpFormat: f })).status).toBe('ok');
  });

  it('ACCEPTS a format screens cannot draw once the optimizer stores its own re-encode instead', () => {
    expect(
      classifyImage(img({ sharpFormat: 'svg', replacedByReencode: true }))
        .status,
    ).toBe('ok');
  });

  it.each([
    ['the bytes could not be read back from storage', { bytes: null }],
    [
      'the picture is too big for the server to decode',
      { sharpFormat: 'jpeg', sharpError: 'Input image exceeds pixel limit' },
    ],
    [
      'sharp threw something we do not recognise',
      { sharpError: 'vips_thread_pool: something odd' },
    ],
    ['sharp was never asked', {}],
  ])('ACCEPTS when %s', (_label, over) => {
    expect(classifyImage(img(over as Partial<ImageEvidence>)).status).toBe(
      'unknown',
    );
  });
});

describe('PDF: %PDF- at the start, %%EOF at the end', () => {
  const head = Buffer.from('%PDF-1.4\n% created\n1 0 obj\n');
  it('accepts a complete PDF', () => {
    expect(
      classifyPdf({ head, tail: Buffer.from('startxref\n22695\n%%EOF\n') })
        .status,
    ).toBe('ok');
  });
  it('refuses HTML or an MP4 named .pdf', () => {
    expect(
      classifyPdf({
        head: Buffer.from('<!doctype html><html>'),
        tail: Buffer.from('</html>'),
      }),
    ).toEqual(expect.objectContaining({ status: 'bad', reason: 'not-pdf' }));
    expect(
      classifyPdf({
        head: Buffer.from([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70]),
        tail: null,
      }),
    ).toEqual(expect.objectContaining({ reason: 'not-pdf' }));
  });
  it('refuses a PDF cut short (no %%EOF)', () => {
    expect(
      classifyPdf({ head, tail: Buffer.from('68\xce\xbf`x streams cut here') }),
    ).toEqual(
      expect.objectContaining({ status: 'bad', reason: 'pdf-incomplete' }),
    );
  });
  it('accepts when either end could not be read', () => {
    expect(classifyPdf({ head: null, tail: null }).status).toBe('unknown');
    expect(classifyPdf({ head, tail: null }).status).toBe('unknown');
  });
});

describe('decideUploadContent — THE decision, both directions', () => {
  it('zero bytes is refused by the size alone, whatever the kind', () => {
    for (const kind of ['image', 'video', 'audio', 'pdf'] as const) {
      const v = decideUploadContent({ kind, storedBytes: 0 });
      expect(v.accept).toBe(false);
      if (!v.accept) {
        expect(v.refusal.code).toBe('ASSET_FILE_EMPTY');
        expect(v.refusal.message).toMatch(/^This file is empty/);
      }
    }
  });

  it('a definite verdict refuses with a stable code and plain words', () => {
    const v = decideUploadContent({
      kind: 'video',
      storedBytes: 53,
      video: {
        probe: run({ exitCode: 1, stderr: MOOV_NOT_FOUND }),
        tail: null,
      },
    });
    expect(v).toEqual(
      expect.objectContaining({
        accept: false,
        refusal: {
          code: 'ASSET_VIDEO_UNPLAYABLE',
          reason: 'not-video',
          message:
            "This isn't a playable video — the file may be damaged or incomplete. Export it again and upload the new copy.",
        },
      }),
    );
  });

  it('a truncated video is refused with the same words as a damaged one', () => {
    const v = decideUploadContent({
      kind: 'video',
      storedBytes: 2_000_000,
      video: {
        probe: run({ stdout: probeJson([H264, AAC]) }),
        tail: run({ stderr: TRUNCATED_TAIL }),
      },
    });
    expect(v.accept).toBe(false);
    if (!v.accept)
      expect([v.refusal.code, v.refusal.reason]).toEqual([
        'ASSET_VIDEO_UNPLAYABLE',
        'ends-early',
      ]);
  });

  it('a check that could not run ACCEPTS, saying why', () => {
    const cases = [
      decideUploadContent({
        kind: 'video',
        storedBytes: 9,
        skipped: 'no free check slot within the time budget',
      }),
      decideUploadContent({
        kind: 'video',
        storedBytes: 9,
        video: { probe: run({ exitCode: 1, stderr: SERVER_5XX }), tail: null },
      }),
      decideUploadContent({
        kind: 'video',
        storedBytes: 9,
        video: { probe: run({ stdout: probeJson([H264]) }), tail: null },
      }),
      decideUploadContent({
        kind: 'video',
        storedBytes: 9,
        video: {
          probe: run({ stdout: probeJson([H264]) }),
          tail: run({ stderr: GOOD_FILE_DROPPED_READ }),
        },
      }),
      decideUploadContent({
        kind: 'pdf',
        storedBytes: null,
        pdf: { head: null, tail: null },
      }),
      decideUploadContent({ kind: 'image', storedBytes: 9 }),
    ];
    for (const v of cases) {
      expect(v.accept).toBe(true);
      if (v.accept) expect(v.unchecked).toEqual(expect.any(String));
    }
  });

  it('a file that checks out is accepted with nothing to log', () => {
    const v = decideUploadContent({
      kind: 'video',
      storedBytes: 9,
      video: {
        probe: run({ stdout: probeJson([H264, AAC]) }),
        tail: run({ stdout: ONE_FRAME }),
      },
    });
    expect(v).toEqual(
      expect.objectContaining({ accept: true, unchecked: null }),
    );
  });

  it('every refusal is plain words that say what to do — no tool names, no jargon', () => {
    const codes = new Set<string>();
    for (const [reason, r] of Object.entries(UPLOAD_REFUSALS)) {
      expect(r.code).toMatch(/^ASSET_[A-Z_]+$/);
      codes.add(r.code);
      expect(r.message).toMatch(/upload/i);
      expect(r.message).not.toMatch(
        /ffmpeg|ffprobe|sharp|moov|codec|demux|NAL|stream/i,
      );
      expect(r.message.length).toBeLessThan(220);
      expect(reason).toEqual(expect.any(String));
    }
    // One code per message the page shows (not-video and ends-early share theirs);
    // 2026-10-05: + ASSET_IMAGE_HEIC_UNAVAILABLE (a HEIC conversion that could not run just now).
    // 2026-10-05: + ASSET_PDF_PASSWORD (a PDF that needs a password to open).
    expect(codes.size).toBe(11);
  });
});

// ── 2026-10-05 — can every screen play it AS UPLOADED? ──────────────────────
//
// The screen-ready verdict is read from the SAME ffprobe document the content
// check already fetched. The documents below are REAL ffprobe output
// (storage/video-transcode/__fixtures__/screen-compat-probes.json, ffmpeg 8.1.1),
// the corpus the transcode's own rule is pinned on — so the upload's verdict is
// proven against the conversion's, not against a hand-written stand-in.
const SCREEN_FIXTURES = JSON.parse(
  readFileSync(
    path.join(__dirname, '..', 'storage', 'video-transcode', '__fixtures__', 'screen-compat-probes.json'),
    'utf8',
  ),
) as { cases: Record<string, { probe: unknown }> };

/** The content check's evidence for an upload whose ffprobe printed this fixture's document. */
const videoEvidence = (
  fixture: string,
  over: Partial<ToolRun> = {},
): ContentEvidence => ({
  kind: 'video',
  storedBytes: 4096,
  video: {
    probe: run({ stdout: JSON.stringify(SCREEN_FIXTURES.cases[fixture].probe), ...over }),
    tail: run({ stdout: ONE_FRAME }),
  },
});

describe("uploadScreenVerdict — the screen-ready verdict from the upload's own ffprobe", () => {
  it.each([
    'clean-h264-1080p30-aac',
    'clean-h264-videotoolbox-iphone-style',
    'clean-h264-uhd-30',
    'clean-h264-portrait-1080x1920',
    'clean-h264-no-audio',
  ])('a screen-safe file (%s) is READY as uploaded', (fixture) => {
    expect(uploadScreenVerdict(videoEvidence(fixture))).toEqual({ ready: true, issues: [] });
  });

  it.each([
    ['hevc-10bit-hdr10', ['codec', 'pixel-format', 'hdr']],
    ['hevc-10bit-hlg', ['codec', 'pixel-format', 'hdr']],
    ['h264-60fps', ['frame-rate']],
    ['vp9-webm-opus', ['codec', 'container', 'audio-codec']],
    ['h264-quicktime-mov', ['container']],
    ['h264-rotation-90', ['rotation']],
  ])('a file that must be converted (%s) names why: %j', (fixture, expected) => {
    const v = uploadScreenVerdict(videoEvidence(fixture));
    expect(v?.ready).toBe(false);
    expect(v?.issues).toEqual(expect.arrayContaining(expected as string[]));
  });

  it('a verdict does not depend on the END of the file decoding — a format verdict needs headers only', () => {
    const e = videoEvidence('hevc-10bit-hdr10');
    e.video!.tail = null; // the tail decode ran out of budget
    expect(uploadScreenVerdict(e)?.ready).toBe(false);
  });

  describe('NO verdict — never an invented one — unless the probe ran cleanly', () => {
    it.each<[string, ContentEvidence]>([
      ['ffprobe could not start', videoEvidence('hevc-10bit-hdr10', { spawnError: 'ENOENT' })],
      ['ffprobe ran out of time', videoEvidence('hevc-10bit-hdr10', { timedOut: true, exitCode: null })],
      ['ffprobe exited non-zero', videoEvidence('hevc-10bit-hdr10', { exitCode: 1 })],
      ['the read broke while ffprobe looked (a stream may be missing)', videoEvidence('hevc-10bit-hdr10', { stderr: SERVER_5XX })],
      ['the read dropped mid-body', videoEvidence('h264-60fps', { stderr: GOOD_FILE_DROPPED_READ })],
      ['ffprobe printed no JSON', videoEvidence('hevc-10bit-hdr10', { stdout: '{"streams": [' })],
      ['the check never ran (no free slot)', { kind: 'video', storedBytes: 4096, skipped: 'no free check slot within the time budget' }],
      ['the video was never probed', { kind: 'video', storedBytes: 4096 }],
      ['zero bytes', { ...videoEvidence('hevc-10bit-hdr10'), storedBytes: 0 }],
    ])('%s → null', (_label, evidence) => {
      expect(uploadScreenVerdict(evidence)).toBeNull();
    });

    it('a sound-only file and a picture under a video name have no verdict (they are refused anyway)', () => {
      expect(
        uploadScreenVerdict({ kind: 'video', storedBytes: 9, video: { probe: run({ stdout: probeJson([AAC]) }), tail: null } }),
      ).toBeNull();
      expect(
        uploadScreenVerdict({
          kind: 'video',
          storedBytes: 9,
          video: {
            probe: run({ stdout: probeJson([{ ...H264, codec_name: 'mjpeg' }], { format_name: 'jpeg_pipe' }) }),
            tail: null,
          },
        }),
      ).toBeNull();
    });

    it('only videos: audio, pictures and PDFs never get a screen verdict', () => {
      expect(uploadScreenVerdict({ kind: 'audio', storedBytes: 9, audio: { probe: run({ stdout: probeJson([AAC]) }) } })).toBeNull();
      expect(uploadScreenVerdict({ kind: 'image', storedBytes: 9 })).toBeNull();
      expect(uploadScreenVerdict({ kind: 'pdf', storedBytes: 9 })).toBeNull();
    });
  });
});

describe('uploadScreenStamp — what the new Asset row is created with', () => {
  const NOW = Date.UTC(2026, 9, 5, 9, 30, 0);
  const AT = new Date(NOW).toISOString();

  it('screen-safe → { version: 1, ready: true, checkedAt }', () => {
    expect(uploadScreenStamp({ ready: true, issues: [] }, true, NOW)).toEqual({ version: 1, ready: true, checkedAt: AT });
    // …whether or not a conversion is coming: nothing needs one.
    expect(uploadScreenStamp({ ready: true, issues: [] }, false, NOW)).toEqual({ version: 1, ready: true, checkedAt: AT });
  });

  it('must be converted and a conversion is queued → { version: 1, ready: false, pending: true, issues, checkedAt }', () => {
    expect(uploadScreenStamp({ ready: false, issues: ['codec', 'hdr'] }, true, NOW)).toEqual({
      version: 1,
      ready: false,
      pending: true,
      issues: ['codec', 'hdr'],
      checkedAt: AT,
    });
  });

  it('must be converted but no conversion will run (VIDEO_TRANSCODE_DISABLED) → no stamp: nothing would ever settle a pending', () => {
    expect(uploadScreenStamp({ ready: false, issues: ['codec'] }, false, NOW)).toBeNull();
  });

  it('no verdict → no stamp: unknown stays unknown', () => {
    expect(uploadScreenStamp(null, true, NOW)).toBeNull();
  });

  it('the stamp reads back through the shared reader the manifest and the dashboard use', () => {
    const stamp = uploadScreenStamp(uploadScreenVerdict(videoEvidence('h264-60fps')), true, NOW);
    expect(readScreenStamp({ screen: stamp })).toEqual(
      expect.objectContaining({ ready: false, pending: true, issues: ['frame-rate'] }),
    );
  });
});

// ── 2026-10-05 — MOV, AVI, MKV, WMV, MPG, 3GP and TS opened: the NAME counts too ──
//
// The transcode plans with the stored object's type and extension
// (`planTranscode(probe, label)`): anything not called MP4 is a required
// conversion, so an asset ends an MP4 by name as well as by bytes. The upload's
// verdict reads the same label — or the gate would hand screens a `.mov` the
// pipeline is about to replace, and the two would disagree about one file.
describe('uploadScreenVerdict with the stored name — the upload and the conversion agree', () => {
  const MOV = { mimeType: 'video/quicktime', extension: '.mov' };
  const MP4 = { mimeType: 'video/mp4', extension: '.mp4' };

  it('MP4 bytes saved as .mov must be converted: not ready, for its container', () => {
    expect(uploadScreenVerdict(videoEvidence('clean-h264-1080p30-aac'), MOV)).toEqual({
      ready: false,
      issues: ['container'],
    });
  });

  it('NEGATIVE CONTROL: the same document named MP4 — or with no name given — is ready, as before', () => {
    expect(uploadScreenVerdict(videoEvidence('clean-h264-1080p30-aac'), MP4)).toEqual({ ready: true, issues: [] });
    expect(uploadScreenVerdict(videoEvidence('clean-h264-1080p30-aac'))).toEqual({ ready: true, issues: [] });
  });

  it.each(Object.keys(SCREEN_FIXTURES.cases))(
    '%s: not ready at upload ⇔ the transcode plans a REQUIRED conversion, for the same reasons — named MP4 and named MOV',
    (fixture) => {
      let compared = 0;
      for (const label of [MP4, MOV]) {
        const verdict = uploadScreenVerdict(videoEvidence(fixture), label);
        if (!verdict) continue; // no clean video verdict for this document (and nothing to plan)
        const plan = planTranscode(parseProbe(SCREEN_FIXTURES.cases[fixture].probe), label);
        const required = plan.action === 'transcode' && plan.required;
        expect(!verdict.ready).toBe(required);
        if (plan.action === 'transcode') expect(verdict.issues).toEqual(plan.issues);
        compared++;
      }
      // Under a MOV name nothing is ever ready — whatever the bytes hold.
      const asMov = uploadScreenVerdict(videoEvidence(fixture), MOV);
      if (asMov) expect(asMov.issues).toContain('container');
      expect([0, 2]).toContain(compared);
    },
  );
});

describe('storedTypeScreenVerdict — when the probe did not run, a container converted after upload is "not ready" by its TYPE', () => {
  const NOW = Date.UTC(2026, 9, 5, 9, 30, 0);

  it.each([
    ['t/a.mov', 'video/quicktime'],
    ['t/a.qt', 'video/quicktime'],
    ['t/a.avi', 'video/x-msvideo'],
    ['t/a.mkv', 'video/x-matroska'],
    ['t/a.wmv', 'video/x-ms-wmv'],
    ['t/a.mpg', 'video/mpeg'],
    ['t/a.3gp', 'video/3gpp'],
    ['t/a.ts', 'video/mp2t'],
    ['t/a.m2ts', 'video/mp2t'],
    // storage recorded no type: the stored name decides, as everywhere else
    ['t/a.avi', ''],
    ['t/a.MTS', null],
  ])('%s (%s) → not ready, for its container', (storagePath, type) => {
    expect(storedTypeScreenVerdict(storagePath, type)).toEqual({ ready: false, issues: ['container'] });
  });

  it.each([
    ['t/a.mp4', 'video/mp4'],
    ['t/a.m4v', 'video/x-m4v'],
    ['t/a.webm', 'video/webm'],
    ['t/a.mp4', ''],
    ['t/a.jpg', 'image/jpeg'],
    ['t/a.heic', 'image/heic'],
    ['t/a.mp3', 'audio/mpeg'],
    ['t/a.flv', 'video/x-flv'],
    ['', ''],
    [null, null],
  ])('%s (%s) → null: every other file stays unknown, delivered exactly as before', (storagePath, type) => {
    expect(storedTypeScreenVerdict(storagePath, type)).toBeNull();
  });

  it('its stamp is a pending "converting" one the manifest gate withholds — and there is none when no conversion is queued', () => {
    const stamp = uploadScreenStamp(storedTypeScreenVerdict('t/a.avi', 'video/x-msvideo'), true, NOW);
    expect(stamp).toEqual({
      version: 1,
      ready: false,
      pending: true,
      issues: ['container'],
      checkedAt: new Date(NOW).toISOString(),
    });
    expect(withheldFromScreens({ mimeType: 'video/x-msvideo', processingMeta: { screen: stamp } })).toBe(true);
    expect(uploadScreenStamp(storedTypeScreenVerdict('t/a.avi', 'video/x-msvideo'), false, NOW)).toBeNull();
  });
});
