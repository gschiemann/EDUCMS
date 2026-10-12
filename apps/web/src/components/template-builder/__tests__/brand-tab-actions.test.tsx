/**
 * Owner 2026-10-12: "picking colors and fonts I don't see anything happen".
 * Every Brand-tab action must change the canvas visibly:
 *   - logo  → a LOGO zone in the TOP-LEFT corner at the logo's own aspect,
 *             selected; an existing LOGO zone gets its image swapped instead
 *   - font  → nothing selected: ADDS a text box in that font, selected;
 *             widget selected: applies the font + "Font applied" toast
 *   - color → nothing selected: a menu (background / gradient / all text);
 *             widget selected: text colour, or background via a VISIBLE toggle
 *   - Apply brand across template → a toast naming what changed
 */
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { useBuilderStore } from '../useBuilderStore';
import type { Zone } from '../types';

const MOCK_KIT = {
  logoUrl: 'https://cdn.example/logo.png',
  palette: { primary: '#112233', accent: '#445566', ink: '#0f172a', surface: '#f8fafc' },
  fontHeading: 'Oswald',
  fontBody: 'Lato',
  displayName: 'Test Brand',
};

jest.mock('@/hooks/use-api', () => ({
  useTemplate: () => ({ data: { id: 't1', brandKit: MOCK_KIT }, isLoading: false }),
  useAdoptTemplateBrandKit: () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false }),
  useClearTemplateBrandKit: () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false }),
}));
jest.mock('@/lib/api-client', () => ({ apiFetch: jest.fn() }));
jest.mock('@/components/ui/app-dialog', () => ({ appConfirm: jest.fn().mockResolvedValue(false), appAlert: jest.fn() }));
const mockToastSuccess = jest.fn();
jest.mock('sonner', () => {
  const fn = Object.assign(jest.fn(), { success: (...a: unknown[]) => mockToastSuccess(...a) });
  return { toast: fn };
});
// A wide 2:1 wordmark.
jest.mock('../media-sizing', () => ({
  ...jest.requireActual('../media-sizing'),
  readMediaDimensions: jest.fn().mockResolvedValue({ width: 400, height: 200 }),
}));

import { BrandKitPanel } from '../BrandKitPanel';

const CANVAS = { width: 1920, height: 1080 };
const placeholder: Zone = { id: 'blank', name: 'Full Screen', widgetType: 'EMPTY', x: 0, y: 0, width: 100, height: 100, zIndex: 0, sortOrder: 0, defaultConfig: {} } as Zone;
const text = (id = 'txt'): Zone => ({ id, name: 'Text 1', widgetType: 'TEXT', x: 10, y: 10, width: 30, height: 10, zIndex: 1, sortOrder: 1, defaultConfig: { content: 'Hello' } } as Zone);

function init(zones: Zone[], selectedIds: string[] = []) {
  useBuilderStore.getState().init({
    id: 't1', isSystem: false, zones,
    meta: { name: 'T', description: '', screenWidth: CANVAS.width, screenHeight: CANVAS.height, bgColor: '', bgGradient: '', bgImage: '' },
    isTouchEnabled: false, idleResetMs: 60000, scenes: [],
  } as never);
  useBuilderStore.setState({ selectedIds, previewMode: false });
}

beforeEach(() => mockToastSuccess.mockClear());

const cfg = (z: Zone | undefined) => (z?.defaultConfig || {}) as Record<string, unknown>;

describe('logo', () => {
  it('places a NEW logo in the top-left corner at its own aspect ratio, selected', async () => {
    init([placeholder], ['blank']);
    render(<BrandKitPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Insert as logo widget' }));
    await waitFor(() => expect(useBuilderStore.getState().zones.some((z) => z.widgetType === 'LOGO')).toBe(true));
    const st = useBuilderStore.getState();
    const logo = st.zones.find((z) => z.widgetType === 'LOGO')!;
    expect(st.zones.some((z) => z.widgetType === 'EMPTY')).toBe(false); // the blank starter is replaced
    expect(cfg(logo).assetUrl).toBe(MOCK_KIT.logoUrl);
    expect(logo.x).toBeLessThan(5);
    expect(logo.y).toBeLessThan(5);
    // Pixel aspect of the frame = the logo's 2:1.
    expect((logo.width * CANVAS.width) / (logo.height * CANVAS.height)).toBeCloseTo(2);
    expect(logo.width).toBeLessThanOrEqual(28);
    expect(st.selectedIds).toEqual([logo.id]);
    // One undo step removes it.
    st.undo();
    expect(useBuilderStore.getState().zones.some((z) => z.widgetType === 'LOGO')).toBe(false);
  });

  it('swaps the image of an existing LOGO zone instead of adding another', async () => {
    const existing = { id: 'logo1', name: 'Logo 1', widgetType: 'LOGO', x: 70, y: 70, width: 10, height: 10, zIndex: 1, sortOrder: 0, defaultConfig: { assetUrl: '/old.png' } } as Zone;
    init([existing]);
    render(<BrandKitPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Insert as logo widget' }));
    const st = useBuilderStore.getState();
    expect(st.zones.filter((z) => z.widgetType === 'LOGO')).toHaveLength(1);
    expect(cfg(st.zones[0]).assetUrl).toBe(MOCK_KIT.logoUrl);
    expect(st.zones[0].x).toBe(70); // position kept
    expect(st.selectedIds).toEqual(['logo1']);
  });
});

describe('fonts', () => {
  it('with nothing selected, ADDS a headline text box in the heading font, selected', () => {
    init([placeholder], ['blank']);
    render(<BrandKitPanel />);
    fireEvent.click(screen.getByText('Oswald'));
    const st = useBuilderStore.getState();
    const added = st.zones.find((z) => z.widgetType === 'TEXT')!;
    expect(added).toBeTruthy();
    expect(cfg(added)).toMatchObject({ content: 'Your headline', fontFamily: 'Oswald', bold: true });
    expect(st.selectedIds).toEqual([added.id]);
    expect(mockToastSuccess).toHaveBeenCalled();
  });

  it('the body font adds "Your text here"', () => {
    init([]);
    render(<BrandKitPanel />);
    fireEvent.click(screen.getByText('Lato'));
    const added = useBuilderStore.getState().zones.find((z) => z.widgetType === 'TEXT')!;
    expect(cfg(added)).toMatchObject({ content: 'Your text here', fontFamily: 'Lato' });
  });

  it('with a text widget selected, applies the font and says so', () => {
    init([text()], ['txt']);
    render(<BrandKitPanel />);
    fireEvent.click(screen.getByText('Lato'));
    const st = useBuilderStore.getState();
    expect(st.zones).toHaveLength(1);
    expect(cfg(st.zones[0]).fontFamily).toBe('Lato');
    expect(mockToastSuccess).toHaveBeenCalledWith('Font applied: Lato.', expect.anything());
  });
});

describe('colors', () => {
  it('with nothing selected, a swatch opens a menu; "Use as background" sets the canvas', () => {
    init([text()]);
    render(<BrandKitPanel />);
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(screen.getByTitle(/^Primary: #112233/));
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: /Use as background/ }));
    expect(useBuilderStore.getState().meta).toMatchObject({ bgColor: '#112233', bgGradient: '' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('"Gradient with <next brand color>" builds a gradient from the two', () => {
    init([text()]);
    render(<BrandKitPanel />);
    fireEvent.click(screen.getByTitle(/^Primary: #112233/));
    fireEvent.click(screen.getByRole('menuitem', { name: /Gradient with #445566/ }));
    const g = useBuilderStore.getState().meta.bgGradient;
    expect(g).toContain('#112233');
    expect(g).toContain('#445566');
  });

  it('"Set text color on all text" colours every text widget in one undo step', () => {
    init([text('a'), text('b'), { ...text('c'), widgetType: 'CLOCK' } as Zone]);
    render(<BrandKitPanel />);
    const before = useBuilderStore.getState().past.length;
    fireEvent.click(screen.getByTitle(/^Accent: #445566/));
    fireEvent.click(screen.getByRole('menuitem', { name: /Set text color on all text/ }));
    const st = useBuilderStore.getState();
    expect(cfg(st.zones[0]).color).toBe('#445566');
    expect(cfg(st.zones[1]).color).toBe('#445566');
    expect(cfg(st.zones[2]).color).toBeUndefined();
    expect(st.past.length).toBe(before + 1);
  });

  it('with a widget selected: click = text colour, the visible Background toggle = background', () => {
    init([text()], ['txt']);
    render(<BrandKitPanel />);
    fireEvent.click(screen.getByTitle(/^Primary: #112233/));
    expect(cfg(useBuilderStore.getState().zones[0]).color).toBe('#112233');
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(within(screen.getByRole('group', { name: 'Apply color to' })).getByRole('button', { name: 'Background' }));
    fireEvent.click(screen.getByTitle(/^Accent: #445566/));
    expect(cfg(useBuilderStore.getState().zones[0]).bgColor).toBe('#445566');
    // Shift+click stays a background shortcut regardless of the toggle.
    fireEvent.click(within(screen.getByRole('group', { name: 'Apply color to' })).getByRole('button', { name: 'Text' }));
    fireEvent.click(screen.getByTitle(/^Surface: #f8fafc/), { shiftKey: true });
    expect(cfg(useBuilderStore.getState().zones[0]).bgColor).toBe('#f8fafc');
  });
});

describe('apply brand across template', () => {
  it('toasts a summary of what changed', () => {
    init([text()]);
    render(<BrandKitPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Apply brand across template/ }));
    expect(mockToastSuccess).toHaveBeenCalledTimes(1);
    const message = String(mockToastSuccess.mock.calls[0][0]);
    expect(message).toMatch(/^Brand applied: /);
    expect(message).toContain('1 of 1 widgets restyled');
    expect(message).toContain('brand gradient background');
  });
});
