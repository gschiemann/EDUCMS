/**
 * K-12 launch audit F26 — a meet sport says it is a results display, not a
 * meet controller: on its New-game tile, under the picker once chosen, and
 * above the console's results pad / grid. A game sport says nothing.
 */
import { render, screen } from '@testing-library/react';
import { findSport } from '@cms/api-types';
import { ResultsScopeNote, ResultsScopeTag } from '../ResultsScopeNote';

describe('ResultsScopeNote', () => {
  it.each([
    ['swimming', 'timed', /timing system or meet software/],
    ['track_and_field', 'timed', /timing system or meet software/],
    ['cross_country', 'timed', /timing system or meet software/],
    ['diving', 'dive', /judge pad adds up the scores you type/],
    ['gymnastics', 'judged', /does not judge routines or apply deductions/],
    ['competitive_cheer', 'judged', /does not judge routines or apply deductions/],
    ['golf', 'golf', /does not keep hole-by-hole scorecards or settle ties/],
  ])('%s → a results display that names what stays with the officials', (key, kind, sentence) => {
    render(<ResultsScopeNote sport={findSport(key)} />);
    const note = screen.getByRole('note');
    expect(note).toHaveAttribute('data-results-scope', kind);
    expect(note).toHaveTextContent('Results display.');
    expect(note).toHaveTextContent('It does not run the meet.');
    expect(note).toHaveTextContent(sentence);
  });

  it.each(['football', 'basketball', 'wrestling', 'water_polo', 'pickleball'])(
    '%s (a game VenueOS runs) renders nothing',
    (key) => {
      const { container } = render(<ResultsScopeNote sport={key} />);
      expect(container).toBeEmptyDOMElement();
    },
  );

  it('the picker variant carries the same words', () => {
    render(<ResultsScopeNote sport="golf" variant="picker" />);
    expect(screen.getByRole('note')).toHaveTextContent(/Results display\. VenueOS shows the results you enter or import/);
  });
});

describe('ResultsScopeTag', () => {
  it('tags a meet sport tile "Results" with an explanation on hover', () => {
    render(<ResultsScopeTag sport="swimming" />);
    const tag = screen.getByText('Results');
    expect(tag).toHaveAttribute('title', expect.stringContaining('does not score the meet'));
  });

  it('leaves a game sport tile alone', () => {
    const { container } = render(<ResultsScopeTag sport="football" />);
    expect(container).toBeEmptyDOMElement();
  });
});
