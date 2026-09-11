'use client';

/**
 * WidgetEmptyState — what a widget renders when it has NOTHING configured.
 *
 * ── THE BUG THIS EXISTS TO KILL (2026-09-11) ──────────────────────────
 * The operator added his first widget (FITNESS_AD_BANNER) to a gym tenant
 * and the canvas showed a finished-looking ad: "YOUR GYM", "New Member
 * Special · 50% off first month", "PRESENTED BY Your Gym". He tried to
 * edit it and could not, because none of that copy was his — it was
 * `DEMO_CREATIVES`, a hardcoded array rendered precisely BECAUSE he had no
 * creatives yet. Meanwhile the Properties panel correctly said "No
 * creatives yet". The widget lied about its own state: empty looked
 * populated, so the operator reasonably tried to edit text that has no
 * field behind it. His words: "added the first widget and i cant edit
 * anything on it, wtf are we doing here bro". That is CLAUDE.md §19, and
 * the same class of lie produced this product's loudest complaint ever.
 *
 * ── THE RULE ──────────────────────────────────────────────────────────
 * EMPTY MEANS EMPTY. A widget never invents content it does not have.
 * What "empty" LOOKS like depends on who is looking, which is exactly what
 * `RenderSurface` answers (see `render-surface.tsx`):
 *
 *   BUILDER ('builder' — the canvas, the gallery thumbnail, the preview
 *   modal, every test). An OPERATOR is looking. Render a designed,
 *   deliberate panel that NAMES THE NEXT ACTION in his words ("Add your
 *   first creative") and is obviously not finished content: dashed frame,
 *   muted field, an eyebrow naming the slot. He must be able to tell at a
 *   glance that the zone is empty and know what to do about it.
 *
 *   PLAYER ('player' — a real screen on a wall, set only by
 *   `app/player/rendererBundle.tsx`). The PUBLIC is looking. It must show
 *   NEITHER fabricated content NOR an authoring prompt: a lobby screen
 *   telling a gym member to "Add your first creative" is as bad as one
 *   advertising a sale that does not exist. So the player renders the
 *   quiet variant — the zone's own tone, no text, no dashes, no chrome.
 *   It still OCCUPIES its zone, so the rest of the board's layout is
 *   untouched; only this one zone goes quiet. (The screen as a whole is
 *   never blanked by this: that is the player's own failure mode, guarded
 *   elsewhere — see the Player Reliability rules in CLAUDE.md.)
 *
 * Both halves must be TRUE. Neither may fabricate.
 *
 * ── SIZING ────────────────────────────────────────────────────────────
 * These zones range from a 200px builder tile to a 3840px 4K wall, so the
 * panel measures its own box and scales from it. `vw`/`%` font sizing is
 * banned here for the same reason CLAUDE.md's template workflow bans it —
 * it reads the viewport, not the container, and a widget inside a
 * transform:scale'd scene gets it badly wrong.
 *
 * ── TAURUS / CHROMIUM-83 ──────────────────────────────────────────────
 * Inline styles only. There is deliberately no runtime <style> block here, so
 * this component has no scene CSS to route through the scene-css helper at all.
 * No `inset` shorthand, and never four physical sides in one
 * style object (CLAUDE.md rule #10, all three variants), no flex `gap`, no
 * `backdrop-filter`.
 */

import { useEffect, useRef, useState } from 'react';
import { useRenderSurface } from './render-surface';

export interface WidgetEmptyStateProps {
  /**
   * What this slot IS, in the operator's vocabulary — the eyebrow chip.
   * Short and literal: "AD SLOT", "MENU", "TAP LIST". Never a sentence.
   */
  eyebrow: string;
  /**
   * The NEXT ACTION, phrased as the operator would say it and matching the
   * control he is about to use in the Properties panel: "Add your first
   * creative", "Add a menu item". Imperative, no period.
   */
  action: string;
  /**
   * One short line telling him WHERE. Optional — omit rather than pad.
   */
  hint?: string;
  /** Accent used for the eyebrow chip. Defaults to a neutral slate. */
  accent?: string;
  /**
   * Tone of the surrounding widget. 'dark' (default) suits the fitness /
   * bar / QSR packs; 'light' suits the retail / paper packs.
   */
  tone?: 'dark' | 'light';
}

/** Measure the rendered box so type scales with the zone, not the viewport. */
function useBoxUnit(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  // Start at the builder-tile size so the FIRST paint is already legible
  // (and so jsdom, which has no layout, renders something sane in tests).
  const [unit, setUnit] = useState(14);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth || 0;
      const h = el.clientHeight || 0;
      if (!w || !h) return;
      // ~7% of the short edge, clamped so a sliver-shaped ribbon zone stays
      // readable and a 4K full-bleed zone does not render circus type.
      // The 14px FLOOR is measured, not guessed: at a 320x180 gallery-thumb
      // zone the raw formula gave u=12.6, which rendered the eyebrow chip at
      // 7px — unreadable, so the panel stopped doing its one job. Anything
      // below this floor is a zone too small to say anything in, and the
      // overflow:hidden + maxWidth on the body keeps it from spilling.
      const next = Math.max(14, Math.min(56, Math.min(w, h) * 0.07, w * 0.045));
      setUnit((prev) => (Math.abs(prev - next) < 0.5 ? prev : next));
    };
    measure();
    // Chromium 64+ / Taurus-safe. Guarded because jsdom has none by default.
    const RO = typeof ResizeObserver !== 'undefined' ? ResizeObserver : null;
    if (!RO) return;
    const ro = new RO(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [ref, unit];
}

export function WidgetEmptyState({
  eyebrow,
  action,
  hint,
  accent,
  tone = 'dark',
}: WidgetEmptyStateProps) {
  const surface = useRenderSurface();
  const [ref, u] = useBoxUnit();

  const dark = tone !== 'light';
  const field = dark ? '#111318' : '#f4f2ee';
  const ink = dark ? '#e7e9ee' : '#1f2430';
  const muted = dark ? '#8a93a6' : '#6b7280';
  const chip = accent || (dark ? '#64748b' : '#94a3b8');

  // ── PLAYER ── a real screen. No fabricated content, and no authoring
  // prompt in front of the public either: the zone holds its place and
  // says nothing. Deliberately keeps the widget's own tone so it reads as
  // a quiet panel rather than a hole punched in the board.
  if (surface === 'player') {
    return (
      <div
        data-widget-empty="player"
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background: field,
        }}
      />
    );
  }

  // ── BUILDER ── an operator is laying this out. Say what the slot is and
  // what to do next, and look unmistakably unfinished while doing it.
  return (
    <div
      ref={ref}
      data-widget-empty="builder"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        background: field,
        border: `${Math.max(1, Math.round(u * 0.06))}px dashed ${dark ? 'rgba(255,255,255,0.14)' : 'rgba(15,23,42,0.16)'}`,
        borderRadius: Math.round(u * 0.35),
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        textAlign: 'center',
        fontFamily: "'Outfit', 'Inter', system-ui, sans-serif",
      }}
    >
      <div style={{ padding: `${Math.round(u * 0.5)}px`, maxWidth: '92%' }}>
        <div
          style={{
            display: 'inline-block',
            // No flex `gap` anywhere in this tree — Chromium 83.
            marginBottom: Math.round(u * 0.55),
            padding: `${Math.round(u * 0.16)}px ${Math.round(u * 0.5)}px`,
            borderRadius: Math.round(u * 0.25),
            background: chip,
            color: dark ? '#0b0d12' : '#ffffff',
            fontSize: Math.max(11, Math.round(u * 0.52)),
            fontWeight: 800,
            letterSpacing: Math.max(0.5, u * 0.05),
            lineHeight: 1.2,
            whiteSpace: 'nowrap',
          }}
        >
          {eyebrow}
        </div>
        <div
          style={{
            color: ink,
            fontSize: Math.round(u),
            fontWeight: 700,
            lineHeight: 1.2,
          }}
        >
          {action}
        </div>
        {hint ? (
          <div
            style={{
              marginTop: Math.round(u * 0.34),
              color: muted,
              fontSize: Math.max(10, Math.round(u * 0.52)),
              fontWeight: 500,
              lineHeight: 1.35,
            }}
          >
            {hint}
          </div>
        ) : null}
      </div>
    </div>
  );
}
