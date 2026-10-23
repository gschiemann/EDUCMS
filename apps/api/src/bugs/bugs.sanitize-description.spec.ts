import { sanitizeDescription } from './bugs.controller';

/**
 * The operator's bug description is shown to a SUPER_ADMIN (as React text) and
 * fed to the AI analyser. The strip is defence in depth; it must still be a
 * strip (CodeQL js/incomplete-multi-character-sanitization, 2026-10-22): one
 * removal must not expose a new tag, and a junk end tag is still an end tag.
 */
describe('sanitizeDescription', () => {
  it('keeps plain prose, trims and caps it', () => {
    expect(sanitizeDescription('  The logo is blank on Safari  ')).toBe('The logo is blank on Safari');
    expect(sanitizeDescription('x'.repeat(6000))!.length).toBe(5000);
    expect(sanitizeDescription('')).toBeNull();
    expect(sanitizeDescription(null)).toBeNull();
  });

  it('removes a script block whose end tag carries junk', () => {
    expect(sanitizeDescription('a<script>evil()</script foo>b')).toBe('ab');
  });

  it('removes a tag that only appears once another is removed', () => {
    // Whatever text remains, no tag does.
    expect(sanitizeDescription('<scr<b></b>ipt>evil()</script>ok')).not.toMatch(/<[a-z/]/i);
    expect(sanitizeDescription('<<b>img src=x onerror=1>') ?? '').not.toMatch(/<[a-z/]/i);
  });
});
