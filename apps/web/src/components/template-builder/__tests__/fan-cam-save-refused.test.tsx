/**
 * K-12 sports launch, lane B3, leftover (b) — when the API refuses a save
 * because a Fan Cam asks for a kiss where students are on screen (a title
 * typed straight onto the canvas skips the panel's own check), the builder
 * says so in the operator's language and names what to change — not the raw
 * server sentence. Mounts the REAL BuilderShell against the REAL store (the
 * m0-7-zone-lock-persistence harness).
 */
import { render, act, fireEvent, waitFor, screen } from '@testing-library/react';
import { BuilderShell } from '../BuilderShell';
import { useBuilderStore } from '../useBuilderStore';
import type { Template, Zone } from '../types';

const updateTemplateMock = jest.fn().mockResolvedValue({ id: 'tpl-1', updatedAt: '2026-09-27T00:01:00.000Z' });
const updateZonesMock = jest.fn();

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

// The toolbar is where the operator reads a failed save.
jest.mock('../BuilderToolbar', () => ({
  BuilderToolbar: ({ saveStatus, saveError }: { saveStatus: string; saveError?: string }) => (
    <div data-testid="save-chip" data-status={saveStatus}>
      {saveError}
    </div>
  ),
}));
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

function makeTemplate(): Template {
  return {
    id: 'tpl-1',
    name: 'Gym Board',
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
        name: 'Fan Cam',
        widgetType: 'SCOREBOARD',
        x: 0, y: 0, width: 50, height: 50,
        zIndex: 0,
        sortOrder: 0,
        defaultConfig: { variant: 'kiss-cam', kind: 'FAN CAM' },
      } as unknown as Zone,
    ],
    scenes: [],
    updatedAt: '2026-09-27T00:00:00.000Z',
  };
}

/** What apiFetch throws for a 4xx: message + code + the parsed body. */
function apiError(code: string, message: string, body: Record<string, unknown>) {
  return Object.assign(new Error(message), { status: 400, code, body: { code, message, ...body } });
}

beforeEach(() => {
  updateTemplateMock.mockClear();
  updateZonesMock.mockReset();
});

async function saveTypedTitle(title: string) {
  render(<BuilderShell template={makeTemplate()} onBack={() => {}} onSaved={() => {}} />);
  // A title typed straight onto the canvas (click-to-edit) never passes
  // through the panel's own check.
  act(() => {
    useBuilderStore.getState().updateZone('zone-1', { defaultConfig: { variant: 'kiss-cam', kind: title } }, true);
  });
  await act(async () => {
    fireEvent.keyDown(window, { key: 's', metaKey: true });
  });
  await waitFor(() => expect(updateZonesMock).toHaveBeenCalledTimes(1));
}

it('a refused Fan Cam save says what to change, in the catalog wording', async () => {
  updateZonesMock.mockRejectedValue(
    apiError('FAN_CAM_TITLE_NOT_SCHOOL_SAFE', 'A Fan Cam that says "KISS CAM" isn\'t available…', { titles: ['KISS CAM'] }),
  );
  await saveTypedTitle('KISS CAM');
  await waitFor(() => expect(screen.getByTestId('save-chip')).toHaveAttribute('data-status', 'error'));
  expect(screen.getByTestId('save-chip')).toHaveTextContent(
    'Not saved: a Fan Cam that says “KISS CAM” isn’t available when students are on screen. Change it in the Fan Cam’s settings, then save again.',
  );
});

it('any other refusal keeps the server’s own message', async () => {
  updateZonesMock.mockRejectedValue(apiError('TEMPLATE_ZONE_URL_REJECTED', 'That link cannot be embedded.', {}));
  await saveTypedTitle('SPIRIT CAM');
  await waitFor(() => expect(screen.getByTestId('save-chip')).toHaveTextContent('That link cannot be embedded.'));
});
