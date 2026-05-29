/**
 * Proof that the ~13 widget list editors I converted from raw-JSON
 * textareas to schema-driven <ListItemsEditor> actually let an operator
 * edit the data — a runnable RTL test, not a static trace.
 *
 * Context: every list-based widget (class schedules, happy-hour drinks,
 * trivia teams, combos, …) used to dump the operator into a textarea full
 * of `JSON array of { ... }`. Nobody hand-edits JSON to change a price or
 * a team's score. These tests instantiate <ListItemsEditor> with the EXACT
 * field schemas now wired into PropertiesPanel for three of those widgets
 * (FITNESS_CLASS_SCHEDULE, BAR_HAPPY_HOUR_COUNTDOWN, BAR_TRIVIA_SCOREBOARD),
 * drive a real edit, and assert the value flows back through onChange in
 * the shape the widget reads. Also covers the two new field affordances I
 * added in the same file: the `stringList` sub-array field (a combo's
 * `includes` bullets) and the standalone <StringListEditor> (perks).
 *
 * If any of these break, this test fails and the conversion is not "done".
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { ListItemsEditor, StringListEditor } from '../PropertiesPanel';
import type { ListItemFieldSpec } from '../PropertiesPanel';

/** Pull the most recent value handed to an onChange spy. */
function lastCall<T>(fn: jest.Mock): T {
  return fn.mock.calls[fn.mock.calls.length - 1][0] as T;
}

// ─── Field schemas mirrored 1:1 from PropertiesPanel ────────────────────────
const CLASS_FIELDS: ListItemFieldSpec[] = [
  { key: 'time', label: 'Time', type: 'text' },
  { key: 'name', label: 'Class name', type: 'text' },
  { key: 'instructor', label: 'Instructor', type: 'text' },
  { key: 'studio', label: 'Studio / room', type: 'text' },
  { key: 'intensity', label: 'Intensity', type: 'select', options: [['', '—'], ['easy', 'Easy'], ['moderate', 'Moderate'], ['hard', 'Hard']] },
  { key: 'durationMin', label: 'Duration (min)', type: 'number' },
];

const DRINK_FIELDS: ListItemFieldSpec[] = [
  { key: 'name', label: 'Drink', type: 'text' },
  { key: 'regularPrice', label: 'Regular price', type: 'price' },
  { key: 'happyPrice', label: 'Happy-hour price', type: 'price' },
  { key: 'emoji', label: 'Emoji', type: 'text' },
];

const TEAM_FIELDS: ListItemFieldSpec[] = [
  { key: 'name', label: 'Team name', type: 'text' },
  { key: 'score', label: 'Score', type: 'number' },
  { key: 'emoji', label: 'Emoji', type: 'text' },
  { key: 'delta', label: 'Change since last round', type: 'number' },
];

const COMBO_FIELDS: ListItemFieldSpec[] = [
  { key: 'name', label: 'Combo name', type: 'text' },
  { key: 'price', label: 'Price', type: 'price' },
  { key: 'includes', label: 'Includes', type: 'stringList' },
];

describe('FITNESS_CLASS_SCHEDULE — class schedule editor', () => {
  const classes = [
    { time: '7:00 AM', name: 'Power Yoga', instructor: 'Jordan', studio: 'Studio A', intensity: 'moderate', durationMin: 45 },
    { time: '9:00 AM', name: 'Spin', instructor: 'Casey', studio: 'Cycle', intensity: 'hard', durationMin: 50 },
  ];

  it('renders an editable input per field with the real values visible', () => {
    render(<ListItemsEditor label="Classes" itemNoun="class" value={classes} onChange={jest.fn()} fields={CLASS_FIELDS} />);
    expect(screen.getByDisplayValue('Power Yoga')).toBeTruthy();
    expect(screen.getByDisplayValue('Jordan')).toBeTruthy();
    expect(screen.getByDisplayValue('Spin')).toBeTruthy();
    // number field carries the numeric duration
    expect(screen.getByDisplayValue('45')).toBeTruthy();
  });

  it('typing a new instructor name flows back through onChange untouched-elsewhere', () => {
    const onChange = jest.fn();
    render(<ListItemsEditor label="Classes" itemNoun="class" value={classes} onChange={onChange} fields={CLASS_FIELDS} />);
    fireEvent.change(screen.getByDisplayValue('Jordan'), { target: { value: 'Riley' } });
    const next = lastCall<Record<string, unknown>[]>(onChange);
    expect(next[0].instructor).toBe('Riley');
    expect(next[0].name).toBe('Power Yoga'); // sibling field untouched
    expect(next[1].instructor).toBe('Casey'); // other row untouched
  });

  it('number field (durationMin) emits a Number, not a string', () => {
    const onChange = jest.fn();
    render(<ListItemsEditor label="Classes" itemNoun="class" value={classes} onChange={onChange} fields={CLASS_FIELDS} />);
    fireEvent.change(screen.getByDisplayValue('45'), { target: { value: '60' } });
    const next = lastCall<Record<string, unknown>[]>(onChange);
    expect(next[0].durationMin).toBe(60);
    expect(typeof next[0].durationMin).toBe('number');
  });

  it('select field (intensity) commits the chosen option value', () => {
    const onChange = jest.fn();
    render(<ListItemsEditor label="Classes" itemNoun="class" value={classes} onChange={onChange} fields={CLASS_FIELDS} />);
    // One <select> per class row; row 1's is the first combobox.
    const intensity = screen.getAllByRole('combobox')[0];
    fireEvent.change(intensity, { target: { value: 'easy' } });
    const next = lastCall<Record<string, unknown>[]>(onChange);
    expect(next[0].intensity).toBe('easy');
    expect(next[1].intensity).toBe('hard'); // other row untouched
  });

  it('Add appends a blank class, Remove deletes the right row', () => {
    const onChange = jest.fn();
    const { rerender } = render(<ListItemsEditor label="Classes" itemNoun="class" value={classes} onChange={onChange} fields={CLASS_FIELDS} newItem={{ time: '', name: '', instructor: '', studio: '', intensity: '', durationMin: '' }} />);
    fireEvent.click(screen.getByRole('button', { name: /add class/i }));
    const added = lastCall<Record<string, unknown>[]>(onChange);
    expect(added).toHaveLength(3);

    rerender(<ListItemsEditor label="Classes" itemNoun="class" value={classes} onChange={onChange} fields={CLASS_FIELDS} />);
    fireEvent.click(screen.getByRole('button', { name: /remove class 1/i }));
    const removed = lastCall<Record<string, unknown>[]>(onChange);
    expect(removed).toHaveLength(1);
    expect(removed[0].name).toBe('Spin');
  });
});

describe('BAR_HAPPY_HOUR_COUNTDOWN — featured drinks editor (THE pricing complaint)', () => {
  const drinks = [
    { name: 'Drafts', regularPrice: '$8', happyPrice: '$5', emoji: '🍺' },
    { name: 'Wells', regularPrice: '$11', happyPrice: '$7', emoji: '🥃' },
  ];

  it('editing a happy-hour price flows back through onChange', () => {
    const onChange = jest.fn();
    render(<ListItemsEditor label="Featured drinks" itemNoun="drink" value={drinks} onChange={onChange} fields={DRINK_FIELDS} />);
    fireEvent.change(screen.getByDisplayValue('$5'), { target: { value: '$4' } });
    const next = lastCall<Record<string, unknown>[]>(onChange);
    expect(next[0].happyPrice).toBe('$4');
    expect(next[0].regularPrice).toBe('$8'); // untouched
  });

  it('reorders drinks with the down arrow', () => {
    const onChange = jest.fn();
    render(<ListItemsEditor label="Featured drinks" itemNoun="drink" value={drinks} onChange={onChange} fields={DRINK_FIELDS} />);
    fireEvent.click(screen.getByRole('button', { name: /move drink 1 down/i }));
    const next = lastCall<Record<string, unknown>[]>(onChange);
    expect(next[0].name).toBe('Wells');
    expect(next[1].name).toBe('Drafts');
  });
});

describe('BAR_TRIVIA_SCOREBOARD — team list editor', () => {
  const teams = [
    { name: 'Quizzly Bears', score: 47, emoji: '🐻', delta: 6 },
    { name: 'Smarty Pints', score: 42, emoji: '🍻', delta: 4 },
  ];

  it('renders a team-name input per team', () => {
    render(<ListItemsEditor label="Teams" itemNoun="team" value={teams} onChange={jest.fn()} fields={TEAM_FIELDS} />);
    expect(screen.getByDisplayValue('Quizzly Bears')).toBeTruthy();
    expect(screen.getByDisplayValue('Smarty Pints')).toBeTruthy();
  });

  it('bumping a score emits a Number through onChange', () => {
    const onChange = jest.fn();
    render(<ListItemsEditor label="Teams" itemNoun="team" value={teams} onChange={onChange} fields={TEAM_FIELDS} />);
    fireEvent.change(screen.getByDisplayValue('47'), { target: { value: '53' } });
    const next = lastCall<Record<string, unknown>[]>(onChange);
    expect(next[0].score).toBe(53);
    expect(typeof next[0].score).toBe('number');
    expect(next[0].name).toBe('Quizzly Bears'); // untouched
  });

  it('Add appends a team with the newItem defaults (score 0)', () => {
    const onChange = jest.fn();
    render(<ListItemsEditor label="Teams" itemNoun="team" value={teams} onChange={onChange} fields={TEAM_FIELDS} newItem={{ name: '', score: 0, emoji: '', delta: 0 }} />);
    fireEvent.click(screen.getByRole('button', { name: /add team/i }));
    const next = lastCall<Record<string, unknown>[]>(onChange);
    expect(next).toHaveLength(3);
    expect(next[2].score).toBe(0);
  });
});

describe('stringList field — a combo’s includes[] sub-array', () => {
  const combos = [
    { name: 'Big Burger Combo', price: '$9.99', includes: ['1/3 lb cheeseburger', 'Sea-salt fries'] },
  ];

  it('renders the includes bullets joined one-per-line', () => {
    render(<ListItemsEditor label="Combos" itemNoun="combo" value={combos} onChange={jest.fn()} fields={COMBO_FIELDS} />);
    const ta = screen.getByLabelText(/combo 1 Includes/i) as HTMLTextAreaElement;
    expect(ta.value).toBe('1/3 lb cheeseburger\nSea-salt fries');
  });

  it('editing the textarea stores back a string[] (not a string), blanks dropped', () => {
    const onChange = jest.fn();
    render(<ListItemsEditor label="Combos" itemNoun="combo" value={combos} onChange={onChange} fields={COMBO_FIELDS} />);
    const ta = screen.getByLabelText(/combo 1 Includes/i);
    fireEvent.change(ta, { target: { value: 'Burger\n\n  Fries  \nDrink' } });
    const next = lastCall<Record<string, unknown>[]>(onChange);
    expect(Array.isArray(next[0].includes)).toBe(true);
    expect(next[0].includes).toEqual(['Burger', 'Fries', 'Drink']);
    expect(next[0].name).toBe('Big Burger Combo'); // sibling untouched
  });
});

describe('makeNewItem — unique id per added row (FITNESS_AD_BANNER creatives)', () => {
  const fields: ListItemFieldSpec[] = [
    { key: 'imageUrl', label: 'Image', type: 'image' },
    { key: 'headline', label: 'Headline', type: 'text' },
  ];

  it('two consecutive adds get distinct ids', () => {
    const onChange = jest.fn();
    let n = 0;
    const make = () => ({ id: `cr_${n++}`, imageUrl: '', headline: '' });

    const { rerender } = render(<ListItemsEditor label="Creatives" itemNoun="creative" value={[]} onChange={onChange} fields={fields} makeNewItem={make} />);
    fireEvent.click(screen.getByRole('button', { name: /add creative/i }));
    const first = lastCall<Record<string, unknown>[]>(onChange);
    expect(first[0].id).toBe('cr_0');

    rerender(<ListItemsEditor label="Creatives" itemNoun="creative" value={first} onChange={onChange} fields={fields} makeNewItem={make} />);
    fireEvent.click(screen.getByRole('button', { name: /add creative/i }));
    const second = lastCall<Record<string, unknown>[]>(onChange);
    expect(second).toHaveLength(2);
    expect(second[0].id).toBe('cr_0');
    expect(second[1].id).toBe('cr_1');
    expect(second[0].id).not.toBe(second[1].id);
  });
});

describe('StringListEditor — top-level string[] (RETAIL_LOYALTY_QR perks / RETAIL_PRICE_CALLOUT sellingPoints)', () => {
  const perks = ['Free to join', 'Members-only events', 'Birthday gift'];

  it('renders one input per string', () => {
    render(<StringListEditor label="Perks" itemNoun="perk" value={perks} onChange={jest.fn()} />);
    expect(screen.getByDisplayValue('Free to join')).toBeTruthy();
    expect(screen.getByDisplayValue('Members-only events')).toBeTruthy();
    expect(screen.getByDisplayValue('Birthday gift')).toBeTruthy();
  });

  it('editing a perk flows back as a plain string[] (no object wrapping)', () => {
    const onChange = jest.fn();
    render(<StringListEditor label="Perks" itemNoun="perk" value={perks} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue('Birthday gift'), { target: { value: 'Birthday reward' } });
    const next = lastCall<string[]>(onChange);
    expect(next).toEqual(['Free to join', 'Members-only events', 'Birthday reward']);
    expect(typeof next[0]).toBe('string'); // NOT { value: '...' }
  });

  it('Add is disabled at maxItems', () => {
    render(<StringListEditor label="Perks" itemNoun="perk" value={perks} onChange={jest.fn()} maxItems={3} />);
    const btn = screen.getByRole('button', { name: /max 3 perks/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('Remove deletes the right perk', () => {
    const onChange = jest.fn();
    render(<StringListEditor label="Perks" itemNoun="perk" value={perks} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /remove perk 2/i }));
    const next = lastCall<string[]>(onChange);
    expect(next).toEqual(['Free to join', 'Birthday gift']);
  });

  it('accepts a legacy JSON-string value without blanking', () => {
    render(<StringListEditor label="Perks" itemNoun="perk" value={JSON.stringify(perks)} onChange={jest.fn()} />);
    expect(screen.getByDisplayValue('Free to join')).toBeTruthy();
  });
});
