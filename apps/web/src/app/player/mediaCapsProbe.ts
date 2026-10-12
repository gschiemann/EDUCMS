/**
 * mediaCapsProbe.ts — what this WebView DECLARES it decodes smoothly
 * (2026-10-11, video guarantee step 1; design §4.2 "Declared").
 *
 * `navigator.mediaCapabilities.decodingInfo()` for the four canonical H.264
 * shapes the CMS delivers — 1080p30 and 2160p30, landscape and portrait — read
 * ONCE per page boot and sent on the next telemetry POST (`mediaCaps`). It
 * ships with a web deploy (no APK): every WebView in the fleet has the API
 * (Chromium ≥ 66, including the Taurus 83–87 class).
 *
 * Declared facts are optimistic. The server lets them raise an unknown screen,
 * never override what the screen was MEASURED doing, and never speak to how
 * many videos it can play at once (`declaredMaxShortEdge`, @cms/api-types).
 *
 * Player reliability rules: no timer, no retry loop, no network — one call per
 * config, each failure is "unsupported", and an API that never answers just
 * means nothing is sent.
 */
import type { TelemetryMediaCaps } from './telemetry';

type DecodingInfo = { supported?: boolean; smooth?: boolean; powerEfficient?: boolean };
interface MediaCapabilitiesLike {
  decodingInfo(config: unknown): Promise<DecodingInfo>;
}

/** The four configs — same ids as the server's schema. High profile; level 4.2 for 1080p30, 5.1 for 2160p30. */
export const MEDIA_CAPS_PROBES: ReadonlyArray<{
  id: TelemetryMediaCaps['configs'][number]['id'];
  codec: string;
  width: number;
  height: number;
  bitrate: number;
}> = [
  { id: '1080p30-landscape', codec: 'avc1.64002A', width: 1920, height: 1080, bitrate: 8_000_000 },
  { id: '1080p30-portrait', codec: 'avc1.64002A', width: 1080, height: 1920, bitrate: 8_000_000 },
  { id: '2160p30-landscape', codec: 'avc1.640033', width: 3840, height: 2160, bitrate: 16_000_000 },
  { id: '2160p30-portrait', codec: 'avc1.640033', width: 2160, height: 3840, bitrate: 16_000_000 },
];

export function webviewMajorFrom(ua: string | null | undefined): number | null {
  const m = /\bChrome\/(\d{2,4})\./.exec(String(ua ?? ''));
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Ask the WebView. Resolves null when the API is missing (nothing to say),
 * otherwise one entry per config — a config whose query throws reads as
 * unsupported, never as smooth.
 */
export async function probeMediaCaps(
  nav: { mediaCapabilities?: MediaCapabilitiesLike; userAgent?: string } | null | undefined =
    typeof navigator !== 'undefined' ? (navigator as unknown as { mediaCapabilities?: MediaCapabilitiesLike; userAgent?: string }) : null,
): Promise<TelemetryMediaCaps | null> {
  const mc = nav?.mediaCapabilities;
  if (!mc || typeof mc.decodingInfo !== 'function') return null;
  const configs = await Promise.all(MEDIA_CAPS_PROBES.map(async (p) => {
    try {
      const r = await mc.decodingInfo({
        type: 'file',
        video: { contentType: `video/mp4; codecs="${p.codec}"`, width: p.width, height: p.height, bitrate: p.bitrate, framerate: 30 },
      });
      return { id: p.id, supported: r?.supported === true, smooth: r?.smooth === true, powerEfficient: r?.powerEfficient === true };
    } catch {
      return { id: p.id, supported: false, smooth: false, powerEfficient: false };
    }
  }));
  const out: TelemetryMediaCaps = { configs };
  const wv = webviewMajorFrom(nav?.userAgent);
  if (wv !== null) out.webviewMajor = wv;
  return out;
}
