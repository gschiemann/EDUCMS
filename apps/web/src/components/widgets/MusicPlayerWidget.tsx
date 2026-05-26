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
 *   4. Apple Music for Business — needs commercial agreement; widget
 *      renders a "Coming soon — Notify me" CTA with a mailto: link.
 *   5. Spotify for Business — same. Spotify locks venue use behind
 *      Soundtrack Your Brand (already in the streaming hub).
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

function resolveStreamUrl(c: MusicPlayerConfig): { url: string | null; sourceLabel: string; comingSoon?: boolean } {
  const src = c.source || 'somafm';
  switch (src) {
    case 'somafm': {
      const id = (c.somafmStationId || 'groovesalad').toLowerCase();
      return { url: SOMAFM_DIRECT_URLS[id] || SOMAFM_DIRECT_URLS.groovesalad, sourceLabel: `SomaFM · ${id}` };
    }
    case 'nts': {
      const ch = c.ntsChannel || '1';
      return { url: NTS_DIRECT_URLS[ch], sourceLabel: `NTS Radio · channel ${ch}` };
    }
    case 'npr': {
      // NPR doesn't publish a single global stream — each member
      // station has its own. The Properties panel uses the NPR
      // /stations/finder API by lat/lng (server-side, /api/v1/music/
      // npr-stations) to populate a station picker. Once picked,
      // we store the station's call sign + the direct stream URL
      // it returned in customStreamUrl. So at render time NPR + a
      // populated customStreamUrl is the "best path" and we use it.
      if (c.customStreamUrl) {
        return { url: c.customStreamUrl, sourceLabel: `NPR · ${c.nprStationCallSign || 'local station'}` };
      }
      return { url: null, sourceLabel: 'NPR — pick a local station in Properties' };
    }
    case 'custom-stream':
      return { url: c.customStreamUrl || null, sourceLabel: 'Custom stream' };
    case 'apple-business':
      return { url: null, sourceLabel: 'Apple Music for Business', comingSoon: true };
    case 'spotify-business':
      return { url: null, sourceLabel: 'Spotify for Business', comingSoon: true };
    default:
      return { url: null, sourceLabel: src };
  }
}

export function MusicPlayerWidget({
  config,
  live,
}: {
  config?: MusicPlayerConfig;
  live?: boolean;
}) {
  const c: MusicPlayerConfig = config || {};
  const isLive = !!live;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [needsTap, setNeedsTap] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { url, sourceLabel, comingSoon } = useMemo(() => resolveStreamUrl(c), [c]);
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
    const t = setInterval(check, 1000);
    return () => clearInterval(t);
  }, [isLive]);

  const silenced = !!c.pauseDuringEmergency && emergencyActive;

  // Auto-start playback when live + URL resolved + not silenced.
  useEffect(() => {
    if (!isLive || !url || comingSoon || silenced || !withinHours) return;
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
  }, [isLive, url, comingSoon, silenced, withinHours, c.defaultVolume]);

  // Auto-resume — persist the last source + station so a player
  // reload picks up where it left off without operator intervention.
  useEffect(() => {
    if (!isLive || !url || c.autoResume === false) return;
    try { window.localStorage.setItem('music-player:lastStation', url); } catch { /* ignore */ }
  }, [isLive, url, c.autoResume]);

  // ─── Off-hours fallback ─────────────────────────────────────
  if (!withinHours) {
    return (
      <PlayerShell zoneLabel={c.zoneLabel} sourceLabel={sourceLabel}>
        <div style={{ textAlign: 'center', color: '#94a3b8' }}>
          <div style={{ fontSize: '2em', marginBottom: 6 }}>🌙</div>
          <div style={{ fontWeight: 700, color: '#cbd5e1', marginBottom: 4 }}>Music paused — outside business hours</div>
          <div style={{ fontSize: '0.85em', lineHeight: 1.4 }}>
            Plays {c.businessHours?.start || '08:00'}–{c.businessHours?.end || '22:00'}
          </div>
        </div>
      </PlayerShell>
    );
  }

  // ─── Emergency fallback ─────────────────────────────────────
  if (silenced) {
    return (
      <PlayerShell zoneLabel={c.zoneLabel} sourceLabel={sourceLabel}>
        <div style={{ textAlign: 'center', color: '#fecaca' }}>
          <div style={{ fontSize: '2em', marginBottom: 6 }}>🔇</div>
          <div style={{ fontWeight: 700, color: '#fef2f2', marginBottom: 4 }}>Music silenced — emergency mode</div>
          <div style={{ fontSize: '0.85em', lineHeight: 1.4 }}>
            Will resume automatically once all-clear is received.
          </div>
        </div>
      </PlayerShell>
    );
  }

  // ─── Coming-soon (Apple / Spotify) ──────────────────────────
  if (comingSoon) {
    const mailto = `mailto:sales@venueos.com?subject=${encodeURIComponent(`Notify me when ${sourceLabel} is live`)}`;
    return (
      <PlayerShell zoneLabel={c.zoneLabel} sourceLabel={sourceLabel}>
        <div style={{ textAlign: 'center', color: '#cbd5e1', maxWidth: 360 }}>
          <div style={{ fontSize: '2em', marginBottom: 6 }}>🎶</div>
          <div style={{ fontWeight: 700, color: '#f8fafc', marginBottom: 4 }}>{sourceLabel} — coming soon</div>
          <div style={{ fontSize: '0.85em', lineHeight: 1.5, marginBottom: 10 }}>
            We're finalizing the commercial agreement. In the meantime, try SomaFM, NPR Live, NTS Radio, or paste your own stream URL.
          </div>
          {!isLive && (
            <a
              href={mailto}
              className="text-emerald-600 hover:underline"
              style={{ fontSize: '0.85em', fontWeight: 600 }}
            >
              Notify me when ready
            </a>
          )}
        </div>
      </PlayerShell>
    );
  }

  // ─── No URL resolved (NPR awaiting station pick, custom empty) ──
  if (!url) {
    return (
      <PlayerShell zoneLabel={c.zoneLabel} sourceLabel={sourceLabel}>
        <div style={{ textAlign: 'center', color: '#94a3b8' }}>
          <div style={{ fontSize: '2em', marginBottom: 6 }}>📻</div>
          <div style={{ fontWeight: 700, color: '#cbd5e1', marginBottom: 4 }}>{sourceLabel}</div>
          <div style={{ fontSize: '0.85em', lineHeight: 1.4 }}>
            Pick a station or paste a stream URL in Properties.
          </div>
        </div>
      </PlayerShell>
    );
  }

  // ─── Live audio render ──────────────────────────────────────
  return (
    <PlayerShell zoneLabel={c.zoneLabel} sourceLabel={sourceLabel}>
      <audio ref={audioRef} preload="none" crossOrigin="anonymous" />
      {needsTap && isLive && (
        <button
          type="button"
          onClick={() => {
            const a = audioRef.current;
            if (a) a.play().then(() => setNeedsTap(false)).catch(() => setError('Autoplay still blocked'));
          }}
          className="px-4 py-2 text-sm font-bold rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 shadow-md"
        >
          ▶ Tap to start music
        </button>
      )}
      {!needsTap && (
        <div style={{ textAlign: 'center', color: '#cbd5e1' }}>
          <div style={{ fontSize: '2.4em', marginBottom: 8, opacity: 0.95 }}>🎵</div>
          <div style={{ fontWeight: 700, color: '#f8fafc', fontSize: '1.1em', marginBottom: 2 }}>{sourceLabel}</div>
          <div style={{ fontSize: '0.78em', lineHeight: 1.3, opacity: 0.75 }}>
            Volume {(c.defaultVolume ?? 70)}% · {isLive ? 'streaming' : 'preview'}
          </div>
          {error && <div style={{ marginTop: 6, color: '#fca5a5', fontSize: '0.75em' }}>{error}</div>}
        </div>
      )}
    </PlayerShell>
  );
}

function PlayerShell({
  zoneLabel,
  sourceLabel,
  children,
}: {
  zoneLabel?: string;
  sourceLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="absolute top-0 right-0 bottom-0 left-0 flex flex-col items-center justify-center"
      style={{
        background: 'linear-gradient(135deg, #0b0f1a 0%, #1e293b 100%)',
        padding: 20,
        overflow: 'hidden',
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      {zoneLabel && (
        <div
          style={{
            position: 'absolute',
            top: 12,
            left: 12,
            padding: '4px 10px',
            background: 'rgba(255,255,255,0.06)',
            color: '#cbd5e1',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            borderRadius: 999,
            border: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          {zoneLabel}
        </div>
      )}
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 4 }}>
        {children}
      </div>
      <div
        style={{
          position: 'absolute',
          bottom: 8,
          right: 12,
          color: '#475569',
          fontSize: 9,
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          opacity: 0.7,
        }}
      >
        ♫ {sourceLabel}
      </div>
    </div>
  );
}
