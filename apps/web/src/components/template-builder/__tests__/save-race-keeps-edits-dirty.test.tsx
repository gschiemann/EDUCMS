/**
 * Codex T10 (2026-09-13) — an edit made WHILE a save is in flight must not be
 * declared saved. handleSave used to mark the store clean (and clear the local
 * draft) unconditionally when its two requests returned; an edit typed during
 * the latency was silently "saved" without ever reaching the server. Now the
 * save captures editRev, only cleans if nothing moved, keeps the draft, and
 * runs ONE follow-up save that carries the newer edit. The zones write is also
 * guarded by the updatedAt the metadata write returned.
 *
 * Mutation check: restore the unconditional markClean() and test 1 fails.
 */
import { render, act, fireEvent } from '@testing-library/react';
import { BuilderShell } from '../BuilderShell';
import { useBuilderStore } from '../useBuilderStore';
import type { Template } from '../types';

const metaMutate = jest.fn();
const zonesMutate = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn() }), useParams: () => ({ schoolId: 's1' }), usePathname: () => '/s1/templates/builder/tpl-1', useSearchParams: () => new URLSearchParams() }));
jest.mock('@/hooks/use-api', () => ({
  useUpdateTemplate: () => ({ mutateAsync: (...a: unknown[]) => metaMutate(...a) }),
  useUpdateTemplateZones: () => ({ mutateAsync: (...a: unknown[]) => zonesMutate(...a) }),
  useCreateTemplate: () => ({ mutateAsync: jest.fn() }),
  useDeleteTemplate: () => ({ mutateAsync: jest.fn() }),
  useTemplateVersions: () => ({ data: [], isLoading: false }),
  useRestoreTemplateVersion: () => ({ mutateAsync: jest.fn() }),
  useTemplate: () => ({ data: undefined, isLoading: false }),
}));
jest.mock('@/lib/put-on-screen', () => ({ usePutOnScreen: () => ({ putOnScreen: jest.fn(), puttingOnScreenId: null }) }));
jest.mock('@/lib/api-client', () => ({ apiFetch: jest.fn() }));
jest.mock('@/components/ui/app-dialog', () => ({ appConfirm: jest.fn(), appPrompt: jest.fn(), appAlert: jest.fn() }));
jest.mock('../BuilderToolbar', () => ({ BuilderToolbar: () => null }));
jest.mock('../BuilderCanvas', () => ({ BuilderCanvas: () => null }));
jest.mock('../CanvasContextMenu', () => ({ CanvasContextMenu: () => null }));
jest.mock('../VariantPicker', () => ({ VariantPicker: () => null }));
jest.mock('../../apps/AppLibraryPanel', () => ({ AppLibraryPanel: () => null }));
jest.mock('../LayersPanel', () => ({ LayersPanel: () => null }));
jest.mock('../ScenesPanel', () => ({ ScenesPanel: () => null }));
jest.mock('../PropertiesPanel', () => ({ PropertiesPanel: () => null, CanvasBackdropSection: () => null, AssetLibraryModal: () => null, measureZoneFontSize: () => 12 }));
jest.mock('../BrandKitPanel', () => ({ BrandKitPanel: () => null }));
jest.mock('../SuggestionsPanel', () => ({ SuggestionsPanel: () => null }));
jest.mock('../BackgroundPanel', () => ({ BackgroundPanel: () => null }));
jest.mock('../TemplatePreviewModal', () => ({ TemplatePreviewModal: () => null }));

function makeTemplate(): Template {
  return { id: 'tpl-1', name: 'Cafeteria Menu', description: '', screenWidth: 1920, screenHeight: 1080, bgColor: '', bgGradient: '', bgImage: '', isSystem: false,
    zones: [{ id: 'zone-1', name: 'Title', widgetType: 'TEXT', x: 0, y: 0, width: 50, height: 20, zIndex: 0, sortOrder: 0, defaultConfig: { text: 'Original' } } as unknown as Template['zones'][number]],
    scenes: [], updatedAt: '2026-09-13T00:00:00.000Z' };
}
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe('save while editing', () => {
  beforeEach(() => { metaMutate.mockReset(); zonesMutate.mockReset(); });

  it('an edit during the in-flight save keeps the template dirty and triggers ONE follow-up save carrying it', async () => {
    metaMutate.mockResolvedValue({ id: 'tpl-1', updatedAt: '2026-09-13T00:00:01.000Z' });
    let releaseFirst!: (v: unknown) => void; let releaseSecond!: (v: unknown) => void;
    zonesMutate
      .mockImplementationOnce(() => new Promise((res) => { releaseFirst = res; }))
      .mockImplementationOnce(() => new Promise((res) => { releaseSecond = res; }));
    render(<BuilderShell template={makeTemplate()} onBack={() => {}} onSaved={() => {}} />);
    act(() => { useBuilderStore.getState().updateZone('zone-1', { x: 5 }, true); });   // first edit → dirty
    expect(useBuilderStore.getState().isDirty).toBe(true);

    act(() => { fireEvent.keyDown(window, { key: 's', metaKey: true }); });               // save #1 starts
    await flush();
    expect(metaMutate).toHaveBeenCalledTimes(1);
    expect(zonesMutate).toHaveBeenCalledTimes(1);
    // the zones write is guarded by the updatedAt the metadata write just returned
    expect((zonesMutate.mock.calls[0][0] as { expectedUpdatedAt?: string }).expectedUpdatedAt).toBe('2026-09-13T00:00:01.000Z');

    act(() => { useBuilderStore.getState().updateZone('zone-1', { x: 9 }, true); });    // edit DURING the save
    await act(async () => { releaseFirst({ updatedAt: '2026-09-13T00:00:01.500Z' }); });
    await flush();

    expect(useBuilderStore.getState().isDirty).toBe(true);                               // save #1 did not lie
    expect(zonesMutate).toHaveBeenCalledTimes(2);                                        // the follow-up started
    const secondZones = (zonesMutate.mock.calls[1][0] as { zones: Array<{ x: number }> }).zones;
    expect(secondZones[0].x).toBe(9);                                                    // …carrying the newer edit
    await act(async () => { releaseSecond({ updatedAt: '2026-09-13T00:00:02.000Z' }); });
    await flush();
    expect(useBuilderStore.getState().isDirty).toBe(false);                              // the follow-up cleaned up
    expect(zonesMutate).toHaveBeenCalledTimes(2);                                        // and nothing more
  });

  it('a save with no concurrent edit cleans the template and sends no follow-up', async () => {
    metaMutate.mockResolvedValue({ id: 'tpl-1', updatedAt: '2026-09-13T00:00:01.000Z' });
    zonesMutate.mockResolvedValue({ updatedAt: '2026-09-13T00:00:01.500Z' });
    render(<BuilderShell template={makeTemplate()} onBack={() => {}} onSaved={() => {}} />);
    act(() => { useBuilderStore.getState().updateZone('zone-1', { x: 5 }, true); });
    act(() => { fireEvent.keyDown(window, { key: 's', metaKey: true }); });
    await flush(); await flush();
    expect(useBuilderStore.getState().isDirty).toBe(false);
    expect(zonesMutate).toHaveBeenCalledTimes(1);
  });
});
