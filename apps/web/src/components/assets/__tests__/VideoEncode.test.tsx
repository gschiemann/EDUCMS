/**
 * The "Playback on screens" card and the tile / row badge — what an operator
 * reads about a video's encoding, in the words en.json carries.
 */
import { render, screen } from '@testing-library/react';
import { AssetEncodeBadge, VideoEncodeBadge, VideoEncodeCard } from '../VideoEncode';

const NOW = Date.parse('2026-09-24T12:00:00Z');

const SAFE = {
  mimeType: 'video/mp4',
  createdAt: '2026-09-24T11:58:00Z',
  processingMeta: {
    originalDimensions: { w: 1920, h: 1080 },
    probedAt: '2026-09-24T11:59:00Z',
    probe: {
      codec: 'h264', profile: 'High', level: 40, pixFmt: 'yuv420p', fps: 30, variableFrameRate: false,
      bitrateKbps: 8_000, fastStart: true, container: 'mov,mp4,m4a,3gp,3g2,mj2',
      audio: { codec: 'aac', channels: 2, sampleRate: 48_000 },
    },
  },
};

describe('VideoEncodeCard', () => {
  it('renders nothing for a non-video', () => {
    const { container } = render(<VideoEncodeCard asset={{ mimeType: 'image/png', processingMeta: SAFE.processingMeta, createdAt: SAFE.createdAt }} now={NOW} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('says a safe export plays smoothly and shows what was checked', () => {
    render(<VideoEncodeCard asset={SAFE} now={NOW} />);
    const card = screen.getByTestId('video-encode-card');
    expect(card).toHaveAttribute('data-encode-status', 'green');
    expect(screen.getByText('Playback on screens')).toBeInTheDocument();
    expect(screen.getByText('Plays smoothly on every screen')).toBeInTheDocument();
    expect(screen.getByText('H.264 · 1920 × 1080 · 30 fps · 8 Mbps')).toBeInTheDocument();
    expect(screen.queryByTestId('video-encode-reasons')).not.toBeInTheDocument();
    // No fix advice when there is nothing to fix.
    expect(screen.queryByText(/Best result:/)).not.toBeInTheDocument();
  });

  it('names every reason and the export that fixes it for a 4K Canva file', () => {
    render(
      <VideoEncodeCard
        asset={{
          ...SAFE,
          processingMeta: {
            ...SAFE.processingMeta,
            originalDimensions: { w: 3840, h: 2160 },
            probe: { ...SAFE.processingMeta.probe, fps: 60, bitrateKbps: 18_000, fastStart: false },
          },
        }}
        now={NOW}
      />,
    );
    expect(screen.getByTestId('video-encode-card')).toHaveAttribute('data-encode-status', 'red');
    expect(screen.getByText('Likely to stutter or fail on screen hardware')).toBeInTheDocument();
    const reasons = screen.getByTestId('video-encode-reasons');
    expect(reasons).toHaveTextContent('3840 × 2160 — larger than 1080p');
    expect(reasons).toHaveTextContent('60 fps — above 30');
    expect(reasons).toHaveTextContent('18 Mbps — a very high bitrate');
    expect(reasons).toHaveTextContent('The index is at the end of the file');
    expect(screen.getByText(/Best result: MP4, H\.264, 1920 × 1080/)).toBeInTheDocument();
    expect(screen.getByText(/In Canva: Share, Download/)).toBeInTheDocument();
  });

  it('is amber, with advice, when the only problem is a high bitrate', () => {
    render(
      <VideoEncodeCard
        asset={{ ...SAFE, processingMeta: { ...SAFE.processingMeta, probe: { ...SAFE.processingMeta.probe, bitrateKbps: 16_000 } } }}
        now={NOW}
      />,
    );
    expect(screen.getByTestId('video-encode-card')).toHaveAttribute('data-encode-status', 'amber');
    expect(screen.getByText('May hitch or start slowly on some screens')).toBeInTheDocument();
    expect(screen.getByText(/Best result:/)).toBeInTheDocument();
  });

  it('says it is still checking a video uploaded seconds ago', () => {
    render(<VideoEncodeCard asset={{ mimeType: 'video/mp4', processingMeta: null, createdAt: new Date(NOW - 10_000).toISOString() }} now={NOW} />);
    expect(screen.getByTestId('video-encode-card')).toHaveAttribute('data-encode-status', 'checking');
    expect(screen.getByText('Checking the encoding…')).toBeInTheDocument();
  });

  it('admits an unchecked legacy upload', () => {
    render(<VideoEncodeCard asset={{ mimeType: 'video/mp4', processingMeta: null, createdAt: '2026-01-01T00:00:00Z' }} now={NOW} />);
    expect(screen.getByTestId('video-encode-card')).toHaveAttribute('data-encode-status', 'unknown');
    expect(screen.getByText('Encoding not checked yet')).toBeInTheDocument();
  });
});

describe('VideoEncodeBadge', () => {
  it('renders nothing unless the grade warns', () => {
    for (const status of ['green', 'checking', 'unknown'] as const) {
      const { container, unmount } = render(<VideoEncodeBadge status={status} label="x" />);
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });

  it('shows the label and carries the reasons as its title', () => {
    render(<VideoEncodeBadge status="red" label="Won't play well" title="3840 × 2160 — larger than 1080p" />);
    const badge = screen.getByTestId('video-encode-badge');
    expect(badge).toHaveAttribute('data-encode-status', 'red');
    expect(badge).toHaveTextContent("Won't play well");
    expect(badge).toHaveAttribute('title', '3840 × 2160 — larger than 1080p');
  });
});

describe('AssetEncodeBadge', () => {
  const red = {
    ...SAFE,
    processingMeta: { ...SAFE.processingMeta, originalDimensions: { w: 3840, h: 2160 }, probe: { ...SAFE.processingMeta.probe, codec: 'hevc' } },
  };

  it('renders nothing for a safe video or a non-video', () => {
    const { container: a } = render(<AssetEncodeBadge asset={SAFE} />);
    expect(a).toBeEmptyDOMElement();
    const { container: b } = render(<AssetEncodeBadge asset={{ mimeType: 'image/png', processingMeta: red.processingMeta, createdAt: SAFE.createdAt }} />);
    expect(b).toBeEmptyDOMElement();
  });

  it('uses the tile label by default and the row label on request, with every reason as the title', () => {
    const { unmount } = render(<AssetEncodeBadge asset={red} />);
    let badge = screen.getByTestId('video-encode-badge');
    expect(badge).toHaveTextContent("Won't play well");
    expect(badge).toHaveAttribute('title', "H.265 / HEVC video — most screen players can't decode it in hardware · 3840 × 2160 — larger than 1080p");
    unmount();
    render(<AssetEncodeBadge asset={red} labels="row" />);
    badge = screen.getByTestId('video-encode-badge');
    expect(badge).toHaveTextContent("Won't play well on screens");
  });
});

describe('VideoEncodeCard — check this file', () => {
  const legacy = { mimeType: 'video/mp4', processingMeta: null, createdAt: '2026-01-01T00:00:00Z' };

  it('offers the check only for an unchecked video, and runs it on click', () => {
    const onCheck = jest.fn();
    render(<VideoEncodeCard asset={legacy} now={NOW} onCheck={onCheck} />);
    screen.getByRole('button', { name: 'Check this file' }).click();
    expect(onCheck).toHaveBeenCalledTimes(1);
  });

  it('reads "Checking…" while the check is in flight, and hides the button', () => {
    render(<VideoEncodeCard asset={legacy} now={NOW} onCheck={jest.fn()} checking />);
    expect(screen.getByTestId('video-encode-card')).toHaveAttribute('data-encode-status', 'checking');
    expect(screen.queryByRole('button', { name: 'Check this file' })).not.toBeInTheDocument();
  });

  it('never offers the check on a graded video', () => {
    render(<VideoEncodeCard asset={SAFE} now={NOW} onCheck={jest.fn()} />);
    expect(screen.queryByRole('button', { name: 'Check this file' })).not.toBeInTheDocument();
  });
});
