import { websitePreviewUrl } from '../website-preview';

/**
 * The URL every website thumbnail asks a THIRD PARTY (WordPress mshots) to
 * photograph. Two jobs: say exactly what the library has always asked (so
 * screenshots that are already warm stay warm), and refuse the URLs that must
 * never leave the building.
 */

// What every call site built by hand before there was a shared function.
const inlineKey = (stored: string) => `https://s.wordpress.com/mshots/v1/${encodeURIComponent(stored)}?w=640&h=360`;

describe('the screenshot URL for a public website', () => {
  it.each([
    'https://www.example.test', // a bare origin: NO trailing slash added
    'http://www.example.test',
    'https://example.test/homes?a=1&b=2',
    'https://example.test/#/menu', // a hash-routed page: the fragment is part of what is photographed
    'https://example.test:8443/path',
    'https://sub.example.co.uk/a%20b',
    'https://203.0.113.5/menu', // a public IP address is a public site
    'https://Example.TEST/Case', // the stored string, not a re-cased copy
  ])('is exactly what the library already asked for: %s', (stored) => {
    // mshots caches by the exact string. A normalised key (trailing slash,
    // dropped fragment) would make every website that is warm in the Media
    // Library start cold on every other surface.
    expect(websitePreviewUrl(stored)).toBe(inlineKey(stored));
  });

  it('trims surrounding whitespace and nothing else', () => {
    expect(websitePreviewUrl('  https://example.test/x  ')).toBe(inlineKey('https://example.test/x'));
  });

  it('keeps the 640x360 request the service was always sent', () => {
    expect(websitePreviewUrl('https://example.test')).toMatch(/\?w=640&h=360$/);
  });
});

describe('what is never sent', () => {
  it.each([
    ['javascript:', 'javascript:alert(1)'],
    ['data:', 'data:text/html,<h1>x</h1>'],
    ['file:', 'file:///etc/passwd'],
    ['ftp:', 'ftp://example.test/readme'],
    ['blob:', 'blob:https://example.test/1234'],
    ['mailto:', 'mailto:someone@example.test'],
    ['a relative path', '/relative/page'],
    ['a protocol-relative URL', '//example.test/x'],
    ['a scheme-less host', 'example.test'],
    ['plain text', 'not a url'],
    ['an empty string', ''],
    ['whitespace', '   '],
  ])('refuses %s', (_label, value) => {
    expect(websitePreviewUrl(value)).toBeNull();
  });

  it('refuses a missing value', () => {
    expect(websitePreviewUrl(null)).toBeNull();
    expect(websitePreviewUrl(undefined)).toBeNull();
    expect(websitePreviewUrl(42 as unknown as string)).toBeNull();
  });

  it.each([
    'https://user:secret@example.test/',
    'https://user@example.test/', // a username alone is still a credential
    'https://:secret@example.test/',
    'http://admin:admin@example.test/cam',
  ])('refuses a URL carrying credentials: %s', (value) => {
    expect(websitePreviewUrl(value)).toBeNull();
  });

  it('refuses a control character smuggled into the string', () => {
    // The URL parser strips tabs/newlines, so the host looks fine — but the
    // string that would be sent is not the string that was checked.
    expect(websitePreviewUrl('https://exa\nmple.test/')).toBeNull();
    expect(websitePreviewUrl('https://example.test/\tx')).toBeNull();
  });
});

describe('private-network hosts are never sent — the operator gets the globe tile instead', () => {
  it.each([
    // localhost, every spelling
    'http://localhost',
    'http://localhost:3000/dashboard',
    'http://LOCALHOST/',
    'http://localhost./', // trailing dot
    'http://app.localhost/',
    // IPv4 loopback + the forms the URL parser canonicalises to it
    'http://127.0.0.1/',
    'http://127.0.0.1:8080/',
    'http://127.255.255.254/',
    'http://127.1/',
    'http://2130706433/', // decimal 127.0.0.1
    'http://0x7f.0.0.1/', // hex
    'http://0177.0.0.1/', // octal
    // this-network / unspecified
    'http://0.0.0.0/',
    // RFC 1918
    'http://10.0.0.1/',
    'http://10.255.255.255/',
    'http://172.16.0.1/',
    'http://172.20.5.5/',
    'http://172.31.255.255/',
    'http://192.168.0.1/',
    'http://192.168.1.50:8080/signage',
    // link-local (the cloud metadata address) + CGNAT
    'http://169.254.169.254/latest/meta-data/',
    'http://100.64.0.1/',
    'http://100.127.255.255/',
    // multicast / reserved
    'http://224.0.0.1/',
    'http://255.255.255.255/',
    // IPv6 literals (loopback, unique-local, link-local, IPv4-mapped)
    'http://[::1]/',
    'http://[fc00::1]/',
    'http://[fd12:3456::1]/',
    'http://[fe80::1]/',
    'http://[::ffff:127.0.0.1]/',
    // names that only exist inside a network
    'http://printer.local/',
    'https://nas.office.local/',
    'https://wiki.internal/',
    'https://grafana.corp.internal/dash',
    'http://router.lan/',
    'http://files.localdomain/',
    'http://thing.home.arpa/',
    'http://portal.intranet/',
    // single-label hostnames
    'http://intranet/',
    'http://printer/',
    'https://nas:5001/',
  ])('refuses %s', (value) => {
    expect(websitePreviewUrl(value)).toBeNull();
  });

  it.each([
    // The 172.16/12 and 100.64/10 blocks have edges; just outside them is public.
    'http://172.15.255.255/',
    'http://172.32.0.1/',
    'http://100.63.255.255/',
    'http://100.128.0.1/',
    'http://169.253.1.1/',
    'http://192.167.1.1/',
    'http://11.0.0.1/',
    // A real DNS name that merely CONTAINS a private-looking label.
    'https://localhost.example.test/',
    'https://local.example.test/',
    'https://internal-tools.example.test/',
    'https://my.homes.example.test/',
    'https://lanyard.example.test/',
  ])('still sends %s — it is a public address', (value) => {
    expect(websitePreviewUrl(value)).toBe(inlineKey(value));
  });
});
