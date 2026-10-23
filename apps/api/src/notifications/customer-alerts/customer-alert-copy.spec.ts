/**
 * Customer alert email WORDS (2026-10-23): every event in en / es / zh, the
 * "Manage alert emails" link in every one, and nothing but screen + location
 * names (no person, no address).
 */
import {
  MAX_LISTED,
  alertLocaleOf,
  renderDigestEmail,
  renderEmergencyEmail,
  renderScreenAlertEmail,
  type AlertLocale,
  type ScreenItemKind,
} from './customer-alert-copy';

const links = { screensUrl: 'https://app.test/lincoln/screens', manageUrl: 'https://app.test/lincoln/account#alert-emails' };
const LOCALES: AlertLocale[] = ['en', 'es', 'zh'];
const KINDS: ScreenItemKind[] = ['OFFLINE', 'BACK_ONLINE', 'NO_CONTENT', 'CONTENT_RESTORED'];
const item = (screenName: string, kind: ScreenItemKind, minutes = 17) => ({ kind, screenName, locationName: 'Lincoln Elementary', minutes });

describe('screen alert emails', () => {
  it('subjects (en) match the agreed shape', () => {
    const three = ['Lobby TV', 'Gym Board', 'Office'];
    expect(renderScreenAlertEmail('en', { kind: 'OFFLINE', locationName: 'Lincoln Elementary', items: three.map((n) => item(n, 'OFFLINE')) }, links).subject).toBe(
      'VenueOS: 3 screens offline at Lincoln Elementary',
    );
    expect(renderScreenAlertEmail('en', { kind: 'OFFLINE', locationName: 'Lincoln Elementary', items: [item('Lobby TV', 'OFFLINE')] }, links).subject).toBe(
      'VenueOS: Lobby TV is offline at Lincoln Elementary',
    );
  });

  it('every kind × every language: a subject, the screen, the manage link, the screens link, a signature', () => {
    for (const l of LOCALES)
      for (const k of KINDS) {
        const e = renderScreenAlertEmail(l, { kind: k, locationName: 'Lincoln Elementary', items: [item('Lobby TV', k)] }, links);
        expect(e.subject).toMatch(/^VenueOS[:：]/);
        expect(e.subject).toContain('Lobby TV');
        expect(e.body).toContain('Lobby TV');
        expect(e.body).toContain(links.manageUrl);
        expect(e.body).toContain(links.screensUrl);
        expect(e.body).toMatch(/VenueOS/);
      }
  });

  it('a site-wide drop says so', () => {
    const e = renderScreenAlertEmail('en', { kind: 'OFFLINE', locationName: 'X', items: [item('a', 'OFFLINE'), item('b', 'OFFLINE')], siteWide: true }, links);
    expect(e.body).toContain('internet or power at the site');
  });

  it('lists at most 20 screens by name, then counts', () => {
    const items = Array.from({ length: MAX_LISTED + 5 }, (_, i) => item(`S${i}`, 'OFFLINE'));
    const e = renderScreenAlertEmail('en', { kind: 'OFFLINE', locationName: 'X', items }, links);
    expect(e.body).toContain('…and 5 more');
    expect(e.body).not.toContain(`S${MAX_LISTED + 1}`);
  });

  it('the language falls back to English', () => {
    expect(alertLocaleOf('fr')).toBe('en');
    expect(alertLocaleOf(null)).toBe('en');
    expect(alertLocaleOf('zh')).toBe('zh');
  });
});

describe('digest + emergency', () => {
  it('digest in every language', () => {
    for (const l of LOCALES) {
      const e = renderDigestEmail(l, { orgName: 'Springfield', items: [item('a', 'OFFLINE'), item('b', 'BACK_ONLINE')] }, links);
      expect(e.subject).toContain('Springfield');
      expect(e.body).toContain(links.manageUrl);
    }
  });

  it('emergency: trigger, drill, all-clear, multi-location — in every language, no person named', () => {
    const at = new Date('2026-10-23T15:42:00Z');
    const e = renderEmergencyEmail('en', { event: 'TRIGGERED', alertType: 'LOCKDOWN', isDrill: false, locationNames: ['Lincoln Elementary'], screenCount: 12, at }, { emergencyUrl: 'u', manageUrl: 'm' });
    expect(e.subject).toBe('VenueOS: Lockdown alert sent to Lincoln Elementary');
    expect(e.body).toContain('Time: 2026-10-23 15:42 UTC');
    const d = renderEmergencyEmail('en', { event: 'TRIGGERED', alertType: 'EVACUATE', isDrill: true, locationNames: ['District', 'A', 'B'], at }, { emergencyUrl: 'u', manageUrl: 'm' });
    expect(d.subject).toBe('VenueOS: Evacuate drill started at District and 2 other locations');
    const c = renderEmergencyEmail('en', { event: 'CLEARED', isDrill: false, locationNames: ['Lincoln Elementary'], at }, { emergencyUrl: 'u', manageUrl: 'm' });
    expect(c.subject).toBe('VenueOS: All clear sent to Lincoln Elementary');
    for (const l of LOCALES) {
      const x = renderEmergencyEmail(l, { event: 'TRIGGERED', alertType: 'WEATHER', isDrill: false, locationNames: ['L'], at }, { emergencyUrl: 'u', manageUrl: 'm' });
      expect(x.body).toContain('m');
      expect(x.subject).toMatch(/^VenueOS[:：]/);
    }
  });
});
