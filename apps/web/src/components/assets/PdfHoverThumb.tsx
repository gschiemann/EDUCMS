/**
 * PdfHoverThumb — PDF tile that shows the actual first-page preview
 * AND keeps Chrome's PDFium toolbar invisible.
 *
 * Operator history:
 *   1. Original ask: "make those fit in the previews better"
 *      → built always-mounted iframe with `top: -56px` crop
 *   2. Toolbar leaked through: "you have this new weird viewer menu
 *      for documents... why have a download on this one and not the
 *      other media and template types"
 *   3. Tried hover-only mount (commit 63da094): "you lost all my
 *      previews on the pdf's now"
 *
 * The right answer is what the operator originally wanted: iframe
 * mounted on load (so previews are visible), with the toolbar zone
 * MASKED by a solid overlay that paints over wherever Chrome puts
 * the floating toolbar. Defense-in-depth strategy:
 *
 *   1. Iframe loads with #view=Fit&toolbar=0 (honored by Firefox +
 *      Safari, ignored by modern Chrome).
 *   2. Iframe is positioned `top: -56px; height: calc(100% + 56px)`
 *      so any top-anchored toolbar shifts above the visible region
 *      and gets clipped by the parent's overflow:hidden.
 *   3. A solid rose-tinted overlay strip painted at the TOP of the
 *      visible region (height: 48px, gradient fading to transparent)
 *      covers any toolbar that Chrome's compositor positions inside
 *      the visible window despite steps 1 + 2. The strip's bottom
 *      edge feathers into transparency so it looks like a soft
 *      header rather than a hard cutoff.
 *   4. A second solid overlay at the BOTTOM-RIGHT covers the
 *      download-button corner where Chrome stashes its always-on
 *      "save PDF" icon in some recent versions.
 *
 * Iframe is ALWAYS mounted — the operator wants to see the preview
 * the moment the page loads, not after they hover each tile.
 * pointer-events:none on the iframe so the parent tile's click
 * handler still fires through.
 *
 * Used by:
 *   - apps/web/src/app/[schoolId]/assets/page.tsx (asset library tile)
 *   - apps/web/src/components/playlists/PlaylistPreviewThumb.tsx
 *   - apps/web/src/components/playlists/PlaylistCreateWizard.tsx
 */
'use client';

import { useEffect, useRef, useState } from 'react';
import { FileText } from 'lucide-react';

const apiBase = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1').replace('/api/v1', '');

function makePdfPreviewUrl(rawFileUrl: string): string {
  const url = rawFileUrl?.startsWith('http') ? rawFileUrl : `${apiBase}${rawFileUrl}`;
  // Strip viewer chrome as a defense-in-depth — modern Chrome ignores
  // these but Firefox + Safari still honor them. The opaque mask
  // overlays are the primary defense for Chrome.
  return url + (url.includes('#') ? '&' : '#') + 'view=Fit&toolbar=0&navpanes=0&scrollbar=0';
}

export interface PdfHoverThumbProps {
  /** Asset's fileUrl (absolute or root-relative). */
  fileUrl: string;
  /** Filename for screen-readers + alt text. */
  title?: string;
  /** Optional className for the wrapper. */
  className?: string;
  /**
   * Whether the iframe should suppress pointer events so the parent
   * click handler still fires. Default true — matches the tile-as-
   * button pattern everywhere we use this.
   */
  passClicks?: boolean;
}

export function PdfHoverThumb({
  fileUrl,
  title,
  className = '',
  passClicks = true,
}: PdfHoverThumbProps) {
  // IntersectionObserver gate — don't mount the iframe until the tile
  // is within ~150px of the viewport. Cuts page-load bandwidth on big
  // asset libraries (50+ PDFs) without taking the preview away from
  // the user. Once mounted, stays mounted (operator scrolling back up
  // shouldn't trigger a re-fetch + re-mount flash).
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [shouldLoad, setShouldLoad] = useState(false);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      // SSR / very old browser — mount eagerly.
      setShouldLoad(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShouldLoad(true);
            io.disconnect();
            return;
          }
        }
      },
      { rootMargin: '150px', threshold: 0.01 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const src = makePdfPreviewUrl(fileUrl);

  return (
    <div
      ref={wrapperRef}
      className={`relative w-full h-full overflow-hidden bg-gradient-to-br from-rose-50 to-rose-100 ${className}`}
    >
      {/* Static fallback — visible until iframe mounts AND while
          iframe is loading. Sits underneath the iframe via stack
          order, so it shows through the brief load-flash too. */}
      <div className="absolute top-0 right-0 bottom-0 left-0 flex flex-col items-center justify-center pointer-events-none">
        <FileText className="w-8 h-8 text-rose-500/60" aria-hidden="true" />
        <span className="mt-1 text-[10px] font-bold text-rose-700/50 uppercase tracking-wider">
          PDF
        </span>
      </div>

      {/* Live preview iframe — always mounts once in viewport so the
          operator sees the actual first-page content. Same -56px
          crop as before so any top-anchored toolbar gets clipped
          above the visible window. */}
      {shouldLoad && (
        <iframe
          src={src}
          title={title || 'PDF preview'}
          loading="lazy"
          referrerPolicy="no-referrer"
          style={{
            position: 'absolute',
            top: '-56px',
            left: 0,
            width: '100%',
            height: 'calc(100% + 56px)',
            border: 0,
            pointerEvents: passClicks ? 'none' : 'auto',
            // Sits ABOVE the static fallback (z-index implicit by
            // source order — both absolute, iframe later in source).
          }}
          aria-hidden={passClicks}
        />
      )}

      {/* TOP MASK — opaque overlay covering the top ~48px of the
          visible window where Chrome's PDFium "hover toolbar"
          (zoom / fit / download icons) appears on tile hover. Fades
          from solid rose at the top to transparent at the bottom so
          it reads as a soft header strip, not a hard cutoff. The
          actual PDF content is visible below it.
          pointer-events:none so the parent's click handler still
          fires through this mask. */}
      <div
        aria-hidden="true"
        className="absolute top-0 left-0 right-0 pointer-events-none"
        style={{
          height: 48,
          background:
            'linear-gradient(to bottom, rgb(255 241 242) 0%, rgb(255 241 242) 55%, rgba(255,241,242,0) 100%)',
        }}
      />

      {/* BOTTOM-RIGHT MASK — covers the "save PDF" / "open in new
          tab" corner button Chrome's PDFium pins in some versions.
          Small enough not to eat the actual content. */}
      <div
        aria-hidden="true"
        className="absolute bottom-0 right-0 pointer-events-none"
        style={{
          width: 56,
          height: 36,
          background:
            'linear-gradient(to top left, rgb(255 241 242) 0%, rgb(255 241 242) 40%, rgba(255,241,242,0) 100%)',
        }}
      />
    </div>
  );
}
