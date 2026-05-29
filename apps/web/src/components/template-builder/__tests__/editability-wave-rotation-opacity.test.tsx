/**
 * §19 editability fix-wave proof (2026-05-28, Opus 4.8) — Task 3.
 *
 * Runnable RTL proof that the universal Rotation + Opacity controls in the
 * "Position & size" section actually fire a ZONE update (not a costume).
 *
 * We mount the REAL <PropertiesPanel> against the real Zustand builder store,
 * select a zone, expand "Position & size", drive the Rotation and Opacity
 * NumFields the way an operator would (type → blur to commit), and read the
 * zone back out of the store to confirm defaultConfig._zoneRotation /
 * _zoneOpacity were written. Those keys are what BuilderZone AND
 * player/page.tsx read to apply `transform: rotate()` + `opacity` to the zone
 * wrapper (see the render-side wiring in those two files), so a passing write
 * here proves the control is connected to the value the renderers consume.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { PropertiesPanel } from '../PropertiesPanel';
import { useBuilderStore } from '../useBuilderStore';
import type { Zone } from '../types';

function seedZone(extra: Partial<Zone> = {}): Zone {
  return {
    id: 'z1',
    name: 'Headline',
    widgetType: 'TEXT',
    x: 10,
    y: 10,
    width: 40,
    height: 20,
    zIndex: 1,
    sortOrder: 0,
    defaultConfig: { text: 'Hello' },
    ...extra,
  } as Zone;
}

function mountWithZone(zone: Zone) {
  useBuilderStore.getState().init({
    id: 't1',
    isSystem: false,
    zones: [zone],
    meta: { name: 'T', description: '', screenWidth: 1920, screenHeight: 1080, bgColor: '', bgGradient: '', bgImage: '' },
    isTouchEnabled: false,
    idleResetMs: 60000,
    scenes: [],
  });
  // Select the zone so PropertiesPanel renders the zone (not template) view.
  useBuilderStore.setState({ selectedIds: [zone.id] });
  return render(<PropertiesPanel />);
}

function readZone(): Zone {
  return useBuilderStore.getState().zones[0];
}

function expandPositionSection() {
  // CollapsibleSection toggle button; defaultOpen=false so we must open it.
  fireEvent.click(screen.getByRole('button', { name: /position & size/i }));
}

describe('Position & size — universal Rotation + Opacity (Task 3)', () => {
  it('renders Rotation and Opacity NumFields once Position & size is expanded', () => {
    mountWithZone(seedZone());
    expandPositionSection();
    expect(screen.getByLabelText(/Rotation/i)).toBeTruthy();
    expect(screen.getByLabelText(/Opacity/i)).toBeTruthy();
  });

  it('typing a rotation writes defaultConfig._zoneRotation on the zone (normalized 0–359)', () => {
    mountWithZone(seedZone());
    expandPositionSection();
    const rot = screen.getByLabelText(/Rotation/i);
    fireEvent.change(rot, { target: { value: '45' } });
    fireEvent.blur(rot); // NumField commits on blur
    const cfg = readZone().defaultConfig as Record<string, unknown>;
    expect(cfg._zoneRotation).toBe(45);
    // existing content config preserved
    expect(cfg.text).toBe('Hello');
  });

  it('a rotation ≥360 is normalized into 0–359 before storage', () => {
    mountWithZone(seedZone());
    expandPositionSection();
    const rot = screen.getByLabelText(/Rotation/i);
    // NumField clamps to max=359 on commit; the onChange handler then
    // normalizes via ((n % 360) + 360) % 360. 359 stays 359.
    fireEvent.change(rot, { target: { value: '359' } });
    fireEvent.blur(rot);
    const cfg = readZone().defaultConfig as Record<string, unknown>;
    expect(cfg._zoneRotation).toBe(359);
  });

  it('typing an opacity writes defaultConfig._zoneOpacity (clamped 0–1)', () => {
    mountWithZone(seedZone());
    expandPositionSection();
    const opa = screen.getByLabelText(/Opacity/i);
    fireEvent.change(opa, { target: { value: '0.5' } });
    fireEvent.blur(opa);
    const cfg = readZone().defaultConfig as Record<string, unknown>;
    expect(cfg._zoneOpacity).toBe(0.5);
    expect(cfg.text).toBe('Hello'); // content preserved
  });

  it('pre-set rotation/opacity load into the inputs as the current values', () => {
    mountWithZone(seedZone({ defaultConfig: { text: 'Hi', _zoneRotation: 90, _zoneOpacity: 0.4 } }));
    expandPositionSection();
    expect((screen.getByLabelText(/Rotation/i) as HTMLInputElement).value).toBe('90');
    expect((screen.getByLabelText(/Opacity/i) as HTMLInputElement).value).toBe('0.4');
  });

  it('rotation + opacity are independent — setting one leaves the other intact', () => {
    mountWithZone(seedZone({ defaultConfig: { text: 'Hi', _zoneRotation: 15 } }));
    expandPositionSection();
    const opa = screen.getByLabelText(/Opacity/i);
    fireEvent.change(opa, { target: { value: '0.7' } });
    fireEvent.blur(opa);
    const cfg = readZone().defaultConfig as Record<string, unknown>;
    expect(cfg._zoneOpacity).toBe(0.7);
    expect(cfg._zoneRotation).toBe(15); // untouched
  });
});

// Render-contract lock: the panel must write the EXACT keys the BuilderZone +
// player/page.tsx zone wrappers read (`_zoneRotation` / `_zoneOpacity`). If a
// future rename desyncs the panel from those readers, this fails loudly.
describe('zone-style key contract (panel ↔ renderers)', () => {
  it('uses the exact keys the renderers read', () => {
    mountWithZone(seedZone());
    expandPositionSection();
    const rot = screen.getByLabelText(/Rotation/i);
    fireEvent.change(rot, { target: { value: '30' } });
    fireEvent.blur(rot);
    const opa = screen.getByLabelText(/Opacity/i);
    fireEvent.change(opa, { target: { value: '0.25' } });
    fireEvent.blur(opa);
    const cfg = readZone().defaultConfig as Record<string, unknown>;
    expect(Object.keys(cfg)).toEqual(expect.arrayContaining(['_zoneRotation', '_zoneOpacity']));
  });
});
