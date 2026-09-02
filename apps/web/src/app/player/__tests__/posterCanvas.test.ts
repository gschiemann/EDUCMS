/**
 * posterCanvas — the one rule that sizes a NovaStar TB poster before and
 * after pairing (2026-09-01). What must hold, in the operator's words:
 *   • "at times we will use them as 320x1080 posters and viplex doesnt let
 *     you set that" — 600 (the floor) and 1920 (factory) mean ONE poster;
 *   • "set the resolution to say 960x1080 for 3 screen and our app auto
 *     detect and presents perfectly" — a clean multiple is a chain;
 *   • "we will have posters with different pixel pitches" — the standard is
 *     a parameter, never a constant baked into the rule;
 *   • an explicit canvas always wins, and no LCD is ever touched.
 */
import {
  DEFAULT_POSTER_STANDARD,
  derivePosterCanvas,
  isPosterClassUserAgent,
  normalizePosterStandard,
} from '../posterCanvas';

const POSTER_UA =
  'Mozilla/5.0 (Linux; Android 11; rk356x_box Build/RQ2A.210505.003; wv) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Version/4.0 Chrome/83.0.4103.120 Safari/537.36 EduC';
const GUQ_UA =
  'Mozilla/5.0 (Linux; Android 11; M55GUQ-CS1382D-C Build/RD2A.211001.002; wv) Chrome/95.0.4638.74';

describe('isPosterClassUserAgent', () => {
  it('recognizes the Rockchip reference strings NovaStar leaves in place', () => {
    expect(isPosterClassUserAgent(POSTER_UA)).toBe(true);
    expect(isPosterClassUserAgent('… Taurus TB6 …')).toBe(true);
  });
  it('leaves every other box alone', () => {
    expect(isPosterClassUserAgent(GUQ_UA)).toBe(false);
    expect(isPosterClassUserAgent('')).toBe(false);
    expect(isPosterClassUserAgent(null)).toBe(false);
  });
});

describe('derivePosterCanvas — the standard poster (1.86 mm, 320×1080)', () => {
  it('600 (the controller floor) and 1920 (factory default) are ONE poster', () => {
    expect(derivePosterCanvas({ posterClass: true, osW: 600, osH: 1080 })).toEqual({ w: 320, h: 1080, source: 'standard', panels: 1 });
    expect(derivePosterCanvas({ posterClass: true, osW: 1920, osH: 1080 })).toEqual({ w: 320, h: 1080, source: 'standard', panels: 1 });
  });

  it('a clean multiple the operator set in ViPlex is a chain of that many panels', () => {
    expect(derivePosterCanvas({ posterClass: true, osW: 640, osH: 1080 })).toEqual({ w: 640, h: 1080, source: 'chain', panels: 2 });
    expect(derivePosterCanvas({ posterClass: true, osW: 960, osH: 1080 })).toEqual({ w: 960, h: 1080, source: 'chain', panels: 3 });
    expect(derivePosterCanvas({ posterClass: true, osW: 1280, osH: 1080 })).toEqual({ w: 1280, h: 1080, source: 'chain', panels: 4 });
    expect(derivePosterCanvas({ posterClass: true, osW: 1600, osH: 1080 })).toEqual({ w: 1600, h: 1080, source: 'chain', panels: 5 });
  });

  it('1920 stays a single poster even though it is 6 × 320 — a fresh box ships at 1920', () => {
    // 6-panel chains are the one ambiguous case; the dashboard's explicit
    // canvas resolves it. Defaulting the other way breaks every new poster.
    expect(derivePosterCanvas({ posterClass: true, osW: 1920, osH: 1080 })?.source).toBe('standard');
  });

  it('missing or odd OS widths fall back to one poster', () => {
    expect(derivePosterCanvas({ posterClass: true, osW: null, osH: null })?.w).toBe(320);
    expect(derivePosterCanvas({ posterClass: true, osW: 1000, osH: 1080 })?.w).toBe(320);
  });
});

describe('derivePosterCanvas — other pitches and explicit values', () => {
  it('a different standard drives everything (1.56 mm ≈ 360×1200)', () => {
    const standard = { w: 360, h: 1200 };
    expect(derivePosterCanvas({ posterClass: true, osW: 600, osH: 1200, standard })).toEqual({ w: 360, h: 1200, source: 'standard', panels: 1 });
    expect(derivePosterCanvas({ posterClass: true, osW: 1080, osH: 1200, standard })).toEqual({ w: 1080, h: 1200, source: 'chain', panels: 3 });
    // 960 is not a multiple of 360 — one poster, never a wrong chain.
    expect(derivePosterCanvas({ posterClass: true, osW: 960, osH: 1200, standard })?.source).toBe('standard');
  });

  it('an explicit canvas wins over everything, poster class or not', () => {
    expect(derivePosterCanvas({ posterClass: true, osW: 600, osH: 1080, explicit: { w: 1920, h: 1080 } })).toEqual({ w: 1920, h: 1080, source: 'explicit', panels: 0 });
    expect(derivePosterCanvas({ posterClass: false, osW: 3840, osH: 2160, explicit: { w: 960, h: 1080 } })?.source).toBe('explicit');
  });

  it('a non-poster box gets null — the OS resolution governs, as always', () => {
    expect(derivePosterCanvas({ posterClass: false, osW: 2160, osH: 3840 })).toBeNull();
    expect(derivePosterCanvas({ posterClass: false, osW: 600, osH: 1080 })).toBeNull();
  });

  it('normalizePosterStandard refuses nonsense and falls back to the default', () => {
    expect(normalizePosterStandard(null)).toEqual(DEFAULT_POSTER_STANDARD);
    expect(normalizePosterStandard({ w: 0, h: 1080 })).toEqual(DEFAULT_POSTER_STANDARD);
    expect(normalizePosterStandard({ w: 360, h: 1200 })).toEqual({ w: 360, h: 1200 });
  });
});
