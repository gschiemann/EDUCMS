import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { DesignDataFields } from '../DesignDataFields';

function setup(config: Record<string, any>) {
  const onChange = jest.fn();
  render(<DesignDataFields config={config} onChange={onChange} />);
  return onChange;
}

describe('DesignDataFields', () => {
  it('edits saved table cells and appends a blank row without losing existing content', () => {
    const onChange = setup({ variant: 'design-table', heading: 'Snapshot', columns: ['Name', 'Score'], rows: [['Ava', '9']] });
    fireEvent.change(screen.getByLabelText('Score · row 1'), { target: { value: '10' } });
    expect(onChange).toHaveBeenLastCalledWith({ rows: [['Ava', '10']] });
    fireEvent.click(screen.getByRole('button', { name: 'Add row' }));
    expect(onChange).toHaveBeenLastCalledWith({ rows: [['Ava', '9'], ['', '']] });
  });

  it('disables additions at the declared table capacity while allowing removal', () => {
    const columns = Array.from({ length: 6 }, (_, i) => `C${i + 1}`);
    const rows = Array.from({ length: 8 }, () => Array(6).fill(''));
    setup({ variant: 'design-table', columns, rows });
    expect(screen.getByRole('button', { name: 'Add column' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add row' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove row' })).toBeEnabled();
  });

  it('keeps signed chart values and switches to pie only by an explicit edit', () => {
    const onChange = setup({ variant: 'design-chart-bar', rows: [{ label: 'Change', value: -12, color: '#2563eb' }] });
    fireEvent.change(screen.getByLabelText('Chart type'), { target: { value: 'design-chart-pie' } });
    expect(onChange).toHaveBeenLastCalledWith({ variant: 'design-chart-pie' });
    expect(screen.getByRole('status')).toHaveTextContent('Pie charts only support values of zero or more');
  });
});
