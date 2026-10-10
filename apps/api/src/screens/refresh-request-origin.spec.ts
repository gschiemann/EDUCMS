import { refreshRequestedBy } from './refresh-request-origin';

describe('refreshRequestedBy — who asked for the durable refresh', () => {
  it('is null exactly when no refresh is pending (the field never busts a stable manifest)', () => {
    expect(refreshRequestedBy(null, 'system')).toBeNull();
    expect(refreshRequestedBy(undefined, 'operator')).toBeNull();
  });

  it("names the system when the wedge detector / a rendition swap stamped it", () => {
    expect(refreshRequestedBy(new Date(), 'system')).toBe('system');
  });

  it("names the operator for a person's Refresh / Resync / publish", () => {
    expect(refreshRequestedBy(new Date(), 'operator')).toBe('operator');
  });

  it('an unknown or missing source reads as the operator — a lost stamp never loses a refresh', () => {
    expect(refreshRequestedBy(new Date(), null)).toBe('operator');
    expect(refreshRequestedBy(new Date(), undefined)).toBe('operator');
    expect(refreshRequestedBy(1_790_000_000_000, 'something-else')).toBe('operator');
  });
});
