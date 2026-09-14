/** Audit reproductions, NOT desired behavior. Passing confirms the documented defects. */
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { computeSuggestions } from '../suggestions';
import { useBuilderStore } from '../useBuilderStore';
import { BackgroundPanel } from '../BackgroundPanel';
import { BrandKitPanel } from '../BrandKitPanel';
import type { Zone, TemplateScene } from '../types';

jest.mock('@/hooks/use-api', () => ({
  useTemplate: () => ({ data: { id: 'audit', brandKit: { palette: { primary: '#112233', ink: '#223344' }, fontHeading: 'Inter' } } }),
  useAdoptTemplateBrandKit: () => ({ mutate: jest.fn(), mutateAsync: jest.fn() }),
  useClearTemplateBrandKit: () => ({ mutate: jest.fn(), mutateAsync: jest.fn() }),
}));
jest.mock('@/lib/api-client', () => ({ apiFetch: jest.fn() }));
jest.mock('@/components/ui/app-dialog', () => ({ appConfirm: jest.fn().mockResolvedValue(false), appAlert: jest.fn() }));
jest.mock('../PropertiesPanel', () => ({ TemplateBackdropPicker: () => null }));
jest.mock('@/components/assets/StockPhotoSearch', () => ({ StockPhotoSearch: () => null }));
jest.mock('@/components/ui/color-picker', () => ({ ColorPickerBody: () => null }));

const scene = (id: string, isDefault = false): TemplateScene => ({ id, templateId: 'audit', name: id, sortOrder: 0, isDefault });
const zone = (patch: Partial<Zone> = {}): Zone => ({ id: 'a', name: 'Example', widgetType: 'TEXT', x: 10, y: 10, width: 20, height: 10, zIndex: 1, sortOrder: 0, defaultConfig: { content: 'Example', color: '#000000' }, ...patch });
const review = (zones: Zone[]) => computeSuggestions({ zones, screenWidth: 1920, screenHeight: 1080, isTouchEnabled: true });
function init(zones = [zone()]) {
  useBuilderStore.getState().init({ id: 'audit', isSystem: false, zones, scenes: [scene('one', true), scene('two')], isTouchEnabled: true, idleResetMs: 60000,
    meta: { name: 'Audit', description: '', screenWidth: 1920, screenHeight: 1080, bgColor: '', bgGradient: '', bgImage: '' } });
}
afterEach(cleanup);

describe('Audit: Review defects reproduced through actual suggestion engine', () => {
  it('reports overlap between zones that are on different scenes', () => {
    const issues = review([zone({ sceneId: 'one' }), zone({ id: 'b', sceneId: 'two' })]);
    expect(issues.some(s => s.title.toLowerCase().includes('overlap'))).toBe(true);
  });
  it('returns zero issues for a locked zone beyond the screen', () => {
    expect(review([zone({ locked: true, x: 110 })])).toEqual([]);
  });
  it('offers to thicken a deliberate divider from 1% to 6% height', () => {
    const issue = review([zone({ widgetType: 'SHAPE', width: 70, height: 1 })]).find(s => s.id.startsWith('tiny:'));
    expect(issue?.fix?.patch.height).toBe(6);
  });
});

describe('Audit: scene and layer store defects', () => {
  it('refreshing scenes replaces the explicitly selected Shared view with default', () => {
    init();
    useBuilderStore.getState().setActiveSceneId(null);
    useBuilderStore.getState().setScenes([scene('one', true), scene('two')]);
    expect(useBuilderStore.getState().activeSceneId).toBe('one');
  });
  it('setScenes leaves zones assigned to a deleted scene locally', () => {
    init([zone({ sceneId: 'two' })]);
    useBuilderStore.getState().setScenes([scene('one', true)]);
    expect(useBuilderStore.getState().zones[0].sceneId).toBe('two');
  });
  it('selecting a layer from another scene does not navigate there', () => {
    init([zone({ sceneId: 'two' })]);
    useBuilderStore.getState().select('a');
    expect(useBuilderStore.getState().activeSceneId).toBe('one');
    expect(useBuilderStore.getState().selectedIds).toEqual(['a']);
  });
  it('one Bring forward operation creates a tied stacking index', () => {
    init([zone(), zone({ id: 'b', zIndex: 2 })]);
    useBuilderStore.getState().moveLayer('a', 'up');
    expect(useBuilderStore.getState().zones.map(z => z.zIndex)).toEqual([2, 2]);
  });
});

describe('Audit: mounted Background and Brand controls with mocked network hooks', () => {
  it('Dots writes an SVG whose decoded fill remains an invalid percent-escaped color', () => {
    init();
    render(<BackgroundPanel />);
    fireEvent.click(screen.getByTitle('Dots'));
    const css = useBuilderStore.getState().meta.bgGradient!;
    const encoded = css.match(/data:image\/svg\+xml;utf8,([^\"]+)/)![1];
    expect(decodeURIComponent(encoded)).toContain("fill='%23cbd5e1'");
  });
  it('a brand swatch changes color without creating an undo history entry', () => {
    init();
    useBuilderStore.getState().select('a');
    render(<BrandKitPanel />);
    fireEvent.click(screen.getByTitle(/^Primary: #112233/));
    expect(useBuilderStore.getState().zones[0].defaultConfig.color).toBe('#112233');
    expect(useBuilderStore.getState().past).toHaveLength(0);
    useBuilderStore.getState().undo();
    expect(useBuilderStore.getState().zones[0].defaultConfig.color).toBe('#112233');
  });
});
