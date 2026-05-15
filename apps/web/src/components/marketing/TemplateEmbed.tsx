'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Marketing template preview embed. Renders a scaled <iframe> of a
 * 1920×1080 template HTML page inside a 16:9 container so the same
 * fixed-pixel template the operator picks in the dashboard previews
 * correctly at any container width.
 *
 * 2026-05-15 — operator reported "scrolling the main landing page on
 * mobile device causes safari to crash". Cumulative GPU memory
 * pressure from 4 simultaneous animated-rainbow iframes + sticky
 * backdrop-blur header + decorative blob blurs OOM'd Safari on
 * 4 GiB iPhones within seconds of scrolling. First fix attempt was
 * an inline-script IntersectionObserver mounter, which gated correctly
 * (showing placeholders) but never swapped the iframes in (likely a
 * `document.currentScript`/CSP edge case under Next.js's static
 * pre-render). Rewritten as a `'use client'` component using React
 * state + a proper IO ref, which is more debuggable and avoids the
 * inline-script foot-gun entirely.
 *
 * Behaviour:
 *   - `eager` prop forces the iframe to mount on the first client
 *     render. Use for above-the-fold previews (Hero).
 *   - Otherwise: a static gradient placeholder renders until the
 *     container enters the IntersectionObserver viewport (with a
 *     600 px rootMargin so it preloads just before reaching the
 *     fold). The iframe then mounts in place.
 *   - The placeholder also renders for the very first SSR/hydration
 *     tick on every embed so the server HTML matches the initial
 *     client tree — no hydration mismatch.
 *
 * Sizing:
 *   The iframe has fixed `width: 1920px; height: 1080px` and the
 *   wrapper uses `aspect-ratio: 16/9`. A ResizeObserver applies
 *   `transform: scale(k)` so the natural-size iframe content fits
 *   the container exactly. Pattern matches the template builder's
 *   `ScaledTemplateThumbnail` so a single 1920×1080 layout looks
 *   right in both the gallery and on a 4K LED wall.
 */
export function TemplateEmbed({
  src,
  title,
  eager = false,
}: {
  src: string;
  title: string;
  eager?: boolean;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [mounted, setMounted] = useState(false);

  // SSR + first hydration tick: render the placeholder. After hydration,
  // either mount immediately (eager) or wire up the IntersectionObserver.
  useEffect(() => {
    if (eager) {
      setMounted(true);
      return;
    }
    const node = wrapperRef.current;
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') {
      // Old browser fallback — just mount.
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
  }, [eager]);

  // Keep the scaled iframe sized to its container. ResizeObserver fires
  // on first paint AND every container size change (responsive layout,
  // window resize, orientation change). On iOS where ResizeObserver is
  // sometimes flaky after navigation we also fit twice via setTimeout.
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

  return (
    <div
      ref={wrapperRef}
      className="relative w-full bg-slate-950 overflow-hidden"
      style={{ aspectRatio: '16 / 9' }}
    >
      {/* Static gradient placeholder — covers SSR and the pre-mount
          interval. We KEEP it in the DOM underneath the iframe so a
          slow iframe load shows the brand color rather than black. */}
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500"
      />
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
