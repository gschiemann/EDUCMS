"use client";

import { useEffect, useRef, useState } from 'react';
import { Globe } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { websitePreviewUrl } from '@/lib/website-preview';

/**
 * A website drawn as a real screenshot of the page — the ONE component every
 * surface uses for a website thumbnail (Media Library, playlist tiles, the
 * dashboard schedule, screen rows and the screen's content card).
 *
 * The screenshot service (see lib/website-preview.ts) takes a few seconds the
 * first time it sees a URL: until the picture exists the request fails, and
 * the image is ready on a later attempt. Every inline copy of this logic
 * retried that failure — three more tries, 1.5 s / 3 s / 4.5 s apart — and so
 * does this one, so a website is never stuck as a blank tile just because it
 * was the first person to ask. Only after the retries are spent does the tile
 * settle on the globe, labelled, instead of an empty box.
 *
 * A URL the builder refuses (credentials, localhost, a private-network host)
 * is never requested at all: it is the globe from the first paint.
 *
 * The whole screenshot is shown (`object-contain`, letterboxed), never
 * cropped to fill.
 */
export function WebsitePreviewThumb({ url, name, className = '' }: { url: string; name?: string | null; className?: string }) {
  // Remount on a different website so the retry count, the failed flag and a
  // pending retry timer can never carry over to the next page.
  return <WebsiteShot key={url} url={url} name={name} className={className} />;
}

/** Retries of a screenshot that was not ready yet (the first request is not one). */
const MAX_RETRIES = 3;
const retryDelayMs = (attempt: number) => 1500 * (attempt + 1);

function WebsiteShot({ url, name, className }: { url: string; name?: string | null; className: string }) {
  const t = useTranslations('assetsLib');
  const shot = websitePreviewUrl(url);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [painted, setPainted] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const label = name ? t('websitePreviewOf', { name }) : t('websitePreview');
  const unavailable = name ? t('websitePreviewUnavailableOf', { name }) : t('websitePreviewUnavailable');
  const fallback = failed || !shot;

  return (
    <span className={`relative block overflow-hidden bg-slate-100 ${className}`}>
      {/* The globe is the floor: it is what shows until the picture is
          painted, and what stays if there never is one. */}
      <span
        className="absolute top-0 right-0 bottom-0 left-0 flex items-center justify-center text-slate-400"
        role={fallback ? 'img' : undefined}
        aria-label={fallback ? unavailable : undefined}
        aria-hidden={!fallback}
      >
        <Globe className="h-5 w-5" aria-hidden />
      </span>
      {!fallback && (
        // load/error are the image's own lifecycle events, not a user
        // interaction with a non-interactive element — the a11y rule's premise.
        // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/no-noninteractive-element-interactions
        <img
          src={shot + (attempt ? `&retry=${attempt}` : '')}
          alt={label}
          loading="lazy"
          decoding="async"
          className={`relative h-full w-full object-contain ${painted ? 'opacity-100' : 'opacity-0'}`}
          onLoad={() => setPainted(true)}
          onError={() => {
            setPainted(false);
            if (timer.current) clearTimeout(timer.current);
            if (attempt >= MAX_RETRIES) { setFailed(true); return; }
            timer.current = setTimeout(() => { timer.current = null; setAttempt(attempt + 1); }, retryDelayMs(attempt));
          }}
        />
      )}
    </span>
  );
}
