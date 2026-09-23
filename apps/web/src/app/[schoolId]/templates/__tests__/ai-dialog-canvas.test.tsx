/**
 * The AI generate dialog's BOARD SIZE control (2026-09-22).
 *
 * Greg: "so many options that its confusing in this dialog, why a drop down
 * with LED poster? just give standard portrait/landscape at 4k and then a
 * custom button if needed". So: three choices — 4K UHD Landscape, 4K UHD
 * Portrait, Custom (two typed numbers) — and NO "Match a screen…" dropdown,
 * NO Square. The fleet's real size still seeds the default, by orientation.
 */
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { inertDesignerJobHooks } from './designer-job-hooks.mock';

// ── The data layer, staged ────────────────────────────────────────────
let templatesResult: any = { data: [], isLoading: false, isError: false, refetch: jest.fn() };
let usageResult: any = { data: undefined };

const noopMutation = () => ({ mutateAsync: jest.fn(), isPending: false, mutate: jest.fn() });

jest.mock('@/hooks/use-api', () => ({
  useTemplates: () => templatesResult,
  useTemplateUsageSummary: () => usageResult,
  useTenantBranding: () => ({ data: null }),
  useCreateTemplate: noopMutation,
  useDeleteTemplate: noopMutation,
  useCreateFromPreset: noopMutation,
  useDuplicateTemplate: noopMutation,
  useUpdateTemplate: noopMutation,
  useUpdateTemplateZones: noopMutation,
  useApplyBrandToTemplates: noopMutation,
  useGenerateTouchTemplate: noopMutation,
  useExportTemplate: noopMutation,
  useImportTemplate: noopMutation,
  useGenerateTouchCandidates: noopMutation,
  useCreateFromCandidate: noopMutation,
  useRefineSignageBoard: noopMutation,
  // 2026-09-23 — the Designer generates through a background job (not exercised here).
  ...inertDesignerJobHooks,
  useCreateDesigner: noopMutation,
  useRegenerateBoardImage: noopMutation,
  useAssets: () => ({ data: [], isLoading: false }),
  usePlaylists: () => ({ data: [], isLoading: false }),
  useAssetFolders: () => ({ data: [], isLoading: false }),
  useScreens: () => ({ data: [], isLoading: false }),
}));

jest.mock('@/hooks/use-ai-designer', () => ({
  useExtractDesignerBrief: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useRefineDesignerBoard: () => ({ mutateAsync: jest.fn(), isPending: false }),
  buildDesignerBriefPayload: () => ({}),
  designerBriefHasSignal: () => false,
}));

jest.mock('@/lib/put-on-screen', () => ({
  usePutOnScreen: () => ({ putOnScreen: jest.fn(), puttingOnScreenId: null }),
}));

const push = jest.fn();
jest.mock('next/navigation', () => ({
  useParams: () => ({ schoolId: 'planet-fitness' }),
  useRouter: () => ({ push, replace: jest.fn(), refresh: jest.fn() }),
}));

// GYM vertical (the mock's tenant context) — the gallery must never
// speak school vocabulary to it (§2, §3).
jest.mock('@/hooks/use-tenant-copy', () => ({
  useTenantCopy: () => ({
    vertical: 'GYM',
    orgSingular: 'Location',
    orgPlural: 'Locations',
    templateCategories: [
      { key: '', label: 'All' },
      { key: 'LOBBY', label: 'Welcome' },
      { key: 'PROMOTIONS', label: 'Promotions' },
      { key: 'CAFETERIA', label: 'Menus' },
    ],
    showSchoolLevelFilter: false,
    roleLabel: (r: string) => r,
  }),
}));

let mockRole = 'SCHOOL_ADMIN';
jest.mock('@/store/ui-store', () => ({
  useUIStore: (sel: any) => sel({ user: { role: mockRole }, token: 't' }),
}));

jest.mock('@/hooks/use-overlay-lock', () => ({ useOverlayLock: () => {} }));
jest.mock('@/lib/feature-flags', () => ({ isFeatureEnabled: () => true, FLAGS: { TEMPLATE_BUILDER_V2: 'v2' } }));
jest.mock('@/components/ai/AiGenerateButton', () => ({ getAiStatusSource: async () => 'platform' }));
jest.mock('@/components/templates/AiIntakeWizard', () => ({
  AiIntakeWizard: ({ typeToggle }: { typeToggle?: React.ReactNode }) => <div data-testid="wizard-stub">{typeToggle}</div>,
}));
// The size picker is BUILT by the page and handed to the concierge as a prop,
// so the stub renders exactly that prop and nothing else.
jest.mock('@/components/templates/SignageConcierge', () => ({
  SignageConcierge: ({ screenPicker, typeToggle }: { screenPicker?: React.ReactNode; typeToggle?: React.ReactNode }) => (
    <div data-testid="concierge-stub">{typeToggle}{screenPicker}</div>
  ),
}));
jest.mock('@/components/templates/BriefConfirmStrip', () => ({ BriefConfirmStrip: () => null }));

class FakeResizeObserver { observe() {} unobserve() {} disconnect() {} }
(global as unknown as { ResizeObserver: unknown }).ResizeObserver =
  (global as unknown as { ResizeObserver?: unknown }).ResizeObserver ?? FakeResizeObserver;

import TemplatesPage, { aiCanvasForFleetSize } from '../page';

beforeEach(() => {
  templatesResult = { data: [], isLoading: false, isError: false, refetch: jest.fn() };
  usageResult = { data: undefined };
  mockRole = 'SCHOOL_ADMIN';
});

async function openAiDialog() {
  render(<TemplatesPage />);
  fireEvent.click(screen.getAllByRole('button', { name: /generate .*ai|with ai/i })[0]);
  await screen.findByText('Generate a template with AI');
  return within(screen.getByTestId('concierge-stub'));
}

describe('the fleet seeds ORIENTATION, the standard seeds the pixels', () => {
  it('an ordinary 16:9 fleet lands on 4K UHD landscape, not on its own 1080p', () => {
    expect(aiCanvasForFleetSize(1920, 1080)).toEqual({ canvas: { w: 3840, h: 2160 }, custom: false });
    expect(aiCanvasForFleetSize(3840, 2160)).toEqual({ canvas: { w: 3840, h: 2160 }, custom: false });
  });
  it('a 9:16 fleet lands on 4K UHD portrait', () => {
    expect(aiCanvasForFleetSize(1080, 1920)).toEqual({ canvas: { w: 2160, h: 3840 }, custom: false });
  });
  it('an LED poster / banner / square fleet keeps its EXACT size as a Custom canvas (the CC-1 clipping fix)', () => {
    expect(aiCanvasForFleetSize(960, 1080)).toEqual({ canvas: { w: 960, h: 1080 }, custom: true });
    expect(aiCanvasForFleetSize(2500, 500)).toEqual({ canvas: { w: 2500, h: 500 }, custom: true });
    expect(aiCanvasForFleetSize(1080, 1080)).toEqual({ canvas: { w: 1080, h: 1080 }, custom: true });
  });
});

describe('the dialog offers three sizes and no menu', () => {
  it('Landscape · Portrait · Custom — no "Match a screen" dropdown, no Square', async () => {
    const c = await openAiDialog();
    const group = c.getByRole('group', { name: 'Board size' });
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['Landscape', 'Portrait', 'Custom']);
    expect(c.queryByLabelText('Match a screen size')).not.toBeInTheDocument();
    expect(c.queryByRole('combobox')).not.toBeInTheDocument();
    expect(c.getByText('4K UHD · 3840×2160')).toBeInTheDocument();
  });

  it('Portrait is 4K UHD too, and the readout says so', async () => {
    const c = await openAiDialog();
    fireEvent.click(c.getByRole('button', { name: 'Portrait' }));
    expect(c.getByText('4K UHD · 2160×3840')).toBeInTheDocument();
    expect(c.getByRole('button', { name: 'Portrait' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('Custom reveals two typed numbers prefilled with the current size; a standard pick hides them again', async () => {
    const c = await openAiDialog();
    fireEvent.click(c.getByRole('button', { name: 'Custom' }));
    const w = c.getByLabelText('Width in pixels') as HTMLInputElement;
    const h = c.getByLabelText('Height in pixels') as HTMLInputElement;
    expect(w.value).toBe('3840');
    expect(h.value).toBe('2160');
    // A half-typed value is never snapped back mid-keystroke…
    fireEvent.change(w, { target: { value: '9' } });
    expect(w.value).toBe('9');
    // …and a real one is committed.
    fireEvent.change(w, { target: { value: '960' } });
    fireEvent.change(h, { target: { value: '1080' } });
    expect(c.getByRole('button', { name: 'Custom' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(c.getByRole('button', { name: 'Landscape' }));
    expect(c.queryByLabelText('Width in pixels')).not.toBeInTheDocument();
    expect(c.getByText('4K UHD · 3840×2160')).toBeInTheDocument();
  });
});

describe('the Type row (2026-09-22 — "dont default to touch kiosk")', () => {
  it('in the chat: Display is pressed by default, Touch is there, and the two engine toggles are NOT', async () => {
    const c = await openAiDialog();
    const row = c.getByRole('group', { name: 'Board type' });
    expect(within(row).getAllByRole('button').map((b) => b.textContent)).toEqual(['Display (no touch)', 'Touch (interactive)']);
    expect(within(row).getByRole('button', { name: 'Display (no touch)' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(row).getByRole('button', { name: 'Touch (interactive)' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('in the guided form: all four are offered, Display still first and pressed', async () => {
    await openAiDialog();
    fireEvent.click(screen.getByRole('button', { name: /use the guided form instead/i }));
    const row = within(screen.getByTestId('wizard-stub')).getByRole('group', { name: 'Board type' });
    expect(within(row).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Display (no touch)', 'Touch (interactive)', '✨ Build a set', '✨ Designer (HTML)',
    ]);
    expect(within(row).getByRole('button', { name: 'Display (no touch)' })).toHaveAttribute('aria-pressed', 'true');
  });
});
