/**
 * LINK 2 OF THE EMPTY-PANEL CHAIN (Phase 2, 2026-09-11) — mounted.
 *
 * The operator: *"when you click on widgets its blank."* Four things had to be
 * true at once for that, and only one of them lived in the widgets panel:
 *
 *   1. creating a template seeds ONE full-screen zone of widgetType `EMPTY`;
 *   2. `BuilderBottomBar` auto-selects a sole zone on load;
 *   3. ANY selection change flipped the panel to PROPERTIES  ← fixed here;
 *   4. the picker locked its type filter to the selection's widgetType, and
 *      zero variants are registered for `EMPTY`.
 *
 * So this mounts the REAL BuilderShell with the REAL VariantPicker and the
 * REAL store — the same "real store, stub the rest" pattern
 * BuilderShell.init-effect.test.tsx uses — and asserts what an operator sees
 * on arrival. Everything else here is stubbed precisely so the assertion is
 * about the panel decision and nothing else.
 */
import { render, screen, act } from '@testing-library/react';
import { BuilderShell } from '../BuilderShell';
import { useBuilderStore } from '../useBuilderStore';
import type { Template } from '../types';

beforeAll(() => {
  (globalThis as any).ResizeObserver =
    (globalThis as any).ResizeObserver ||
    class { observe() {} unobserve() {} disconnect() {} };
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

// NOTE: ../VariantPicker is deliberately NOT stubbed — it is the surface under
// test. Everything else is.
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

function makeTemplate(zones: any[]): Template {
  return {
    id: `tpl-${Math.random().toString(36).slice(2)}`,
    name: 'Untitled board',
    description: '',
    screenWidth: 1920,
    screenHeight: 1080,
    bgColor: '', bgGradient: '', bgImage: '',
    isSystem: false,
    zones,
    scenes: [],
    updatedAt: '2026-09-11T00:00:00.000Z',
  } as any;
}

/** Byte-for-byte the seed `templates/page.tsx` writes for "Start from blank". */
const BLANK_ZONES = [{
  id: 'zone-blank', name: 'Full Screen', widgetType: 'EMPTY',
  x: 0, y: 0, width: 100, height: 100, zIndex: 0, sortOrder: 0, defaultConfig: {},
}];

const noop = () => {};

function tabFor(label: string) {
  return screen.getByRole('tab', { name: new RegExp(label, 'i') });
}

describe('a brand-new template lands the operator on WIDGETS', () => {
  it('does not flip to Properties just because the seeded EMPTY placeholder got auto-selected', () => {
    render(<BuilderShell template={makeTemplate(BLANK_ZONES)} onBack={noop} onSaved={noop} />);

    // The auto-select still happens — it is what makes a click FILL the
    // placeholder — but it no longer hijacks the panel.
    expect(useBuilderStore.getState().selectedIds).toEqual(['zone-blank']);
    expect(tabFor('Widgets').getAttribute('aria-selected')).toBe('true');
    expect(tabFor('Properties').getAttribute('aria-selected')).toBe('false');
    expect(screen.queryByTestId('properties-panel')).toBeNull();
  });

  it('shows real, clickable widgets on arrival — the panel is not blank', () => {
    render(<BuilderShell template={makeTemplate(BLANK_ZONES)} onBack={noop} onSaved={noop} />);
    const widgets = screen.queryAllByRole('button', { name: /^Add .+ to your empty board$/ });
    expect(widgets.length).toBeGreaterThanOrEqual(8);
  });

  it('selecting a REAL widget still opens Properties — the old behaviour is intact', () => {
    render(<BuilderShell
      template={makeTemplate([
        { ...BLANK_ZONES[0] },
        { id: 'zone-text', name: 'Headline 2', widgetType: 'TEXT', x: 5, y: 5, width: 40, height: 20, zIndex: 1, sortOrder: 1, defaultConfig: {} },
      ])}
      onBack={noop}
      onSaved={noop}
    />);
    act(() => { useBuilderStore.getState().select('zone-text'); });
    expect(tabFor('Properties').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('properties-panel')).toBeTruthy();
  });
});
