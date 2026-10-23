import { cssStringValue } from '../css-string-value';

describe('cssStringValue — an attribute-selector value can never leave its string', () => {
  it('passes ordinary field keys through unchanged', () => {
    expect(cssStringValue('agenda.0.t')).toBe('agenda.0.t');
    expect(cssStringValue('headline')).toBe('headline');
  });

  it('escapes the quote, the backslash and every newline form', () => {
    expect(cssStringValue('a"b')).toBe('a\\22 b');
    expect(cssStringValue('a\\b')).toBe('a\\5c b');
    expect(cssStringValue('a\nb\rc\fd')).toBe('a\\a b\\d c\\c d');
  });

  it('the old `\\"` breakout stays inside the string', () => {
    // Key `x\"]{color:red}` once became `x\\"]{color:red}` — a closed string
    // and a live rule. Now neither a quote nor a backslash survives raw.
    const out = cssStringValue('x\\"]{color:red}');
    expect(out).not.toMatch(/(^|[^\\])"/);
    expect(out).toBe('x\\5c \\22 ]{color:red}');
  });

  it('round-trips through the browser CSS parser when one is available', () => {
    if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return;
    const key = 'we\\ird"key\nname';
    const el = document.createElement('div');
    el.setAttribute('data-field', key);
    document.body.appendChild(el);
    try {
      expect(document.querySelector(`[data-field="${cssStringValue(key)}"]`)).toBe(el);
    } finally {
      el.remove();
    }
  });
});
