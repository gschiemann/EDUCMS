/**
 * "Make it live" as the operator actually meets it (template-import Package D,
 * 2026-09-15).
 *
 * This mounts the REAL `<PropertiesPanel />` — the component `BuilderShell`
 * renders at line ~1388 for `panel === 'properties'` — against the real Zustand
 * store and the real `<AppDialogHost />`. Nothing here is stubbed except the
 * network, so a green run means the control is genuinely reachable from the
 * panel an operator has open, not merely that a component file compiles.
 *
 * MUTATION CHECK: delete the `<MakeItLive zone={zone} />` line from
 * PropertiesPanel's Zone card and every test in the first two blocks fails.
 *
 * The last block is the NEGATIVE CONTROL: things that must NOT happen —
 * cancelling must not touch the zone, the hint must not appear on a hand-built
 * template, and a swap must not move or resize anything.
 */
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { PropertiesPanel } from '../PropertiesPanel';
import { AppDialogHost } from '@/components/ui/app-dialog';
import { useBuilderStore } from '../useBuilderStore';
import { OPEN_WIDGET_LIBRARY_EVENT, liveHintDismissKey } from '../make-it-live';
import type { Zone } from '../types';

jest.mock('@/lib/api-client', () => ({
  ...jest.requireActual('@/lib/api-client'),
  apiFetch: jest.fn(() => new Promise(() => undefined)),
}));

const STALE = 'TODAY: TUESDAY';
const IMPORT_DESC = 'Imported from design upload on 2026-09-15';

function textZone(over: Partial<Zone> = {}): Zone {
  return {
    id: 'z1',
    name: STALE,
    widgetType: 'TEXT',
    x: 12, y: 34, width: 40, height: 20, zIndex: 3, sortOrder: 0,
    defaultConfig: { content: STALE, fontSize: 64, alignment: 'left' },
    ...over,
  } as Zone;
}

function mount({ description = '', zone = textZone() }: { description?: string; zone?: Zone } = {}) {
  useBuilderStore.getState().init({
    id: 'tpl-1',
    isSystem: false,
    zones: [zone],
    meta: {
      name: 'Imported deck — Page 1',
      description,
      screenWidth: 1920, screenHeight: 1080,
      bgColor: '', bgGradient: '', bgImage: '',
    },
    isTouchEnabled: false,
    idleResetMs: 60000,
    scenes: [],
  });
  useBuilderStore.setState({ selectedIds: [zone.id] });
  return render(<><PropertiesPanel /><AppDialogHost /></>);
}

const toggle = () => screen.getByRole('button', { name: /make it live/i });
const theZone = () => useBuilderStore.getState().zones[0];

beforeEach(() => {
  try { window.localStorage.clear(); } catch { /* jsdom always has it */ }
});

// ───────────────────────────────────────────────────────────────────────────
describe('the control is reachable from the panel the operator has open', () => {
  it('renders in Properties for a selected zone', () => {
    mount();
    expect(toggle()).toBeInTheDocument();
  });

  it('is a keyboard-operable disclosure, collapsed until asked', () => {
    mount();
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    const region = document.getElementById(toggle().getAttribute('aria-controls')!);
    expect(region).toBeTruthy();
    expect(region).toHaveAttribute('hidden');

    // Enter on a native <button> is a click — no custom key handling to get wrong.
    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(toggle().getAttribute('aria-controls')!)).not.toHaveAttribute('hidden');
  });

  it('puts the clock first for "TODAY: TUESDAY", and names why', () => {
    mount();
    fireEvent.click(toggle());
    const suggestions = screen.getByRole('list', { name: /suggested/i });
    const first = within(suggestions).getAllByRole('button')[0];
    expect(first).toHaveAccessibleName(/clock/i);
    expect(first).toHaveAccessibleDescription(/TODAY/);
  });

  it('still offers every live widget, so the suggestion is never the only route', () => {
    mount();
    fireEvent.click(toggle());
    for (const label of [/^Clock$/i, /lunch menu/i, /bell schedule/i, /countdown/i, /weather/i, /calendar/i]) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('offers the full 385-variant library as an escape hatch', async () => {
    mount();
    fireEvent.click(toggle());
    const heard: string[] = [];
    const onOpen = (e: Event) => heard.push((e as CustomEvent).detail?.zoneId);
    window.addEventListener(OPEN_WIDGET_LIBRARY_EVENT, onOpen);
    fireEvent.click(screen.getByRole('button', { name: /browse all widgets/i }));
    window.removeEventListener(OPEN_WIDGET_LIBRARY_EVENT, onOpen);
    // Carries the zone id so the widgets panel arms REPLACE for THIS zone
    // rather than adding a second widget on top of it.
    expect(heard).toEqual(['z1']);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('changing the widget is deliberate, and reversible', () => {
  async function makeItAClock() {
    fireEvent.click(toggle());
    fireEvent.click(screen.getByRole('button', { name: /^Clock$/i }));
    const dialog = await screen.findByRole('dialog');
    return dialog;
  }

  it('confirms first, naming the exact copy that is about to be discarded', async () => {
    mount();
    const dialog = await makeItAClock();
    expect(dialog).toHaveTextContent(STALE);
    expect(dialog).toHaveTextContent(/discarded/i);
    // The zone is untouched while the dialog is up.
    expect(theZone().widgetType).toBe('TEXT');
    // Resolve it before leaving: `app-dialog`'s queue is module-level state, so
    // a request abandoned here is the one the NEXT test's `notify()` shows.
    fireEvent.click(within(dialog).getByRole('button', { name: /keep it as it is/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('applies the swap on confirm, keeping geometry, layer and name', async () => {
    mount();
    const dialog = await makeItAClock();
    fireEvent.click(within(dialog).getByRole('button', { name: /make it a clock/i }));

    await waitFor(() => expect(theZone().widgetType).toBe('CLOCK'));
    const z = theZone();
    expect([z.x, z.y, z.width, z.height, z.zIndex]).toEqual([12, 34, 40, 20, 3]);
    expect(z.name).toBe(STALE);          // an operator-set name survives the swap
    expect(z.defaultConfig).not.toHaveProperty('content'); // the old config really is gone
  });

  it('is ONE undo step — Cmd/Ctrl+Z puts the old widget back intact', async () => {
    mount();
    const before = useBuilderStore.getState().past.length;
    const dialog = await makeItAClock();
    fireEvent.click(within(dialog).getByRole('button', { name: /make it a clock/i }));
    await waitFor(() => expect(theZone().widgetType).toBe('CLOCK'));
    expect(useBuilderStore.getState().past.length).toBe(before + 1);

    useBuilderStore.getState().undo();
    expect(theZone().widgetType).toBe('TEXT');
    expect((theZone().defaultConfig as Record<string, unknown>).content).toBe(STALE);
  });

  it('returns focus to the toggle after applying, never to document.body', async () => {
    mount();
    const dialog = await makeItAClock();
    fireEvent.click(within(dialog).getByRole('button', { name: /make it a clock/i }));
    await waitFor(() => expect(theZone().widgetType).toBe('CLOCK'));
    await waitFor(() => expect(document.activeElement).toBe(toggle()));
  });

  it('drops the type it already is from the list, so it cannot become itself', async () => {
    mount({ zone: textZone({ widgetType: 'CLOCK', defaultConfig: {} }) });
    fireEvent.click(toggle());
    expect(screen.queryByRole('button', { name: /^Clock$/i })).toBeNull();
    expect(screen.getByRole('button', { name: /weather/i })).toBeInTheDocument();
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('the import hint', () => {
  it('appears on an imported board and says what it noticed', () => {
    mount({ description: IMPORT_DESC });
    expect(screen.getByText(/came in from an import/i)).toBeInTheDocument();
  });

  it('is dismissible, and stays dismissed for the whole board', () => {
    const { unmount } = mount({ description: IMPORT_DESC });
    fireEvent.click(screen.getByRole('button', { name: /dismiss this tip/i }));
    expect(screen.queryByText(/came in from an import/i)).toBeNull();
    expect(window.localStorage.getItem(liveHintDismissKey('tpl-1'))).toBe('1');

    unmount();
    mount({ description: IMPORT_DESC });
    expect(screen.queryByText(/came in from an import/i)).toBeNull();
    // Dismissing the tip never removes the control itself.
    expect(toggle()).toBeInTheDocument();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// NEGATIVE CONTROL — what must NOT happen.
// ───────────────────────────────────────────────────────────────────────────
describe('negative control', () => {
  it('cancelling leaves the zone exactly as it was, and adds no history', async () => {
    mount();
    const before = useBuilderStore.getState().past.length;
    fireEvent.click(toggle());
    fireEvent.click(screen.getByRole('button', { name: /^Clock$/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /keep it as it is/i }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(theZone().widgetType).toBe('TEXT');
    expect((theZone().defaultConfig as Record<string, unknown>).content).toBe(STALE);
    expect(useBuilderStore.getState().past.length).toBe(before);
  });

  it('shows NO hint on a hand-built template, however stale the text looks', () => {
    mount({ description: 'Lobby welcome board' });
    expect(screen.queryByText(/came in from an import/i)).toBeNull();
    // …but the control is still there. The hint is discovery, not the feature.
    expect(toggle()).toBeInTheDocument();
  });

  it('shows NO hint on an imported board when it has nothing specific to point at', () => {
    mount({ description: IMPORT_DESC, zone: textZone({ name: 'Go Wildcats', defaultConfig: { content: 'Go Wildcats!' } }) });
    expect(screen.queryByText(/came in from an import/i)).toBeNull();
    expect(toggle()).toBeInTheDocument();
  });

  it('does not leave the disclosure armed when the selection moves to another zone', () => {
    const a = textZone();
    const b = textZone({ id: 'z2', name: 'Second', defaultConfig: { content: 'Second' } });
    useBuilderStore.getState().init({
      id: 'tpl-1', isSystem: false, zones: [a, b],
      meta: { name: 'T', description: '', screenWidth: 1920, screenHeight: 1080, bgColor: '', bgGradient: '', bgImage: '' },
      isTouchEnabled: false, idleResetMs: 60000, scenes: [],
    });
    useBuilderStore.setState({ selectedIds: ['z1'] });
    const { rerender } = render(<><PropertiesPanel /><AppDialogHost /></>);
    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');

    useBuilderStore.setState({ selectedIds: ['z2'] });
    rerender(<><PropertiesPanel /><AppDialogHost /></>);
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
  });
});
