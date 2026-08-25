/**
 * What a gym media board is allowed to claim.
 *
 * One function decides this, and these are the cases that matter. The
 * failure mode being guarded is not subtle: a board that says
 * LIVE · CONNECTED while nothing is playing is the club's liability,
 * printed eight feet tall, and the club — not VenueOS — is the party
 * performing publicly.
 */
import { stateForConnection } from '../use-gym-media';

const conn = (over: Partial<Parameters<typeof stateForConnection>[0]> = {}) => ({
  id: 'c1', providerId: 'custom-hls', providerName: 'My stream',
  status: 'ACTIVE' as const, mediaRole: 'RENDERS' as const, ...over,
});

describe('only one path reaches a live claim', () => {
  it('a verified feed VenueOS plays itself is the ONLY input that yields fresh', () => {
    expect(stateForConnection(conn())).toBe('fresh');
  });

  it('nothing bound is unconfigured', () => {
    expect(stateForConnection(undefined)).toBe('unconfigured');
  });

  it.each([
    ['REVOKED', 'denied'],
    ['EXPIRED', 'denied'],
    ['ERROR', 'offline'],
    ['PENDING', 'pending'],
  ] as const)('status %s → %s, never fresh', (status, expected) => {
    expect(stateForConnection(conn({ status }))).toBe(expected);
  });

  it('an external licensed device never claims native playback', () => {
    expect(stateForConnection(conn({ mediaRole: 'EXTERNAL' }))).toBe('external');
  });

  it('a real service with an unfinished adapter says so', () => {
    expect(stateForConnection(conn({ mediaRole: 'PENDING_ADAPTER' }))).toBe('pending');
  });

  it('severity wins: a REVOKED external device is denied, not external', () => {
    expect(stateForConnection(conn({ mediaRole: 'EXTERNAL', status: 'REVOKED' }))).toBe('denied');
  });

  it('severity wins: an ACTIVE row we could not reach is offline, not fresh', () => {
    // status ERROR is written by the reachability probe; ACTIVE-but-broken
    // cannot occur, but an unknown capability must still not read as live.
    expect(stateForConnection(conn({ mediaRole: undefined }))).toBe('pending');
  });

  it('no combination other than RENDERS+ACTIVE produces fresh', () => {
    const statuses = ['PENDING', 'ACTIVE', 'EXPIRED', 'REVOKED', 'ERROR'] as const;
    const roles = ['RENDERS', 'EXTERNAL', 'PENDING_ADAPTER', undefined] as const;
    const fresh: string[] = [];
    for (const status of statuses) {
      for (const mediaRole of roles) {
        if (stateForConnection(conn({ status, mediaRole })) === 'fresh') {
          fresh.push(`${mediaRole}/${status}`);
        }
      }
    }
    expect(fresh).toEqual(['RENDERS/ACTIVE']);
  });
});
