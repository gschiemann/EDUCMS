/**
 * Pill cleanup primitives (2026-11-02): StatusPill, Segmented, TabRow,
 * FilterMenu, OverflowMenu, SelectionToolbar / ActionDock, PageToolbar.
 * One block per component — the behaviour pages rely on, not the styling.
 */
import * as React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { StatusPill } from '../status-pill';
import { Segmented } from '../segmented';
import { TabRow, fitTabs } from '../tab-row';
import { FilterMenu, activeFilterCount, type FilterGroup } from '../filter-menu';
import { OverflowMenu } from '../overflow-menu';
import { ActionDock, SelectionToolbar } from '../selection-toolbar';
import { PageToolbar } from '../page-toolbar';
import { statusFilterView } from '@/components/screens/v3/statusFilterView';

describe('StatusPill', () => {
  it('is a plain span: not focusable, no button role', () => {
    render(<StatusPill tone="success">Live</StatusPill>);
    const pill = screen.getByText('Live');
    expect(pill.tagName).toBe('SPAN');
    expect(pill).not.toHaveAttribute('tabindex');
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('Segmented', () => {
  it('is a radiogroup; click and arrow keys choose', () => {
    const onChange = jest.fn();
    render(<Segmented value="grid" onChange={onChange} ariaLabel="View" options={[{ value: 'grid', label: 'Grid' }, { value: 'list', label: 'List' }] as const} />);
    const group = screen.getByRole('radiogroup', { name: 'View' });
    expect(screen.getByRole('radio', { name: 'Grid' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'List' })).toHaveAttribute('tabindex', '-1');
    fireEvent.click(screen.getByRole('radio', { name: 'List' }));
    expect(onChange).toHaveBeenLastCalledWith('list');
    fireEvent.keyDown(group, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('list');
  });
});

describe('TabRow', () => {
  it('renders tabs with grey counts and selects on click / arrows', () => {
    const onChange = jest.fn();
    render(<TabRow value="all" onChange={onChange} ariaLabel="Status" tabs={[{ key: 'all', label: 'All', count: 20 }, { key: 'off', label: 'Offline', count: 3 }]} />);
    expect(screen.getByRole('tab', { name: /All/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /Offline/ })).toHaveTextContent('3');
    fireEvent.click(screen.getByRole('tab', { name: /Offline/ }));
    expect(onChange).toHaveBeenLastCalledWith('off');
    fireEvent.keyDown(screen.getByRole('tab', { name: /All/ }), { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith('off');
  });
  it('a value no tab matches selects none (a secondary filter is on)', () => {
    render(<TabRow value="behind" onChange={() => {}} ariaLabel="Status" tabs={[{ key: 'all', label: 'All' }]} />);
    expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('tabindex', '0');
  });
});

describe('FilterMenu', () => {
  const groups: FilterGroup[] = [
    { id: 'level', label: 'School level', type: 'single', options: [{ value: '', label: 'All ages' }, { value: 'HIGH', label: 'High School', count: 4 }] },
    { id: 'tags', label: 'Tags', type: 'multi', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] },
  ];
  it('counts active groups', () => {
    expect(activeFilterCount(groups, { level: '', tags: [] })).toBe(0);
    expect(activeFilterCount(groups, { level: 'HIGH', tags: ['a'] })).toBe(2);
  });
  it('button names the active count; panel hands back single and multi values; Clear', () => {
    const onChange = jest.fn();
    const onClear = jest.fn();
    render(<FilterMenu testId="fm" groups={groups} value={{ level: 'HIGH', tags: ['a'] }} onChange={onChange} onClear={onClear} />);
    const btn = screen.getByTestId('fm');
    expect(btn).toHaveAccessibleName('Filter, 2 active');
    fireEvent.click(btn);
    const panel = screen.getByTestId('fm-panel');
    fireEvent.click(within(panel).getByRole('radio', { name: /All ages/ }));
    expect(onChange).toHaveBeenLastCalledWith('level', '');
    fireEvent.click(within(panel).getByRole('checkbox', { name: 'B' }));
    expect(onChange).toHaveBeenLastCalledWith('tags', ['a', 'b']);
    fireEvent.click(within(panel).getByRole('checkbox', { name: 'A' }));
    expect(onChange).toHaveBeenLastCalledWith('tags', []);
    fireEvent.click(within(panel).getByRole('button', { name: 'Clear filters' }));
    expect(onClear).toHaveBeenCalled();
  });
});

describe('OverflowMenu', () => {
  it('opens, runs an item and closes; hidden items are skipped', () => {
    const run = jest.fn();
    render(<OverflowMenu testId="more" menuTestId="menu" items={[{ id: 'a', label: 'Export', onSelect: run }, { id: 'b', label: 'Gone', onSelect: run, hidden: true }]} />);
    fireEvent.click(screen.getByTestId('more'));
    const menu = screen.getByTestId('menu');
    expect(within(menu).queryByText('Gone')).toBeNull();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Export' }));
    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('menu')).toBeNull();
  });
});

describe('SelectionToolbar / ActionDock', () => {
  const actions = () => [
    { id: 'export', label: 'Export', onSelect: jest.fn() },
    { id: 'auto', label: 'Auto updates', onSelect: jest.fn(), overflow: true },
    { id: 'delete', label: 'Delete', variant: 'danger' as const, onSelect: jest.fn() },
    { id: 'go', label: 'Resync', variant: 'primary' as const, onSelect: jest.fn() },
  ];
  it('desktop: count, select all, quiet + danger + primary visible, overflow in ⋯', () => {
    const onAll = jest.fn();
    const onClear = jest.fn();
    render(<SelectionToolbar testId="bar" moreTestId="more" count={3} onClear={onClear} selectAll={{ label: 'Select all 20', onSelect: onAll }} actions={actions()} />);
    const bar = screen.getByTestId('bar');
    expect(bar).toHaveTextContent('3 selected');
    for (const n of ['Export', 'Delete', 'Resync']) expect(within(bar).getByRole('button', { name: n })).toBeInTheDocument();
    expect(within(bar).queryByRole('button', { name: 'Auto updates' })).toBeNull();
    fireEvent.click(within(bar).getByRole('button', { name: 'Select all 20' }));
    expect(onAll).toHaveBeenCalled();
    fireEvent.click(within(bar).getByRole('button', { name: 'Clear selection' }));
    expect(onClear).toHaveBeenCalled();
  });
  it('phone: quiet actions fold into ⋯, Delete stays visible (icon), primary visible', () => {
    render(<ActionDock testId="dock" moreTestId="more" moreMenuTestId="menu" count={3} onClear={() => {}} actions={actions()} />);
    const dock = screen.getByTestId('dock');
    expect(within(dock).getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(within(dock).getByRole('button', { name: 'Resync' })).toBeInTheDocument();
    expect(within(dock).queryByRole('button', { name: 'Export' })).toBeNull();
    fireEvent.click(within(dock).getByTestId('more'));
    const menu = screen.getByTestId('menu');
    expect(within(menu).getByRole('menuitem', { name: 'Export' })).toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: 'Delete' })).toBeNull();
  });
  it('renders nothing with no selection', () => {
    render(<ActionDock testId="dock" count={0} onClear={() => {}} actions={actions()} />);
    expect(screen.queryByTestId('dock')).toBeNull();
  });
});

describe('PageToolbar', () => {
  it('each control renders once; selection replaces the row', () => {
    const { rerender } = render(<PageToolbar testId="tb" tabs={<span>TABS</span>} search={<input aria-label="Search" />} filters={<span>FILTER</span>} />);
    expect(screen.getAllByLabelText('Search')).toHaveLength(1);
    rerender(<PageToolbar testId="tb" compact tabs={<span>TABS</span>} search={<input aria-label="Search" />} />);
    expect(screen.getAllByLabelText('Search')).toHaveLength(1);
    rerender(<PageToolbar testId="tb" tabs={<span>TABS</span>} search={<input aria-label="Search" />} selection={<span>SEL</span>} />);
    expect(screen.queryByText('TABS')).toBeNull();
    expect(screen.getByText('SEL')).toBeInTheDocument();
  });
});

describe('TabRow overflow (fitTabs)', () => {
  // widths 100 each, gap 20: 3 tabs = 340, 4 tabs = 460.
  const w = [100, 100, 100, 100, 100, 100];
  it('keeps every tab when they all fit', () => {
    expect(fitTabs([100, 100], 300, 60, 0)).toEqual([0, 1]);
  });
  it('fits as many as leave room for More', () => {
    // room 500, More 60 -> budget 420 -> 3 tabs (340), a 4th would be 460
    expect(fitTabs(w, 500, 60, 0)).toEqual([0, 1, 2]);
  });
  it('the active tab always stays on the line, replacing the last that fits', () => {
    expect(fitTabs(w, 500, 60, 5)).toEqual([0, 1, 5]);
  });
  it('never returns an empty line', () => {
    expect(fitTabs(w, 50, 60, -1)).toEqual([0]);
    expect(fitTabs(w, 50, 60, 3)).toEqual([3]);
  });
});

describe('Screens status filter: one place says what is filtered', () => {
  const chips = [
    { key: 'all' as const, label: 'All', count: 20 },
    { key: 'attention' as const, label: 'Needs attention', count: 4 },
    { key: 'content-behind' as const, label: 'Content behind', count: 1 },
    { key: 'push-delayed' as const, label: 'Push delayed', count: 0 },
    { key: 'offline' as const, label: 'Offline', count: 3 },
  ];
  it('All: the All tab, no Filter count', () => {
    const v = statusFilterView(chips, 'all');
    expect(v.activeTab).toBe('all');
    expect(v.menuCount).toBe(0);
  });
  it('a status with a tab (picked in the menu or the tab) underlines it and is not counted', () => {
    expect(statusFilterView(chips, 'offline')).toMatchObject({ activeTab: 'offline', menuCount: 0 });
    expect(statusFilterView(chips, 'attention')).toMatchObject({ activeTab: 'attention', menuCount: 0 });
  });
  it('a status with no tab underlines none and is the Filter count', () => {
    expect(statusFilterView(chips, 'content-behind')).toMatchObject({ activeTab: null, menuCount: 1 });
  });
  it('the menu lists every status; empty ones are disabled unless active', () => {
    const v = statusFilterView(chips, 'all');
    expect(v.menu.map((m) => m.key)).toEqual(['attention', 'content-behind', 'push-delayed', 'offline']);
    expect(v.menu.find((m) => m.key === 'push-delayed')?.disabled).toBe(true);
    expect(statusFilterView(chips, 'push-delayed').menu.find((m) => m.key === 'push-delayed')?.disabled).toBe(false);
  });
  it('the Offline tab hides at zero unless active', () => {
    const none = chips.map((c) => (c.key === 'offline' ? { ...c, count: 0 } : c));
    expect(statusFilterView(none, 'all').tabs.map((t) => t.key)).toEqual(['all', 'attention']);
    expect(statusFilterView(none, 'offline').tabs.map((t) => t.key)).toEqual(['all', 'attention', 'offline']);
  });
});
