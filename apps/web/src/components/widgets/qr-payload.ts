/**
 * qr-payload — turn operator fields into the exact string a phone camera
 * knows how to act on.
 *
 * Kept separate from the widget, and pure, because this is where the
 * correctness actually lives. A QR code that SCANS but whose payload is
 * malformed is worse than no code at all: it looks like it works, in the
 * builder and on the wall, and only fails in the guest's hand. The escaping
 * rules below are the fiddly part and they are unit-tested.
 *
 * Formats follow the conventions iOS Camera and Android both honour:
 *   WIFI — the Wi-Fi Network config format Android defined and iOS 11+ adopted.
 *          `;` `,` `:` `\` and `"` MUST be backslash-escaped inside a value or
 *          a password containing a semicolon silently joins the next field.
 *   MECARD — used for contacts rather than vCard: it is dramatically denser, so
 *          the code stays readable from across a lobby at the same module size.
 *   SMS / TEL / MAILTO — RFC-shaped URIs.
 */

export type QrMode = 'url' | 'text' | 'wifi' | 'tel' | 'sms' | 'email' | 'contact';

export interface QrPayloadConfig {
  mode?: QrMode;
  /** url · text · tel · sms(number) · email(address) */
  value?: string;
  /** sms body / email body */
  body?: string;
  /** email subject */
  subject?: string;
  /** wifi */
  ssid?: string;
  password?: string;
  encryption?: 'WPA' | 'WEP' | 'nopass';
  hidden?: boolean;
  /** contact (MECARD) */
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  contactOrg?: string;
  contactUrl?: string;
}

/** Escape the five characters that are structural in a WIFI: payload. */
export function escapeWifiValue(v: string): string {
  return v.replace(/([\\;,:"])/g, '\\$1');
}

/** MECARD uses the same structural characters, minus the quote. */
function escapeMecardValue(v: string): string {
  return v.replace(/([\\;,:])/g, '\\$1');
}

const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/**
 * A bare domain typed by an operator ("venue-os.app") is not a URL to a phone —
 * it opens a search. Prefix it. Anything already carrying a scheme, a protocol-
 * relative prefix, or a non-web scheme (mailto:, tel:) is left exactly alone.
 */
export function normalizeUrl(raw: string): string {
  const v = s(raw);
  if (!v) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(v) || v.startsWith('//')) return v;
  return `https://${v}`;
}

/**
 * Build the payload. Returns '' when the operator has not given us enough to
 * make a code that would DO anything — the widget shows its empty state rather
 * than rendering a scannable code that leads nowhere.
 */
export function buildQrPayload(cfg: QrPayloadConfig): string {
  const mode: QrMode = cfg.mode || 'url';

  if (mode === 'wifi') {
    const ssid = s(cfg.ssid);
    if (!ssid) return '';
    const enc = cfg.encryption || 'WPA';
    const pass = s(cfg.password);
    // `nopass` carries no P: field at all — an empty P: makes some Android
    // builds prompt for a password on an open network.
    const parts = [`T:${enc === 'nopass' ? 'nopass' : enc}`, `S:${escapeWifiValue(ssid)}`];
    if (enc !== 'nopass' && pass) parts.push(`P:${escapeWifiValue(pass)}`);
    if (cfg.hidden) parts.push('H:true');
    return `WIFI:${parts.join(';')};;`;
  }

  if (mode === 'tel') {
    const n = s(cfg.value).replace(/[^\d+#*,;]/g, '');
    return n ? `tel:${n}` : '';
  }

  if (mode === 'sms') {
    const n = s(cfg.value).replace(/[^\d+#*]/g, '');
    if (!n) return '';
    const body = s(cfg.body);
    return body ? `SMSTO:${n}:${body}` : `SMSTO:${n}`;
  }

  if (mode === 'email') {
    const addr = s(cfg.value);
    if (!addr) return '';
    const q: string[] = [];
    if (s(cfg.subject)) q.push(`subject=${encodeURIComponent(s(cfg.subject))}`);
    if (s(cfg.body)) q.push(`body=${encodeURIComponent(s(cfg.body))}`);
    return `mailto:${addr}${q.length ? `?${q.join('&')}` : ''}`;
  }

  if (mode === 'contact') {
    const name = s(cfg.contactName);
    const tel = s(cfg.contactPhone);
    const email = s(cfg.contactEmail);
    if (!name && !tel && !email) return '';
    const f: string[] = [];
    if (name) f.push(`N:${escapeMecardValue(name)}`);
    if (tel) f.push(`TEL:${tel.replace(/[^\d+]/g, '')}`);
    if (email) f.push(`EMAIL:${escapeMecardValue(email)}`);
    if (s(cfg.contactOrg)) f.push(`ORG:${escapeMecardValue(s(cfg.contactOrg))}`);
    if (s(cfg.contactUrl)) f.push(`URL:${escapeMecardValue(normalizeUrl(s(cfg.contactUrl)))}`);
    return `MECARD:${f.join(';')};;`;
  }

  if (mode === 'text') return s(cfg.value);

  return normalizeUrl(s(cfg.value));
}

/**
 * What the operator sees printed UNDER the code, when they have not written
 * their own caption. Never the raw payload for wifi (it would print the
 * password in 200pt on a lobby wall) and never a mailto/tel scheme prefix.
 */
export function defaultQrCaption(cfg: QrPayloadConfig): string {
  const mode: QrMode = cfg.mode || 'url';
  if (mode === 'wifi') return s(cfg.ssid);
  if (mode === 'tel' || mode === 'sms') return s(cfg.value);
  if (mode === 'email') return s(cfg.value);
  if (mode === 'contact') return s(cfg.contactName);
  if (mode === 'text') return '';
  // Show the host, not the whole tracking-laden URL.
  const u = normalizeUrl(s(cfg.value));
  if (!u) return '';
  try {
    return new URL(u).host.replace(/^www\./, '');
  } catch {
    return u;
  }
}
