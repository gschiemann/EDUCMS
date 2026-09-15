/**
 * Resource guards on the import converter (2026-09-15).
 *
 * WHY THIS FILE EXISTS. Conversion runs inside the API request, and
 * `railway.json` sets `numReplicas: 1` — so the process that parses a hostile
 * upload is the same one that publishes lockdown alerts. The pre-existing
 * decompression-bomb guard sums the sizes an archive DECLARES in its central
 * directory, and its own comment admitted the hole: "a liar-zip that
 * under-declares its sizes is a deeper attack — a per-part streaming cap is
 * the follow-up."
 *
 * A small upload that PASSES the declared guard was measured inflating to
 * hundreds of MB of live Buffers in the API process. Those bytes are EXTERNAL
 * memory, so a heap ceiling never sees them; only the container OOM killer
 * fires, and it takes /emergency/trigger with it.
 *
 * These tests build REAL archives and call the REAL parser.
 */
import JSZip from 'jszip';
import { parsePptx } from './pptx-parser';

/** Minimal presentation.xml so the parser gets past slide sizing. */
const PRESENTATION_XML =
  `<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">` +
  `<p:sldSz cx="12192000" cy="6858000"/></p:presentation>`;

function slideXml(): string {
  return (
    `<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ` +
    `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<p:cSld><p:spTree>` +
    `<p:pic><p:blipFill><a:blip r:embed="rId1"/></p:blipFill>` +
    `<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="6096000" cy="3429000"/></a:xfrm></p:spPr></p:pic>` +
    `</p:spTree></p:cSld></p:sld>`
  );
}

function relsXml(target: string): string {
  return (
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" ` +
    `Target="../media/${target}"/></Relationships>`
  );
}

/**
 * A deck whose media parts are highly compressible, so the ARCHIVE is small
 * while the decompressed bytes are not — exactly the shape the declared-size
 * guard cannot see.
 */
async function buildDeck(parts: number, bytesPerPart: number): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('ppt/presentation.xml', PRESENTATION_XML);
  // One slide is enough: media is collected globally, before the slide loop.
  zip.file('ppt/slides/slide1.xml', slideXml());
  zip.file('ppt/slides/_rels/slide1.xml.rels', relsXml('image0.png'));
  for (let i = 0; i < parts; i++) {
    // Zero-filled: compresses to almost nothing, inflates to bytesPerPart.
    zip.file(`ppt/media/image${i}.png`, Buffer.alloc(bytesPerPart, 0));
    if (i > 0) {
      zip.file(`ppt/slides/slide${i + 1}.xml`, slideXml());
      zip.file(
        `ppt/slides/_rels/slide${i + 1}.xml.rels`,
        relsXml(`image${i}.png`),
      );
    }
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

describe('import converter resource guards', () => {
  jest.setTimeout(60_000);

  it('rejects a deck whose media inflates past the byte ceiling, however small the upload', async () => {
    // 20 × 8 MB = 160 MB decompressed, from an archive of a few hundred KB.
    const deck = await buildDeck(20, 8 * 1024 * 1024);
    expect(deck.length).toBeLessThan(2 * 1024 * 1024); // the upload really is small

    await expect(parsePptx(deck)).rejects.toThrow(
      /exceed .*MB once decompressed/i,
    );
  });

  it('rejects a deck with an absurd number of embedded parts', async () => {
    // Tiny parts, so the byte ceiling is not what trips: the part count is.
    const deck = await buildDeck(400, 16);
    await expect(parsePptx(deck)).rejects.toThrow(/more than \d+ images/i);
  });

  it('still converts an ordinary deck with real imagery', async () => {
    // 6 × 1 MB = 6 MB — a normal photo deck, comfortably under the ceiling.
    const deck = await buildDeck(6, 1024 * 1024);
    const doc = await parsePptx(deck);
    expect(doc.pages.length).toBeGreaterThan(0);
    expect(doc.media.length).toBe(6);
    expect(doc.media.reduce((n, m) => n + m.data.length, 0)).toBe(
      6 * 1024 * 1024,
    );
  });

  it('peak resident memory stays bounded while parsing a rejected deck', async () => {
    // The point of the guard is that it fires BEFORE the process is in
    // trouble. Measure RSS across the rejection rather than trusting heapUsed,
    // which never sees Buffer bytes.
    const deck = await buildDeck(20, 8 * 1024 * 1024);
    const before = process.memoryUsage().rss;
    await expect(parsePptx(deck)).rejects.toThrow();
    const grew = process.memoryUsage().rss - before;
    // 160 MB of media would have been held without the cap; allow generous
    // slack for the archive itself and V8 noise, but nothing near that.
    expect(grew).toBeLessThan(120 * 1024 * 1024);
  });
});
