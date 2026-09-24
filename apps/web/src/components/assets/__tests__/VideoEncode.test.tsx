/**
 * The "Playback on screens" card and the icon-only mark — what an operator
 * reads about a video's encoding, in the words en.json carries, graded
 * against the fleet's panels (a 4K fleet wants 4K files).
 */
import { fireEvent, render, screen } from '@testing-library/react';
import type { VideoEncodeTarget } from '@cms/api-types';
import { EncodeTargetContext } from '@/hooks/use-encode-target';
import { AssetEncodeBadge, VideoEncodeBadge, VideoEncodeCard } from '../VideoEncode';

const NOW = Date.parse('2026-09-24T12:00:00Z');
const FOUR_K: VideoEncodeTarget = { panelWidth: 3840, panelHeight: 2160, panelKnown: true };

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

const withTarget = (ui: React.ReactElement, target: VideoEncodeTarget) => (
  <EncodeTargetContext.Provider value={target}>{ui}</EncodeTargetContext.Provider>
);

describe('VideoEncodeCard', () => {
  it('says when the index was moved to the front for the operator, and the card is green', () => {
    render(
      <VideoEncodeCard
        asset={{
          ...SAFE,
          processingMeta: {
            ...SAFE.processingMeta,
            remux: { at: '2026-09-24T11:59:30Z', reason: 'fast-start', previousStoragePath: 't1/clip.mp4', bytesBefore: 100, bytesAfter: 100 },
          },
        }}
        now={NOW}
      />,
    );
    expect(screen.getByTestId('video-encode-card')).toHaveAttribute('data-encode-status', 'green');
    const note = screen.getByTestId('video-encode-remuxed');
    expect(note).toHaveTextContent(/We moved this file's index to the front on Sep 24, so it plays from the first byte\./);
    expect(note).toHaveTextContent('The original stays in storage until the file is deleted.');
  });

  it('says nothing about the index on a file that was never re-muxed', () => {
    render(<VideoEncodeCard asset={SAFE} now={NOW} />);
    expect(screen.queryByTestId('video-encode-remuxed')).not.toBeInTheDocument();
  });

  it('renders nothing for a non-video', () => {
    const { container } = render(<VideoEncodeCard asset={{ mimeType: 'image/png', processingMeta: SAFE.processingMeta, createdAt: SAFE.createdAt }} now={NOW} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows every fact it has, says a safe export plays smoothly, and suggests nothing when nothing differs', () => {
    render(<VideoEncodeCard asset={SAFE} now={NOW} />);
    expect(screen.getByTestId('video-encode-card')).toHaveAttribute('data-encode-status', 'green');
    expect(screen.getByText('Meets recommended playback specifications')).toBeInTheDocument();
    const facts = screen.getByTestId('video-encode-facts');
    expect(facts).toHaveTextContent('CodecH.264 High 4.0');
    expect(facts).toHaveTextContent('Size1920 × 1080');
    expect(facts).toHaveTextContent('Frame rate30 fps');
    expect(facts).toHaveTextContent('Bitrate8 Mbps');
    expect(facts).toHaveTextContent('Colour8-bit 4:2:0');
    expect(facts).toHaveTextContent('AudioAAC stereo 48 kHz');
    expect(facts).toHaveTextContent('ContainerMP4');
    expect(facts).toHaveTextContent('Indexfront of file');
    expect(screen.queryByTestId('video-encode-reasons')).not.toBeInTheDocument();
    expect(screen.queryByTestId('video-encode-suggested')).not.toBeInTheDocument();
  });

  it('the 720p clip on a 4K fleet: index at the end is the warning, the size is a note, and the suggestion names the fleet size', () => {
    render(
      withTarget(
        <VideoEncodeCard
          asset={{
            ...SAFE,
            processingMeta: {
              ...SAFE.processingMeta,
              originalDimensions: { w: 1280, h: 720 },
              probe: { ...SAFE.processingMeta.probe, level: 31, bitrateKbps: 5_500, fastStart: false },
            },
          }}
          now={NOW}
        />,
        FOUR_K,
      ),
    );
    expect(screen.getByTestId('video-encode-card')).toHaveAttribute('data-encode-status', 'amber');
    expect(screen.getByText('May hitch or start slowly on some screens')).toBeInTheDocument();
    expect(screen.getByTestId('video-encode-reasons')).toHaveTextContent('The playback index is at the end of the file');
    expect(screen.getByTestId('video-encode-notes')).toHaveTextContent('1280 × 720 uses only part of your 3840 × 2160 screens');
    expect(screen.getByTestId('video-encode-suggested')).toHaveTextContent('Export from your original design at 3840 × 2160');
    expect(screen.getByTestId('video-encode-facts')).toHaveTextContent('Indexend of file');
    expect(screen.queryByText(/Canva/)).not.toBeInTheDocument();
  });

  it('a matching 4K Canva-style export needs only fast start, not a new resolution or audio track', () => {
    const asset = { ...SAFE, processingMeta: { ...SAFE.processingMeta,
      originalDimensions: { w: 3840, h: 2160 },
      probe: { ...SAFE.processingMeta.probe, level: 51, bitrateKbps: 30_000, fastStart: false, audio: null },
    } };
    render(withTarget(<VideoEncodeCard asset={asset} now={NOW} />, FOUR_K));
    const advice = screen.getByTestId('video-encode-suggested');
    expect(advice).toHaveTextContent('Suggested changes: Fast start: VenueOS attempts');
    expect(advice).toHaveTextContent('without changing picture quality or resolution');
    expect(advice).not.toHaveTextContent(/Export at|Use H.264|AAC|30 fps/);
  });

  it('a 4K file on a 4K fleet is green; on an unknown fleet it is red for the size', () => {
    const fourK = { ...SAFE, processingMeta: { ...SAFE.processingMeta, originalDimensions: { w: 3840, h: 2160 }, probe: { ...SAFE.processingMeta.probe, level: 51, bitrateKbps: 30_000 } } };
    const { unmount } = render(withTarget(<VideoEncodeCard asset={fourK} now={NOW} />, FOUR_K));
    expect(screen.getByTestId('video-encode-card')).toHaveAttribute('data-encode-status', 'green');
    unmount();
    render(<VideoEncodeCard asset={fourK} now={NOW} />);
    expect(screen.getByTestId('video-encode-card')).toHaveAttribute('data-encode-status', 'red');
    expect(screen.getByTestId('video-encode-reasons')).toHaveTextContent('3840 × 2160 — larger than your biggest screen (1920 × 1080)');
    expect(screen.getByTestId('video-encode-suggested')).toHaveTextContent("Export at 1920 × 1080");
  });

  it('says it is still checking a video uploaded seconds ago, and admits an unchecked legacy upload', () => {
    const { unmount } = render(<VideoEncodeCard asset={{ mimeType: 'video/mp4', processingMeta: null, createdAt: new Date(NOW - 10_000).toISOString() }} now={NOW} />);
    expect(screen.getByTestId('video-encode-card')).toHaveAttribute('data-encode-status', 'checking');
    expect(screen.getByText('Checking the encoding…')).toBeInTheDocument();
    unmount();
    render(<VideoEncodeCard asset={{ mimeType: 'video/mp4', processingMeta: null, createdAt: '2026-01-01T00:00:00Z' }} now={NOW} />);
    expect(screen.getByTestId('video-encode-card')).toHaveAttribute('data-encode-status', 'unknown');
    expect(screen.getByText('Encoding not checked yet')).toBeInTheDocument();
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

describe('VideoEncodeBadge', () => {
  it('renders nothing unless the grade warns', () => {
    for (const status of ['green', 'checking', 'unknown'] as const) {
      const { container, unmount } = render(<VideoEncodeBadge status={status} title="x" />);
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });

  it('is an icon only, carrying the reasons as its hover text and accessible name — no words on the tile', () => {
    render(<VideoEncodeBadge status="red" title={'Likely to stutter or fail on screen hardware\n3840 × 2160 — larger than your biggest screen'} />);
    const badge = screen.getByTestId('video-encode-badge');
    expect(badge).toHaveAttribute('data-encode-status', 'red');
    expect(badge.textContent).toBe('');
    expect(badge).toHaveAttribute('title', expect.stringContaining('larger than your biggest screen'));
    expect(badge).toHaveAttribute('aria-label', expect.stringContaining('Likely to stutter'));
  });
});

describe('AssetEncodeBadge', () => {
  const red = {
    ...SAFE,
    processingMeta: { ...SAFE.processingMeta, probe: { ...SAFE.processingMeta.probe, codec: 'hevc' } },
  };

  it('renders nothing for a safe video, a size-note-only video, or a non-video', () => {
    expect(render(<AssetEncodeBadge asset={SAFE} />).container).toBeEmptyDOMElement();
    // 1080p on a 4K fleet is a note, never a mark.
    expect(render(withTarget(<AssetEncodeBadge asset={SAFE} />, FOUR_K)).container).toBeEmptyDOMElement();
    expect(render(<AssetEncodeBadge asset={{ mimeType: 'image/png', processingMeta: red.processingMeta, createdAt: SAFE.createdAt }} />).container).toBeEmptyDOMElement();
  });

  it('on a tile it is a plain mark whose hover text carries the headline and every warning', () => {
    render(<AssetEncodeBadge asset={red} variant="onImage" />);
    const badge = screen.getByTestId('video-encode-badge');
    expect(badge.tagName).toBe('SPAN');
    expect(badge).toHaveAttribute('title', "Likely to stutter or fail on screen hardware\nH.265 / HEVC video — most screen players can't decode it in hardware");
  });

  it('on a row it is a button that opens the details popover on tap and closes on Escape', () => {
    render(<AssetEncodeBadge asset={red} interactive />);
    const button = screen.getByRole('button', { name: 'Playback details' });
    expect(screen.queryByTestId('video-encode-popover')).not.toBeInTheDocument();
    fireEvent.click(button);
    const popover = screen.getByTestId('video-encode-popover');
    expect(popover).toHaveTextContent('Likely to stutter or fail on screen hardware');
    expect(popover).toHaveTextContent('H.265 / HEVC video');
    expect(popover).toHaveTextContent("Suggested changes: Use H.264 video");
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('video-encode-popover')).not.toBeInTheDocument();
  });
});
