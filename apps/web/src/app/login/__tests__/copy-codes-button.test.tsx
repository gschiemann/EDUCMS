/** @jest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { CopyCodesButton } from '../CopyCodesButton';

const props = { codes: ['AAAA1111', 'BBBB2222'], label: 'Copy all codes', copiedLabel: 'Copied', failedLabel: "Couldn't copy" };

afterEach(() => { jest.restoreAllMocks(); });

it('copies every code, one per line, and says it worked', async () => {
  const writeText = jest.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  render(<CopyCodesButton {...props} />);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy all codes' })); });
  expect(writeText).toHaveBeenCalledWith('AAAA1111\nBBBB2222');
  expect(screen.getByRole('button', { name: /Copied/ })).toBeInTheDocument();
});

it('falls back to select-and-copy when the Clipboard API refuses', async () => {
  Object.assign(navigator, { clipboard: { writeText: jest.fn().mockRejectedValue(new Error('denied')) } });
  (document as any).execCommand = jest.fn().mockReturnValue(true);
  render(<CopyCodesButton {...props} />);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy all codes' })); });
  expect((document as any).execCommand).toHaveBeenCalledWith('copy');
  expect(screen.getByRole('button', { name: /Copied/ })).toBeInTheDocument();
});

it('says so — and shows no false "Copied" — when nothing could be copied', async () => {
  Object.assign(navigator, { clipboard: { writeText: jest.fn().mockRejectedValue(new Error('denied')) } });
  (document as any).execCommand = jest.fn().mockReturnValue(false);
  render(<CopyCodesButton {...props} />);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy all codes' })); });
  expect(screen.getByText("Couldn't copy")).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Copied/ })).toBeNull();
});
