import React from 'react';
import { render, screen } from '@testing-library/react';
import { chartPointX, DesignChartWidget, readDesignChartConfig, readDesignTableConfig } from '../DesignDataWidgets';

describe('Astra data element geometry and saved configuration', () => {
  it('centers line marks in the same cells as their labels, including a single point', () => {
    expect(chartPointX(0, 4)).toBe(220 + 1284 / 8);
    expect(chartPointX(3, 4)).toBe(1504 - 1284 / 8);
    expect(chartPointX(0, 1)).toBe(220 + 1284 / 2);
  });
  it('honors saved fonts and explicit legends while omitting redundant new bar legends', () => {
    expect(readDesignChartConfig({ fontFamily: 'Georgia', showLegend: true }).headingFont).toBe('Georgia');
    expect(readDesignChartConfig({ showLegend: true }).showLegend).toBe(true);
    expect(readDesignChartConfig({ variant: 'design-chart-bar' }).showLegend).toBe(false);
    expect(readDesignChartConfig({ variant: 'design-chart-pie' }).showLegend).toBe(true);
    expect(readDesignTableConfig({ fontFamily: 'Georgia', headingFont: 'DM Sans' }).headingFont).toBe('DM Sans');
  });
  it('keeps signed line values and uses a substantial scale-relative stroke', () => {
    render(<DesignChartWidget config={{ variant: 'design-chart-line', rows: [{label:'Loss',value:-12,color:'#285c52'},{label:'Flat',value:0,color:'#b65d43'},{label:'Gain',value:36,color:'#70668e'}] }} />);
    expect(screen.getByRole('img', { name: /Line chart: Loss -12, Flat 0, Gain 36/ })).toBeInTheDocument();
    expect(document.querySelector('polyline')).toHaveAttribute('stroke-width','7');
    expect(document.querySelectorAll('[data-chart-point]')).toHaveLength(3);
    expect(document.querySelectorAll('[data-chart-label]')).toHaveLength(3);
  });
  it('does not paint a zero-valued pie sector as a full circle', () => {
    render(<DesignChartWidget config={{ variant: 'design-chart-pie', rows: [{label:'Empty',value:0,color:'#f00'},{label:'Whole',value:10,color:'#285c52'}] }} />);
    expect(document.querySelectorAll('svg circle')).toHaveLength(1);
    expect(document.querySelector('svg circle')).toHaveAttribute('fill','#285c52');
    expect(document.querySelectorAll('svg path')).toHaveLength(0);
  });
});
