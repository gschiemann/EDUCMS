"use client";

import { useEffect, useRef, useState } from 'react';
import { ScaledTemplateThumbnail } from './ScaledTemplateThumbnail';
import type { TemplatePreview } from '@/lib/template-preview';

/** Fits saved artwork inside any dashboard/table frame; customized boards stay frozen. */
export function TemplateContentThumb({ template, name }: { template: TemplatePreview; name?: string | null }) {
  const frame = useRef<HTMLSpanElement>(null);
  const [height, setHeight] = useState(100);
  useEffect(() => {
    const node = frame.current;
    if (!node) return;
    const measure = () => { const h = node.getBoundingClientRect().height; if (h > 0) setHeight(h); };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return <span ref={frame} className="flex h-full w-full items-center justify-center overflow-hidden" role="img" aria-label={`Scheduled template${name ? ` of ${name}` : ''} — saved artwork preview`}>
    <ScaledTemplateThumbnail {...template} freeze flush maxHeight={height} />
  </span>;
}
