import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PropertiesPanel } from '../PropertiesPanel';
import { parseDirectoryLocations, type DirectoryDocument } from '../DirectoryBoardEditor';
import { useBuilderStore } from '../useBuilderStore';
import type { Zone } from '../types';

jest.mock('@/lib/api-client', () => ({ ...jest.requireActual('@/lib/api-client'), apiFetch: jest.fn(() => new Promise(() => undefined)) }));
beforeAll(() => { HTMLElement.prototype.scrollIntoView = jest.fn(); });
function mount(count = 2, extra: Record<string, unknown> = {}) {
  const document = { format: 'arc-riot.directory', version: 1, designId: 'pacific-editorial', orientation: 'landscape', dataset: { title: 'Example Centre', tenants: Array.from({ length: count }, (_, i) => ({ id: 'row-' + i, name: 'Company ' + i, suite: String(101 + i) })) }, playback: {}, theme: {} };
  const zone = { id: 'scene', name: 'Directory', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { url: '/templates/signage/corporate/directory/pacific-editorial-landscape.html', directoryDocument: document, ...extra } } as Zone;
  useBuilderStore.getState().init({ id: 'directory', isSystem: false, zones: [zone], meta: { name: 'Directory', description: '', screenWidth: 3840, screenHeight: 2160, bgColor: '', bgGradient: '', bgImage: '' }, isTouchEnabled: false, idleResetMs: 60000, scenes: [] });
  useBuilderStore.setState({ selectedIds: ['scene'] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}><PropertiesPanel /></QueryClientProvider>);
}
function saved() { return useBuilderStore.getState().zones[0].defaultConfig as { directoryDocument: DirectoryDocument; contentChanged?: boolean }; }

describe('directory configuration in the existing Properties panel', () => {
  it('uses the native list and controls, without an embedded settings app or disabled choices', () => {
    const { container } = mount();
    expect(screen.getByLabelText('Building name')).toHaveValue('Example Centre');
    expect(screen.getByLabelText('Display')).toHaveValue('single');
    expect(screen.getByLabelText('location 1 Name')).toHaveValue('Company 0');
    expect(screen.getByLabelText('location 1 Suite / room')).toHaveValue('101');
    expect(container.querySelector('iframe[title="Directory editor"]')).toBeNull();
    expect(screen.queryByText('Cards / panels')).toBeNull();
    expect(screen.queryByText('Page order')).toBeNull();
    expect(screen.queryByText(/milliseconds|pixels per second/i)).toBeNull();
    expect(screen.queryByLabelText('Transition')).toBeNull();
    expect(container.querySelector('select:disabled')).toBeNull();
  });
  it('adds, edits and removes locations through the shared list editor', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: '+ Add location' }));
    fireEvent.change(screen.getByLabelText('location 3 Name'), { target: { value: 'New Company' } });
    fireEvent.change(screen.getByLabelText('location 3 Suite / room'), { target: { value: '900' } });
    expect(saved().directoryDocument.dataset.tenants[2]).toMatchObject({ name: 'New Company', suite: '900' });
    expect(saved().contentChanged).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Remove location 1' }));
    expect(saved().directoryDocument.dataset.tenants).toHaveLength(2);
    expect(saved().directoryDocument.dataset.tenants[0].name).toBe('Company 1');
  });
  it('automatically counts pages at the selected capacity, and saves plain timing/speed choices', () => {
    mount(25);
    fireEvent.change(screen.getByLabelText('Display'), { target: { value: 'pages' } });
    expect(screen.getByRole('status')).toHaveTextContent('2 pages');
    const size = screen.getByLabelText('Locations per page');
    fireEvent.change(size, { target: { value: '12' } }); fireEvent.blur(size);
    expect(screen.getByRole('status')).toHaveTextContent('3 pages');
    fireEvent.change(screen.getByLabelText('Transition'), { target: { value: 'flip' } });
    fireEvent.change(screen.getByLabelText('Transition speed'), { target: { value: 'fast' } });
    const duration = screen.getByLabelText('Change pages every (seconds)'); fireEvent.change(duration, { target: { value: '6' } }); fireEvent.blur(duration);
    expect(saved().directoryDocument.playback).toMatchObject({ displayMode: 'pages', locationsPerPage: 12, transitionMode: 'flip', motionSpeed: 'fast', pageDurationMs: 6000 });
    fireEvent.change(screen.getByLabelText('Transition'), { target: { value: 'continuous-scroll' } });
    expect(screen.queryByLabelText('Change pages every (seconds)')).toBeNull();
    expect(screen.getByLabelText('Scroll speed')).toHaveValue('fast');
  });
  it('opens only the clicked wording and saves it in the document', async () => {
    mount();
    act(() => { window.dispatchEvent(new MessageEvent('message', { source: window, data: { type: 'arc-directory-select', key: 'property.directoryHeading', text: 'City services' } })); });
    fireEvent.change(screen.getByLabelText('List heading'), { target: { value: 'Our tenants' } });
    expect(saved().directoryDocument.dataset.directoryHeading).toBe('Our tenants');
    act(() => { window.dispatchEvent(new MessageEvent('message', { source: window, data: { type: 'arc-directory-select', key: 'property.imageCaption', text: 'Supplied building artwork' } })); });
    expect(screen.getByLabelText('Photo caption')).toHaveValue('Supplied building artwork');
    fireEvent.change(screen.getByLabelText('Photo caption'), { target: { value: 'Our main entrance' } });
    expect(saved().directoryDocument.dataset.imageCaption).toBe('Our main entrance');
    act(() => { window.dispatchEvent(new MessageEvent('message', { source: window, data: { type: 'arc-directory-select', key: 'tenant.row-0.name' } })); });
    await waitFor(() => expect(screen.getByLabelText('location 1 Name')).toHaveFocus());
  });
  it('preserves previous per-field text edits when switching to the simple document editor', () => {
    mount(2, { textOverrides: { 'property.subtitle': 'Previously saved address', 'tenant.row-0.name': 'Previously saved tenant' } });
    expect(screen.getByLabelText('location 1 Name')).toHaveValue('Previously saved tenant');
    fireEvent.change(screen.getByLabelText('Building name'), { target: { value: 'New building name' } });
    expect(saved().directoryDocument.dataset.subtitle).toBe('Previously saved address');
    expect(saved().directoryDocument.dataset.tenants[0].name).toBe('Previously saved tenant');
  });
  it('can replace fictional starters with a pasted real list in one action', () => {
    mount(); fireEvent.click(screen.getByRole('button', { name: 'Paste a list from Excel' }));
    fireEvent.change(screen.getByLabelText('Paste locations'), { target: { value: 'Name,Suite\nMy first tenant,200\nMy second tenant,300' } });
    fireEvent.click(screen.getByRole('button', { name: 'Replace list' }));
    expect(saved().directoryDocument.dataset.tenants.map(row => row.name)).toEqual(['My first tenant', 'My second tenant']);
  });
  it('accepts Excel/quoted CSV with only the useful name and suite columns', () => {
    expect(parseDirectoryLocations('Name,Suite\n"Long, Legal & Co.",1201\nQuiet Studio,502').map(row => [row.name, row.suite])).toEqual([['Long, Legal & Co.', '1201'], ['Quiet Studio', '502']]);
    expect(parseDirectoryLocations('Name\tSuite\nOne\t101')[0]).toMatchObject({ name: 'One', suite: '101' });
    expect(() => parseDirectoryLocations('"unclosed,101')).toThrow();
  });
});
