import {
  EMERGENCY_STANDARD_WORDING,
  EMERGENCY_WORDING_KINDS,
  emergencyWordingKind,
  standardEmergencyText,
  systemEmergencyBoardColor,
  systemEmergencyBoardText,
  type EmergencyWordingLocale,
} from './emergency-wording';

describe('the system board — one rule for the manifest, the staging and the player surface', () => {
  it('a live alert of a known type with no words of its own shows the standard words', () => {
    expect(systemEmergencyBoardText({ type: 'MEDICAL', isDrill: false })).toBe(standardEmergencyText('medical'));
    expect(systemEmergencyBoardText({ type: 'EVACUATE', isDrill: false })).toBe(standardEmergencyText('evacuate'));
  });
  it('a drill says so first and never uses the live standard words', () => {
    const text = systemEmergencyBoardText({ type: 'HOLD', isDrill: true });
    expect(text.startsWith('DRILL — THIS IS A DRILL\n\nHOLD DRILL')).toBe(true);
    expect(text).toContain('This is not a real emergency.');
  });
  it("the operator's text wins, then the scope note; EVACUATE is labelled FIRE — EVACUATE", () => {
    expect(systemEmergencyBoardText({ type: 'LOCKDOWN', isDrill: false, textBlob: 'Stay put' })).toBe('Stay put');
    expect(systemEmergencyBoardText({ type: 'LOCKDOWN', isDrill: true, textBlob: 'Stay put' })).toBe('DRILL — THIS IS A DRILL\n\nStay put');
    expect(systemEmergencyBoardText({ type: 'EVACUATE', isDrill: false, scopeNote: 'North wing' }))
      .toBe('FIRE — EVACUATE — North wing\n\nFollow standard procedures.');
  });
  it('an unknown type keeps the generic board', () => {
    expect(systemEmergencyBoardText({ type: 'CUSTOM', isDrill: false })).toContain('CUSTOM PROTOCOL ACTIVE');
  });
  it('colour: drill indigo, CRITICAL/HIGH red, anything else amber', () => {
    expect(systemEmergencyBoardColor('CRITICAL', true)).toBe('#3730a3');
    expect(systemEmergencyBoardColor('CRITICAL', false)).toBe('#dc2626');
    expect(systemEmergencyBoardColor('HIGH', false)).toBe('#dc2626');
    expect(systemEmergencyBoardColor('MEDIUM', false)).toBe('#d97706');
    expect(systemEmergencyBoardColor(null, false)).toBe('#d97706');
  });
});

/**
 * The life-safety standard for the standard alert wording, made mechanical.
 * Every line of these is read off a wall during an emergency.
 */
const LOCALES: EmergencyWordingLocale[] = ['en', 'es', 'zh'];

// Claims VenueOS cannot back up: it only puts the alert on the screens.
const FALSE_CLAIMS: Record<EmergencyWordingLocale, RegExp> = {
  en: /police|notified|on (its|the|their) way|help is coming|doors are locked|dispatched|authorities|responders|911/i,
  es: /polic[ií]a|notificad|en camino|ayuda llega|puertas est[aá]n cerradas|autoridades|911/i,
  zh: /警察|已通知|正在赶来|已锁|当局|911/,
};
const DRILL_WORDS = /drill|practice|simulacro|práctica|演练|演习|练习/i;

describe('standard emergency wording', () => {
  it('covers every alert type in every language', () => {
    for (const locale of LOCALES) {
      for (const kind of EMERGENCY_WORDING_KINDS) {
        const w = EMERGENCY_STANDARD_WORDING[locale][kind];
        expect(w.headline.trim()).not.toBe('');
        expect(w.lines.length).toBeGreaterThanOrEqual(1);
        expect(w.lines.length).toBeLessThanOrEqual(2);
        for (const line of w.lines) expect(line.trim()).not.toBe('');
      }
    }
  });

  it('never claims something VenueOS does not do', () => {
    for (const locale of LOCALES) {
      for (const kind of EMERGENCY_WORDING_KINDS) {
        const w = EMERGENCY_STANDARD_WORDING[locale][kind];
        for (const text of [w.headline, ...w.lines]) expect(text).not.toMatch(FALSE_CLAIMS[locale]);
      }
    }
  });

  it('never says "drill" — a live alert is not a drill', () => {
    for (const locale of LOCALES) {
      for (const kind of EMERGENCY_WORDING_KINDS) {
        const w = EMERGENCY_STANDARD_WORDING[locale][kind];
        for (const text of [w.headline, ...w.lines]) expect(text).not.toMatch(DRILL_WORDS);
      }
    }
  });

  it('stays short enough to read from across a room (English, as shown on screens)', () => {
    for (const kind of EMERGENCY_WORDING_KINDS) {
      const w = EMERGENCY_STANDARD_WORDING.en[kind];
      expect(w.headline.length).toBeLessThanOrEqual(20);
      expect(w.headline).toBe(w.headline.toUpperCase());
      for (const line of w.lines) expect(line.length).toBeLessThanOrEqual(48);
    }
  });

  it('keeps the SRP lockdown words exactly', () => {
    expect(EMERGENCY_STANDARD_WORDING.en.lockdown.lines[0]).toBe('Locks, lights, out of sight.');
  });

  it('builds the board text as headline, blank line, action lines', () => {
    expect(standardEmergencyText('hold')).toBe('HOLD\n\nStay in your room or area.\nKeep the halls clear.');
    expect(standardEmergencyText('evacuate', 'es')).toBe('EVACUAR\n\nSalga del edificio ahora.\nVaya a su punto de reunión.');
  });

  it('maps an incident type to its wording, and nothing else', () => {
    expect(emergencyWordingKind('LOCKDOWN')).toBe('lockdown');
    expect(emergencyWordingKind('evacuate')).toBe('evacuate');
    expect(emergencyWordingKind('CRITICAL')).toBeNull(); // a severity, not a type
    expect(emergencyWordingKind('EMERGENCY')).toBeNull();
    expect(emergencyWordingKind(null)).toBeNull();
  });
});
