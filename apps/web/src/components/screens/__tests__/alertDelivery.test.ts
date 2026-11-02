import { ALERT_CONFIRM_WAIT_MS, screenConfirmedAlert, summarizeAlertDelivery } from '../alertDelivery';

const sentAt = 1_000_000;
const screens = [
  { name: 'Lobby', grade: 'painting', lastRenderedHash: 'em:1edd5448' },
  { name: 'Gym', grade: 'alert-not-painted', lastRenderedHash: 'pending|em:1edd5448' },
  { name: 'Cafeteria', grade: 'alert-unconfirmed', lastRenderedHash: 'unconfirmed|em:1edd5448' },
  { name: 'Hall A', grade: 'painting', lastRenderedHash: 'pl:0|10000|item' },
];

describe('alert delivery in plain words (2026-11-02)', () => {
  it('counts an accepted emergency paint as confirmed, pending or normal content as not', () => {
    expect(screens.map(screenConfirmedAlert)).toEqual([true, false, true, false]);
  });

  it('says "showing on N of M" only when every screen confirmed', () => {
    const all = screens.filter(s => screenConfirmedAlert(s));
    expect(summarizeAlertDelivery(all, sentAt, sentAt + 5_000).line).toEqual({ key: 'alertShowingOn', values: { confirmed: 2, total: 2 } });
  });

  it('waits for the stragglers inside the first minute, then names them', () => {
    const early = summarizeAlertDelivery(screens, sentAt, sentAt + ALERT_CONFIRM_WAIT_MS - 1);
    expect(early.line).toEqual({ key: 'alertWaitingFor', values: { count: 2 } });
    expect(early).toMatchObject({ total: 4, confirmed: 2, unconfirmedNames: ['Gym', 'Hall A'] });
    const late = summarizeAlertDelivery(screens, sentAt, sentAt + ALERT_CONFIRM_WAIT_MS);
    expect(late.line).toEqual({ key: 'alertNotConfirmed', values: { count: 2, names: 'Gym, Hall A' } });
  });

  it('bounds the named list', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ name: `Screen ${i + 1}`, grade: 'alert-not-painted', lastRenderedHash: 'pending|em:x' }));
    const late = summarizeAlertDelivery(many, sentAt, sentAt + ALERT_CONFIRM_WAIT_MS, 3);
    expect(late.line).toEqual({ key: 'alertNotConfirmed', values: { count: 9, names: 'Screen 1, Screen 2, Screen 3 +6' } });
  });

  it('never uses the words proof, paint or on-glass in a key', () => {
    for (const key of ['alertShowingOn', 'alertWaitingFor', 'alertNotConfirmed']) expect(key).not.toMatch(/proof|paint|glass/i);
  });
});
