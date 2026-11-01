/**
 * "A message that ends never flashes an alert board" (2026-10-26) — the
 * evidence the page weighs before it lets the content stand through the hold's
 * release. See messageEnd.ts.
 */
import { messageWasTheOnlyHold, type MessageEndEvidence } from '../messageEnd';

const only: MessageEndEvidence = {
  holdIsOurs: true,
  activeEmergency: false,
  pendingOverrideConfirm: false,
  anotherMessageShowing: false,
};

describe('messageWasTheOnlyHold', () => {
  it('the page’s own hold, nothing else holding → the message was the only reason', () => {
    expect(messageWasTheOnlyHold(only)).toBe(true);
  });

  it('a hold the APK was already holding at boot is not the page’s to explain away', () => {
    expect(messageWasTheOnlyHold({ ...only, holdIsOurs: false })).toBe(false);
  });

  it('a lockdown (manifest or provisional alert) on the glass is another reason', () => {
    expect(messageWasTheOnlyHold({ ...only, activeEmergency: true })).toBe(false);
  });

  it('a signed OVERRIDE still awaiting its manifest confirm is another reason', () => {
    expect(messageWasTheOnlyHold({ ...only, pendingOverrideConfirm: true })).toBe(false);
  });

  it('another message still showing is another reason', () => {
    expect(messageWasTheOnlyHold({ ...only, anotherMessageShowing: true })).toBe(false);
  });

  it('every single extra reason is enough, alone', () => {
    const keys: Array<keyof MessageEndEvidence> = ['activeEmergency', 'pendingOverrideConfirm', 'anotherMessageShowing'];
    for (const k of keys) expect(messageWasTheOnlyHold({ ...only, [k]: true })).toBe(false);
  });
});
