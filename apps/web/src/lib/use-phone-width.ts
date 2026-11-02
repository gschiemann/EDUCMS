'use client';

import { useEffect, useState } from 'react';

/**
 * Phone width (< 768px) for the shared page toolbar / bottom selection dock
 * (pill cleanup, 2026-11-02). Like `useIsMobile`, but it only reads
 * `innerWidth` + `resize`, so it is safe where `matchMedia` is missing
 * (jsdom). The first render is always "not a phone", matching the server.
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
