import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ExpectedThumb } from '../ExpectedThumb';

/**
 * Operator, 2026-09-01: "only images preview and not templates ... everything
 * should preview." These lock each preview kind to a real rendered element, so
 * a regression shows up as a blank grey box in the test, not on a wall.
 */
afterEach(cleanup);

const base = { name: 'LED posters', thumbnailTint: null } as const;

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

  it('renders a video as a muted, non-autoplaying video element', () => {
    const { container } = render(
      <ExpectedThumb expected={{ ...base, thumbnailUrl: '/clip.mp4', thumbnailKind: 'frame' }} />,
    );
    const v = container.querySelector('video');
    expect(v).toBeTruthy();
    expect(v).toHaveAttribute('src', '/clip.mp4');
    expect(v).toHaveAttribute('preload', 'metadata');
    // A table full of rows must never make noise or move.
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
