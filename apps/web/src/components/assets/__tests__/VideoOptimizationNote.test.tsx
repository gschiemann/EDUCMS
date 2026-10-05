import { render, screen } from '@testing-library/react';
import { VideoOptimizationNote } from '../VideoOptimizationNote';

const fmtSize = (bytes: number | null | undefined) => `${bytes ?? 0} bytes`;

describe('1080p playback copy status', () => {
  it('distinguishes waiting in the queue from active encoding', () => {
    render(<VideoOptimizationNote optimization={{ status: 'queued', reason: null, progress: null, sourceBytes: 42, outputBytes: null, finishedAt: null }} variant="card" fmtSize={fmtSize} />);
    expect(screen.getByTestId('video-optimizing')).toHaveTextContent('Waiting for screen compatibility check');
    expect(screen.getByTestId('video-optimizing')).not.toHaveTextContent('Optimizing for screens');
  });

  it('calls an initial probe a compatibility check', () => {
    render(<VideoOptimizationNote optimization={{ status: 'running', reason: null, progress: null, sourceBytes: 42, outputBytes: null, finishedAt: null }} variant="card" fmtSize={fmtSize} />);
    expect(screen.getByTestId('video-optimizing')).toHaveTextContent('Checking screen compatibility');
  });

  it('shows the verified copy attached to the original asset', () => {
    render(<VideoOptimizationNote optimization={null} rendition={{ url: 'https://example.com/1080.mp4', sha256: 'a'.repeat(64), width: 1920, height: 1080, size: 42_000 }} variant="detail" fmtSize={fmtSize} />);
    expect(screen.getByTestId('video-rendition-ready')).toHaveTextContent('Optional 1080p copy for smaller screens · 1920 × 1080 · 42000 bytes');
  });

  it('keeps completed 4K optimization details in the file panel', () => {
    render(<VideoOptimizationNote
      optimization={{ status: 'done', reason: 'swapped', progress: 100, sourceBytes: 100_000, outputBytes: 60_000, finishedAt: null }}
      rendition={{ url: 'https://example.com/1080.mp4', sha256: 'a'.repeat(64), width: 1920, height: 1080, size: 20_000 }}
      variant="detail" fmtSize={fmtSize}
    />);
    expect(screen.getByTestId('video-rendition-ready')).toHaveTextContent('Optional 1080p copy for smaller screens');
    expect(screen.getByTestId('video-rendition-ready')).toHaveTextContent('Optimization complete: 100000 bytes → 60000 bytes');
  });

  it('shows encoder progress while the copy is being prepared', () => {
    render(<VideoOptimizationNote optimization={{ status: 'running', reason: null, progress: 48, sourceBytes: null, outputBytes: null, finishedAt: null }} variant="detail" fmtSize={fmtSize} />);
    expect(screen.getByTestId('video-optimizing')).toHaveTextContent('48%');
  });
});

// 2026-10-05 — the screen-ready verdict decides the words: it is what the
// screens act on (a converting / failed video is not handed to any screen).
describe('the screen-ready verdict', () => {
  const running = (progress: number | null) =>
    ({ status: 'running', reason: null, progress, sourceBytes: 100, outputBytes: null, finishedAt: null }) as const;

  it('converting, in the file details: says it will play when the copy is ready, with the job’s progress', () => {
    render(
      <VideoOptimizationNote
        optimization={running(42)}
        screen={{ kind: 'converting', progress: 42, queued: false }}
        variant="detail"
        fmtSize={fmtSize}
      />,
    );
    expect(screen.getByTestId('screen-converting')).toHaveTextContent(
      'Converting for screens — it will start playing when the copy is ready · 42%',
    );
    expect(screen.queryByTestId('video-optimizing')).toBeNull(); // not two lines saying the same thing
  });

  it('converting with no progress yet, in the details: the sentence alone', () => {
    render(<VideoOptimizationNote optimization={null} screen={{ kind: 'converting', progress: null, queued: false }} variant="detail" fmtSize={fmtSize} />);
    expect(screen.getByTestId('screen-converting')).toHaveTextContent(
      /^Converting for screens — it will start playing when the copy is ready$/,
    );
  });

  it('converting, on a card: short, with the percentage; waiting in the queue says so', () => {
    const { unmount } = render(
      <VideoOptimizationNote optimization={running(7)} screen={{ kind: 'converting', progress: 7, queued: false }} variant="card" fmtSize={fmtSize} />,
    );
    expect(screen.getByTestId('screen-converting')).toHaveTextContent('Converting for screens… 7%');
    unmount();
    render(<VideoOptimizationNote optimization={null} screen={{ kind: 'converting', progress: null, queued: true }} variant="row" fmtSize={fmtSize} />);
    expect(screen.getByTestId('screen-converting')).toHaveTextContent('Waiting to convert for screens…');
  });

  it('failed, in the file details: the plain reason and what to do — never "screens play the file as uploaded"', () => {
    render(
      <VideoOptimizationNote
        optimization={{ status: 'failed', reason: 'ffmpeg-failed', progress: null, sourceBytes: 100, outputBytes: null, finishedAt: null }}
        screen={{ kind: 'failed', reason: 'failed' }}
        variant="detail"
        fmtSize={fmtSize}
      />,
    );
    expect(screen.getByTestId('screen-convert-failed')).toHaveTextContent(
      'This video could not be converted for screens: the conversion failed. Export it as MP4 (H.264) and upload it again.',
    );
    // The job's old sentence would contradict what the screens now do.
    expect(screen.queryByText(/screens play the file as uploaded/)).toBeNull();
  });

  it('failed, on a card: a visible warning, with the full sentence for hover and screen readers', () => {
    render(<VideoOptimizationNote optimization={null} screen={{ kind: 'failed', reason: 'tooSlow' }} variant="card" fmtSize={fmtSize} />);
    const warning = screen.getByTestId('screen-cant-play');
    expect(warning).toHaveTextContent("Can't play on screens");
    expect(warning).toHaveAttribute('title', expect.stringMatching(/converting it took too long/));
    expect(warning).toHaveTextContent(/Export it as MP4 \(H\.264\)/); // sr-only half
  });

  it('converted, in the file details: what it was converted from, beside the existing optimization line', () => {
    render(
      <VideoOptimizationNote
        optimization={{ status: 'done', reason: 'swapped', progress: 100, sourceBytes: 100_000, outputBytes: 60_000, finishedAt: null }}
        screen={{ kind: 'converted', from: ['codec', 'hdr', 'frame-rate'], codecIn: 'hevc' }}
        variant="detail"
        fmtSize={fmtSize}
      />,
    );
    expect(screen.getByTestId('screen-converted')).toHaveTextContent('Converted for screens (was H.265 / HEVC, HDR, over 30 fps).');
    expect(screen.getByTestId('video-optimized-detail')).toHaveTextContent('100000 bytes → 60000 bytes');
  });

  it('converted with NO job row: the line still shows (the verdict is on the asset itself)', () => {
    render(<VideoOptimizationNote optimization={null} screen={{ kind: 'converted', from: ['container'], codecIn: null }} variant="detail" fmtSize={fmtSize} />);
    expect(screen.getByTestId('screen-converted')).toHaveTextContent('Converted for screens (was not MP4).');
  });

  it('converted says nothing on a card (details only — a tile carries only states that change what to do)', () => {
    const { container } = render(
      <VideoOptimizationNote optimization={null} screen={{ kind: 'converted', from: ['codec'], codecIn: 'hevc' }} variant="card" fmtSize={fmtSize} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
