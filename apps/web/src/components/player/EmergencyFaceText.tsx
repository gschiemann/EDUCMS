'use client';
import { useEffect, useRef, useState } from 'react';

export const EMERGENCY_TEXT_MIN_PX = 32;

/** Wrap in this face's stage before fitting. Never scale readable text below its floor. */
export function EmergencyFaceText({ text, fontSize = 100 }: { text: string; fontSize?: number }) {
  const outer = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const maximum = Math.max(EMERGENCY_TEXT_MIN_PX, Number.isFinite(fontSize) ? fontSize : 100);
  const [size, setSize] = useState(maximum);
  useEffect(() => {
    const measure = () => {
      const box = outer.current, node = content.current;
      if (!box || !node || !box.clientWidth || !box.clientHeight) return;
      const style = getComputedStyle(box);
      const availableW = box.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
      const availableH = box.clientHeight - (parseFloat(style.paddingTop) || 0) - (parseFloat(style.paddingBottom) || 0);
      let low = EMERGENCY_TEXT_MIN_PX, high = maximum;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        node.style.fontSize = `${mid}px`;
        if (node.scrollHeight <= availableH && node.scrollWidth <= availableW) low = mid;
        else high = mid - 1;
      }
      node.style.fontSize = `${low}px`;
      setSize(low);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    if (outer.current) observer?.observe(outer.current);
    document.fonts?.ready.then(measure).catch(() => {});
    return () => observer?.disconnect();
  }, [text, maximum]);
  return <div ref={outer} data-edu-emergency-text-floor={EMERGENCY_TEXT_MIN_PX}
    style={{ width: '100%', height: '100%', boxSizing: 'border-box', padding: 32, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
    <div ref={content} style={{ margin: 'auto 0', flexShrink: 0, width: '100%', fontSize: size, fontWeight: 800,
      color: 'white', lineHeight: 1.15, textAlign: 'center', whiteSpace: 'pre-wrap', overflowWrap: 'break-word' }}>{text}</div>
  </div>;
}
