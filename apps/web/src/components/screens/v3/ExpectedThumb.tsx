"use client";

/**
 * ExpectedThumb — the picture of what is SCHEDULED for a screen.
 *
 * Operator, 2026-09-01: "only images preview and not templates ... everything
 * should preview." A playlist that IS a board, or that holds only video, drew
 * a blank grey box. `previewOf` in screenOps.ts picks the best available
 * picture; this renders it, and — because this is VenueOS — is careful never
 * to let a preview read as evidence of what is actually on the glass.
 *
 * Two rules it must keep:
 *  1. This is the EXPECTED look, never a capture. The alt text says so.
 *  2. A board poster is the template's PRISTINE look. If the operator applied
 *     brand or text overrides, the poster does not reflect them, so it is
 *     never captioned as "what the screen shows".
 */

import React, { useState } from 'react';
import type { ExpectedContent } from './screenOps';
import { VideoPreviewThumb } from '@/components/playlists/VideoPreviewThumb';

export function ExpectedThumb({
  expected,
  className = '',
  rounded = 'rounded-md',
}: {
  expected: Pick<ExpectedContent, 'thumbnailUrl' | 'thumbnailKind' | 'thumbnailTint' | 'name' | 'posterUrl'>;
  className?: string;
  rounded?: string;
}) {
  // A poster PNG can 404 (a custom board nobody generated one for). Fall back
  // to the neutral tile rather than showing a broken-image glyph.
  const [failed, setFailed] = useState(false);
  const base = `${className} ${rounded} bg-slate-100 overflow-hidden`;
  const of = expected.name ? ` of ${expected.name}` : '';

  if (expected.thumbnailUrl && !failed) {
    if (expected.thumbnailKind === 'frame') {
      // 2026-09-24 — the poster frame at rest, hover to play, first-frame
      // fallback without a poster; the same tile every playlist surface
      // draws. The old <video preload="metadata"> painted nothing on a
      // touch screen (Greg, on an iPad: a blank grey box).
      return (
        <span className={`${base} block`}>
          <VideoPreviewThumb
            src={expected.thumbnailUrl}
            posterUrl={expected.posterUrl}
            className="w-full h-full object-cover"
          />
        </span>
      );
    }
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={expected.thumbnailUrl}
        alt={
          expected.thumbnailKind === 'board'
            ? `Scheduled board${of} — the template's own look`
            : `First slide${of}`
        }
        className={`${base} object-cover`}
        onError={() => setFailed(true)}
      />
    );
  }

  if (expected.thumbnailKind === 'tint' && expected.thumbnailTint && !failed) {
    const tint = expected.thumbnailTint;
    const isImage = tint.startsWith('url(');
    return (
      <span
        className={`${base} block`}
        style={
          isImage
            ? { backgroundImage: tint, backgroundSize: 'cover', backgroundPosition: 'center' }
            : tint.includes('gradient')
              ? { backgroundImage: tint }
              : { backgroundColor: tint }
        }
        aria-hidden
      />
    );
  }

  return <span className={`${base} block`} aria-hidden />;
}
