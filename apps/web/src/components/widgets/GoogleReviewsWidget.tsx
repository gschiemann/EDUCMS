'use client';

/**
 * GOOGLE_REVIEWS — a venue's real Google star rating and reviews, on a board.
 *
 * ── WHAT THIS REPLACED (2026-09-12) ──────────────────────────────────────
 * The Apps library carried a `google-reviews` tile marked `comingSoon` whose
 * `build()` returned an EMPTY `SOCIAL_FEED` config — a tile that looked like a
 * feature and produced a blank zone. The data now comes from Places API (New)
 * through `/api/v1/integrations/google-reviews/*`, where the Google key lives
 * (server-side only, in the `X-Goog-Api-Key` header, never in a URL).
 *
 * ── WHAT GOOGLE'S POLICY REQUIRES US TO DRAW ─────────────────────────────
 * These are not stylistic choices. Places API Policies, "Photos and reviews":
 *
 *   "You must always credit the author when displaying photos or reviews. Each
 *    photo and review includes an author attribution (author's avatar image,
 *    name, and profile link)."
 *   "Attribute the author using all available resources (avatar, name, and
 *    profile link) when space allows."
 *   "If space is limited, the minimum requirement is to display the author's
 *    avatar."
 *
 * and, under "Reviews":
 *
 *   "Include a clear notice that describes how reviews are being ordered and
 *    filtered including any search criteria applied."
 *
 * and, for the platform itself:
 *
 *   "Attribution should take the form of the Google Maps logo whenever
 *    possible. In cases where space is limited, the text Google Maps is
 *    acceptable."
 *
 * So every card carries the author's avatar AND name, the footer carries the
 * Google Maps attribution AND a plain sentence naming the order and the
 * filter, and the reviewer's words are never edited — long text is CLIPPED BY
 * CSS, which leaves the string itself untouched.
 *
 * Google does NOT promise these are the newest reviews; the API returns at
 * most five of its own selection. The footer therefore says "Reviews from
 * Google Maps · Google's selection", never "Latest reviews", and the age on
 * each card is Google's own `relativePublishTimeDescription` string, never a
 * number computed from the render clock (a signage player's clock runs minutes
 * out routinely and hours out after an NTP step — player rule 10).
 *
 * ── TAURUS / CHROMIUM-83 ─────────────────────────────────────────────────
 * Inline styles only, every size a px number computed in JS from the measured
 * box: no `inset` shorthand, no Tailwind `inset-*`, no flex `gap` (margins
 * instead), no `backdrop-filter`, no container-query units, and no `clamp()`
 * ceiling that could pin type small on a 4K wall. The one four-sided style
 * object is the deliberate uniform-zero full-bleed case (CLAUDE.md rule #10),
 * which the polyfill handles correctly.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import { WidgetEmptyState } from './WidgetEmptyState';
import {
  fetchGoogleReviews,
  readLastGoodReviews,
  selectReviews,
  writeLastGoodReviews,
  GOOGLE_REVIEWS_POLL_INTERVAL_MS,
  type GoogleReviewItem,
  type GoogleReviewsPayload,
} from '@/lib/reviews/google-reviews-client';

export interface GoogleReviewsConfig {
  /** Google place id. The ONE Places value the terms allow us to store
   *  indefinitely, which is why it is the only one persisted in a template. */
  placeId?: string;
  /** Name captured at pick time, so the board has a header before the first
   *  fetch lands and after a failure. */
  placeName?: string;
  maxItems?: number;
  minRating?: number;
  layout?: 'carousel' | 'list';
  bgColor?: string;
  textColor?: string;
  accentColor?: string;
  /** Set by VariantPicker on the catalogue thumbnail. Never set on a canvas or
   *  a player zone. */
  _thumb?: boolean;
}

/** How long one card holds the stage in carousel mode. */
const CAROUSEL_INTERVAL_MS = 8000;

const STAR_PATH =
  'M12 2.6l2.9 5.88 6.49.94-4.7 4.58 1.11 6.46L12 17.4l-5.8 3.06 1.1-6.46-4.69-4.58 6.49-.94L12 2.6z';

function isDarkHex(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || '').trim());
  if (!m) return true;
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 140;
}

/** One star glyph. `fill` is a colour, never a gradient — Chromium 83 renders
 *  SVG gradients fine but a solid star reads better at 30 feet. */
function Star({ size, color, marginRight }: { size: number; color: string; marginRight: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden
      focusable="false"
      style={{ display: 'inline-block', verticalAlign: 'top', marginRight }}
    >
      <path d={STAR_PATH} fill={color} />
    </svg>
  );
}

/**
 * A 0-5 star bar with a partial last star. Drawn as two rows — muted beneath,
 * coloured on top clipped to the rating's width — because CSS has no
 * "fraction of a glyph" and a rounded star count would misreport a 4.7.
 */
function StarBar({
  value,
  size,
  color,
  mutedColor,
  label,
}: {
  value: number;
  size: number;
  color: string;
  mutedColor: string;
  label: string;
}) {
  const clamped = Math.max(0, Math.min(5, value));
  const step = Math.round(size * 0.12);
  const rowWidth = size * 5 + step * 5;
  const pct = (clamped / 5) * 100;
  const row = (fill: string) => (
    <span style={{ display: 'block', width: rowWidth, whiteSpace: 'nowrap', lineHeight: 0 }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <Star key={i} size={size} color={fill} marginRight={step} />
      ))}
    </span>
  );
  return (
    <span
      role="img"
      aria-label={label}
      style={{ position: 'relative', display: 'inline-block', width: rowWidth, height: size, lineHeight: 0 }}
    >
      {row(mutedColor)}
      {/* top / left / width only — three sides can never serialise to the
          `inset` shorthand (CLAUDE.md rule #10, the 2026-07-03 variant). */}
      <span
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: `${pct}%`,
          height: size,
          overflow: 'hidden',
          lineHeight: 0,
        }}
      >
        {row(color)}
      </span>
    </span>
  );
}

/**
 * The platform attribution mark.
 *
 * DELIBERATELY NOT a redrawn Google "G". The policy accepts either the Google
 * Maps logo or the literal text "Google Maps" when space is limited, and an
 * approximated trademark drawn from memory is worse than the text Google
 * itself blesses — so this pairs a neutral map-pin glyph in Google's four
 * brand colours with the words "Google Maps" spelled out. If Greg drops the
 * official brand asset into the repo, swap the <svg> below for it; the text
 * stays either way.
 */
function GoogleMapsMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden focusable="false" style={{ display: 'block' }}>
      <path d="M12 2a8 8 0 0 0-8 8c0 5.5 8 12 8 12s8-6.5 8-12a8 8 0 0 0-8-8Z" fill="#EA4335" />
      <path d="M12 2a8 8 0 0 0-6.9 4l5.3 4.4L12 2Z" fill="#FBBC04" />
      <path d="M20 10a8 8 0 0 0-1.1-4l-6.9 6 3.1 3.6A22 22 0 0 0 20 10Z" fill="#34A853" />
      <circle cx="12" cy="10" r="3" fill="#4285F4" />
    </svg>
  );
}

/** One review card. Every required attribution part is here or the card is
 *  not rendered at all (the API layer already drops un-attributable rows). */
function ReviewCard({
  review,
  u,
  ink,
  muted,
  panel,
  star,
  starMuted,
  lines,
}: {
  review: GoogleReviewItem;
  u: number;
  ink: string;
  muted: string;
  panel: string;
  star: string;
  starMuted: string;
  lines: number;
}) {
  const avatar = Math.round(u * 1.5);
  return (
    <div
      style={{
        background: panel,
        borderRadius: Math.round(u * 0.35),
        padding: Math.round(u * 0.6),
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: Math.round(u * 0.42) }}>
        {review.photoUri ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={review.photoUri}
            alt=""
            width={avatar}
            height={avatar}
            style={{
              width: avatar,
              height: avatar,
              borderRadius: '50%',
              objectFit: 'cover',
              marginRight: Math.round(u * 0.45),
              flexShrink: 0,
            }}
          />
        ) : (
          <span
            aria-hidden
            style={{
              width: avatar,
              height: avatar,
              borderRadius: '50%',
              background: starMuted,
              marginRight: Math.round(u * 0.45),
              flexShrink: 0,
              display: 'inline-block',
            }}
          />
        )}
        <span style={{ minWidth: 0, flex: '1 1 auto' }}>
          <span
            data-field="reviewAuthor"
            style={{
              display: 'block',
              fontSize: Math.round(u * 0.82),
              fontWeight: 700,
              color: ink,
              lineHeight: 1.15,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {review.author}
          </span>
          <span style={{ display: 'block', lineHeight: 0, marginTop: Math.round(u * 0.18) }}>
            {typeof review.rating === 'number' && (
              <StarBar
                value={review.rating}
                size={Math.round(u * 0.6)}
                color={star}
                mutedColor={starMuted}
                label={`${review.rating} out of 5`}
              />
            )}
          </span>
        </span>
        {review.relative && (
          <span
            style={{
              fontSize: Math.round(u * 0.62),
              color: muted,
              marginLeft: Math.round(u * 0.4),
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {review.relative}
          </span>
        )}
      </div>
      {/* The reviewer's own words, unedited. `-webkit-line-clamp` (Chrome 6+,
          so safe on the Taurus's Chromium 83) CLIPS the rendered box; the text
          node itself is never rewritten, which is what the policy's "do not
          modify review content" requires. */}
      <div
        data-field="reviewText"
        style={{
          fontSize: Math.round(u * 0.78),
          lineHeight: 1.35,
          color: ink,
          display: '-webkit-box',
          WebkitLineClamp: lines,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {review.text}
      </div>
    </div>
  );
}

export function GoogleReviewsWidget({
  config,
  height = 480,
  sample,
}: {
  config: GoogleReviewsConfig;
  height?: number;
  /** Catalogue-thumbnail data, passed ONLY by the picker tile. Never a
   *  fallback for missing config — a canvas or player zone never receives it,
   *  so an unconfigured widget can never look configured. */
  sample?: GoogleReviewsPayload;
  compact?: boolean;
  live?: boolean;
}) {
  const c = config || {};
  const placeId = (c.placeId || '').trim();
  const layout = c.layout === 'list' ? 'list' : 'carousel';
  const maxItems = Number.isFinite(c.maxItems) ? Number(c.maxItems) : 3;
  const minRating = Number.isFinite(c.minRating) ? Number(c.minRating) : 4;

  const boxRef = useRef<HTMLDivElement | null>(null);
  const [boxWidth, setBoxWidth] = useState(0);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setBoxWidth(el.clientWidth || 0);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // `null` until something real lands. NEVER seeded with invented content.
  const [payload, setPayload] = useState<GoogleReviewsPayload | null>(() =>
    sample ? sample : placeId ? readLastGoodReviews(placeId) : null,
  );

  useEffect(() => {
    if (sample) return; // catalogue thumbnail — never touches the network
    if (!placeId) {
      setPayload(null);
      return;
    }
    // Restore the last good payload for THIS place immediately, so a screen
    // that reboots offline is not blank while the first fetch is in flight.
    setPayload(readLastGoodReviews(placeId));

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;

    const tick = async () => {
      // Never poll a backgrounded tab (mobile-perf standard). A wall screen's
      // document is never hidden, so this only ever spares the operator's phone.
      const hidden = typeof document !== 'undefined' && document.hidden === true;
      if (!hidden) {
        controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const next = await fetchGoogleReviews(placeId, { signal: controller?.signal });
        if (cancelled) return;
        // An EMPTY reviews array is DATA and REPLACES what is on screen; only
        // a null (a real failure) keeps the last good payload. Collapsing the
        // two is the bug that kept sold-out items on menu boards for months.
        if (next) {
          setPayload(next);
          if (next.enabled) writeLastGoodReviews(placeId, next);
        }
      }
      if (!cancelled) timer = setTimeout(tick, GOOGLE_REVIEWS_POLL_INTERVAL_MS);
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      try {
        controller?.abort();
      } catch {
        /* noop */
      }
    };
  }, [placeId, sample]);

  const shown = useMemo(
    () => selectReviews(payload?.reviews ?? [], { minRating, maxItems }),
    [payload, minRating, maxItems],
  );

  const [cardIndex, setCardIndex] = useState(0);
  useEffect(() => {
    if (layout !== 'carousel' || shown.length < 2) return;
    const id = setInterval(() => setCardIndex((i) => i + 1), CAROUSEL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [layout, shown.length]);

  const bg = c.bgColor || '#0f1115';
  const dark = isDarkHex(bg);
  const ink = c.textColor || (dark ? '#f6f7fa' : '#12161d');
  const muted = dark ? 'rgba(246,247,250,0.62)' : 'rgba(18,22,29,0.6)';
  const panel = dark ? 'rgba(255,255,255,0.06)' : 'rgba(15,17,21,0.05)';
  const star = c.accentColor || '#FBBC04';
  const starMuted = dark ? 'rgba(246,247,250,0.22)' : 'rgba(18,22,29,0.18)';

  // ── HONEST STATES ────────────────────────────────────────────────────
  // WidgetEmptyState is surface-aware: the OPERATOR gets a named next action
  // in the builder, the PUBLIC gets a quiet, branded zone on the wall. Neither
  // ever shows fabricated reviews.
  if (!placeId && !sample) {
    return (
      <WidgetEmptyState
        eyebrow="GOOGLE REVIEWS"
        action="Pick your business in the Apps tab"
        hint="Apps → Google Reviews → search your business name"
        accent={star}
        tone={dark ? 'dark' : 'light'}
      />
    );
  }
  if (payload && payload.enabled === false) {
    return (
      <WidgetEmptyState
        eyebrow="GOOGLE REVIEWS"
        action="Google reviews need an API key — ask your admin"
        hint="A Google Maps key with Places API (New) enabled."
        accent={star}
        tone={dark ? 'dark' : 'light'}
      />
    );
  }
  if (!payload) {
    return (
      <WidgetEmptyState
        eyebrow="GOOGLE REVIEWS"
        action="Waiting for Google to answer"
        hint="Nothing has loaded on this screen yet."
        accent={star}
        tone={dark ? 'dark' : 'light'}
      />
    );
  }

  // ── SIZING ───────────────────────────────────────────────────────────
  // Everything derives from the measured box, with no upper ceiling — the
  // pattern `check-font-ceilings.cjs` exists to protect (a capped clamp() is
  // what rendered 196 widgets under 12px on a 4K wall).
  const w = boxWidth || Math.round(height * 1.4);
  const u = Math.max(11, Math.min(height, w * 0.62) * 0.062);
  const pad = Math.round(u * 0.85);
  const cards = layout === 'carousel' && shown.length > 0 ? [shown[cardIndex % shown.length]] : shown;
  const clampLines = layout === 'carousel' ? 6 : shown.length > 2 ? 2 : 4;

  const placeName = payload.place?.name || c.placeName || '';
  const rating = payload.place?.rating ?? null;
  const count = payload.place?.count ?? null;

  /** The ordering + filtering notice the policy requires whenever reviews are
   *  filtered or ordered. Google does not guarantee an order, so we say whose
   *  selection it is, and we name our own rating filter when one is on. */
  const orderNotice =
    minRating > 0
      ? `Google’s selection · ${minRating}★ and up`
      : 'Google’s selection';

  return (
    <div
      ref={boxRef}
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        overflow: 'hidden',
        background: bg,
        color: ink,
        padding: pad,
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      {/* ── HEADER ─────────────────────────────────────────────────── */}
      <div style={{ flexShrink: 0, marginBottom: Math.round(u * 0.6) }}>
        {placeName && (
          <div
            data-field="placeName"
            style={{
              fontSize: Math.round(u * 1.05),
              fontWeight: 800,
              letterSpacing: '-0.01em',
              lineHeight: 1.15,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {placeName}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', marginTop: Math.round(u * 0.25) }}>
          {typeof rating === 'number' && (
            <span
              data-field="placeRating"
              style={{
                fontSize: Math.round(u * 2.1),
                fontWeight: 800,
                lineHeight: 1,
                marginRight: Math.round(u * 0.5),
              }}
            >
              {rating.toFixed(1)}
            </span>
          )}
          {typeof rating === 'number' && (
            <StarBar
              value={rating}
              size={Math.round(u * 0.95)}
              color={star}
              mutedColor={starMuted}
              label={`${rating.toFixed(1)} out of 5 on Google`}
            />
          )}
          {typeof count === 'number' && (
            <span
              style={{
                fontSize: Math.round(u * 0.72),
                color: muted,
                marginLeft: Math.round(u * 0.5),
                whiteSpace: 'nowrap',
              }}
            >
              {count.toLocaleString()} reviews
            </span>
          )}
        </div>
      </div>

      {/* ── CARDS ──────────────────────────────────────────────────── */}
      <div style={{ flex: '1 1 auto', minHeight: 0, overflow: 'hidden' }}>
        {cards.length === 0 ? (
          <div style={{ fontSize: Math.round(u * 0.78), color: muted, lineHeight: 1.35 }}>
            {minRating > 0
              ? `No reviews at ${minRating}★ or above in what Google returned.`
              : 'Google returned no reviews for this business yet.'}
          </div>
        ) : (
          cards.map((r, i) => (
            <div key={`${r.author}-${r.publishedAt ?? i}`} style={{ marginBottom: Math.round(u * 0.45) }}>
              <ReviewCard
                review={r}
                u={u}
                ink={ink}
                muted={muted}
                panel={panel}
                star={star}
                starMuted={starMuted}
                lines={clampLines}
              />
            </div>
          ))
        )}
      </div>

      {/* ── ATTRIBUTION (required) ─────────────────────────────────── */}
      <div
        data-field="googleAttribution"
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          marginTop: Math.round(u * 0.35),
          fontSize: Math.round(u * 0.6),
          color: muted,
          lineHeight: 1.2,
        }}
      >
        <span style={{ marginRight: Math.round(u * 0.3), lineHeight: 0, flexShrink: 0 }}>
          <GoogleMapsMark size={Math.round(u * 0.85)} />
        </span>
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          Reviews from Google Maps · {orderNotice}
        </span>
      </div>
    </div>
  );
}

export default GoogleReviewsWidget;
