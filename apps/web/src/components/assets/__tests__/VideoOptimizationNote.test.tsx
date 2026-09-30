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
