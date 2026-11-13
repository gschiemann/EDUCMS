/**
 * Playlist fallback — the pure rules (playlistFallback.ts). One case per
 * promise the module's header makes.
 */
import {
  FALLBACK_CARD_GAP_MS,
  FALLBACK_DWELL_MS,
  FALLBACK_MAX_ENTRIES,
  FALLBACK_REPORT_MAX_FOR_MS,
  FALLBACK_RETRY_STEPS_MS,
  FallbackDwell,
  PlaylistFallbackLedger,
  fallbackEligible,
  fallbackReport,
  pickReplaceWinner,
  shouldSetAside,
  trackFallbackOnGlass,
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

describe('FallbackDwell — the last resort: two minutes of the card, not ten seconds', () => {
  const SEC = 1_000;
  const KEY = '4k\na';
  const up = (nowMs: number, key = KEY) => ({ eligible: true, key, cardUp: true, contentShowing: false, nowMs });
  const gap = (nowMs: number, key = KEY) => ({ eligible: true, key, cardUp: false, contentShowing: false, nowMs });
  const playing = (nowMs: number, key = KEY) => ({ eligible: true, key, cardUp: false, contentShowing: true, nowMs });

  it('the numbers the rule is written in', () => {
    expect(FALLBACK_DWELL_MS).toBe(2 * MIN);
    expect(FALLBACK_CARD_GAP_MS).toBe(60 * SEC);
    // The page retries every 30 s; one retry must fit inside the gap.
    expect(FALLBACK_CARD_GAP_MS).toBeGreaterThan(30 * SEC);
  });

  it('the card up without a break: not at 10 s, not at 1 min 59 s, yes at 2 min', () => {
    const d = new FallbackDwell();
    expect(d.observe(up(0))).toEqual({ due: false, dueInMs: 2 * MIN });
    expect(d.observe(up(10 * SEC))).toEqual({ due: false, dueInMs: 110 * SEC });
    expect(d.observe(up(119 * SEC)).due).toBe(false);
    expect(d.observe(up(120 * SEC))).toEqual({ due: true, dueInMs: 0 });
  });

  it('a transient 20-second outage never falls back — content plays again and the count is gone', () => {
    const d = new FallbackDwell();
    d.observe(up(0));
    expect(d.observe(playing(20 * SEC))).toEqual({ due: false, dueInMs: null });
    // Hours of healthy playback later a new outage starts from zero.
    expect(d.observe(up(3 * 60 * MIN))).toEqual({ due: false, dueInMs: 2 * MIN });
  });

  it('an outage that comes and goes never adds up while the content plays in between', () => {
    const d = new FallbackDwell();
    let t = 0;
    for (let i = 0; i < 30; i += 1) {
      expect(d.observe(up(t)).due).toBe(false);
      t += 20 * SEC;
      expect(d.observe(up(t)).due).toBe(false);
      d.observe(playing(t + SEC));
      t += 40 * SEC;
    }
  });

  it('the 30-second retry does not restart the clock — and its gap does not count towards it', () => {
    const d = new FallbackDwell();
    let t = 0;
    let cardMs = 0;
    let dueAt: number | null = null;
    // 30 s of card, then 8 s with the files re-mounted and nothing proven, then the card again.
    for (let lap = 0; lap < 6 && dueAt === null; lap += 1) {
      const v = d.observe(up(t));
      expect(v.dueInMs).toBe(2 * MIN - cardMs);
      if (cardMs + 30 * SEC >= 2 * MIN) {
        dueAt = t + (v.dueInMs as number);
        expect(d.observe(up(dueAt)).due).toBe(true);
        break;
      }
      t += 30 * SEC;
      cardMs += 30 * SEC;
      expect(d.observe(gap(t))).toEqual({ due: false, dueInMs: null });
      t += 8 * SEC;
    }
    // Four 30-second stretches of card = two minutes, reached 3 gaps (24 s) later than without retries.
    expect(dueAt).toBe(2 * MIN + 3 * 8 * SEC);
  });

  it('never due while the card is down, however long it was up before', () => {
    const d = new FallbackDwell();
    d.observe(up(0));
    expect(d.observe(gap(119 * SEC))).toEqual({ due: false, dueInMs: null });
    expect(d.observe(gap(125 * SEC))).toEqual({ due: false, dueInMs: null });
    // Back up inside the gap: one more second of card is still owed.
    expect(d.observe(up(130 * SEC))).toEqual({ due: false, dueInMs: SEC });
    expect(d.observe(up(131 * SEC)).due).toBe(true);
  });

  it('the card off for longer than the gap is not "continuously": the two minutes start again', () => {
    const d = new FallbackDwell();
    d.observe(up(0));
    d.observe(gap(100 * SEC));
    expect(d.observe(up(100 * SEC + FALLBACK_CARD_GAP_MS))).toEqual({ due: false, dueInMs: 20 * SEC });
    d.observe(gap(110 * SEC + FALLBACK_CARD_GAP_MS));
    const later = 110 * SEC + 2 * FALLBACK_CARD_GAP_MS + 1;
    expect(d.observe(up(later))).toEqual({ due: false, dueInMs: 2 * MIN });
  });

  it('a different playlist on glass, or new content in the same one, is a new clock', () => {
    const d = new FallbackDwell();
    d.observe(up(0));
    expect(d.observe(up(100 * SEC, 'hb\nb'))).toEqual({ due: false, dueInMs: 2 * MIN });
    expect(d.observe(up(110 * SEC, 'hb\nb-republished'))).toEqual({ due: false, dueInMs: 2 * MIN });
  });

  it('NEVER counts under an alert, while stopped, or with nowhere to go — and starts over afterwards', () => {
    const d = new FallbackDwell();
    d.observe(up(0));
    expect(d.observe({ ...up(100 * SEC), eligible: false })).toEqual({ due: false, dueInMs: null });
    expect(d.observe({ ...up(500 * SEC), eligible: false })).toEqual({ due: false, dueInMs: null });
    expect(d.observe(up(501 * SEC))).toEqual({ due: false, dueInMs: 2 * MIN });
  });

  it('reset() forgets everything (the page calls it after acting)', () => {
    const d = new FallbackDwell();
    d.observe(up(0));
    d.reset();
    expect(d.observe(up(119 * SEC))).toEqual({ due: false, dueInMs: 2 * MIN });
  });

  it('fallbackEligible is shouldSetAside without the card', () => {
    const base = { playing: true, emergency: false, onGlass: { id: '4k', sig: 'a' }, hasAlternative: true };
    expect(fallbackEligible(base)).toBe(true);
    expect(fallbackEligible({ ...base, emergency: true })).toBe(false);
    expect(fallbackEligible({ ...base, playing: false })).toBe(false);
    expect(fallbackEligible({ ...base, onGlass: null })).toBe(false);
    expect(fallbackEligible({ ...base, hasAlternative: false })).toBe(false);
    expect(shouldSetAside({ ...base, contentUnavailable: false })).toBe(false);
  });
});

describe('the report — what a screen on a backup playlist tells the server', () => {
  it('not on a fallback: nothing to track, nothing to send', () => {
    expect(trackFallbackOnGlass(null, { fellBack: false, fromId: '4k', toId: '4k' }, T0)).toBeNull();
    expect(trackFallbackOnGlass({ fromId: '4k', toId: 'hb', sinceMs: T0 }, { fellBack: false, fromId: '4k', toId: '4k' }, T0 + MIN)).toBeNull();
    expect(fallbackReport(null, T0)).toBeNull();
  });

  it('the same pair keeps its start; a different pair starts now', () => {
    const first = trackFallbackOnGlass(null, { fellBack: true, fromId: '4k', toId: 'hb' }, T0);
    expect(first).toEqual({ fromId: '4k', toId: 'hb', sinceMs: T0 });
    expect(trackFallbackOnGlass(first, { fellBack: true, fromId: '4k', toId: 'hb' }, T0 + 5 * MIN)).toBe(first);
    expect(trackFallbackOnGlass(first, { fellBack: true, fromId: '4k', toId: 'tpl' }, T0 + 5 * MIN)).toEqual({ fromId: '4k', toId: 'tpl', sinceMs: T0 + 5 * MIN });
  });

  it('a pick with a missing id, or the same playlist twice, is not a fallback', () => {
    expect(trackFallbackOnGlass(null, { fellBack: true, fromId: null, toId: 'hb' }, T0)).toBeNull();
    expect(trackFallbackOnGlass(null, { fellBack: true, fromId: '4k', toId: '' }, T0)).toBeNull();
    expect(trackFallbackOnGlass(null, { fellBack: true, fromId: '4k', toId: '4k' }, T0)).toBeNull();
  });

  it('ids and a duration only — never a name, never a clock time', () => {
    const r = fallbackReport({ fromId: 'cm3abc_4k', toId: 'cm3abc-hb', sinceMs: T0 }, T0 + 90_500.7);
    expect(r).toEqual({ fromPlaylistId: 'cm3abc_4k', toPlaylistId: 'cm3abc-hb', forMs: 90_500 });
    expect(Object.keys(r as object).sort()).toEqual(['forMs', 'fromPlaylistId', 'toPlaylistId']);
  });

  it('the duration is bounded, and a clock that went backwards reads as zero', () => {
    const on = { fromId: 'a', toId: 'b', sinceMs: T0 };
    expect(fallbackReport(on, T0 - 5 * MIN)?.forMs).toBe(0);
    expect(fallbackReport(on, T0 + 400 * 24 * 60 * MIN)?.forMs).toBe(FALLBACK_REPORT_MAX_FOR_MS);
  });

  it('an id the server would refuse is not sent at all (a refused report costs liveness)', () => {
    expect(fallbackReport({ fromId: 'has space', toId: 'b', sinceMs: T0 }, T0)).toBeNull();
    expect(fallbackReport({ fromId: 'a', toId: 'x'.repeat(65), sinceMs: T0 }, T0)).toBeNull();
    expect(fallbackReport({ fromId: 'a', toId: 'usb:stick', sinceMs: T0 }, T0)).toBeNull();
  });
});
