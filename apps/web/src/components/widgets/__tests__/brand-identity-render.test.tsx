/**
 * The identity keys a rebrand writes reach the glass (2026-11-23).
 *
 * Settings > Brand "Apply to templates" and the editor's "Brand this
 * template" write the organisation's name, tagline and logo into the keys of
 * the shared registry (@cms/api-types brand-identity-keys.ts). The API spec
 * (apps/api/src/branding/identity-registry.spec.ts) proves each key is READ
 * in the renderer source; these smoke renders prove the renderer then PAINTS
 * it — a value in the key shows, and with the key absent the registered
 * placeholder shows (so a value equal to it is indeed the renderer's sample).
 */
import { render } from '@testing-library/react';
import type { ComponentType } from 'react';
import { identityKeysFor } from '@cms/api-types';
import { MsArcadeWidget } from '../ms/MsArcadeWidget';
import { HsVarsityWidget } from '../hs/HsVarsityWidget';
import { FitnessStadiumWidget } from '../fitness/FitnessStadiumWidget';
import { AnimatedWelcomeWidget } from '../AnimatedWelcomeWidget';
import { AnimatedHallwayScheduleWidget } from '../AnimatedHallwayScheduleWidget';

// jsdom has no ResizeObserver; the scenes' auto-fit text observes its box.
// A no-op is fine: the text is in the DOM either way.
beforeAll(() => {
  const g = globalThis as unknown as { ResizeObserver?: unknown };
  g.ResizeObserver =
    g.ResizeObserver ||
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
});

const PROBE = 'Probe Academy of Testing';
const PROBE_URL = 'https://cdn.example/probe-logo.png';

type Scene = ComponentType<{ config: Record<string, unknown> }>;
const CASES: Array<[string, Scene]> = [
  ['MS_ARCADE', MsArcadeWidget as unknown as Scene],
  ['HS_VARSITY', HsVarsityWidget as unknown as Scene],
  ['FITNESS_STADIUM', FitnessStadiumWidget as unknown as Scene],
  ['ANIMATED_WELCOME', AnimatedWelcomeWidget as unknown as Scene],
  ['ANIMATED_HALLWAY_SCHEDULE', AnimatedHallwayScheduleWidget as unknown as Scene],
];

const text = (el: HTMLElement) => (el.textContent || '').replace(/\s+/g, ' ');

describe.each(CASES)('%s paints its registered identity keys', (type, Widget) => {
  const specs = identityKeysFor(type) || [];

  it('is in the registry', () => {
    expect(specs.length).toBeGreaterThan(0);
  });

  it.each(specs.map((s) => [s.key, s] as const))('%s: a value shows; absent, the placeholder shows', (key, spec) => {
    if (spec.role === 'logo') {
      const { container, unmount } = render(<Widget config={{ [key]: PROBE_URL }} />);
      expect(container.querySelector(`img[src="${PROBE_URL}"]`)).not.toBeNull();
      unmount();
      const empty = render(<Widget config={{}} />);
      expect(empty.container.querySelector(`img[src="${PROBE_URL}"]`)).toBeNull();
      empty.unmount();
      return;
    }
    const { container, unmount } = render(<Widget config={{ [key]: PROBE }} />);
    const field = container.querySelector(`[data-field="${key}"]`) as HTMLElement | null;
    expect(field).not.toBeNull();
    expect(text(field!)).toContain(PROBE);
    unmount();
    const empty = render(<Widget config={{}} />);
    const emptyField = empty.container.querySelector(`[data-field="${key}"]`) as HTMLElement | null;
    expect(emptyField).not.toBeNull();
    for (const p of spec.placeholders || []) expect(text(emptyField!)).toContain(p.text);
    expect(text(emptyField!)).not.toContain(PROBE);
    empty.unmount();
  });
});
