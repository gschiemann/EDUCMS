import {
  BOARD_INITIALS_FIELDS,
  BOARD_NAME_FIELDS,
  BOARD_TAGLINE_FIELDS,
  backgroundBaseColor,
  brandBackgrounds,
  brandChecklist,
  brandColors,
  brandIdentity,
  brandInitials,
  brandTemplateBackground,
  brandTextZone,
  brandZoneConfig,
  contrastRatio,
  currentPlacement,
  hasBrand,
  kitFromTenantBranding,
  logoCornerGeometry,
  identitySnapshot,
  logoSize,
  pickBrandKit,
  placeBox,
  readableOn,
  type BrandKitLike,
} from '../brand-kit-actions';

const px = (g: { width: number; height: number }, c: { width: number; height: number }) =>
  ({ w: (g.width / 100) * c.width, h: (g.height / 100) * c.height });
const C = { width: 1920, height: 1080 };
const KIT = {
  logoUrl: 'https://cdn.example/logo.png',
  palette: { primary: '#1d4ed8', accent: '#f59e0b', ink: '#0f172a', surface: '#f8fafc' },
  fontHeading: 'Oswald',
  fontBody: 'Lato',
};

describe('hasBrand — the gate for the whole tab (and for "Brand this template")', () => {
  it('needs a logo, a colour or a font', () => {
    expect(hasBrand(null)).toBe(false);
    expect(hasBrand({})).toBe(false);
    expect(hasBrand({ palette: {} })).toBe(false);
    expect(hasBrand({ palette: { primary: 'not-a-colour' } })).toBe(false);
    expect(hasBrand({ logoUrl: 'x.png' })).toBe(true);
    expect(hasBrand({ fontBody: 'Lato' })).toBe(true);
    expect(hasBrand({ palette: { primary: '#abc' } })).toBe(true);
  });

  it('reads the organisation brand in the kit shape', () => {
    expect(kitFromTenantBranding({ logoUrl: 'l.png', palette: { primary: '#111111' }, displayName: 'X' })).toMatchObject({ logoUrl: 'l.png', palette: { primary: '#111111' }, displayName: 'X' });
    expect(kitFromTenantBranding(null)).toBeNull();
  });
});

describe('brandColors', () => {
  it('lists distinct hex colours in a fixed order, normalised', () => {
    expect(brandColors({ primary: '#ABC', accent: '#aabbcc', ink: '#000000' })).toEqual([
      { key: 'primary', hex: '#aabbcc' },
      { key: 'ink', hex: '#000000' },
    ]);
  });
});

describe('logo placement', () => {
  it('keeps a square logo square on 16:9 with equal pixel margins (top-left)', () => {
    const g = logoCornerGeometry({ width: 500, height: 500 }, C);
    const p = px(g, C);
    expect(p.w).toBeCloseTo(p.h);
    expect((g.x / 100) * C.width).toBeCloseTo((g.y / 100) * C.height);
  });

  it('caps a very wide wordmark at 28% of the width, aspect intact', () => {
    const s = logoSize({ width: 2000, height: 100 }, C);
    expect(s.width).toBeCloseTo(28);
    const p = px(s, C);
    expect(p.w / p.h).toBeCloseTo(20);
  });

  it('places a box in each corner and the centre, and reads the placement back', () => {
    const size = { width: 10, height: 15 };
    const tr = placeBox('top-right', size, C);
    expect(tr.x + tr.width).toBeCloseTo(100 - (C.height * 0.03 / C.width) * 100);
    const br = placeBox('bottom-right', size, C);
    expect(br.y + br.height).toBeCloseTo(97);
    const ce = placeBox('center', size, C);
    expect(ce.x).toBeCloseTo(45);
    expect(ce.y).toBeCloseTo(42.5);
    for (const p of ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center'] as const) {
      expect(currentPlacement(placeBox(p, size, C), C)).toBe(p);
    }
    expect(currentPlacement({ x: 30, y: 30, width: 10, height: 10 }, C)).toBeNull();
  });
});

describe('colour maths', () => {
  it('readableOn picks the first preferred colour that meets the ratio, else white/ink', () => {
    expect(readableOn('#ffffff', ['#1d4ed8'], 3)).toBe('#1d4ed8');
    expect(readableOn('#1d4ed8', ['#1e40af'], 3)).toBe('#ffffff'); // blue on blue fails → white
    expect(contrastRatio(readableOn('#f8fafc', [], 4.5, '#0f172a'), '#f8fafc')).toBeGreaterThan(4.5);
  });

  it('the colour text sits on: solid, else the middle of the gradient, else white', () => {
    expect(backgroundBaseColor({ bgColor: '#000000', bgGradient: '' })).toBe('#000000');
    expect(backgroundBaseColor({ bgColor: '', bgGradient: 'linear-gradient(135deg, #000000 0%, #ffffff 100%)' })).toBe('#808080');
    expect(backgroundBaseColor({})).toBe('#ffffff');
  });
});

describe('brandBackgrounds', () => {
  it('every brand colour solid + gradients + a dark and a light option, no duplicates', () => {
    const bgs = brandBackgrounds(KIT.palette);
    const ids = bgs.map((b) => b.id);
    expect(ids).toEqual(expect.arrayContaining(['solid-primary', 'solid-accent', 'solid-ink', 'solid-surface', 'gradient-diagonal', 'gradient-deep', 'gradient-ink', 'dark', 'light']));
    const gradients = bgs.filter((b) => b.bgGradient);
    expect(gradients.length).toBeGreaterThanOrEqual(2);
    expect(gradients.length).toBeLessThanOrEqual(3);
    expect(new Set(bgs.map((b) => `${b.bgColor}|${b.bgGradient}`)).size).toBe(bgs.length);
    expect(luma(bgs.find((b) => b.id === 'dark')!.bgColor)).toBeLessThan(0.1);
    expect(luma(bgs.find((b) => b.id === 'light')!.bgColor)).toBeGreaterThan(0.8);
  });

  it('nothing when the brand has no colours', () => {
    expect(brandBackgrounds({})).toEqual([]);
  });
});
function luma(hex: string) {
  const n = (i: number) => parseInt(hex.slice(i, i + 2), 16) / 255;
  return 0.2126 * n(1) + 0.7152 * n(3) + 0.0722 * n(5);
}

describe('brandTextZone', () => {
  it('a heading is centred, in the heading font, bold, and reads on the background', () => {
    const z = brandTextZone('heading', KIT, '#ffffff', 'Hi');
    expect(z.x + z.width / 2).toBeCloseTo(50);
    expect(z.y + z.height / 2).toBeCloseTo(50);
    expect(z.config).toMatchObject({ content: 'Hi', fontFamily: 'Oswald', bold: true, color: '#1d4ed8' });
  });

  it('body uses the body font and a dark-background-safe colour', () => {
    const z = brandTextZone('body', KIT, '#0b1020', 'Hi');
    expect(z.config.fontFamily).toBe('Lato');
    expect(z.config.color).toBe('#ffffff');
  });

  it('the call to action is a filled pill in the brand primary', () => {
    const z = brandTextZone('cta', KIT, '#ffffff', 'Go');
    expect(z.config).toMatchObject({ bgColor: '#1d4ed8', borderRadius: 9999, bold: true });
    expect(contrastRatio(String(z.config.color), '#1d4ed8')).toBeGreaterThanOrEqual(4.5);
  });

  it('a new box takes the free slot nearest the centre instead of covering one', () => {
    const a = brandTextZone('caption', KIT, '#ffffff', 'a');
    const b = brandTextZone('caption', KIT, '#ffffff', 'b', [a]);
    expect(b.y).toBeGreaterThanOrEqual(a.y + a.height);
    const heading = brandTextZone('heading', KIT, '#ffffff', 'h');
    const cta = brandTextZone('cta', KIT, '#ffffff', 'c', [heading]);
    const overlap = cta.y < heading.y + heading.height && heading.y < cta.y + cta.height;
    expect(overlap).toBe(false);
  });
});

describe('Brand this template', () => {
  it('the checklist names only what this kit can do', () => {
    expect(brandChecklist(KIT)).toEqual(['logo', 'fonts', 'colors', 'background']);
    expect(brandChecklist({ fontHeading: 'Oswald' })).toEqual(['fonts']);
  });

  it('background: a primary→accent gradient, else a solid', () => {
    expect(brandTemplateBackground(KIT)!.bgGradient).toContain('#1d4ed8');
    expect(brandTemplateBackground({ palette: { surface: '#eeeeee' } })).toEqual({ bgColor: '#eeeeee', bgGradient: '', bgImage: '' });
    expect(brandTemplateBackground({ fontBody: 'Lato' })).toBeNull();
  });

  it('a packaged board gets brand accent + fonts AND the logo in its logo slots', () => {
    const cfg = brandZoneConfig({ widgetType: 'EXTERNAL_HTML', defaultConfig: { url: '/templates/x.html' } }, KIT);
    expect(cfg.brand).toEqual({ primary: '#1d4ed8', accent: '#f59e0b', fontDisplay: 'Oswald', fontBody: 'Lato' });
    expect(cfg.imageOverrides).toEqual({ 'brand.logo': KIT.logoUrl, 'school.logo': KIT.logoUrl });
  });

  it('text, logo and ticker get their brand fields; an unmodelled widget only its own keys', () => {
    expect(brandZoneConfig({ widgetType: 'TEXT', defaultConfig: {} }, KIT)).toMatchObject({ fontFamily: 'Oswald', color: '#0f172a' });
    expect(brandZoneConfig({ widgetType: 'LOGO', defaultConfig: {} }, KIT)).toMatchObject({ assetUrl: KIT.logoUrl, logoUrl: KIT.logoUrl });
    const ticker = brandZoneConfig({ widgetType: 'TICKER', defaultConfig: {} }, KIT);
    expect(ticker.bgColor).toBe('#1d4ed8');
    expect(contrastRatio(String(ticker.color), '#1d4ed8')).toBeGreaterThanOrEqual(4.5);
    expect(brandZoneConfig({ widgetType: 'SOMETHING', defaultConfig: { a: 1 } }, KIT)).toEqual({ a: 1 });
  });
});

describe('Brand this template — the organisation name, tagline and initials (owner, demo rebrand)', () => {
  const REBRAND = { ...KIT, displayName: 'Lincoln High School', tagline: 'Home of the Eagles' };

  it('brandInitials: the same rule a new template gets from the API', () => {
    expect(brandInitials('Lincoln High School')).toBe('LHS');
    expect(brandInitials('The Academy of Arts')).toBe('AA');
    expect(brandInitials('north-west_college/east campus')).toBe('NWC');
    expect(brandInitials('')).toBe('');
    expect(brandInitials(null)).toBe('');
    expect(brandIdentity(REBRAND)).toEqual({ name: 'Lincoln High School', tagline: 'Home of the Eagles', initials: 'LHS', monogram: 'L' });
    expect(brandIdentity({ displayName: '   ', tagline: '' })).toEqual({ name: null, tagline: null, initials: null, monogram: null });
  });

  it('the checklist names the name and tagline when the brand has them', () => {
    expect(brandChecklist(REBRAND)).toEqual(['logo', 'name', 'tagline', 'fonts', 'colors', 'background']);
    expect(brandChecklist({ ...KIT, displayName: 'Lincoln High School' })).toEqual(['logo', 'name', 'fonts', 'colors', 'background']);
    expect(brandChecklist({ ...KIT, displayName: ' ', tagline: '' })).toEqual(['logo', 'fonts', 'colors', 'background']);
  });

  it('a packaged board gets the name, tagline, initials, monogram AND the logo, replacing the old brand', () => {
    const cfg = brandZoneConfig({
      widgetType: 'EXTERNAL_HTML',
      defaultConfig: {
        url: '/templates/x.html',
        textOverrides: { 'brand.name': 'Old Academy', 'brand.tagline': 'Old motto', 'school.initials': 'OA', 'menu.item1': 'Tacos' },
        imageOverrides: { 'brand.logo': 'https://cdn.example/old.png', 'hero.photo': 'h.jpg' },
      },
    }, REBRAND);
    const text = cfg.textOverrides as Record<string, string>;
    for (const k of BOARD_NAME_FIELDS) expect(text[k]).toBe('Lincoln High School');
    for (const k of BOARD_TAGLINE_FIELDS) expect(text[k]).toBe('Home of the Eagles');
    for (const k of BOARD_INITIALS_FIELDS) expect(text[k]).toBe('LHS');
    expect(text['brand.monogram']).toBe('L');
    expect(text['menu.item1']).toBe('Tacos');
    expect(cfg.imageOverrides).toEqual({ 'brand.logo': KIT.logoUrl, 'school.logo': KIT.logoUrl, 'hero.photo': 'h.jpg' });
    // Mixed-meaning fields are never written.
    for (const k of ['brand.tag', 'school.sub', 'brand.promise', 'brand.descriptor', 'school.systemName']) expect(text[k]).toBeUndefined();
  });

  it('a LOGO widget gets the logo, name and tagline; initials only where it already carries them', () => {
    const plain = brandZoneConfig({ widgetType: 'LOGO', defaultConfig: { variant: 'logo-wordmark', schoolName: 'Old Academy', tagline: 'Old motto' } }, REBRAND);
    expect(plain).toMatchObject({ assetUrl: KIT.logoUrl, logoUrl: KIT.logoUrl, schoolName: 'Lincoln High School', tagline: 'Home of the Eagles' });
    expect(plain).not.toHaveProperty('initials');
    const crest = brandZoneConfig({ widgetType: 'LOGO', defaultConfig: { theme: 'stem-lab', initials: 'OA' } }, REBRAND);
    expect(crest).toMatchObject({ schoolName: 'Lincoln High School', initials: 'LHS' });
  });

  it('an HS_* widget gets the name uppercased and its school initials', () => {
    const cfg = brandZoneConfig({ widgetType: 'HS_VARSITY', defaultConfig: { schoolName: 'OLD ACADEMY', schoolInitials: 'OA', department: 'Athletics' } }, REBRAND);
    expect(cfg).toMatchObject({ schoolName: 'LINCOLN HIGH SCHOOL', schoolInitials: 'LHS', department: 'Athletics' });
    expect(cfg).not.toHaveProperty('tagline');
  });

  it('a widget whose initials / tagline mean a person or a sponsor (no schoolName) is left alone', () => {
    const staff = { initials: 'JD', name: 'Jane Doe' };
    expect(brandZoneConfig({ widgetType: 'STAFF_SPOTLIGHT', defaultConfig: staff }, REBRAND)).toMatchObject(staff);
    const sponsor = { sponsor: 'Acme Hardware', tagline: 'Proud supporter of student athletes.' };
    expect(brandZoneConfig({ widgetType: 'RIBBON_SPONSOR', defaultConfig: sponsor }, REBRAND)).toEqual(sponsor);
  });

  it('a widget that carries schoolName gets the name and only the identity keys it already has', () => {
    const cfg = brandZoneConfig({ widgetType: 'SOMETHING', defaultConfig: { schoolName: 'Old Academy', initials: 'OA', tagline: 'Old' } }, REBRAND);
    expect(cfg).toEqual({ schoolName: 'Lincoln High School', initials: 'LHS', tagline: 'Home of the Eagles' });
    expect(brandZoneConfig({ widgetType: 'SOMETHING', defaultConfig: { schoolName: 'Old Academy' } }, REBRAND)).toEqual({ schoolName: 'Lincoln High School' });
  });

  it('a brand with no tagline writes no tagline and never an empty string', () => {
    const noTagline = { ...KIT, displayName: 'Lincoln High School', tagline: '' };
    const board = brandZoneConfig({ widgetType: 'EXTERNAL_HTML', defaultConfig: { textOverrides: { 'brand.tagline': 'Kept motto' } } }, noTagline);
    const text = board.textOverrides as Record<string, string>;
    expect(text['brand.tagline']).toBe('Kept motto');
    expect(text['school.motto']).toBeUndefined();
    expect(text['brand.name']).toBe('Lincoln High School');
    const logo = brandZoneConfig({ widgetType: 'LOGO', defaultConfig: { tagline: 'Kept motto' } }, noTagline);
    expect(logo.tagline).toBe('Kept motto');
    expect(Object.values(text)).not.toContain('');
  });

  it('a brand with no name and no tagline leaves every text field as it was', () => {
    const before = { url: '/templates/x.html', textOverrides: { 'brand.name': 'Kept' } };
    const cfg = brandZoneConfig({ widgetType: 'EXTERNAL_HTML', defaultConfig: before }, { palette: KIT.palette });
    expect(cfg.textOverrides).toEqual({ 'brand.name': 'Kept' });
    expect(brandZoneConfig({ widgetType: 'LOGO', defaultConfig: { schoolName: 'Kept' } }, { palette: KIT.palette }).schoolName).toBe('Kept');
    expect(brandZoneConfig({ widgetType: 'HS_VARSITY', defaultConfig: { schoolName: 'KEPT' } }, { palette: KIT.palette }).schoolName).toBe('KEPT');
  });

  it('identitySnapshot sees a name change and ignores everything else', () => {
    const a = { schoolName: 'A', color: '#000000' };
    expect(identitySnapshot(a)).toBe(identitySnapshot({ ...a, color: '#ffffff' }));
    expect(identitySnapshot(a)).not.toBe(identitySnapshot({ ...a, schoolName: 'B' }));
    expect(identitySnapshot({ textOverrides: { 'brand.name': 'A' } })).not.toBe(identitySnapshot({ textOverrides: { 'brand.name': 'B' } }));
  });

  it('the organisation tagline reaches the kit', () => {
    expect(kitFromTenantBranding({ displayName: 'Lincoln High School', tagline: 'Home of the Eagles', logoUrl: 'l.png' })).toMatchObject({ displayName: 'Lincoln High School', tagline: 'Home of the Eagles' });
  });

  it('which kit: a per-template detection wins; a copy taken at creation gives way to the current organisation brand', () => {
    const org: BrandKitLike = { ...REBRAND };
    const detected: BrandKitLike = { logoUrl: 'site.png', displayName: 'Site Name' };
    const inherited: BrandKitLike = { logoUrl: 'old.png', displayName: 'Old Academy', inheritedFrom: 'tenant-branding' };
    expect(pickBrandKit(detected, org)).toEqual({ kit: detected, source: 'template' });
    expect(pickBrandKit(inherited, org)).toEqual({ kit: org, source: 'org' });
    expect(pickBrandKit(inherited, null)).toEqual({ kit: inherited, source: 'template' });
    expect(pickBrandKit(null, org)).toEqual({ kit: org, source: 'org' });
    expect(pickBrandKit(null, null)).toEqual({ kit: null, source: null });
  });
});
