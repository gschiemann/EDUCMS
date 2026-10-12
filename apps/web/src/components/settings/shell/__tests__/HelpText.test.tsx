/**
 * Settings copy pass (2026-10-12, owner: "so much text — make each section
 * beyond clear and simple"). Every section header / helper paragraph shows
 * ONE sentence; the rest of the explanation is behind "Learn more".
 */
import * as React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { EditorSection, HelpText, splitLead } from '../primitives';

describe('splitLead', () => {
  it('splits Latin and CJK sentences, and leaves one-sentence copy whole', () => {
    expect(splitLead('Plan, screen seats and invoices.')).toEqual(['Plan, screen seats and invoices.', '']);
    expect(splitLead('Alerts stay on here. Change the industry to turn them off.')).toEqual([
      'Alerts stay on here.',
      'Change the industry to turn them off.',
    ]);
    expect(splitLead('¿Qué ven las pantallas? Durante un simulacro.')).toEqual(['¿Qué ven las pantallas?', 'Durante un simulacro.']);
    expect(splitLead('练习演练期间屏幕显示的内容。没有演练内容的类型会播放实时内容。')).toEqual([
      '练习演练期间屏幕显示的内容。',
      '没有演练内容的类型会播放实时内容。',
    ]);
  });

  it('never stops at a tiny lead such as "e.g."', () => {
    expect(splitLead('e.g. lobby screens only. Then more.')[0]).toBe('e.g. lobby screens only.');
  });
});

describe('<HelpText> / <EditorSection>', () => {
  it('shows the first sentence and reveals the rest on demand', () => {
    render(<HelpText text="One short sentence. Then a long explanation nobody needs every time." />);
    expect(screen.getByText(/One short sentence\./)).toBeInTheDocument();
    expect(screen.queryByText(/long explanation/)).toBeNull();
    const more = screen.getByRole('button', { name: 'Learn more' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(more);
    expect(screen.getByText(/long explanation/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show less' }));
    expect(screen.queryByText(/long explanation/)).toBeNull();
  });

  it('section headers get the same treatment; a one-sentence header has no toggle', () => {
    render(
      <>
        <EditorSection title="A" description="Short and done.">x</EditorSection>
        <EditorSection title="B" description="The first sentence. The second sentence.">y</EditorSection>
      </>,
    );
    expect(screen.getAllByRole('button', { name: 'Learn more' })).toHaveLength(1);
    expect(screen.getByText('Short and done.')).toBeInTheDocument();
  });
});
