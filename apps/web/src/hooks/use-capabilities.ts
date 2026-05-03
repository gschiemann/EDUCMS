'use client';

/**
 * useCapabilities — React hook wrapper around `detectCapabilities()`.
 * ─────────────────────────────────────────────────────────────────────
 *
 * Sprint 8d (2026-05-03). Returns the device capability snapshot.
 * Memoized — no re-detection on re-render.
 *
 * SSR-safe: returns the SSR_DEFAULTS (everything false) on the
 * server. Components that branch on capabilities should either:
 *
 *   1. Render the modern version + use CSS @supports for fallback
 *      (works without JS, no flash on hydration), OR
 *   2. Branch inside `useEffect` so the SSR pass renders neutral
 *      and the post-hydration pass picks the right path.
 *
 * Use case examples:
 *   • Streaming widget — pick H.264 vs H.265 vs AV1 transcode based
 *     on device codec support (`pickBestVideo`).
 *   • Animated widgets — drop expensive backdrop-filter blurs on
 *     Chromium <76 to keep frame rate up.
 *   • Container-query layouts — fall back to width-based grid on
 *     Chromium <105.
 */
import { useMemo } from 'react';
import { detectCapabilities, type Capabilities } from '@/lib/capabilities';

export function useCapabilities(): Capabilities {
  // detectCapabilities is itself memoized; useMemo just keeps the
  // hook contract clean (same identity across renders).
  return useMemo(() => detectCapabilities(), []);
}
