/**
 * A Brand swatch / font click on a selected widget is ONE undo step (Codex T05,
 * 2026-09-13). They called updateZone without committing, so the colour changed
 * and Undo could not restore it. Mutation check: drop the `true` and test 1 fails.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { useBuilderStore } from '../useBuilderStore';
import type { Zone } from '../types';

const MOCK_KIT = { palette: { primary: '#112233', accent: '#445566', background: '#ffffff', text: '#000000' }, fonts: { heading: 'Inter', body: 'Inter' }, logoUrl: '', displayName: 'Test Brand' };
jest.mock('@/hooks/use-api', () => ({
  useTemplate: () => ({ data: { id: 't1', brandKit: MOCK_KIT }, isLoading: false }),
  useAdoptTemplateBrandKit: () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false }),
  useClearTemplateBrandKit: () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false }),
}));
jest.mock('@/lib/api-client', () => ({ apiFetch: jest.fn() }));
jest.mock('@/components/ui/app-dialog', () => ({ appConfirm: jest.fn().mockResolvedValue(false), appAlert: jest.fn().mockResolvedValue(undefined) }));

import { BrandKitPanel } from '../BrandKitPanel';

const zone = (): Zone => ({ id: 'z', name: 'Zone', widgetType: 'TEXT', x: 10, y: 10, width: 20, height: 10, zIndex: 1, sortOrder: 0, defaultConfig: { content: 'Hello' } } as Zone);

beforeEach(() => {
  useBuilderStore.getState().init({ id: 't1', isSystem: false, zones: [zone()], meta: { name: 'T', description: '', screenWidth: 1920, screenHeight: 1080, bgColor: '', bgGradient: '', bgImage: '' }, isTouchEnabled: false, idleResetMs: 60000, scenes: [] });
  useBuilderStore.setState({ selectedIds: ['z'], previewMode: false });
});

describe('brand swatch on a selected widget', () => {
  it('applies the colour AND pushes exactly one history entry, which Undo reverts', () => {
    render(<BrandKitPanel />);
    const swatch = screen.getAllByTitle(/#112233/i)[0];
    const before = useBuilderStore.getState().past.length;
    fireEvent.click(swatch);
    const st = useBuilderStore.getState();
    expect((st.zones[0].defaultConfig as Record<string, unknown>).color).toBe('#112233');
    expect(st.past.length).toBe(before + 1);
    st.undo();
    expect((useBuilderStore.getState().zones[0].defaultConfig as Record<string, unknown>).color).toBeUndefined();
  });
});
