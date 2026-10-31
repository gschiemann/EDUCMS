/**
 * The shared picker's opt-in multi-select (2026-10-31). Default callers
 * (emergency trigger, /panic) keep single-select behaviour.
 */
import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key),
}));

import { EmergencyTargetPicker } from '../EmergencyTargetPicker';
import { allScreensTarget, type EmergencyTargets } from '@/lib/emergency-target';

const mk = (id: string, name: string) => ({
  id, name, location: null, online: true, groupId: null, groupName: null,
  tenantId: 't1', tenantName: 'T', displayScreenCount: 1,
});
const targets: EmergencyTargets = {
  tenantId: 't1', tenantName: 'T', allScreensCount: 3, groups: [],
  screens: [mk('a', 'Alpha'), mk('b', 'Bravo'), mk('c', 'Charlie')],
};
const all = allScreensTarget('t1', 3);

function setup(extra: Record<string, unknown> = {}) {
  const onSelect = jest.fn();
  const onSelectScreens = jest.fn();
  const onClose = jest.fn();
  render(
    <EmergencyTargetPicker
      open targets={targets} status="ready" selected={all} allScreens={all}
      onSelect={onSelect} onClose={onClose} onRetry={jest.fn()}
      onSelectScreens={onSelectScreens} {...extra}
    />,
  );
  return { onSelect, onSelectScreens, onClose };
}

describe('EmergencyTargetPicker multiple', () => {
  it('default is single-select: one tap selects and closes, no footer', () => {
    const { onSelect, onClose } = setup();
    fireEvent.click(screen.getByTestId('target-option-screen-b'));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ scopeType: 'device', scopeId: 'b' }));
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByTestId('target-done')).toBeNull();
  });

  it('multiple: checkboxes toggle, count updates, Done commits the set', () => {
    const { onSelect, onSelectScreens, onClose } = setup({ multiple: true });
    fireEvent.click(screen.getByTestId('target-option-screen-a'));
    fireEvent.click(screen.getByTestId('target-option-screen-c'));
    expect(screen.getByTestId('target-option-screen-a').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('target-selected-count').textContent).toContain('"count":2');
    fireEvent.click(screen.getByTestId('target-option-screen-a'));
    expect(screen.getByTestId('target-selected-count').textContent).toContain('"count":1');
    fireEvent.click(screen.getByTestId('target-option-screen-b'));
    fireEvent.click(screen.getByTestId('target-done'));
    expect(onSelectScreens).toHaveBeenCalledWith([expect.objectContaining({ id: 'c' }), expect.objectContaining({ id: 'b' })]);
    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('multiple: starts from the current selection', () => {
    setup({ multiple: true, selectedScreenIds: ['b'] });
    expect(screen.getByTestId('target-option-screen-b').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('target-selected-count').textContent).toContain('"count":1');
  });
});
