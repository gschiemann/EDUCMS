import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { LocationFilter } from '../LocationFilter';

function Filter() {
  const [value, setValue] = React.useState<string[]>([]);
  return <LocationFilter locations={[{ id: 'c', name: 'Corporate' }, { id: 'b', name: 'Boston' }, { id: 'a', name: 'Austin' }]} value={value} onChange={setValue} />;
}
const trigger = () => screen.getByRole('button', { name: 'Filter by location' });
const pick = (name: string) => fireEvent.click(screen.getByRole('checkbox', { name: `Select ${name}` }));

it('keeps the dropdown open for multiple choices, searches all names and resets to all', () => {
  render(<Filter />);
  fireEvent.click(trigger());
  expect(screen.getByRole('checkbox', { name: 'All locations' })).toBeChecked();
  pick('Austin'); pick('Boston');
  expect(trigger()).toHaveTextContent('2 locations selected');
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'CORP' } });
  expect(screen.queryByRole('checkbox', { name: 'Select Austin' })).not.toBeInTheDocument();
  pick('Corporate');
  expect(trigger()).toHaveTextContent('3 locations selected');
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
  expect(screen.getByRole('checkbox', { name: 'Select Austin' })).toBeChecked();
  fireEvent.click(screen.getByRole('checkbox', { name: 'All locations' }));
  expect(trigger()).toHaveTextContent('All locations');
  expect(screen.getByRole('checkbox', { name: 'Select Austin' })).not.toBeChecked();
});

it('returns to all when the final location is unchecked', () => {
  render(<Filter />); fireEvent.click(trigger()); pick('Boston'); pick('Boston');
  expect(trigger()).toHaveTextContent('All locations');
  expect(screen.getByRole('checkbox', { name: 'All locations' })).toBeChecked();
});

it('focuses search, closes on Escape and returns focus to the trigger', () => {
  render(<Filter />); fireEvent.click(trigger());
  expect(screen.getByRole('searchbox')).toHaveFocus();
  fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' });
  expect(trigger()).toHaveAttribute('aria-expanded', 'false');
  expect(trigger()).toHaveFocus();
});

it('shows no matching names and dismisses on an outside click', () => {
  render(<Filter />); fireEvent.click(trigger());
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'missing' } });
  expect(screen.getByText('No matching locations')).toBeInTheDocument();
  fireEvent.mouseDown(document.body);
  expect(trigger()).toHaveAttribute('aria-expanded', 'false');
});
