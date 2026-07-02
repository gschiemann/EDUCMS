/**
 * A2 drift-catcher (Wave A — "Crush Canva", 2026-07-02).
 *
 * Pre-fix, ContentFields.setField() called updateZone(zone.id, patch, true)
 * on EVERY keystroke (PropertiesPanel.tsx ContentFields), and setMeta()
 * unconditionally snapshotted on every call too. With HISTORY_LIMIT=50,
 * typing one ~15-character headline pushed 15 history entries and evicted
 * the tail of a 50-deep undo stack — Cmd-Z reverted one CHARACTER at a
 * time instead of the whole edit.
 *
 * Post-fix: TextField/TextAreaField (the shared components every field in
 * ContentFields/TemplateProperties renders through) call beginTransaction()
 * on focus and endTransaction() on blur. The store's activeTransaction
 * guard makes every commit=true call during that window a no-op re-commit
 * — only the FIRST keystroke's beginTransaction() pushes a snapshot. This
 * spec simulates N keystrokes building up a full headline and asserts
 * EXACTLY ONE undo step restores the full original text (not the previous
 * character).
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
    defaultConfig: { content: 'Hello' },
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
  useBuilderStore.setState({ selectedIds: [zone.id] });
  return render(<PropertiesPanel />);
}

function readZone(): Zone {
  return useBuilderStore.getState().zones[0];
}

describe('A2 — undo keystroke coalescing (drift catcher)', () => {
  it('typing a whole headline in one focus session is ONE undo step, not one per keystroke', () => {
    mountWithZone(seedZone({ defaultConfig: { content: 'Hello' } }));

    // TextField/TextAreaField's <label> isn't htmlFor-bound to the
    // input (no shared `id`), so query by the field's own placeholder
    // text instead of getByLabelText.
    const field = screen.getByPlaceholderText('Your headline…') as HTMLTextAreaElement;

    // Simulate a real typing session: focus once, then N sequential
    // keystrokes (each keystroke = one onChange call, exactly how the
    // browser fires them), never blurring in between.
    fireEvent.focus(field);
    const target = 'Hello, Wildcats! Home game Friday at 7pm';
    for (let i = 6; i <= target.length; i++) {
      fireEvent.change(field, { target: { value: target.slice(0, i) } });
    }
    fireEvent.blur(field);

    expect((readZone().defaultConfig as any).content).toBe(target);

    // History coalesced to ONE entry for the whole session (the original
    // pre-edit snapshot pushed once on focus), not one per keystroke.
    const pastLen = useBuilderStore.getState().past.length;
    expect(pastLen).toBe(1);

    // A single Cmd-Z restores the FULL original text, not one character
    // back from the final value.
    useBuilderStore.getState().undo();
    expect((readZone().defaultConfig as any).content).toBe('Hello');
  });

  it('two separate edit sessions (focus/blur/focus/blur) push two separate undo steps', () => {
    mountWithZone(seedZone({ defaultConfig: { content: 'Hello' } }));
    // TextField/TextAreaField's <label> isn't htmlFor-bound to the
    // input (no shared `id`), so query by the field's own placeholder
    // text instead of getByLabelText.
    const field = screen.getByPlaceholderText('Your headline…') as HTMLTextAreaElement;

    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: 'Hello there' } });
    fireEvent.blur(field);

    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: 'Hello there, friend' } });
    fireEvent.blur(field);

    expect(useBuilderStore.getState().past.length).toBe(2);

    // First undo reverts session 2 back to session 1's end state.
    useBuilderStore.getState().undo();
    expect((readZone().defaultConfig as any).content).toBe('Hello there');

    // Second undo reverts session 1 back to the original.
    useBuilderStore.getState().undo();
    expect((readZone().defaultConfig as any).content).toBe('Hello');
  });

  it('does not leave activeTransaction stuck open after blur (a later unrelated commit gets its own snapshot)', () => {
    mountWithZone(seedZone({ defaultConfig: { content: 'Hello' } }));
    // TextField/TextAreaField's <label> isn't htmlFor-bound to the
    // input (no shared `id`), so query by the field's own placeholder
    // text instead of getByLabelText.
    const field = screen.getByPlaceholderText('Your headline…') as HTMLTextAreaElement;

    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: 'Hello there' } });
    fireEvent.blur(field);

    expect(useBuilderStore.getState().activeTransaction).toBe(false);

    // A later, unrelated commit=true call (simulating e.g. a NumField
    // blur-commit) should push its OWN snapshot, not get swallowed.
    useBuilderStore.getState().updateZone('z1', { x: 20 }, true);
    expect(useBuilderStore.getState().past.length).toBe(2);
  });
});
