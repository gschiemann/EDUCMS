/**
 * A zone can be renamed (Codex T03, 2026-09-13). The Properties "Name" was a
 * read-only div whose comment deferred renaming to the Layers tab, which has no
 * rename control — so no zone could be renamed anywhere. Mutation check:
 * restore the read-only div and every test here fails.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { PropertiesPanel } from '../PropertiesPanel';
import { useBuilderStore } from '../useBuilderStore';
import type { Zone } from '../types';

jest.mock('@/lib/api-client', () => ({ ...jest.requireActual('@/lib/api-client'), apiFetch: jest.fn(() => new Promise(() => undefined)) }));

const zone = (): Zone => ({ id: 'z1', name: 'Headline', widgetType: 'TEXT', x: 10, y: 10, width: 40, height: 20, zIndex: 1, sortOrder: 0, defaultConfig: { text: 'Hello' } } as Zone);
function mount() {
  useBuilderStore.getState().init({ id: 't1', isSystem: false, zones: [zone()], meta: { name: 'T', description: '', screenWidth: 1920, screenHeight: 1080, bgColor: '', bgGradient: '', bgImage: '' }, isTouchEnabled: false, idleResetMs: 60000, scenes: [] });
  useBuilderStore.setState({ selectedIds: ['z1'] });
  return render(<PropertiesPanel />);
}
const nameField = () => screen.getByRole('textbox', { name: /^Name/i }) as HTMLInputElement;
const storeName = () => useBuilderStore.getState().zones[0].name;

describe('zone Name in Properties', () => {
  it('is an editable text field showing the current name', () => {
    mount();
    expect(nameField().value).toBe('Headline');
  });
  it('commits on blur as ONE undo step, and Undo restores the old name', () => {
    mount();
    const before = useBuilderStore.getState().past.length;
    fireEvent.change(nameField(), { target: { value: 'Welcome banner' } });
    fireEvent.blur(nameField());
    expect(storeName()).toBe('Welcome banner');
    expect(useBuilderStore.getState().past.length).toBe(before + 1);
    useBuilderStore.getState().undo();
    expect(storeName()).toBe('Headline');
  });
  it('rejects a blank name (the layer keeps its label)', () => {
    mount();
    fireEvent.change(nameField(), { target: { value: '   ' } });
    fireEvent.blur(nameField());
    expect(storeName()).toBe('Headline');
    expect(nameField().value).toBe('Headline');
  });
  it('Escape reverts the typed text without committing', () => {
    mount();
    fireEvent.change(nameField(), { target: { value: 'Oops' } });
    fireEvent.keyDown(nameField(), { key: 'Escape' });
    fireEvent.blur(nameField());
    expect(storeName()).toBe('Headline');
  });
});
