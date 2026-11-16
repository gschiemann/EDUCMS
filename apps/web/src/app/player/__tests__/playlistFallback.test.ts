/**
 * Playlist fallback — the pure rules (playlistFallback.ts). One case per
 * promise the module's header makes.
 */
import {
  FALLBACK_CARD_GAP_MS,
  FALLBACK_DWELL_MS,
  FALLBACK_EPISODE_STORE_KEY,
  FALLBACK_MAX_ENTRIES,
  FALLBACK_RECOVERED_REPORT_MS,
  FALLBACK_RECOVERY_MS,
  FALLBACK_REPORT_MAX_FOR_MS,
  FALLBACK_RETRY_STEPS_MS,
  FallbackDwell,
  PlaylistFallbackLedger,
  RecoveryProof,
  everyItemOut,
  fallbackEligible,
  fallbackReport,
  nextFallbackEpisode,
  pickReplaceWinner,
  readStoredFallbackEpisode,
  shouldSetAside,
  storedFallbackEpisode,
  type EpisodeObservation,
  type FallbackEpisode,
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

describe('a retry that could only show the card is not put on the glass (hopeless)', () => {
  it('stays out past its time while every file is still out, and comes back the minute one could play', () => {
    const l = new PlaylistFallbackLedger();
    const key = { id: '4k', sig: 'a' };
    l.setAside(key, T0);
    let blocked = true;
    const hopeless = (k: FallbackKey) => k.id === '4k' && blocked;
    expect(l.isSetAside(key, T0 + 14 * MIN, hopeless)).toBe(true);
    // Its 15 minutes are up, but its only file is still blocked: still out, and not due.
    expect(l.isSetAside(key, T0 + 15 * MIN, hopeless)).toBe(true);
    expect(l.takeDue(T0 + 15 * MIN, hopeless)).toBe(false);
    expect(l.takeDue(T0 + 200 * MIN, hopeless)).toBe(false);
    expect(pickReplaceWinner([FOURK, NORMAL], keyOf, l, T0 + 200 * MIN, hopeless).winner).toBe(NORMAL);
    // The block lifts (six hours on): the next look releases it, once.
    blocked = false;
    expect(l.isSetAside(key, T0 + 360 * MIN, hopeless)).toBe(false);
    expect(l.takeDue(T0 + 360 * MIN, hopeless)).toBe(true);
    expect(l.takeDue(T0 + 361 * MIN, hopeless)).toBe(false);
    // Released: a hopeless verdict no longer holds it out (its retry was taken).
    blocked = true;
    expect(l.isSetAside(key, T0 + 362 * MIN, hopeless)).toBe(false);
    // Failing again steps the back-off up (30 min), not back to 15.
    expect(l.setAside(key, T0 + 365 * MIN) - (T0 + 365 * MIN)).toBe(30 * MIN);
  });

  it('without a verdict it behaves exactly as before: out until its time, then back', () => {
    const l = new PlaylistFallbackLedger();
    l.setAside({ id: '4k', sig: 'a' }, T0);
    expect(l.isSetAside({ id: '4k', sig: 'a' }, T0 + 15 * MIN)).toBe(false);
    expect(l.isSetAside({ id: '4k', sig: 'a' }, T0 + 15 * MIN, () => false)).toBe(false);
  });

  it('new content is never held out by the old content’s verdict', () => {
    const l = new PlaylistFallbackLedger();
    l.setAside({ id: '4k', sig: 'a' }, T0);
    expect(l.isSetAside({ id: '4k', sig: 'converted' }, T0 + 20 * MIN, () => true)).toBe(false);
  });

  it('everyItemOut: every item — and an empty playlist is never hopeless', () => {
    expect(everyItemOut([1, 2], (n) => n > 0)).toBe(true);
    expect(everyItemOut([1, 0], (n) => n > 0)).toBe(false);
    expect(everyItemOut([], () => true)).toBe(false);
  });

  it('the kill switch clears everything: the first choice takes the screen again', () => {
    const l = new PlaylistFallbackLedger();
    l.setAside({ id: '4k', sig: 'a' }, T0);
    l.clearAll();
    expect(l.size).toBe(0);
    expect(pickReplaceWinner([FOURK, NORMAL], keyOf, l, T0 + MIN).winner).toBe(FOURK);
  });
});

describe('RecoveryProof — the schedule’s choice is back only after five minutes of play', () => {
  const K = '4k\na';
  const obs = (nowMs: number, over: Partial<{ key: string | null; cardUp: boolean; contentShowing: boolean }> = {}) =>
    ({ key: K, cardUp: false, contentShowing: true, nowMs, ...over });

  it('the number (the customer alert emails hold a recovery as long)', () => {
    expect(FALLBACK_RECOVERY_MS).toBe(5 * MIN);
  });

  it('five minutes from the first picture, and showing at that moment', () => {
    const p = new RecoveryProof();
    expect(p.observe(obs(0))).toBe(false);
    expect(p.observe(obs(4 * MIN + 59_000))).toBe(false);
    expect(p.observe(obs(5 * MIN))).toBe(true);
    expect(p.observe(obs(6 * MIN, { contentShowing: false }))).toBe(false); // the next file loading
    expect(p.observe(obs(6 * MIN + 1))).toBe(true);
  });

  it('the clock starts at the first picture, not when the playlist went up', () => {
    const p = new RecoveryProof();
    expect(p.observe(obs(0, { contentShowing: false }))).toBe(false);
    expect(p.observe(obs(3 * MIN))).toBe(false);
    expect(p.observe(obs(7 * MIN + 59_000))).toBe(false);
    expect(p.observe(obs(8 * MIN))).toBe(true);
  });

  it('a slide change is not a failure; the card is — the five minutes start over', () => {
    const p = new RecoveryProof();
    p.observe(obs(0));
    p.observe(obs(MIN, { contentShowing: false }));
    p.observe(obs(2 * MIN));
    expect(p.observe(obs(4 * MIN, { cardUp: true, contentShowing: false }))).toBe(false);
    expect(p.observe(obs(5 * MIN))).toBe(false);
    expect(p.observe(obs(9 * MIN + 59_000))).toBe(false);
    expect(p.observe(obs(10 * MIN))).toBe(true);
  });

  it('different content, or no first choice on the glass (a backup, an alert, a stop), starts it over', () => {
    const p = new RecoveryProof();
    p.observe(obs(0));
    expect(p.observe(obs(5 * MIN, { key: '4k\nb' }))).toBe(false);
    expect(p.observe(obs(10 * MIN, { key: null }))).toBe(false);
    expect(p.observe(obs(11 * MIN))).toBe(false);
    expect(p.observe(obs(16 * MIN))).toBe(true);
    p.reset();
    expect(p.observe(obs(16 * MIN + 1))).toBe(false);
  });
});

describe('the episode — what the report says from the first backup to the recovery', () => {
  const glass = (onGlassId: string, fellBack: boolean, firstChoiceId = '4k') => ({ firstChoiceId, onGlassId, fellBack });
  const o = (over: Partial<EpisodeObservation>): EpisodeObservation => ({
    disabled: false, frozen: false, glass: glass('4k', false), backupShowing: false, firstChoiceProven: false, nowMs: T0, ...over,
  });

  it('the incident end to end: backup → retrying → backup → retrying → recovered → forgotten', () => {
    let ep: FallbackEpisode | null = null;
    ep = nextFallbackEpisode(ep, o({}));
    expect(ep).toBeNull(); // the schedule's choice plays: nothing to say
    ep = nextFallbackEpisode(ep, o({ glass: glass('hb', true), nowMs: T0 + 2 * MIN }));
    expect(ep).toBeNull(); // the backup is committed but not proven on the glass yet
    ep = nextFallbackEpisode(ep, o({ glass: glass('hb', true), backupShowing: true, nowMs: T0 + 2 * MIN + 2_000 }));
    expect(ep).toEqual({ fromId: '4k', toId: 'hb', startedAtMs: T0 + 2 * MIN + 2_000, state: 'backup' });
    const started = (ep as FallbackEpisode).startedAtMs;
    // Steady: the very same object (the page writes storage only on a change).
    expect(nextFallbackEpisode(ep, o({ glass: glass('hb', true), backupShowing: true, nowMs: T0 + 10 * MIN }))).toBe(ep);
    // The 15-minute retry puts the schedule's choice back on the glass.
    ep = nextFallbackEpisode(ep, o({ glass: glass('4k', false), nowMs: T0 + 17 * MIN }));
    expect(ep).toEqual({ fromId: '4k', toId: 'hb', startedAtMs: started, state: 'retrying' });
    // It fails again: back to the backup — the same episode, never a new one.
    ep = nextFallbackEpisode(ep, o({ glass: glass('hb', true), backupShowing: true, nowMs: T0 + 20 * MIN }));
    expect(ep).toEqual({ fromId: '4k', toId: 'hb', startedAtMs: started, state: 'backup' });
    // The next retry plays and holds for five minutes: recovered.
    ep = nextFallbackEpisode(ep, o({ glass: glass('4k', false), nowMs: T0 + 50 * MIN }));
    expect(ep?.state).toBe('retrying');
    ep = nextFallbackEpisode(ep, o({ glass: glass('4k', false), firstChoiceProven: true, nowMs: T0 + 55 * MIN }));
    expect(ep).toEqual({ fromId: '4k', toId: '4k', startedAtMs: started, state: 'recovered', endedAtMs: T0 + 55 * MIN });
    // Said for ten minutes, then forgotten.
    expect(nextFallbackEpisode(ep, o({ glass: glass('4k', false), firstChoiceProven: true, nowMs: T0 + 64 * MIN }))).toBe(ep);
    expect(nextFallbackEpisode(ep, o({ glass: glass('4k', false), nowMs: T0 + 55 * MIN + FALLBACK_RECOVERED_REPORT_MS }))).toBeNull();
  });

  it('a failure soon after the recovery is a NEW episode (the admins hear it again)', () => {
    const recovered: FallbackEpisode = { fromId: '4k', toId: '4k', startedAtMs: T0, state: 'recovered', endedAtMs: T0 + 30 * MIN };
    expect(nextFallbackEpisode(recovered, o({ glass: glass('hb', true), backupShowing: true, nowMs: T0 + 33 * MIN })))
      .toEqual({ fromId: '4k', toId: 'hb', startedAtMs: T0 + 33 * MIN, state: 'backup' });
  });

  it('the schedule moved on (another first choice plays): over once THAT has played five minutes', () => {
    const open: FallbackEpisode = { fromId: '4k', toId: 'hb', startedAtMs: T0, state: 'backup' };
    let ep = nextFallbackEpisode(open, o({ glass: glass('lunch', false, 'lunch'), nowMs: T0 + MIN }));
    expect(ep).toMatchObject({ state: 'retrying', fromId: '4k' });
    ep = nextFallbackEpisode(ep, o({ glass: glass('lunch', false, 'lunch'), firstChoiceProven: true, nowMs: T0 + 6 * MIN }));
    expect(ep).toMatchObject({ state: 'recovered', fromId: '4k', toId: 'lunch' });
  });

  it('another backup keeps the episode; another first choice failing starts a new one', () => {
    const open: FallbackEpisode = { fromId: '4k', toId: 'hb', startedAtMs: T0, state: 'backup' };
    expect(nextFallbackEpisode(open, o({ glass: glass('board', true), backupShowing: true, nowMs: T0 + MIN })))
      .toEqual({ fromId: '4k', toId: 'board', startedAtMs: T0, state: 'backup' });
    expect(nextFallbackEpisode(open, o({ glass: glass('hb', true, 'lunch'), backupShowing: true, nowMs: T0 + MIN })))
      .toEqual({ fromId: 'lunch', toId: 'hb', startedAtMs: T0 + MIN, state: 'backup' });
  });

  it('NEVER moves under an alert or while stopped, nor before anything is committed', () => {
    const open: FallbackEpisode = { fromId: '4k', toId: 'hb', startedAtMs: T0, state: 'backup' };
    expect(nextFallbackEpisode(open, o({ frozen: true, glass: glass('4k', false), firstChoiceProven: true }))).toBe(open);
    expect(nextFallbackEpisode(null, o({ frozen: true, glass: glass('hb', true), backupShowing: true }))).toBeNull();
    expect(nextFallbackEpisode(open, o({ glass: undefined }))).toBe(open);
  });

  it('nothing ranked on the glass any more (nothing scheduled, a legacy manifest): over, without a claim', () => {
    const open: FallbackEpisode = { fromId: '4k', toId: 'hb', startedAtMs: T0, state: 'retrying' };
    expect(nextFallbackEpisode(open, o({ glass: null }))).toBeNull();
    expect(nextFallbackEpisode(open, o({ glass: { firstChoiceId: null, onGlassId: null, fellBack: false } }))).toBeNull();
  });

  it('the kill switch: no episode at all', () => {
    const open: FallbackEpisode = { fromId: '4k', toId: 'hb', startedAtMs: T0, state: 'backup' };
    expect(nextFallbackEpisode(open, o({ disabled: true }))).toBeNull();
    expect(nextFallbackEpisode(null, o({ disabled: true, glass: glass('hb', true), backupShowing: true }))).toBeNull();
  });

  it('a malformed glass (one id twice, a missing id) changes nothing', () => {
    const open: FallbackEpisode = { fromId: '4k', toId: 'hb', startedAtMs: T0, state: 'backup' };
    expect(nextFallbackEpisode(open, o({ glass: { firstChoiceId: 'hb', onGlassId: 'hb', fellBack: true }, backupShowing: true }))).toBe(open);
    expect(nextFallbackEpisode(null, o({ glass: { firstChoiceId: null, onGlassId: 'hb', fellBack: true }, backupShowing: true }))).toBeNull();
  });
});

describe('the report — ids, a duration and a state; never a name', () => {
  const ep: FallbackEpisode = { fromId: 'cm3abc_4k', toId: 'cm3abc-hb', startedAtMs: T0, state: 'backup' };

  it('no episode: nothing to send', () => {
    expect(fallbackReport(null, T0)).toBeNull();
  });

  it('exactly four keys', () => {
    const r = fallbackReport(ep, T0 + 90_500.7);
    expect(r).toEqual({ fromPlaylistId: 'cm3abc_4k', toPlaylistId: 'cm3abc-hb', forMs: 90_500, state: 'backup' });
    expect(Object.keys(r as object).sort()).toEqual(['forMs', 'fromPlaylistId', 'state', 'toPlaylistId']);
  });

  it('retrying keeps counting; recovered stops at the recovery', () => {
    expect(fallbackReport({ ...ep, state: 'retrying' }, T0 + 20 * MIN)?.forMs).toBe(20 * MIN);
    expect(fallbackReport({ fromId: 'a', toId: 'a', startedAtMs: T0, state: 'recovered', endedAtMs: T0 + 40 * MIN }, T0 + 45 * MIN))
      .toEqual({ fromPlaylistId: 'a', toPlaylistId: 'a', forMs: 40 * MIN, state: 'recovered' });
  });

  it('the duration is bounded, and a clock that went backwards reads as zero', () => {
    expect(fallbackReport(ep, T0 - 5 * MIN)?.forMs).toBe(0);
    expect(fallbackReport(ep, T0 + 400 * 24 * 60 * MIN)?.forMs).toBe(FALLBACK_REPORT_MAX_FOR_MS);
  });

  it('an id or state the server would refuse is not sent at all (a refused report costs liveness)', () => {
    expect(fallbackReport({ ...ep, fromId: 'has space' }, T0)).toBeNull();
    expect(fallbackReport({ ...ep, toId: 'x'.repeat(65) }, T0)).toBeNull();
    expect(fallbackReport({ ...ep, toId: 'usb:stick' }, T0)).toBeNull();
    expect(fallbackReport({ ...ep, toId: ep.fromId }, T0)).toBeNull(); // "fell back to itself"
    expect(fallbackReport({ ...ep, state: 'nonsense' as never }, T0)).toBeNull();
  });
});

describe('the episode survives a reload (so the admins still hear how it ended)', () => {
  const ep: FallbackEpisode = { fromId: '4k', toId: 'hb', startedAtMs: T0, state: 'backup' };

  it('round trip; a stored backup comes back as retrying (a reload empties the set-aside ledger)', () => {
    expect(FALLBACK_EPISODE_STORE_KEY).toBe('edu_playlist_fallback_episode_v1');
    expect(readStoredFallbackEpisode(storedFallbackEpisode(ep), T0 + 30 * MIN)).toEqual({ ...ep, state: 'retrying' });
    expect(readStoredFallbackEpisode(storedFallbackEpisode({ ...ep, state: 'retrying' }), T0 + MIN)).toEqual({ ...ep, state: 'retrying' });
    expect(storedFallbackEpisode(null)).toBeNull();
  });

  it('a recovery is restored only inside its ten-minute report window', () => {
    const rec: FallbackEpisode = { fromId: '4k', toId: '4k', startedAtMs: T0, state: 'recovered', endedAtMs: T0 + 60 * MIN };
    expect(readStoredFallbackEpisode(storedFallbackEpisode(rec), T0 + 65 * MIN)).toEqual(rec);
    expect(readStoredFallbackEpisode(storedFallbackEpisode(rec), T0 + 60 * MIN + FALLBACK_RECOVERED_REPORT_MS)).toBeNull();
    expect(readStoredFallbackEpisode(JSON.stringify({ ...rec, endedAtMs: undefined }), T0 + 61 * MIN)).toBeNull();
  });

  it('anything malformed, too old or from the future is nothing', () => {
    for (const raw of [null, '', 'not json', '[]', '7', JSON.stringify({ ...ep, fromId: 'has space' }), JSON.stringify({ ...ep, state: 'x' }),
      JSON.stringify({ ...ep, startedAtMs: 'yesterday' }), JSON.stringify({ ...ep, toId: '4k' })]) {
      expect(readStoredFallbackEpisode(raw, T0 + MIN)).toBeNull();
    }
    expect(readStoredFallbackEpisode(storedFallbackEpisode(ep), T0 + FALLBACK_REPORT_MAX_FOR_MS + 1)).toBeNull();
    expect(readStoredFallbackEpisode(storedFallbackEpisode(ep), T0 - 6 * MIN)).toBeNull();
    expect(readStoredFallbackEpisode(storedFallbackEpisode(ep), T0 - 4 * MIN)).not.toBeNull(); // a little skew is believed
  });
});

