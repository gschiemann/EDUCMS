/**
 * Bug hunt (2026-07-03) — the builder's store-init effect used to depend
 * on the WHOLE `template` object ([template, init]). Every Save bumps
 * the row's `updatedAt`, so the invalidation-driven refetch that follows
 * a save resolves to a NEW `template` object reference a few hundred ms
 * later — which re-ran the effect and unconditionally reset
 * zones/meta/isDirty/past/future via init(), silently discarding
 * whatever the operator typed in that window AND wiping undo/redo. No
 * restore bar caught it because it isn't a conflict — it's a same-id
 * refetch, not another device's edit.
 *
 * Fix: key the effect on `template.id` instead of `template` (mirrors
 * the sibling draft-recovery effect a few lines below it, which was
 * already correctly keyed this way).
 *
 * This test mounts the REAL BuilderShell (not a copy of its effect
 * logic) against the REAL useBuilderStore singleton, with only its
 * heavy child panels / data hooks stubbed out — the same "real store,
 * stub the rest" pattern e3-put-on-screen.test.tsx uses.
 */
import { render, act } from '@testing-library/react';
import { BuilderShell } from '../BuilderShell';
import { useBuilderStore } from '../useBuilderStore';
import type { Template } from '../types';

// ---- next/navigation ----
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useParams: () => ({ schoolId: 'school-1' }),
}));

// ---- data hooks (never actually fired in this test — mount only) ----
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

// ---- heavy child panels: stub to keep this test scoped to the init
// effect / mount behavior, not their internals ----
jest.mock('../BuilderToolbar', () => ({ BuilderToolbar: () => null }));
jest.mock('../BuilderCanvas', () => ({ BuilderCanvas: () => null }));
jest.mock('../CanvasContextMenu', () => ({ CanvasContextMenu: () => null }));
jest.mock('../VariantPicker', () => ({ VariantPicker: () => null }));
jest.mock('../../apps/AppLibraryPanel', () => ({ AppLibraryPanel: () => null }));
jest.mock('../LayersPanel', () => ({ LayersPanel: () => null }));
jest.mock('../ScenesPanel', () => ({ ScenesPanel: () => null }));
jest.mock('../PropertiesPanel', () => ({
  PropertiesPanel: () => null,
  CanvasBackdropSection: () => null,
  AssetLibraryModal: () => null,
  measureZoneFontSize: () => 12,
}));
jest.mock('../BrandKitPanel', () => ({ BrandKitPanel: () => null }));
jest.mock('../SuggestionsPanel', () => ({ SuggestionsPanel: () => null }));
jest.mock('../BackgroundPanel', () => ({ BackgroundPanel: () => null }));
jest.mock('../TemplatePreviewModal', () => ({ TemplatePreviewModal: () => null }));

function makeTemplate(overrides: Partial<Template> = {}): Template {
  return {
    id: 'tpl-1',
    name: 'Cafeteria Menu',
    description: '',
    screenWidth: 1920,
    screenHeight: 1080,
    bgColor: '',
    bgGradient: '',
    bgImage: '',
    isSystem: false,
    zones: [
      {
        id: 'zone-1',
        name: 'Title',
        widgetType: 'TEXT',
        x: 0,
        y: 0,
        width: 50,
        height: 20,
        zIndex: 0,
        sortOrder: 0,
        defaultConfig: { text: 'Original' },
      } as any,
    ],
    scenes: [],
    updatedAt: '2026-07-03T00:00:00.000Z',
    ...overrides,
  };
}

const noop = () => {};

describe('BuilderShell store-init effect — dep array regression guard', () => {
  it('a same-id refetch (new `template` object reference, same id) does NOT reset a dirty store or clear undo/redo', () => {
    const t1 = makeTemplate();
    const { rerender } = render(
      <BuilderShell template={t1} onBack={noop} onSaved={noop} />,
    );

    // Simulate the operator editing after the initial load: dirty the
    // store and push a history entry the way a real zone edit would.
    act(() => {
      useBuilderStore.setState((s) => ({
        zones: s.zones.map((z) => ({ ...z, defaultConfig: { text: 'Edited by operator' } })),
        isDirty: true,
        past: [...s.past, { zones: s.zones, meta: s.meta }],
      }));
    });

    expect(useBuilderStore.getState().isDirty).toBe(true);
    expect(useBuilderStore.getState().past.length).toBeGreaterThan(0);
    expect(useBuilderStore.getState().zones[0].defaultConfig).toEqual({ text: 'Edited by operator' });

    // The post-save invalidation refetch: SAME id, but updatedAt bumped
    // and therefore a brand-new `template` object reference — exactly
    // what React Query hands back after `onSaved` invalidates the query.
    const t1Refetched = makeTemplate({ updatedAt: '2026-07-03T00:05:00.000Z' });
    expect(t1Refetched).not.toBe(t1); // distinct object reference, same id
    act(() => {
      rerender(<BuilderShell template={t1Refetched} onBack={noop} onSaved={noop} />);
    });

    // The bug: init() would have fired again here, wiping isDirty/past
    // and reverting zones to the server copy. The fix: same id → the
    // effect does not re-run → the operator's in-progress edit survives.
    expect(useBuilderStore.getState().isDirty).toBe(true);
    expect(useBuilderStore.getState().past.length).toBeGreaterThan(0);
    expect(useBuilderStore.getState().zones[0].defaultConfig).toEqual({ text: 'Edited by operator' });
  });

  it('switching to a DIFFERENT template (template.id changes) DOES re-init — clean zones, clean history, dirty cleared', () => {
    const t1 = makeTemplate({ id: 'tpl-1' });
    const { rerender } = render(
      <BuilderShell template={t1} onBack={noop} onSaved={noop} />,
    );

    act(() => {
      useBuilderStore.setState((s) => ({
        isDirty: true,
        past: [...s.past, { zones: s.zones, meta: s.meta }],
      }));
    });
    expect(useBuilderStore.getState().isDirty).toBe(true);

    const t2 = makeTemplate({
      id: 'tpl-2',
      name: 'Lobby Welcome',
      zones: [
        {
          id: 'zone-2',
          name: 'Headline',
          widgetType: 'TEXT',
          x: 0,
          y: 0,
          width: 50,
          height: 20,
          zIndex: 0,
          sortOrder: 0,
          defaultConfig: { text: 'Different template' },
        } as any,
      ],
    });
    act(() => {
      rerender(<BuilderShell template={t2} onBack={noop} onSaved={noop} />);
    });

    const state = useBuilderStore.getState();
    expect(state.templateId).toBe('tpl-2');
    expect(state.isDirty).toBe(false);
    expect(state.past).toEqual([]);
    expect(state.future).toEqual([]);
    expect(state.zones[0].defaultConfig).toEqual({ text: 'Different template' });
  });

  it('first mount initializes the store from the incoming template (baseline sanity check)', () => {
    const t1 = makeTemplate();
    render(<BuilderShell template={t1} onBack={noop} onSaved={noop} />);
    const state = useBuilderStore.getState();
    expect(state.templateId).toBe('tpl-1');
    expect(state.isDirty).toBe(false);
    expect(state.serverUpdatedAt).toBe('2026-07-03T00:00:00.000Z');
    expect(state.zones[0].defaultConfig).toEqual({ text: 'Original' });
  });
});
