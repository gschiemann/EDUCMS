/**
 * PPTX conversion fidelity — the defects the 2026-09-15 audit proved,
 * each with a test that fails if the fix is reverted.
 *
 * Every test here builds a REAL .pptx (a jszip archive of real OOXML)
 * and calls the REAL parser. Where the audit's own reproduction exists
 * (`docs/design/proposals/2026-09-15-template-import-audit/evidence/
 * import-audit-20260915.spec.ts`), the fixture shape is kept identical
 * so the two can be compared line for line.
 *
 * NEGATIVE CONTROLS are marked. They exist because a fidelity assertion
 * that would also pass on the OLD code proves nothing: each defect test
 * either asserts a value the old code demonstrably produced differently,
 * or is paired with a control fixture that must still behave the old way.
 */

import JSZip from 'jszip';
import { parsePptx, MAX_SLIDES, MAX_ZONES_PER_SLIDE } from './pptx-parser';
import { buildImport } from './import-builder';
import { collectWarnings } from './types';

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** A 1×1 PNG with real bytes, so the parser reads a non-empty buffer. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

/** A text shape at an explicit EMU position. */
function textShape(
  content: string,
  opts: {
    x?: number;
    y?: number;
    cx?: number;
    cy?: number;
    extra?: string;
  } = {},
): string {
  const { x = 0, y = 0, cx = 3048000, cy = 1714500, extra = '' } = opts;
  return (
    `<p:sp><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm></p:spPr>` +
    `<p:txBody><a:p><a:r><a:rPr sz="4400">${extra}</a:rPr><a:t>${content}</a:t></a:r></a:p></p:txBody></p:sp>`
  );
}

/** A full-bleed picture shape referencing rIdImg. */
const PICTURE =
  '<p:pic><p:blipFill><a:blip r:embed="rIdImg"/></p:blipFill>' +
  '<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="12192000" cy="6858000"/></a:xfrm></p:spPr></p:pic>';

interface DeckParts {
  /** Extra package parts, keyed by zip path. */
  files?: Record<string, string | Buffer>;
  /** Extra relationships appended to every slide's .rels. */
  slideRels?: string;
  /** A `<p:bg>` block placed on the slide itself, inside `p:cSld`. */
  slideBg?: string;
}

/** Build a real .pptx whose slide N holds `shapes[N-1]`. */
async function deck(shapes: string[], parts: DeckParts = {}): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    'ppt/presentation.xml',
    `<?xml version="1.0"?><p:presentation xmlns:p="${P}"><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`,
  );
  for (let i = 0; i < shapes.length; i++) {
    zip.file(
      `ppt/slides/slide${i + 1}.xml`,
      `<?xml version="1.0"?><p:sld xmlns:a="${A}" xmlns:p="${P}" xmlns:r="${R}"><p:cSld>${parts.slideBg ?? ''}<p:spTree>${shapes[i]}</p:spTree></p:cSld></p:sld>`,
    );
    zip.file(
      `ppt/slides/_rels/slide${i + 1}.xml.rels`,
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rIdImg" Type="${R}/image" Target="../media/image.png"/>` +
        (parts.slideRels ?? '') +
        `</Relationships>`,
    );
  }
  zip.file('ppt/media/image.png', PNG_1X1);
  for (const [path, body] of Object.entries(parts.files ?? {})) {
    zip.file(path, body);
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

// ─────────────────────────────────────────────────────────────────────
// Defect 1 — leading zeros
// ─────────────────────────────────────────────────────────────────────

describe('defect 1 — numeric-looking text keeps its exact characters', () => {
  it('imports "00123" as the string "00123", not the number 123', async () => {
    const doc = await parsePptx(await deck([textShape('00123')]));
    const content = doc.pages[0].zones[0].defaultConfig.content;
    // EXACT string content, per the audit's instruction — not a
    // toMatchObject that a number would satisfy by coercion.
    expect(content).toBe('00123');
    expect(typeof content).toBe('string');
  });

  it.each([
    ['00123', '00123'],
    ['007', '007'],
    ['1.50', '1.50'],
    ['0x1F', '0x1F'],
    ['1e5', '1e5'],
    ['+1', '+1'],
    ['  0012  ', '0012'], // trimmed at the zone edge, zeros intact
    ['Room 0042', 'Room 0042'],
  ])('preserves %s', async (source, expected) => {
    const doc = await parsePptx(await deck([textShape(source)]));
    expect(doc.pages[0].zones[0].defaultConfig.content).toBe(expected);
  });

  it('NEGATIVE CONTROL: ordinary prose was never affected, so prose cannot prove the fix', async () => {
    const doc = await parsePptx(await deck([textShape('Hello Title')]));
    expect(doc.pages[0].zones[0].defaultConfig.content).toBe('Hello Title');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Defect 2 — theme / bgRef / schemeClr backgrounds
// ─────────────────────────────────────────────────────────────────────

const DARK_THEME = `<?xml version="1.0"?><a:theme xmlns:a="${A}"><a:themeElements>
  <a:clrScheme name="Dark">
    <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
    <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
    <a:dk2><a:srgbClr val="10233C"/></a:dk2>
    <a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>
    <a:accent1><a:srgbClr val="4472C4"/></a:accent1>
  </a:clrScheme>
  <a:fontScheme name="Dark">
    <a:majorFont><a:latin typeface="Poppins"/></a:majorFont>
    <a:minorFont><a:latin typeface="Inter"/></a:minorFont>
  </a:fontScheme>
</a:themeElements></a:theme>`;

/**
 * The layout → master → theme chain a real export always has and the
 * old fixtures never did. `clrMap` is FLIPPED (bg1→dk1), which is what
 * a dark design actually writes.
 */
function themedParts(opts: {
  masterBg?: string;
  layoutBg?: string;
  masterShapes?: string;
  layoutShapes?: string;
}): DeckParts {
  const {
    masterBg = `<p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>`,
    layoutBg = '',
    masterShapes = '',
    layoutShapes = '',
  } = opts;
  return {
    slideRels: `<Relationship Id="rIdLayout" Type="${R}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>`,
    files: {
      'ppt/slideLayouts/slideLayout1.xml': `<?xml version="1.0"?><p:sldLayout xmlns:a="${A}" xmlns:p="${P}"><p:cSld>${layoutBg}<p:spTree>${layoutShapes}</p:spTree></p:cSld></p:sldLayout>`,
      'ppt/slideLayouts/_rels/slideLayout1.xml.rels': `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdMaster" Type="${R}/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
      'ppt/slideMasters/slideMaster1.xml': `<?xml version="1.0"?><p:sldMaster xmlns:a="${A}" xmlns:p="${P}"><p:cSld>${masterBg}<p:spTree>${masterShapes}</p:spTree></p:cSld><p:clrMap bg1="dk1" tx1="lt1" bg2="dk2" tx2="lt2" accent1="accent1"/></p:sldMaster>`,
      'ppt/slideMasters/_rels/slideMaster1.xml.rels': `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdTheme" Type="${R}/theme" Target="../theme/theme1.xml"/></Relationships>`,
      'ppt/theme/theme1.xml': DARK_THEME,
    },
  };
}

describe('defect 2 — a real dark deck does not import white-on-white', () => {
  it('resolves p:bgRef + schemeClr on the SLIDE through the theme', async () => {
    const doc = await parsePptx(
      await deck([textShape('Season kickoff')], {
        ...themedParts({}),
        slideBg: `<p:bg><p:bgRef idx="1001"><a:schemeClr val="bg2"/></p:bgRef></p:bg>`,
      }),
    );
    // clrMap bg2 → dk2 → #10233C. Dark, not the default white.
    expect(doc.pages[0].bgColor).toBe('#10233c');
  });

  it('inherits the MASTER background when the slide declares none', async () => {
    const doc = await parsePptx(
      await deck([textShape('Inherited')], themedParts({})),
    );
    // Master bgRef → schemeClr bg1 → (flipped clrMap) dk1 → #000000.
    expect(doc.pages[0].bgColor).toBe('#000000');
  });

  it('prefers the LAYOUT background over the master', async () => {
    const doc = await parsePptx(
      await deck(
        [textShape('Layout wins')],
        themedParts({
          layoutBg: `<p:bg><p:bgPr><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></p:bgPr></p:bg>`,
        }),
      ),
    );
    expect(doc.pages[0].bgColor).toBe('#4472c4');
  });

  it('resolves a run colour written as a schemeClr, so text is not lost either', async () => {
    const doc = await parsePptx(
      await deck(
        [
          textShape('Bright headline', {
            extra: '<a:solidFill><a:schemeClr val="tx1"/></a:solidFill>',
          }),
        ],
        themedParts({}),
      ),
    );
    // clrMap tx1 → lt1 → #ffffff, on the #000000 master background.
    expect(doc.pages[0].zones[0].defaultConfig.color).toBe('#ffffff');
    expect(doc.pages[0].bgColor).toBe('#000000');
  });

  it('resolves a theme FONT reference (+mj-lt) instead of dropping it', async () => {
    const doc = await parsePptx(
      await deck(
        [
          textShape('Themed font', {
            extra: '<a:latin typeface="+mj-lt"/>',
          }),
        ],
        themedParts({}),
      ),
    );
    expect(doc.pages[0].zones[0].defaultConfig.fontFamily).toBe('Poppins');
  });

  it('approximates a gradient background and says that it did', async () => {
    const grad =
      `<p:bg><p:bgPr><a:gradFill><a:gsLst>` +
      `<a:gs pos="0"><a:srgbClr val="203864"/></a:gs>` +
      `<a:gs pos="100000"><a:srgbClr val="8899AA"/></a:gs>` +
      `</a:gsLst></a:gradFill></p:bgPr></p:bg>`;
    const zip = new JSZip();
    zip.file(
      'ppt/presentation.xml',
      `<?xml version="1.0"?><p:presentation xmlns:p="${P}"><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`,
    );
    zip.file(
      'ppt/slides/slide1.xml',
      `<?xml version="1.0"?><p:sld xmlns:a="${A}" xmlns:p="${P}"><p:cSld>${grad}<p:spTree>${textShape('Gradient')}</p:spTree></p:cSld></p:sld>`,
    );
    const doc = await parsePptx(
      await zip.generateAsync({ type: 'nodebuffer' }),
    );
    expect(doc.pages[0].bgColor).toBe('#203864');
    expect(collectWarnings(doc).map((w) => w.code)).toContain(
      'COLOR_APPROXIMATED',
    );
  });

  it('NEGATIVE CONTROL: a literal srgbClr background still resolves, and an unthemed schemeClr still refuses', async () => {
    const zip = new JSZip();
    zip.file(
      'ppt/presentation.xml',
      `<?xml version="1.0"?><p:presentation xmlns:p="${P}"><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`,
    );
    zip.file(
      'ppt/slides/slide1.xml',
      `<?xml version="1.0"?><p:sld xmlns:a="${A}" xmlns:p="${P}"><p:cSld>` +
        `<p:bg><p:bgPr><a:solidFill><a:srgbClr val="112233"/></a:solidFill></p:bgPr></p:bg>` +
        `<p:spTree>${textShape('Literal')}</p:spTree></p:cSld></p:sld>`,
    );
    zip.file(
      'ppt/slides/slide2.xml',
      `<?xml version="1.0"?><p:sld xmlns:a="${A}" xmlns:p="${P}"><p:cSld>` +
        `<p:bg><p:bgPr><a:solidFill><a:schemeClr val="accent3"/></a:solidFill></p:bgPr></p:bg>` +
        `<p:spTree>${textShape('No theme here')}</p:spTree></p:cSld></p:sld>`,
    );
    const doc = await parsePptx(
      await zip.generateAsync({ type: 'nodebuffer' }),
    );
    expect(doc.pages[0].bgColor).toBe('#112233');
    // No theme part, so this one genuinely cannot resolve — and says so
    // rather than inventing a colour.
    expect(doc.pages[1].bgColor).toBeUndefined();
    expect(doc.pages[1].warnings.map((w) => w.code)).toContain(
      'COLOR_UNRESOLVED',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────
// Defect 3 — stacking order
// ─────────────────────────────────────────────────────────────────────

describe('defect 3 — document order is paint order', () => {
  it('keeps a picture BEHIND the text that follows it in the source', async () => {
    const doc = await parsePptx(await deck([PICTURE + textShape('On top')]));
    const zones = doc.pages[0].zones;
    expect(zones.map((z) => z.widgetType)).toEqual(['IMAGE', 'TEXT']);
    // …and the z-order agrees: the text paints above the picture.
    expect(zones[1].zIndex).toBeGreaterThan(zones[0].zIndex);
  });

  it('keeps a picture ABOVE text that precedes it — the mirror case', async () => {
    const doc = await parsePptx(await deck([textShape('Behind') + PICTURE]));
    const zones = doc.pages[0].zones;
    expect(zones.map((z) => z.widgetType)).toEqual(['TEXT', 'IMAGE']);
    expect(zones[1].zIndex).toBeGreaterThan(zones[0].zIndex);
  });

  it('preserves a three-way interleave', async () => {
    const doc = await parsePptx(
      await deck([PICTURE + textShape('Middle') + PICTURE]),
    );
    expect(doc.pages[0].zones.map((z) => z.widgetType)).toEqual([
      'IMAGE',
      'TEXT',
      'IMAGE',
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Defect 4 — group transforms
// ─────────────────────────────────────────────────────────────────────

function group(
  children: string,
  opts: {
    x?: number;
    y?: number;
    cx?: number;
    cy?: number;
    chOffX?: number;
    chOffY?: number;
    chExtCx?: number;
    chExtCy?: number;
  } = {},
): string {
  const {
    x = 6096000,
    y = 0,
    cx = 3048000,
    cy = 1714500,
    chOffX = 0,
    chOffY = 0,
    chExtCx = 3048000,
    chExtCy = 1714500,
  } = opts;
  return (
    `<p:grpSp><p:grpSpPr><a:xfrm>` +
    `<a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/>` +
    `<a:chOff x="${chOffX}" y="${chOffY}"/><a:chExt cx="${chExtCx}" cy="${chExtCy}"/>` +
    `</a:xfrm></p:grpSpPr>${children}</p:grpSp>`
  );
}

describe('defect 4 — grouped children land where the group puts them', () => {
  it('translates a child by the group origin (the audit fixture, corrected)', async () => {
    // The group sits at x=6096000 EMU = 50% of a 12192000 EMU slide; the
    // child is at local x=0. The old parser reported x=0.
    const doc = await parsePptx(
      await deck([group(textShape('Grouped', { x: 0 }))]),
    );
    expect(doc.pages[0].zones[0].x).toBeCloseTo(50, 3);
  });

  it('SCALES a child when the group is resized (chExt ≠ ext)', async () => {
    // Children authored in a 6096000-wide space, drawn into a
    // 3048000-wide group → every child coordinate halves.
    const doc = await parsePptx(
      await deck([
        group(textShape('Half', { x: 3048000, cx: 3048000 }), {
          x: 0,
          cx: 3048000,
          chOffX: 0,
          chExtCx: 6096000,
        }),
      ]),
    );
    const zone = doc.pages[0].zones[0];
    // local x 3048000 → 1524000 EMU → 12.5% of the slide.
    expect(zone.x).toBeCloseTo(12.5, 3);
    // local width 3048000 → 1524000 EMU → 12.5% wide.
    expect(zone.width).toBeCloseTo(12.5, 3);
  });

  it('subtracts a non-zero chOff', async () => {
    const doc = await parsePptx(
      await deck([
        group(textShape('Offset', { x: 1000000 }), {
          x: 6096000,
          chOffX: 1000000,
        }),
      ]),
    );
    // local 1000000 - chOff 1000000 = 0, + group x 6096000 → 50%.
    expect(doc.pages[0].zones[0].x).toBeCloseTo(50, 3);
  });

  it('composes NESTED groups', async () => {
    const inner = group(textShape('Deep', { x: 0 }), {
      x: 1524000, // 12.5% inside the outer group's child space
      cx: 1524000,
      chOffX: 0,
      chExtCx: 1524000,
    });
    const doc = await parsePptx(
      await deck([group(inner, { x: 6096000, chOffX: 0 })]),
    );
    // outer 6096000 + inner 1524000 = 7620000 EMU → 62.5%.
    expect(doc.pages[0].zones[0].x).toBeCloseTo(62.5, 3);
  });

  it('NEGATIVE CONTROL: an UNGROUPED shape at local x=0 still lands at 0', async () => {
    const doc = await parsePptx(await deck([textShape('Loose', { x: 0 })]));
    expect(doc.pages[0].zones[0].x).toBeCloseTo(0, 3);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Defect 5 — placeholder geometry inheritance
// ─────────────────────────────────────────────────────────────────────

const PLACEHOLDER_TITLE =
  '<p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/>' +
  '<p:txBody><a:p><a:r><a:t>Inherited title</a:t></a:r></a:p></p:txBody></p:sp>';

function layoutPlaceholder(
  type: string,
  x: number,
  y: number,
  idx?: string,
): string {
  const ph = idx
    ? `<p:ph type="${type}" idx="${idx}"/>`
    : `<p:ph type="${type}"/>`;
  return (
    `<p:sp><p:nvSpPr><p:nvPr>${ph}</p:nvPr></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="3048000" cy="1714500"/></a:xfrm></p:spPr>` +
    `<p:txBody><a:p><a:r><a:t>prompt</a:t></a:r></a:p></p:txBody></p:sp>`
  );
}

describe('defect 5 — a placeholder without its own geometry is not deleted', () => {
  it('inherits from the slide LAYOUT', async () => {
    const doc = await parsePptx(
      await deck(
        [PLACEHOLDER_TITLE],
        themedParts({
          layoutShapes: layoutPlaceholder('title', 6096000, 3429000),
        }),
      ),
    );
    expect(doc.pages[0].zones).toHaveLength(1);
    expect(doc.pages[0].zones[0].defaultConfig.content).toBe('Inherited title');
    expect(doc.pages[0].zones[0].x).toBeCloseTo(50, 3);
    expect(doc.pages[0].zones[0].y).toBeCloseTo(50, 3);
  });

  it('falls through to the MASTER when the layout has no match', async () => {
    const doc = await parsePptx(
      await deck(
        [PLACEHOLDER_TITLE],
        themedParts({
          masterShapes: layoutPlaceholder('title', 3048000, 0),
        }),
      ),
    );
    expect(doc.pages[0].zones).toHaveLength(1);
    expect(doc.pages[0].zones[0].x).toBeCloseTo(25, 3);
  });

  it('matches on idx before type, and treats ctrTitle as title', async () => {
    const byIdx =
      '<p:sp><p:nvSpPr><p:nvPr><p:ph type="body" idx="7"/></p:nvPr></p:nvSpPr><p:spPr/>' +
      '<p:txBody><a:p><a:r><a:t>Body seven</a:t></a:r></a:p></p:txBody></p:sp>';
    const ctr =
      '<p:sp><p:nvSpPr><p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr><p:spPr/>' +
      '<p:txBody><a:p><a:r><a:t>Centre title</a:t></a:r></a:p></p:txBody></p:sp>';
    const doc = await parsePptx(
      await deck(
        [byIdx + ctr],
        themedParts({
          layoutShapes:
            layoutPlaceholder('body', 9144000, 0, '7') +
            layoutPlaceholder('title', 0, 3429000),
        }),
      ),
    );
    const zones = doc.pages[0].zones;
    expect(zones.map((z) => z.defaultConfig.content)).toEqual([
      'Body seven',
      'Centre title',
    ]);
    expect(zones[0].x).toBeCloseTo(75, 3);
    expect(zones[1].y).toBeCloseTo(50, 3);
  });

  it('a placeholder with NO inheritable geometry anywhere is recorded, not silently dropped', async () => {
    const doc = await parsePptx(await deck([PLACEHOLDER_TITLE]));
    expect(doc.pages[0].zones).toHaveLength(0);
    expect(doc.pages[0].warnings.map((w) => w.code)).toContain(
      'SHAPE_UNSUPPORTED',
    );
  });

  it('NEGATIVE CONTROL: a shape with its OWN xfrm ignores the layout', async () => {
    const own =
      '<p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>' +
      '<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="3048000" cy="1714500"/></a:xfrm></p:spPr>' +
      '<p:txBody><a:p><a:r><a:t>Own geometry</a:t></a:r></a:p></p:txBody></p:sp>';
    const doc = await parsePptx(
      await deck(
        [own],
        themedParts({
          layoutShapes: layoutPlaceholder('title', 9144000, 3429000),
        }),
      ),
    );
    expect(doc.pages[0].zones[0].x).toBeCloseTo(0, 3);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Unsupported content is named, not silent
// ─────────────────────────────────────────────────────────────────────

describe('unsupported PPTX content produces a typed warning', () => {
  it('names a table, a chart and an unserveable image format', async () => {
    const table = `<p:graphicFrame><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl/></a:graphicData></a:graphic></p:graphicFrame>`;
    const chart = `<p:graphicFrame><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"/></a:graphic></p:graphicFrame>`;
    const doc = await parsePptx(
      await deck([textShape('Report') + table + chart]),
    );
    const details = doc.pages[0].warnings
      .filter((w) => w.code === 'SHAPE_UNSUPPORTED')
      .map((w) => w.detail)
      .join(' | ');
    expect(details).toMatch(/table/);
    expect(details).toMatch(/chart/);
    // The text still converted — a warning is not a failure.
    expect(doc.pages[0].zones).toHaveLength(1);
    expect(doc.pages[0].disposition).toBe('converted-with-warnings');
  });

  it('names an EMF picture rather than dropping it in silence', async () => {
    const zip = new JSZip();
    zip.file(
      'ppt/presentation.xml',
      `<?xml version="1.0"?><p:presentation xmlns:p="${P}"><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`,
    );
    zip.file(
      'ppt/slides/slide1.xml',
      `<?xml version="1.0"?><p:sld xmlns:a="${A}" xmlns:p="${P}" xmlns:r="${R}"><p:cSld><p:spTree>${textShape('With logo')}${PICTURE}</p:spTree></p:cSld></p:sld>`,
    );
    zip.file(
      'ppt/slides/_rels/slide1.xml.rels',
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdImg" Type="${R}/image" Target="../media/logo.emf"/></Relationships>`,
    );
    zip.file('ppt/media/logo.emf', Buffer.from([1, 2, 3, 4]));
    const doc = await parsePptx(
      await zip.generateAsync({ type: 'nodebuffer' }),
    );
    expect(doc.pages[0].warnings.map((w) => w.code)).toContain(
      'MEDIA_UNSUPPORTED',
    );
  });

  it('records a rotated shape instead of pretending it was upright', async () => {
    const rotated =
      `<p:sp><p:spPr><a:xfrm rot="2700000"><a:off x="0" y="0"/><a:ext cx="3048000" cy="1714500"/></a:xfrm></p:spPr>` +
      `<p:txBody><a:p><a:r><a:t>Tilted</a:t></a:r></a:p></p:txBody></p:sp>`;
    const doc = await parsePptx(await deck([rotated]));
    expect(doc.pages[0].warnings.map((w) => w.code)).toContain(
      'SHAPE_ROTATION_IGNORED',
    );
    expect(doc.pages[0].zones).toHaveLength(1);
  });

  it('warns once per page, not once per repeated shape', async () => {
    const chart = `<p:graphicFrame><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"/></a:graphic></p:graphicFrame>`;
    const doc = await parsePptx(
      await deck([textShape('Many charts') + chart.repeat(12)]),
    );
    const charts = doc.pages[0].warnings.filter((w) => /chart/.test(w.detail));
    expect(charts).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Resource guards stay exactly as strong
// ─────────────────────────────────────────────────────────────────────

describe('the caps still bite, and now they say so', () => {
  it('converts MAX_SLIDES and accounts for the rest', async () => {
    const shapes = Array.from({ length: MAX_SLIDES + 1 }, (_, i) =>
      textShape(`Slide ${i + 1}`),
    );
    const doc = await parsePptx(await deck(shapes));
    expect(doc.sourcePageCount).toBe(MAX_SLIDES + 1);
    // Every source slide is present — the last one as excluded, not gone.
    expect(doc.pages).toHaveLength(MAX_SLIDES + 1);
    expect(doc.pages[MAX_SLIDES].disposition).toBe('excluded-by-limit');
    expect(doc.pages[MAX_SLIDES].sourcePage).toBe(MAX_SLIDES + 1);
    expect(doc.warnings.map((w) => w.code)).toContain('PAGES_TRUNCATED');
    expect(doc.warnings[0].detail).toContain(String(MAX_SLIDES + 1));
  });

  it('converts MAX_ZONES_PER_SLIDE boxes and warns about the overflow', async () => {
    const shapes = Array.from({ length: MAX_ZONES_PER_SLIDE + 1 }, (_, i) =>
      textShape(`Box ${i + 1}`),
    ).join('');
    const doc = await parsePptx(await deck([shapes]));
    expect(doc.pages[0].zones).toHaveLength(MAX_ZONES_PER_SLIDE);
    expect(doc.pages[0].warnings.map((w) => w.code)).toContain(
      'ZONES_TRUNCATED',
    );
  });

  it('truncates very long text and says it did', async () => {
    const long = 'A'.repeat(5200);
    const doc = await parsePptx(await deck([textShape(long)]));
    expect(String(doc.pages[0].zones[0].defaultConfig.content).length).toBe(
      5000,
    );
    expect(doc.pages[0].warnings.map((w) => w.code)).toContain(
      'TEXT_TRUNCATED',
    );
  });

  it('still throws on a non-PPTX buffer', async () => {
    await expect(
      parsePptx(Buffer.from('this is not a zip')),
    ).rejects.toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────
// End-to-end through the builder
// ─────────────────────────────────────────────────────────────────────

describe('a themed, grouped, interleaved deck survives to BuiltTemplates', () => {
  it('produces the right stacking, positions, colours and accounting', async () => {
    const buf = await deck(
      [
        PICTURE +
          group(
            textShape('00123', {
              x: 0,
              extra: '<a:solidFill><a:schemeClr val="tx1"/></a:solidFill>',
            }),
          ),
      ],
      themedParts({}),
    );
    const doc = await parsePptx(buf);
    const result = buildImport(doc, {
      resolveMedia: (id) => `https://cdn.example/${id}.png`,
    });

    expect(result.sourcePageCount).toBe(1);
    expect(result.pages).toHaveLength(1);
    const tpl = result.pages[0].template!;
    expect(tpl.sourcePage).toBe(1);
    expect(tpl.bgColor).toBe('#000000');
    expect(tpl.zones.map((z) => z.widgetType)).toEqual(['IMAGE', 'TEXT']);
    expect(tpl.zones[1].defaultConfig.content).toBe('00123');
    expect(tpl.zones[1].defaultConfig.color).toBe('#ffffff');
    expect(tpl.zones[1].x).toBeCloseTo(50, 3);
    expect(tpl.zones[1].zIndex).toBeGreaterThan(tpl.zones[0].zIndex);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Resource bounds on the shape walk itself
// ─────────────────────────────────────────────────────────────────────

describe('a pathological group nest cannot overflow the stack', () => {
  it('stops at the group-depth bound and says so', async () => {
    // 50 nested <p:grpSp> around one text box: past the 24-level walk
    // bound, below fast-xml-parser's own ~100-level ceiling, so this is
    // the band where THIS guard is the one doing the work. The zone cap
    // bounds WIDTH; this is the DEPTH case, and the walk is recursive.
    let nested = textShape('Buried', { x: 0 });
    for (let i = 0; i < 50; i++) nested = group(nested, { x: 0, chOffX: 0 });
    const doc = await parsePptx(await deck([nested]));

    expect(doc.pages[0].zones).toHaveLength(0);
    expect(doc.pages[0].warnings.map((w) => w.code)).toContain(
      'SHAPE_UNSUPPORTED',
    );
    expect(
      doc.pages[0].warnings.some((w) => /nested more than/.test(w.detail)),
    ).toBe(true);
  });

  it('survives a nest so deep the XML parser itself gives up', async () => {
    // 5,000 levels trips fast-xml-parser's own "Maximum nested tags
    // exceeded" before the shape walk ever runs. The contract that
    // matters is that ONE hostile slide cannot take the request down:
    // the parse resolves, the slide is graded PAGE_UNREADABLE, and the
    // document — including the healthy slide beside it — is returned.
    let nested = textShape('Buried', { x: 0 });
    for (let i = 0; i < 5000; i++) nested = group(nested, { x: 0, chOffX: 0 });
    const doc = await parsePptx(await deck([nested, textShape('Fine')]));

    expect(doc.sourcePageCount).toBe(2);
    expect(doc.pages[0].disposition).toBe('empty');
    expect(doc.pages[0].warnings.map((w) => w.code)).toContain(
      'PAGE_UNREADABLE',
    );
    // The healthy slide beside it is unaffected.
    expect(doc.pages[1].zones[0].defaultConfig.content).toBe('Fine');
  });

  it('NEGATIVE CONTROL: an ordinary three-deep nest still converts', async () => {
    let nested = textShape('Reachable', { x: 0 });
    for (let i = 0; i < 3; i++) nested = group(nested, { x: 0, chOffX: 0 });
    const doc = await parsePptx(await deck([nested]));
    expect(doc.pages[0].zones).toHaveLength(1);
    expect(doc.pages[0].zones[0].defaultConfig.content).toBe('Reachable');
  });
});
