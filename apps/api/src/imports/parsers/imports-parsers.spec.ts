/**
 * Import 2.0 parser tests.
 *
 * Covers, per the spec:
 *   1. The PPTX unit math — EMU → %-of-canvas and `sz` → fontSize(px).
 *   2. A real PPTX round-trip: a synthesized .pptx (built with jszip,
 *      the same lib the parser reads with) → editable TEXT/IMAGE zones
 *      with the right positions, fontSize, color, and a resolved image
 *      Asset URL.
 *   3. Page ACCOUNTING: a slide that converts to nothing is reported as
 *      such, never deleted.
 *
 * ⚠️ 2026-09-15 — two tests in this file were REWRITTEN, not deleted.
 * They asserted behaviour the audit proved wrong:
 *
 *   • "buildTemplates … + drops unresolved" ended with
 *     `expect(builtNoMedia.find(t => t.label === 'Slide 2')).toBeUndefined()`
 *     — it blessed a slide DISAPPEARING because its picture failed to
 *     upload. The zone still cannot be shown, but the page is now
 *     reported with disposition `empty` and a `MEDIA_UNRESOLVED`
 *     warning. The coverage is kept and strengthened.
 *   • "buildTemplates returns [] for an empty parse" asserted a page with
 *     no zones was "dropped entirely". It is now accounted for; only the
 *     TEMPLATE list is empty.
 *
 * The other tests here are unchanged.
 */

import JSZip from 'jszip';
import {
  emuToPx,
  ptToPx,
  pptSzToFontSizePx,
  pxRectToPercent,
  ooxmlColorToHex,
  matrixMultiply,
  matrixScale,
  EMU_PER_INCH,
  PX_PER_INCH,
} from './units';
import { parsePptx } from './pptx-parser';
import { buildImport, buildTemplates } from './import-builder';
import type { ParsedDocument } from './types';

describe('Import 2.0 unit conversions', () => {
  it('converts EMU → px at 914400 EMU = 1in = 96px', () => {
    expect(emuToPx(EMU_PER_INCH)).toBeCloseTo(PX_PER_INCH, 6); // 1 inch
    expect(emuToPx(0)).toBe(0);
    // A standard 13.333in (12192000 EMU) wide slide → 1280px.
    expect(Math.round(emuToPx(12192000))).toBe(1280);
    // 7.5in (6858000 EMU) tall → 720px.
    expect(Math.round(emuToPx(6858000))).toBe(720);
  });

  it('converts points → px at 96dpi (1pt = 1.333px)', () => {
    expect(ptToPx(72)).toBeCloseTo(96, 6);
    expect(ptToPx(18)).toBeCloseTo(24, 6);
  });

  it('converts PowerPoint sz (hundredths of a point) → px fontSize', () => {
    // sz=1800 → 18pt → 24px.
    expect(pptSzToFontSizePx(1800)).toBe(24);
    // sz=4400 → 44pt → ~58.67 → rounds to 59px.
    expect(pptSzToFontSizePx(4400)).toBe(59);
    // Absent → default 18pt → 24px.
    expect(pptSzToFontSizePx(undefined)).toBe(24);
    expect(pptSzToFontSizePx(null)).toBe(24);
    // Clamped: a 0.5pt run floors to 8px; a 9999pt run ceils to 800px.
    expect(pptSzToFontSizePx(50)).toBe(8);
    expect(pptSzToFontSizePx(999900)).toBe(800);
  });

  it('maps a px rect → clamped %-of-canvas zone', () => {
    // A 1280×720 canvas. A box at (640,360) sized 320×180 → 50%,50%,25%,25%.
    const r = pxRectToPercent(640, 360, 320, 180, 1280, 720);
    expect(r).toEqual({ x: 50, y: 50, width: 25, height: 25 });
  });

  it('pulls an overflowing rect back inside the canvas', () => {
    // Box starting at 90% that is 30% wide → width trimmed to 10%.
    const r = pxRectToPercent(1152, 0, 384, 100, 1280, 720); // x=90%, w=30%
    expect(r).not.toBeNull();
    expect(r!.x).toBe(90);
    expect(r!.width).toBeCloseTo(10, 4);
  });

  it('drops a degenerate (zero-size) rect', () => {
    expect(pxRectToPercent(0, 0, 0, 0, 1280, 720)).toBeNull();
    expect(pxRectToPercent(0, 0, 100, 100, 0, 0)).toBeNull();
  });

  it('normalizes OOXML colors to #rrggbb (or null)', () => {
    expect(ooxmlColorToHex('FF0000')).toBe('#ff0000');
    expect(ooxmlColorToHex('#00ff00')).toBe('#00ff00');
    expect(ooxmlColorToHex('black')).toBe('#000000');
    // Theme refs / garbage → null. This helper is the LAST RESORT for a
    // hand-built archive; theme-aware resolution lives in ./ooxml.
    expect(ooxmlColorToHex('accent1')).toBeNull();
    expect(ooxmlColorToHex(undefined)).toBeNull();
  });

  it('multiplies 2×3 affine matrices the way pdf.js does', () => {
    const identity = [1, 0, 0, 1, 0, 0];
    expect(matrixMultiply(identity, [2, 0, 0, 3, 5, 7])).toEqual([
      2, 0, 0, 3, 5, 7,
    ]);
    // A y-flip viewport on an 800×450 page: user (50,350) → device (50,100).
    const flip = [1, 0, 0, -1, 0, 450];
    const m = matrixMultiply(flip, [20, 0, 0, 20, 50, 350]);
    expect([m[4], m[5]]).toEqual([50, 100]);
    // A 90° rotation viewport: user (50,700) → device (700,50).
    const rot = matrixMultiply([0, 1, 1, 0, 0, 0], [20, 0, 0, 20, 50, 700]);
    expect([rot[4], rot[5]]).toEqual([700, 50]);
  });

  it('measures a matrix column length', () => {
    expect(matrixScale(3, 4)).toBe(5);
    expect(matrixScale(0, 0)).toBe(0);
  });
});

// ─── PPTX round-trip ──────────────────────────────────────────────────

/** Build a minimal-but-valid 2-slide .pptx in memory for the parser. */
async function makeFixturePptx(): Promise<Buffer> {
  const zip = new JSZip();

  // [Content_Types].xml — minimal; the parser doesn't read it but a
  // real archive has it.
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="png" ContentType="image/png"/><Default Extension="xml" ContentType="application/xml"/></Types>`,
  );

  // presentation.xml — 1280×720px slide (12192000×6858000 EMU), 2 slides.
  zip.file(
    'ppt/presentation.xml',
    `<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`,
  );
  zip.file(
    'ppt/_rels/presentation.xml.rels',
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/></Relationships>`,
  );

  const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
  const R =
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

  // Slide 1: a title text box at (640,360)px sized 320×180px, run sz=4400,
  // bold, red. EMU: off x=6096000 y=3429000, ext cx=3048000 cy=1714500.
  zip.file(
    'ppt/slides/slide1.xml',
    `<?xml version="1.0"?><p:sld xmlns:a="${A}" xmlns:p="${P}" xmlns:r="${R}"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="112233"/></a:solidFill></p:bgPr></p:bg><p:spTree><p:sp><p:spPr><a:xfrm><a:off x="6096000" y="3429000"/><a:ext cx="3048000" cy="1714500"/></a:xfrm></p:spPr><p:txBody><a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="4400" b="1"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill><a:latin typeface="Montserrat"/></a:rPr><a:t>Hello Title</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
  );

  // Slide 2: a picture shape referencing media/image1.png via rId5,
  // positioned at (0,0) sized 640×360px (EMU 0,0 6096000,3429000).
  zip.file(
    'ppt/slides/slide2.xml',
    `<?xml version="1.0"?><p:sld xmlns:a="${A}" xmlns:p="${P}" xmlns:r="${R}"><p:cSld><p:spTree><p:pic><p:blipFill><a:blip r:embed="rId5"/></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="6096000" cy="3429000"/></a:xfrm></p:spPr></p:pic></p:spTree></p:cSld></p:sld>`,
  );
  zip.file(
    'ppt/slides/_rels/slide2.xml.rels',
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>`,
  );

  // A 1×1 PNG (real bytes) so the parser reads a non-empty nodebuffer.
  const png1x1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );
  zip.file('ppt/media/image1.png', png1x1);

  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('parsePptx — structured slide → editable zones', () => {
  it('produces one ParsedPage per slide with correct geometry + styling', async () => {
    const buf = await makeFixturePptx();
    const doc = await parsePptx(buf);

    expect(doc.pages).toHaveLength(2);

    // Canvas: 1280×720 px.
    const [p1, p2] = doc.pages;
    expect(p1.screenWidth).toBe(1280);
    expect(p1.screenHeight).toBe(720);
    expect(p1.label).toBe('Slide 1');
    expect(p1.bgColor).toBe('#112233');
    // Accounting contract: stable source numbering, a disposition per page.
    expect(doc.sourcePageCount).toBe(2);
    expect(doc.pages.map((p) => p.sourcePage)).toEqual([1, 2]);
    expect(doc.pages.map((p) => p.disposition)).toEqual([
      'converted',
      'converted',
    ]);
    expect(doc.warnings).toEqual([]);

    // Slide 1 TEXT zone: centered at 50%,50%, 25%×25%, fontSize 59px,
    // bold, red, Montserrat, alignment center, content "Hello Title".
    expect(p1.zones).toHaveLength(1);
    const text = p1.zones[0];
    expect(text.widgetType).toBe('TEXT');
    expect(text.x).toBeCloseTo(50, 3);
    expect(text.y).toBeCloseTo(50, 3);
    expect(text.width).toBeCloseTo(25, 3);
    expect(text.height).toBeCloseTo(25, 3);
    expect(text.defaultConfig).toMatchObject({
      content: 'Hello Title',
      fontSize: 59, // sz=4400 → 44pt → 58.67 → 59
      alignment: 'center',
      bold: true,
      color: '#ff0000',
      fontFamily: 'Montserrat',
    });

    // Slide 2 IMAGE zone: top-left, 50%×50%, references the embedded media.
    expect(p2.zones).toHaveLength(1);
    const img = p2.zones[0];
    expect(img.widgetType).toBe('IMAGE');
    expect(img.x).toBeCloseTo(0, 3);
    expect(img.y).toBeCloseTo(0, 3);
    expect(img.width).toBeCloseTo(50, 3);
    expect(img.height).toBeCloseTo(50, 3);
    expect(img.mediaRef).toBeTruthy();

    // The referenced media survived pruning (it's used by a zone).
    expect(doc.media).toHaveLength(1);
    expect(doc.media[0].mimeType).toBe('image/png');
    expect(doc.media[0].id).toBe(img.mediaRef);
  });

  it('buildImport resolves image zones to uploaded URLs', async () => {
    const buf = await makeFixturePptx();
    const doc = await parsePptx(buf);

    // Resolve every media id to a fake uploaded URL.
    const built = buildImport(doc, {
      resolveMedia: (id) => `https://cdn.example/${id}.png`,
    });
    expect(built.templates).toHaveLength(2);
    expect(built.sourcePageCount).toBe(2);
    const imageTpl = built.templates.find((t) =>
      t.zones.some((z) => z.widgetType === 'IMAGE'),
    )!;
    const imageZone = imageTpl.zones.find((z) => z.widgetType === 'IMAGE')!;
    expect(imageZone.defaultConfig.assetUrl).toMatch(
      /^https:\/\/cdn\.example\/media-\d+\.png$/,
    );
    expect(imageZone.defaultConfig.fit).toBe('contain');
  });

  /**
   * REWRITTEN 2026-09-15. This test used to end with
   *   expect(builtNoMedia.find(t => t.label === 'Slide 2')).toBeUndefined()
   * which blessed the audit's finding: when a picture fails to upload,
   * the whole slide vanished and the controller counted what was left.
   * The zone still cannot be rendered — but the PAGE is now reported.
   */
  it('a slide whose only picture fails to upload is REPORTED, not deleted', async () => {
    const buf = await makeFixturePptx();
    const doc = await parsePptx(buf);

    const built = buildImport(doc, { resolveMedia: () => null });

    // Still only one renderable template — nothing is invented.
    expect(built.templates.map((t) => t.label)).toEqual(['Slide 1']);

    // …but both source slides are accounted for, and slide 2 says why.
    expect(built.pages.map((p) => p.label)).toEqual(['Slide 1', 'Slide 2']);
    expect(built.sourcePageCount).toBe(2);
    const slide2 = built.pages[1];
    expect(slide2.template).toBeNull();
    expect(slide2.disposition).toBe('empty');
    expect(slide2.warnings.map((w) => w.code)).toContain('MEDIA_UNRESOLVED');
    expect(slide2.sourcePage).toBe(2);

    // The deprecated view is still exactly the old, lossy answer — which
    // is why new callers must not use it.
    expect(buildTemplates(doc, { resolveMedia: () => null })).toHaveLength(1);
  });
});

// ─── Failure + empty-document behaviour ───────────────────────────────

describe('failure and empty documents', () => {
  it('parsePptx throws on a non-PPTX buffer', async () => {
    await expect(
      parsePptx(Buffer.from('this is not a zip')),
    ).rejects.toBeDefined();
  });

  /**
   * REWRITTEN 2026-09-15. The second half of this test used to say
   * "A page with no usable zones is dropped entirely" and assert `[]`.
   * That is the defect. A document with no pages still produces no
   * templates; a document WITH a page that produced nothing produces no
   * templates AND one accounted page.
   */
  it('an empty document has no pages; an empty PAGE is still a page', () => {
    const empty: ParsedDocument = {
      pages: [],
      media: [],
      sourcePageCount: 0,
      warnings: [],
    };
    const fromEmpty = buildImport(empty, { resolveMedia: () => null });
    expect(fromEmpty.templates).toEqual([]);
    expect(fromEmpty.pages).toEqual([]);
    expect(fromEmpty.sourcePageCount).toBe(0);

    const noZones: ParsedDocument = {
      pages: [
        {
          sourcePage: 1,
          label: 'Slide 1',
          screenWidth: 1280,
          screenHeight: 720,
          zones: [],
          disposition: 'empty',
          warnings: [],
        },
      ],
      media: [],
      sourcePageCount: 1,
      warnings: [],
    };
    const fromNoZones = buildImport(noZones, { resolveMedia: () => null });
    expect(fromNoZones.templates).toEqual([]);
    expect(fromNoZones.pages).toHaveLength(1);
    expect(fromNoZones.pages[0].disposition).toBe('empty');
    expect(fromNoZones.pages[0].template).toBeNull();
    expect(fromNoZones.sourcePageCount).toBe(1);
  });

  it('prepends a full-bleed background IMAGE zone when pageBackgroundUrl is given (PDF path)', () => {
    const doc: ParsedDocument = {
      pages: [
        {
          sourcePage: 1,
          label: 'Page 1',
          screenWidth: 1224,
          screenHeight: 1584,
          zones: [
            {
              name: 'Heading',
              widgetType: 'TEXT',
              x: 10,
              y: 10,
              width: 50,
              height: 8,
              zIndex: 1,
              defaultConfig: {
                content: 'Heading',
                fontSize: 32,
                alignment: 'left',
              },
            },
          ],
          disposition: 'converted',
          warnings: [],
        },
      ],
      media: [],
      sourcePageCount: 1,
      warnings: [],
    };
    const built = buildImport(doc, {
      resolveMedia: () => null,
      pageBackgroundUrl: () => 'https://cdn.example/page.webp',
    }).templates;
    expect(built).toHaveLength(1);
    expect(built[0].orientation).toBe('PORTRAIT'); // 1224×1584
    expect(built[0].sourcePage).toBe(1);
    const bg = built[0].zones[0];
    expect(bg.widgetType).toBe('IMAGE');
    expect(bg.zIndex).toBe(0);
    expect(bg).toMatchObject({ x: 0, y: 0, width: 100, height: 100 });
    expect(bg.defaultConfig.assetUrl).toBe('https://cdn.example/page.webp');
    // The editable text sits above the background.
    const txt = built[0].zones[1];
    expect(txt.widgetType).toBe('TEXT');
    expect(txt.zIndex).toBeGreaterThanOrEqual(1);
  });

  it('tolerates a document from a parser that predates the accounting contract', () => {
    // Defensive: `sourcePage` / `disposition` / `sourcePageCount` absent.
    const legacy = {
      pages: [
        {
          label: 'Page 1',
          screenWidth: 800,
          screenHeight: 450,
          zones: [
            {
              name: 'T',
              widgetType: 'TEXT' as const,
              x: 0,
              y: 0,
              width: 10,
              height: 10,
              zIndex: 1,
              defaultConfig: { content: 'T' },
            },
          ],
        },
      ],
      media: [],
    } as unknown as ParsedDocument;
    const built = buildImport(legacy, { resolveMedia: () => null });
    expect(built.pages[0].sourcePage).toBe(1);
    expect(built.sourcePageCount).toBe(1);
    expect(built.templates).toHaveLength(1);
  });
});
