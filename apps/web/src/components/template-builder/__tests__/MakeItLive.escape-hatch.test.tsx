/**
 * "Browse all widgets instead" really reaches the full library, armed to
 * REPLACE (template-import Package D, 2026-09-15).
 *
 * The curated six live widgets must never be the only route to a type change,
 * and the hand-off has a trap in it: `VariantPicker` only exists while
 * `panel === 'widgets'`, so it is NOT MOUNTED when the request is made and a
 * listener inside it could never hear the event that is about to mount it. The
 * zone id therefore rides as a prop from `BuilderShell`. This mounts the REAL
 * `BuilderShell` with the REAL `VariantPicker` — the same "real store, stub the
 * rest" pattern as `BuilderShell.blank-opens-on-widgets.test.tsx` — so a green
 * run proves the wiring, not the intent.
 *
 * The second block is the NEGATIVE CONTROL: REPLACE must stay OFF everywhere
 * the operator did not explicitly ask for it. Arming it by accident is a silent
 * destructive swap, which is the exact behaviour the 2026-09-11 ADD/REPLACE
 * split removed.
 */
import { render, screen, act, within } from '@testing-library/react';
import { BuilderShell } from '../BuilderShell';
import { openWidgetLibrary } from '../make-it-live';
import { useBuilderStore } from '../useBuilderStore';
import type { Template } from '../types';

beforeAll(() => {
  const g = globalThis as { ResizeObserver?: unknown };
  g.ResizeObserver = g.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };
});

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useParams: () => ({ schoolId: 'school-1' }),
}));
jest.mock('@/hooks/use-api', () => ({
  useUpdateTemplate: () => ({ mutateAsync: jest.fn() }),
  useUpdateTemplateZones: () => ({ mutateAsync: jest.fn() }),
  useCreateTemplate: () => ({ mutateAsync: jest.fn() }),
  useDeleteTemplate: () => ({ mutateAsync: jest.fn() }),
  useTemplateVersions: () => ({ data: undefined, isLoading: false }),
  useRestoreTemplateVersion: () => ({ mutateAsync: jest.fn() }),
}));
jest.mock('@/lib/put-on-screen', () => ({
  usePutOnScreen: () => ({ putOnScreen: jest.fn(), puttingOnScreenId: null }),
}));
jest.mock('@/lib/api-client', () => ({ apiFetch: jest.fn() }));
jest.mock('@/components/ui/app-dialog', () => ({ appConfirm: jest.fn(), appPrompt: jest.fn() }));

// ../VariantPicker is deliberately NOT stubbed — it is half the surface here.
jest.mock('../BuilderToolbar', () => ({ BuilderToolbar: () => null }));
jest.mock('../BuilderCanvas', () => ({ BuilderCanvas: () => null }));
jest.mock('../CanvasContextMenu', () => ({ CanvasContextMenu: () => null }));
jest.mock('../../apps/AppLibraryPanel', () => ({ AppLibraryPanel: () => null }));
jest.mock('../LayersPanel', () => ({ LayersPanel: () => null }));
jest.mock('../ScenesPanel', () => ({ ScenesPanel: () => null }));
jest.mock('../PropertiesPanel', () => ({
  PropertiesPanel: () => <div data-testid="properties-panel" />,
  CanvasBackdropSection: () => null,
  AssetLibraryModal: () => null,
  measureZoneFontSize: () => 12,
}));
jest.mock('../BrandKitPanel', () => ({ BrandKitPanel: () => null }));
jest.mock('../SuggestionsPanel', () => ({ SuggestionsPanel: () => null }));
jest.mock('../BackgroundPanel', () => ({ BackgroundPanel: () => null }));
jest.mock('../TemplatePreviewModal', () => ({ TemplatePreviewModal: () => null }));

const ZONES = [{
  id: 'z1', name: 'TODAY: TUESDAY', widgetType: 'TEXT',
  x: 10, y: 10, width: 40, height: 20, zIndex: 1, sortOrder: 0,
  defaultConfig: { content: 'TODAY: TUESDAY' },
}];

function makeTemplate(): Template {
  const t: Template = {
    id: 'tpl-import-1',
    name: 'Imported deck — Page 1',
    description: 'Imported from design upload on 2026-09-15',
    screenWidth: 1920, screenHeight: 1080,
    bgColor: '', bgGradient: '', bgImage: '',
    isSystem: false,
    zones: ZONES,
    scenes: [],
    updatedAt: '2026-09-15T00:00:00.000Z',
  };
  return t;
}

const noop = () => {};
const tab = (label: string) => screen.getByRole('tab', { name: new RegExp(label, 'i') });
/**
 * The picker's ADD-vs-REPLACE group. Present only when a real zone is selected.
 * Scoped queries throughout: every TILE also carries a "Replace “<zone>” with
 * <variant>" label, so an unscoped `/^Replace/` matches hundreds of elements.
 */
const modeGroup = () => screen.getByRole('group', { name: /what happens when you click a widget/i });
const replaceBtn = () => within(modeGroup()).getByRole('button', { name: /^Replace/i });
const addBtn = () => within(modeGroup()).getByRole('button', { name: /add to board/i });

function mountBuilder() {
  const r = render(<BuilderShell template={makeTemplate()} onBack={noop} onSaved={noop} />);
  act(() => { useBuilderStore.setState({ selectedIds: ['z1'] }); });
  return r;
}

describe('the escape hatch reaches the full library, armed to replace', () => {
  it('switches to the WIDGETS panel and pre-arms REPLACE for the named zone', () => {
    mountBuilder();
    // Selecting a real widget flips the shell to Properties, as it always has.
    expect(tab('properties')).toHaveAttribute('aria-selected', 'true');

    act(() => { openWidgetLibrary('z1'); });

    expect(tab('widgets')).toHaveAttribute('aria-selected', 'true');
    expect(modeGroup()).toBeTruthy();
    expect(replaceBtn()).toHaveAttribute('aria-pressed', 'true');
    // The label names the zone, so the operator can see what is about to change.
    expect(replaceBtn()).toHaveAccessibleName(/TODAY: TUESDAY/);
  });

  it('drops the pre-arm on the way out, so coming back by hand is plain ADD', () => {
    mountBuilder();
    act(() => { openWidgetLibrary('z1'); });
    expect(replaceBtn()).toHaveAttribute('aria-pressed', 'true');

    act(() => { tab('properties').click(); });
    act(() => { tab('widgets').click(); });
    expect(replaceBtn()).toHaveAttribute('aria-pressed', 'false');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// NEGATIVE CONTROL — REPLACE must never arm itself.
// ───────────────────────────────────────────────────────────────────────────
describe('negative control', () => {
  it('opening WIDGETS by hand leaves ADD selected', () => {
    mountBuilder();
    act(() => { tab('widgets').click(); });
    expect(replaceBtn()).toHaveAttribute('aria-pressed', 'false');
    expect(addBtn()).toHaveAttribute('aria-pressed', 'true');
  });

  it('a request naming a DIFFERENT zone does not arm replace for this one', () => {
    mountBuilder();
    act(() => { openWidgetLibrary('some-other-zone'); });
    // The panel still switches — the operator asked for the library — but the
    // mode stays ADD, because the request was not about the zone in hand.
    expect(tab('widgets')).toHaveAttribute('aria-selected', 'true');
    expect(replaceBtn()).toHaveAttribute('aria-pressed', 'false');
  });
});
