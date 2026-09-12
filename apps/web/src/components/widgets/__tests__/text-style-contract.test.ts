/**
 * M0-3 — ONE text-style contract, honoured by the builder, the player and
 * every EXTERNAL_HTML board.
 *
 * THE BUG: the builder's text bar writes BOOLEANS into `cfg._styles[field]`
 * (`{bold:true, italic:true, underline:true, strikethrough:true}`). Every
 * board shim reads CSS props only (`fontWeight` / `fontStyle` /
 * `textDecoration`). The EXTERNAL_HTML sender forwarded the map verbatim, so
 * on all 250 packaged boards Bold lit the button and changed nothing.
 *
 * These tests lock BOTH halves of the contract:
 *   1. the translation (`toCssTextStyle` / `toCssTextStyleMap`) — what goes
 *      over the wire to a board;
 *   2. the CSS-rule builders (`buildTextStyleRules` /
 *      `buildFieldOnlyStyleRules`) — what BuilderZone and the player emit,
 *      pinned BYTE FOR BYTE against the closures they replaced so the
 *      unification could not quietly restyle existing templates.
 */
import {
  BOLD_FONT_WEIGHT,
  buildFieldOnlyStyleRules,
  buildTextStyleRules,
  resolveFontStyle,
  resolveFontWeight,
  resolveHidden,
  resolveTextDecoration,
  toCssTextStyle,
  toCssTextStyleMap,
} from '../text-style-contract';

describe('text-style contract — boolean → CSS', () => {
  it('bold:true becomes fontWeight 800 (what the board shims read)', () => {
    expect(resolveFontWeight({ bold: true })).toBe(800);
    expect(BOLD_FONT_WEIGHT).toBe(800);
    expect(toCssTextStyle({ bold: true })).toEqual({ fontWeight: 800 });
  });

  it('a numeric fontWeight WINS over bold (explicit beats alias)', () => {
    expect(resolveFontWeight({ bold: true, fontWeight: 300 })).toBe(300);
    expect(toCssTextStyle({ bold: true, fontWeight: 300 })).toEqual({ fontWeight: 300 });
  });

  it('bold:false / absent emits no weight at all', () => {
    expect(resolveFontWeight({ bold: false })).toBeUndefined();
    expect(resolveFontWeight({})).toBeUndefined();
    expect(toCssTextStyle({ bold: false })).toEqual({});
  });

  it('italic:true becomes fontStyle italic; an explicit fontStyle wins', () => {
    expect(resolveFontStyle({ italic: true })).toBe('italic');
    expect(resolveFontStyle({ italic: true, fontStyle: 'normal' })).toBe('normal');
    expect(resolveFontStyle({})).toBeUndefined();
  });

  it('underline and strikethrough COMBINE into one textDecoration', () => {
    expect(resolveTextDecoration({ underline: true })).toBe('underline');
    expect(resolveTextDecoration({ strikethrough: true })).toBe('line-through');
    expect(resolveTextDecoration({ underline: true, strikethrough: true }))
      .toBe('underline line-through');
  });

  it('an explicit textDecoration string wins over both booleans, trimmed', () => {
    expect(resolveTextDecoration({ underline: true, strikethrough: true, textDecoration: '  overline  ' }))
      .toBe('overline');
  });

  it('hidden passes through; the legacy visibility string is its alias', () => {
    expect(resolveHidden({ hidden: true })).toBe(true);
    expect(resolveHidden({ hidden: false })).toBe(false);
    expect(resolveHidden({ visibility: 'hidden' })).toBe(true);
    expect(resolveHidden({ visibility: 'visible' })).toBe(false);
    expect(resolveHidden({})).toBeUndefined();
    // `hidden` is canonical — it beats a contradicting legacy visibility.
    expect(resolveHidden({ hidden: false, visibility: 'hidden' })).toBe(false);
  });

  it('translates the full nine-property set the operator can set', () => {
    expect(
      toCssTextStyle({
        fontFamily: ' Georgia, serif ',
        fontSize: 56,
        color: ' #fff ',
        backgroundColor: '#ff0000',
        bold: true,
        italic: true,
        underline: true,
        strikethrough: true,
        textAlign: 'center',
        lineHeight: 1.4,
        hidden: true,
      }),
    ).toEqual({
      fontFamily: 'Georgia, serif',
      fontSize: 56,
      color: '#fff',
      backgroundColor: '#ff0000',
      fontWeight: 800,
      fontStyle: 'italic',
      textDecoration: 'underline line-through',
      textAlign: 'center',
      lineHeight: 1.4,
      hidden: true,
    });
  });

  it('emits NO boolean aliases — a board shim would ignore them', () => {
    const css = toCssTextStyle({ bold: true, italic: true, underline: true, strikethrough: true }) as Record<string, unknown>;
    for (const alias of ['bold', 'italic', 'underline', 'strikethrough']) {
      expect(Object.prototype.hasOwnProperty.call(css, alias)).toBe(false);
    }
  });

  it('is idempotent — an already-CSS-shaped style survives a second pass', () => {
    const once = toCssTextStyle({ bold: true, underline: true, lineHeight: 1.4, textAlign: 'center' });
    expect(toCssTextStyle(once)).toEqual(once);
  });

  it('rejects a junk textAlign rather than forwarding it', () => {
    expect(toCssTextStyle({ textAlign: 'centre' as never })).toEqual({});
    expect(toCssTextStyle({ textAlign: 'justify' })).toEqual({ textAlign: 'justify' });
  });

  it('never throws on the shapes `_styles` can really hold', () => {
    expect(toCssTextStyle(null)).toEqual({});
    expect(toCssTextStyle(undefined)).toEqual({});
    expect(toCssTextStyle('bold')).toEqual({});
    expect(buildTextStyleRules(null)).toEqual([]);
    expect(buildFieldOnlyStyleRules(null)).toEqual([]);
  });

  it('keeps a string fontSize a saved template may hold', () => {
    expect(toCssTextStyle({ fontSize: '56px' as never })).toEqual({ fontSize: '56px' });
    // …but the CSS-rule builder still emits px only for a number, exactly as
    // BuilderZone always did.
    expect(buildTextStyleRules({ fontSize: '56px' as never })).toEqual([]);
  });
});

describe('text-style contract — map translation (what the sender ships)', () => {
  it('translates every field and drops the empties', () => {
    expect(
      toCssTextStyleMap({
        'hero.title': { bold: true, underline: true, lineHeight: 1.4, textAlign: 'center' },
        'hero.dek': { italic: true },
        'hero.note': {},
        'hero.bad': null,
      }),
    ).toEqual({
      'hero.title': {
        fontWeight: 800,
        textDecoration: 'underline',
        lineHeight: 1.4,
        textAlign: 'center',
      },
      'hero.dek': { fontStyle: 'italic' },
    });
  });

  it('returns undefined for a non-object so callers keep their `if (styles)` guard', () => {
    expect(toCssTextStyleMap(undefined)).toBeUndefined();
    expect(toCssTextStyleMap(null)).toBeUndefined();
    expect(toCssTextStyleMap('nope')).toBeUndefined();
    expect(toCssTextStyleMap({})).toEqual({});
  });
});

describe('text-style contract — CSS rules stay byte-identical', () => {
  // Pinned against the closures this replaced in BuilderZone (and the
  // subset the player carried). A change here restyles live templates.
  it('emits the historical declarations in the historical order', () => {
    expect(
      buildTextStyleRules({
        fontFamily: 'Georgia, serif',
        fontSize: 56,
        color: '#fff',
        lineHeight: 1.4,
        textAlign: 'center',
        bold: true,
        italic: true,
        underline: true,
        strikethrough: true,
      }),
    ).toEqual([
      'font-family: Georgia, serif !important',
      'font-size: 56px !important',
      'color: #fff !important',
      'line-height: 1.4 !important',
      'text-align: center !important',
      'font-weight: 800 !important',
      'font-style: italic !important',
      'text-decoration: underline line-through !important',
    ]);
  });

  it('honours a brand token color verbatim (it must resolve against the canvas vars)', () => {
    expect(buildTextStyleRules({ color: 'var(--brand-primary)' }))
      .toEqual(['color: var(--brand-primary) !important']);
  });

  it('emits font-weight 0 rather than swallowing it (the old closure did)', () => {
    expect(buildTextStyleRules({ fontWeight: 0 })).toEqual(['font-weight: 0 !important']);
  });

  it('field-only rules paint the element, never its descendants', () => {
    expect(buildFieldOnlyStyleRules({ backgroundColor: ' #fef08a ', hidden: true }))
      .toEqual(['background-color: #fef08a !important', 'display: none !important']);
    expect(buildFieldOnlyStyleRules({ visibility: 'hidden' }))
      .toEqual(['visibility: hidden !important']);
    // hidden:true wins over a visibility rule — display:none is the stronger
    // statement and emitting both would be contradictory.
    expect(buildFieldOnlyStyleRules({ hidden: true, visibility: 'visible' }))
      .toEqual(['display: none !important']);
    expect(buildFieldOnlyStyleRules({ hidden: false })).toEqual([]);
  });
});
