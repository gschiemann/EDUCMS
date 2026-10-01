'use client';

import { useEffect, useState, type CSSProperties } from 'react';

/** The IMAGE_CAROUSEL media renderer, shared by native zones and HTML boards. */
type NativeCarouselConfig = {
  urls: string[]; intervalMs?: number; transition?: string; fitMode?: string;
  objectPosition?: string; alt?: string; paused?: boolean; showIndicators?: boolean;
  noEntrance?: boolean;
};

export function NativeImageCarousel({ config }: { config: NativeCarouselConfig }) {
  return <ImageCarouselPlayback key={config.urls.join('\n')} config={config} />;
}

function ImageCarouselPlayback({ config }: { config: NativeCarouselConfig }) {
  const { urls } = config;
  const [step, setStep] = useState(0);
  const interval = Math.max(1000, Number(config.intervalMs) || 5000);
  const sequence = urls.join('\n');
  useEffect(() => {
    // Decode the next slides before the timer reaches them.
    sequence.split('\n').forEach((url) => { const image = new Image(); image.src = url; });
  }, [sequence]); // URL order changes restart the gallery, styling changes do not.
  useEffect(() => {
    if (urls.length < 2 || config.paused) return;
    const timer = setInterval(() => setStep((value) => value + 1), interval);
    return () => clearInterval(timer);
  }, [urls.length, interval, config.paused]);

  if (!urls.length) return null;
  const index = step % urls.length;
  const previous = step > 0 ? (step - 1) % urls.length : index;
  const transition = config.transition || 'fade';
  const fit = config.fitMode === 'stretch' ? 'fill' : (config.fitMode || 'contain');
  const imageStyle: CSSProperties = {
    position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
    objectFit: fit as CSSProperties['objectFit'], objectPosition: config.objectPosition || 'center',
  };
  const animated = transition !== 'cut' && transition !== 'none' && !(step === 0 && config.noEntrance);
  return (
    <div data-native-image-carousel data-carousel-index={index} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', overflow: 'hidden' }}>
      <style>{`
        @keyframes cms-native-carousel-fade { from {opacity:0} to {opacity:1} }
        @keyframes cms-native-carousel-out { from {opacity:1} to {opacity:0} }
        @keyframes cms-native-carousel-slide-left { from {transform:translateX(100%);opacity:0} to {transform:none;opacity:1} }
        @keyframes cms-native-carousel-slide-right { from {transform:translateX(-100%);opacity:0} to {transform:none;opacity:1} }
        @keyframes cms-native-carousel-slide-up { from {transform:translateY(100%);opacity:0} to {transform:none;opacity:1} }
        @keyframes cms-native-carousel-zoom { from {transform:scale(.92);opacity:0} to {transform:none;opacity:1} }
        @media (prefers-reduced-motion:reduce) { [data-native-image-carousel] img { animation:none !important; } }
      `}</style>
      {/* The outgoing image remains underneath so fade is a crossfade. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img key={`previous:${step}`} src={urls[previous]} alt="" aria-hidden="true" style={{ ...imageStyle, opacity: 0, ...(step > 0 && animated ? { animation: 'cms-native-carousel-out 600ms cubic-bezier(.22,1,.36,1) both' } : {}) }} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img key={`${sequence}:${step}`} src={urls[index]} alt={config.alt || ''} style={{ ...imageStyle, ...(animated ? {
        animation: `cms-native-carousel-${transition === 'slide' ? 'slide-left' : transition} 600ms cubic-bezier(.22,1,.36,1) both`,
      } : {}) }} />
      {config.showIndicators !== false && urls.length > 1 && (
        <div aria-hidden="true" style={{ position: 'absolute', bottom: '5%', left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 4 }}>
          {urls.map((_, i) => <div key={i} style={{ width: 6, height: 6, borderRadius: 99, background: i === index ? 'white' : 'rgba(255,255,255,.4)' }} />)}
        </div>
      )}
    </div>
  );
}
