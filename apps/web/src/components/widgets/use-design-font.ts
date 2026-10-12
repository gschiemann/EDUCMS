"use client";

import { useEffect } from 'react';

// Fonts are document resources. An editable family must also load when a saved
// design opens on the player, without depending on the Properties panel.
export function useDesignFont(value: string | undefined) {
  const family = (value || '').split(',')[0].trim().replace(/^['"]|['"]$/g, '');
  useEffect(() => {
    if (!family || !/^[A-Za-z][A-Za-z0-9 ]{1,60}$/.test(family) || /^(Arial|Helvetica|Verdana|Georgia|Times New Roman|Courier New|serif|sans-serif|monospace|system-ui)$/i.test(family)) return;
    const existing = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')).some(link => {
      if (link.dataset.designFont === family) return true;
      try { return decodeURIComponent(link.href).replace(/\+/g, ' ').includes(`family=${family}`); }
      catch { return false; }
    });
    if (existing) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.dataset.designFont = family;
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}&display=swap`;
    document.head.appendChild(link);
    // Keep the shared face for other mounted elements and subsequent pages.
  }, [family]);
}
