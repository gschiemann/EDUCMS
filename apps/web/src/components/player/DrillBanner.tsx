"use client";

/**
 * "DRILL — THIS IS A DRILL" — the persistent banner the player paints over
 * everything while a DRILL alert is on the glass (2026-10-10).
 *
 * Rendered by the player page when `activeEmergency.isDrill === true` (the
 * manifest's `isDrill`, or the raise descriptor's). Fixed, top-anchored,
 * above every content layer INCLUDING the emergency takeover (z-[10050] >
 * the message overlay's 9999): operator content cannot hide it. Indigo —
 * never the red of a live alert — so "drill" reads from across a gym.
 *
 * The words ship in English, Spanish and Chinese ON THE GLASS (the player is
 * not an operator surface with a language setting; a building's occupants
 * are whoever is in it), tri-lingual on one line so no viewer has to wait
 * for a rotation.
 *
 * Taurus / Chromium-83 rules: no `inset`, no flex `gap`, no `backdrop-filter`,
 * longhand sides only; the box is sized by width/height off the canonical LED
 * canvas (`--led-w`), never by four sides (CLAUDE.md rule #10, third variant).
 * `backgroundColor` is an inline hex so the banner paints opaque even if
 * Tailwind fails to load on the kiosk WebView.
 */

export const DRILL_BANNER_TEXT = {
  en: 'DRILL — THIS IS A DRILL',
  es: 'SIMULACRO — ESTO ES UN SIMULACRO',
  zh: '演习 — 这是演习',
} as const;

export const DRILL_BANNER_SUBTEXT = {
  en: 'Practice drill · Not a real emergency',
  es: 'Simulacro de práctica · No es una emergencia real',
  zh: '演练 · 并非真实紧急情况',
} as const;

export function DrillBanner() {
  return (
    <div
      role="status"
      aria-live="polite"
      data-edu-drill-banner="1"
      data-testid="drill-banner"
      className="fixed top-0 left-0 z-[10050] text-white pointer-events-none select-none"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: 'var(--led-w, 100vw)',
        backgroundColor: '#312e81',
        borderBottom: '6px solid #a5b4fc',
        boxShadow: '0 6px 24px rgba(0,0,0,0.45)',
        padding: '14px 28px',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          fontSize: 'clamp(22px, 2.6vw, 44px)',
          fontWeight: 900,
          letterSpacing: '0.12em',
          lineHeight: 1.15,
          textTransform: 'uppercase',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        <span>{DRILL_BANNER_TEXT.en}</span>
        <span style={{ marginLeft: '0.9em', opacity: 0.9 }}>{DRILL_BANNER_TEXT.es}</span>
        <span style={{ marginLeft: '0.9em', opacity: 0.9 }}>{DRILL_BANNER_TEXT.zh}</span>
      </div>
      <div
        style={{
          fontSize: 'clamp(13px, 1.2vw, 20px)',
          fontWeight: 600,
          letterSpacing: '0.06em',
          marginTop: 4,
          color: '#c7d2fe',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        <span>{DRILL_BANNER_SUBTEXT.en}</span>
        <span style={{ marginLeft: '0.9em' }}>{DRILL_BANNER_SUBTEXT.es}</span>
        <span style={{ marginLeft: '0.9em' }}>{DRILL_BANNER_SUBTEXT.zh}</span>
      </div>
    </div>
  );
}

export default DrillBanner;
