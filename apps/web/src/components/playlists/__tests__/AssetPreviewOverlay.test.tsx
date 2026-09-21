/**
 * The shared full-size preview.
 *
 * Greg, 2026-09-21, new-playlist wizard, six slides all named
 * "ChatGPT Image Jul 9, 2026 at 12_19_28 PM (n).png":
 *   "i need to be able to open a preview of the images i added here to my
 *    playlist, so i can verify which is which and move around the order"
 */
import * as React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { AssetPreviewOverlay } from '../AssetPreviewOverlay';

const IMG = { url: 'https://cdn.test/slide-3.png', mimeType: 'image/png', name: 'slide 3.png' };

describe('AssetPreviewOverlay', () => {
  it('shows the image UNCROPPED (object-contain), named, with its place in the order', () => {
    render(<AssetPreviewOverlay {...IMG} position="3 of 6" onClose={() => {}} />);
    const img = screen.getByRole('img', { name: 'slide 3.png' });
    expect(img).toHaveAttribute('src', IMG.url);
    expect(img.className).toMatch(/\bobject-contain\b/);
    expect(img.className).not.toMatch(/object-cover/);
    expect(screen.getByTestId('playlist-item-preview-position')).toHaveTextContent('3 of 6');
    expect(screen.getByRole('dialog', { name: 'Preview: slide 3.png' })).toBeInTheDocument();
  });

  it('is portaled to <body>, so a scrolling panel inside a modal cannot clip it', () => {
    const { container } = render(
      <div style={{ overflow: 'hidden', height: 40 }}>
        <AssetPreviewOverlay {...IMG} onClose={() => {}} />
      </div>,
    );
    expect(container.querySelector('[data-testid="playlist-item-preview"]')).toBeNull();
    expect(document.body.querySelector('[data-testid="playlist-item-preview"]')).not.toBeNull();
  });

  it('a video plays in a <video>, not an <img>', () => {
    render(<AssetPreviewOverlay url="https://cdn.test/clip.mp4" mimeType="video/mp4" name="clip.mp4" onClose={() => {}} />);
    expect(document.body.querySelector('video')).toHaveAttribute('src', 'https://cdn.test/clip.mp4');
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('a file type it cannot draw says so and offers the file, instead of a broken image', () => {
    render(<AssetPreviewOverlay url="https://cdn.test/menu.pdf" mimeType="application/pdf" name="menu.pdf" onClose={() => {}} />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText(/can’t be previewed here/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open it in a new tab/i })).toHaveAttribute('href', 'https://cdn.test/menu.pdf');
  });

  it('closes from the Close button and from the backdrop', () => {
    const onClose = jest.fn();
    render(<AssetPreviewOverlay {...IMG} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByTestId('playlist-item-preview-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('steps with the arrows and with ← / →, and the ends of the list are dead ends', () => {
    const onPrev = jest.fn();
    const onNext = jest.fn();
    const { rerender } = render(<AssetPreviewOverlay {...IMG} onClose={() => {}} onPrev={onPrev} onNext={onNext} />);
    fireEvent.click(screen.getByRole('button', { name: 'Next item' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous item' }));
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    expect(onNext).toHaveBeenCalledTimes(2);
    expect(onPrev).toHaveBeenCalledTimes(2);

    // First item of a list: no previous.
    rerender(<AssetPreviewOverlay {...IMG} onClose={() => {}} onNext={onNext} />);
    expect(screen.getByRole('button', { name: 'Previous item' })).toBeDisabled();
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    expect(onPrev).toHaveBeenCalledTimes(2);
  });

  it('a single preview (no list) draws no arrows at all', () => {
    render(<AssetPreviewOverlay {...IMG} onClose={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Next item' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Previous item' })).toBeNull();
  });

  // The new-playlist wizard listens for Escape on `window` and answers with
  // "discard this playlist?". An Escape meant for the preview must stop here.
  it('Escape closes the preview and NEVER reaches a window-level listener behind it', () => {
    const hostEscape = jest.fn();
    const onWindowKey = (e: KeyboardEvent) => { if (e.key === 'Escape') hostEscape(); };
    window.addEventListener('keydown', onWindowKey);
    try {
      const onClose = jest.fn();
      render(<AssetPreviewOverlay {...IMG} onClose={onClose} />);
      fireEvent.keyDown(document.body, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(hostEscape).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', onWindowKey);
    }
  });

  it('once it is gone, Escape reaches the host again', () => {
    const hostEscape = jest.fn();
    const onWindowKey = (e: KeyboardEvent) => { if (e.key === 'Escape') hostEscape(); };
    window.addEventListener('keydown', onWindowKey);
    try {
      const { unmount } = render(<AssetPreviewOverlay {...IMG} onClose={() => {}} />);
      unmount();
      fireEvent.keyDown(document.body, { key: 'Escape' });
      expect(hostEscape).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('keydown', onWindowKey);
    }
  });
});
