'use client';

import { useEffect, useState } from 'react';

/**
 * `?design=v2` — the pill-cleanup preview switch (2026-11-02). Production is
 * unchanged unless the URL carries the param, so the owner can compare the
 * same page before/after on real data before approving the one-wave rollout.
 *
 * Read from `window.location` after mount (not `useSearchParams`): no
 * Suspense boundary needed, and the first render always matches the server.
 */
export function isDesignV2Search(search: string): boolean {
  return new URLSearchParams(search).get('design') === 'v2';
}

/**
 * Phone width (< 768px) for the v2 toolbar/dock. Like `useIsMobile`, but it
 * only reads `innerWidth` + `resize`, so it is safe where `matchMedia` is
 * missing (jsdom) — the pages that call it must behave exactly as before
 * when the preview is off.
 */
export function usePhoneWidth(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const read = () => setPhone(window.innerWidth < 768);
    read();
    window.addEventListener('resize', read);
    return () => window.removeEventListener('resize', read);
  }, []);
  return phone;
}

export function useDesignV2(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    setOn(isDesignV2Search(window.location.search));
  }, []);
  return on;
}
