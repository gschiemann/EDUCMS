/**
 * A themed deck keeps almost nothing about how its words look on the run
 * itself. PowerPoint writes a title as `<a:r><a:t>…</a:t></a:r>` — no
 * `a:rPr` at all — and lets the layout's `a:lstStyle/a:lvl1pPr/a:defRPr`,
 * then the master's `p:txStyles`, supply size, colour, weight and face.
 *
 * The parser read only the run. Geometry was inherited correctly, so the
 * box landed in the right place and everything inside it was wrong:
 * measured on the fixture below, a 44pt bold centred white Montserrat
 * title imported as 24px, left-aligned, not bold, with no colour and no
 * face. On a 1280×720 canvas that is a title at 40% of its intended
 * size — not a subtle fidelity loss, an unusable board.
 *
 * These tests pin each inherited property, each level of the chain, and
 * the controls that must NOT move: a run that states a property still
 * wins, and `b="0"` on the run beats a bold layout rather than reading
 * as "said nothing".
 */
import JSZip from 'jszip';
import { parsePptx, __testables } from './pptx-parser';

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** Geometry the layout's title placeholder declares, in EMU. */
const TITLE_XFRM =
  '<a:xfrm><a:off x="1219200" y="2286000"/><a:ext cx="9753600" cy="2286000"/></a:xfrm>';

interface DeckParts {
  /** Contents of the slide's `<a:r>` — the run as the deck writes it. */
  run: string;
  /** The layout title placeholder's `a:lvl1pPr`, or '' for none. */
  layoutLvl1?: string;
  /** Whether the layout placeholder carries geometry of its own. */
  layoutXfrm?: boolean;
  /** The master's `p:txStyles`, or '' for none. */
  masterTxStyles?: string;
  /** The master title placeholder's shape XML, or '' for none. */
  masterTitleSp?: string;
}

async function deck(parts: DeckParts): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    'ppt/presentation.xml',
    `<?xml version="1.0"?><p:presentation xmlns:p="${P}" xmlns:r="${R}"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`,
  );
  zip.file(
    'ppt/_rels/presentation.xml.rels',
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/slide" Target="slides/slide1.xml"/></Relationships>`,
  );
  zip.file(
    'ppt/slides/slide1.xml',
    `<?xml version="1.0"?><p:sld xmlns:a="${A}" xmlns:p="${P}" xmlns:r="${R}"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="111827"/></a:solidFill></p:bgPr></p:bg><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:p>${parts.run}</a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
  );
  zip.file(
    'ppt/slides/_rels/slide1.xml.rels',
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type="${R}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`,
  );
  const lvl1 = parts.layoutLvl1 ?? '';
  zip.file(
    'ppt/slideLayouts/slideLayout1.xml',
    `<?xml version="1.0"?><p:sldLayout xmlns:a="${A}" xmlns:p="${P}" xmlns:r="${R}"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr><p:spPr>${parts.layoutXfrm === false ? '' : TITLE_XFRM}</p:spPr><p:txBody>${lvl1 ? `<a:lstStyle>${lvl1}</a:lstStyle>` : ''}</p:txBody></p:sp></p:spTree></p:cSld></p:sldLayout>`,
  );
  zip.file(
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
  );
  zip.file(
    'ppt/slideMasters/slideMaster1.xml',
    `<?xml version="1.0"?><p:sldMaster xmlns:a="${A}" xmlns:p="${P}" xmlns:r="${R}"><p:cSld><p:spTree>${parts.masterTitleSp ?? ''}</p:spTree></p:cSld>${parts.masterTxStyles ?? ''}</p:sldMaster>`,
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

const cfgOf = async (parts: DeckParts) => {
  const doc = await parsePptx(await deck(parts));
  return doc.pages[0].zones[0]?.defaultConfig as Record<string, unknown>;
};

const LAYOUT_TITLE =
  '<a:lvl1pPr algn="ctr"><a:defRPr sz="4400" b="1"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:latin typeface="Montserrat"/></a:defRPr></a:lvl1pPr>';
const BARE_RUN = '<a:r><a:t>Homecoming Friday</a:t></a:r>';

describe('a run that states nothing inherits from its layout', () => {
  it('takes size, colour, weight, face and alignment', async () => {
    const cfg = await cfgOf({ run: BARE_RUN, layoutLvl1: LAYOUT_TITLE });
    // 44pt at 96dpi = 58.67px. Before this, every one of these was the
    // widget default: 24px, left, not bold, no colour, no face.
    expect(cfg.fontSize).toBe(59);
    expect(cfg.alignment).toBe('center');
    expect(cfg.bold).toBe(true);
    expect(cfg.color).toBe('#ffffff');
    expect(cfg.fontFamily).toBe('Montserrat');
  });

  it('falls through to the master text styles when the layout is silent', async () => {
    const cfg = await cfgOf({
      run: BARE_RUN,
      layoutLvl1: '',
      masterTxStyles:
        '<p:txStyles><p:titleStyle><a:lvl1pPr algn="r"><a:defRPr sz="3200"><a:solidFill><a:srgbClr val="FFCC00"/></a:solidFill></a:defRPr></a:lvl1pPr></p:titleStyle></p:txStyles>',
    });
    expect(cfg.fontSize).toBe(43); // 32pt
    expect(cfg.alignment).toBe('right');
    expect(cfg.color).toBe('#ffcc00');
  });

  it('prefers the layout over the master for the same property', async () => {
    const cfg = await cfgOf({
      run: BARE_RUN,
      layoutLvl1: LAYOUT_TITLE,
      masterTxStyles:
        '<p:txStyles><p:titleStyle><a:lvl1pPr algn="r"><a:defRPr sz="1200"/></a:lvl1pPr></p:titleStyle></p:txStyles>',
    });
    expect(cfg.fontSize).toBe(59);
    expect(cfg.alignment).toBe('center');
  });

  it('still lands where the layout puts it', async () => {
    const doc = await parsePptx(
      await deck({ run: BARE_RUN, layoutLvl1: LAYOUT_TITLE }),
    );
    const z = doc.pages[0].zones[0];
    // 1219200 EMU of 12192000 = 10%; 2286000 of 6858000 = 33.3%.
    expect(z.x).toBeCloseTo(10, 3);
    expect(z.y).toBeCloseTo(33.333, 2);
  });
});

describe('what the run says still wins', () => {
  it('keeps an explicit size, colour and face over the layout', async () => {
    const cfg = await cfgOf({
      run: '<a:r><a:rPr sz="2000"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill><a:latin typeface="Georgia"/></a:rPr><a:t>Homecoming Friday</a:t></a:r>',
      layoutLvl1: LAYOUT_TITLE,
    });
    expect(cfg.fontSize).toBe(27); // 20pt, not the layout's 44
    expect(cfg.color).toBe('#ff0000');
    expect(cfg.fontFamily).toBe('Georgia');
  });

  it('treats b="0" as "not bold", not as silence', async () => {
    const cfg = await cfgOf({
      run: '<a:r><a:rPr b="0"/><a:t>Homecoming Friday</a:t></a:r>',
      layoutLvl1: LAYOUT_TITLE,
    });
    expect(cfg.bold).toBe(false);
    // …and the properties it did NOT mention still come from the layout.
    expect(cfg.fontSize).toBe(59);
  });

  it('keeps paragraph alignment over the placeholder default', async () => {
    const doc = await parsePptx(
      await deck({
        run: BARE_RUN,
        layoutLvl1: LAYOUT_TITLE,
      }).then(async (b) => b),
    );
    expect(doc.pages[0].zones[0].defaultConfig.alignment).toBe('center');
  });
});

describe('the placeholder index merges per field', () => {
  it('a text-only layout entry does not hide the master geometry', async () => {
    // The layout declares the type size but no box; the master declares
    // the box. Both must come through — the old index dropped any
    // placeholder without an `a:xfrm` outright.
    const doc = await parsePptx(
      await deck({
        run: BARE_RUN,
        layoutLvl1: LAYOUT_TITLE,
        layoutXfrm: false,
        masterTitleSp: `<p:sp><p:nvSpPr><p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr><p:spPr>${TITLE_XFRM}</p:spPr></p:sp>`,
      }),
    );
    const z = doc.pages[0].zones[0];
    expect(z).toBeDefined();
    expect(z.x).toBeCloseTo(10, 3);
    expect(z.defaultConfig.fontSize).toBe(59);
  });

  it('reads the three master text styles and nothing else', () => {
    const styles = __testables.readMasterTextStyles({
      'p:sldMaster': {
        'p:txStyles': {
          'p:titleStyle': { 'a:lvl1pPr': { '@_algn': 'ctr' } },
          'p:bodyStyle': { 'a:lvl1pPr': { 'a:defRPr': { '@_sz': '1800' } } },
        },
      },
    });
    expect(styles.title?.algn).toBe('ctr');
    expect(styles.body?.defRPr['@_sz']).toBe('1800');
    expect(styles.other).toBeUndefined();
    // A master with no styles at all is an empty answer, never a throw.
    expect(__testables.readMasterTextStyles({})).toEqual({});
  });
});
