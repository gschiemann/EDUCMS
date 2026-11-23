/**
 * brand-identity — the rebrand rule.
 *
 * Owner, before a demo: "when I update the branding it does give me the new
 * logo but it doesn't try to apply the new name and tagline". A brand is a
 * name, a tagline, initials and a logo as well as colours, and a SECOND brand
 * must replace what the first one stamped — but never text typed by hand.
 */
import {
  BOARD_LOGO_SLOTS,
  BOARD_NAME_FIELDS,
  BOARD_TAGLINE_FIELDS,
  BrandLike,
  brandKitAsBrand,
  brandKitSnapshot,
  deriveInitials,
  identityFromBrand,
  isBrandOwned,
  patchTemplateBackground,
  patchZoneIdentity,
  patchZoneStyle,
  styleFromBrand,
} from './brand-identity';

const OLD: BrandLike = {
  displayName: 'Westridge High School',
  tagline: 'Home of the Wildcats',
  logoUrl: 'https://cdn.example/old-logo.png',
  palette: {
    primary: '#112233',
    accent: '#445566',
    ink: '#0a0a0a',
    surface: '#fafafa',
  },
  fontHeading: 'Oswald',
  fontBody: 'Inter',
};
const NEW: BrandLike = {
  displayName: 'Buena Park Academy',
  tagline: 'Learning without limits',
  logoUrl: 'https://cdn.example/new-logo.png',
  palette: {
    primary: '#aa0000',
    accent: '#00aa00',
    ink: '#222222',
    surface: '#ffffee',
  },
  fontHeading: 'Montserrat',
  fontBody: 'Lato',
};

describe('deriveInitials / identityFromBrand', () => {
  it('first letter of up to three words, skipping stop words, uppercase', () => {
    expect(deriveInitials('Buena Park High School')).toBe('BPH');
    expect(deriveInitials('The Academy of Arts')).toBe('AA');
    expect(deriveInitials('north-east/central_campus')).toBe('NEC');
    expect(deriveInitials('')).toBe('');
    expect(deriveInitials(null)).toBe('');
  });

  it('only reports values the brand actually has', () => {
    expect(
      identityFromBrand({ displayName: '  ', tagline: null, logoUrl: '' }),
    ).toEqual({
      name: null,
      tagline: null,
      initials: null,
      monogram: null,
      logoUrl: null,
    });
    expect(identityFromBrand(NEW)).toEqual({
      name: 'Buena Park Academy',
      tagline: 'Learning without limits',
      initials: 'BPA',
      monogram: 'B',
      logoUrl: 'https://cdn.example/new-logo.png',
    });
  });

  it('isBrandOwned: blank, or the previous brand case-insensitively; override always', () => {
    expect(isBrandOwned(undefined, [], 'fill-blanks')).toBe(true);
    expect(isBrandOwned('  ', [], 'fill-blanks')).toBe(true);
    expect(
      isBrandOwned(
        'WESTRIDGE HIGH SCHOOL',
        ['Westridge High School'],
        'fill-blanks',
      ),
    ).toBe(true);
    expect(
      isBrandOwned('Our own words', ['Westridge High School'], 'fill-blanks'),
    ).toBe(false);
    expect(
      isBrandOwned('Our own words', ['Westridge High School'], 'override'),
    ).toBe(true);
  });
});

describe('patchZoneIdentity — EXTERNAL_HTML boards', () => {
  const board = (cfg: Record<string, unknown> = {}) => ({
    widgetType: 'EXTERNAL_HTML',
    cfg,
  });

  it('the first brand fills every name / tagline / initials / logo field', () => {
    const r = patchZoneIdentity(board(), NEW, null, 'fill-blanks');
    const text = r.cfg.textOverrides as Record<string, string>;
    for (const k of BOARD_NAME_FIELDS)
      expect(text[k]).toBe('Buena Park Academy');
    for (const k of BOARD_TAGLINE_FIELDS)
      expect(text[k]).toBe('Learning without limits');
    expect(text['school.initials']).toBe('BPA');
    expect(text['brand.initials']).toBe('BPA');
    expect(text['brand.mark']).toBe('BPA');
    expect(text['brand.monogram']).toBe('B');
    const img = r.cfg.imageOverrides as Record<string, string>;
    for (const k of BOARD_LOGO_SLOTS)
      expect(img[k]).toBe('https://cdn.example/new-logo.png');
    expect(r.changed.sort()).toEqual(['initials', 'logo', 'name', 'tagline']);
  });

  it('a rebrand replaces what the previous brand stamped (name, tagline, initials, logo)', () => {
    const first = patchZoneIdentity(
      board({ title: 'kept' }),
      OLD,
      null,
      'fill-blanks',
    ).cfg;
    const r = patchZoneIdentity(board(first), NEW, OLD, 'fill-blanks');
    const text = r.cfg.textOverrides as Record<string, string>;
    expect(text['brand.name']).toBe('Buena Park Academy');
    expect(text['brand.tagline']).toBe('Learning without limits');
    expect(text['school.initials']).toBe('BPA');
    expect(text['brand.monogram']).toBe('B');
    expect((r.cfg.imageOverrides as Record<string, string>)['brand.logo']).toBe(
      'https://cdn.example/new-logo.png',
    );
    expect(r.cfg.title).toBe('kept');
  });

  it('recognises the old logo held as a one-item list', () => {
    const r = patchZoneIdentity(
      board({
        imageOverrides: { 'brand.logo': ['https://cdn.example/old-logo.png'] },
      }),
      NEW,
      OLD,
      'fill-blanks',
    );
    expect(
      (r.cfg.imageOverrides as Record<string, unknown>)['brand.logo'],
    ).toBe('https://cdn.example/new-logo.png');
  });

  it('a hand-typed name and a rotating photo list survive fill-blanks, and are replaced in override', () => {
    const cfg = {
      textOverrides: {
        'brand.name': 'Our Cafe',
        'brand.tagline': 'Home of the Wildcats',
        'menu.item1': 'Tacos',
      },
      imageOverrides: {
        'brand.logo': [
          'https://cdn.example/a.png',
          'https://cdn.example/b.png',
        ],
      },
    };
    const kept = patchZoneIdentity(board(cfg), NEW, OLD, 'fill-blanks').cfg;
    const t = kept.textOverrides as Record<string, string>;
    expect(t['brand.name']).toBe('Our Cafe');
    expect(t['brand.tagline']).toBe('Learning without limits'); // was the old brand's → brand-owned
    expect(t['menu.item1']).toBe('Tacos');
    expect(
      (kept.imageOverrides as Record<string, unknown>)['brand.logo'],
    ).toEqual(['https://cdn.example/a.png', 'https://cdn.example/b.png']);

    const forced = patchZoneIdentity(board(cfg), NEW, OLD, 'override').cfg;
    expect((forced.textOverrides as Record<string, string>)['brand.name']).toBe(
      'Buena Park Academy',
    );
    expect((forced.textOverrides as Record<string, string>)['menu.item1']).toBe(
      'Tacos',
    );
    expect(
      (forced.imageOverrides as Record<string, unknown>)['brand.logo'],
    ).toBe('https://cdn.example/new-logo.png');
  });

  it('no previous brand: blanks only — existing text is never replaced', () => {
    const r = patchZoneIdentity(
      board({ textOverrides: { 'brand.name': 'Westridge High School' } }),
      NEW,
      null,
      'fill-blanks',
    );
    expect((r.cfg.textOverrides as Record<string, string>)['brand.name']).toBe(
      'Westridge High School',
    );
    expect((r.cfg.textOverrides as Record<string, string>)['school.name']).toBe(
      'Buena Park Academy',
    );
  });

  it('a brand with no name / tagline / logo never blanks existing content', () => {
    const cfg = {
      textOverrides: { 'brand.name': 'Westridge High School' },
      imageOverrides: { 'brand.logo': 'x.png' },
    };
    const r = patchZoneIdentity(
      board(cfg),
      { displayName: null, tagline: '', logoUrl: null },
      OLD,
      'override',
    );
    expect(r.cfg).toEqual(cfg);
    expect(r.changed).toEqual([]);
  });

  it('never touches the mixed-meaning keys', () => {
    const cfg = {
      textOverrides: {
        'brand.tag': 'EST 1952',
        'school.sub': 'Go cats',
        'brand.promise': 'p',
        'brand.descriptor': 'd',
        'school.systemName': 's',
      },
    };
    const r = patchZoneIdentity(board(cfg), NEW, OLD, 'override');
    const t = r.cfg.textOverrides as Record<string, string>;
    expect(t['brand.tag']).toBe('EST 1952');
    expect(t['school.sub']).toBe('Go cats');
    expect(t['brand.promise']).toBe('p');
    expect(t['brand.descriptor']).toBe('d');
    expect(t['school.systemName']).toBe('s');
  });

  it('does not mutate its input', () => {
    const cfg = { textOverrides: { 'brand.name': '' } };
    patchZoneIdentity(board(cfg), NEW, null, 'fill-blanks');
    expect(cfg).toEqual({ textOverrides: { 'brand.name': '' } });
  });
});

describe('patchZoneIdentity — React widgets', () => {
  it('LOGO gets the logo, name and tagline; initials only where the key exists', () => {
    const r = patchZoneIdentity(
      { widgetType: 'LOGO', cfg: { theme: 'scorebug' } },
      NEW,
      null,
      'fill-blanks',
    );
    expect(r.cfg).toMatchObject({
      logoUrl: 'https://cdn.example/new-logo.png',
      assetUrl: 'https://cdn.example/new-logo.png',
      schoolName: 'Buena Park Academy',
      tagline: 'Learning without limits',
    });
    expect('initials' in r.cfg).toBe(false);
    const withInitials = patchZoneIdentity(
      { widgetType: 'LOGO', cfg: { initials: 'WHS' } },
      NEW,
      OLD,
      'fill-blanks',
    );
    expect(withInitials.cfg.initials).toBe('BPA');
  });

  it('HS_* stores the name uppercased; a rebrand recognises the uppercased old name', () => {
    const first = patchZoneIdentity(
      { widgetType: 'HS_VARSITY', cfg: {} },
      OLD,
      null,
      'fill-blanks',
    ).cfg;
    expect(first).toMatchObject({
      schoolName: 'WESTRIDGE HIGH SCHOOL',
      schoolInitials: 'WHS',
    });
    const r = patchZoneIdentity(
      { widgetType: 'HS_VARSITY', cfg: first },
      NEW,
      OLD,
      'fill-blanks',
    );
    expect(r.cfg).toMatchObject({
      schoolName: 'BUENA PARK ACADEMY',
      schoolInitials: 'BPA',
    });
  });

  it("other widgets: only when the config carries schoolName (a person's initials / a sponsor tagline stay)", () => {
    const staff = patchZoneIdentity(
      { widgetType: 'STAFF_SPOTLIGHT', cfg: { initials: 'JD' } },
      NEW,
      OLD,
      'override',
    );
    expect(staff.cfg).toEqual({ initials: 'JD' });
    const sponsor = patchZoneIdentity(
      { widgetType: 'SPONSOR_BANNER', cfg: { tagline: '' } },
      NEW,
      null,
      'fill-blanks',
    );
    expect(sponsor.cfg).toEqual({ tagline: '' });
    const themed = patchZoneIdentity(
      {
        widgetType: 'CLOCK',
        cfg: {
          schoolName: 'Westridge High School',
          initials: 'WHS',
          tagline: 'Home of the Wildcats',
        },
      },
      NEW,
      OLD,
      'fill-blanks',
    );
    expect(themed.cfg).toEqual({
      schoolName: 'Buena Park Academy',
      initials: 'BPA',
      tagline: 'Learning without limits',
    });
    const clock = patchZoneIdentity(
      { widgetType: 'CLOCK', cfg: {} },
      NEW,
      null,
      'fill-blanks',
    );
    expect(clock.cfg).toEqual({});
  });
});

describe('patchZoneStyle — colours, fonts, board tokens', () => {
  const nextStyle = styleFromBrand(NEW, true);

  it('no previous brand: exactly the old fill-blanks behaviour', () => {
    const blank = patchZoneStyle(
      { widgetType: 'TEXT', cfg: {} },
      nextStyle,
      null,
      'fill-blanks',
    );
    expect(blank.cfg).toEqual({
      color: '#222222',
      fontFamily: 'Montserrat',
      accentColor: '#00aa00',
    });
    const custom = patchZoneStyle(
      { widgetType: 'TEXT', cfg: { color: '#0a0a0a', fontFamily: 'Oswald' } },
      nextStyle,
      null,
      'fill-blanks',
    );
    expect(custom.cfg).toMatchObject({
      color: '#0a0a0a',
      fontFamily: 'Oswald',
    });
    const definedBrand = patchZoneStyle(
      { widgetType: 'EXTERNAL_HTML', cfg: { brand: { primary: '#112233' } } },
      nextStyle,
      null,
      'fill-blanks',
    );
    expect(definedBrand.cfg.brand).toEqual({ primary: '#112233' });
  });

  it("a rebrand replaces the previous brand's colours and fonts, keeps a hand-picked one", () => {
    const r = patchZoneStyle(
      {
        widgetType: 'TEXT',
        cfg: { color: '#0A0A0A', fontFamily: 'Oswald', accentColor: '#ff00ff' },
      },
      nextStyle,
      OLD,
      'fill-blanks',
    );
    expect(r.cfg).toEqual({
      color: '#222222',
      fontFamily: 'Montserrat',
      accentColor: '#ff00ff',
    });
    expect(r.changed).toBe(true);
  });

  it('a board token map the previous brand stamped is replaced whole; a hand-edited key stays', () => {
    const prevTokens = styleFromBrand(OLD, false).tokens;
    const whole = patchZoneStyle(
      { widgetType: 'EXTERNAL_HTML', cfg: { brand: { ...prevTokens } } },
      nextStyle,
      OLD,
      'fill-blanks',
    );
    expect(whole.cfg.brand).toEqual(nextStyle.tokens);
    const mixed = patchZoneStyle(
      {
        widgetType: 'EXTERNAL_HTML',
        cfg: { brand: { ...prevTokens, text: '#ffffff' } },
      },
      nextStyle,
      OLD,
      'fill-blanks',
    );
    expect(mixed.cfg.brand).toMatchObject({
      primary: '#aa0000',
      accent: '#00aa00',
      text: '#ffffff',
      fontDisplay: 'Montserrat',
    });
    // The editor's shape (fontBody falls back to the heading font) is recognised too.
    const editor = patchZoneStyle(
      {
        widgetType: 'EXTERNAL_HTML',
        cfg: {
          brand: {
            primary: '#112233',
            accent: '#445566',
            fontDisplay: 'Oswald',
            fontBody: 'Oswald',
          },
        },
      },
      nextStyle,
      { ...OLD, fontBody: null },
      'fill-blanks',
    );
    expect(editor.cfg.brand).toEqual(nextStyle.tokens);
  });

  it('idempotent: applying the same brand twice changes nothing', () => {
    const once = patchZoneStyle(
      { widgetType: 'EXTERNAL_HTML', cfg: {} },
      nextStyle,
      null,
      'fill-blanks',
    ).cfg;
    const twice = patchZoneStyle(
      { widgetType: 'EXTERNAL_HTML', cfg: once },
      nextStyle,
      NEW,
      'fill-blanks',
    );
    expect(twice.changed).toBe(false);
    const named = patchZoneIdentity(
      {
        widgetType: 'EXTERNAL_HTML',
        cfg: patchZoneIdentity(
          { widgetType: 'EXTERNAL_HTML', cfg: {} },
          NEW,
          null,
          'fill-blanks',
        ).cfg,
      },
      NEW,
      NEW,
      'fill-blanks',
    );
    expect(named.changed).toEqual([]);
  });
});

describe('patchTemplateBackground', () => {
  const nextStyle = styleFromBrand(NEW, true);
  const newBg = {
    bgColor: '#aa0000',
    bgGradient: 'linear-gradient(135deg, #aa0000 0%, #00aa00 100%)',
  };

  it('no background → the brand; a designed background stays without a previous brand', () => {
    expect(
      patchTemplateBackground(
        { bgColor: null, bgGradient: null, bgImage: null },
        nextStyle,
        null,
        'fill-blanks',
      ),
    ).toEqual(newBg);
    expect(
      patchTemplateBackground(
        { bgColor: '#fafafa', bgGradient: null, bgImage: null },
        nextStyle,
        null,
        'fill-blanks',
      ),
    ).toEqual({});
  });

  it("the previous brand's gradient or surface is replaced; a photo or a custom colour is not", () => {
    expect(
      patchTemplateBackground(
        {
          bgColor: '#112233',
          bgGradient: 'linear-gradient(135deg, #112233 0%, #445566 100%)',
          bgImage: null,
        },
        nextStyle,
        OLD,
        'fill-blanks',
      ),
    ).toEqual(newBg);
    expect(
      patchTemplateBackground(
        { bgColor: '#fafafa', bgGradient: null, bgImage: null },
        nextStyle,
        OLD,
        'fill-blanks',
      ),
    ).toEqual(newBg);
    expect(
      patchTemplateBackground(
        { bgColor: '#fafafa', bgGradient: null, bgImage: 'photo.jpg' },
        nextStyle,
        OLD,
        'fill-blanks',
      ),
    ).toEqual({});
    expect(
      patchTemplateBackground(
        { bgColor: '#123456', bgGradient: null, bgImage: null },
        nextStyle,
        OLD,
        'fill-blanks',
      ),
    ).toEqual({});
    expect(
      patchTemplateBackground(
        { bgColor: '#123456', bgGradient: null, bgImage: null },
        nextStyle,
        OLD,
        'override',
      ),
    ).toEqual(newBg);
  });
});

describe('brandKitSnapshot / brandKitAsBrand', () => {
  it('the snapshot carries the tagline so the next rebrand can recognise it', () => {
    const snap = brandKitSnapshot(
      { ...NEW, scrapedAt: new Date('2026-01-01T00:00:00Z') },
      new Date('2026-11-23T00:00:00Z'),
    );
    expect(snap).toMatchObject({
      displayName: 'Buena Park Academy',
      tagline: 'Learning without limits',
      logoUrl: 'https://cdn.example/new-logo.png',
      fontHeading: 'Montserrat',
      scrapedAt: '2026-01-01T00:00:00.000Z',
      inheritedAt: '2026-11-23T00:00:00.000Z',
      inheritedFrom: 'tenant-branding',
    });
    expect(brandKitAsBrand(snap)).toBe(snap);
    expect(brandKitAsBrand(JSON.stringify(snap))).toMatchObject({
      tagline: 'Learning without limits',
    });
    expect(brandKitAsBrand(null)).toBeNull();
    expect(brandKitAsBrand([])).toBeNull();
    expect(brandKitAsBrand('not json')).toBeNull();
  });
});
