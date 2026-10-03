"use client";

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ScaledTemplateThumbnail } from './ScaledTemplateThumbnail';
import type { TemplatePreview } from '@/lib/template-preview';
import { useHoverPreview } from '@/lib/use-hover-preview';

/**
 * A live template render is a whole document (and, for a menu board, a POS
 * read), so it must not start for a cursor that is only crossing the row on
 * its way somewhere else: the pointer has to rest this long first.
 */
export const TEMPLATE_HOVER_INTENT_MS = 250;

/**
 * A template's SAVED artwork at rest; on an intentional mouse/pen hover, the
 * template itself, live — so a board whose own carousel is configured can be
 * watched running. Leaving puts the saved artwork back.
 *
 * HOW the hand-over is seamless: the saved artwork (the poster picture, or the
 * frozen frame of a customised board) is never touched. The live render is a
 * SECOND, separate layer mounted ON TOP of it for as long as the preview runs,
 * with `pointer-events: none`. So:
 *   - while the live frame is still loading, the saved artwork is what shows —
 *     there is nothing to flash to;
 *   - on leaving, the live layer is simply removed; the artwork underneath was
 *     never replaced, so there is nothing to reload;
 *   - ScaledTemplateThumbnail itself is unchanged, so every other surface that
 *     draws it (the gallery, the builder, the full-screen preview) is too.
 *
 * Hover rules (mouse/pen only, one preview page-wide, stops on leave / hidden
 * tab / scrolled away, nothing running at rest) are `useHoverPreview`'s.
 *
 * `maxHeight` / `framed`: by default the artwork is fitted to whatever frame
 * it is placed in (measured) and runs edge to edge — what the dashboard and the
 * screens table want. A surface that has always drawn it at a fixed height in
 * its own framed card (the playlist library) passes both to keep that look.
 */
export function TemplateContentThumb({
  template,
  name,
  maxHeight,
  framed = false,
}: {
  template: TemplatePreview;
  name?: string | null;
  /** A fixed fit height. Omit to fit the frame this is placed in. */
  maxHeight?: number;
  /** Draw ScaledTemplateThumbnail's own rounded border and shadow. */
  framed?: boolean;
}) {
  const t = useTranslations('playlistsPage');
  const frame = useRef<HTMLSpanElement>(null);
  const [measured, setMeasured] = useState(100);
  const live = useHoverPreview(frame, { intentMs: TEMPLATE_HOVER_INTENT_MS });

  useEffect(() => {
    if (maxHeight !== undefined) return;
    const node = frame.current;
    if (!node) return;
    const measure = () => { const h = node.getBoundingClientRect().height; if (h > 0) setMeasured(h); };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [maxHeight]);

  const height = maxHeight ?? measured;
  // Only what the thumbnail draws from — not every field of the template record.
  const artwork = {
    zones: template.zones,
    screenWidth: template.screenWidth,
    screenHeight: template.screenHeight,
    bgImage: template.bgImage,
    bgGradient: template.bgGradient,
    bgColor: template.bgColor,
  };
  return (
    <span
      ref={frame}
      className="relative flex h-full w-full items-center justify-center overflow-hidden"
      role="img"
      aria-label={name ? t('templatePreviewOf', { name }) : t('templatePreview')}
      data-template-preview={live ? 'live' : 'rest'}
    >
      <ScaledTemplateThumbnail {...artwork} freeze flush={!framed} maxHeight={height} />
      {live && (
        <span className="absolute top-0 right-0 bottom-0 left-0 flex items-center justify-center pointer-events-none" aria-hidden data-template-live>
          <ScaledTemplateThumbnail {...artwork} freeze={false} flush={!framed} maxHeight={height} />
        </span>
      )}
    </span>
  );
}
