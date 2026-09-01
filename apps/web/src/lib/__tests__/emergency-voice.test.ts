import {
  EMERGENCY_VOICE_KEY,
  isEmergencyVoiceEnabled,
  setEmergencyVoiceEnabled,
  speakEmergencyIfEnabled,
} from '../emergency-voice';

/**
 * Mobile design package §M17 / §15 / §21 wave-0 item 2 — emergency
 * announcements are SILENT until the operator opts in, and the opt-out path
 * must fail closed on every storage failure mode.
 */
describe('emergency voice preference', () => {
  const speak = jest.fn();
  const cancel = jest.fn();

  beforeEach(() => {
    window.localStorage.clear();
    speak.mockClear();
    cancel.mockClear();
    (window as unknown as Record<string, unknown>).speechSynthesis = { speak, cancel };
    (window as unknown as Record<string, unknown>).SpeechSynthesisUtterance =
      function Utterance(this: Record<string, unknown>, t: string) { this.text = t; } as unknown;
  });

  it('is OFF when nothing was ever stored — silent by default', () => {
    expect(isEmergencyVoiceEnabled()).toBe(false);
  });

  it('does NOT speak while off, however many announcements arrive', () => {
    speakEmergencyIfEnabled('Holding lockdown alert…');
    speakEmergencyIfEnabled('Lockdown alert sent to all displays.');
    expect(speak).not.toHaveBeenCalled();
  });

  it('speaks only after an explicit opt-in, and stops again on opt-out', () => {
    setEmergencyVoiceEnabled(true);
    expect(isEmergencyVoiceEnabled()).toBe(true);
    speakEmergencyIfEnabled('Lockdown alert sent to all displays.');
    expect(speak).toHaveBeenCalledTimes(1);

    setEmergencyVoiceEnabled(false);
    expect(isEmergencyVoiceEnabled()).toBe(false);
    speakEmergencyIfEnabled('All clear.');
    expect(speak).toHaveBeenCalledTimes(1); // unchanged
  });

  it('cancels any in-flight utterance so phase changes cannot overlap', () => {
    setEmergencyVoiceEnabled(true);
    speakEmergencyIfEnabled('Holding…');
    expect(cancel).toHaveBeenCalled();
  });

  it('any stored value other than the exact opt-in reads as silent', () => {
    for (const v of ['ON', 'true', '1', 'yes', '', 'off']) {
      window.localStorage.setItem(EMERGENCY_VOICE_KEY, v);
      expect(isEmergencyVoiceEnabled()).toBe(false);
    }
  });

  it('a throwing localStorage reads as silent, never as loud', () => {
    const spy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    expect(isEmergencyVoiceEnabled()).toBe(false);
    speakEmergencyIfEnabled('Holding…');
    expect(speak).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('a throwing speech engine never propagates — the live region is the contract', () => {
    setEmergencyVoiceEnabled(true);
    speak.mockImplementation(() => { throw new Error('TTS unavailable'); });
    expect(() => speakEmergencyIfEnabled('Holding…')).not.toThrow();
  });

  it('no speech engine at all is a no-op, not a crash (Taurus Chromium 83)', () => {
    setEmergencyVoiceEnabled(true);
    delete (window as unknown as Record<string, unknown>).speechSynthesis;
    expect(() => speakEmergencyIfEnabled('Holding…')).not.toThrow();
  });
});
