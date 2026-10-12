/**
 * Owner 2026-10-12: "branding page is still useless, I can't do anything but
 * add a logo … Apply brand should only be available if they've done branding;
 * what does Apply branding actually do?"
 *
 * The Brand tab is ACTION-FIRST: every control does one visible thing whatever
 * is selected, toasts, and is one undo step.
 */
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { useBuilderStore } from '../useBuilderStore';
import type { Zone } from '../types';

const MOCK_KIT = {
  logoUrl: 'https://cdn.example/logo.png',
  palette: { primary: '#1d4ed8', accent: '#f59e0b', ink: '#0f172a', surface: '#f8fafc' },
  fontHeading: 'Oswald',
  fontBody: 'Lato',
  displayName: 'Test Brand',
};
let mockTemplateKit: unknown = MOCK_KIT;
let mockOrgBrand: unknown = null;

jest.mock('@/hooks/use-api', () => ({
  useTemplate: () => ({ data: { id: 't1', brandKit: mockTemplateKit }, isLoading: false }),
  useTenantBranding: () => ({ data: mockOrgBrand }),
  useAdoptTemplateBrandKit: () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false }),
  useClearTemplateBrandKit: () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false }),
}));
jest.mock('next/navigation', () => ({ useParams: () => ({ schoolId: 'school-1' }) }));
jest.mock('@/lib/api-client', () => ({ apiFetch: jest.fn() }));
jest.mock('@/components/ui/app-dialog', () => ({ appConfirm: jest.fn().mockResolvedValue(false), appAlert: jest.fn() }));
const mockToastSuccess = jest.fn();
const mockToast = jest.fn();
jest.mock('sonner', () => {
  const fn = Object.assign((...a: unknown[]) => mockToast(...a), { success: (...a: unknown[]) => mockToastSuccess(...a) });
  return { toast: fn };
});
jest.mock('../media-sizing', () => ({
  ...jest.requireActual('../media-sizing'),
  readMediaDimensions: jest.fn().mockResolvedValue({ width: 400, height: 200 }),
}));

import { BrandKitPanel } from '../BrandKitPanel';

const CANVAS = { width: 1920, height: 1080 };
const placeholder: Zone = { id: 'blank', name: 'Full Screen', widgetType: 'EMPTY', x: 0, y: 0, width: 100, height: 100, zIndex: 0, sortOrder: 0, defaultConfig: {} } as Zone;
const text = (id = 'txt'): Zone => ({ id, name: 'Text 1', widgetType: 'TEXT', x: 10, y: 10, width: 30, height: 10, zIndex: 1, sortOrder: 1, defaultConfig: { content: 'Hello' } } as Zone);
const clock: Zone = { id: 'clk', name: 'Clock', widgetType: 'CLOCK', x: 60, y: 10, width: 20, height: 10, zIndex: 1, sortOrder: 2, defaultConfig: {} } as Zone;
const board: Zone = { id: 'board', name: 'Board', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 0, sortOrder: 0, defaultConfig: { url: '/templates/signage/qsr/x.html' } } as Zone;

function init(zones: Zone[], selectedIds: string[] = []) {
  useBuilderStore.getState().init({
    id: 't1', isSystem: false, zones,
    meta: { name: 'T', description: '', screenWidth: CANVAS.width, screenHeight: CANVAS.height, bgColor: '#ffffff', bgGradient: '', bgImage: '' },
    isTouchEnabled: false, idleResetMs: 60000, scenes: [],
  } as never);
  useBuilderStore.setState({ selectedIds, previewMode: false });
}
const cfg = (z: Zone | undefined) => (z?.defaultConfig || {}) as Record<string, unknown>;
const zone = (id: string) => useBuilderStore.getState().zones.find((z) => z.id === id);

beforeEach(() => {
  mockToastSuccess.mockClear();
  mockToast.mockClear();
  mockTemplateKit = MOCK_KIT;
  mockOrgBrand = null;
});

describe('no brand set up', () => {
  it('shows ONLY the "Set up your brand" card — no Brand this template, no actions', () => {
    mockTemplateKit = null;
    init([text()]);
    render(<BrandKitPanel />);
    expect(screen.getByRole('heading', { name: 'Set up your brand' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open Brand & appearance' }).getAttribute('href')).toBe('/school-1/settings/branding');
    expect(screen.queryByRole('button', { name: 'Brand this template' })).toBeNull();
    expect(screen.queryByText('Backgrounds')).toBeNull();
  });

  it('an empty kit object (no logo, colour or font) counts as no brand', () => {
    mockTemplateKit = { palette: {}, logoUrl: null };
    init([]);
    render(<BrandKitPanel />);
    expect(screen.getByRole('heading', { name: 'Set up your brand' })).toBeTruthy();
  });

  it('falls back to the organisation brand when the template has none', () => {
    mockTemplateKit = null;
    mockOrgBrand = { ...MOCK_KIT, displayName: 'Org Brand' };
    init([]);
    render(<BrandKitPanel />);
    expect(screen.getByRole('button', { name: 'Brand this template' })).toBeTruthy();
    expect(screen.getByText("From your organization's brand.")).toBeTruthy();
    expect(screen.getByText('Org Brand')).toBeTruthy();
  });
});

describe('logo', () => {
  it('Add logo places it top-left at its own aspect, selected, one undo step', async () => {
    init([placeholder], ['blank']);
    render(<BrandKitPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Add logo' }));
    await waitFor(() => expect(useBuilderStore.getState().zones.some((z) => z.widgetType === 'LOGO')).toBe(true));
    const st = useBuilderStore.getState();
    const logo = st.zones.find((z) => z.widgetType === 'LOGO')!;
    expect(cfg(logo).assetUrl).toBe(MOCK_KIT.logoUrl);
    expect(logo.x).toBeLessThan(5);
    expect((logo.width * CANVAS.width) / (logo.height * CANVAS.height)).toBeCloseTo(2);
    expect(st.selectedIds).toEqual([logo.id]);
    act(() => st.undo());
    expect(useBuilderStore.getState().zones.some((z) => z.widgetType === 'LOGO')).toBe(false);
  });

  it('a placement chip MOVES the existing logo there (whatever is selected)', () => {
    const logo = { id: 'logo1', name: 'Logo', widgetType: 'LOGO', x: 2, y: 3, width: 10, height: 10, zIndex: 1, sortOrder: 0, defaultConfig: {} } as Zone;
    init([logo, text()], ['txt']);
    render(<BrandKitPanel />);
    const before = useBuilderStore.getState().past.length;
    fireEvent.click(screen.getByRole('button', { name: 'Bottom right' }));
    const moved = zone('logo1')!;
    expect(moved.x + moved.width).toBeGreaterThan(95);
    expect(moved.y + moved.height).toBeGreaterThan(95);
    expect(moved.width).toBe(10);
    expect(useBuilderStore.getState().past.length).toBe(before + 1);
    expect(screen.getByRole('button', { name: 'Bottom right' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('a placement chip with no logo on the canvas adds one there', async () => {
    init([]);
    render(<BrandKitPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Center' }));
    await waitFor(() => expect(useBuilderStore.getState().zones.some((z) => z.widgetType === 'LOGO')).toBe(true));
    const logo = useBuilderStore.getState().zones.find((z) => z.widgetType === 'LOGO')!;
    expect(logo.x + logo.width / 2).toBeCloseTo(50);
    expect(logo.y + logo.height / 2).toBeCloseTo(50);
  });
});

describe('backgrounds', () => {
  it('a tile sets the TEMPLATE background even with a widget selected', () => {
    init([text()], ['txt']);
    render(<BrandKitPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Background: Brand gradient' }));
    const st = useBuilderStore.getState();
    expect(st.meta.bgGradient).toContain('#1d4ed8');
    expect(st.meta.bgGradient).toContain('#f59e0b');
    expect(cfg(zone('txt')).bgColor).toBeUndefined();
    expect(mockToastSuccess).toHaveBeenCalledWith('Background set: Brand gradient.', expect.anything());
    fireEvent.click(screen.getByRole('button', { name: 'Background: Primary' }));
    expect(useBuilderStore.getState().meta).toMatchObject({ bgColor: '#1d4ed8', bgGradient: '' });
  });

  it('a full-canvas board gets the same background in one undo step', () => {
    init([board]);
    render(<BrandKitPanel />);
    const before = useBuilderStore.getState().past.length;
    fireEvent.click(screen.getByRole('button', { name: 'Background: Dark brand' }));
    const st = useBuilderStore.getState();
    expect((cfg(zone('board')).brand as Record<string, unknown>).background).toBe(st.meta.bgColor);
    expect(st.past.length).toBe(before + 1);
  });
});

describe('text', () => {
  it('a style tile ADDS a centred text box in the brand font, selected', () => {
    init([placeholder], ['blank']);
    render(<BrandKitPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Add Heading text box' }));
    const st = useBuilderStore.getState();
    const added = st.zones.find((z) => z.widgetType === 'TEXT')!;
    expect(cfg(added)).toMatchObject({ content: 'Your headline', fontFamily: 'Oswald', bold: true, color: '#1d4ed8' });
    expect(added.x + added.width / 2).toBeCloseTo(50);
    expect(st.selectedIds).toEqual([added.id]);
    expect(st.selectionSource).toBe('panel'); // stays on the Brand tab
  });

  it('the call to action is a pill in the brand primary', () => {
    init([]);
    render(<BrandKitPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Add Call to action text box' }));
    const added = useBuilderStore.getState().zones.find((z) => z.widgetType === 'TEXT')!;
    expect(cfg(added)).toMatchObject({ content: 'Learn more', bgColor: '#1d4ed8', borderRadius: 9999 });
  });

  it('text colour swatches are disabled until a text box is selected, then colour only it', () => {
    init([text('a'), text('b')]);
    const { rerender } = render(<BrandKitPanel />);
    const swatch = () => screen.getByRole('button', { name: 'Text color Accent #f59e0b' });
    expect((swatch() as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Select a text box first.')).toBeTruthy();
    act(() => useBuilderStore.setState({ selectedIds: ['a'] }));
    rerender(<BrandKitPanel />);
    expect((swatch() as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(swatch());
    expect(cfg(zone('a')).color).toBe('#f59e0b');
    expect(cfg(zone('b')).color).toBeUndefined();
  });

  it('Recolor all text gives every text box a readable brand colour in one step', () => {
    init([text('a'), text('b'), clock]);
    render(<BrandKitPanel />);
    const before = useBuilderStore.getState().past.length;
    fireEvent.click(screen.getByRole('button', { name: 'Recolor all text' }));
    expect(cfg(zone('a')).color).toBe('#0f172a');
    expect(cfg(zone('b')).color).toBe('#0f172a');
    expect(cfg(zone('clk')).color).toBeUndefined();
    expect(useBuilderStore.getState().past.length).toBe(before + 1);
  });
});

describe('selected non-text widget', () => {
  it('shows "Selected Clock: Background" and colours that widget', () => {
    init([clock, text()], ['clk']);
    render(<BrandKitPanel />);
    expect(screen.getByText('Selected Clock: Background')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clock background Primary #1d4ed8' }));
    expect(cfg(zone('clk')).bgColor).toBe('#1d4ed8');
  });

  it('is absent when nothing (or only text) is selected', () => {
    init([clock, text()], ['txt']);
    render(<BrandKitPanel />);
    expect(screen.queryByTestId('brand-selected-bg')).toBeNull();
  });
});

describe('Brand this template', () => {
  it('lists what it will do BEFORE the click', () => {
    init([]);
    render(<BrandKitPanel />);
    const list = screen.getByTestId('brand-checklist');
    expect(list.textContent).toContain('Your logo in the logo spots');
    expect(list.textContent).toContain('Headings and body text in Oswald + Lato');
    expect(list.textContent).toContain('Brand colors on text, tickers and countdowns');
    expect(list.textContent).toContain('A brand background');
  });

  it('applies, toasts what changed with an Undo, and Undo reverts it in one step', () => {
    init([text(), board]);
    render(<BrandKitPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Brand this template' }));
    const [message, opts] = mockToastSuccess.mock.calls[0];
    expect(String(message)).toMatch(/^Brand applied: /);
    expect(opts.action.label).toBe('Undo');
    expect(cfg(zone('txt')).fontFamily).toBe('Oswald');
    expect((cfg(zone('board')).imageOverrides as Record<string, unknown>)['brand.logo']).toBe(MOCK_KIT.logoUrl);
    act(() => opts.action.onClick());
    expect(cfg(zone('txt')).fontFamily).toBeUndefined();
    expect(cfg(zone('board')).brand).toBeUndefined();
    expect(useBuilderStore.getState().meta.bgGradient).toBe('');
  });
});
