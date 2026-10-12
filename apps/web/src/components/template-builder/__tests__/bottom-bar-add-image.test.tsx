/**
 * Owner 2026-10-12: the bottom bar's picture icon (tooltip "Canvas") opened a
 * "Canvas backdrop" modal rendered INSIDE the bar — whose translate makes it
 * the containing block for `position: fixed` — so it sat half off-screen.
 * The icon now ADDS AN IMAGE through the same media picker the Image tile
 * uses; backdrop editing lives in the Background tab only.
 *
 * Harness: the "real store, stub the rest" pattern of
 * BuilderShell.blank-opens-on-widgets.test.tsx.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { BuilderShell } from '../BuilderShell';
import { OPEN_MEDIA_PICKER_EVENT } from '../media-sizing';
import type { Template } from '../types';

beforeAll(() => {
  (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver =
    (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver ||
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
jest.mock('../BuilderToolbar', () => ({ BuilderToolbar: () => null }));
jest.mock('../BuilderCanvas', () => ({ BuilderCanvas: () => null }));
jest.mock('../CanvasContextMenu', () => ({ CanvasContextMenu: () => null }));
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

const template = (): Template => ({
  id: `tpl-${Math.random().toString(36).slice(2)}`,
  name: 'Untitled board',
  description: '',
  screenWidth: 1920,
  screenHeight: 1080,
  bgColor: '', bgGradient: '', bgImage: '',
  isSystem: false,
  zones: [{
    id: 'zone-blank', name: 'Full Screen', widgetType: 'EMPTY',
    x: 0, y: 0, width: 100, height: 100, zIndex: 0, sortOrder: 0, defaultConfig: {},
  }],
  scenes: [],
  updatedAt: '2026-10-12T00:00:00.000Z',
} as unknown as Template);

describe('bottom bar picture button', () => {
  it('opens the media picker for a NEW image — no backdrop modal', () => {
    const requests: unknown[] = [];
    const listen = (e: Event) => requests.push((e as CustomEvent).detail);
    window.addEventListener(OPEN_MEDIA_PICKER_EVENT, listen);
    try {
      render(<BuilderShell template={template()} onBack={() => {}} onSaved={() => {}} />);
      fireEvent.click(screen.getByRole('button', { name: /^Add an image$/ }));
      // No zoneId: the picked file becomes a NEW image zone (addMediaZone),
      // never a replacement of whatever happened to be selected.
      expect(requests).toEqual([{ kind: 'image' }]);
      expect(screen.queryByRole('dialog', { name: /canvas backdrop/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /^Canvas backdrop$/ })).toBeNull();
    } finally {
      window.removeEventListener(OPEN_MEDIA_PICKER_EVENT, listen);
    }
  });
});
