/**
 * QA 2026-10-23: "Upload 5 files" in the New Playlist wizard queued every
 * file TWICE under React StrictMode — the uploads were started inside a
 * setState updater, and React may call an updater more than once. Ten
 * uploads, ten library rows, ten complete-upload calls for five files.
 * The start must run exactly once per click, StrictMode or not.
 */
import * as React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

const start = jest.fn((files: File[]) => files.map((_, i) => `job-${i}`));
jest.mock('@/hooks/use-library-uploads', () => ({
  useLibraryUploads: () => ({ uploads: [], start, retry: jest.fn() }),
}));
jest.mock('@/hooks/use-file-picker', () => ({
  useFilePicker: () => ({ ios: false, open: jest.fn() }),
}));

import { WizardMediaUpload } from '../WizardMediaUpload';

it('starts the selected uploads once per click, even under StrictMode', () => {
  render(
    <React.StrictMode>
      <WizardMediaUpload folderId={null} folderName="All media" onUploaded={jest.fn()} onBusy={jest.fn()} />
    </React.StrictMode>,
  );
  const files = [0, 1, 2, 3, 4].map((i) => new File(['x'], `clip-${i}.mp4`, { type: 'video/mp4' }));
  fireEvent.change(screen.getByLabelText('Choose playlist files'), { target: { files } });
  fireEvent.click(screen.getByRole('button', { name: /Upload 5/ }));
  expect(start).toHaveBeenCalledTimes(1);
  expect(start.mock.calls[0][0]).toHaveLength(5);
});
