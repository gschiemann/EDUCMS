/**
 * The review step is the reason this screen was rebuilt, so these are its
 * promises:
 *
 *   - every source page appears, including ones that converted to nothing;
 *   - the number on the button is the number that gets created;
 *   - a page you deselect is reported, not silently dropped;
 *   - the operator is shown the CONVERTED page, never the file they uploaded;
 *   - a picture is shown only when it is the output of the mode chosen;
 *   - a mode a page cannot do is never offered, and a PDF page is promised
 *     nothing it will not get.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';

const apiFetch = jest.fn();
jest.mock('@/lib/api-client', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));
const push = jest.fn();
jest.mock('next/navigation', () => ({
  useParams: () => ({ schoolId: 'springfield' }),
  useRouter: () => ({ push }),
}));

import DesignImportsPage from '../page';
import type { ImportManifest } from '../import-types';

const manifest: ImportManifest = {
  version: 1,
  format: 'pdf',
  sourcePageCount: 3,
  warnings: [{ code: 'PAGES_TRUNCATED', detail: 'Only the first 2 of 3 pages were rendered.' }],
  pages: [
    {
      // A PDF page comes in as the page it is: `preserve`, and nothing else.
      sourcePage: 1, label: 'Page 1', disposition: 'converted',
      availableModes: ['preserve'], defaultMode: 'preserve',
      editableTextCount: 0, editableImageCount: 0,
      previewUrl: 'https://signed.example/p1.webp', thumbUrl: 'https://signed.example/p1t.webp',
      widthPx: 1484, heightPx: 1920, warnings: [],
    },
    {
      sourcePage: 2, label: 'Page 2', disposition: 'converted',
      availableModes: ['preserve'], defaultMode: 'preserve',
      editableTextCount: 0, editableImageCount: 0,
      previewUrl: 'https://signed.example/p2.webp', thumbUrl: 'https://signed.example/p2t.webp',
      widthPx: 1484, heightPx: 1920, warnings: [],
    },
    {
      // Past the render cap — listed so it cannot be missed.
      sourcePage: 3, label: 'Page 3', disposition: 'excluded-by-limit',
      availableModes: [], defaultMode: null,
      editableTextCount: 0, editableImageCount: 0, warnings: [],
    },
  ],
};

const pdf = () => new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'Assembly.pdf', { type: 'application/pdf' });

async function toReview() {
  apiFetch.mockResolvedValueOnce({ ok: true, jobId: 'job-1', manifest });
  const utils = render(<DesignImportsPage />);
  fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [pdf()] } });
  await screen.findByRole('checkbox', { name: 'Include Page 1' });
  return utils;
}

beforeEach(() => { apiFetch.mockReset(); push.mockReset(); });

describe('import review', () => {
  it('lists EVERY source page, including one past the page limit', async () => {
    await toReview();
    for (const label of ['Page 1', 'Page 2', 'Page 3']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    // The unconvertible page is present but cannot be selected.
    expect(screen.getByRole('checkbox', { name: 'Include Page 3' })).toBeDisabled();
  });

  it('shows the CONVERTED page, not the file that was uploaded', async () => {
    await toReview();
    const img = screen.getByAltText('Page 1, converted') as HTMLImageElement;
    expect(img.src).toBe('https://signed.example/p1.webp');
    // The old screen rendered a blob: URL of the source file here.
    expect(img.src).not.toMatch(/^blob:/);
  });

  it('the button says exactly what will be created, and follows the selection', async () => {
    await toReview();
    expect(screen.getByRole('button', { name: 'Add 2 templates' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include Page 2' }));
    expect(screen.getByRole('button', { name: 'Add 1 template' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include Page 1' }));
    expect(screen.getByRole('button', { name: 'Choose a page' })).toBeDisabled();
  });

  it('says out loud how many pages you left behind', async () => {
    await toReview();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include Page 2' }));
    expect(screen.getByText(/1 you unselected is not being added/i)).toBeInTheDocument();
    expect(screen.getByText(/1 could not be converted at all/i)).toBeInTheDocument();
  });

  it('offers a PDF page as the page it is, and nothing else', async () => {
    await toReview();
    for (const label of [/^Page 1/, /^Page 2/]) {
      fireEvent.click(screen.getByRole('button', { name: label }));
      expect(screen.getByRole('radio', { name: /Keep the look/ })).toBeChecked();
      expect(screen.queryByRole('radio', { name: /Editable layers/ })).not.toBeInTheDocument();
    }
  });

  it('surfaces truncation up front, rather than after the fact', async () => {
    await toReview();
    expect(screen.getByText(/Only the first 2 of 3 pages were rendered/)).toBeInTheDocument();
  });

  it('commits exactly the pages and modes on screen', async () => {
    await toReview();
    apiFetch.mockResolvedValueOnce({
      ok: true,
      templates: [
        { id: 't1', name: 'Assembly — Page 1', sourcePage: 1, mode: 'preserve' },
        { id: 't2', name: 'Assembly — Page 2', sourcePage: 2, mode: 'preserve' },
      ],
      skippedPages: [],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add 2 templates' }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));
    const [url, init] = apiFetch.mock.calls[1];
    expect(url).toBe('/imports/jobs/job-1/commit');
    expect(JSON.parse(init.body)).toEqual({
      selections: [
        { sourcePage: 1, mode: 'preserve' },
        { sourcePage: 2, mode: 'preserve' },
      ],
    });
    expect(await screen.findByText('Added 2 templates')).toBeInTheDocument();
  });

  it('a failed commit returns to review with the reason, keeping the selection', async () => {
    await toReview();
    apiFetch.mockRejectedValueOnce(new Error('That import has expired or does not exist.'));
    fireEvent.click(screen.getByRole('button', { name: 'Add 2 templates' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/has expired/);
    expect(screen.getByRole('button', { name: 'Add 2 templates' })).toBeInTheDocument();
  });

  it('explains a missing mode instead of leaving it mysteriously absent', async () => {
    apiFetch.mockResolvedValueOnce({
      ok: true, jobId: 'j2',
      manifest: {
        ...manifest, format: 'pptx',
        preserveUnavailableReason: 'For a pixel-faithful import, export the deck to PDF and import that.',
        pages: [{
          ...manifest.pages[0], label: 'Slide 1', availableModes: ['editable'], defaultMode: 'editable',
          editableTextCount: 3, editableImageCount: 1, previewUrl: undefined, thumbUrl: undefined,
        }],
      },
    });
    render(<DesignImportsPage />);
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [pdf()] } });
    expect(await screen.findByText(/export the deck to PDF/i)).toBeInTheDocument();
  });

  it('does not convert on the client — prepare is a server call before anything is shown', async () => {
    await toReview();
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch.mock.calls[0][0]).toBe('/imports/prepare');
  });

  it('shows a picture only while it is the output of the mode chosen', async () => {
    // Nothing this build prepares offers a page both ways, but a stale job
    // could, and the screen used to show the render whichever was picked —
    // the original, presented as evidence of an editable conversion (R2).
    apiFetch.mockResolvedValueOnce({
      ok: true, jobId: 'j3',
      manifest: { ...manifest, pages: [{ ...manifest.pages[0], availableModes: ['preserve', 'editable'] }] },
    });
    render(<DesignImportsPage />);
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [pdf()] } });
    expect(await screen.findByAltText('Page 1, converted')).toHaveAttribute('src', 'https://signed.example/p1.webp');

    fireEvent.click(screen.getByRole('radio', { name: /Editable layers/ }));
    expect(screen.queryByAltText('Page 1, converted')).not.toBeInTheDocument();
    // The list thumbnail is the same render, so it goes as well.
    expect(document.querySelector('img[src="https://signed.example/p1t.webp"]')).toBeNull();
    expect(screen.getByText(/which you can see once it is added/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: /Keep the look/ }));
    expect(screen.getByAltText('Page 1, converted')).toHaveAttribute('src', 'https://signed.example/p1.webp');
    expect(document.querySelector('img[src="https://signed.example/p1t.webp"]')).not.toBeNull();
  });

  it('promises a PDF page nothing it will not get', async () => {
    await toReview();
    expect(screen.getByText(/Your design stays intact, as an image/)).toBeInTheDocument();
    expect(screen.getByText(/add new text, QR codes and live widgets on top/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/retype|restyle|pictures become/i);
  });

  it('does not claim to pull text out of a file while it prepares', async () => {
    apiFetch.mockReturnValueOnce(new Promise(() => undefined));
    render(<DesignImportsPage />);
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [pdf()] } });
    expect(await screen.findByText(/Nothing is added yet/)).toBeInTheDocument();
    expect(screen.queryByText(/pulling out the text/i)).not.toBeInTheDocument();
  });
});

/**
 * A VenueOS template file is restored, not converted — the file IS the
 * template. The route, the hook and a file picker for this all existed; what
 * was missing was any way to reach them.
 */
describe('restoring a VenueOS template file', () => {
  const envelope = {
    _format: 'educms.template',
    _version: 1,
    template: { name: 'Front desk kiosk', zones: [] },
  };
  const jsonFile = () =>
    new File([JSON.stringify(envelope)], 'front-desk.educms-template.json', { type: 'application/json' });

  it('goes straight to the template route, never through conversion', async () => {
    apiFetch.mockResolvedValueOnce({ id: 'tpl-9', name: 'Front desk kiosk' });
    render(<DesignImportsPage />);
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [jsonFile()] } });
    expect(await screen.findByText('Added 1 template')).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch.mock.calls[0][0]).toBe('/templates/import');
    // There is nothing to review, so the review step is skipped entirely.
    expect(screen.queryByRole('checkbox', { name: /^Include / })).not.toBeInTheDocument();
  });

  it('says so plainly when the file is not readable', async () => {
    render(<DesignImportsPage />);
    const broken = new File(['{ not json'], 'broken.json', { type: 'application/json' });
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [broken] } });
    expect(await screen.findByRole('alert')).toHaveTextContent(/not readable as a VenueOS template export/i);
    expect(apiFetch).not.toHaveBeenCalled();
  });
});

