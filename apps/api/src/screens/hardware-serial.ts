/**
 * THE PANEL'S HARDWARE SERIAL NUMBER (2026-11-16).
 *
 * The Android Player reads the serial on a best-effort basis
 * (`apps/player/app/.../diagnostics/HardwareSerial.kt`: device-owner
 * `Build.getSerial()`, `Build.SERIAL` below Android 8, `Build.getSerial()`
 * with READ_PHONE_STATE on 8–9, then `SystemProperties` keys) and carries the
 * result on its DEVICE-AUTHENTICATED native heartbeat in its own header:
 *
 *   x-venueos-hardware-serial: {"v":1,"s":"<serial>","src":"prop:ro.serialno"}
 *   x-venueos-hardware-serial: {"v":1,"src":"none"}        (nothing readable)
 *
 * Rules (each one is tested in hardware-serial.spec.ts):
 *   • Only from a paired screen whose caller proved the device credential —
 *     the caller (`ScreensController.deviceStatus`) gates that; never from the
 *     URL, never from an anonymous poll.
 *   • The serial is trimmed, printable ASCII (0x20–0x7E), 1–64 characters, and
 *     not a known placeholder ("unknown", "0123456789ABCDEF", one repeated
 *     character…). Anything else is treated as "no serial".
 *   • Written ONLY when it changed; a report without a serial NEVER clears a
 *     stored one (a ROM update that starts blocking the read must not erase a
 *     serial we already proved). `none` is recorded only while no serial is
 *     stored, so the dashboard can say "this screen does not expose it"
 *     instead of "not reported yet".
 *   • TELEMETRY ONLY: both columns are in `SCREEN_TELEMETRY_ONLY_FIELDS`, no
 *     manifest branch reads them. Never throws — a malformed header is ignored.
 */
export const HARDWARE_SERIAL_HEADER = 'x-venueos-hardware-serial';

export const HARDWARE_SERIAL_MAX = 64;
const HEADER_MAX = 256;
const SOURCE_RE = /^(device-owner|build-serial|get-serial|none|prop:[a-z0-9._-]{1,40})$/;

/** Values Android or an OEM build hands out when there is no real serial. */
const PLACEHOLDERS = new Set([
  'unknown', 'null', 'none', 'n/a', 'na', 'undefined', 'default', 'serial', 'serialno',
  '0123456789abcdef', '0123456789', '1234567890', '1234567890abcdef', 'abcdef0123456789',
]);

export function isPlaceholderSerial(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (!v) return true;
  if (PLACEHOLDERS.has(v)) return true;
  // One character repeated ("0000000000000000", "ffffffff", "????").
  if (/^(.)\1*$/.test(v)) return true;
  return false;
}

/** The serial as stored, or null when it is not a usable one. */
export function normalizeHardwareSerial(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  if (v.length === 0 || v.length > HARDWARE_SERIAL_MAX) return null;
  if (!/^[\x20-\x7e]+$/.test(v)) return null;
  if (isPlaceholderSerial(v)) return null;
  return v;
}

export interface HardwareSerialReport {
  serial: string | null;
  source: string;
}

/** The header, parsed; null when absent, too long or malformed in any way. */
export function parseHardwareSerialHeader(value: unknown): HardwareSerialReport | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > HEADER_MAX) return null;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.v !== 1) return null;
    const source = typeof parsed.src === 'string' ? parsed.src : '';
    if (!SOURCE_RE.test(source)) return null;
    const serial = normalizeHardwareSerial(parsed.s);
    if (source === 'none') return { serial: null, source };
    // A named source with an unusable value is the same as "nothing readable".
    return serial ? { serial, source } : { serial: null, source: 'none' };
  } catch {
    return null;
  }
}

/**
 * The `screen.update` data for this report: `{}` when nothing changes, so an
 * idle heartbeat writes no new key.
 */
export function hardwareSerialWrite(
  current: { hardwareSerial?: string | null; hardwareSerialSource?: string | null },
  report: HardwareSerialReport | null,
): { hardwareSerial?: string; hardwareSerialSource?: string } {
  if (!report) return {};
  const storedSerial = current.hardwareSerial ?? null;
  const storedSource = current.hardwareSerialSource ?? null;
  if (report.serial) {
    if (report.serial === storedSerial && report.source === storedSource) return {};
    return { hardwareSerial: report.serial, hardwareSerialSource: report.source };
  }
  // No serial in this report: never clear one we have.
  if (storedSerial) return {};
  if (storedSource === 'none') return {};
  return { hardwareSerialSource: 'none' };
}
