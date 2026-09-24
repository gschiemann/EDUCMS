/**
 * The dashboard's read of the encode grade: the `checking` window, the
 * reason → i18n mapping, and the green card's facts line. The grade itself
 * is tested in packages/api-types/src/video-encode.spec.ts.
 */
import {
  ENCODE_CHECKING_WINDOW_MS,
  describeEncodeReason,
  encodeFactsLine,
  encodeReasonKey,
  encodeWarns,
  videoEncodeState,
  encodeRemuxRecord,
  libraryPollMs,
  remuxMayStillLand,
  REMUX_LANDING_WINDOW_MS,
} from '../video-encode-copy';
import en from '../../i18n/messages/en.json';

const NOW = Date.parse('2026-09-24T12:00:00Z');

const SAFE_PROBE = {
  originalDimensions: { w: 1920, h: 1080 },
  durationMs: 30_000,
  probedAt: '2026-09-24T11:59:00Z',
  probe: {
    codec: 'h264',
    profile: 'High',
    level: 40,
    pixFmt: 'yuv420p',
    fps: 29.97,
    variableFrameRate: false,
    bitrateKbps: 8_200,
    fastStart: true,
    container: 'mov,mp4,m4a,3gp,3g2,mj2',
    audio: { codec: 'aac', channels: 2, sampleRate: 48_000 },
  },
};

describe('videoEncodeState', () => {
  it('grades a probed video from its facts', () => {
    const s = videoEncodeState({ mimeType: 'video/mp4', processingMeta: SAFE_PROBE, createdAt: '2026-09-24T11:58:00Z' }, NOW);
    expect(s.status).toBe('green');
    expect(s.verdict.reasons).toEqual([]);
    expect(s.facts?.codec).toBe('h264');
  });

  it('grades against the fleet: 4K is fine on a 4K fleet, and 720p gets a size note there', () => {
    const fourK = { panelWidth: 3840, panelHeight: 2160, panelKnown: true };
    const big = videoEncodeState(
      { mimeType: 'video/mp4', processingMeta: { ...SAFE_PROBE, originalDimensions: { w: 3840, h: 2160 }, probe: { ...SAFE_PROBE.probe, level: 51 } }, createdAt: '2026-09-24T11:58:00Z' },
      NOW,
      fourK,
    );
    expect(big.status).toBe('green');
    const small = videoEncodeState(
      { mimeType: 'video/mp4', processingMeta: { ...SAFE_PROBE, originalDimensions: { w: 1280, h: 720 } }, createdAt: '2026-09-24T11:58:00Z' },
      NOW,
      fourK,
    );
    expect(small.status).toBe('green');
    expect(small.verdict.reasons.map((r) => `${r.severity}:${r.code}`)).toEqual(['info:soft']);
  });

  it('is red with reasons for a 4K HEVC export', () => {
    const s = videoEncodeState(
      {
        mimeType: 'video/mp4',
        processingMeta: {
          ...SAFE_PROBE,
          originalDimensions: { w: 3840, h: 2160 },
          probe: { ...SAFE_PROBE.probe, codec: 'hevc', pixFmt: 'yuv420p10le', fps: 60 },
        },
        createdAt: '2026-09-24T11:58:00Z',
      },
      NOW,
    );
    expect(s.status).toBe('red');
    expect(s.verdict.reasons.map((r) => r.code)).toEqual(['codec', 'bit-depth', 'resolution', 'frame-rate']);
  });

  it('reads "checking" for a video uploaded moments ago with no probe yet', () => {
    const s = videoEncodeState({ mimeType: 'video/mp4', processingMeta: null, createdAt: new Date(NOW - 20_000).toISOString() }, NOW);
    expect(s.status).toBe('checking');
  });

  it('falls back to "unknown" once the checking window has passed', () => {
    const s = videoEncodeState(
      { mimeType: 'video/mp4', processingMeta: null, createdAt: new Date(NOW - ENCODE_CHECKING_WINDOW_MS - 1).toISOString() },
      NOW,
    );
    expect(s.status).toBe('unknown');
  });

  it('is "unknown", not "checking", when a probe ran but produced no facts', () => {
    // ffprobe could not read the file: probedAt is stamped, nothing else is.
    const s = videoEncodeState(
      { mimeType: 'video/mp4', processingMeta: { probedAt: '2026-09-24T11:59:59Z', skippedReason: 'ffprobe-failed' }, createdAt: new Date(NOW - 5_000).toISOString() },
      NOW,
    );
    expect(s.status).toBe('unknown');
  });

  it('never grades a non-video', () => {
    expect(videoEncodeState({ mimeType: 'image/png', processingMeta: SAFE_PROBE, createdAt: new Date(NOW).toISOString() }, NOW).status).toBe('unknown');
    expect(videoEncodeState(null, NOW).status).toBe('unknown');
  });

  it('a legacy row with no createdAt is unknown, never checking', () => {
    expect(videoEncodeState({ mimeType: 'video/mp4', processingMeta: null }, NOW).status).toBe('unknown');
  });
});

describe('encodeWarns', () => {
  it('is true only for amber and red', () => {
    expect(encodeWarns('amber')).toBe(true);
    expect(encodeWarns('red')).toBe(true);
    expect(encodeWarns('green')).toBe(false);
    expect(encodeWarns('checking')).toBe(false);
    expect(encodeWarns('unknown')).toBe(false);
  });
});

describe('reason copy', () => {
  const reasons: Record<string, string> = en.assetsLib.encode.reason;

  it('maps every reason code to an existing English sentence', () => {
    const codes = ['codec', 'bit-depth', 'resolution', 'soft', 'frame-rate', 'level', 'bitrate', 'fast-start', 'variable-frame-rate', 'audio', 'container'] as const;
    for (const code of codes) {
      const key = encodeReasonKey(code);
      const leaf = key.replace('assetsLib.encode.reason.', '');
      expect(typeof reasons[leaf]).toBe('string');
    }
  });

  it('fills the sentence with the reason detail', () => {
    const t = (key: string, values?: Record<string, string | number>) => {
      const leaf = key.replace('assetsLib.encode.reason.', '');
      return reasons[leaf].replace(/\{(\w+)\}/g, (_, k) => String(values?.[k]));
    };
    expect(
      describeEncodeReason(t, { code: 'resolution', severity: 'red', detail: { width: 3840, height: 2160, panelWidth: 1920, panelHeight: 1080 } }),
    ).toBe('3840 × 2160 — larger than your biggest screen (1920 × 1080); the player decodes pixels it can never show');
    expect(describeEncodeReason(t, { code: 'codec', severity: 'red', detail: { codec: 'H.265 / HEVC' } })).toContain('H.265 / HEVC');
  });
});

describe('encodeFactsLine', () => {
  it('prints what the probe saw, in order, skipping unknowns', () => {
    const s = videoEncodeState({ mimeType: 'video/mp4', processingMeta: SAFE_PROBE, createdAt: '2026-09-24T11:58:00Z' }, NOW);
    expect(encodeFactsLine(s.facts)).toBe('H.264 High 4.0 · 1920 × 1080 · 29.97 fps · 8.2 Mbps · 8-bit 4:2:0 · AAC stereo 48 kHz · MP4 · front of file');
    expect(encodeFactsLine({ ...s.facts!, bitrateKbps: null, fps: null, audio: null, container: null, fastStart: null, pixFmt: null, profile: null, level: null })).toBe('H.264 · 1920 × 1080');
    expect(encodeFactsLine(null)).toBe('');
  });
});

describe('the automatic fast-start fix (2026-09-24)', () => {
  const minute = 60_000;
  const video = (meta: unknown) => ({ mimeType: 'video/mp4', createdAt: '2026-09-24T11:00:00Z', processingMeta: meta });
  const moovLast = (probedAgoMs: number, extra: Record<string, unknown> = {}) =>
    video({
      probedAt: new Date(NOW - probedAgoMs).toISOString(),
      probe: { ...SAFE_PROBE, fastStart: false },
      ...extra,
    });

  it('reads the swap record, and only a real one', () => {
    expect(encodeRemuxRecord({ remux: { at: '2026-09-24T11:30:00Z', bytesBefore: 10, bytesAfter: 10 } })).toEqual({
      at: '2026-09-24T11:30:00Z',
      bytesBefore: 10,
      bytesAfter: 10,
    });
    expect(encodeRemuxRecord({ remux: { at: 'yesterday-ish' } })).toBeNull();
    expect(encodeRemuxRecord({ probe: SAFE_PROBE })).toBeNull();
    expect(encodeRemuxRecord(null)).toBeNull();
  });

  it('keeps polling while a moov-last probe is fresh and no swap has landed', () => {
    expect(remuxMayStillLand(moovLast(1 * minute), NOW)).toBe(true);
    // The swap landed: done.
    expect(remuxMayStillLand(moovLast(1 * minute, { remux: { at: '2026-09-24T11:59:30Z' } }), NOW)).toBe(false);
    // The index was in front all along: nothing to wait for.
    expect(remuxMayStillLand(video({ probedAt: new Date(NOW - minute).toISOString(), probe: SAFE_PROBE }), NOW)).toBe(false);
    // Past the window the API has either given up or decided not to touch it.
    expect(remuxMayStillLand(moovLast(REMUX_LANDING_WINDOW_MS + 1), NOW)).toBe(false);
    // A probe stamped in the future is no evidence.
    expect(remuxMayStillLand(moovLast(-minute), NOW)).toBe(false);
    expect(remuxMayStillLand({ mimeType: 'image/png', processingMeta: null }, NOW)).toBe(false);
  });

  it('libraryPollMs: 5 s while anything is still being probed or fixed, else off', () => {
    const settled = video({ probedAt: new Date(NOW - minute).toISOString(), probe: SAFE_PROBE });
    expect(libraryPollMs([settled], NOW)).toBe(false);
    expect(libraryPollMs([settled, moovLast(2 * minute)], NOW)).toBe(5_000);
    // A just-uploaded video with no probe yet reads "checking" — also polled.
    expect(libraryPollMs([{ mimeType: 'video/mp4', createdAt: new Date(NOW - 30_000).toISOString(), processingMeta: null }], NOW)).toBe(5_000);
    expect(libraryPollMs([], NOW)).toBe(false);
  });
});
