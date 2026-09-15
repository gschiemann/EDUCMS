/**
 * OOXML plumbing: the order-preserving parse, its equivalence with the
 * map shape every accessor in the PPTX parser uses, and the theme /
 * colour-scheme resolution real exported decks depend on.
 *
 * These are the foundations the fidelity fixes stand on, so they are
 * tested directly rather than only through a whole .pptx.
 */

import { XMLParser } from 'fast-xml-parser';
import {
  applyColorTransforms,
  hexToRgb,
  orderedToMap,
  parseXml,
  pathByTag,
  readColorMap,
  readTheme,
  resolveColorNode,
  resolveSchemeSlot,
  rgbToHex,
} from './ooxml';

/**
 * The DEFAULT (map) parser the PPTX code used before the ordered view
 * existed. `orderedToMap` must reproduce its output byte for byte, or
 * every accessor in pptx-parser.ts silently changes meaning.
 */
const referenceMapParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: () => false,
  textNodeName: '#text',
  trimValues: false,
  parseAttributeValue: false,
  parseTagValue: false,
  processEntities: true,
});

describe('ooxml — the ordered view reproduces the map view exactly', () => {
  const samples: Array<[string, string]> = [
    ['self-closing child', '<r><e/></r>'],
    ['attributes plus text', '<r><e a="1">txt</e></r>'],
    ['repeated siblings collapse to an array', '<r><e>a</e><e>b</e></r>'],
    ['mixed text around an element', '<r>lead<e/>tail</r>'],
    ['significant whitespace is preserved', '<r><t>  spaced  </t></r>'],
    [
      'a real slide fragment',
      `<p:sld xmlns:a="A" xmlns:p="P" xmlns:r="R"><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="dk2"/></p:bgRef></p:bg><p:spTree>` +
        `<p:pic><p:blipFill><a:blip r:embed="rId1"/></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="200"/></a:xfrm></p:spPr></p:pic>` +
        `<p:sp><p:spPr/><p:txBody><a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="4400" b="1"/><a:t>00123</a:t></a:r></a:p></p:txBody></p:sp>` +
        `</p:spTree></p:cSld></p:sld>`,
    ],
  ];

  it.each(samples)('%s', (_name, xml) => {
    expect(parseXml(xml).map).toEqual(referenceMapParser.parse(xml));
  });

  it('keeps document order, which the map view provably cannot', () => {
    const xml =
      '<root><p:spTree xmlns:p="P"><p:pic id="1"/><p:sp id="2"/><p:pic id="3"/></p:spTree></root>';
    const parsed = parseXml(xml);
    const ordered = parsed.ordered;
    const map = parsed.map as Record<string, Record<string, unknown>>;
    const tree = pathByTag(ordered, 'root', 'p:spTree');
    expect(tree?.children.map((c) => c.tag)).toEqual([
      'p:pic',
      'p:sp',
      'p:pic',
    ]);
    expect(tree?.children.map((c) => c.attrs?.['@_id'])).toEqual([
      '1',
      '2',
      '3',
    ]);

    // NEGATIVE CONTROL: the map view groups by tag name, so the
    // interleaving is unrecoverable from it. If this ever starts
    // returning order, the ordered view is no longer load-bearing.
    expect(
      Object.keys(map.root['p:spTree'] as Record<string, unknown>).filter(
        (k) => !k.startsWith('@_'),
      ),
    ).toEqual(['p:pic', 'p:sp']);
  });

  it('orderedToMap on an empty child list is an empty object', () => {
    expect(orderedToMap([])).toEqual({});
  });
});

describe('ooxml — colour maths', () => {
  it('round-trips hex ↔ rgb', () => {
    expect(hexToRgb('#1f3864')).toEqual({ r: 0x1f, g: 0x38, b: 0x64 });
    expect(hexToRgb('nope')).toBeNull();
    expect(rgbToHex(31, 56, 100)).toBe('#1f3864');
    // Clamps rather than wrapping.
    expect(rgbToHex(-10, 300, 128)).toBe('#00ff80');
  });

  it('applies shade and tint the way DrawingML defines them', () => {
    // shade 50% halves each channel toward black.
    expect(applyColorTransforms('#ffffff', { shade: 0.5 })).toBe('#808080');
    // tint 40% moves 60% of the way to white.
    expect(applyColorTransforms('#000000', { tint: 0.4 })).toBe('#999999');
    // No transform is the identity.
    expect(applyColorTransforms('#123456', {})).toBe('#123456');
  });

  it('applies lumMod/lumOff, which is how "Lighter 40%" is stored', () => {
    // A mid grey at lumMod 60% gets darker; lumOff pushes it back up.
    const darker = applyColorTransforms('#808080', { lumMod: 0.6 });
    expect(hexToRgb(darker)!.r).toBeLessThan(0x80);
    const lighter = applyColorTransforms('#808080', {
      lumMod: 0.6,
      lumOff: 0.4,
    });
    expect(hexToRgb(lighter)!.r).toBeGreaterThan(0x80);
    // Lightness saturates instead of wrapping.
    expect(applyColorTransforms('#808080', { lumOff: 5 })).toBe('#ffffff');
  });
});

describe('ooxml — theme + colour map', () => {
  const themeXml = `<?xml version="1.0"?><a:theme xmlns:a="A"><a:themeElements>
    <a:clrScheme name="Office">
      <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
      <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="1F3864"/></a:dk2>
      <a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>
      <a:accent1><a:srgbClr val="4472C4"/></a:accent1>
    </a:clrScheme>
    <a:fontScheme name="Office">
      <a:majorFont><a:latin typeface="Poppins"/></a:majorFont>
      <a:minorFont><a:latin typeface="Inter"/></a:minorFont>
    </a:fontScheme>
  </a:themeElements></a:theme>`;

  const theme = readTheme(parseXml(themeXml).map);

  it('reads srgbClr and sysClr slots plus the major/minor fonts', () => {
    expect(theme.colors.dk1).toBe('#000000');
    expect(theme.colors.lt1).toBe('#ffffff');
    expect(theme.colors.dk2).toBe('#1f3864');
    expect(theme.colors.accent1).toBe('#4472c4');
    expect(theme.majorFont).toBe('Poppins');
    expect(theme.minorFont).toBe('Inter');
  });

  it('honours a FLIPPED colour map — the dark-deck case', () => {
    // A dark design flips bg1/tx1 onto dk1/lt1. Ignoring the map is how
    // a dark deck's background resolves to white.
    const dark = readColorMap(
      parseXml(
        '<p:sldMaster xmlns:p="P"><p:clrMap bg1="dk1" tx1="lt1" bg2="dk2" tx2="lt2" accent1="accent1"/></p:sldMaster>',
      ).map,
    );
    expect(resolveSchemeSlot('bg1', { theme, colorMap: dark })).toBe('#000000');
    expect(resolveSchemeSlot('tx1', { theme, colorMap: dark })).toBe('#ffffff');

    // NEGATIVE CONTROL: the ordinary light map gives the opposite answer
    // from the same theme, so the map is genuinely doing the work.
    const light = readColorMap(
      parseXml(
        '<p:sldMaster xmlns:p="P"><p:clrMap bg1="lt1" tx1="dk1"/></p:sldMaster>',
      ).map,
    );
    expect(resolveSchemeSlot('bg1', { theme, colorMap: light })).toBe(
      '#ffffff',
    );
  });

  it('resolves a schemeClr with a transform, and refuses what it cannot', () => {
    const node = (
      parseXml(
        '<a:solidFill xmlns:a="A"><a:schemeClr val="dk2"><a:lumMod val="75000"/></a:schemeClr></a:solidFill>',
      ).map as Record<string, unknown>
    )['a:solidFill'];
    const resolved = resolveColorNode(node, { theme });
    expect(resolved).not.toBeNull();
    // Darker than the raw dk2 because lumMod 75% was applied.
    expect(hexToRgb(resolved!)!.b).toBeLessThan(hexToRgb('#1f3864')!.b);

    // An unknown slot with no theme stays null so the widget default wins.
    expect(resolveColorNode(node, {})).toBeNull();
    expect(resolveColorNode(null, { theme })).toBeNull();
  });

  it('resolves phClr against the supplied placeholder colour', () => {
    const node = (
      parseXml(
        '<a:solidFill xmlns:a="A"><a:schemeClr val="phClr"/></a:solidFill>',
      ).map as Record<string, unknown>
    )['a:solidFill'];
    expect(resolveColorNode(node, { placeholder: '#ff8800' })).toBe('#ff8800');
    expect(resolveColorNode(node, {})).toBeNull();
  });
});
