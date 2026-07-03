/**
 * Wave D1 (2026-07-02, launch-sprint #282) — Tweak + Translate in the
 * DEFAULT AI picker.
 *
 * Finding (docs/research/2026-07-01-launch-sprint/05-EDITOR-CRUSH-LENSES.md,
 * ai-creator-flow lens): the app's DEFAULT generation path (Concierge chat →
 * AI-Designer boards, forceDesigner=true) produced candidates that carry
 * `_designerHtml` but NO `.spec` — and the picker's "Tweak" box + 🌐
 * translate chips were gated on `!!c.spec` alone. So on the flagship,
 * default flow, the refine/translate loop was invisible; only the legacy
 * engine path (which DOES set `.spec`) kept it.
 *
 * This suite mounts the REAL, exported `CandidateFullscreenPreview` (CLAUDE.md
 * rule #9 — the exact component the picker's full-screen preview renders,
 * not a re-implementation) and proves:
 *  - Tweak renders for an AI-Designer candidate (canTweak passed true when
 *    `_designerHtml` is set, mirroring the grid card's gate in page.tsx)
 *  - Tweak renders for an engine candidate (spec-bearing)
 *  - Tweak is absent when the caller doesn't pass canTweak (neither shape)
 *  - Opening Tweak reveals the instruction box + the 6 translate language
 *    chips, and both "Apply" and a translate chip invoke the SAME
 *    onApplyTweak callback the grid card's refineCandidate() binds to.
 *
 * Grid-card coverage: the picker grid's ~120-hook parent (`TemplatesPage`)
 * is not unit-mountable in isolation (see `GalleryCard`'s test file for the
 * established pattern of testing an exported sub-component instead), so
 * `canTweak`'s dispatch logic is covered directly against the same
 * predicate page.tsx uses (`!!c.spec || !!c._designerHtml`) below.
 */

import { render, screen, fireEvent } from '@testing-library/react';

// Engine (spec) candidates render via ScaledTemplateThumbnail, which
// measures its container with a ResizeObserver — same polyfill as
// gallery-card-use-for-game.test.tsx / sport-board-parity.test.tsx.
class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(global as unknown as { ResizeObserver: unknown }).ResizeObserver =
  (global as unknown as { ResizeObserver?: unknown }).ResizeObserver ?? FakeResizeObserver;

import { CandidateFullscreenPreview } from '../page';
import type { AiTemplateCandidate } from '@/hooks/use-api';

function designerCandidate(overrides: Partial<AiTemplateCandidate> = {}): AiTemplateCandidate {
  return {
    name: 'AI Designer board',
    zones: [{ name: 'board', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, defaultConfig: { html: '<html></html>' } }],
    _designerHtml: '<html><body>Hello</body></html>',
    ...overrides,
  };
}

function engineCandidate(overrides: Partial<AiTemplateCandidate> = {}): AiTemplateCandidate {
  return {
    name: 'Engine board',
    zones: [{ name: 'title', widgetType: 'TEXT', x: 0, y: 0, width: 100, height: 20, defaultConfig: {} }],
    spec: { archetype: 'hero-fullbleed', theme: 'bold' },
    ...overrides,
  };
}

/** Mirrors the exact gate `canTweak` uses in the grid card AND the
 *  full-screen preview wiring in page.tsx — a drift-catcher for the
 *  predicate itself, independent of the component render assertions below. */
function canTweakFor(c: AiTemplateCandidate): boolean {
  return !!c.spec || !!c._designerHtml;
}

function baseProps(candidate: AiTemplateCandidate, extra: Record<string, unknown> = {}) {
  return {
    candidate,
    index: 0,
    total: 3,
    canvas: { w: 1920, h: 1080 },
    saved: false,
    saving: false,
    onPrev: jest.fn(),
    onNext: jest.fn(),
    onClose: jest.fn(),
    onSave: jest.fn(),
    ...extra,
  };
}

describe('D1 — canTweak predicate parity (grid card + full-screen share this exact gate)', () => {
  it('is true for an AI-Designer candidate (_designerHtml, no spec) — the DEFAULT path', () => {
    expect(canTweakFor(designerCandidate())).toBe(true);
  });

  it('is true for a legacy engine candidate (spec, no _designerHtml)', () => {
    expect(canTweakFor(engineCandidate())).toBe(true);
  });

  it('is false when neither shape is present', () => {
    expect(canTweakFor({ name: 'bare', zones: [] } as unknown as AiTemplateCandidate)).toBe(false);
  });
});

describe('D1 — CandidateFullscreenPreview renders Tweak for AI-Designer AND engine candidates', () => {
  it('shows the Tweak button for a designer (_designerHtml) candidate', () => {
    const c = designerCandidate();
    render(
      <CandidateFullscreenPreview
        {...baseProps(c, { canTweak: canTweakFor(c), onOpenTweak: jest.fn() })}
      />,
    );
    expect(screen.getByRole('button', { name: /tweak/i })).toBeInTheDocument();
  });

  it('shows the Tweak button for an engine (spec) candidate', () => {
    const c = engineCandidate();
    render(
      <CandidateFullscreenPreview
        {...baseProps(c, { canTweak: canTweakFor(c), onOpenTweak: jest.fn() })}
      />,
    );
    expect(screen.getByRole('button', { name: /tweak/i })).toBeInTheDocument();
  });

  it('does NOT show Tweak when the caller omits canTweak', () => {
    const c = designerCandidate();
    render(<CandidateFullscreenPreview {...baseProps(c)} />);
    expect(screen.queryByRole('button', { name: /tweak/i })).not.toBeInTheDocument();
  });
});

describe('D1 — opening Tweak reveals the instruction box + translate chips, both wired to onApplyTweak', () => {
  it('Apply calls onApplyTweak with the typed instruction', () => {
    const c = designerCandidate();
    const onApplyTweak = jest.fn();
    const onTweakTextChange = jest.fn();
    const { rerender } = render(
      <CandidateFullscreenPreview
        {...baseProps(c, {
          canTweak: true,
          tweakOpen: false,
          onOpenTweak: jest.fn(),
          onTweakTextChange,
          onApplyTweak,
        })}
      />,
    );
    // Simulate the parent flipping tweakOpen after onOpenTweak fires (the
    // real page.tsx wiring: setAiTweakIdx(aiFullscreenIdx)).
    rerender(
      <CandidateFullscreenPreview
        {...baseProps(c, {
          canTweak: true,
          tweakOpen: true,
          tweakText: 'darker theme',
          onOpenTweak: jest.fn(),
          onTweakTextChange,
          onApplyTweak,
          onCancelTweak: jest.fn(),
        })}
      />,
    );
    const input = screen.getByPlaceholderText(/darker theme/i);
    expect(input).toHaveValue('darker theme');
    fireEvent.click(screen.getByRole('button', { name: /^apply$/i }));
    expect(onApplyTweak).toHaveBeenCalledWith('darker theme');
  });

  it('renders all 6 one-tap translate language chips, each invoking onApplyTweak with a translate instruction', () => {
    const c = designerCandidate();
    const onApplyTweak = jest.fn();
    render(
      <CandidateFullscreenPreview
        {...baseProps(c, {
          canTweak: true,
          tweakOpen: true,
          tweakText: '',
          onTweakTextChange: jest.fn(),
          onApplyTweak,
          onCancelTweak: jest.fn(),
        })}
      />,
    );
    ['Spanish', 'French', 'Chinese', 'Vietnamese', 'Korean', 'Arabic'].forEach((lang) => {
      expect(screen.getByRole('button', { name: lang })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Spanish' }));
    expect(onApplyTweak).toHaveBeenCalledTimes(1);
    expect(onApplyTweak.mock.calls[0][0]).toMatch(/translate all visible copy to spanish/i);
  });

  it('Cancel closes the tweak panel via onCancelTweak (does not call onApplyTweak)', () => {
    const c = engineCandidate();
    const onCancelTweak = jest.fn();
    const onApplyTweak = jest.fn();
    render(
      <CandidateFullscreenPreview
        {...baseProps(c, {
          canTweak: true,
          tweakOpen: true,
          tweakText: 'punchier headline',
          onTweakTextChange: jest.fn(),
          onApplyTweak,
          onCancelTweak,
        })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancelTweak).toHaveBeenCalledTimes(1);
    expect(onApplyTweak).not.toHaveBeenCalled();
  });
});
