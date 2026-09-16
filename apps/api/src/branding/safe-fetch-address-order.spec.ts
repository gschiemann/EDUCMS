/**
 * WHICH public address the socket is handed (2026-09-16).
 *
 * The other safe-fetch specs cover what is REJECTED. None covered what is
 * CHOSEN among several accepted addresses — and that gap hid a real outage:
 * `cdn.nba.com` publishes one A and two AAAA records, Node 17+ resolves
 * `verbatim: true`, so an IPv6 address could be handed to a host with no IPv6
 * egress. The connect then hung to the socket timeout and surfaced as "Fetch
 * timed out", which adopt turned into "preserving existing logoUrl" + SUCCESS.
 * Every site that had ever worked (riotcolor.com et al) is IPv4-only.
 */
const lookupMock = jest.fn();
jest.mock('node:dns', () => ({
  ...(jest.requireActual('node:dns') as object),
  lookup: (...args: unknown[]) => lookupMock(...args),
}));

import { ssrfSafeLookup } from './safe-fetch';

const call = (hostname: string, options: Record<string, unknown> = {}) =>
  new Promise<{ err: unknown; address: unknown; family: unknown }>((resolve) => {
    ssrfSafeLookup(hostname, options as never, (err, address, family) =>
      resolve({ err, address, family }),
    );
  });

afterEach(() => lookupMock.mockReset());

describe('ssrfSafeLookup — address selection', () => {
  it('hands the socket the IPv4 address when the resolver lists IPv6 first', async () => {
    // cdn.nba.com's real shape, IPv6-first — what broke Greg's logo.
    lookupMock.mockImplementation((_h, _o, cb) =>
      cb(null, [
        { address: '2600:1406:3a00:486::1f51', family: 6 },
        { address: '2600:1406:3a00:487::1f51', family: 6 },
        { address: '23.37.17.69', family: 4 },
      ]),
    );
    const { err, address, family } = await call('cdn.nba.com');
    expect(err).toBeNull();
    expect(address).toBe('23.37.17.69');
    expect(family).toBe(4);
  });

  it('still connects over IPv6 when that is all the host publishes', async () => {
    lookupMock.mockImplementation((_h, _o, cb) =>
      cb(null, [{ address: '2606:4700::6810:85e5', family: 6 }]),
    );
    const { err, address, family } = await call('v6-only.example');
    expect(err).toBeNull();
    expect(address).toBe('2606:4700::6810:85e5');
    expect(family).toBe(6);
  });

  it('IPv4-only hosts are unaffected', async () => {
    lookupMock.mockImplementation((_h, _o, cb) =>
      cb(null, [{ address: '54.215.184.142', family: 4 }, { address: '54.215.226.77', family: 4 }]),
    );
    expect((await call('riotcolor.com')).address).toBe('54.215.184.142');
  });

  it('STILL refuses when any address is private — ordering never relaxes that', async () => {
    lookupMock.mockImplementation((_h, _o, cb) =>
      cb(null, [{ address: '23.37.17.69', family: 4 }, { address: '169.254.169.254', family: 4 }]),
    );
    const { err, address } = await call('rebind.example');
    expect(err).toBeTruthy();
    expect(String((err as Error).message)).toMatch(/private range/i);
    expect(address).toBe('');
  });

  it('returns the whole ordered list, IPv4 first, when the caller asks for all', async () => {
    lookupMock.mockImplementation((_h, _o, cb) =>
      cb(null, [
        { address: '2600:1406:3a00:486::1f51', family: 6 },
        { address: '23.37.17.69', family: 4 },
      ]),
    );
    const { address } = await call('cdn.nba.com', { all: true });
    expect(Array.isArray(address)).toBe(true);
    expect((address as Array<{ family: number }>)[0].family).toBe(4);
  });
});
