/**
 * Unit tests for the Signage Concierge PURE module (2026-06-28).
 * No Nest / Prisma / network — just the defensive parse + clamp helpers.
 */
import {
  parseConciergeTurn,
  clampConciergeIntake,
  buildConciergeSystemPrompt,
  summarizeUrlReference,
} from './signage-concierge';

describe('parseConciergeTurn', () => {
  it('parses a clean JSON envelope', () => {
    const raw = JSON.stringify({
      reply: 'Got it — bold and appetizing?',
      intake: { purpose: 'menu', theme: 'Bold', background: 'photo', widgets: ['headline', 'menu'] },
      missing: ['the actual items'],
      ready: false,
      brief: 'A bold menu board for a burger joint.',
    });
    const turn = parseConciergeTurn(raw);
    expect(turn.reply).toBe('Got it — bold and appetizing?');
    expect(turn.intake.purpose).toBe('menu');
    expect(turn.intake.theme).toBe('Bold');
    expect(turn.intake.background).toBe('photo');
    expect(turn.intake.widgets).toEqual(['headline', 'menu']);
    expect(turn.missing).toEqual(['the actual items']);
    expect(turn.ready).toBe(false);
    expect(turn.brief).toContain('bold menu board');
  });

  it('parses JSON wrapped in markdown fences', () => {
    const raw = '```json\n' + JSON.stringify({ reply: 'Hi', intake: { purpose: 'welcome' }, ready: true, brief: 'b' }) + '\n```';
    const turn = parseConciergeTurn(raw);
    expect(turn.reply).toBe('Hi');
    expect(turn.intake.purpose).toBe('welcome');
    expect(turn.ready).toBe(true);
  });

  it('recovers JSON with a preamble sentence before the object', () => {
    const raw = 'Sure, here you go: ' + JSON.stringify({ reply: 'Picked it', intake: { theme: 'Neon' }, ready: false, brief: '' });
    const turn = parseConciergeTurn(raw);
    expect(turn.reply).toBe('Picked it');
    expect(turn.intake.theme).toBe('Neon');
  });

  it('degrades gracefully on total garbage — keeps the chat alive', () => {
    const raw = 'this is not json at all, just a sentence';
    const turn = parseConciergeTurn(raw);
    expect(turn.reply).toBe('this is not json at all, just a sentence');
    expect(turn.intake).toEqual({});
    expect(turn.missing).toEqual([]);
    expect(turn.ready).toBe(false);
    expect(turn.brief).toBe('');
  });

  it('falls back to a friendly default reply on empty input', () => {
    const turn = parseConciergeTurn('');
    expect(turn.reply.length).toBeGreaterThan(0);
    expect(turn.ready).toBe(false);
  });

  it('supplies a default reply when JSON parses but reply is missing', () => {
    const raw = JSON.stringify({ intake: { purpose: 'promo' }, ready: false });
    const turn = parseConciergeTurn(raw);
    expect(turn.reply.length).toBeGreaterThan(0);
    expect(turn.intake.purpose).toBe('promo');
  });
});

describe('clampConciergeIntake', () => {
  it('returns empty for non-objects', () => {
    expect(clampConciergeIntake(null)).toEqual({});
    expect(clampConciergeIntake('nope')).toEqual({});
    expect(clampConciergeIntake(42)).toEqual({});
  });

  it('drops invalid purpose / background enums', () => {
    const out = clampConciergeIntake({ purpose: 'destroy-the-world', background: 'hologram' });
    expect(out.purpose).toBeUndefined();
    expect(out.background).toBeUndefined();
  });

  it('keeps valid purpose / background enums', () => {
    const out = clampConciergeIntake({ purpose: 'event', background: 'gradient' });
    expect(out.purpose).toBe('event');
    expect(out.background).toBe('gradient');
  });

  it("accepts palette === 'brand'", () => {
    const out = clampConciergeIntake({ palette: 'brand' });
    expect(out.palette).toBe('brand');
  });

  it('accepts a { colors } palette and normalizes hexes', () => {
    const out = clampConciergeIntake({ palette: { colors: ['#ff0000', '00ff00', 'not-a-color'] } });
    expect(out.palette).toEqual({ colors: ['#ff0000', '#00ff00'] });
  });

  it('drops a { colors } palette with no valid colors', () => {
    const out = clampConciergeIntake({ palette: { colors: ['banana', ''] } });
    expect(out.palette).toBeUndefined();
  });

  it('filters widgets to the allow-list and dedupes', () => {
    const out = clampConciergeIntake({ widgets: ['headline', 'headline', 'bogus', 'qr'] });
    expect(out.widgets).toEqual(['headline', 'qr']);
  });

  it('accepts an arbitrary theme label (re-resolved downstream) and clamps length', () => {
    const out = clampConciergeIntake({ theme: 'Some Very Long Custom Theme Name That Exceeds The Forty Char Cap' });
    expect(out.theme).toBeDefined();
    expect((out.theme as string).length).toBeLessThanOrEqual(40);
  });
});

describe('buildConciergeSystemPrompt', () => {
  it('produces a non-empty prompt and folds in references + brand', () => {
    const prompt = buildConciergeSystemPrompt({
      vertical: 'bar',
      brandPrimary: '#112233',
      brandAccent: '#445566',
      brandVoice: 'cheeky and fun',
      canvas: { w: 1920, h: 1080 },
      references: [{ kind: 'url', label: 'example.com', summary: 'A sleek dark bar site', palette: ['#000000'] }],
    });
    expect(prompt).toContain('Signage Concierge');
    expect(prompt).toContain('bar');
    expect(prompt).toContain('landscape');
    expect(prompt).toContain('#112233');
    expect(prompt).toContain('cheeky and fun');
    expect(prompt).toContain('A sleek dark bar site');
  });

  it('marks portrait orientation when h > w', () => {
    const prompt = buildConciergeSystemPrompt({ canvas: { w: 1080, h: 1920 } });
    expect(prompt).toContain('portrait');
  });
});

describe('summarizeUrlReference', () => {
  it('summarizes a BrandingPreview-shaped object into a url reference', () => {
    const preview = {
      displayName: 'Joe Coffee',
      tagline: 'Small-batch roasts',
      palette: { primary: '#6f4e37', accent: '#d2b48c' },
      colors: [{ hex: '#6f4e37' }, { hex: '#d2b48c' }],
      fonts: { heading: 'Playfair Display', body: 'Inter' },
      heroImages: [{ url: 'https://example.com/hero.jpg' }],
      ogImage: 'https://example.com/og.png',
    };
    const ref = summarizeUrlReference(preview, 'https://joecoffee.com/');
    expect(ref.kind).toBe('url');
    expect(ref.label).toBe('joecoffee.com');
    expect(ref.summary).toContain('Joe Coffee');
    expect(ref.summary).toContain('Small-batch roasts');
    expect(ref.palette).toContain('#6f4e37');
    expect(ref.imageUrl).toBe('https://example.com/hero.jpg');
  });

  it('handles a near-empty preview without throwing', () => {
    const ref = summarizeUrlReference({}, 'https://unknown.example');
    expect(ref.kind).toBe('url');
    expect(ref.summary.length).toBeGreaterThan(0);
  });
});
