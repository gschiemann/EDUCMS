/**
 * The ONE place a website asset's screenshot URL is built.
 *
 * The screenshot comes from WordPress's free mshots service (the same one the
 * Media Library has always used): the browser asks THEM for a picture of the
 * operator's URL, so the URL itself leaves our infrastructure. That is the
 * reason this is a function and not a template string pasted at every call
 * site — each caller used to build the URL by hand, and a hand-built URL
 * has no way to refuse anything.
 *
 * What is never sent (the caller gets `null` and draws its globe/icon tile):
 *   - anything that is not an absolute http(s) URL — `javascript:`, `data:`,
 *     `file:`, `ftp:`, relative paths, scheme-less text;
 *   - a URL that carries a username or password (`https://user:secret@host`):
 *     a credential must never be handed to a third party;
 *   - a host that only exists inside someone's own network — `localhost`,
 *     loopback, RFC 1918 ranges, link-local (`169.254.x.x`, the cloud
 *     metadata address), CGNAT, `*.local`, `*.internal`, single-label names
 *     (`http://intranet/`). A third-party service cannot reach those anyway;
 *     all that would happen is the operator's internal hostname being
 *     disclosed.
 *
 * What it cannot catch, honestly: a PUBLIC hostname that merely RESOLVES to a
 * private address (e.g. `127.0.0.1.nip.io`). A browser has no DNS to ask.
 *
 * THE KEY IS THE STORED STRING, UNTOUCHED. `new URL(x).toString()` would add a
 * trailing slash to a bare origin and drop a fragment, and mshots caches by
 * the exact URL it is given — so a normalised key would make every website
 * that is already warm in the Media Library start cold again on every other
 * surface (and the first hit on a cold key is the "warming" placeholder).
 * The URL is parsed to be CHECKED, never to be rewritten.
 */

const SCREENSHOT_ENDPOINT = 'https://s.wordpress.com/mshots/v1/';

/** Names that only ever mean "inside a private network" — never a public site. */
const PRIVATE_SUFFIXES = [
  'localhost', 'local', 'localdomain', 'internal', 'intranet', 'lan', 'home.arpa', 'corp', 'home',
];

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** True when an IPv4 address is not a globally routable unicast address. */
function isNonPublicIpv4([a, b]: number[]): boolean {
  return (
    a === 0 || // "this network"
    a === 10 || // RFC 1918
    (a === 100 && b >= 64 && b <= 127) || // CGNAT (carrier / Tailscale)
    a === 127 || // loopback
    (a === 169 && b === 254) || // link-local, incl. the cloud metadata address
    (a === 172 && b >= 16 && b <= 31) || // RFC 1918
    (a === 192 && b === 168) || // RFC 1918
    a >= 224 // multicast + reserved
  );
}

/**
 * `hostname` is what the WHATWG URL parser produced, so numeric forms are
 * already canonical: `http://2130706433/`, `http://0x7f.1/` and
 * `http://127.1/` all arrive here as `127.0.0.1`.
 */
function isNonPublicHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.+$/, ''); // "localhost." is localhost
  if (!host) return true;
  // An IPv6 literal. A public website is reached by NAME; refusing every
  // literal also covers ::1, fc00::/7, fe80::/10 and IPv4-mapped forms
  // (::ffff:127.0.0.1) without a hand-rolled IPv6 parser to get wrong.
  if (host.startsWith('[')) return true;
  const v4 = IPV4.exec(host);
  if (v4) return isNonPublicIpv4(v4.slice(1, 5).map(Number));
  if (!host.includes('.')) return true; // single-label: an intranet name
  return PRIVATE_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

/**
 * The screenshot URL for a website, or `null` when this URL must not be sent
 * to the screenshot service (see the file header for what that covers).
 */
export function websitePreviewUrl(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  // A control character inside the string is stripped by the URL parser but
  // would travel percent-encoded to the service: a different URL than the one
  // that was checked.
  if (!raw || /[\u0000-\u001f\u007f]/.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password) return null;
  if (isNonPublicHost(url.hostname)) return null;
  return `${SCREENSHOT_ENDPOINT}${encodeURIComponent(raw)}?w=640&h=360`;
}
