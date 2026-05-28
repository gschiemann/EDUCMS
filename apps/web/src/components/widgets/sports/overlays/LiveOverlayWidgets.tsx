"use client";
/**
 * VenueOS Sports — T2-5: Live-game text overlay widgets.
 *
 * Three banner widgets rendered by the board / ribbon / scorebug when
 * the `liveOverlay` field on the board response is non-null:
 *
 *   PenaltyOverlayWidget     — lower-third "HOLDING #44 — 10 YDS", 3s
 *   OfficialReviewOverlayWidget — persistent fly-in banner, pulses
 *   TimeoutOverlayWidget     — fly-in pill, top-center
 *
 * Hard constraints (CLAUDE.md):
 *   - No `inset` shorthand — use explicit top/right/bottom/left
 *   - No flex `gap` (Chromium 83 / Taurus compat) — use margins
 *   - No vw / % sizing inside fixed pixel scenes
 *   - No `container-type`
 *   - No backdrop-filter (Chromium 83 flaky)
 *
 * All three follow the fixed-px sizing convention from the board's
 * 1920×1080 canvas. When embedded in a smaller surface (ribbon,
 * scorebug) the parent applies transform:scale.
 */

import React, { useEffect, useRef, useState } from 'react';

// ── keyframe injection helper ─────────────────────────────────────────
// We inject @keyframes once per widget type to avoid duplicate <style>
// insertions. A simple module-level Set tracks what's been injected.
const injected = new Set<string>();

function injectKeyframes(id: string, css: string): void {
  if (injected.has(id) || typeof document === 'undefined') return;
  injected.add(id);
  const s = document.createElement('style');
  s.id = `vos-overlay-kf-${id}`;
  s.textContent = css;
  document.head.appendChild(s);
}

// ── shared layout constants ────────────────────────────────────────────
// All sizes are absolute pixels for the 1920×1080 canvas. The parent
// board page applies transform:scale to fit the viewport.
const LOWER_THIRD_HEIGHT = 90;         // lower-third band height
const LOWER_THIRD_BOTTOM = 60;         // gap from bottom of canvas
const PILL_HEIGHT = 72;                // timeout pill height
const PILL_TOP = 40;                   // gap from top of canvas

// ── PenaltyOverlayWidget ───────────────────────────────────────────────
export interface PenaltyOverlayPayload {
  team?: 'home' | 'away';
  jersey?: string;
  infraction?: string;
  yards?: number | null;
}

export interface PenaltyOverlaySnapshot {
  homeColor?: string;
  awayColor?: string;
  homeTeam?: string;
  awayTeam?: string;
}

export interface PenaltyOverlayProps {
  payload: PenaltyOverlayPayload;
  snapshot?: PenaltyOverlaySnapshot;
  /** How long the overlay is visible in ms (default 3 000). */
  durationMs?: number;
  /** Called when the timer expires — lets the parent remove the overlay. */
  onExpire?: () => void;
}

const PENALTY_KF = `
@keyframes vosPenaltyIn {
  from { transform: translateX(-100%); opacity: 0; }
  8%   { transform: translateX(0);     opacity: 1; }
  88%  { opacity: 1; }
  to   { opacity: 0; }
}
`;

/**
 * Lower-third penalty banner. Flies in from the left, holds for
 * `durationMs` (default 3 s), then fades. Team-color band on the left.
 *
 * Example: "HOLDING #44 — 10 YDS"
 */
export function PenaltyOverlayWidget({
  payload,
  snapshot,
  durationMs = 3000,
  onExpire,
}: PenaltyOverlayProps) {
  injectKeyframes('penalty', PENALTY_KF);

  const team = payload.team ?? 'home';
  const teamColor =
    team === 'home'
      ? snapshot?.homeColor ?? '#4f46e5'
      : snapshot?.awayColor ?? '#dc2626';

  // Build the text line.
  const parts: string[] = [];
  if (payload.infraction) parts.push(payload.infraction.toUpperCase());
  if (payload.jersey) parts.splice(0, 0, `#${payload.jersey}`);
  if (typeof payload.yards === 'number' && payload.yards > 0) {
    parts.push(`${payload.yards} YDS`);
  }
  const line = parts.join(' — ');

  useEffect(() => {
    if (!onExpire) return;
    const t = setTimeout(onExpire, durationMs);
    return () => clearTimeout(t);
  }, [durationMs, onExpire]);

  const durSec = (durationMs / 1000).toFixed(2);

  return (
    <div
      aria-live="polite"
      aria-label={`Penalty: ${line}`}
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: LOWER_THIRD_BOTTOM,
        height: LOWER_THIRD_HEIGHT,
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'stretch',
        zIndex: 60,
        animation: `vosPenaltyIn ${durSec}s cubic-bezier(.16,1,.3,1) forwards`,
        pointerEvents: 'none',
        willChange: 'transform, opacity',
      }}
    >
      {/* Team-color left band */}
      <div
        style={{
          width: 14,
          background: teamColor,
          flexShrink: 0,
        }}
      />
      {/* Dark body */}
      <div
        style={{
          flex: 1,
          background: 'rgba(5,7,13,0.92)',
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          paddingLeft: 28,
          paddingRight: 40,
        }}
      >
        {/* Flag icon */}
        <span
          aria-hidden
          style={{
            fontSize: 34,
            marginRight: 20,
            lineHeight: 1,
          }}
        >
          🚩
        </span>
        {/* Infraction text */}
        <span
          style={{
            color: '#ffffff',
            fontFamily: "'Arial Black', 'Impact', sans-serif",
            fontSize: 36,
            fontWeight: 900,
            letterSpacing: 2,
            textTransform: 'uppercase',
            textShadow: '0 2px 8px rgba(0,0,0,0.7)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
          }}
        >
          {line || 'PENALTY'}
        </span>
        {/* Accent dot */}
        <div
          aria-hidden
          style={{
            width: 8,
            height: 8,
            borderRadius: 8,
            background: teamColor,
            marginLeft: 20,
            flexShrink: 0,
          }}
        />
      </div>
    </div>
  );
}

// ── OfficialReviewOverlayWidget ────────────────────────────────────────
export interface OfficialReviewOverlayProps {
  description?: string;
  /** Called when the parent explicitly clears it — no auto-expire. */
  onClear?: () => void;
}

const REVIEW_KF = `
@keyframes vosReviewIn {
  from { transform: translateY(-110%); opacity: 0; }
  10%  { transform: translateY(0);     opacity: 1; }
  to   { transform: translateY(0);     opacity: 1; }
}
@keyframes vosReviewPulse {
  0%,100% { opacity: 1; }
  50%     { opacity: 0.55; }
}
`;

/**
 * Persistent "OFFICIAL REVIEW" lower-third banner. Flies in from
 * below, pulses to demand attention, stays until cleared.
 */
export function OfficialReviewOverlayWidget({
  description,
  onClear,
}: OfficialReviewOverlayProps) {
  injectKeyframes('review', REVIEW_KF);

  const text = description ?? 'OFFICIAL REVIEW — RULING ON FIELD STANDS';

  return (
    <div
      aria-live="assertive"
      aria-label={text}
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: LOWER_THIRD_BOTTOM,
        height: LOWER_THIRD_HEIGHT,
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'stretch',
        zIndex: 60,
        animation: 'vosReviewIn 0.55s cubic-bezier(.16,1,.3,1) forwards',
        pointerEvents: 'none',
        willChange: 'transform, opacity',
      }}
    >
      {/* Amber accent band */}
      <div
        style={{
          width: 14,
          background: '#f59e0b',
          flexShrink: 0,
        }}
      />
      {/* Dark body with pulsing text */}
      <div
        style={{
          flex: 1,
          background: 'rgba(5,7,13,0.95)',
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          paddingLeft: 28,
          paddingRight: 40,
        }}
      >
        {/* Review icon */}
        <span
          aria-hidden
          style={{
            fontSize: 34,
            marginRight: 20,
            lineHeight: 1,
            animation: 'vosReviewPulse 1.6s ease-in-out infinite',
            willChange: 'opacity',
          }}
        >
          🔍
        </span>
        <span
          style={{
            color: '#f59e0b',
            fontFamily: "'Arial Black', 'Impact', sans-serif",
            fontSize: 32,
            fontWeight: 900,
            letterSpacing: 2,
            textTransform: 'uppercase',
            textShadow: '0 2px 8px rgba(0,0,0,0.7)',
            animation: 'vosReviewPulse 1.6s ease-in-out infinite',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            willChange: 'opacity',
          }}
        >
          {text}
        </span>
      </div>
    </div>
  );
}

// ── TimeoutOverlayWidget ───────────────────────────────────────────────
export interface TimeoutOverlayPayload {
  team?: 'home' | 'away';
  remaining?: number | null;
}

export interface TimeoutOverlayProps {
  payload: TimeoutOverlayPayload;
  snapshot?: PenaltyOverlaySnapshot;
  durationMs?: number;
  onExpire?: () => void;
}

const TIMEOUT_KF = `
@keyframes vosTimeoutIn {
  from { transform: translate(-50%, -120%); opacity: 0; }
  10%  { transform: translate(-50%, 0);    opacity: 1; }
  88%  { opacity: 1; }
  to   { opacity: 0; transform: translate(-50%, 0); }
}
`;

/**
 * Fly-in pill at top-center of the board.
 * Example: "AWAY TIMEOUT — 2 LEFT"
 */
export function TimeoutOverlayWidget({
  payload,
  snapshot,
  durationMs = 4000,
  onExpire,
}: TimeoutOverlayProps) {
  injectKeyframes('timeout', TIMEOUT_KF);

  const team = payload.team ?? 'home';
  const teamName =
    team === 'home'
      ? (snapshot?.homeTeam ?? 'HOME')
      : (snapshot?.awayTeam ?? 'AWAY');
  const teamColor =
    team === 'home'
      ? snapshot?.homeColor ?? '#4f46e5'
      : snapshot?.awayColor ?? '#dc2626';

  const remaining = typeof payload.remaining === 'number' ? payload.remaining : null;
  const label =
    remaining !== null
      ? `${teamName.toUpperCase()} TIMEOUT — ${remaining} LEFT`
      : `${teamName.toUpperCase()} TIMEOUT`;

  useEffect(() => {
    if (!onExpire) return;
    const t = setTimeout(onExpire, durationMs);
    return () => clearTimeout(t);
  }, [durationMs, onExpire]);

  const durSec = (durationMs / 1000).toFixed(2);

  return (
    <div
      aria-live="polite"
      aria-label={label}
      style={{
        position: 'absolute',
        left: '50%',
        top: PILL_TOP,
        height: PILL_HEIGHT,
        // Width is sized to content; use minWidth so short labels don't
        // look squashed. No transform:translateX(-50%) – we handle the
        // centering via the animation (which also provides the translateX).
        minWidth: 480,
        // Padding provides internal breathing room.
        paddingLeft: 32,
        paddingRight: 32,
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        background: `linear-gradient(135deg, rgba(5,7,13,0.95) 0%, rgba(5,7,13,0.90) 100%)`,
        borderRadius: 8,
        borderTop: `4px solid ${teamColor}`,
        zIndex: 60,
        animation: `vosTimeoutIn ${durSec}s cubic-bezier(.16,1,.3,1) forwards`,
        pointerEvents: 'none',
        willChange: 'transform, opacity',
        boxShadow: `0 6px 32px rgba(0,0,0,0.6), 0 0 0 1px ${teamColor}44`,
      }}
    >
      {/* Clock icon */}
      <span
        aria-hidden
        style={{
          fontSize: 30,
          marginRight: 16,
          lineHeight: 1,
        }}
      >
        ⏱️
      </span>
      <span
        style={{
          color: '#ffffff',
          fontFamily: "'Arial Black', 'Impact', sans-serif",
          fontSize: 28,
          fontWeight: 900,
          letterSpacing: 2,
          textTransform: 'uppercase',
          textShadow: '0 2px 8px rgba(0,0,0,0.7)',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
    </div>
  );
}

// ── LiveOverlayRenderer ────────────────────────────────────────────────
/**
 * Thin dispatcher: given the `liveOverlay` object from the board
 * response, render the right widget. Used by the board page and the
 * broadcast scorebug.
 *
 * `overlay` is the `liveOverlay` field from `BoardData` — null if no
 * overlay is active.
 */
export interface LiveOverlayData {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  snapshot: Record<string, unknown>;
  createdAt: string | Date;
}

export function LiveOverlayRenderer({
  overlay,
  onExpire,
}: {
  overlay: LiveOverlayData | null;
  onExpire?: () => void;
}) {
  // Key on `overlay.id` so React fully remounts the widget when the
  // overlay changes (new id = new animation from scratch).
  if (!overlay || overlay.kind === 'clear') return null;

  const snap = overlay.snapshot as PenaltyOverlaySnapshot;

  if (overlay.kind === 'penalty') {
    return (
      <PenaltyOverlayWidget
        key={overlay.id}
        payload={overlay.payload as PenaltyOverlayPayload}
        snapshot={snap}
        durationMs={3000}
        onExpire={onExpire}
      />
    );
  }

  if (overlay.kind === 'review') {
    return (
      <OfficialReviewOverlayWidget
        key={overlay.id}
        description={(overlay.payload.description as string) ?? undefined}
        onClear={onExpire}
      />
    );
  }

  if (overlay.kind === 'injury') {
    // Injury renders as a PenaltyOverlayWidget variant with the injury
    // team color, no jersey, and "INJURY TIMEOUT" as the infraction.
    const injuryPayload: PenaltyOverlayPayload = {
      team: (overlay.payload.team as 'home' | 'away') ?? 'home',
      jersey: (overlay.payload.jersey as string) ?? '',
      infraction: 'INJURY TIMEOUT',
      yards: null,
    };
    return (
      <PenaltyOverlayWidget
        key={overlay.id}
        payload={injuryPayload}
        snapshot={snap}
        durationMs={5000}
        onExpire={onExpire}
      />
    );
  }

  if (overlay.kind === 'timeout-banner') {
    return (
      <TimeoutOverlayWidget
        key={overlay.id}
        payload={overlay.payload as TimeoutOverlayPayload}
        snapshot={snap}
        durationMs={4000}
        onExpire={onExpire}
      />
    );
  }

  return null;
}
