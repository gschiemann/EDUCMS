'use client';

/**
 * SOCIAL_FEED — real posts from a connected Instagram or Facebook Page.
 * ─────────────────────────────────────────────────────────────────────
 *
 * WHAT THIS REPLACES (2026-09-12). Until now `SocialWidget` rendered the word
 * "Coming soon", and it was right to: the 2026-08-03 integration census
 * proved — two ways — that nothing in the app had ever fetched a social post.
 * That is fixed at the source now (apps/api/src/integrations/social/), so
 * this widget draws the cached posts the API syncs hourly.
 *
 * ── THE HONESTY RULES THIS FILE KEEPS ──────────────────────────────────
 * There is no sample-post fallback anywhere below, and there must never be
 * one. A signage board that invents plausible-looking posts is worse than one
 * that says nothing: the operator cannot tell a working board from a broken
 * one, which is the exact defect class the "Coming soon" text existed to
 * avoid. So every not-showing-posts state says which one it is:
 *
 *   no connection      builder: "Connect an Instagram account…" (actionable)
 *                      player:  a neutral branded panel, NO instructions —
 *                               the wall is not where you fix this
 *   EXPIRED / REVOKED  "…access expired — reconnect in the Apps tab"
 *   empty              "@handle hasn't posted yet"
 *   fetch failure      keep the LAST GOOD list (the hook's job), and label
 *                      the strip "Showing saved posts"
 *
 * And the freshness line reads `connection.lastSyncedAt` — the server's
 * record of when it last talked to Meta. NEVER render time. A board that
 * says "just now" because it repainted is a lie the fleet has been burned by.
 *
 * ── CHROMIUM 83 / TAURUS (CLAUDE.md rule 10) ───────────────────────────
 *  • no `inset` shorthand and no Tailwind `inset-*` — four physical sides;
 *  • no inline style object carrying all four physical sides at once (the
 *    CSSOM re-serialises that to `inset` and the polyfill then zeroes it) —
 *    every absolutely-positioned box here uses three sides + an explicit
 *    width/height;
 *  • no flex `gap` — explicit margins;
 *  • no `backdrop-filter`;
 *  • no container-query units, and no `vw`/`vh`/`vmin` type sizing. Type is
 *    sized off the widget's OWN measured box (`useMeasuredBox`), because a
 *    zone is a fraction of the screen and viewport units make a 4K board
 *    render phone-sized type in it.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Image as ImageIcon, PlayCircle, Layers } from 'lucide-react';
// lucide dropped brand glyphs, so the repo keeps hand-authored inline marks.
// That module is a leaf (React types only), so importing it here adds nothing
// to the player bundle beyond two <path>s.
import { InstagramIcon, FacebookIcon } from '@/components/apps/brand-icons';
import { useSocialPosts } from '@/lib/social/use-social-posts';
import type { SocialPostView } from '@/lib/social/device-social';

export interface SocialFeedConfig {
  provider?: 'instagram' | 'facebook';
  connectionId?: string;
  /** "@handle" / Page name, captured when the operator picked the account, so
   *  the builder can label the zone before any fetch resolves. */
  accountLabel?: string;
  maxItems?: number;
  layout?: 'grid' | 'single';
  /** Optional operator heading. Defaults to the account label. */
  title?: string;
}

/** Measured box. Everything below sizes off this, never off the viewport.
 *  Falls back to a 1080p-ish box so SSR and jsdom render real content rather
 *  than a blank frame (withMeasuredHeight returns null until measured, which
 *  makes a widget untestable and flashes empty). */
function useMeasuredBox(): [React.RefObject<HTMLDivElement | null>, { w: number; h: number }] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ w: 960, h: 540 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.offsetWidth || 0;
      const h = el.offsetHeight || 0;
      if (w > 0 && h > 0) setBox((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, box];
}

const BRAND: Record<'instagram' | 'facebook', { name: string; from: string; to: string; ink: string }> = {
  instagram: { name: 'Instagram', from: '#833ab4', to: '#fd1d1d', ink: '#ffffff' },
  facebook: { name: 'Facebook', from: '#1877f2', to: '#0b5fce', ink: '#ffffff' },
};

/** "2 hours ago" from an ISO string. Returns '' for anything unparseable —
 *  an empty label beats a wrong one. */
export function relativeAge(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const mins = Math.floor((now - t) / 60_000);
  if (mins < 0) return '';
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/**
 * Grid shape for N tiles inside a box of this aspect. Pure + exported so the
 * layout is unit-testable without a DOM (jsdom has no layout, so measuring it
 * in a render test would prove nothing).
 *
 * Two things are being traded off, and the SECOND one is easy to forget:
 *   • cells should be near-square, so a photo crops sensibly;
 *   • the last row should be FULL. Six posts in a 1920×1080 zone score best
 *     on squareness alone at 4×2 — which leaves two empty holes on the wall.
 *     Squareness-only was the first implementation and its own test caught
 *     it, so the empty-cell penalty is deliberately heavy.
 */
export function gridShape(count: number, w: number, h: number): { cols: number; rows: number } {
  const n = Math.max(1, Math.floor(count) || 1);
  const width = w > 0 ? w : 16;
  const height = h > 0 ? h : 9;
  let best = { cols: 1, rows: n, score: Number.POSITIVE_INFINITY };
  for (let cols = 1; cols <= n; cols += 1) {
    const rows = Math.ceil(n / cols);
    const cellAspect = (width / cols) / (height / rows);
    const squareness = Math.abs(Math.log(cellAspect || 1));
    const emptyCells = cols * rows - n;
    const score = squareness + emptyCells * 0.35;
    if (score < best.score) best = { cols, rows, score };
  }
  return { cols: best.cols, rows: best.rows };
}

function kindIcon(kind: string) {
  if (kind === 'video') return PlayCircle;
  if (kind === 'carousel') return Layers;
  return ImageIcon;
}

// ─── the shell every state renders inside ─────────────────────────────

function Shell({
  provider, title, subtitle, unit, children, footer,
}: {
  provider: 'instagram' | 'facebook';
  title: string;
  subtitle?: string;
  unit: number;
  children: React.ReactNode;
  footer?: string;
}) {
  const brand = BRAND[provider];
  const Icon = provider === 'instagram' ? InstagramIcon : FacebookIcon;
  const headH = Math.round(unit * 2.4);
  return (
    <div
      className="absolute top-0 right-0 bottom-0 left-0 overflow-hidden"
      style={{ background: '#0f172a', display: 'flex', flexDirection: 'column' }}
    >
      <div
        style={{
          height: headH,
          flex: '0 0 auto',
          background: `linear-gradient(135deg, ${brand.from}, ${brand.to})`,
          color: brand.ink,
          display: 'flex',
          alignItems: 'center',
          paddingLeft: Math.round(unit * 0.9),
          paddingRight: Math.round(unit * 0.9),
        }}
      >
        <Icon
          aria-hidden
          style={{ width: unit * 1.1, height: unit * 1.1, marginRight: Math.round(unit * 0.5), flex: '0 0 auto' }}
        />
        <span
          data-field="title"
          style={{
            fontSize: unit,
            fontWeight: 800,
            letterSpacing: '-0.01em',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {title}
        </span>
        {subtitle ? (
          <span
            style={{
              marginLeft: 'auto',
              paddingLeft: Math.round(unit * 0.5),
              fontSize: Math.round(unit * 0.62),
              fontWeight: 600,
              opacity: 0.85,
              whiteSpace: 'nowrap',
            }}
          >
            {subtitle}
          </span>
        ) : null}
      </div>
      <div style={{ flex: '1 1 auto', position: 'relative', overflow: 'hidden' }}>{children}</div>
      {footer ? (
        <div
          style={{
            flex: '0 0 auto',
            background: '#1e293b',
            color: '#cbd5e1',
            fontSize: Math.round(unit * 0.58),
            fontWeight: 600,
            paddingTop: Math.round(unit * 0.28),
            paddingBottom: Math.round(unit * 0.28),
            paddingLeft: Math.round(unit * 0.9),
            paddingRight: Math.round(unit * 0.9),
          }}
        >
          {footer}
        </div>
      ) : null}
    </div>
  );
}

/** A centred sentence — every not-showing-posts state uses this, so they all
 *  look deliberate rather than broken. */
function Message({ unit, lines }: { unit: number; lines: string[] }) {
  return (
    <div
      className="absolute top-0 right-0 bottom-0 left-0"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        paddingLeft: Math.round(unit * 1.5),
        paddingRight: Math.round(unit * 1.5),
      }}
    >
      {lines.map((line, i) => (
        <span
          key={i}
          style={{
            fontSize: i === 0 ? Math.round(unit * 0.92) : Math.round(unit * 0.68),
            fontWeight: i === 0 ? 700 : 500,
            color: i === 0 ? '#e2e8f0' : '#94a3b8',
            marginTop: i === 0 ? 0 : Math.round(unit * 0.35),
            lineHeight: 1.35,
          }}
        >
          {line}
        </span>
      ))}
    </div>
  );
}

// ─── one post ─────────────────────────────────────────────────────────

function PostTile({
  post, unit, showCaption,
}: {
  post: SocialPostView;
  unit: number;
  showCaption: boolean;
}) {
  const KindIcon = kindIcon(post.kind);
  const picture = post.mediaUrl || post.thumbnailUrl;
  const age = relativeAge(post.postedAt);
  const captionH = Math.round(unit * 2.3);
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: '#1e293b' }}>
      {picture ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={picture}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      ) : (
        // A text-only post is real content, not a failure — give it the
        // caption as the whole tile rather than an empty grey square.
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: Math.round(unit * 0.8),
            boxSizing: 'border-box',
          }}
        >
          <span
            style={{
              fontSize: Math.round(unit * 0.78),
              fontWeight: 600,
              color: '#e2e8f0',
              lineHeight: 1.35,
              textAlign: 'center',
              overflow: 'hidden',
            }}
          >
            {post.text || ''}
          </span>
        </div>
      )}

      {/* Caption strip. Three physical sides + an explicit height — a four-
          side object would serialise to `inset` and hit the Taurus polyfill. */}
      {showCaption && picture && (post.text || age) ? (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: captionH,
            background: 'linear-gradient(180deg, rgba(15,23,42,0) 0%, rgba(15,23,42,0.86) 55%)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
            paddingLeft: Math.round(unit * 0.5),
            paddingRight: Math.round(unit * 0.5),
            paddingBottom: Math.round(unit * 0.35),
            boxSizing: 'border-box',
          }}
        >
          {post.text ? (
            <span
              style={{
                fontSize: Math.round(unit * 0.6),
                fontWeight: 600,
                color: '#ffffff',
                lineHeight: 1.25,
                overflow: 'hidden',
                display: 'block',
                maxHeight: Math.round(unit * 1.6),
              }}
            >
              {post.text}
            </span>
          ) : null}
          {age ? (
            <span
              style={{
                fontSize: Math.round(unit * 0.48),
                fontWeight: 600,
                color: '#cbd5e1',
                marginTop: Math.round(unit * 0.12),
              }}
            >
              {age}
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Kind badge, so a video reads as a video on a silent wall. */}
      {post.kind === 'video' || post.kind === 'carousel' ? (
        <div
          style={{
            position: 'absolute',
            top: Math.round(unit * 0.3),
            right: Math.round(unit * 0.3),
            width: Math.round(unit * 0.95),
            height: Math.round(unit * 0.95),
            borderRadius: '50%',
            background: 'rgba(15,23,42,0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <KindIcon aria-hidden style={{ width: unit * 0.6, height: unit * 0.6, color: '#ffffff' }} />
        </div>
      ) : null}
    </div>
  );
}

// ─── the widget ───────────────────────────────────────────────────────

export function SocialFeedWidget({
  config,
  live,
}: {
  config: SocialFeedConfig;
  /** True on the PLAYER. Controls whether an empty state may give the
   *  operator instructions — the wall is not where anyone fixes this. */
  live?: boolean;
}) {
  const provider: 'instagram' | 'facebook' = config?.provider === 'facebook' ? 'facebook' : 'instagram';
  const maxItems = Math.max(1, Math.min(12, Math.floor(Number(config?.maxItems)) || 6));
  const layout: 'grid' | 'single' = config?.layout === 'single' ? 'single' : 'grid';
  const connectionId = typeof config?.connectionId === 'string' ? config.connectionId : undefined;

  const [ref, box] = useMeasuredBox();
  // Base type unit: a fraction of the SHORT side of the widget's own box, so
  // a tall narrow zone and a wide banner both get readable type, and a 4K
  // board gets 4K-sized type. Floored so a thumbnail never goes sub-pixel.
  const unit = Math.max(9, Math.round(Math.min(box.w, box.h) * 0.085));

  const { posts, status, connection } = useSocialPosts(connectionId, maxItems);

  // Single-post rotation. The index is clamped on every render against the
  // CURRENT list length, so a shrinking feed can never point past the end.
  const [index, setIndex] = useState(0);
  const count = posts ? posts.length : 0;
  useEffect(() => {
    if (layout !== 'single' || count <= 1) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % count), 12_000);
    return () => clearInterval(t);
  }, [layout, count]);

  const brandName = BRAND[provider].name;
  const label = connection?.displayName || config?.accountLabel || brandName;
  const title = (typeof config?.title === 'string' && config.title.trim()) || label;

  // ── No connection ──
  if (!connectionId) {
    return (
      <div ref={ref} style={{ width: '100%', height: '100%', position: 'relative' }}>
        <Shell provider={provider} title={brandName} unit={unit}>
          <Message
            unit={unit}
            lines={
              live
                ? // On the wall: a neutral branded panel. No instructions, no
                  // sample posts, nothing an audience would read as content.
                  [`${brandName}`]
                : [
                    `Connect ${provider === 'instagram' ? 'an Instagram account' : 'a Facebook Page'} to show posts here`,
                    'Apps → ' + brandName + ' → Connect',
                  ]
            }
          />
        </Shell>
      </div>
    );
  }

  // ── Dead credential ──
  const dead = connection && (connection.status === 'EXPIRED' || connection.status === 'REVOKED');
  const hasPosts = !!posts && posts.length > 0;
  if (dead && !hasPosts) {
    return (
      <div ref={ref} style={{ width: '100%', height: '100%', position: 'relative' }}>
        <Shell provider={provider} title={title} unit={unit}>
          <Message
            unit={unit}
            lines={[
              `${brandName} access expired`,
              live ? 'Reconnect this account to resume posts' : 'Reconnect in the Apps tab',
            ]}
          />
        </Shell>
      </div>
    );
  }

  // ── Nothing yet ──
  if (!posts) {
    return (
      <div ref={ref} style={{ width: '100%', height: '100%', position: 'relative' }}>
        <Shell provider={provider} title={title} unit={unit}>
          <Message unit={unit} lines={[`Loading posts from ${label}…`]} />
        </Shell>
      </div>
    );
  }
  if (posts.length === 0) {
    return (
      <div ref={ref} style={{ width: '100%', height: '100%', position: 'relative' }}>
        <Shell provider={provider} title={title} unit={unit}>
          <Message unit={unit} lines={[`${label} hasn’t posted yet`]} />
        </Shell>
      </div>
    );
  }

  // ── Posts ──
  const shown = posts.slice(0, maxItems);
  // "Showing saved posts" is the honest label for a list that survived a
  // failed refresh, and a dead credential that still has cached posts says
  // so rather than pretending everything is fine.
  const footer = dead
    ? `${brandName} access expired — reconnect to get new posts`
    : status === 'stale'
      ? 'Showing saved posts'
      : undefined;
  const subtitle = connection?.lastSyncedAt ? `Updated ${relativeAge(connection.lastSyncedAt)}` : undefined;

  if (layout === 'single') {
    const post = shown[Math.min(index, shown.length - 1)];
    return (
      <div ref={ref} style={{ width: '100%', height: '100%', position: 'relative' }}>
        <Shell provider={provider} title={title} subtitle={subtitle} unit={unit} footer={footer}>
          <PostTile post={post} unit={Math.round(unit * 1.25)} showCaption />
        </Shell>
      </div>
    );
  }

  const { cols, rows } = gridShape(shown.length, box.w, box.h);
  const pad = Math.max(2, Math.round(unit * 0.14));
  return (
    <div ref={ref} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Shell provider={provider} title={title} subtitle={subtitle} unit={unit} footer={footer}>
        <div
          className="absolute top-0 right-0 bottom-0 left-0"
          style={{
            display: 'grid',
            // `grid-gap` is the Chromium-83-safe spelling; modern engines
            // treat it as an alias of `gap`, and the rule that bans `gap`
            // here is about FLEX containers on Chromium 83 — but padding on
            // the cells avoids the question entirely, so we use that.
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gridTemplateRows: `repeat(${rows}, 1fr)`,
          }}
        >
          {shown.map((p) => (
            <div key={p.id} style={{ padding: pad, boxSizing: 'border-box', minWidth: 0, minHeight: 0 }}>
              <PostTile post={p} unit={unit} showCaption={cols <= 3} />
            </div>
          ))}
        </div>
      </Shell>
    </div>
  );
}

/**
 * Picker thumbnail. Draws the OUTPUT — a 3×2 photo grid with a caption strip
 * — with no network and no sample "posts" that could be mistaken for real
 * content on a canvas. It is a picture of the layout, as
 * `variant-tiles/basic-content-tiles.tsx` requires, and it never prints the
 * widget's own name (the card does that).
 */
export function SocialFeedTile() {
  return (
    <div className="absolute top-0 right-0 bottom-0 left-0 overflow-hidden" style={{ background: '#0f172a' }}>
      <svg
        viewBox="0 0 160 100"
        preserveAspectRatio="xMidYMid slice"
        style={{ width: '100%', height: '100%', display: 'block' }}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="sfeed-bar" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#833ab4" />
            <stop offset="100%" stopColor="#fd1d1d" />
          </linearGradient>
          <linearGradient id="sfeed-p1" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#38bdf8" />
            <stop offset="100%" stopColor="#0369a1" />
          </linearGradient>
          <linearGradient id="sfeed-p2" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fbbf24" />
            <stop offset="100%" stopColor="#b45309" />
          </linearGradient>
          <linearGradient id="sfeed-p3" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#34d399" />
            <stop offset="100%" stopColor="#047857" />
          </linearGradient>
        </defs>

        {/* brand header bar */}
        <rect x="0" y="0" width="160" height="16" fill="url(#sfeed-bar)" />
        {/* a camera glyph, drawn not imported, so the tile has no runtime deps */}
        <rect x="6" y="4.5" width="7" height="7" rx="2.2" fill="none" stroke="#fff" strokeWidth="1.1" />
        <circle cx="9.5" cy="8" r="1.7" fill="none" stroke="#fff" strokeWidth="1.1" />
        <rect x="17" y="6" width="34" height="4" rx="2" fill="#fff" opacity="0.9" />

        {/* 3 × 2 photo grid */}
        {[0, 1, 2].map((c) =>
          [0, 1].map((r) => {
            const x = 2 + c * 52.3;
            const y = 18 + r * 41;
            const fill = `url(#sfeed-p${((c + r) % 3) + 1})`;
            return (
              <g key={`${c}-${r}`}>
                <rect x={x} y={y} width="50" height="39" rx="2" fill={fill} />
                {/* a little scene inside each frame so it reads as a photo */}
                <circle cx={x + 38} cy={y + 10} r="4" fill="#fff" opacity="0.75" />
                <polygon
                  points={`${x},${y + 39} ${x + 14},${y + 22} ${x + 26},${y + 33} ${x + 36},${y + 24} ${x + 50},${y + 39}`}
                  fill="#0f172a"
                  opacity="0.35"
                />
                {/* caption strip */}
                <rect x={x} y={y + 29} width="50" height="10" fill="#0f172a" opacity="0.7" />
                <rect x={x + 3} y={y + 32} width="32" height="2.2" rx="1.1" fill="#fff" opacity="0.85" />
                <rect x={x + 3} y={y + 35.4} width="18" height="1.8" rx="0.9" fill="#cbd5e1" opacity="0.8" />
              </g>
            );
          }),
        )}
      </svg>
    </div>
  );
}
