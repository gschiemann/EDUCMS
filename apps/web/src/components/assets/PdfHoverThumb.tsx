/**
 * PdfHoverThumb — PDF tile thumbnail that DOESN'T auto-load.
 *
 * Operator (2026-05-26): "when you first hit the assets page the
 * stupid settings pops up on the PDF files....i thought you were
 * going to make those fit in the previews better and they shouldnt
 * auto trigger ever unless i higlight over them"
 *
 * Why: Chrome's PDFium viewer renders a floating toolbar (zoom /
 * download / page-nav / save) when the PDF iframe loads. The
 * toolbar fades in briefly even when nothing is hovered, and on
 * modern Chrome it appears CENTERED in the viewer instead of at
 * the top edge — so our previous `top: -56px` crop trick stopped
 * working. Worse, mounting N PDF iframes on every assets page
 * render kicks off N concurrent PDF fetches → bandwidth hit +
 * visible "toolbar flash" on every tile during the first second.
 *
 * Fix: render a static placeholder by default (gradient + FileText
 * icon + "PDF" pill). On mouse-enter, mount the iframe (with the
 * same crop + sandbox-free + pointer-events:none trick the previous
 * implementation used). On mouse-leave, unmount the iframe and
 * revert to placeholder. Net result: iframe NEVER mounts on page
 * load → no toolbar flash possible → cursor hover is the ONLY way
 * the operator sees the PDF page content.
 *
 * Keyboard accessibility: focus on the tile also mounts the iframe
 * (same as hover). When focus leaves, iframe unmounts.
 *
 * Touch devices: tap shows the iframe for ~3s then auto-unmounts —
 * compromise for the no-hover-state case.
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
  // these but Firefox + Safari still honor them. Our hover-only mount
  // is the primary defense against the auto-toolbar problem.
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
   * Whether the iframe (when mounted) should suppress pointer events
   * so the parent click handler still fires. Default true — matches
   * the tile-as-button pattern everywhere we use this.
   */
  passClicks?: boolean;
}

export function PdfHoverThumb({
  fileUrl,
  title,
  className = '',
  passClicks = true,
}: PdfHoverThumbProps) {
  const [hovered, setHovered] = useState(false);
  const touchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up the touch-mode timer on unmount.
  useEffect(() => {
    return () => {
      if (touchTimerRef.current) clearTimeout(touchTimerRef.current);
    };
  }, []);

  const src = makePdfPreviewUrl(fileUrl);

  return (
    <div
      className={`relative w-full h-full overflow-hidden bg-gradient-to-br from-rose-50 to-rose-100 ${className}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      onTouchStart={() => {
        setHovered(true);
        if (touchTimerRef.current) clearTimeout(touchTimerRef.current);
        touchTimerRef.current = setTimeout(() => setHovered(false), 3000);
      }}
    >
      {/* Placeholder — ALWAYS rendered so the tile never goes blank
          mid-transition. Sits underneath the iframe (when mounted)
          via z-stack. */}
      <div className="absolute top-0 right-0 bottom-0 left-0 flex flex-col items-center justify-center pointer-events-none">
        <FileText className="w-8 h-8 text-rose-500" aria-hidden="true" />
        <span className="mt-1 text-[10px] font-bold text-rose-700/80 uppercase tracking-wider">
          PDF
        </span>
      </div>

      {/* Live preview iframe — mounts only on hover/focus/tap. Same
          crop trick (top:-56px + height:calc(100%+56px)) as before:
          if Chrome's toolbar DOES show, it lands above the visible
          window. No sandbox attribute (Chrome's PDFium refuses to
          render under any sandbox value). */}
      {hovered && (
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
            // pointer-events:none keeps the parent tile click
            // handlers working — operator can still click through
            // to open the asset detail panel.
            pointerEvents: passClicks ? 'none' : 'auto',
          }}
          aria-hidden={passClicks}
        />
      )}
    </div>
  );
}
