/**
 * Playlist fallback — the pure rules (playlistFallback.ts). One case per
 * promise the module's header makes.
 */
import {
  FALLBACK_MAX_ENTRIES,
  FALLBACK_RETRY_STEPS_MS,
  PlaylistFallbackLedger,
  pickReplaceWinner,
  shouldSetAside,
  type FallbackKey,
} from '../playlistFallback';

const MIN = 60_000;
const T0 = Date.parse('2026-11-11T23:00:00Z');

interface Pl { id: string; sig: string; template?: boolean }
const keyOf = (p: Pl): FallbackKey | null => (p.template ? null : { id: p.id, sig: p.sig });
const FOURK: Pl = { id: '4k', sig: 'a' };
const NORMAL: Pl = { id: 'hb', sig: 'b' };
const BOARD: Pl = { id: 'tpl', sig: '', template: true };

describe('pickReplaceWinner — the manifest order, stepping past what cannot play', () => {
  it('nothing set aside: the manifest’s first choice, exactly as before', () => {
    const l = new PlaylistFallbackLedger();
    expect(pickReplaceWinner([FOURK, NORMAL], keyOf, l, T0)).toEqual({ winner: FOURK, primary: FOURK, fellBack: false, hasAlternative: true });
    expect(pickReplaceWinner([FOURK], keyOf, l, T0)).toEqual({ winner: FOURK, primary: FOURK, fellBack: false, hasAlternative: false });
    expect(pickReplaceWinner([] as Pl[], keyOf, l, T0)).toEqual({ winner: null, primary: null, fellBack: false, hasAlternative: false });
  });

  it('the incident: the single 4K video cannot play → the other scheduled playlist takes the screen', () => {
    const l = new PlaylistFallbackLedger();
    l.setAside(keyOf(FOURK) as FallbackKey, T0);
    const pick = pickReplaceWinner([FOURK, NORMAL], keyOf, l, T0 + MIN);
    expect(pick.winner).toBe(NORMAL);
    expect(pick.primary).toBe(FOURK);
    expect(pick.fellBack).toBe(true);
    expect(pick.hasAlternative).toBe(false);
  });

  it('every playlist set aside: back to the manifest’s first choice — its card is the honest state', () => {
    const l = new PlaylistFallbackLedger();
    l.setAside(keyOf(FOURK) as FallbackKey, T0);
    l.setAside(keyOf(NORMAL) as FallbackKey, T0);
    const pick = pickReplaceWinner([FOURK, NORMAL], keyOf, l, T0 + MIN);
    expect(pick.winner).toBe(FOURK);
    expect(pick.fellBack).toBe(false);
    expect(pick.hasAlternative).toBe(false);
  });

  it('a template is never set aside, and may be what the screen falls back to', () => {
    const l = new PlaylistFallbackLedger();
    l.setAside({ id: 'tpl', sig: '' }, T0); // even if someone tried
    expect(pickReplaceWinner([BOARD, NORMAL], keyOf, l, T0).winner).toBe(BOARD);
    l.setAside(keyOf(FOURK) as FallbackKey, T0);
    expect(pickReplaceWinner([FOURK, BOARD, NORMAL], keyOf, l, T0).winner).toBe(BOARD);
  });

  it('order is the server’s: the fallback is the NEXT open playlist, not any playlist', () => {
    const l = new PlaylistFallbackLedger();
    const third: Pl = { id: 'c', sig: 'c' };
    l.setAside(keyOf(FOURK) as FallbackKey, T0);
    expect(pickReplaceWinner([FOURK, NORMAL, third], keyOf, l, T0).winner).toBe(NORMAL);
    expect(pickReplaceWinner([FOURK, NORMAL, third], keyOf, l, T0).hasAlternative).toBe(true);
  });
});

describe('PlaylistFallbackLedger — it comes back', () => {
  it('a re-publish (new content signature) is tried at once', () => {
    const l = new PlaylistFallbackLedger();
    l.setAside({ id: '4k', sig: 'a' }, T0);
    expect(l.isSetAside({ id: '4k', sig: 'a' }, T0 + MIN)).toBe(true);
    expect(l.isSetAside({ id: '4k', sig: 'a-converted' }, T0 + MIN)).toBe(false);
  });

  it('the same content is tried again after 15 min, then 30, 60, and 120 at most', () => {
    const l = new PlaylistFallbackLedger();
    const key = { id: '4k', sig: 'a' };
    let now = T0;
    const waits: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const until = l.setAside(key, now);
      waits.push((until - now) / MIN);
      expect(l.isSetAside(key, until - 1)).toBe(true);
      expect(l.isSetAside(key, until)).toBe(false);
      now = until + MIN;
    }
    expect(waits).toEqual([15, 30, 60, 120, 120, 120]);
    expect(FALLBACK_RETRY_STEPS_MS.map((m) => m / MIN)).toEqual([15, 30, 60, 120]);
  });

  it('takeDue reports an expired set-aside once, and keeps the back-off history', () => {
    const l = new PlaylistFallbackLedger();
    const key = { id: '4k', sig: 'a' };
    l.setAside(key, T0);
    expect(l.takeDue(T0 + 14 * MIN)).toBe(false);
    expect(l.takeDue(T0 + 15 * MIN)).toBe(true);
    expect(l.takeDue(T0 + 16 * MIN)).toBe(false);
    // Failing again steps UP, not back to 15 minutes.
    expect(l.setAside(key, T0 + 17 * MIN) - (T0 + 17 * MIN)).toBe(30 * MIN);
  });

  it('a playlist that played after all starts over at 15 minutes next time', () => {
    const l = new PlaylistFallbackLedger();
    const key = { id: '4k', sig: 'a' };
    l.setAside(key, T0);
    l.setAside(key, T0 + 20 * MIN);
    l.clear('4k');
    expect(l.isSetAside(key, T0 + 21 * MIN)).toBe(false);
    expect(l.setAside(key, T0 + 30 * MIN) - (T0 + 30 * MIN)).toBe(15 * MIN);
  });

  it('new content under the same playlist resets the back-off', () => {
    const l = new PlaylistFallbackLedger();
    l.setAside({ id: '4k', sig: 'a' }, T0);
    l.setAside({ id: '4k', sig: 'a' }, T0 + 20 * MIN);
    expect(l.setAside({ id: '4k', sig: 'b' }, T0 + 60 * MIN) - (T0 + 60 * MIN)).toBe(15 * MIN);
  });

  it('is bounded', () => {
    const l = new PlaylistFallbackLedger();
    for (let i = 0; i < FALLBACK_MAX_ENTRIES + 20; i += 1) l.setAside({ id: `p${i}`, sig: 's' }, T0);
    expect(l.size).toBe(FALLBACK_MAX_ENTRIES);
    expect(l.isSetAside({ id: 'p0', sig: 's' }, T0)).toBe(false);
    expect(l.isSetAside({ id: `p${FALLBACK_MAX_ENTRIES + 19}`, sig: 's' }, T0)).toBe(true);
  });
});

describe('shouldSetAside — when the player steps to another playlist', () => {
  const base = { contentUnavailable: true, playing: true, emergency: false, onGlass: { id: '4k', sig: 'a' }, hasAlternative: true };

  it('the card is up, regular content, and another playlist is scheduled → yes', () => {
    expect(shouldSetAside(base)).toBe(true);
  });

  it('NEVER under any alert state', () => {
    expect(shouldSetAside({ ...base, emergency: true })).toBe(false);
  });

  it('no other playlist scheduled → nothing changes (the card, as before)', () => {
    expect(shouldSetAside({ ...base, hasAlternative: false })).toBe(false);
  });

  it('content is playing, the player is stopped or connecting, or a template / legacy manifest is on glass → no', () => {
    expect(shouldSetAside({ ...base, contentUnavailable: false })).toBe(false);
    expect(shouldSetAside({ ...base, playing: false })).toBe(false);
    expect(shouldSetAside({ ...base, onGlass: null })).toBe(false);
  });
});
