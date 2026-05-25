"use client";

import { useEffect, useState } from 'react';

/**
 * useLogoTone — detects whether a logo image is dominated by light or
 * dark pixels, so the UI can pick a backdrop with enough contrast.
 *
 * Problem case (2026-05-25, Dodgers scrape): MLB's wordmark logo is
 * white text on a transparent background. Rendered against the wizard's
 * default `bg-slate-50` tile it disappeared into the white. The gallery
 * card needs a checkerboard backdrop; the live preview needs to wrap
 * the logo in a primary-color chip so the white shows up clearly.
 *
 * How it works:
 *   1. Inline SVG → analyze the raw SVG text for explicit white fills
 *      and the absence of `currentColor` (which inherits a dark color
 *      from the wrapper). Sync, no canvas, no CORS.
 *   2. Raster URL → render to a 32×32 offscreen canvas with
 *      crossOrigin="anonymous", read pixels via getImageData, average
 *      perceptual luminance over the opaque (alpha >= 200) pixels.
 *      Skips transparent pixels so a white-on-transparent logo doesn't
 *      get its tone biased by the background.
 *   3. CORS-tainted canvas → catch SecurityError, fall back to
 *      'unknown'. Callers should default to a contrasting backdrop
 *      that works for white logos (i.e., a dark or primary-color chip)
 *      since most wordmarks are light-on-transparent.
 *
 * Results are cached per src so re-renders don't re-decode.
 */

type Tone = 'light' | 'dark' | 'unknown';

const cache = new Map<string, Tone>();

export function useLogoTone(
  src: string | null | undefined,
  svgInline?: string | null,
): Tone {
  const [tone, setTone] = useState<Tone>(() => {
    if (src && cache.has(src)) return cache.get(src)!;
    return 'unknown';
  });

  useEffect(() => {
    // Inline SVG path — synchronous heuristic.
    if (svgInline) {
      setTone(analyzeSvgTone(svgInline));
      return;
    }

    if (!src) {
      setTone('unknown');
      return;
    }

    if (cache.has(src)) {
      setTone(cache.get(src)!);
      return;
    }

    let cancelled = false;
    const img = new Image();
    // Lets us read pixels when the server sends Access-Control-Allow-
    // Origin. When it doesn't, the canvas becomes "tainted" and
    // getImageData throws a SecurityError — caught below.
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      if (cancelled) return;
      try {
        const size = 32;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          setTone('unknown');
          return;
        }
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;
        let lum = 0;
        let count = 0;
        for (let i = 0; i < data.length; i += 4) {
          const alpha = data[i + 3];
          // Skip transparent pixels — they tell us nothing about the
          // logo's actual ink color and would bias toward white on
          // alpha-channeled PNGs.
          if (alpha < 200) continue;
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          // Perceptual luminance — ITU-R BT.601. Faster + good enough
          // for a binary light/dark classification.
          lum += (0.299 * r + 0.587 * g + 0.114 * b) / 255;
          count++;
        }
        if (count === 0) {
          // 100% transparent image — treat as light, since the most
          // likely cause is a white-on-transparent wordmark whose
          // pixels all read as alpha-0 at small thumbnail size.
          cache.set(src, 'light');
          setTone('light');
          return;
        }
        const avg = lum / count;
        const result: Tone = avg > 0.6 ? 'light' : 'dark';
        cache.set(src, result);
        setTone(result);
      } catch {
        // SecurityError from CORS taint. Default to 'unknown' so
        // callers can pick the safe-for-white-logos backdrop.
        setTone('unknown');
      }
    };
    img.onerror = () => {
      if (!cancelled) setTone('unknown');
    };
    img.src = src;

    return () => {
      cancelled = true;
    };
  }, [src, svgInline]);

  return tone;
}

function analyzeSvgTone(svg: string): Tone {
  const lower = svg.toLowerCase();
  // currentColor inherits from the wrapper's CSS `color`. We render
  // the wizard's SVG tiles with `text-slate-800`, so currentColor SVGs
  // are effectively dark — give them the dark tone.
  const usesCurrentColor = lower.includes('currentcolor');
  // Common light-fill markers.
  const hasLightFill =
    /fill\s*=\s*["']?(?:white|#fff(?:fff)?|#f[a-f0-9]{2}|rgb\(\s*2[45][0-9]\s*,\s*2[45][0-9]\s*,\s*2[45][0-9])/i.test(
      svg,
    );
  if (hasLightFill && !usesCurrentColor) return 'light';
  // Heuristic default: treat unknown SVGs as 'dark' since we already
  // force the wrapper text color to slate-800 via Tailwind.
  return 'dark';
}
