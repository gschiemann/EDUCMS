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
 *
 * REWRITTEN 2026-09-11 (Phase 2). The assertions used to click filter CHIPS
 * named "Shapes" / "Icons" / "Decorations" — three of the ~30 that stacked
 * seven rows deep above the first visible widget. Those chips are gone; the
 * route to the same tiles is now the search field and the single Filters
 * popover. The QUESTION this suite asks is unchanged and is the whole point:
 * can the operator actually reach these tiles in the rendered palette?
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { VariantPicker } from '../VariantPicker';
import { useBuilderStore } from '../useBuilderStore';

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

// Nothing selected: the panel is in its plain browse state.
beforeEach(() => {
  useBuilderStore.setState({ zones: [], selectedIds: [], past: [], future: [] } as any);
});

function mountPicker() {
  return render(
    <DndContext>
      <VariantPicker />
    </DndContext>,
  );
}

function search(term: string) {
  fireEvent.change(screen.getByLabelText('Search widgets'), { target: { value: term } });
}

describe('VariantPicker — Elements tiles render in the real palette', () => {
  it('groups Shapes / Icons / Backgrounds under one named, human row', () => {
    mountPicker();
    expect(screen.getByText('Shapes & backgrounds')).toBeTruthy();
  });

  it('the Shapes & backgrounds filter shows every SHAPE primitive tile', () => {
    mountPicker();
    fireEvent.click(screen.getByRole('button', { name: /^Filters/ }));
    const axis = screen.getByLabelText('Category') as HTMLSelectElement;
    const option = Array.from(axis.options).find((o) => o.textContent === 'Shapes & backgrounds')!;
    fireEvent.change(axis, { target: { value: option.value } });
    for (const label of ['Rectangle', 'Rounded Pill', 'Circle', 'Triangle', 'Star', 'Divider Line', 'Arrow']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('searching "decoration" shows all 8 resurrected animation tiles', () => {
    mountPicker();
    search('decoration');
    for (const label of ['Confetti', 'Rainbow Ribbon', 'Balloons', 'Clouds', 'Sparkles', 'Neon Buzz', 'Pulse Glow']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    // 'Ticker' exists as a decoration too, and TICKER widgets share the name.
    expect(screen.getAllByText('Ticker').length).toBeGreaterThanOrEqual(1);
  });

  it('searching "icon" surfaces the Icon element tile', () => {
    mountPicker();
    search('icon');
    expect(screen.getAllByText('Icon').length).toBeGreaterThanOrEqual(1);
  });
});
