/**
 * Picker thumbnails for the basic content widgets
 * (Image, Image Carousel, Video, Video Carousel, Web Page, Signage Template).
 *
 * These render INSIDE the Widget Library picker as the variant thumbnail. When
 * the operator drops one on the canvas, the zone is rendered by WidgetRenderer's
 * case for the matching widgetType (VIDEO → VideoWidget, …) — every variant here
 * is `previewOnly: true`, so these are pictures, never the live widget.
 *
 * ── WHAT A THUMBNAIL IS FOR (2026-09-12) ──────────────────────────────
 * Operator: *"make sure these have a better icon or representation of what they
 * are, no tiny text non relevant widget faces."* The previous version of this
 * file drew a pastel gradient, a 14px lucide glyph, and the widget's own NAME in
 * ~6px type — under a card that already prints that name twice (title + type).
 * So the only pixels that carried information were the ones repeating the label,
 * and the picture itself said nothing about the difference between "Image" and
 * "Image Carousel".
 *
 * The rule these now follow: **draw the output, not the concept.** A thumbnail
 * shows a photo, a filmstrip, a browser window, a board — the thing the operator
 * will have on the wall after they drop it. No tile prints its own name; the
 * card does that, legibly, in real type.
 *
 * ── CONSTRAINTS ───────────────────────────────────────────────────────
 * Chromium 83 (NovaStar Taurus) is in the scan path for this directory, so:
 * no `inset` shorthand and no Tailwind `inset-*` (physical longhand only), no
 * flex `gap` (explicit offsets / margins instead), and no inline style object
 * that carries all four physical sides at once — see CLAUDE.md rule 10.
 *
 * Every SVG gradient/clip id is namespaced per tile: several of these render in
 * one document at once, and a duplicate id silently re-points the other tile's
 * fill at the wrong gradient.
 *
 * Why a separate file: variants-register.ts is `.ts` (no JSX).
 */

/** Shared full-bleed frame. `slice` crops like a photo instead of distorting. */
function Frame({ children, bg }: { children: React.ReactNode; bg?: string }) {
  return (
    <div
      className="absolute top-0 right-0 bottom-0 left-0 overflow-hidden"
      style={bg ? { background: bg } : undefined}
    >
      {children}
    </div>
  );
}

/**
 * The photograph every image-ish tile shows: sky, sun, two ridgelines, water
 * with a reflection streak. Deliberately a real little landscape rather than a
 * mountain ICON — at 185×115 the operator reads "a photo goes here" instantly,
 * which is the whole job of the thumbnail.
 */
function PhotoScene({ ns, dim = false }: { ns: string; dim?: boolean }) {
  return (
    <svg
      viewBox="0 0 160 100"
      preserveAspectRatio="xMidYMid slice"
      style={{ width: '100%', height: '100%', display: 'block' }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`${ns}-sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={dim ? '#1e293b' : '#38bdf8'} />
          <stop offset="55%" stopColor={dim ? '#334155' : '#bae6fd'} />
          <stop offset="100%" stopColor={dim ? '#475569' : '#fde68a'} />
        </linearGradient>
        <linearGradient id={`${ns}-water`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={dim ? '#0f172a' : '#0ea5e9'} />
          <stop offset="100%" stopColor={dim ? '#020617' : '#0369a1'} />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="160" height="100" fill={`url(#${ns}-sky)`} />
      <circle cx="118" cy="26" r="11" fill={dim ? '#e2e8f0' : '#fbbf24'} opacity={dim ? 0.55 : 0.95} />
      {/* back ridge */}
      <polygon points="0,62 34,34 60,55 88,28 122,60 160,40 160,72 0,72" fill={dim ? '#1e293b' : '#6366f1'} opacity="0.55" />
      {/* front ridge */}
      <polygon points="0,72 28,50 56,70 84,46 118,72 160,54 160,74 0,74" fill={dim ? '#0f172a' : '#4338ca'} opacity="0.85" />
      <rect x="0" y="73" width="160" height="27" fill={`url(#${ns}-water)`} />
      <rect x="70" y="79" width="34" height="2" rx="1" fill="#ffffff" opacity="0.35" />
      <rect x="58" y="86" width="58" height="2" rx="1" fill="#ffffff" opacity="0.22" />
    </svg>
  );
}

/** One tiny photo used inside a filmstrip / stacked card. */
function MiniScene({ ns, hue }: { ns: string; hue: string }) {
  return (
    <svg viewBox="0 0 40 28" preserveAspectRatio="xMidYMid slice" style={{ width: '100%', height: '100%', display: 'block' }} aria-hidden="true">
      <rect x="0" y="0" width="40" height="28" fill={hue} />
      <circle cx="30" cy="8" r="3.4" fill="#ffffff" opacity="0.7" />
      <polygon points="0,22 10,12 18,20 26,10 40,22 40,28 0,28" fill="#0f172a" opacity="0.45" />
    </svg>
  );
}

/** Play glyph as geometry, so it stays crisp and needs no icon font. */
function PlayBadge({ size = '2.6em' }: { size?: string }) {
  return (
    <div
      style={{
        width: size, height: size, borderRadius: 999,
        background: 'rgba(15,23,42,0.55)',
        border: '0.12em solid rgba(255,255,255,0.85)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <svg viewBox="0 0 12 14" style={{ width: '38%', height: '38%', marginLeft: '8%' }} aria-hidden="true">
        <polygon points="0,0 12,7 0,14" fill="#ffffff" />
      </svg>
    </div>
  );
}

/* ── IMAGE ───────────────────────────────────────────────────────────── */
/** A photograph, edge to edge. That IS the widget. */
export function ImageBasicTile() {
  return (
    <Frame>
      <PhotoScene ns="tile-img" />
    </Frame>
  );
}

/* ── IMAGE CAROUSEL ──────────────────────────────────────────────────── */
/**
 * Three photos stacked back-to-front with pager dots — the difference from
 * Image, drawn rather than spelled. The back cards are rotated a couple of
 * degrees so the stack reads as a stack at thumbnail size.
 */
export function ImageCarouselBasicTile() {
  return (
    <Frame bg="linear-gradient(135deg,#0f172a,#1e293b)">
      {/* back card */}
      <div
        style={{
          position: 'absolute', top: '16%', left: '9%', width: '70%', height: '56%',
          borderRadius: '0.28em', overflow: 'hidden', transform: 'rotate(-5deg)',
          boxShadow: '0 0.15em 0.4em rgba(0,0,0,0.45)', opacity: 0.55,
        }}
      >
        <MiniScene ns="tile-carB" hue="#fb923c" />
      </div>
      {/* middle card */}
      <div
        style={{
          position: 'absolute', top: '13%', left: '17%', width: '70%', height: '56%',
          borderRadius: '0.28em', overflow: 'hidden', transform: 'rotate(3deg)',
          boxShadow: '0 0.15em 0.4em rgba(0,0,0,0.5)', opacity: 0.8,
        }}
      >
        <MiniScene ns="tile-carM" hue="#34d399" />
      </div>
      {/* front card — the one "playing" */}
      <div
        style={{
          position: 'absolute', top: '10%', left: '13%', width: '74%', height: '60%',
          borderRadius: '0.28em', overflow: 'hidden',
          border: '0.12em solid rgba(255,255,255,0.9)',
          boxShadow: '0 0.25em 0.6em rgba(0,0,0,0.55)',
        }}
      >
        <PhotoScene ns="tile-carF" />
      </div>
      {/* pager dots — active one wider, the universal "slide 2 of 3" tell */}
      <div style={{ position: 'absolute', bottom: '7%', left: 0, width: '100%', textAlign: 'center' }}>
        <span style={{ display: 'inline-block', width: '0.3em', height: '0.3em', borderRadius: 999, background: 'rgba(255,255,255,0.45)', marginRight: '0.24em' }} />
        <span style={{ display: 'inline-block', width: '0.75em', height: '0.3em', borderRadius: 999, background: '#ffffff', marginRight: '0.24em' }} />
        <span style={{ display: 'inline-block', width: '0.3em', height: '0.3em', borderRadius: 999, background: 'rgba(255,255,255,0.45)' }} />
      </div>
    </Frame>
  );
}

/* ── VIDEO ───────────────────────────────────────────────────────────── */
/**
 * A paused frame with player chrome: scrim, play badge, and a real scrub bar
 * with a filled head. The scrub bar is what separates "video" from "photo" at a
 * glance — an icon alone does not.
 */
export function VideoBasicTile() {
  return (
    <Frame bg="#0b1120">
      <PhotoScene ns="tile-vid" dim />
      <div
        className="absolute top-0 right-0 bottom-0 left-0"
        style={{ background: 'linear-gradient(180deg, rgba(2,6,23,0.25), rgba(2,6,23,0.72))' }}
      />
      <div className="absolute top-0 right-0 bottom-0 left-0 flex items-center justify-center">
        <PlayBadge />
      </div>
      {/* scrub bar */}
      <div style={{ position: 'absolute', bottom: '11%', left: '9%', width: '82%', height: '0.22em', borderRadius: 999, background: 'rgba(255,255,255,0.28)' }} />
      <div style={{ position: 'absolute', bottom: '11%', left: '9%', width: '34%', height: '0.22em', borderRadius: 999, background: '#f8fafc' }} />
      <div style={{ position: 'absolute', bottom: '8.4%', left: '41%', width: '0.42em', height: '0.42em', borderRadius: 999, background: '#f8fafc' }} />
    </Frame>
  );
}

/* ── VIDEO CAROUSEL ──────────────────────────────────────────────────── */
/**
 * A filmstrip: sprocket holes top and bottom, three frames in sequence, the
 * middle one playing. Says "several videos, one after another" without a word.
 */
export function VideoCarouselTile() {
  const sprockets = [0, 1, 2, 3, 4, 5, 6, 7];
  const hole = (topPct: string) =>
    sprockets.map((i) => (
      <div
        key={`${topPct}-${i}`}
        style={{
          position: 'absolute', top: topPct, left: `${3.5 + i * 12.2}%`,
          width: '5%', height: '7%', borderRadius: '0.12em', background: '#0b1120',
        }}
      />
    ));
  const frame = (leftPct: string, hue: string, ns: string, playing: boolean) => (
    <div
      style={{
        position: 'absolute', top: '24%', left: leftPct, width: '28%', height: '52%',
        borderRadius: '0.18em', overflow: 'hidden',
        border: playing ? '0.12em solid #ffffff' : '0.08em solid rgba(255,255,255,0.25)',
      }}
    >
      <MiniScene ns={ns} hue={hue} />
      {playing && (
        <div className="absolute top-0 right-0 bottom-0 left-0 flex items-center justify-center" style={{ background: 'rgba(2,6,23,0.42)' }}>
          <svg viewBox="0 0 12 14" style={{ width: '26%', height: '26%', marginLeft: '6%' }} aria-hidden="true">
            <polygon points="0,0 12,7 0,14" fill="#ffffff" />
          </svg>
        </div>
      )}
    </div>
  );
  return (
    <Frame bg="linear-gradient(135deg,#312e81,#1e1b4b)">
      <div className="absolute top-0 right-0 bottom-0 left-0" style={{ background: '#1e1b4b' }} />
      {hole('8%')}
      {hole('85%')}
      {frame('4%', '#f472b6', 'tile-vcA', false)}
      {frame('36%', '#38bdf8', 'tile-vcB', true)}
      {frame('68%', '#facc15', 'tile-vcC', false)}
    </Frame>
  );
}

/* ── WEB PAGE ────────────────────────────────────────────────────────── */
/**
 * A browser window: traffic lights, an address pill, then a page with a nav
 * bar, a hero block and copy lines. Nothing else in the picker looks like this,
 * which is the point — the operator can find it by shape.
 */
export function WebpageTile() {
  return (
    <Frame bg="#e2e8f0">
      {/* chrome bar */}
      <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '22%', background: '#cbd5e1' }} />
      <div style={{ position: 'absolute', top: '8%', left: '4%', width: '0.3em', height: '0.3em', borderRadius: 999, background: '#ef4444' }} />
      <div style={{ position: 'absolute', top: '8%', left: '10%', width: '0.3em', height: '0.3em', borderRadius: 999, background: '#f59e0b' }} />
      <div style={{ position: 'absolute', top: '8%', left: '16%', width: '0.3em', height: '0.3em', borderRadius: 999, background: '#22c55e' }} />
      <div style={{ position: 'absolute', top: '6.5%', left: '24%', width: '70%', height: '9%', borderRadius: 999, background: '#f8fafc' }} />
      {/* page */}
      <div style={{ position: 'absolute', top: '22%', left: 0, width: '100%', height: '78%', background: '#ffffff' }} />
      <div style={{ position: 'absolute', top: '27%', left: '6%', width: '26%', height: '7%', borderRadius: '0.14em', background: '#6366f1' }} />
      <div style={{ position: 'absolute', top: '28.5%', left: '40%', width: '14%', height: '4%', borderRadius: 999, background: '#cbd5e1' }} />
      <div style={{ position: 'absolute', top: '28.5%', left: '58%', width: '14%', height: '4%', borderRadius: 999, background: '#cbd5e1' }} />
      <div style={{ position: 'absolute', top: '28.5%', left: '76%', width: '14%', height: '4%', borderRadius: 999, background: '#cbd5e1' }} />
      <div style={{ position: 'absolute', top: '41%', left: '6%', width: '50%', height: '30%', borderRadius: '0.18em', background: 'linear-gradient(135deg,#a5b4fc,#c7d2fe)' }} />
      <div style={{ position: 'absolute', top: '43%', left: '60%', width: '34%', height: '5%', borderRadius: 999, background: '#e2e8f0' }} />
      <div style={{ position: 'absolute', top: '52%', left: '60%', width: '30%', height: '5%', borderRadius: 999, background: '#e2e8f0' }} />
      <div style={{ position: 'absolute', top: '61%', left: '60%', width: '22%', height: '5%', borderRadius: 999, background: '#e2e8f0' }} />
      <div style={{ position: 'absolute', top: '78%', left: '6%', width: '88%', height: '5%', borderRadius: 999, background: '#f1f5f9' }} />
    </Frame>
  );
}

/* ── SIGNAGE TEMPLATE ────────────────────────────────────────────────── */
/**
 * A finished BOARD — header with a logo mark, a hero photo, two content cards
 * and a ticker across the bottom. This tile stands for 250 ready-made HTML
 * boards, so it has to read as "a whole screen, already designed", not as one
 * more widget.
 */
export function ExternalHtmlTile() {
  return (
    <Frame bg="#0f172a">
      {/* header */}
      <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '20%', background: 'linear-gradient(90deg,#4338ca,#6d28d9)' }} />
      <div style={{ position: 'absolute', top: '5.5%', left: '4%', width: '0.62em', height: '0.62em', borderRadius: '0.14em', background: '#facc15' }} />
      <div style={{ position: 'absolute', top: '7.5%', left: '13%', width: '34%', height: '5.5%', borderRadius: 999, background: 'rgba(255,255,255,0.9)' }} />
      <div style={{ position: 'absolute', top: '7.5%', left: '80%', width: '16%', height: '5.5%', borderRadius: 999, background: 'rgba(255,255,255,0.45)' }} />
      {/* hero photo */}
      <div style={{ position: 'absolute', top: '24%', left: '4%', width: '54%', height: '50%', borderRadius: '0.2em', overflow: 'hidden' }}>
        <PhotoScene ns="tile-ext" />
      </div>
      {/* side cards */}
      <div style={{ position: 'absolute', top: '24%', left: '62%', width: '34%', height: '23%', borderRadius: '0.2em', background: '#1e293b' }} />
      <div style={{ position: 'absolute', top: '28%', left: '66%', width: '20%', height: '5%', borderRadius: 999, background: '#64748b' }} />
      <div style={{ position: 'absolute', top: '36%', left: '66%', width: '26%', height: '7%', borderRadius: 999, background: '#38bdf8' }} />
      <div style={{ position: 'absolute', top: '51%', left: '62%', width: '34%', height: '23%', borderRadius: '0.2em', background: '#1e293b' }} />
      <div style={{ position: 'absolute', top: '55%', left: '66%', width: '24%', height: '5%', borderRadius: 999, background: '#64748b' }} />
      <div style={{ position: 'absolute', top: '63%', left: '66%', width: '16%', height: '7%', borderRadius: 999, background: '#f472b6' }} />
      {/* ticker */}
      <div style={{ position: 'absolute', top: '80%', left: 0, width: '100%', height: '20%', background: '#facc15' }} />
      <div style={{ position: 'absolute', top: '87%', left: '4%', width: '40%', height: '6%', borderRadius: 999, background: 'rgba(15,23,42,0.55)' }} />
      <div style={{ position: 'absolute', top: '87%', left: '48%', width: '28%', height: '6%', borderRadius: 999, background: 'rgba(15,23,42,0.35)' }} />
      <div style={{ position: 'absolute', top: '87%', left: '80%', width: '16%', height: '6%', borderRadius: 999, background: 'rgba(15,23,42,0.35)' }} />
    </Frame>
  );
}
