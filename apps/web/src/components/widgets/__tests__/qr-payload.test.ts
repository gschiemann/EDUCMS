/**
 * The payload is the whole product here. A QR code that SCANS but carries a
 * malformed payload looks correct in the builder AND on the wall, and only
 * fails in the guest's hand — so the escaping rules get real tests.
 */
import {
  buildQrPayload,
  defaultQrCaption,
  escapeWifiValue,
  normalizeUrl,
} from '../qr-payload';

describe('normalizeUrl', () => {
  it('prefixes a bare domain — a phone treats "venue-os.app" as a search', () => {
    expect(normalizeUrl('venue-os.app')).toBe('https://venue-os.app');
    expect(normalizeUrl('  venue-os.app/menu  ')).toBe('https://venue-os.app/menu');
  });
  it('leaves an explicit scheme alone, including non-web ones', () => {
    expect(normalizeUrl('http://x.test')).toBe('http://x.test');
    expect(normalizeUrl('https://x.test')).toBe('https://x.test');
    expect(normalizeUrl('mailto:a@b.test')).toBe('mailto:a@b.test');
    expect(normalizeUrl('//cdn.x.test/a')).toBe('//cdn.x.test/a');
  });
  it('is empty for empty input rather than producing "https://"', () => {
    expect(normalizeUrl('   ')).toBe('');
  });
});

describe('WIFI payload', () => {
  it('escapes the five structural characters', () => {
    // Without this, a password containing ';' silently terminates the field and
    // the rest of the password becomes a new key — the network never joins.
    expect(escapeWifiValue('a;b,c:d\\e"f')).toBe('a\\;b\\,c\\:d\\\\e\\"f');
  });

  it('builds a WPA payload with the password escaped', () => {
    expect(buildQrPayload({ mode: 'wifi', ssid: 'Guest', password: 'p;ss', encryption: 'WPA' }))
      .toBe('WIFI:T:WPA;S:Guest;P:p\\;ss;;');
  });

  it('omits P: entirely on an open network', () => {
    // An empty `P:` makes some Android builds prompt for a password on a
    // network that has none.
    expect(buildQrPayload({ mode: 'wifi', ssid: 'Lobby', encryption: 'nopass', password: 'ignored' }))
      .toBe('WIFI:T:nopass;S:Lobby;;');
  });

  it('carries H:true only for a hidden network', () => {
    expect(buildQrPayload({ mode: 'wifi', ssid: 'S', password: 'p', hidden: true }))
      .toContain(';H:true;');
    expect(buildQrPayload({ mode: 'wifi', ssid: 'S', password: 'p' })).not.toContain('H:true');
  });

  it('is empty with no SSID — no code at all beats a code that joins nothing', () => {
    expect(buildQrPayload({ mode: 'wifi', password: 'p' })).toBe('');
  });

  it('never prints the password as the default caption', () => {
    expect(defaultQrCaption({ mode: 'wifi', ssid: 'Guest', password: 'hunter2' })).toBe('Guest');
  });
});

describe('tel / sms / email', () => {
  it('strips formatting from a phone number but keeps + and dial control chars', () => {
    expect(buildQrPayload({ mode: 'tel', value: '+1 (555) 010-4477' })).toBe('tel:+15550104477');
  });
  it('builds SMSTO with and without a body', () => {
    expect(buildQrPayload({ mode: 'sms', value: '5550104477' })).toBe('SMSTO:5550104477');
    expect(buildQrPayload({ mode: 'sms', value: '5550104477', body: 'JOIN' })).toBe('SMSTO:5550104477:JOIN');
  });
  it('percent-encodes an email subject and body', () => {
    expect(buildQrPayload({ mode: 'email', value: 'front@desk.test', subject: 'Room 12 & 13' }))
      .toBe('mailto:front@desk.test?subject=Room%2012%20%26%2013');
  });
  it('is empty when the address or number is missing', () => {
    expect(buildQrPayload({ mode: 'tel', value: '' })).toBe('');
    expect(buildQrPayload({ mode: 'email', value: '  ' })).toBe('');
  });
});

describe('contact (MECARD)', () => {
  it('escapes structural characters and skips empty fields', () => {
    expect(buildQrPayload({ mode: 'contact', contactName: 'Doe;Jane', contactPhone: '(555) 010-4477' }))
      .toBe('MECARD:N:Doe\\;Jane;TEL:5550104477;;');
  });
  it('normalises a bare domain in the contact URL', () => {
    expect(buildQrPayload({ mode: 'contact', contactName: 'A', contactUrl: 'venue-os.app' }))
      .toContain('URL:https\\://venue-os.app');
  });
  it('is empty with nothing identifying', () => {
    expect(buildQrPayload({ mode: 'contact', contactOrg: 'Org only' })).toBe('');
  });
});

describe('url / text', () => {
  it('defaults to url mode', () => {
    expect(buildQrPayload({ value: 'venue-os.app' })).toBe('https://venue-os.app');
  });
  it('passes text through verbatim — it is not a URL', () => {
    expect(buildQrPayload({ mode: 'text', value: 'Ask at the front desk' })).toBe('Ask at the front desk');
  });
  it('captions a URL with its host, not the tracking-laden path', () => {
    expect(defaultQrCaption({ mode: 'url', value: 'https://www.venue-os.app/menu?utm_source=wall' }))
      .toBe('venue-os.app');
  });
  it('gives an unparseable URL back rather than throwing', () => {
    expect(defaultQrCaption({ mode: 'url', value: 'h ttp://%%%' })).toBeTruthy();
  });
});
