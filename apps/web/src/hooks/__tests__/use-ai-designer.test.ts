/**
 * Brief-echo confirm helpers (#268 item 3 / task #277) — drift-catchers for
 * the FAIL-OPEN contract: a no-signal brief must build an UNDEFINED payload
 * (server falls back to inline extraction), and chip edits must enforce the
 * exact caps DesignerBriefSchema enforces server-side, so a client-built
 * payload can never 400 on generate.
 */
import {
  applyDesignerBriefEdit,
  buildDesignerBriefPayload,
  designerBriefHasSignal,
  DESIGNER_BRIEF_LIMITS,
  EMPTY_DESIGNER_BRIEF,
  type DesignerBrief,
} from '../use-ai-designer';

const filled: DesignerBrief = {
  occasion: 'happy hour promo',
  headline: 'Half-Price Fridays',
  items: ['Nachos $5', 'Draft $3'],
  dateTime: 'Fridays 4-6pm',
  tone: 'playful',
  callToAction: 'Order at the bar',
};

describe('designerBriefHasSignal', () => {
  it('is false for null, undefined, and the empty brief', () => {
    expect(designerBriefHasSignal(null)).toBe(false);
    expect(designerBriefHasSignal(undefined)).toBe(false);
    expect(designerBriefHasSignal(EMPTY_DESIGNER_BRIEF)).toBe(false);
  });

  it('is false when fields are whitespace-only or items are blank strings', () => {
    expect(
      designerBriefHasSignal({ ...EMPTY_DESIGNER_BRIEF, occasion: '   ', items: ['  '] }),
    ).toBe(false);
  });

  it('is true when any single field carries signal', () => {
    expect(designerBriefHasSignal({ ...EMPTY_DESIGNER_BRIEF, headline: 'Hi' })).toBe(true);
    expect(designerBriefHasSignal({ ...EMPTY_DESIGNER_BRIEF, items: ['Nachos'] })).toBe(true);
  });
});

describe('buildDesignerBriefPayload (fail-open)', () => {
  it('returns undefined for no-signal briefs so the server extracts inline', () => {
    expect(buildDesignerBriefPayload(null)).toBeUndefined();
    expect(buildDesignerBriefPayload(EMPTY_DESIGNER_BRIEF)).toBeUndefined();
  });

  it('passes a signal-bearing brief through unchanged', () => {
    expect(buildDesignerBriefPayload(filled)).toEqual(filled);
  });
});

describe('applyDesignerBriefEdit (server-cap parity)', () => {
  it('caps string fields at the schema limit', () => {
    const long = 'x'.repeat(DESIGNER_BRIEF_LIMITS.headline + 50);
    const next = applyDesignerBriefEdit(filled, 'headline', long);
    expect(next.headline).toHaveLength(DESIGNER_BRIEF_LIMITS.headline);
  });

  it('trims, drops blanks, caps item length and item count', () => {
    const items = [
      ` ${'y'.repeat(DESIGNER_BRIEF_LIMITS.item + 20)} `,
      '',
      '  ',
      ...Array.from({ length: DESIGNER_BRIEF_LIMITS.maxItems + 5 }, (_, i) => `item ${i}`),
    ];
    const next = applyDesignerBriefEdit(filled, 'items', items);
    expect(next.items.length).toBeLessThanOrEqual(DESIGNER_BRIEF_LIMITS.maxItems);
    expect(next.items[0]).toHaveLength(DESIGNER_BRIEF_LIMITS.item);
    expect(next.items).not.toContain('');
  });

  it('is immutable — the input brief is untouched', () => {
    const before = JSON.parse(JSON.stringify(filled));
    applyDesignerBriefEdit(filled, 'tone', 'premium');
    expect(filled).toEqual(before);
  });

  it('an all-empty edit result still fails buildDesignerBriefPayload (end-to-end fail-open)', () => {
    let b = filled;
    (Object.keys(filled) as Array<keyof DesignerBrief>).forEach((k) => {
      b = applyDesignerBriefEdit(b, k, k === 'items' ? [] : '');
    });
    expect(buildDesignerBriefPayload(b)).toBeUndefined();
  });
});
