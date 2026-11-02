/**
 * Pill cleanup primitives (2026-11-02): StatusPill, Segmented, TabRow,
 * FilterMenu, OverflowMenu, SelectionToolbar / ActionDock, PageToolbar.
 * One block per component — the behaviour pages rely on, not the styling.
 */
import * as React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { StatusPill } from '../status-pill';
import { Segmented } from '../segmented';
import { TabRow } from '../tab-row';
import { FilterMenu, activeFilterCount, type FilterGroup } from '../filter-menu';
import { OverflowMenu } from '../overflow-menu';
import { ActionDock, SelectionToolbar } from '../selection-toolbar';
import { PageToolbar } from '../page-toolbar';
import { isDesignV2Search } from '@/lib/design-preview';

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
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowLeft' });
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
  it('tabsBelow keeps the tabs while the top line becomes the selection', () => {
    render(<PageToolbar tabsBelow tabs={<span>TABS</span>} search={<input aria-label="Search" />} selection={<span>SEL</span>} />);
    expect(screen.getByText('TABS')).toBeInTheDocument();
    expect(screen.getByText('SEL')).toBeInTheDocument();
    expect(screen.queryByLabelText('Search')).toBeNull();
  });
});

describe('?design=v2', () => {
  it('only the exact param turns the preview on', () => {
    expect(isDesignV2Search('?design=v2')).toBe(true);
    expect(isDesignV2Search('?x=1&design=v2')).toBe(true);
    expect(isDesignV2Search('')).toBe(false);
    expect(isDesignV2Search('?design=v1')).toBe(false);
  });
});
