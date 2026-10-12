'use client';

/**
 * MusicPlayerWidget — venue background music with multi-provider support.
 *
 * Created 2026-05-25 music-overhaul. Operator question:
 *   "how do I use the music plugin that we have on this template,
 *   can I plug me apple music or spotify for business info in somehow
 *   or can we feed free music somehow maybe even based on the sites
 *   location info we feed local free music/radio?"
 *
 * Six sources:
 *   1. SomaFM      — free, embeddable, dozens of stations. Works today.
 *   2. NPR Live    — local-station finder by tenant lat/lng. Free.
 *   3. NTS Radio   — free, public, embeddable. Works today.
 *   4. Apple Music / Spotify for Business — not offered in the picker; a
 *      legacy saved source shows the neutral "pick a station" state.
 *   6. Custom stream URL (Icecast / Shoutcast / m3u8 audio) — paste
 *      your own stream URL. Works today.
 *
 * Why one widget, not six: the operator drops ONE thing, then picks
 * the source in Properties. Same UX pattern as the streaming widget
 * (one tile, many providers).
 *
 * Schedule controls:
 *   • pauseDuringEmergency (default true) — silence when the tenant
 *     emergency status is non-NORMAL. Same hook as the StreamAdSlot
 *     pause path. Implementation note: this widget reads
 *     props.config.pauseDuringEmergency on every render; the player
 *     wraps the template render in <EmergencyOverlayProvider> which
 *     exposes the emergency state via DOM dataset. When that flag is
 *     set AND emergency is active we render the silenced fallback
 *     instead of the audio element.
 *   • businessHours (optional) — { start: 'HH:MM', end: 'HH:MM',
 *     daysOfWeek: number[] } — silences outside the operator's
 *     business hours so the widget doesn't blast SomaFM at 3am.
 *
 * Player UX:
 *   • The player MUST allow autoplay (browser policy permits muted
 *     autoplay; audio-only autoplay also works on most signage
 *     browsers because they're a kiosk-mode user-installed app).
 *   • If autoplay is blocked, we surface a "Tap to start music" prompt.
 *   • Auto-resume on player reload via localStorage key
 *     'music-player:lastStation:<configId>'.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

type MusicSource =
  | 'somafm'
  | 'npr'
  | 'nts'
  | 'apple-business'
  | 'spotify-business'
  | 'custom-stream';

interface MusicPlayerConfig {
  source?: MusicSource;
  /** SomaFM station id (slug) — e.g. 'groovesalad', 'dronezone', 'secretagent'. */
  somafmStationId?: string;
  /** NPR station call sign (e.g. 'KQED', 'WBEZ') resolved by the
   *  location finder UI in Properties. */
  nprStationCallSign?: string;
  /** Direct HLS / Icecast / Shoutcast / m3u8 audio URL. */
  customStreamUrl?: string;
  /** NTS channel — '1' or '2' (NTS only has two channels). */
  ntsChannel?: '1' | '2';
  /** 0-100 volume — multiplied by the audio element's volume control. */
  defaultVolume?: number;
  /** When the player auto-resumes a tenant's last station between
   *  reloads. Default true. */
  autoResume?: boolean;
  /** Silence the audio when the tenant emergency status is active. */
  pauseDuringEmergency?: boolean;
  /** Window of operator-permitted playback hours. Outside this,
   *  the widget shows the "off-hours silenced" fallback. */
  businessHours?: {
    start: string;        // "08:00"
    end: string;          // "22:00"
    daysOfWeek?: number[]; // 0=Sun..6=Sat — omit = every day
  };
  /** Optional zone label rendered at the top of the widget. */
  zoneLabel?: string;
  /** What the screen shows: nothing (audio only), a small corner badge, or a
   *  now-playing card. See resolveMusicDisplay. */
  display?: MusicDisplay;
  /** Legacy (pre-`display`) audio-only toggle — still honoured. */
  hideOnScreen?: boolean;
}

const SOMAFM_DIRECT_URLS: Record<string, string> = {
  // SomaFM publishes direct stream URLs at https://somafm.com/streams.html
  // Each station has a `.pls` and an `aac-mp3` direct endpoint.
  // We use the `direct` mp3 64k endpoint which is the most compatible
  // across Chromium 83 (Taurus) + Safari + Android System WebView.
  groovesalad:  'https://ice1.somafm.com/groovesalad-128-mp3',
  dronezone:    'https://ice1.somafm.com/dronezone-128-mp3',
  secretagent:  'https://ice1.somafm.com/secretagent-128-mp3',
  lush:         'https://ice1.somafm.com/lush-128-mp3',
  bagel:        'https://ice1.somafm.com/bagel-128-mp3',
  defcon:       'https://ice1.somafm.com/defcon-128-mp3',
  spacestation: 'https://ice1.somafm.com/spacestation-128-mp3',
  beatblender:  'https://ice1.somafm.com/beatblender-128-mp3',
  indie:        'https://ice1.somafm.com/indiepop-128-mp3',
  cliqhop:      'https://ice1.somafm.com/cliqhop-128-mp3',
  poptron:      'https://ice1.somafm.com/poptron-128-mp3',
  thetrip:      'https://ice1.somafm.com/thetrip-128-mp3',
  fluid:        'https://ice1.somafm.com/fluid-128-mp3',
  folkfwd:      'https://ice1.somafm.com/folkfwd-128-mp3',
  illstreet:    'https://ice1.somafm.com/illstreet-128-mp3',
  brfm:         'https://ice1.somafm.com/brfm-128-mp3',
  digitalis:    'https://ice1.somafm.com/digitalis-128-mp3',
  metal:        'https://ice1.somafm.com/metal-128-mp3',
  '7soul':      'https://ice1.somafm.com/7soul-128-mp3',
  seventies:    'https://ice1.somafm.com/seventies-128-mp3',
  u80s:         'https://ice1.somafm.com/u80s-128-mp3',
};

const NTS_DIRECT_URLS: Record<string, string> = {
  // NTS Radio public streams — documented at nts.live/api.
  // 96k m3u8 works on every modern browser; 128k mp3 is the fallback.
  '1': 'https://stream-relay-geo.ntslive.net/stream',
  '2': 'https://stream-relay-geo.ntslive.net/stream2',
};

function isWithinBusinessHours(bh?: MusicPlayerConfig['businessHours']): boolean {
  if (!bh) return true;
  const now = new Date();
  const day = now.getDay();
  if (bh.daysOfWeek && bh.daysOfWeek.length > 0 && !bh.daysOfWeek.includes(day)) return false;
  const [sh, sm] = (bh.start || '00:00').split(':').map(Number);
  const [eh, em] = (bh.end || '23:59').split(':').map(Number);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  if (startMin <= endMin) return nowMin >= startMin && nowMin <= endMin;
  // Overnight window (e.g. 22:00 → 02:00) — wraps midnight.
  return nowMin >= startMin || nowMin <= endMin;
}

/** Station display names — the same list the Properties picker offers. */
export const SOMAFM_STATION_NAMES: Record<string, string> = {
  groovesalad: 'Groove Salad', dronezone: 'Drone Zone', secretagent: 'Secret Agent',
  lush: 'Lush', bagel: 'BAGeL Radio', defcon: 'DEF CON Radio', spacestation: 'Space Station Soma',
  beatblender: 'Beat Blender', indie: 'Indie Pop Rocks!', cliqhop: 'cliqhop idm', poptron: 'PopTron',
  thetrip: 'The Trip', fluid: 'Fluid', folkfwd: 'Folk Forward', illstreet: 'Illinois Street Lounge',
  brfm: 'Black Rock FM', digitalis: 'Digitalis', metal: 'Metal Detector', '7soul': 'Seven Inch Soul',
  seventies: 'Left Coast 70s', u80s: 'Underground 80s',
};

export interface ResolvedStream {
  url: string | null;
  /** What is playing — a station name, in words a passer-by can read. */
  title: string;
  /** Who it comes from (SomaFM, NTS Radio, NPR, …). */
  provider: string;
}

export function resolveStreamUrl(c: MusicPlayerConfig): ResolvedStream {
  const src = c.source || 'somafm';
  switch (src) {
    case 'somafm': {
      const raw = (c.somafmStationId || 'groovesalad').toLowerCase();
      const id = SOMAFM_DIRECT_URLS[raw] ? raw : 'groovesalad';
      return { url: SOMAFM_DIRECT_URLS[id], title: SOMAFM_STATION_NAMES[id] || id, provider: 'SomaFM' };
    }
    case 'nts': {
      const ch = c.ntsChannel || '1';
      return { url: NTS_DIRECT_URLS[ch], title: `NTS ${ch}`, provider: 'NTS Radio' };
    }
    case 'npr': {
      // NPR doesn't publish a single global stream — each member station has
      // its own; the Properties panel stores the picked station's direct
      // stream in customStreamUrl.
      if (c.customStreamUrl) {
        return { url: c.customStreamUrl, title: c.nprStationCallSign || 'Local station', provider: 'NPR' };
      }
      return { url: null, title: 'NPR', provider: 'NPR' };
    }
    case 'custom-stream':
      return { url: c.customStreamUrl || null, title: c.zoneLabel || 'Live radio', provider: 'Stream' };
    // Legacy saved sources with no playable stream: show the neutral
    // "pick a station" state, never a label about a future release.
    case 'apple-business':
    case 'spotify-business':
      return { url: null, title: 'Music', provider: 'Music' };
    default:
      return { url: null, title: String(src), provider: String(src) };
  }
}

export type MusicDisplay = 'hidden' | 'badge' | 'card';

/**
 * How the player looks on screen. Owner, 2026-10-12: background music should
 * not sit on top of the content, so a NEW music zone is `hidden` (its seed
 * carries `display: 'hidden'`). A zone saved before `display` existed keeps
 * what it had: the card, unless its old `hideOnScreen` toggle was on.
 */
export function resolveMusicDisplay(c: { display?: unknown; hideOnScreen?: unknown }): MusicDisplay {
  if (c.display === 'hidden' || c.display === 'badge' || c.display === 'card') return c.display;
  return c.hideOnScreen === true ? 'hidden' : 'card';
}


type MusicState = 'playing' | 'tap' | 'off-hours' | 'silenced' | 'unset';

export function MusicPlayerWidget({
  config,
  live,
}: {
  config?: MusicPlayerConfig;
  live?: boolean;
}) {
  const t = useTranslations('musicPlayer');
  const c: MusicPlayerConfig = config || {};
  const isLive = !!live;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [needsTap, setNeedsTap] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stream = useMemo(() => resolveStreamUrl(c), [c]);
  const { url } = stream;
  const display = resolveMusicDisplay(c);
  const withinHours = useMemo(() => isWithinBusinessHours(c.businessHours), [c.businessHours]);

  // Emergency awareness — the player wraps templates in a provider
  // that decorates document.documentElement with dataset.emergency =
  // 'true' when active. Reading that here means we never need a
  // React context — works the same in builder preview (always inactive)
  // and live player render (active when emergency).
  const [emergencyActive, setEmergencyActive] = useState(false);
  useEffect(() => {
    if (!isLive) return;
    const check = () => {
      const flag = (typeof document !== 'undefined' && document.documentElement?.dataset?.emergency) || '';
      setEmergencyActive(flag === 'true' || flag === '1');
    };
    check();
    // Polling at 1Hz is cheap and avoids needing a mutation observer.
    const timer = setInterval(check, 1000);
    return () => clearInterval(timer);
  }, [isLive]);

  const silenced = !!c.pauseDuringEmergency && emergencyActive;
  const canPlay = !!url && withinHours && !silenced;

  // Auto-start playback when live + URL resolved + not silenced.
  useEffect(() => {
    if (!isLive || !url || silenced || !withinHours) return;
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = Math.max(0, Math.min(1, (c.defaultVolume ?? 70) / 100));
    audio.src = url;
    audio.play()
      .then(() => setNeedsTap(false))
      .catch(() => {
        // Most browsers block audio autoplay until first user gesture.
        // On a kiosk this fires once per provisioning; surface a clear
        // tap-to-start prompt so the operator knows it's a policy
        // gate, not a broken widget.
        setNeedsTap(true);
      });
    return () => {
      try { audio.pause(); audio.src = ''; } catch { /* ignore */ }
    };
  }, [isLive, url, silenced, withinHours, c.defaultVolume]);

  // Auto-resume — persist the last source + station so a player
  // reload picks up where it left off without operator intervention.
  useEffect(() => {
    if (!isLive || !url || c.autoResume === false) return;
    try { window.localStorage.setItem('music-player:lastStation', url); } catch { /* ignore */ }
  }, [isLive, url, c.autoResume]);

  const state: MusicState =
    !withinHours ? 'off-hours'
      : silenced ? 'silenced'
        : !url ? 'unset'
          : needsTap && isLive ? 'tap'
            : 'playing';

  // ONE audio element for every look, mounted only while it may play.
  const audio = canPlay ? <audio ref={audioRef} preload="none" crossOrigin="anonymous" style={{ display: 'none' }} /> : null;
  const tapButton = state === 'tap' ? (
    <button
      type="button"
      onClick={() => {
        const a = audioRef.current;
        if (a) a.play().then(() => setNeedsTap(false)).catch(() => setError(t('stillBlocked')));
      }}
      style={{ padding: '8px 16px', fontSize: 14, fontWeight: 700, borderRadius: 10, border: 0, background: '#10b981', color: '#fff', cursor: 'pointer' }}
    >
      {t('tapToStart')}
    </button>
  ) : null;

  const statusLine =
    state === 'off-hours' ? t('offHours', { start: c.businessHours?.start || '08:00', end: c.businessHours?.end || '22:00' })
      : state === 'silenced' ? t('silenced')
        : state === 'unset' ? t('pickStation')
          : error || stream.provider;

  // ─── Hidden (audio only) — the DEFAULT for a new music zone. On a screen it
  // paints nothing (except the one-time "tap to start" a browser may demand).
  // In the editor it is a small "♪ audio" chip so the operator can still find,
  // select and move it.
  if (display === 'hidden') {
    if (isLive) {
      return (
        <>
          {audio}
          {tapButton && <div style={{ position: 'absolute', top: 0, left: 0 }}>{tapButton}</div>}
        </>
      );
    }
    return (
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, ...NO_SELECT }}>
        <span
          data-music-chip="true"
          title={`${stream.title} · ${statusLine}`}
          style={{
            position: 'absolute', top: 6, left: 6, maxWidth: 'calc(100% - 12px)',
            display: 'inline-flex', alignItems: 'center', padding: '4px 10px 4px 8px',
            borderRadius: 999, background: 'rgba(15,23,42,0.82)', color: '#fff',
            fontFamily: FONT, fontSize: 12, fontWeight: 700, lineHeight: 1.2, whiteSpace: 'nowrap',
            overflow: 'hidden', textOverflow: 'ellipsis', boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
          }}
        >
          <span aria-hidden style={{ marginRight: 6, color: ACCENT }}>♪</span>
          {t('audioChip')}
          <span style={{ marginLeft: 6, fontWeight: 500, opacity: 0.75, overflow: 'hidden', textOverflow: 'ellipsis' }}>{stream.title}</span>
        </span>
      </div>
    );
  }

  const playing = state === 'playing';

  // ─── Small corner badge ─────────────────────────────────────
  if (display === 'badge') {
    return (
      <ScaledScene naturalW={420} naturalH={84} align="start">
        {audio}
        <div
          data-music-badge="true"
          style={{
            width: 420, height: 84, display: 'flex', alignItems: 'center', padding: '0 22px 0 12px',
            borderRadius: 42, background: 'rgba(15,23,42,0.88)', color: '#fff', fontFamily: FONT,
            boxShadow: '0 6px 20px rgba(0,0,0,0.28)', border: '1px solid rgba(255,255,255,0.10)', boxSizing: 'border-box',
          }}
        >
          <StationArt seed={stream.title} size={60} radius={30} />
          <div style={{ marginLeft: 14, minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 24, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{stream.title}</div>
            <div style={{ fontSize: 16, opacity: 0.7, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{statusLine}</div>
          </div>
          {tapButton ?? <Equalizer active={playing} height={30} bars={4} />}
        </div>
      </ScaledScene>
    );
  }

  // ─── Now-playing card ───────────────────────────────────────
  return (
    <ScaledScene naturalW={760} naturalH={240}>
      {audio}
      <div
        data-music-card="true"
        style={{
          position: 'relative', width: 760, height: 240, display: 'flex', alignItems: 'center',
          padding: 24, boxSizing: 'border-box', borderRadius: 28, overflow: 'hidden', fontFamily: FONT, color: '#fff',
          background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)',
          boxShadow: '0 18px 40px rgba(0,0,0,0.30)', border: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        {/* Brand glow — the tenant's own colours, softly. */}
        <div
          aria-hidden
          style={{
            position: 'absolute', top: -120, right: -80, width: 420, height: 420, borderRadius: '50%',
            background: `radial-gradient(circle, ${BRAND} 0%, rgba(0,0,0,0) 65%)`, opacity: 0.35,
          }}
        />
        <StationArt seed={stream.title} size={192} radius={22} />
        <div style={{ position: 'relative', marginLeft: 28, minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', fontSize: 15, fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase', color: ACCENT }}>
            {playing && <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#22c55e', marginRight: 9, boxShadow: '0 0 0 4px rgba(34,197,94,0.20)' }} />}
            {c.zoneLabel || t('nowPlaying')}
          </div>
          <div style={{ marginTop: 10, fontSize: 46, fontWeight: 800, lineHeight: 1.05, letterSpacing: '-0.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {stream.title}
          </div>
          <div style={{ marginTop: 8, fontSize: 20, opacity: 0.72, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{statusLine}</div>
          <div style={{ marginTop: 18 }}>{tapButton ?? <Equalizer active={playing} height={34} bars={7} />}</div>
        </div>
      </div>
    </ScaledScene>
  );
}

// ─── Look ──────────────────────────────────────────────────────

const FONT = "'Inter', system-ui, sans-serif";
const BRAND = 'var(--brand-primary, #6366f1)';
const ACCENT = 'var(--brand-accent, #a5b4fc)';
/** The editor's drag on a zone used to start a TEXT SELECTION across this
 *  widget (the "highlighted 'ad'" + "Volume 70% · preview" the owner saw):
 *  nothing here is text to select. */
const NO_SELECT: React.CSSProperties = { userSelect: 'none', WebkitUserSelect: 'none' };

/** Fixed-size scene scaled to fit its zone (same pattern as the scoreboards):
 *  sizes stay designed, never `vw`/`%`. */
function ScaledScene({ naturalW, naturalH, align = 'center', children }: {
  naturalW: number; naturalH: number; align?: 'center' | 'start'; children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const compute = () => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      if (w <= 0 || h <= 0) return;
      setScale(Math.min(w / naturalW, h / naturalH));
    };
    compute();
    const raf = requestAnimationFrame(compute);
    if (typeof ResizeObserver === 'undefined') return () => cancelAnimationFrame(raf);
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [naturalW, naturalH]);
  return (
    <div
      ref={ref}
      style={{
        position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, overflow: 'hidden',
        display: 'flex', alignItems: align === 'start' ? 'flex-start' : 'center',
        justifyContent: align === 'start' ? 'flex-start' : 'center', ...NO_SELECT,
      }}
    >
      <div style={{ width: naturalW, height: naturalH, flexShrink: 0, transform: `scale(${scale})`, transformOrigin: align === 'start' ? 'top left' : 'center center' }}>
        {children}
      </div>
    </div>
  );
}

function hueOf(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return h;
}

/** Station "art": a brand-led gradient with a per-station hue, so two
 *  stations never look identical, and a music note. */
function StationArt({ seed, size, radius }: { seed: string; size: number; radius: number }) {
  const hue = hueOf(seed);
  return (
    <div
      aria-hidden
      style={{
        position: 'relative', width: size, height: size, flexShrink: 0, borderRadius: radius, overflow: 'hidden',
        background: `linear-gradient(135deg, ${BRAND} 0%, hsl(${hue}, 70%, 52%) 100%)`,
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.15)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div style={{ position: 'absolute', top: '-30%', left: '-20%', width: '90%', height: '90%', borderRadius: '50%', background: 'rgba(255,255,255,0.16)' }} />
      <span style={{ position: 'relative', fontSize: size * 0.46, lineHeight: 1, color: 'rgba(255,255,255,0.95)', textShadow: '0 2px 10px rgba(0,0,0,0.25)' }}>♪</span>
    </div>
  );
}

/** Subtle equalizer. transform-only animation (compositor, no layout); still
 *  bars when paused; honours prefers-reduced-motion. */
function Equalizer({ active, height, bars }: { active: boolean; height: number; bars: number }) {
  return (
    <div aria-hidden data-music-eq={active ? 'on' : 'off'} style={{ display: 'flex', alignItems: 'flex-end', height }}>
      <style>{`@keyframes vos-eq{0%,100%{transform:scaleY(.25)}50%{transform:scaleY(1)}}
@media (prefers-reduced-motion: reduce){[data-music-eq] span{animation:none!important}}`}</style>
      {Array.from({ length: bars }, (_, i) => (
        <span
          key={i}
          style={{
            display: 'block', width: Math.max(4, Math.round(height / 5)), height, marginLeft: i === 0 ? 0 : Math.max(3, Math.round(height / 8)),
            borderRadius: 3, background: ACCENT, transformOrigin: 'bottom',
            transform: active ? undefined : `scaleY(${0.25 + ((i * 37) % 50) / 100})`,
            animation: active ? `vos-eq ${0.9 + ((i * 23) % 7) / 10}s ease-in-out ${(i * 0.13).toFixed(2)}s infinite` : 'none',
            opacity: 0.9,
          }}
        />
      ))}
    </div>
  );
}
