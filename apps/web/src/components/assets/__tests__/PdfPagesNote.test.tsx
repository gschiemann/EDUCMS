import { render, screen } from '@testing-library/react';
import { PdfPagesNote } from '../PdfPagesNote';

const BASE = 'https://x.supabase.co/storage/v1/object/public/assets/t/pdf-pages/a/k/';
const frame = (c: string) => ({ sha256: c.repeat(64), size: 10 });
const pdf = (pdfPages: unknown) => ({ mimeType: 'application/pdf', processingMeta: { pdfPages } });
const ready = (pages: number, count = pages) =>
  pdf({
    version: 1, state: 'ready', count, base: BASE, updatedAt: 'x',
    ...(count > pages ? { truncatedAt: pages } : {}),
    pages: Array.from({ length: pages }, (_, i) => ({
      n: i + 1, w: 1, h: 1,
      frames: { landscape: frame('a'), 'landscape-1080': frame('b'), portrait: frame('c'), 'portrait-1080': frame('d') },
    })),
  });

describe('PdfPagesNote — the Media Library says what screens are handed for a PDF', () => {
  it('preparing → "Preparing pages… 7 of 12"', () => {
    render(<PdfPagesNote asset={pdf({ version: 1, state: 'pending', count: 12, done: 7, updatedAt: 'x' })} variant="card" />);
    expect(screen.getByTestId('pdf-pages-preparing')).toHaveTextContent('Preparing pages… 7 of 12');
  });

  it('ready → the page count; capped → "Showing the first 60 of 214 pages"', () => {
    const { unmount } = render(<PdfPagesNote asset={ready(12)} variant="card" />);
    expect(screen.getByTestId('pdf-pages-ready')).toHaveTextContent('12 pages');
    unmount();
    render(<PdfPagesNote asset={ready(60, 214)} variant="row" />);
    expect(screen.getByTestId('pdf-pages-ready')).toHaveTextContent('Showing the first 60 of 214 pages');
  });

  it('failed → "This PDF can\'t be shown on screens: <reason>" in the details, short on a card', () => {
    const asset = pdf({ version: 1, state: 'failed', error: 'pdf-password-protected', updatedAt: 'x' });
    const { unmount } = render(<PdfPagesNote asset={asset} variant="detail" />);
    expect(screen.getByTestId('pdf-pages-failed')).toHaveTextContent(
      "This PDF can't be shown on screens: it is password-protected — remove the password and upload it again.",
    );
    unmount();
    render(<PdfPagesNote asset={asset} variant="card" />);
    expect(screen.getByTestId('pdf-pages-failed')).toHaveTextContent("Can't be shown on screens");
  });

  it('a PDF from before pages existed whose pages failed is marked too — it is still handed over as a PDF', () => {
    const asset = pdf({ version: 1, state: 'failed', error: 'page-render-failed', legacy: true, updatedAt: 'x' });
    const { unmount } = render(<PdfPagesNote asset={asset} variant="card" />);
    expect(screen.getByTestId('pdf-pages-failed')).toHaveTextContent("Can't be shown on screens");
    unmount();
    render(<PdfPagesNote asset={asset} variant="detail" />);
    expect(screen.getByTestId('pdf-pages-failed')).toHaveTextContent(
      "This PDF can't be shown on screens: the file could not be read as a PDF. Desktop players may still show it as a PDF; Android players cannot.",
    );
  });

  it('renders nothing for a PDF with no record, or for anything else', () => {
    const { container } = render(
      <>
        <PdfPagesNote asset={{ mimeType: 'application/pdf', processingMeta: null }} variant="card" />
        <PdfPagesNote asset={{ mimeType: 'image/png', processingMeta: null }} variant="card" />
      </>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
