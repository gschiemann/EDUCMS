/**
 * `/.well-known/security.txt` (RFC 9116) — the machine-readable twin of
 * /security. Scanners and researchers read this file, not the page, so a
 * malformed or EXPIRED file is a real gap, not a cosmetic one.
 *
 * ⚠️ The Expires check is deliberately date-sensitive: 30 days BEFORE the file
 * expires this test turns red on every branch, so it is renewed while the live
 * file is still valid. That is the renewal reminder. Renew by moving `Expires:`
 * to (at most) one year ahead.
 */
import fs from 'fs';
import path from 'path';
import { LEGAL_CONTACTS } from '@/lib/legal-entity';
import { GITHUB_PRIVATE_REPORT_URL, SECURITY_TXT_PATH } from '../SecurityPolicy';

const WEB_ROOT = path.resolve(__dirname, '../../../..');
const FILE = path.join(WEB_ROOT, 'public', SECURITY_TXT_PATH);
const RAW = fs.readFileSync(FILE, 'utf8');

/** RFC 9116 §2.5 field names (plus CSAF from the IANA registry). */
const KNOWN_FIELDS = ['Acknowledgments', 'Canonical', 'Contact', 'Encryption', 'Expires', 'Hiring', 'Policy', 'Preferred-Languages', 'CSAF'];

const fields: Array<[string, string]> = RAW.split(/\r?\n/)
  .filter((l) => l.trim() !== '' && !l.startsWith('#'))
  .map((l) => {
    const m = /^([A-Za-z-]+): (.+)$/.exec(l);
    if (!m) throw new Error(`security.txt line is not "Field: value": ${JSON.stringify(l)}`);
    return [m[1], m[2].trim()];
  });
const all = (name: string) => fields.filter(([k]) => k.toLowerCase() === name.toLowerCase()).map(([, v]) => v);

describe('/.well-known/security.txt (RFC 9116)', () => {
  it('is plain UTF-8 text with no BOM and a final newline', () => {
    expect(RAW.charCodeAt(0)).not.toBe(0xfeff);
    expect(RAW.endsWith('\n')).toBe(true);
  });

  it('uses only registered field names', () => {
    for (const [k] of fields) expect(KNOWN_FIELDS).toContain(k);
  });

  it('names the security mailbox first, then GitHub private reporting', () => {
    const contacts = all('Contact');
    expect(contacts[0]).toBe(`mailto:${LEGAL_CONTACTS.security}`);
    expect(contacts[0]).toBe('mailto:security@venue-os.app');
    expect(contacts).toContain(GITHUB_PRIVATE_REPORT_URL);
  });

  it('has exactly one Expires, a full UTC timestamp, at least 30 days and at most a year out', () => {
    const expires = all('Expires');
    expect(expires).toHaveLength(1);
    expect(expires[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
    const at = Date.parse(expires[0]);
    const now = Date.now();
    // Fewer than 30 days left → renew it (move Expires up to one year ahead). Do not delete this check.
    expect(at - now).toBeGreaterThan(30 * 24 * 60 * 60 * 1000);
    expect(at - now).toBeLessThanOrEqual(366 * 24 * 60 * 60 * 1000);
  });

  it('prefers English, and points Policy and Canonical at the web origin', () => {
    expect(all('Preferred-Languages')).toEqual(['en']);
    expect(all('Canonical')).toEqual([`https://venue-os.app${SECURITY_TXT_PATH}`]);
    expect(all('Policy')).toEqual(['https://venue-os.app/security']);
  });

  it('links only https web addresses', () => {
    for (const [k, v] of fields) {
      if (k === 'Expires' || k === 'Preferred-Languages') continue;
      if (v.startsWith('mailto:')) continue;
      expect(v).toMatch(/^https:\/\//);
    }
  });

  it('points Policy at a page that exists in this app', () => {
    const policyPath = new URL(all('Policy')[0]).pathname;
    expect(fs.existsSync(path.join(WEB_ROOT, 'src', 'app', policyPath, 'page.tsx'))).toBe(true);
  });
});
