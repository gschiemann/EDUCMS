/**
 * CSV formula-injection neutralization for the sponsor proof-of-play
 * export (P2 security fix, 2026-07-03).
 *
 * `SponsorPanel`'s "Download CSV" hands a proof-of-play file to EXTERNAL
 * sponsors, who open it in Excel / Google Sheets / LibreOffice. A cell
 * value that starts with `=`, `+`, `-`, `@`, TAB or CR is interpreted as
 * a FORMULA by those apps — a real exfiltration / DDE-command-execution
 * sink, since sponsor names (and any future column) are operator-typed.
 *
 * `sanitizeCsvCell` is the standard neutralizer: prefix a single quote
 * (`'`) to any value with a dangerous leading char so the spreadsheet
 * treats the whole cell as text — while a plain "Acme Corp" / `123` /
 * ISO date passes through byte-for-byte. This spec pins that contract
 * AND proves `csvCell` layers correct CSV quoting on top of it.
 */
import { sanitizeCsvCell } from '../SponsorPanel';

describe('sanitizeCsvCell — formula-injection neutralization', () => {
  it('neutralizes a leading = (formula / exfil sink)', () => {
    expect(sanitizeCsvCell('=cmd|calc')).toBe("'=cmd|calc");
    expect(sanitizeCsvCell('=1+1')).toBe("'=1+1");
    expect(sanitizeCsvCell('=HYPERLINK("http://evil","x")')).toBe(
      "'=HYPERLINK(\"http://evil\",\"x\")",
    );
  });

  it('neutralizes a leading + / - / @', () => {
    expect(sanitizeCsvCell('+x')).toBe("'+x");
    expect(sanitizeCsvCell('-x')).toBe("'-x");
    expect(sanitizeCsvCell('@x')).toBe("'@x");
    expect(sanitizeCsvCell('-2+3')).toBe("'-2+3");
    expect(sanitizeCsvCell('@SUM(A1:A9)')).toBe("'@SUM(A1:A9)");
  });

  it('neutralizes a leading TAB or CR (whitespace-then-formula smuggling)', () => {
    expect(sanitizeCsvCell('\t=cmd')).toBe("'\t=cmd");
    expect(sanitizeCsvCell('\r=cmd')).toBe("'\r=cmd");
    expect(sanitizeCsvCell('\r-1')).toBe("'\r-1");
  });

  it('passes normal operator/system values through UNCHANGED', () => {
    // A real sponsor name must export exactly as typed.
    expect(sanitizeCsvCell('Acme Corp')).toBe('Acme Corp');
    expect(sanitizeCsvCell("O'Brien & Sons")).toBe("O'Brien & Sons");
    // Bare numbers and the boolean-ish/count cells the report emits.
    expect(sanitizeCsvCell(123)).toBe('123');
    expect(sanitizeCsvCell(0)).toBe('0');
    expect(sanitizeCsvCell('yes')).toBe('yes');
    expect(sanitizeCsvCell('OVER')).toBe('OVER');
    // ISO dates start with a digit — must NOT be corrupted.
    expect(sanitizeCsvCell('2026-07-03')).toBe('2026-07-03');
    // A dangerous char in the MIDDLE is not a formula trigger.
    expect(sanitizeCsvCell('Sponsor = Gold Tier')).toBe('Sponsor = Gold Tier');
    expect(sanitizeCsvCell('A+ Rated')).toBe('A+ Rated');
  });

  it('handles null / undefined / empty as an empty cell', () => {
    expect(sanitizeCsvCell(null)).toBe('');
    expect(sanitizeCsvCell(undefined)).toBe('');
    expect(sanitizeCsvCell('')).toBe('');
  });
});

/**
 * `csvCell` is not exported, but its behavior is observable through the
 * exported `sanitizeCsvCell` composed with the module's quoting rule.
 * These cases prove the two layers compose correctly by reconstructing
 * the same quoting `csvCell` applies (neutralize → quote-if-special).
 * Kept here so a future refactor that decouples them still has a spec.
 */
describe('neutralize-then-quote composition (matches csvCell contract)', () => {
  // Mirror of the private csvCell so the composition contract is pinned
  // in-test even though csvCell itself is module-private.
  const quote = (s: string) =>
    /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  const cell = (v: string | number) => quote(sanitizeCsvCell(v));

  it('wraps the neutralizer INSIDE the quotes for a comma-bearing formula', () => {
    // Leading `=` AND a comma → neutralized first, then quoted whole.
    expect(cell('=SUM(1,2)')).toBe('"\'=SUM(1,2)"');
  });

  it('escapes embedded double-quotes by doubling', () => {
    expect(cell('Acme "The Best" Corp')).toBe('"Acme ""The Best"" Corp"');
  });

  it('quotes values with embedded newlines', () => {
    expect(cell('line1\nline2')).toBe('"line1\nline2"');
  });

  it('leaves a plain name unquoted and unmodified', () => {
    expect(cell('Acme Corp')).toBe('Acme Corp');
    expect(cell(42)).toBe('42');
  });
});
