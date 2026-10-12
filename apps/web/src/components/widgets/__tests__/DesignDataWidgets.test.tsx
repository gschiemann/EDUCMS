import React from 'react';
import { render, screen } from '@testing-library/react';
import { DesignChartWidget, DesignTableWidget, readDesignChartConfig, readDesignTableConfig } from '../DesignDataWidgets';

describe('design data widget readers and saved-data rendering', () => {
  it('preserves saved table columns, rows, and cell text', () => {
    const cfg = readDesignTableConfig({ columns: ['Metric', 'Value'], rows: [['Visitors', '204'], ['Notes', 'All locations']] });
    expect(cfg.rows).toHaveLength(2);
    render(<DesignTableWidget config={cfg} />);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Metric' })).toBeInTheDocument();
    expect(screen.getByText('204')).toBeInTheDocument();
    expect(screen.getByText('All locations')).toBeInTheDocument();
  });

  it('surfaces cells whose saved row is longer than its declared columns', () => {
    const cfg = readDesignTableConfig({ columns: ['Metric'], rows: [['Enrollment', '1,240']] });
    expect(cfg.columns).toEqual(['Metric', 'Column 2']);
    render(<DesignTableWidget config={cfg} />);
    expect(screen.getByRole('columnheader', { name: 'Column 2' })).toBeInTheDocument();
    expect(screen.getByText('1,240')).toBeInTheDocument();
  });

  it('keeps saved data above the editor capacity and honors explicit styling', () => {
    const columns = Array.from({ length: 8 }, (_, i) => `Field ${i + 1}`);
    const config = readDesignTableConfig({ columns, rows: [['a', 'b', 'c', 'd', 'e', 'f', 'g', 'retained']], fontSize: 42, alignment: 'right' });
    expect(config.columns).toHaveLength(8);
    expect(config.rows[0][7]).toBe('retained');
    expect(config.fontSize).toBe(42);
    expect(config.alignment).toBe('right');
  });

  it('renders signed bar values and identifies a zero-only series without division errors', () => {
    const config = readDesignChartConfig({ variant: 'design-chart-bar', rows: [{ label: 'Loss', value: -5, color: '#dc2626' }, { label: 'Flat', value: 0, color: '#64748b' }] });
    render(<DesignChartWidget config={config} />);
    expect(screen.getByText('Loss')).toBeInTheDocument();
    expect(screen.getByText('-5')).toBeInTheDocument();
    expect(screen.getByText('Flat')).toBeInTheDocument();
    expect(screen.getByText('0', { selector: 'strong' })).toBeInTheDocument();
  });

  it('explains that pie values cannot be negative and handles a zero denominator', () => {
    const { rerender } = render(<DesignChartWidget config={{ variant: 'design-chart-pie', rows: [{ label: 'Decrease', value: -1, color: '#f00' }] }} />);
    expect(screen.getByRole('status')).toHaveTextContent('Pie charts need values of zero or more');
    rerender(<DesignChartWidget config={{ variant: 'design-chart-pie', rows: [{ label: 'No activity', value: 0, color: '#64748b' }] }} />);
    expect(screen.getByRole('status')).toHaveTextContent('Add a positive value');
  });
});
