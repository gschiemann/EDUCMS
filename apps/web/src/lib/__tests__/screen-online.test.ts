import { countOnlineScreens, isScreenOnline } from '../screen-online';

describe('screen-online (DEV-007)', () => {
  it('reads the server-stamped status — never a private lastPingAt window', () => {
    expect(isScreenOnline({ status: 'ONLINE' })).toBe(true);
    expect(isScreenOnline({ status: 'OFFLINE' })).toBe(false);
    expect(isScreenOnline({ status: 'REVOKED' })).toBe(false);
    expect(isScreenOnline(null)).toBe(false);
    // A row with a fresh-looking ping but an OFFLINE verdict is offline.
    expect(isScreenOnline({ status: 'OFFLINE', lastPingAt: new Date().toISOString() } as any)).toBe(false);
  });

  it('counts', () => {
    expect(countOnlineScreens([{ status: 'ONLINE' }, { status: 'OFFLINE' }, { status: 'ONLINE' }])).toBe(2);
    expect(countOnlineScreens(undefined)).toBe(0);
  });
});
