'use client';

/**
 * FitnessStickLauncherWidget — remote-control status display for a
 * streaming stick plugged into a gym TV (Roku, Fire TV, Apple TV,
 * Chromecast, Android TV).
 *
 * Widget type name: `FITNESS_STICK_LAUNCHER`
 * (referenced by FitnessSource.widgetType in fitnessSourceCatalog.ts;
 * wiring into WidgetRenderer is done separately.)
 *
 * Three visual states driven by `config.displayState`:
 *
 *   LAUNCHING  — full-bleed gradient in the app's accentColor; massive
 *                app logo mark + bloom; "LAUNCHING ON [stick name]"
 *                status line with spinning progress ring; animated
 *                particle streaks radiating from the logo centre.
 *                This is the most common live-mode state — it's shown
 *                while the relay command is in-flight and the stick is
 *                spinning up the app.
 *
 *   READY      — dimmed charcoal backdrop with accentColor edge glow;
 *                "NOW PLAYING ON [stick name]" headline; app logo +
 *                name smaller, anchored middle-left; slow-pulse instead
 *                of streaks. Shown once the kiosk relay confirms the
 *                app is open.
 *
 *   OFFLINE    — red/amber tint on the background; warning icon; stick
 *                IP + name in the error line; "Check power + network"
 *                suggested action.
 *
 * Live polling:
 *   When `live` is true the widget polls
 *   `GET /api/v1/fitness/sticks/:stickId/status` every 15 seconds and
 *   derives displayState from the returned `status` field:
 *     'online'  → 'ready'    (content is playing)
 *     'offline' → 'offline'  (stick unreachable)
 *     'unknown' → 'launching' (command in-flight / not yet confirmed)
 *   Falls back gracefully to `config.displayState` when stickId is
 *   absent or the request fails (network / auth).
 *
 * Visual DNA matches FitnessMusicPlayerWidget:
 *   • position:absolute; inset:0 root
 *   • container-type:size for cq* units
 *   • @import Outfit + Inter via Google Fonts inside the <style> tag
 *   • charcoal + radial accent glow + grain-texture overlay
 *   • accent color threaded through glow, ring, badge, and dots
 */

import { useEffect, useMemo, useState } from 'react';
import { getSourceById, type FitnessSource } from './fitnessSourceCatalog';

// ─── Config contract ────────────────────────────────────────────────────────

export interface FitnessStickLauncherConfig {
  /** Catalog id — e.g. 'netflix', 'peacock', 'youtube-tv'. Resolved via
   *  getSourceById(); falls back to a placeholder when invalid. */
  sourceId?: string;
  /** Tenant-scoped stick registry id. Used for live-polling the stick's
   *  current status from the backend. */
  stickId?: string;
  /** Human display name — e.g. "Lobby TV Roku". */
  stickName?: string;
  /** Hardware type for the badge label. */
  stickType?: 'roku' | 'fire-tv' | 'apple-tv' | 'chromecast' | 'android-tv';
  /** LAN IP address — displayed in OFFLINE state for quick troubleshooting. */
  stickIp?: string;
  /** Explicit state override. When `live` is false this is the only driver. */
  displayState?: 'launching' | 'ready' | 'offline';
  /** Show IP / stickType badge below status (default true in gallery,
   *  typically false on kiosk where the overlay would distract). */
  showTechDetails?: boolean;
}

type StickState = 'launching' | 'ready' | 'offline';

// ─── Helpers ────────────────────────────────────────────────────────────────

const STICK_TYPE_LABELS: Record<NonNullable<FitnessStickLauncherConfig['stickType']>, string> = {
  'roku': 'Roku Ultra',
  'fire-tv': 'Fire TV Stick',
  'apple-tv': 'Apple TV 4K',
  'chromecast': 'Chromecast',
  'android-tv': 'Android TV',
};

function stickLabel(type?: FitnessStickLauncherConfig['stickType']): string {
  if (!type) return 'Streaming Stick';
  return STICK_TYPE_LABELS[type] ?? 'Streaming Stick';
}

/** Blend `hex` color toward dark charcoal for the READY / OFFLINE tints. */
function dimHex(hex: string, alpha = 0.18): string {
  return `color-mix(in srgb, ${hex} ${Math.round(alpha * 100)}%, #111216)`;
}

// ─── Particle streak data (stable per mount) ─────────────────────────────────

interface Streak {
  id: number;
  angle: number;   // degrees — direction from logo centre
  delay: number;   // animation-delay (s)
  duration: number;
  length: number;  // relative length (%)
}

function buildStreaks(count = 18): Streak[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    angle: (360 / count) * i + (Math.random() * 12 - 6),
    delay: -(Math.random() * 1.8),
    duration: 0.9 + Math.random() * 0.7,
    length: 30 + Math.random() * 50,
  }));
}

// ─── Widget component ────────────────────────────────────────────────────────

export function FitnessStickLauncherWidget({
  config,
  live,
}: {
  config?: FitnessStickLauncherConfig;
  live?: boolean;
}) {
  const c: FitnessStickLauncherConfig = config ?? {};
  const isLive = !!live;

  // Resolve the source from catalog; graceful fallback for unknown ids.
  const source: FitnessSource | null = c.sourceId ? (getSourceById(c.sourceId) ?? null) : null;
  const appName = source?.name ?? c.sourceId ?? 'Unknown App';
  const appIcon = source?.icon ?? '?';
  const accent = source?.accentColor ?? '#6366f1';

  const showTech = c.showTechDetails !== false; // default true

  // ─── Live status polling ────────────────────────────────────────────
  const [liveState, setLiveState] = useState<StickState | null>(null);

  useEffect(() => {
    if (!isLive || !c.stickId) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const r = await fetch(`/api/v1/fitness/sticks/${c.stickId}/status`, {
          credentials: 'include',
        });
        if (!r.ok || cancelled) return;
        const data = await r.json();
        if (cancelled) return;
        const raw: string = data?.status ?? 'unknown';
        if (raw === 'online') setLiveState('ready');
        else if (raw === 'offline') setLiveState('offline');
        else setLiveState('launching'); // 'unknown' = command in-flight
      } catch {
        // Network / auth failure — don't thrash state; keep last known.
      }
    };

    poll();
    const id = setInterval(poll, 15_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [isLive, c.stickId]);

  // Resolved display state: live poll wins if available, else config, else fallback.
  const displayState: StickState =
    (isLive && liveState) ? liveState :
    (c.displayState ?? 'launching');

  // Stable streak array — only rebuilt on mount.
  const streaks = useMemo(() => buildStreaks(18), []);

  const sName = c.stickName ?? 'Unnamed Stick';
  const sTypeLabel = stickLabel(c.stickType);

  // ─── Render helpers per state ────────────────────────────────────────

  const isLaunching = displayState === 'launching';
  const isReady = displayState === 'ready';
  const isOffline = displayState === 'offline';

  // Background varies per state.
  const bgStyle: React.CSSProperties = isLaunching
    ? {
        background: `radial-gradient(ellipse 120% 120% at 50% 55%,
          color-mix(in srgb, ${accent} 55%, #0c0c11) 0%,
          #0c0c11 70%)`,
      }
    : isReady
    ? {
        background: `radial-gradient(ellipse 80% 80% at 18% 50%,
          color-mix(in srgb, ${accent} 22%, #111216) 0%,
          #111216 65%)`,
      }
    : /* offline */ {
        background: `radial-gradient(ellipse 90% 90% at 50% 50%,
          color-mix(in srgb, #dc2626 18%, #0e0e12) 0%,
          #0e0e12 65%)`,
      };

  return (
    <div
      className="fsl-root"
      style={{ '--fsl-accent': accent } as React.CSSProperties}
      role="status"
      aria-label={`${appName} on ${sName} — ${displayState}`}
    >
      <style>{CSS}</style>

      {/* Layered backgrounds */}
      <div className="fsl-bg" style={bgStyle} />
      <div className="fsl-grain" aria-hidden />

      {/* ── STICK NAME CHIP (top-right) ─────────────────────────────── */}
      <div className="fsl-stick-chip" aria-label={`Connected stick: ${sName}`}>
        <span
          className="fsl-chip-dot"
          style={isOffline ? { background: '#ef4444', boxShadow: '0 0 8px #ef4444' } : undefined}
        />
        <span className="fsl-chip-text">
          {sName}
          {showTech && c.stickType && <span className="fsl-chip-type"> · {sTypeLabel}</span>}
        </span>
      </div>

      {/* ══════════════════════════════════════════════════════════════
          STATE: LAUNCHING
      ══════════════════════════════════════════════════════════════ */}
      {isLaunching && (
        <div className="fsl-launching-scene" aria-live="polite">
          {/* Particle streaks radiating from center */}
          <div className="fsl-streaks" aria-hidden>
            {streaks.map((s) => (
              <span
                key={s.id}
                className="fsl-streak"
                style={{
                  '--fsl-streak-angle': `${s.angle}deg`,
                  '--fsl-streak-length': `${s.length}%`,
                  animationDuration: `${s.duration}s`,
                  animationDelay: `${s.delay}s`,
                } as React.CSSProperties}
              />
            ))}
          </div>

          {/* App logo bloom */}
          <div className="fsl-logo-bloom" aria-hidden />
          <div className="fsl-logo-frame" aria-label={`${appName} logo`}>
            <div className="fsl-logo-icon">{appIcon}</div>
          </div>

          {/* App name */}
          <div className="fsl-launching-name">{appName}</div>

          {/* Status line with spinner */}
          <div className="fsl-launching-status">
            <span className="fsl-spinner" aria-hidden />
            <span>LAUNCHING ON {sName.toUpperCase()}</span>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════
          STATE: READY
      ══════════════════════════════════════════════════════════════ */}
      {isReady && (
        <div className="fsl-ready-scene" aria-live="polite">
          {/* Left column: app mark + name */}
          <div className="fsl-ready-app">
            <div className="fsl-ready-logo-frame">
              <div className="fsl-ready-logo-pulse" aria-hidden />
              <div className="fsl-ready-logo">{appIcon}</div>
            </div>
            <div className="fsl-ready-app-name">{appName}</div>
          </div>

          {/* Right / centre: now playing headline */}
          <div className="fsl-ready-info">
            <div className="fsl-ready-label">
              <span className="fsl-ready-dot" aria-hidden />
              NOW PLAYING ON
            </div>
            <div className="fsl-ready-stick-name">{sName}</div>
            {showTech && (
              <div className="fsl-ready-powered">
                POWERED BY {sTypeLabel.toUpperCase()}
                {c.stickIp && ` · ${c.stickIp}`}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════
          STATE: OFFLINE
      ══════════════════════════════════════════════════════════════ */}
      {isOffline && (
        <div className="fsl-offline-scene" role="alert" aria-live="assertive">
          {/* Warning icon */}
          <div className="fsl-offline-icon" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
          </div>

          <div className="fsl-offline-headline">STICK UNREACHABLE</div>
          <div className="fsl-offline-detail">
            {sName}
            {showTech && c.stickIp && <span className="fsl-offline-ip"> at {c.stickIp}</span>}
          </div>
          <div className="fsl-offline-action">
            Check power + network on the stick
          </div>

          {/* Small app badge so staff know which stick / app they're looking at */}
          <div className="fsl-offline-app-badge">
            <span className="fsl-offline-badge-icon">{appIcon}</span>
            <span className="fsl-offline-badge-name">{appName}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@500;600;700;800;900&family=Inter:wght@400;500;600;700&display=swap');

/* ── Root ── */
.fsl-root {
  position: absolute; inset: 0;
  overflow: hidden;
  color: #f8fafc;
  font-family: 'Inter', system-ui, sans-serif;
  container-type: size;
}

/* ── Backgrounds ── */
.fsl-bg {
  position: absolute; inset: 0; z-index: 0;
  transition: background 0.6s ease;
}
.fsl-grain {
  position: absolute; inset: 0; z-index: 1;
  pointer-events: none; opacity: 0.045;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/></filter><rect width='100%25' height='100%25' filter='url(%23n)' opacity='0.6'/></svg>");
  mix-blend-mode: overlay;
}

/* ── Stick chip (top-right) ── */
.fsl-stick-chip {
  position: absolute; top: 3.5%; right: 3.5%; z-index: 20;
  display: inline-flex; align-items: center; gap: 8px;
  padding: 6px 14px;
  background: rgba(255,255,255,0.07);
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 999px;
  backdrop-filter: blur(10px);
  font-size: clamp(9px, 1.4cqh, 12px);
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  white-space: nowrap;
  max-width: 42cqw;
  overflow: hidden; text-overflow: ellipsis;
}
.fsl-chip-dot {
  flex-shrink: 0;
  width: 7px; height: 7px; border-radius: 50%;
  background: #22c55e;
  box-shadow: 0 0 10px #22c55e;
  animation: fsl-blink 2.2s ease-in-out infinite;
}
.fsl-chip-type { color: #94a3b8; }
@keyframes fsl-blink {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.45; }
}

/* ══════════════════════════════════════════════════════
   LAUNCHING SCENE
══════════════════════════════════════════════════════ */
.fsl-launching-scene {
  position: absolute; inset: 0; z-index: 10;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: clamp(8px, 2cqh, 18px);
}

/* Particle streaks */
.fsl-streaks {
  position: absolute; inset: 0;
  pointer-events: none;
}
.fsl-streak {
  position: absolute;
  /* Anchor at 50% 50% — the CSS translate pushes the streak outward. */
  top: 50%; left: 50%;
  height: 2px;
  width: var(--fsl-streak-length, 40%);
  transform-origin: 0 50%;
  transform: rotate(var(--fsl-streak-angle, 0deg)) translateX(14cqh);
  background: linear-gradient(90deg,
    var(--fsl-accent, #6366f1),
    transparent);
  border-radius: 2px;
  opacity: 0;
  animation-name: fsl-streak-out;
  animation-iteration-count: infinite;
  animation-timing-function: ease-out;
}
@keyframes fsl-streak-out {
  0%   { opacity: 0;    transform: rotate(var(--fsl-streak-angle, 0deg)) translateX(8cqh)  scaleX(0.2); }
  20%  { opacity: 0.85; transform: rotate(var(--fsl-streak-angle, 0deg)) translateX(14cqh) scaleX(1); }
  80%  { opacity: 0.3;  transform: rotate(var(--fsl-streak-angle, 0deg)) translateX(24cqh) scaleX(1); }
  100% { opacity: 0;    transform: rotate(var(--fsl-streak-angle, 0deg)) translateX(28cqh) scaleX(0.5); }
}

/* Logo bloom */
.fsl-logo-bloom {
  position: absolute;
  width: clamp(140px, 36cqh, 320px);
  height: clamp(140px, 36cqh, 320px);
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  pointer-events: none;
  border-radius: 24px;
  background: var(--fsl-accent, #6366f1);
  opacity: 0.28;
  filter: blur(clamp(30px, 6cqh, 80px));
  animation: fsl-bloom-pulse 2.4s ease-in-out infinite;
  z-index: 11;
}
@keyframes fsl-bloom-pulse {
  0%, 100% { transform: translate(-50%,-50%) scale(1);    opacity: 0.22; }
  50%       { transform: translate(-50%,-50%) scale(1.14); opacity: 0.38; }
}

/* Logo frame */
.fsl-logo-frame {
  position: relative; z-index: 12;
  width: clamp(110px, 26cqh, 240px);
  height: clamp(110px, 26cqh, 240px);
  border-radius: clamp(16px, 3.5cqh, 36px);
  background: rgba(255,255,255,0.08);
  border: 2px solid rgba(255,255,255,0.15);
  display: flex; align-items: center; justify-content: center;
  box-shadow:
    0 0 0 6px rgba(255,255,255,0.04),
    0 24px 64px rgba(0,0,0,0.5);
  backdrop-filter: blur(4px);
}
.fsl-logo-icon {
  font-family: 'Outfit', sans-serif;
  font-weight: 900;
  font-size: clamp(36px, 9cqh, 96px);
  line-height: 1;
  letter-spacing: -0.04em;
  color: #ffffff;
  text-shadow: 0 4px 24px rgba(0,0,0,0.4);
  user-select: none;
}

/* App name below logo */
.fsl-launching-name {
  position: relative; z-index: 12;
  font-family: 'Outfit', sans-serif;
  font-weight: 900;
  font-size: clamp(28px, 7cqh, 80px);
  letter-spacing: -0.02em;
  color: #ffffff;
  text-shadow: 0 2px 24px rgba(0,0,0,0.4);
  text-align: center;
  max-width: 80cqw;
  overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
}

/* "LAUNCHING ON … " status row */
.fsl-launching-status {
  position: relative; z-index: 12;
  display: inline-flex; align-items: center; gap: clamp(8px, 1.5cqw, 16px);
  font-family: 'Inter', sans-serif;
  font-weight: 600;
  font-size: clamp(10px, 1.8cqh, 16px);
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgba(255,255,255,0.75);
  margin-top: clamp(4px, 0.8cqh, 10px);
}

/* Spinning progress ring */
.fsl-spinner {
  display: inline-block;
  width: clamp(14px, 2.2cqh, 22px);
  height: clamp(14px, 2.2cqh, 22px);
  border-radius: 50%;
  border: 2px solid rgba(255,255,255,0.2);
  border-top-color: var(--fsl-accent, #6366f1);
  animation: fsl-spin 0.8s linear infinite;
  flex-shrink: 0;
}
@keyframes fsl-spin { to { transform: rotate(360deg); } }

/* ══════════════════════════════════════════════════════
   READY SCENE
══════════════════════════════════════════════════════ */
.fsl-ready-scene {
  position: absolute; inset: 0; z-index: 10;
  display: flex; align-items: center;
  gap: clamp(20px, 5cqw, 56px);
  padding: clamp(20px, 6%, 56px);
}

/* Left: app mark */
.fsl-ready-app {
  display: flex; flex-direction: column; align-items: center;
  gap: clamp(8px, 1.5cqh, 14px);
  flex-shrink: 0;
}
.fsl-ready-logo-frame {
  position: relative;
  width: clamp(72px, 18cqh, 160px);
  height: clamp(72px, 18cqh, 160px);
  border-radius: clamp(12px, 2.5cqh, 24px);
  background: rgba(255,255,255,0.06);
  border: 1.5px solid rgba(255,255,255,0.12);
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 12px 36px rgba(0,0,0,0.4);
}
.fsl-ready-logo-pulse {
  position: absolute; inset: -8px;
  border-radius: clamp(16px, 3cqh, 28px);
  border: 1.5px solid var(--fsl-accent, #6366f1);
  opacity: 0.35;
  animation: fsl-ready-pulse 3.6s ease-in-out infinite;
}
@keyframes fsl-ready-pulse {
  0%, 100% { transform: scale(1);    opacity: 0.25; }
  50%       { transform: scale(1.05); opacity: 0.5; }
}
.fsl-ready-logo {
  font-family: 'Outfit', sans-serif;
  font-weight: 900;
  font-size: clamp(22px, 5.5cqh, 60px);
  color: #ffffff;
  user-select: none;
}
.fsl-ready-app-name {
  font-family: 'Inter', sans-serif;
  font-weight: 600;
  font-size: clamp(9px, 1.5cqh, 13px);
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: #94a3b8;
  text-align: center;
}

/* Right: headline */
.fsl-ready-info {
  flex: 1; min-width: 0;
}
.fsl-ready-label {
  display: inline-flex; align-items: center; gap: 8px;
  font-size: clamp(9px, 1.5cqh, 13px);
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--fsl-accent, #6366f1);
  text-shadow: 0 0 14px var(--fsl-accent, #6366f1);
  margin-bottom: clamp(6px, 1cqh, 10px);
}
.fsl-ready-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--fsl-accent, #6366f1);
  box-shadow: 0 0 10px var(--fsl-accent, #6366f1);
}
.fsl-ready-stick-name {
  font-family: 'Outfit', sans-serif;
  font-weight: 700;
  font-size: clamp(22px, 5cqh, 54px);
  letter-spacing: -0.02em;
  color: #ffffff;
  margin-bottom: clamp(8px, 1.5cqh, 16px);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.fsl-ready-powered {
  font-size: clamp(9px, 1.4cqh, 12px);
  font-weight: 500;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #475569;
}

/* ══════════════════════════════════════════════════════
   OFFLINE SCENE
══════════════════════════════════════════════════════ */
.fsl-offline-scene {
  position: absolute; inset: 0; z-index: 10;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: clamp(6px, 1.2cqh, 14px);
  padding: clamp(16px, 5%, 40px);
  text-align: center;
}

.fsl-offline-icon {
  width: clamp(40px, 9cqh, 80px);
  height: clamp(40px, 9cqh, 80px);
  color: #fbbf24;
  filter: drop-shadow(0 0 16px #fbbf24);
  animation: fsl-offline-wobble 3s ease-in-out infinite;
}
@keyframes fsl-offline-wobble {
  0%, 100% { transform: rotate(-2deg); }
  50%       { transform: rotate(2deg); }
}

.fsl-offline-headline {
  font-family: 'Outfit', sans-serif;
  font-weight: 900;
  font-size: clamp(20px, 5cqh, 52px);
  letter-spacing: 0.02em;
  color: #ef4444;
  text-shadow: 0 0 28px rgba(239,68,68,0.45);
}

.fsl-offline-detail {
  font-family: 'Inter', sans-serif;
  font-weight: 600;
  font-size: clamp(12px, 2.2cqh, 20px);
  color: #f8fafc;
  letter-spacing: 0.05em;
}
.fsl-offline-ip {
  color: #94a3b8;
  font-weight: 500;
  font-family: 'JetBrains Mono', 'Courier New', monospace;
}

.fsl-offline-action {
  font-size: clamp(10px, 1.8cqh, 15px);
  font-weight: 500;
  color: #64748b;
  letter-spacing: 0.06em;
  margin-top: clamp(2px, 0.5cqh, 6px);
}

.fsl-offline-app-badge {
  display: inline-flex; align-items: center; gap: 8px;
  margin-top: clamp(8px, 1.5cqh, 16px);
  padding: 6px 16px;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 999px;
}
.fsl-offline-badge-icon {
  font-family: 'Outfit', sans-serif;
  font-weight: 700;
  font-size: clamp(10px, 1.8cqh, 16px);
  color: #ffffff;
}
.fsl-offline-badge-name {
  font-size: clamp(10px, 1.6cqh, 13px);
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #94a3b8;
}
`;
