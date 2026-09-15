/**
 * The import capability contract, decided from bytes.
 *
 * Each case here is a real failure the byte-level check exists to stop:
 * a .pptx that arrives as `application/octet-stream` and is then rejected by
 * storage; a legacy .ppt accepted on its extension that ends up as an
 * `<img src="deck.ppt">`; a file that claims to be a PDF and is not.
 */
import JSZip from 'jszip';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sniffImportFormat, MIME_FOR_FORMAT } from './file-signature';

const FIXTURES = join(
  __dirname, '..', '..', '..', '..',
  'docs/design/proposals/2026-09-15-template-import-audit/evidence',
);

/**
 * A real .pptx: OOXML part names live uncompressed in the zip, in both the
 * local file headers and the central directory.
 *
 * `mediaFirst` writes the big media part BEFORE `ppt/presentation.xml`, which
 * pushes that part's local header past any head window — so only the central
 * directory at the end of the archive still names it. That is the case the
 * tail scan exists for, and PowerPoint really does interleave media this way.
 * Filler is random because a zero-filled buffer DEFLATEs to nothing and the
 * archive would stay small.
 */
async function pptxBytes(opts: { fillerBytes?: number; mediaFirst?: boolean } = {}): Promise<Buffer> {
  const { fillerBytes = 0, mediaFirst = false } = opts;
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types/>');
  if (mediaFirst && fillerBytes > 0) zip.file('ppt/media/image1.png', randomBytes(fillerBytes));
  zip.file('ppt/presentation.xml', '<?xml version="1.0"?><p:presentation/>');
  zip.file('ppt/slides/slide1.xml', '<?xml version="1.0"?><p:sld/>');
  if (!mediaFirst && fillerBytes > 0) zip.file('ppt/media/image1.png', randomBytes(fillerBytes));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

describe('sniffImportFormat', () => {
  it('accepts a real PDF regardless of what the browser called it', () => {
    const pdf = readFileSync(join(FIXTURES, 'mixed-layout.pdf'));
    const r = sniffImportFormat(pdf, 'whatever.bin');
    expect(r).toMatchObject({ ok: true, format: 'pdf', mime: MIME_FOR_FORMAT.pdf });
  });

  it('accepts a .pptx that arrived as a generic binary', async () => {
    // The exact case that reached storage as octet-stream and was rejected
    // there: the bytes are a perfectly good deck.
    const r = sniffImportFormat(await pptxBytes(), 'Assembly.pptx');
    expect(r).toMatchObject({ ok: true, format: 'pptx', mime: MIME_FOR_FORMAT.pptx });
  });

  it('finds the presentation part when media pushes it past the head window', async () => {
    // Media written first, so `ppt/presentation.xml`'s local header sits
    // megabytes in. Only the central directory at the end of the archive still
    // names it — this is the case the tail scan earns its place on, and the
    // negative control for it is removing that scan.
    const big = await pptxBytes({ fillerBytes: 3 * 1024 * 1024, mediaFirst: true });
    expect(big.length).toBeGreaterThan(1024 * 1024);
    expect(big.indexOf('ppt/presentation.xml', 0, 'latin1')).toBeGreaterThan(64 * 1024);
    expect(sniffImportFormat(big)).toMatchObject({ ok: true, format: 'pptx' });
  });

  it('rejects legacy binary .ppt with the one-click fix, not a parse failure', () => {
    // OLE2 compound-file header — what a real .ppt starts with.
    const ppt = Buffer.concat([
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
      Buffer.alloc(512, 0),
    ]);
    const r = sniffImportFormat(ppt, 'Assembly.ppt');
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.code).toBe('IMPORTS_LEGACY_PPT');
    expect(r.message).toMatch(/\.pptx|PDF/);
  });

  it('tells a Word or Excel upload what to do instead', async () => {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<Types/>');
    zip.file('word/document.xml', '<w:document/>');
    const r = sniffImportFormat(await zip.generateAsync({ type: 'nodebuffer' }), 'Newsletter.docx');
    expect(r).toMatchObject({ ok: false, code: 'IMPORTS_OFFICE_NOT_PRESENTATION' });
  });

  it('rejects a plain zip that is not a presentation', async () => {
    const zip = new JSZip();
    zip.file('notes.txt', 'hello');
    const r = sniffImportFormat(await zip.generateAsync({ type: 'nodebuffer' }), 'stuff.zip');
    expect(r).toMatchObject({ ok: false, code: 'IMPORTS_ZIP_NOT_PPTX' });
  });

  it('rejects a file that merely CLAIMS to be a PDF', () => {
    const r = sniffImportFormat(Buffer.from('this is not a pdf, it is prose'), 'report.pdf');
    expect(r).toMatchObject({ ok: false, code: 'IMPORTS_UNSUPPORTED_FORMAT' });
  });

  it('rejects an empty file before anything tries to parse it', () => {
    expect(sniffImportFormat(Buffer.alloc(0), 'empty.pdf'))
      .toMatchObject({ ok: false, code: 'IMPORTS_EMPTY_FILE' });
  });

  it.each([
    ['png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])],
    ['jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])],
    ['webp', Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(4)])],
  ])('accepts a real %s by its magic bytes', (format, bytes) => {
    expect(sniffImportFormat(bytes as Buffer)).toMatchObject({ ok: true, format });
  });

  it('never lets the filename decide — a .pptx name over PDF bytes is a PDF', () => {
    // Negative control for the whole module: if the implementation ever
    // consults the extension, this flips.
    const pdf = readFileSync(join(FIXTURES, 'mixed-layout.pdf'));
    expect(sniffImportFormat(pdf, 'definitely-a-deck.pptx')).toMatchObject({ format: 'pdf' });
  });
});

describe('sniffImportFormat — our own template file', () => {
  it('recognises a VenueOS export by its envelope, not its extension', () => {
    const envelope = Buffer.from(JSON.stringify({
      _format: 'educms.template', _version: 1,
      template: { name: 'Front desk kiosk', zones: [] },
    }));
    expect(sniffImportFormat(envelope, 'anything.txt')).toMatchObject({
      ok: true, format: 'venueos', mime: 'application/json',
    });
  });

  it('does not claim ordinary JSON', () => {
    const other = Buffer.from(JSON.stringify({ hello: 'world', zones: [] }));
    expect(sniffImportFormat(other, 'config.json')).toMatchObject({
      ok: false, code: 'IMPORTS_UNSUPPORTED_FORMAT',
    });
  });
});

