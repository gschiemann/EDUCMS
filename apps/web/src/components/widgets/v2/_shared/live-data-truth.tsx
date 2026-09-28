"use client";
/**
 * Live Data / Transit truth (K-12 launch follow-up, lane B4, 2026-09-27).
 *
 * The Live Data and Transit packs render from `config` — none of them has a
 * feed. They shipped with built-in sample content (NASDAQ quotes, bitcoin
 * prices, "AP · Reuters · BBC" headlines, an SFO departures board, a Springfield
 * air-quality reading) that showed on EVERY real screen with nothing typed,
 * under claims like "delayed 15 min", "via CoinGecko" and "refreshed every 5
 * min". A lobby screen presented invented market prices as live.
 *
 * The rule, the same one the Scores Board and the sports-venue pack follow:
 *   • builder (the default surface) — nothing typed shows the sample, stamped
 *     SAMPLE, so the tile is never blank;
 *   • real screen (`RenderSurfaceProvider surface="player"`) — only what the
 *     operator typed; nothing typed reads as an honest empty board ("—"),
 *     never a number nobody entered, never a source nothing fetched.
 * Values the pack used to SEED into a dropped zone (a sample header like
 * "SFO · TERMINAL 2", the whole sample air-quality reading) count as "not
 * typed" on a real screen — no operator types the exact sample.
 */
import React from 'react';
import { useRenderSurface } from '../../render-surface';

/** Is this render on a real screen (the player / a public board)? */
export function useRealScreen(): boolean {
  return useRenderSurface() === 'player';
}

/** The operator's typed rows — an array of objects that pass `valid`. */
export function typedRows<T>(value: unknown, valid: (row: T) => boolean): T[] {
  if (!Array.isArray(value)) return [];
  return (value as T[]).filter((r) => !!r && typeof r === 'object' && valid(r));
}

/** A finite number, or undefined — rows arrive from JSON / an AI draft as strings too. */
export function numberOf(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** A trimmed string; '' when absent or not text. */
export function textOf(v: unknown): string {
  return typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
}

/** The copy each pack used to seed into a dropped zone (lane B4 cleanup). */
export const LIVE_DATA_SEEDED_LABELS = {
  newsSource: 'AP · Reuters · BBC',
  trafficCity: 'I-5 Corridor',
  departuresAirport: 'SFO · TERMINAL 2',
  transitStation: 'EMBARCADERO',
  parkingFacility: 'SFO TERMINAL 2',
} as const;

/** A typed label, or undefined when it is the pack's own seed (or blank). */
export function ownLabel(value: unknown, seed: string): string | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim();
  return v && v !== seed ? v : undefined;
}

/**
 * Builder-only stamp: the content on this tile is a sample. Never on a real
 * screen. Sized off the tile's pixel `height` when the widget knows it
 * (the v2 packs), else a fixed small chip (the themed weather variants).
 */
export function SampleStamp({ height }: { height?: number }) {
  const u = (f: number, min: number, fixed: number) => (height ? Math.max(min, Math.round(height * f)) : fixed);
  return (
    <div
      data-live-data-sample=""
      style={{
        position: 'absolute', bottom: u(0.02, 8, 6), right: u(0.025, 8, 6), zIndex: 20,
        background: 'rgba(0,0,0,0.62)', color: '#facc15', fontWeight: 800,
        fontSize: u(0.026, 10, 11), letterSpacing: '0.2em', lineHeight: 1.2,
        padding: `${u(0.006, 2, 2)}px ${u(0.014, 4, 6)}px`, borderRadius: u(0.008, 2, 3),
        border: '1px solid rgba(250,204,21,0.45)', pointerEvents: 'none', whiteSpace: 'nowrap',
        fontFamily: 'system-ui, sans-serif', textShadow: 'none',
      }}
    >
      SAMPLE
    </div>
  );
}

/** The honest body of a real-screen board with nothing typed: a dash, no invented rows. */
export function NothingTyped({ color, height }: { color: string; height: number }) {
  return (
    <div
      data-live-data-empty=""
      style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color, fontWeight: 700, fontSize: Math.max(18, Math.round(height * 0.09)), opacity: 0.55 }}
    >
      —
    </div>
  );
}
