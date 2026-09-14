import { healPatternCss } from '../pattern-css';

describe('healPatternCss', () => {
  it('repairs a double-encoded pattern so its colours decode to #hex', () => {
    const saved = `#f8fafc url("data:image/svg+xml;utf8,%3Csvg%3E%3Ccircle%20fill%3D'%2523cbd5e1'%2F%3E%3C%2Fsvg%3E") repeat`;
    const healed = healPatternCss(saved)!;
    expect(healed).not.toContain('%2523');
    expect(decodeURIComponent(/utf8,([^"]+)/.exec(healed)![1])).toContain("fill='#cbd5e1'");
  });
  it('leaves correct CSS, gradients and empty values untouched', () => {
    const ok = `#fff url("data:image/svg+xml;utf8,%3Csvg%20fill%3D'%23fff'%2F%3E") repeat`;
    expect(healPatternCss(ok)).toBe(ok);
    expect(healPatternCss('linear-gradient(135deg, #10b981 0%, #06b6d4 100%)')).toBe('linear-gradient(135deg, #10b981 0%, #06b6d4 100%)');
    expect(healPatternCss('')).toBe('');
    expect(healPatternCss(null)).toBeNull();
  });
});
