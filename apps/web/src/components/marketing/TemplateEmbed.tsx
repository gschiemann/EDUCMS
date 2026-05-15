'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Marketing template preview embed.
 *
 * 2026-05-15 (THIRD ATTEMPT — mobile crash redux):
 *
 *   First attempt: gate iframes behind <script>-injected IntersectionObserver.
 *   Failed because React doesn't execute script tags inserted via JSX.
 *
 *   Second attempt: 'use client' component with useEffect-driven IO that
 *   only mounts iframes on intersection. Hero loaded eagerly. STILL CRASHED
 *   Safari on iPhone — even one animated-rainbow 1920×1080 iframe is too
 *   much for the 4 GiB-RAM Safari renderer process when combined with the
 *   rest of the page's compositor work.
 *
 *   This attempt: **no iframes on mobile, full stop**. Detect viewport via
 *   matchMedia at mount, and on narrow screens render only a static
 *   placeholder. Desktop continues to get the real animated template
 *   render (gated by IO for the gallery, eager for the hero). Tradeoff:
 *   mobile visitors see "Rainbow • Elementary" on a brand-gradient card
 *   instead of a live preview. That's fine — the page's job is to get
 *   them to "Start free trial," not to demo the product on a 5" screen.
 *
 *   matchMedia('(min-width: 768px)') matches Tailwind's `md` breakpoint
 *   so the boundary aligns with the existing mobile/desktop layout split.
 *
 * Sizing (desktop only):
 *   Iframe is fixed at 1920×1080. Wrapper uses aspect-ratio 16/9. A
 *   ResizeObserver applies transform:scale(k) so 1920×1080 fits the
 *   container. Same pattern the template builder uses for thumbnails.
 */
export function TemplateEmbed({
  src,
  title,
  eager = false,
  staticImage,
}: {
  src: string;
  title: string;
  eager?: boolean;
  /**
   * Optional path to a pre-rendered JPG of the template (e.g.
   * `/demo/templates/rainbow.jpg`). On mobile we render this as a
   * plain <img> instead of an iframe — a real static preview without
   * the GPU / animation cost that crashes Safari. Desktop ignores it
   * and keeps the live iframe (animations + all). The image is
   * generated at design time via scripts/snap-templates.cjs which
   * loads each template HTML in headless Chrome at 1280×720 and
   * writes a JPG next to the .html.
   */
  staticImage?: string;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [mounted, setMounted] = useState(false);
  // `null` during SSR + first hydration tick. The mobile/desktop decision
  // is intentionally a no-op until after hydration so the SSR HTML matches
  // the first client render — no hydration mismatch on user-data-free pages.
  const [isDesktop, setIsDesktop] = useState<boolean | null>(null);

  // Hydration tick: discover the viewport class once. Subsequent resize
  // events deliberately do NOT swap iframe ↔ placeholder — that would
  // mean mounting an iframe mid-session (the very thing the user can't
  // tolerate on iOS). The page already renders a layout that adapts to
  // resize purely via Tailwind responsive classes, so a viewport change
  // does not require flipping this control.
  useEffect(() => {
    const desktop = typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(min-width: 768px)').matches;
    setIsDesktop(desktop);
  }, []);

  // Desktop-only: gate iframe mount on intersection (or eager).
  useEffect(() => {
    if (isDesktop !== true) return;
    if (eager) {
      setMounted(true);
      return;
    }
    const node = wrapperRef.current;
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') {
      setMounted(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setMounted(true);
            io.disconnect();
            return;
          }
        }
      },
      { rootMargin: '600px 0px' },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [eager, isDesktop]);

  // Desktop-only: scale the iframe to fit. Runs only when mounted=true,
  // which is only ever true on desktop.
  useEffect(() => {
    if (!mounted) return;
    const wrapper = wrapperRef.current;
    const iframe = iframeRef.current;
    if (!wrapper || !iframe) return;
    const fit = () => {
      const rect = wrapper.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const k = Math.min(rect.width / 1920, rect.height / 1080);
      iframe.style.transform = `scale(${k})`;
    };
    fit();
    const t1 = window.setTimeout(fit, 60);
    const t2 = window.setTimeout(fit, 400);
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(fit);
      ro.observe(wrapper);
    } else {
      window.addEventListener('resize', fit);
    }
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      if (ro) ro.disconnect();
      else window.removeEventListener('resize', fit);
    };
  }, [mounted]);

  // Derive a friendly display label from the title prop for the
  // mobile/placeholder card. "Live preview — Rainbow Elementary" →
  // "Rainbow Elementary". Avoids "template preview" filler that looks
  // like an alt-text typo on real shipped pages.
  const placeholderLabel = useMemo(() => {
    const cleaned = title
      .replace(/^Live preview\s*[—–-]\s*/i, '')
      .replace(/\s*template preview$/i, '')
      .trim();
    return cleaned || 'Template preview';
  }, [title]);

  return (
    <div
      ref={wrapperRef}
      className="relative w-full bg-slate-950 overflow-hidden"
      style={{ aspectRatio: '16 / 9' }}
    >
      {/* Brand-gradient backdrop — used as the actual visible content
          on mobile + as a behind-iframe colour on desktop while the
          frame is still loading. */}
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500"
      />
      {/* Mobile: static JPG snapshot if provided, otherwise the gradient
          + label fallback. ONLY rendered when we know we're on mobile
          (isDesktop === false). On desktop the iframe covers it; during
          SSR / hydration tick it stays invisible. */}
      {isDesktop === false ? (
        staticImage ? (
          <img
            src={staticImage}
            alt={placeholderLabel}
            loading="lazy"
            decoding="async"
            className="absolute top-0 left-0 w-full h-full object-cover"
          />
        ) : (
          <>
            <div
              aria-hidden
              className="absolute inset-0"
              style={{
                background:
                  'radial-gradient(ellipse 60% 80% at 30% 20%, rgba(255,255,255,0.18), transparent 70%)',
              }}
            />
            <div className="absolute inset-0 flex items-end pointer-events-none">
              <div className="p-4">
                <div className="text-[10px] font-bold tracking-[0.16em] uppercase text-white/70">
                  Preview
                </div>
                <div className="mt-0.5 font-[family-name:var(--font-fredoka)] text-lg font-semibold text-white drop-shadow">
                  {placeholderLabel}
                </div>
              </div>
            </div>
          </>
        )
      ) : null}
      {/* Desktop: real iframe, gated on intersection. */}
      {mounted ? (
        <iframe
          ref={iframeRef}
          src={src}
          title={title}
          loading="lazy"
          className="absolute top-0 left-0 border-0"
          style={{
            width: '1920px',
            height: '1080px',
            transformOrigin: '0 0',
          }}
        />
      ) : null}
    </div>
  );
}
