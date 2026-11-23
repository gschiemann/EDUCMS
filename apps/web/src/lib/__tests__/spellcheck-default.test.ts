/**
 * The dashboard's spell-check default (lib/spellcheck-default.ts): which
 * fields get `spellcheck="true"` on focus, which are left alone, and that the
 * installer is one listener that only ever sets an attribute nobody else set.
 */
import { installSpellcheckDefault, shouldSpellcheck, NO_SPELLCHECK_ATTR } from '../spellcheck-default';

function el(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html.trim();
  document.body.appendChild(host);
  const node = host.querySelector('[data-t]') as HTMLElement | null;
  if (!node) throw new Error('fixture needs a [data-t] element');
  return node;
}

afterEach(() => { document.body.innerHTML = ''; });

describe('shouldSpellcheck — fields that hold words', () => {
  it('enables a screen-group-name-like input with no type', () => {
    expect(shouldSpellcheck(el('<input data-t aria-label="New group name" placeholder="e.g. Lobby, Cardio floor">'))).toBe(true);
  });
  it('enables input type="text" (any case) and a textarea', () => {
    expect(shouldSpellcheck(el('<input data-t type="text">'))).toBe(true);
    expect(shouldSpellcheck(el('<input data-t type="TEXT">'))).toBe(true);
    expect(shouldSpellcheck(el('<textarea data-t></textarea>'))).toBe(true);
  });
  it('enables a contenteditable host ("", "true", "plaintext-only")', () => {
    expect(shouldSpellcheck(el('<div data-t contenteditable></div>'))).toBe(true);
    expect(shouldSpellcheck(el('<div data-t contenteditable="true"></div>'))).toBe(true);
    expect(shouldSpellcheck(el('<span data-t contenteditable="plaintext-only"></span>'))).toBe(true);
  });
  it('keeps autocomplete="off" and name-like tokens enabled (they hold words)', () => {
    expect(shouldSpellcheck(el('<input data-t autocomplete="off">'))).toBe(true);
    expect(shouldSpellcheck(el('<input data-t autocomplete="organization">'))).toBe(true);
    expect(shouldSpellcheck(el('<input data-t inputmode="text">'))).toBe(true);
  });
});

describe('shouldSpellcheck — an explicit choice always wins', () => {
  it('never touches a field that says spellcheck="false" (the existing opt-outs)', () => {
    expect(shouldSpellcheck(el('<input data-t spellcheck="false">'))).toBe(false);
    expect(shouldSpellcheck(el('<textarea data-t spellcheck="false"></textarea>'))).toBe(false);
    expect(shouldSpellcheck(el('<div data-t contenteditable="true" spellcheck="false"></div>'))).toBe(false);
  });
  it('leaves a field that already says spellcheck="true" alone (nothing to do)', () => {
    expect(shouldSpellcheck(el('<input data-t spellcheck="true">'))).toBe(false);
  });
  it('respects a spellcheck="false" inherited from an ancestor', () => {
    expect(shouldSpellcheck(el('<form spellcheck="false"><input data-t></form>'))).toBe(false);
  });
  it(`skips anything inside [${NO_SPELLCHECK_ATTR}]`, () => {
    expect(shouldSpellcheck(el(`<section ${NO_SPELLCHECK_ATTR}><div><input data-t></div></section>`))).toBe(false);
    expect(shouldSpellcheck(el(`<input data-t ${NO_SPELLCHECK_ATTR}>`))).toBe(false);
  });
});

describe('shouldSpellcheck — fields that hold something other than words', () => {
  it.each(['url', 'email', 'search', 'password', 'number', 'tel', 'date', 'time', 'color', 'checkbox', 'hidden', 'file'])(
    'skips input type="%s"',
    (type) => { expect(shouldSpellcheck(el(`<input data-t type="${type}">`))).toBe(false); },
  );
  it.each(['numeric', 'decimal', 'tel', 'email', 'url', 'search', 'none'])(
    'skips inputmode="%s"',
    (mode) => { expect(shouldSpellcheck(el(`<input data-t inputmode="${mode}">`))).toBe(false); },
  );
  it('skips inputmode on a textarea too', () => {
    expect(shouldSpellcheck(el('<textarea data-t inputmode="url"></textarea>'))).toBe(false);
  });
  it.each([
    'email', 'username', 'url', 'tel', 'tel-national', 'one-time-code', 'current-password',
    'new-password', 'cc-number', 'cc-csc', 'postal-code', 'section-a shipping postal-code', 'USERNAME',
  ])('skips autocomplete="%s"', (token) => {
    expect(shouldSpellcheck(el(`<input data-t autocomplete="${token}">`))).toBe(false);
  });
  it('skips an input with a pattern (a code or ID format)', () => {
    expect(shouldSpellcheck(el('<input data-t pattern="[A-Z0-9]{6}">'))).toBe(false);
  });
  it('skips read-only and disabled fields (nothing is typed there)', () => {
    expect(shouldSpellcheck(el('<input data-t readonly>'))).toBe(false);
    expect(shouldSpellcheck(el('<textarea data-t disabled></textarea>'))).toBe(false);
  });
  it('skips non-editable elements and contenteditable="false"', () => {
    expect(shouldSpellcheck(el('<div data-t></div>'))).toBe(false);
    expect(shouldSpellcheck(el('<button data-t>Save</button>'))).toBe(false);
    expect(shouldSpellcheck(el('<select data-t><option>a</option></select>'))).toBe(false);
    expect(shouldSpellcheck(el('<div data-t contenteditable="false"></div>'))).toBe(false);
  });
  it('is safe on null / non-elements', () => {
    expect(shouldSpellcheck(null)).toBe(false);
    expect(shouldSpellcheck(undefined)).toBe(false);
  });
});

describe('installSpellcheckDefault', () => {
  it('sets spellcheck="true" on focus of a word field, never on an opt-out, and touches nothing else', () => {
    const uninstall = installSpellcheckDefault(document);
    try {
      const name = el('<input data-t aria-label="New group name" autocorrect="off" autocapitalize="none">');
      expect(name.hasAttribute('spellcheck')).toBe(false);
      name.focus();
      expect(name.getAttribute('spellcheck')).toBe('true');
      // (jsdom has no `spellcheck` IDL property; the Chromium e2e asserts it.)
      // Autocorrect / autocapitalize are not ours to change.
      expect(name.getAttribute('autocorrect')).toBe('off');
      expect(name.getAttribute('autocapitalize')).toBe('none');

      const code = el('<input data-t spellcheck="false" aria-label="Pairing code">');
      code.focus();
      expect(code.getAttribute('spellcheck')).toBe('false');

      const url = el('<input data-t type="url">');
      url.focus();
      expect(url.hasAttribute('spellcheck')).toBe(false);
    } finally {
      uninstall();
    }
  });

  it('is one listener however many times it is installed, and uninstalls cleanly', () => {
    const add = jest.spyOn(document, 'addEventListener');
    const remove = jest.spyOn(document, 'removeEventListener');
    try {
      const a = installSpellcheckDefault(document);
      const b = installSpellcheckDefault(document); // Strict Mode double mount
      expect(add.mock.calls.filter(([type]) => type === 'focusin')).toHaveLength(1);
      a();
      a(); // a repeated cleanup is a no-op
      expect(remove.mock.calls.filter(([type]) => type === 'focusin')).toHaveLength(0);
      b();
      expect(remove.mock.calls.filter(([type]) => type === 'focusin')).toHaveLength(1);

      const after = el('<input data-t>');
      after.focus();
      expect(after.hasAttribute('spellcheck')).toBe(false);
    } finally {
      add.mockRestore();
      remove.mockRestore();
    }
  });

  it('is a no-op without a document', () => {
    expect(() => installSpellcheckDefault(null)()).not.toThrow();
  });
});
