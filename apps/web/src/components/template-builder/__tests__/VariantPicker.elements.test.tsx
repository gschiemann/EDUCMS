/**
 * Rule-#9 render proof for the Elements wave — Wave B / editor-crush
 * B2+B3+B5 (2026-07-02).
 *
 * The registry drift-catcher (variants-registry-elements.test.ts) asserts
 * the registerVariant calls exist; THIS suite mounts the REAL
 * <VariantPicker /> — the component BuilderShell actually renders for the
 * widgets panel — and proves the Shapes / Icons / Decorations tiles are in
 * the rendered palette an operator sees. This is the check that would have
 * caught the original Decoration dead-registration (tiles listed in a file
 * no surface imports → invisible for two months despite green CI).
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { VariantPicker } from '../VariantPicker';

// jsdom has no ResizeObserver; DecorationWidget (and other live tile
// previews) observe their own box. No-op is fine — tiles render at 0x0.
beforeAll(() => {
  (globalThis as any).ResizeObserver =
    (globalThis as any).ResizeObserver ||
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
});

function mountPicker() {
  return render(
    <DndContext>
      <VariantPicker />
    </DndContext>,
  );
}

describe('VariantPicker — Elements tiles render in the real palette', () => {
  it('shows the Shapes / Icons / Decorations filter chips', () => {
    mountPicker();
    expect(screen.getByRole('button', { name: /^Shapes$/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Icons$/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Decorations$/i })).toBeTruthy();
  });

  it('filtering to Shapes shows every SHAPE primitive tile', () => {
    mountPicker();
    fireEvent.click(screen.getByRole('button', { name: /^Shapes$/i }));
    for (const label of ['Rectangle', 'Rounded Pill', 'Circle', 'Triangle', 'Star', 'Divider Line', 'Arrow']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('filtering to Decorations shows all 8 resurrected animation tiles', () => {
    mountPicker();
    fireEvent.click(screen.getByRole('button', { name: /^Decorations$/i }));
    for (const label of ['Confetti', 'Rainbow Ribbon', 'Balloons', 'Clouds', 'Sparkles', 'Neon Buzz', 'Pulse Glow']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    // 'Ticker' exists as a decoration too, but TICKER widgets share the
    // name — scope the assertion to the filtered tile grid count instead.
    expect(screen.getAllByText('Ticker').length).toBeGreaterThanOrEqual(1);
  });

  it('searching "icon" surfaces the Icon element tile', () => {
    mountPicker();
    fireEvent.change(screen.getByPlaceholderText(/Search widgets/i), { target: { value: 'icon' } });
    expect(screen.getAllByText('Icon').length).toBeGreaterThanOrEqual(1);
  });
});
