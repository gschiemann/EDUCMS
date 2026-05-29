/**
 * Proof that the restaurant/bar/retail list editing Greg said was impossible
 * actually works now — a runnable test, not a static trace.
 *
 * Greg, 2026-05-28: "I have menus for restaurants, but how the fuck do I even
 * update the pricing?" Before ListItemsEditor, the only "editor" was a raw JSON
 * textarea. This test drives the new per-item UI the way an operator would:
 * type a new price into the price input and confirm it flows back out, add a
 * row, remove a row, reorder. If any of these break, this test fails.
 */
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ListItemsEditor } from '../PropertiesPanel';

const MENU_FIELDS = [
  { key: 'name', label: 'Name', type: 'text' as const },
  { key: 'price', label: 'Price', type: 'price' as const },
  { key: 'desc', label: 'Description', type: 'textarea' as const },
];

function setup(initial: Record<string, unknown>[]) {
  const onChange = jest.fn();
  const utils = render(
    <ListItemsEditor
      label="Menu items"
      itemNoun="item"
      value={initial}
      onChange={onChange}
      fields={MENU_FIELDS}
      newItem={{ name: 'New item', price: '$0.00', desc: '' }}
    />,
  );
  return { onChange, ...utils };
}

describe('ListItemsEditor — operators can actually edit menus', () => {
  const menu = [
    { name: 'Classic Burger', price: '$8.50', desc: 'cheddar, house sauce' },
    { name: 'Fries', price: '$3.00', desc: 'sea salt' },
  ];

  it('renders one editable card per item with the price visible in an input', () => {
    setup(menu);
    expect(screen.getByDisplayValue('Classic Burger')).toBeTruthy();
    expect(screen.getByDisplayValue('$8.50')).toBeTruthy();
    expect(screen.getByDisplayValue('Fries')).toBeTruthy();
    expect(screen.getByDisplayValue('$3.00')).toBeTruthy();
  });

  it('editing a price flows back through onChange (THE core complaint)', () => {
    const { onChange } = setup(menu);
    const priceInput = screen.getByDisplayValue('$8.50');
    fireEvent.change(priceInput, { target: { value: '$9.25' } });
    expect(onChange).toHaveBeenCalled();
    const next = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(next[0].price).toBe('$9.25');
    expect(next[0].name).toBe('Classic Burger'); // untouched
    expect(next[1].price).toBe('$3.00'); // untouched
  });

  it('Add item appends a new editable row', () => {
    const { onChange } = setup(menu);
    fireEvent.click(screen.getByRole('button', { name: /add item/i }));
    const next = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(next).toHaveLength(3);
    expect(next[2].name).toBe('New item');
  });

  it('Remove deletes the right row', () => {
    const { onChange } = setup(menu);
    fireEvent.click(screen.getByRole('button', { name: /remove item 1/i }));
    const next = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(next).toHaveLength(1);
    expect(next[0].name).toBe('Fries');
  });

  it('Move down reorders items', () => {
    const { onChange } = setup(menu);
    fireEvent.click(screen.getByRole('button', { name: /move item 1 down/i }));
    const next = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(next[0].name).toBe('Fries');
    expect(next[1].name).toBe('Classic Burger');
  });

  it('accepts a legacy JSON-string value without blanking (back-compat)', () => {
    const onChange = jest.fn();
    render(
      <ListItemsEditor
        label="Menu items"
        value={JSON.stringify(menu)}
        onChange={onChange}
        fields={MENU_FIELDS}
      />,
    );
    expect(screen.getByDisplayValue('Classic Burger')).toBeTruthy();
    expect(screen.getByDisplayValue('$8.50')).toBeTruthy();
  });

  it('renders empty-state for a never-configured widget', () => {
    setup([]);
    expect(screen.getByText(/no items yet/i)).toBeTruthy();
  });
});
