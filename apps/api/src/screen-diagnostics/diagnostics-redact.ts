/**
 * Server-side redaction of an on-demand log bundle (2026-11-08).
 *
 * The device already redacts (`LogRedaction.kt`); this is the second pass,
 * because the bundle is stored and handed to a person, and a device running
 * an older or a tampered redactor must not be able to land a credential in
 * the private bucket. It reuses the audit redactor (`player-logs-redact.ts`:
 * JWTs, `Bearer …`, URL query strings and userinfo, secret pairs, opaque
 * runs) and adds what an Android log carries that an audit line does not:
 *
 *   - e-mail addresses                                  → [email]
 *   - Wi-Fi credentials (`psk=`, `wpa…`, `passphrase`,
 *     `preSharedKey`, `wifi … password`)                → …=[redacted]
 *   - an SSID in quotes after `SSID`                    → SSID: [redacted]
 *
 * Line by line, each line held to 4 KB first, so the regexes only ever see a
 * bounded string (linear-time by construction — see player-logs-redact.ts).
 */
import { redactDiagnosticText } from '../player-logs/player-logs-redact';

const MAX_LINE = 4096;
const EMAIL = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,24}/g;
const WIFI_SECRET =
  /\b(psk|wpa[-_]?psk|wpa2?|passphrase|pre[-_]?shared[-_]?key|sae[-_]?password|wep[-_]?key\d?)(\s{0,3}["']?\s{0,3}[:=]\s{0,3}["']?)(?!\[redacted\])[^\s"',;)}\]]+/gi;
const SSID = /\b(b?ssid)(\s{0,3}[:=]\s{0,3})("[^"\n]{0,64}"|[^\s,;)}\]]+)/gi;

export function redactLogLine(line: string): string {
  const bounded = line.length > MAX_LINE ? line.slice(0, MAX_LINE) + ' [line truncated]' : line;
  return redactDiagnosticText(bounded)
    .replace(EMAIL, '[email]')
    .replace(WIFI_SECRET, '$1$2[redacted]')
    .replace(SSID, '$1$2[redacted]');
}

export function redactLogText(text: string): string {
  return text.split('\n').map(redactLogLine).join('\n');
}
