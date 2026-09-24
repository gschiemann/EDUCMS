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
    const codes = ['codec', 'bit-depth', 'resolution', 'frame-rate', 'level', 'bitrate', 'fast-start', 'variable-frame-rate', 'audio', 'container'] as const;
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
    expect(describeEncodeReason(t, { code: 'resolution', severity: 'red', detail: { width: 3840, height: 2160 } })).toBe(
      '3840 × 2160 — larger than 1080p',
    );
    expect(describeEncodeReason(t, { code: 'codec', severity: 'red', detail: { codec: 'H.265 / HEVC' } })).toContain('H.265 / HEVC');
  });
});

describe('encodeFactsLine', () => {
  it('prints what the probe saw, in order, skipping unknowns', () => {
    const s = videoEncodeState({ mimeType: 'video/mp4', processingMeta: SAFE_PROBE, createdAt: '2026-09-24T11:58:00Z' }, NOW);
    expect(encodeFactsLine(s.facts)).toBe('H.264 · 1920 × 1080 · 30 fps · 8.2 Mbps');
    expect(encodeFactsLine({ ...s.facts!, bitrateKbps: null, fps: null })).toBe('H.264 · 1920 × 1080');
    expect(encodeFactsLine(null)).toBe('');
  });
});
