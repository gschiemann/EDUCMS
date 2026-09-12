/**
 * M0-7 (2026-09-12) — the PERSISTENCE half of "Lock is a session-only
 * suggestion."
 *
 * `template_zones` had no `locked` column at all, so the flag lived only in
 * the Zustand store — and two lines guaranteed it could never escape:
 *
 *   BuilderShell's init effect mapped every server zone with a hardcoded
 *   `locked: false`, and the zones-save payload builder simply omitted the
 *   field. Because PUT /templates/:id/zones is a delete-all-and-recreate, an
 *   omitted field is an ERASED field. So the operator's lock survived exactly
 *   as long as the tab: reload, and it was gone.
 *
 * This mounts the REAL BuilderShell against the REAL store (the "real store,
 * stub the rest" pattern of BuilderShell.init-effect.test.tsx) and walks the
 * operator's actual acceptance path: lock a zone → Save → reload.
 */
import { render, act, fireEvent, waitFor } from '@testing-library/react';
import { BuilderShell } from '../BuilderShell';
import { useBuilderStore } from '../useBuilderStore';
import type { Template, Zone } from '../types';

const updateTemplateMock = jest.fn().mockResolvedValue({ id: 'tpl-1', updatedAt: '2026-09-12T00:01:00.000Z' });
const updateZonesMock = jest.fn().mockResolvedValue({ id: 'tpl-1', updatedAt: '2026-09-12T00:01:00.000Z' });

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useParams: () => ({ schoolId: 'school-1' }),
}));

jest.mock('@/hooks/use-api', () => ({
  useUpdateTemplate: () => ({ mutateAsync: updateTemplateMock }),
  useUpdateTemplateZones: () => ({ mutateAsync: updateZonesMock }),
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

function makeTemplate(zoneOverrides: Record<string, unknown> = {}, overrides: Partial<Template> = {}): Template {
  return {
    id: 'tpl-1',
    name: 'Lobby Board',
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
        name: 'Sponsor strip',
        widgetType: 'IMAGE',
        x: 0, y: 80, width: 100, height: 20,
        zIndex: 0,
        sortOrder: 0,
        defaultConfig: {},
        ...zoneOverrides,
      } as unknown as Zone,
    ],
    scenes: [],
    updatedAt: '2026-09-12T00:00:00.000Z',
    ...overrides,
  };
}

const noop = () => {};

beforeEach(() => {
  updateTemplateMock.mockClear();
  updateZonesMock.mockClear();
});

describe('M0-7 — the lock round-trips through load → Save → reload', () => {
  it('init ADOPTS a locked zone from the server instead of hardcoding false', () => {
    render(<BuilderShell template={makeTemplate({ locked: true })} onBack={noop} onSaved={noop} />);

    expect(useBuilderStore.getState().zones[0].locked).toBe(true);
  });

  it('a zone the server reports as unlocked stays unlocked (and a pre-column row with no field reads as unlocked)', () => {
    const { unmount } = render(<BuilderShell template={makeTemplate({ locked: false })} onBack={noop} onSaved={noop} />);
    expect(useBuilderStore.getState().zones[0].locked).toBe(false);
    unmount();

    // A row written before the column existed sends no `locked` at all.
    render(<BuilderShell template={makeTemplate({})} onBack={noop} onSaved={noop} />);
    expect(useBuilderStore.getState().zones[0].locked).toBe(false);
  });

  it('THE ACCEPTANCE PATH: lock a zone, Save, and the zones PUT carries locked:true', async () => {
    render(<BuilderShell template={makeTemplate({ locked: false })} onBack={noop} onSaved={noop} />);

    act(() => { useBuilderStore.getState().toggleLock('zone-1'); });
    expect(useBuilderStore.getState().zones[0].locked).toBe(true);

    // Cmd-S is the same handleSave the toolbar's Save button fires.
    await act(async () => { fireEvent.keyDown(window, { key: 's', metaKey: true }); });

    await waitFor(() => expect(updateZonesMock).toHaveBeenCalledTimes(1));
    const body = updateZonesMock.mock.calls[0][0];
    expect(body.zones).toHaveLength(1);
    // Pre-fix this key was absent entirely — and because the endpoint is a
    // delete-all-and-recreate, absent means erased.
    expect(body.zones[0]).toHaveProperty('locked', true);
  });

  it('an unlocked zone saves locked:false EXPLICITLY (never undefined — the replace-all would read that as erased)', async () => {
    render(<BuilderShell template={makeTemplate({ locked: false })} onBack={noop} onSaved={noop} />);

    act(() => { useBuilderStore.getState().updateZone('zone-1', { x: 5 }, true); }); // dirty it

    await act(async () => { fireEvent.keyDown(window, { key: 's', metaKey: true }); });

    await waitFor(() => expect(updateZonesMock).toHaveBeenCalledTimes(1));
    expect(updateZonesMock.mock.calls[0][0].zones[0].locked).toBe(false);
  });

  it('RELOAD: re-mounting on the template the server now returns keeps the lock, and select-all + Delete cannot remove it', async () => {
    const { unmount } = render(<BuilderShell template={makeTemplate({ locked: false })} onBack={noop} onSaved={noop} />);
    act(() => { useBuilderStore.getState().toggleLock('zone-1'); });
    await act(async () => { fireEvent.keyDown(window, { key: 's', metaKey: true }); });
    await waitFor(() => expect(updateZonesMock).toHaveBeenCalledTimes(1));
    unmount();

    // What GET /templates/:id hands back after that save — the API echoes the
    // column straight through mapTemplate's `...z` spread.
    const savedZone = updateZonesMock.mock.calls[0][0].zones[0];
    render(
      <BuilderShell
        template={makeTemplate({ locked: savedZone.locked }, { id: 'tpl-1' })}
        onBack={noop}
        onSaved={noop}
      />,
    );

    expect(useBuilderStore.getState().zones[0].locked).toBe(true);

    act(() => {
      useBuilderStore.setState({ selectedIds: useBuilderStore.getState().zones.map((z) => z.id) });
    });
    act(() => { useBuilderStore.getState().removeSelected(); });

    expect(useBuilderStore.getState().zones.map((z) => z.id)).toEqual(['zone-1']);
  });
});
