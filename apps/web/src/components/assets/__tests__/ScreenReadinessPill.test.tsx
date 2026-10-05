import { render, screen } from '@testing-library/react';
import { ScreenReadinessPill } from '../ScreenReadinessPill';

const video = (stamp?: unknown) => ({
  mimeType: 'video/mp4',
  processingMeta: stamp === undefined ? null : { screen: stamp },
});

describe('ScreenReadinessPill — a video the screens are not playing, marked where it is scheduled', () => {
  it('converting → "Not playing yet — converting", saying when it will play', () => {
    render(<ScreenReadinessPill asset={video({ version: 1, ready: false, pending: true, issues: ['codec'], checkedAt: 'x' })} />);
    const pill = screen.getByTestId('screen-ready-pill');
    expect(pill).toHaveAttribute('data-screen-ready', 'converting');
    expect(pill).toHaveTextContent('Not playing yet — converting');
    expect(pill).toHaveAttribute('title', 'Converting for screens — it will start playing when the copy is ready');
  });

  it('failed → "Can\'t play on screens", with the reason and what to do', () => {
    render(
      <ScreenReadinessPill asset={video({ version: 1, ready: false, issues: ['codec'], error: 'probe-failed', checkedAt: 'x' })} />,
    );
    const pill = screen.getByTestId('screen-ready-pill');
    expect(pill).toHaveAttribute('data-screen-ready', 'failed');
    expect(pill).toHaveTextContent("Can't play on screens");
    expect(pill).toHaveAttribute(
      'title',
      "This video could not be converted for screens: the file couldn't be read as a video. Export it as MP4 (H.264) and upload it again.",
    );
  });

  it('over a thumbnail (a ~150 px picker tile) the words are SHORT; the full sentence stays the hover text', () => {
    const { unmount } = render(
      <ScreenReadinessPill asset={video({ version: 1, ready: false, pending: true, checkedAt: 'x' })} variant="onImage" />,
    );
    expect(screen.getByTestId('screen-ready-pill')).toHaveTextContent(/^Converting:/); // + the sr-only sentence
    expect(screen.getByTestId('screen-ready-pill')).toHaveAttribute(
      'title',
      'Converting for screens — it will start playing when the copy is ready',
    );
    unmount();
    render(
      <ScreenReadinessPill asset={video({ version: 1, ready: false, error: 'ffmpeg-failed', checkedAt: 'x' })} variant="onImage" />,
    );
    expect(screen.getByTestId('screen-ready-pill')).toHaveTextContent(/^Can't play:/);
  });

  it.each([
    ['ready as uploaded', video({ version: 1, ready: true, checkedAt: 'x' })],
    ['converted', video({ version: 1, ready: true, convertedFrom: ['codec'], checkedAt: 'x' })],
    ['no verdict (every video from before it existed)', video()],
    ['a picture', { mimeType: 'image/png', processingMeta: { screen: { version: 1, ready: false, checkedAt: 'x' } } }],
    ['nothing', null],
  ])('%s → nothing', (_label, asset) => {
    const { container } = render(<ScreenReadinessPill asset={asset} />);
    expect(container).toBeEmptyDOMElement();
  });
});
