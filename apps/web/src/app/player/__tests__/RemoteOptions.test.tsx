import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { RemoteOptions } from '../RemoteOptions';

const press = (key: string) => {
  fireEvent.keyDown(document.activeElement!, { key });
  fireEvent.keyUp(document.activeElement!, { key });
};

test('offline recovery menu owns remote focus, skips disabled actions, and traps Tab', () => {
  const action = jest.fn();
  render(<><button>Pair underneath</button><RemoteOptions aria-label="Screen options">
    <button>Keep waiting</button><button disabled>Unavailable</button>
    <button onClick={action}>Network</button><button>Exit to launcher</button>
  </RemoteOptions></>);
  const waiting = screen.getByText('Keep waiting');
  const network = screen.getByText('Network');
  expect(document.activeElement).toBe(waiting);
  press('ArrowDown');
  expect(document.activeElement).toBe(network);
  expect(network.getAttribute('data-remote-focused')).toBe('true');
  expect(waiting.hasAttribute('data-remote-focused')).toBe(false);
  press('Select');
  expect(action).toHaveBeenCalledTimes(1);
  press('Tab'); press('Tab');
  expect(document.activeElement).toBe(waiting);
  screen.getByText('Pair underneath').focus();
  expect(document.activeElement).toBe(waiting);
  press('ArrowLeft');
  expect(document.activeElement).toBe(screen.getByText('Exit to launcher'));
});

test('opening release and held OK never activate; release cannot click through after closing', () => {
  const action = jest.fn();
  const behind = jest.fn();
  const { rerender } = render(<RemoteOptions><button onClick={action}>Keep waiting</button></RemoteOptions>);
  fireEvent.keyUp(document.activeElement!, { key: 'Enter' });
  expect(action).not.toHaveBeenCalled();
  fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
  fireEvent.keyDown(document.activeElement!, { key: 'Enter', repeat: true });
  fireEvent.keyUp(document.activeElement!, { key: 'Enter' });
  expect(action).not.toHaveBeenCalled();
  rerender(<RemoteOptions><button onClick={() => {
    action();
    rerender(<button onClick={behind}>Pair underneath</button>);
  }}>Keep waiting</button></RemoteOptions>);
  press(' ');
  expect(action).toHaveBeenCalledTimes(1);
  expect(behind).not.toHaveBeenCalled();
});

test('Back stays with page authority and remote handlers are removed on unmount', () => {
  const back = jest.fn();
  const listener = (e: KeyboardEvent) => { if (e.key === 'Escape') back(); };
  window.addEventListener('keydown', listener);
  const { unmount } = render(<RemoteOptions><button>Retry now</button></RemoteOptions>);
  press('Escape');
  expect(back).toHaveBeenCalledTimes(1);
  unmount();
  const key = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
  window.dispatchEvent(key);
  expect(key.defaultPrevented).toBe(false);
  window.removeEventListener('keydown', listener);
});
