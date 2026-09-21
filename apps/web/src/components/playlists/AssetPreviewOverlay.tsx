'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * One asset at full size, so an operator can confirm a slide is the content
 * they meant before it goes on a wall.
 *
 * Extracted 2026-09-21 from the playlist editor's item list (where it landed
 * on 2026-09-16: "i should be able to click on the image and it pulls up a
 * preview so i can make sure its the correct content") because the SAME need
 * turned up in the new-playlist wizard's "Selected media" list — six slides
 * all named "ChatGPT Image Jul 9, 2026 at 12_19_28 PM (n).png", a 48px
 * thumbnail each, and an order to get right:
 *   "i need to be able to open a preview of the images i added here to my
 *    playlist, so i can verify which is which and move around the order"
 * One component, so the two surfaces cannot drift.
 *
 * RULES THIS KEEPS
 *  • `object-contain`, never cropped, and it NEVER advances on its own — the
 *    operator steps with the arrows (Greg, 2026-09-16: no fast carousels, no
 *    cropped previews).
 *  • Portaled to <body> above every dialog: the wizard is itself a portaled
 *    modal at z-index 100, and an overlay rendered inside its scrolling panel
 *    would be clipped by it.
 *  • Escape closes THIS and nothing behind it. The wizard listens for Escape
 *    on `window` and would otherwise ask "discard your playlist?" underneath
 *    an open preview. The listener sits on `document`, which the event
 *    reaches BEFORE `window` while bubbling, so stopPropagation() here is
 *    enough — and it is only attached while a preview is open.
 *  • The backdrop is a real <button> (keyboard-dismissable, and the a11y lint
 *    baseline is a ratchet); it sits BEHIND the frame, so a click on the
 *    content never reaches it and the frame needs no stopPropagation.
 */
export interface AssetPreviewOverlayProps {
  /** Fully resolved URL of the file. Absent ⇒ "nothing to preview". */
  url: string | null | undefined;
  mimeType?: string | null;
  name: string;
  onClose: () => void;
  /** Present ⇒ a "previous" control (and ←). Omit at the start of a list. */
  onPrev?: () => void;
  /** Present ⇒ a "next" control (and →). Omit at the end of a list. */
  onNext?: () => void;
  /** e.g. "2 of 6" — where this item sits in the order being arranged. */
  position?: string;
}

export function AssetPreviewOverlay({ url, mimeType, name, onClose, onPrev, onNext, position }: AssetPreviewOverlayProps) {
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      } else if (e.key === 'ArrowLeft' && onPrev) {
        e.stopPropagation();
        onPrev();
      } else if (e.key === 'ArrowRight' && onNext) {
        e.stopPropagation();
        onNext();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, onPrev, onNext]);

  // Land the keyboard inside the dialog so Escape / arrows / Tab start here
  // rather than on whatever row was clicked behind the scrim.
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  if (typeof document === 'undefined') return null;

  const type = String(mimeType || '');
  const isVideo = type.startsWith('video/');
  const isImage = type.startsWith('image/');
  const stepBtn =
    'shrink-0 w-11 h-11 rounded-full bg-white/90 hover:bg-white text-slate-800 flex items-center justify-center shadow-lg disabled:opacity-30 disabled:cursor-default';

  return createPortal(
    <div
      className="fixed top-0 right-0 bottom-0 left-0 z-[200] bg-black/70 md:backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Preview: ${name}`}
      data-testid="playlist-item-preview"
    >
      <button
        type="button"
        aria-label="Close preview"
        onClick={onClose}
        className="absolute top-0 right-0 bottom-0 left-0 cursor-default"
        data-testid="playlist-item-preview-backdrop"
      />
      <div className="relative flex items-center gap-3 max-w-[96vw]">
        {(onPrev || onNext) && (
          <button type="button" onClick={onPrev} disabled={!onPrev} aria-label="Previous item" className={stepBtn}>
            <ChevronLeft className="w-6 h-6" aria-hidden />
          </button>
        )}
        <div className="flex flex-col items-center gap-3 min-w-0">
          {url && isVideo && (
            <video src={url} controls autoPlay className="max-w-full max-h-[76vh] rounded-xl bg-black shadow-2xl" />
          )}
          {url && isImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt={name} className="max-w-full max-h-[76vh] rounded-xl bg-white object-contain shadow-2xl" />
          )}
          {url && !isVideo && !isImage && (
            <div className="rounded-xl bg-white/95 px-6 py-5 text-center shadow-2xl">
              <p className="text-sm font-semibold text-slate-800">This file type can’t be previewed here.</p>
              <a href={url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-sm font-bold text-indigo-600 hover:underline">
                Open it in a new tab
              </a>
            </div>
          )}
          {!url && <p className="text-white/90 text-sm font-semibold">This item has no file to preview.</p>}
          <div className="flex items-center gap-3 max-w-full">
            {position && (
              <span className="shrink-0 rounded-full bg-white/15 px-2.5 py-1 text-[12px] font-bold text-white tabular-nums" data-testid="playlist-item-preview-position">
                {position}
              </span>
            )}
            <p className="text-white text-[13px] font-semibold truncate max-w-[52vw]" title={name}>{name}</p>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              className="shrink-0 px-3 py-1.5 rounded-lg bg-white/90 hover:bg-white text-slate-800 text-xs font-bold"
            >
              Close
            </button>
          </div>
        </div>
        {(onPrev || onNext) && (
          <button type="button" onClick={onNext} disabled={!onNext} aria-label="Next item" className={stepBtn}>
            <ChevronRight className="w-6 h-6" aria-hidden />
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
