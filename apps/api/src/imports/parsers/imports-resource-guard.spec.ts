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

  it('brackets the byte ceiling exactly: just under converts, just over throws', async () => {
    // This replaced an RSS measurement (2026-09-15). Resident memory is the
    // thing we actually care about, but it is not a deterministic assertion —
    // under `--maxWorkers=4` it competes with three other Jest processes and
    // the reading moves, which made the suite flaky in CI. Bracketing the
    // bound proves the same property without measuring the machine: the
    // accumulator fires on real inflated bytes, at the right threshold.
    const PART = 8 * 1024 * 1024;
    const underCap = Math.floor((64 * 1024 * 1024) / PART); // 8 parts = 64MB exactly
    const under = await parsePptx(await buildDeck(underCap, PART));
    expect(under.media.reduce((n, m) => n + m.data.length, 0)).toBe(underCap * PART);

    await expect(parsePptx(await buildDeck(underCap + 1, PART)))
      .rejects.toThrow(/exceed .*MB once decompressed/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F-08, the XML half (launch re-audit 2026-09-22). The media cap above never
// bounded slide/layout/master/theme MARKUP, which was inflated whole and
// never summed — and XML compresses far better than a zero-filled PNG.
// ─────────────────────────────────────────────────────────────────────────────

/** A slide whose markup is padded with `padBytes` of whitespace inside a comment. */
function paddedSlideXml(padBytes: number): string {
  return (
    `<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ` +
    `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
    `<!--${' '.repeat(padBytes)}--><p:cSld><p:spTree/></p:cSld></p:sld>`
  );
}

/** A deck whose XML parts are tiny on the wire and huge once inflated. */
async function buildXmlBomb(slides: number, padBytesPerSlide: number): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('ppt/presentation.xml', PRESENTATION_XML);
  for (let i = 1; i <= slides; i++) {
    zip.file(`ppt/slides/slide${i}.xml`, paddedSlideXml(padBytesPerSlide));
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

describe('import converter resource guards — XML markup', () => {
  jest.setTimeout(60_000);

  it('rejects a deck whose slide markup inflates past the XML ceiling, however small the upload', async () => {
    // 10 slides × 8MB of whitespace = 80MB of markup from an archive of a few KB.
    const deck = await buildXmlBomb(10, 8 * 1024 * 1024);
    expect(deck.length).toBeLessThan(256 * 1024); // the upload really is small

    await expect(parsePptx(deck)).rejects.toThrow(/slide markup exceeds .*MB once decompressed/i);
  });

  it('refuses a SINGLE lying part before it has inflated whole', async () => {
    // One 48MB slide: the old whole-part read would have held all 48MB before
    // any check ran. The bounded reader stops pulling at the 32MB budget.
    const deck = await buildXmlBomb(1, 48 * 1024 * 1024);
    const before = process.memoryUsage().arrayBuffers;
    await expect(parsePptx(deck)).rejects.toThrow(/slide markup exceeds/i);
    // Coarse but real: had the part inflated whole, ≥48MB of Buffer would have
    // been allocated at once; the stream is cut at ≤32MB (+ one chunk).
    const grew = process.memoryUsage().arrayBuffers - before;
    expect(grew).toBeLessThan(40 * 1024 * 1024);
  });

  it('brackets the XML ceiling: just under converts, over throws', async () => {
    // Slide markup is charged per slide; presentation.xml + rels are a few
    // hundred bytes, so 31 × 1MB stays under and 33 × 1MB goes over.
    const MB = 1024 * 1024;
    const under = await parsePptx(await buildXmlBomb(31, MB));
    expect(under.pages.length).toBe(31);

    await expect(parsePptx(await buildXmlBomb(33, MB))).rejects.toThrow(
      /slide markup exceeds/i,
    );
  });

  it('still converts an ordinary deck (the media fixture) unchanged', async () => {
    const doc = await parsePptx(await buildDeck(3, 200 * 1024));
    expect(doc.pages.length).toBe(3);
    expect(doc.media.length).toBe(3);
  });
});
