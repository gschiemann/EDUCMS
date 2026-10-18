import { centsToDollarInput, dollarsToCents, formatUsd, optionalDate } from '../business-profit';

describe('business profit money and date helpers', () => {
  it('converts decimal dollar strings to exact cents', () => {
    expect(dollarsToCents('0')).toBe(0);
    expect(dollarsToCents('19.9')).toBe(1990);
    expect(dollarsToCents('1,234.56')).toBeNull();
    expect(dollarsToCents('12.345')).toBeNull();
    expect(dollarsToCents('-1.00')).toBeNull();
    expect(dollarsToCents('90071992547410.00')).toBeNull();
  });

  it('keeps cents intact when formatting form defaults and currency', () => {
    expect(centsToDollarInput(205)).toBe('2.05');
    expect(centsToDollarInput(null)).toBe('');
    expect(formatUsd(205, 'en-US')).toBe('$2.05');
  });

  it('serializes a date input consistently and omits a blank value', () => {
    expect(optionalDate('')).toBeUndefined();
    expect(optionalDate('2027-02-03')).toBe('2027-02-03T00:00:00.000Z');
  });
});
