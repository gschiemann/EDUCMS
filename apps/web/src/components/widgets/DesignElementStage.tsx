"use client";

import { useEffect, useRef, useState, type ReactNode } from 'react';

/** Keep design units consistent in thumbnails, the editor and screen output. */
export function DesignElementStage({ children, background }: { children: ReactNode; background: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => {
      const width = node.clientWidth, height = node.clientHeight;
      setBox(prev => prev.width === width && prev.height === height ? prev : { width, height });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') { window.addEventListener('resize', measure); return () => window.removeEventListener('resize', measure); }
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const scale = Math.min(box.width / 1600, box.height / 900);
  return <div ref={ref} style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background }}>
    <div style={{ position: 'absolute', width: 1600, height: 900, left: (box.width - 1600 * scale) / 2, top: (box.height - 900 * scale) / 2, transform: `scale(${scale})`, transformOrigin: '0 0' }}>{children}</div>
  </div>;
}
