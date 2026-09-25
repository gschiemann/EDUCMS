/**
 * The publish-time warning above a playlist's Content list.
 */
import { render, screen } from '@testing-library/react';
import { PlaylistEncodeBanner } from '../PlaylistEncodeBanner';

const safeProbe = {
  originalDimensions: { w: 1920, h: 1080 },
  probedAt: '2026-09-24T11:59:00Z',
  probe: {
    codec: 'h264', level: 40, pixFmt: 'yuv420p', fps: 30, variableFrameRate: false,
    bitrateKbps: 8_000, fastStart: true, container: 'mov,mp4,m4a,3gp,3g2,mj2',
    audio: { codec: 'aac', channels: 2, sampleRate: 48_000 },
  },
};

const video = (id: string, name: string, meta: unknown) => ({
  id,
  asset: { mimeType: 'video/mp4', originalName: name, createdAt: '2026-09-24T11:58:00Z', processingMeta: meta },
});

describe('PlaylistEncodeBanner', () => {
  it('renders nothing when every item is fine', () => {
    const { container } = render(
      <PlaylistEncodeBanner
        items={[
          video('a', 'good.mp4', safeProbe),
          { id: 'b', asset: { mimeType: 'image/png', originalName: 'poster.png', createdAt: '2026-09-24T11:58:00Z', processingMeta: null } },
        ]}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('names each flagged video with its first reason, and the fix', () => {
    render(
      <PlaylistEncodeBanner
        items={[
          video('a', 'good.mp4', safeProbe),
          video('b', 'Pro Series 2026.mp4', { ...safeProbe, originalDimensions: { w: 3840, h: 2160 }, probe: { ...safeProbe.probe, fps: 60 } }),
          video('c', 'promo.mp4', { ...safeProbe, probe: { ...safeProbe.probe, fastStart: false } }),
        ]}
      />,
    );
    const banner = screen.getByTestId('playlist-encode-banner');
    expect(banner).toHaveAttribute('data-encode-status', 'red');
    expect(banner).toHaveTextContent('2 videos have playback compatibility notes');
    expect(banner).toHaveTextContent('Pro Series 2026.mp4 — 3840 × 2160 exceeds your 1920 × 1080 screen resolution');
    expect(banner).toHaveTextContent('promo.mp4 — Playback index is at the end of the file');
    expect(banner).toHaveTextContent('Suggested changes: Export at 1920 × 1080 (swap dimensions for portrait) · Use 30 fps');
    expect(banner).toHaveTextContent('Suggested changes: Fast start is prepared automatically after upload');
    expect(banner).not.toHaveTextContent('good.mp4');
    expect(banner).not.toHaveTextContent("Suggested: MP4, H.264 at your screens' resolution, 30 fps, fast start. Re-export and replace the file.");
  });

  it('uses the singular for one file and amber when nothing is red', () => {
    render(<PlaylistEncodeBanner items={[video('c', 'promo.mp4', { ...safeProbe, probe: { ...safeProbe.probe, fastStart: false } })]} />);
    const banner = screen.getByTestId('playlist-encode-banner');
    expect(banner).toHaveAttribute('data-encode-status', 'info');
    expect(banner).toHaveTextContent('Fast start will be prepared automatically for 1 video');
  });

  it('caps the list at five names', () => {
    const bad = (i: number) => video(`v${i}`, `clip-${i}.mp4`, { ...safeProbe, probe: { ...safeProbe.probe, codec: 'hevc' } });
    render(<PlaylistEncodeBanner items={[bad(1), bad(2), bad(3), bad(4), bad(5), bad(6), bad(7)]} />);
    const banner = screen.getByTestId('playlist-encode-banner');
    expect(banner).toHaveTextContent('7 videos have playback compatibility notes');
    expect(banner).toHaveTextContent('clip-5.mp4');
    expect(banner).not.toHaveTextContent('clip-6.mp4');
    expect(banner).toHaveTextContent('+2');
  });
});
