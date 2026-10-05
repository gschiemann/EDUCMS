import React from 'react';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import '../../../../../test-mocks/pointer-event-polyfill';
import { ExpectedThumb } from '../ExpectedThumb';
import { TEMPLATE_HOVER_INTENT_MS } from '@/components/templates/TemplateContentThumb';
import { IMAGE_PREVIEW_FADE_MS, IMAGE_PREVIEW_FIRST_STEP_MS, IMAGE_PREVIEW_HOLD_MS } from '@/components/playlists/ImageSequenceThumb';

// The template cases only need to see HOW the thumbnail was asked to draw.
jest.mock('@/components/templates/ScaledTemplateThumbnail', () => ({
  ScaledTemplateThumbnail: ({ freeze }: { freeze?: boolean }) => <span data-testid="board" data-frozen={String(!!freeze)} />,
}));

/**
 * Operator, 2026-09-01: "only images preview and not templates ... everything
 * should preview." These lock each preview kind to a real rendered element, so
 * a regression shows up as a blank grey box in the test, not on a wall.
 */
afterEach(cleanup);

const base = { name: 'LED posters', thumbnailTint: null, posterUrl: null } as const;

describe('ExpectedThumb', () => {
  it('renders a still as an image', () => {
    render(<ExpectedThumb expected={{ ...base, thumbnailUrl: '/a.png', thumbnailKind: 'still' }} />);
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', '/a.png');
    expect(img).toHaveAccessibleName('First slide of LED posters');
  });

  it('renders a board poster, and its alt says it is the template look — not the glass', () => {
    render(<ExpectedThumb expected={{ ...base, thumbnailUrl: '/templates/_thumbs/a.png', thumbnailKind: 'board' }} />);
    expect(screen.getByRole('img')).toHaveAccessibleName(/the template's own look/i);
  });

  it('renders a video as its poster frame at rest — a plain image, no video bytes (2026-09-24)', () => {
    const { container } = render(
      <ExpectedThumb expected={{ ...base, thumbnailUrl: '/clip.mp4', thumbnailKind: 'frame', posterUrl: '/clip.jpg' }} />,
    );
    expect(container.querySelector('img')).toHaveAttribute('src', '/clip.jpg');
    const v = container.querySelector('video');
    expect(v).toBeTruthy();
    expect(v).toHaveAttribute('preload', 'none');
    // A table full of rows must never make noise or move.
    expect((v as HTMLVideoElement).muted || v!.hasAttribute('muted')).toBe(true);
    expect(v!.hasAttribute('autoplay')).toBe(false);
  });

  it('without a poster, falls back to a muted, non-autoplaying first frame', () => {
    const { container } = render(
      <ExpectedThumb expected={{ ...base, thumbnailUrl: '/clip.mp4', thumbnailKind: 'frame', posterUrl: null }} />,
    );
    const v = container.querySelector('video');
    expect(v).toBeTruthy();
    expect(v!.getAttribute('src')).toContain('/clip.mp4');
    expect(v).toHaveAttribute('preload', 'metadata');
    expect((v as HTMLVideoElement).muted || v!.hasAttribute('muted')).toBe(true);
    expect(v!.hasAttribute('autoplay')).toBe(false);
  });

  it('paints the board background when there is no poster', () => {
    const { container } = render(
      <ExpectedThumb expected={{ ...base, thumbnailUrl: null, thumbnailKind: 'tint', thumbnailTint: 'rgb(10, 20, 30)' }} />,
    );
    expect((container.firstChild as HTMLElement).style.backgroundColor).toBe('rgb(10, 20, 30)');
  });

  it('treats a gradient tint as an image, not a colour', () => {
    const { container } = render(
      <ExpectedThumb expected={{ ...base, thumbnailUrl: null, thumbnailKind: 'tint', thumbnailTint: 'linear-gradient(#fff,#000)' }} />,
    );
    expect((container.firstChild as HTMLElement).style.backgroundImage).toContain('linear-gradient');
  });

  it('falls back to the neutral tile when a poster 404s, never a broken image', () => {
    const { container } = render(
      <ExpectedThumb expected={{ ...base, thumbnailUrl: '/templates/_thumbs/missing.png', thumbnailKind: 'board' }} />,
    );
    fireEvent.error(screen.getByRole('img'));
    expect(container.querySelector('img')).toBeNull();
    expect(container.firstChild).toBeTruthy();
  });

  it('renders an empty tile when there is nothing to show', () => {
    const { container } = render(
      <ExpectedThumb expected={{ ...base, thumbnailUrl: null, thumbnailKind: 'none' }} />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('video')).toBeNull();
  });
});

describe('a website', () => {
  it('renders its real screenshot through the shared preview component — never the page address as an <img src>', () => {
    render(<ExpectedThumb expected={{ ...base, thumbnailKind: 'website', thumbnailUrl: 'https://www.example.test' }} />);
    const img = screen.getByRole('img');
    expect(img).toHaveAccessibleName('Website preview of LED posters');
    expect(img).toHaveAttribute('src', `https://s.wordpress.com/mshots/v1/${encodeURIComponent('https://www.example.test')}?w=640&h=360`);
  });

  it('an address that must not be sent (private network) is the labelled globe, with no image request', () => {
    const { container } = render(<ExpectedThumb expected={{ ...base, thumbnailKind: 'website', thumbnailUrl: 'http://192.168.1.20/menu' }} />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('img')).toHaveAccessibleName('Website preview of LED posters unavailable');
  });
});

describe('several images', () => {
  const frames = ['a', 'b', 'c'].map((id) => ({ url: `https://cdn.example.test/${id}.png` }));
  const several = { ...base, thumbnailKind: 'still', thumbnailUrl: frames[0].url, thumbnailFrames: frames } as const;

  it('is the first image at rest — one <img>, whole picture, nothing moving', () => {
    jest.useFakeTimers();
    try {
      const { container } = render(<ExpectedThumb expected={several} />);
      expect(screen.getByRole('img')).toHaveAccessibleName('Scheduled image preview of LED posters');
      expect(container.querySelectorAll('img')).toHaveLength(1);
      expect(container.querySelector('img')!.className).toContain('object-contain');
      expect(jest.getTimerCount()).toBe(0);
      act(() => { jest.advanceTimersByTime(60_000); });
      expect(container.querySelectorAll('img')).toHaveLength(1);
    } finally { jest.useRealTimers(); }
  });

  it('a mouse hover starts the walk (one preloaded standby, the hold running); a tap does not', () => {
    jest.useFakeTimers();
    try {
      const { container } = render(<ExpectedThumb expected={several} />);
      const root = container.querySelector('[data-image-sequence]')!;
      fireEvent.pointerEnter(root, { pointerType: 'touch' });
      expect(container.querySelectorAll('img')).toHaveLength(1);
      fireEvent.pointerEnter(root, { pointerType: 'mouse' });
      expect(container.querySelectorAll('img')).toHaveLength(2);
      expect(jest.getTimerCount()).toBe(1);
      fireEvent.pointerLeave(root);
      expect(container.querySelectorAll('img')).toHaveLength(1);
      expect(jest.getTimerCount()).toBe(0);
    } finally { jest.useRealTimers(); }
  });

  it('is QUICK under the pointer on the Screens page and dashboards: ~350 ms to the first step, then 1.2 s a picture, 250 ms fade', () => {
    jest.useFakeTimers();
    try {
      const { container } = render(<ExpectedThumb expected={several} />);
      const root = container.querySelector('[data-image-sequence]')!;
      const standby = () => container.querySelector('img[aria-hidden="true"]') as HTMLImageElement;
      const shown = () => Number(root.getAttribute('data-preview-index'));
      // The numbers the owner asked for, pinned here as well because this is the surface he reads them on.
      expect([IMAGE_PREVIEW_FIRST_STEP_MS, IMAGE_PREVIEW_HOLD_MS, IMAGE_PREVIEW_FADE_MS]).toEqual([350, 1200, 250]);

      fireEvent.pointerEnter(root, { pointerType: 'mouse' });
      fireEvent.load(standby());
      act(() => { jest.advanceTimersByTime(349); });
      expect(standby().style.opacity).toBe('0'); // a pointer crossing the row has not flipped anything
      act(() => { jest.advanceTimersByTime(1); });
      expect(standby().style.opacity).toBe('1');
      act(() => { jest.advanceTimersByTime(250); });
      expect(shown()).toBe(1);

      fireEvent.load(standby());
      act(() => { jest.advanceTimersByTime(1199); });
      expect(shown()).toBe(1);
      expect(standby().style.opacity).toBe('0');
      act(() => { jest.advanceTimersByTime(1); });
      expect(standby().style.opacity).toBe('1');
    } finally { jest.useRealTimers(); }
  });

  it('a touch tap on the same thumbnail never starts it', () => {
    jest.useFakeTimers();
    try {
      const { container } = render(<ExpectedThumb expected={several} />);
      const root = container.querySelector('[data-image-sequence]')!;
      fireEvent.pointerEnter(root, { pointerType: 'touch' });
      act(() => { jest.advanceTimersByTime(30_000); });
      expect(container.querySelectorAll('img')).toHaveLength(1);
      expect(root.getAttribute('data-preview-index')).toBe('0');
      expect(jest.getTimerCount()).toBe(0);
    } finally { jest.useRealTimers(); }
  });

  it('one image (or an empty list) stays the plain first-slide image', () => {
    render(<ExpectedThumb expected={{ ...base, thumbnailKind: 'still', thumbnailUrl: '/a.png', thumbnailFrames: [{ url: '/a.png' }] }} />);
    expect(screen.getByRole('img')).toHaveAccessibleName('First slide of LED posters');
  });
});

describe('the whole picture, never cropped', () => {
  it.each([
    ['a still', { thumbnailKind: 'still', thumbnailUrl: '/a.png' }],
    ['a board poster', { thumbnailKind: 'board', thumbnailUrl: '/templates/_thumbs/a.png' }],
  ] as const)('%s is object-contain', (_label, shape) => {
    render(<ExpectedThumb expected={{ ...base, ...shape }} />);
    expect(screen.getByRole('img').className).toContain('object-contain');
    expect(screen.getByRole('img').className).not.toContain('object-cover');
  });
});

describe('a template', () => {
  const template = { id: 'board', screenWidth: 1920, screenHeight: 1080, zones: [{ widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, defaultConfig: { url: '/templates/example.html' } }] };
  const previousObserver = global.ResizeObserver;
  beforeAll(() => { global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver; });
  afterAll(() => { global.ResizeObserver = previousObserver; });

  it('is its saved artwork at rest and runs live, on top, only under an intentional mouse hover', () => {
    jest.useFakeTimers();
    try {
      const { container } = render(<ExpectedThumb expected={{ ...base, name: 'Board', thumbnailKind: 'board', thumbnailUrl: null, templatePreview: template }} />);
      const surface = container.querySelector('[data-template-preview]')!;
      expect(screen.getByRole('img')).toHaveAccessibleName('Saved template preview of Board');
      expect(screen.getAllByTestId('board')).toHaveLength(1);
      fireEvent.pointerEnter(surface, { pointerType: 'mouse' });
      act(() => { jest.advanceTimersByTime(TEMPLATE_HOVER_INTENT_MS); });
      expect(screen.getAllByTestId('board').map((b) => b.getAttribute('data-frozen'))).toEqual(['true', 'false']);
      fireEvent.pointerLeave(surface);
      expect(screen.getAllByTestId('board')).toHaveLength(1);
    } finally { jest.useRealTimers(); }
  });
});
