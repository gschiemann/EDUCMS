'use client';

/**
 * FitnessMusicPlayerWidget — "now playing" display for a gym zone.
 *
 * Shows current track + artist + album art + an animated equalizer
 * the trainer can glance at from across the cardio floor. The actual
 * audio comes from the gym's existing Spotify-for-Business / Pandora
 * Business / SoundMachine subscription — we're the visualizer, not
 * the streamer (licensing costs + every gym already has this).
 *
 * Provider integration:
 *   • `provider` config field names the upstream; the values below
 *     are stubs that an operator fills in manually today. Phase 2
 *     wires real OAuth + now-playing polling per provider.
 *   • `nowPlayingEndpoint` (optional) — if a gym has a SoundMachine
 *     box with an HTTP API or a custom /now-playing proxy, we poll
 *     it every 10s and render the live track. Graceful fallback to
 *     the static trackTitle/artist config when unset or unreachable.
 *
 * Visual language:
 *   • Dark charcoal backdrop with subtle vinyl-grain noise texture.
 *   • Neon brand accent (`accentColor`, defaults electric green #39ff14)
 *     threads through the progress bar, equalizer bars, and pulse
 *     ring around the album art.
 *   • 24 equalizer bars bounce on a randomized loop that reads as
 *     music-reactive without needing real audio analysis.
 *   • Typography: Outfit for display, Inter Mono for the timecode.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

export interface FitnessMusicPlayerConfig {
  provider?: 'spotify' | 'apple_music' | 'pandora_business' | 'soundmachine' | 'custom' | 'demo';
  trackTitle?: string;
  artist?: string;
  album?: string;
  albumArtUrl?: string;
  /** Optional HTTP endpoint the widget polls for now-playing updates.
   *  Must return JSON shaped like `{ title, artist, album?, albumArtUrl? }`. */
  nowPlayingEndpoint?: string;
  /** Hex color for neon accents. Defaults to electric green. */
  accentColor?: string;
  /** Static progress percentage (0-100) for the progress bar when
   *  no provider tells us elapsed time. Animated upward over the
   *  configured `durationSeconds` for a realistic feel. */
  durationSeconds?: number;
  /** Tenant or location label shown as a subtitle — e.g. "CARDIO FLOOR — FLOOR 2". */
  zoneLabel?: string;
}

export function FitnessMusicPlayerWidget({
  config,
  live,
}: {
  config?: FitnessMusicPlayerConfig;
  live?: boolean;
}) {
  const c: FitnessMusicPlayerConfig = config || {};
  const isLive = !!live;
  const accent = c.accentColor || '#39ff14';

  // ─── Live now-playing poll (optional) ───
  const [nowPlaying, setNowPlaying] = useState<{ title: string; artist: string; album?: string; albumArtUrl?: string } | null>(null);
  useEffect(() => {
    if (!isLive) return;
    const url = c.nowPlayingEndpoint?.trim();
    if (!url) return;
    let cancelled = false;
    const fetchIt = async () => {
      try {
        const r = await fetch(url);
        if (!r.ok || cancelled) return;
        const data = await r.json();
        if (!cancelled && data?.title) setNowPlaying(data);
      } catch { /* offline-tolerant — fall back to static config */ }
    };
    fetchIt();
    const id = setInterval(fetchIt, 10_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [isLive, c.nowPlayingEndpoint]);

  const track = {
    title: nowPlaying?.title || c.trackTitle || 'Starting Line',
    artist: nowPlaying?.artist || c.artist || 'Until The Ribbon Breaks',
    album: nowPlaying?.album || c.album,
    albumArtUrl: nowPlaying?.albumArtUrl || c.albumArtUrl,
  };

  // ─── Simulated elapsed-time counter ───
  // Gives the progress bar real motion without pretending we have
  // frame-accurate audio analysis. Resets whenever the track changes
  // (the useMemo dep on title forces recalc).
  const totalSec = c.durationSeconds || 212;
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!isLive) return;
    setElapsed(0);
    const t = setInterval(() => {
      setElapsed((e) => (e >= totalSec ? 0 : e + 1));
    }, 1000);
    return () => clearInterval(t);
  }, [isLive, track.title, totalSec]);

  const fmtTime = (s: number) => {
    const m = Math.floor(s / 60);
    const ss = Math.floor(s % 60).toString().padStart(2, '0');
    return `${m}:${ss}`;
  };

  // ─── 24 randomized equalizer bars ───
  // Each bar's height + animation-delay is stable per-mount so the
  // animation doesn't jitter every render. Gives the widget real
  // motion without any audio API dependency.
  const bars = useMemo(
    () => Array.from({ length: 24 }, (_, i) => ({
      id: i,
      // Per-bar duration so they don't all pulse in sync — reads as
      // organic rather than metronome.
      duration: 0.45 + Math.random() * 0.55,
      delay: -Math.random() * 1.5,
      // Peak heights vary so the centre of the equalizer reads taller,
      // which matches how real audio visualizations look.
      peak: 35 + Math.random() * 60,
    })),
    [],
  );

  return (
    <div className="fmpw-root" style={{ '--fmpw-accent': accent } as React.CSSProperties}>
      <style>{CSS}</style>

      {/* Background: charcoal + radial accent glow + grain */}
      <div className="fmpw-bg" />
      <div className="fmpw-glow" />
      <div className="fmpw-grain" aria-hidden />

      {/* Zone label strip across the top */}
      {c.zoneLabel && (
        <div className="fmpw-zone">
          <span className="fmpw-zone-dot" />
          <span className="fmpw-zone-text">{c.zoneLabel}</span>
        </div>
      )}

      <div className="fmpw-content">
        {/* Album art in a neon-ring frame. Pulse ring breathes on the
            accent color, giving a subtle "music is playing" signal
            without an explicit "▶ playing" label. */}
        <div className="fmpw-art-frame">
          <div className="fmpw-art-pulse" />
          <div className="fmpw-art">
            {track.albumArtUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={track.albumArtUrl} alt="" className="fmpw-art-img" />
            ) : (
              <div className="fmpw-art-fallback">
                <div className="fmpw-art-vinyl" />
              </div>
            )}
          </div>
        </div>

        <div className="fmpw-info">
          <div className="fmpw-now-playing">
            <span className="fmpw-np-dot" />
            NOW PLAYING
          </div>
          <div className="fmpw-title">{track.title}</div>
          <div className="fmpw-artist">{track.artist}</div>

          {/* Progress bar with elapsed/remaining timecode */}
          <div className="fmpw-progress">
            <div className="fmpw-progress-track">
              <div
                className="fmpw-progress-fill"
                style={{ width: `${Math.min(100, (elapsed / totalSec) * 100)}%` }}
              />
              <div
                className="fmpw-progress-thumb"
                style={{ left: `${Math.min(100, (elapsed / totalSec) * 100)}%` }}
              />
            </div>
            <div className="fmpw-times">
              <span>{fmtTime(elapsed)}</span>
              <span>-{fmtTime(totalSec - elapsed)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Equalizer bar grid across the bottom */}
      <div className="fmpw-eq" aria-hidden>
        {bars.map((b) => (
          <span
            key={b.id}
            className="fmpw-eq-bar"
            style={{
              animationDuration: `${b.duration}s`,
              animationDelay: `${b.delay}s`,
              // peak is injected as a CSS var so the keyframe can
              // scale up to this bar's individual max height.
              ['--fmpw-peak' as any]: `${b.peak}%`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@500;600;700;800&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500;600&display=swap');

.fmpw-root {
  position: absolute; inset: 0;
  overflow: hidden;
  color: #f8fafc;
  font-family: 'Inter', system-ui, sans-serif;
  container-type: size;
}
.fmpw-bg {
  position: absolute; inset: 0; z-index: 0;
  background:
    linear-gradient(135deg, #0b0b10 0%, #141419 50%, #0b0b10 100%);
}
.fmpw-glow {
  position: absolute; inset: -20%; z-index: 1;
  pointer-events: none;
  background:
    radial-gradient(800px 500px at 75% 30%, var(--fmpw-accent, #39ff14), transparent 60%);
  opacity: 0.12;
  filter: blur(80px);
}
.fmpw-grain {
  position: absolute; inset: 0; z-index: 2;
  pointer-events: none;
  opacity: 0.05;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/></filter><rect width='100%25' height='100%25' filter='url(%23n)' opacity='0.6'/></svg>");
  mix-blend-mode: overlay;
}

/* ─── Zone header strip ─── */
.fmpw-zone {
  position: absolute; top: 3%; left: 5%; z-index: 10;
  display: inline-flex; align-items: center; gap: 10px;
  padding: 6px 14px;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 999px;
  backdrop-filter: blur(8px);
  font-size: clamp(10px, 1.5cqh, 13px);
  font-weight: 600;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #cbd5e1;
}
.fmpw-zone-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--fmpw-accent, #39ff14);
  box-shadow: 0 0 12px var(--fmpw-accent, #39ff14);
  animation: fmpw-blink 1.8s ease-in-out infinite;
}
@keyframes fmpw-blink {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.5; }
}

/* ─── Main content row ─── */
.fmpw-content {
  position: absolute; inset: 0;
  z-index: 10;
  display: flex; align-items: center; justify-content: center;
  gap: clamp(16px, 4cqw, 40px);
  padding: clamp(16px, 6%, 48px);
}

/* ─── Album art ─── */
.fmpw-art-frame {
  position: relative;
  width: clamp(120px, 32cqh, 280px);
  height: clamp(120px, 32cqh, 280px);
  flex-shrink: 0;
}
.fmpw-art-pulse {
  position: absolute; inset: -10px;
  border-radius: 16px;
  border: 2px solid var(--fmpw-accent, #39ff14);
  opacity: 0.5;
  animation: fmpw-pulse 2.8s ease-in-out infinite;
  box-shadow: 0 0 40px var(--fmpw-accent, #39ff14);
}
@keyframes fmpw-pulse {
  0%, 100% { transform: scale(1); opacity: 0.35; }
  50%      { transform: scale(1.04); opacity: 0.75; }
}
.fmpw-art {
  position: absolute; inset: 0;
  border-radius: 12px;
  overflow: hidden;
  box-shadow:
    0 20px 60px rgba(0,0,0,0.5),
    inset 0 1px 0 rgba(255,255,255,0.1);
  background: #1a1a22;
}
.fmpw-art-img { width: 100%; height: 100%; object-fit: cover; }
.fmpw-art-fallback {
  width: 100%; height: 100%;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #2a1a3e 0%, #0f0f14 100%);
}
.fmpw-art-vinyl {
  width: 60%; height: 60%;
  border-radius: 50%;
  background:
    radial-gradient(circle, #1a1a22 15%, transparent 16%),
    repeating-radial-gradient(circle, #0f0f14 0 2px, #16161d 2px 4px);
  box-shadow: inset 0 0 30px rgba(0,0,0,0.6);
  animation: fmpw-spin 8s linear infinite;
}
@keyframes fmpw-spin { to { transform: rotate(360deg); } }

/* ─── Track info ─── */
.fmpw-info {
  flex: 1; min-width: 0;
  max-width: clamp(200px, 50cqw, 520px);
}
.fmpw-now-playing {
  display: inline-flex; align-items: center; gap: 8px;
  font-size: clamp(10px, 1.6cqh, 13px);
  font-weight: 700;
  letter-spacing: 0.25em;
  color: var(--fmpw-accent, #39ff14);
  margin-bottom: clamp(8px, 1.5cqh, 14px);
  text-shadow: 0 0 12px var(--fmpw-accent, #39ff14);
}
.fmpw-np-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--fmpw-accent, #39ff14);
  box-shadow: 0 0 8px var(--fmpw-accent, #39ff14);
}
.fmpw-title {
  font-family: 'Outfit', sans-serif;
  font-weight: 800;
  font-size: clamp(22px, 5.5cqh, 58px);
  line-height: 1.05;
  letter-spacing: -0.02em;
  color: #ffffff;
  margin-bottom: clamp(4px, 0.8cqh, 10px);
  /* Clip to 2 lines max — long titles don't push the progress bar. */
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.fmpw-artist {
  font-family: 'Outfit', sans-serif;
  font-weight: 500;
  font-size: clamp(14px, 3cqh, 28px);
  color: #94a3b8;
  margin-bottom: clamp(16px, 3cqh, 28px);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

/* ─── Progress bar ─── */
.fmpw-progress {
  display: flex; flex-direction: column; gap: 6px;
}
.fmpw-progress-track {
  position: relative;
  height: 4px;
  background: rgba(255,255,255,0.08);
  border-radius: 999px;
  overflow: visible;
}
.fmpw-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--fmpw-accent, #39ff14), rgba(255,255,255,0.4));
  border-radius: 999px;
  box-shadow: 0 0 12px var(--fmpw-accent, #39ff14);
  transition: width 1s linear;
}
.fmpw-progress-thumb {
  position: absolute; top: 50%;
  width: 12px; height: 12px; border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 0 12px var(--fmpw-accent, #39ff14);
  transform: translate(-50%, -50%);
  transition: left 1s linear;
}
.fmpw-times {
  display: flex; justify-content: space-between;
  font-family: 'JetBrains Mono', monospace;
  font-size: clamp(10px, 1.5cqh, 13px);
  color: #64748b;
  letter-spacing: 0.05em;
}

/* ─── Equalizer bars across the bottom ─── */
.fmpw-eq {
  position: absolute; left: 0; right: 0; bottom: 0;
  height: clamp(28px, 8cqh, 60px);
  z-index: 5;
  display: flex; align-items: flex-end;
  gap: 3px;
  padding: 0 clamp(8px, 2%, 16px);
  pointer-events: none;
}
.fmpw-eq-bar {
  flex: 1;
  min-height: 15%;
  background: linear-gradient(180deg, var(--fmpw-accent, #39ff14), rgba(57,255,20,0.2));
  border-radius: 2px 2px 0 0;
  transform-origin: bottom;
  animation-name: fmpw-eq;
  animation-iteration-count: infinite;
  animation-timing-function: ease-in-out;
  animation-direction: alternate;
  box-shadow: 0 0 8px var(--fmpw-accent, #39ff14);
}
@keyframes fmpw-eq {
  from { height: 15%; opacity: 0.6; }
  to   { height: var(--fmpw-peak, 70%); opacity: 1; }
}
`;
