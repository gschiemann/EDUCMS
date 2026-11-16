'use client';

/**
 * "Serial number" in a screen's settings → Device details (2026-11-16).
 *
 * The value is the APK's best-effort read (`apps/player/.../diagnostics/
 * HardwareSerial.kt`), carried on the device-authenticated heartbeat and
 * stored on `Screen.hardwareSerial` / `hardwareSerialSource`
 * (`apps/api/src/screens/hardware-serial.ts`). Many panels running Android 10+
 * do not let an app read their serial, so "Not available" is a normal answer;
 * the hint under it says which case it is:
 *   • source `none`  → the player tried and Android would not say;
 *   • no source      → not reported yet (an older player app, or not paired).
 * Facts only: no buttons, no polling. Admin dashboard code — not shipped to the
 * Taurus player, so ordinary Tailwind is fine.
 */

import { useTranslations } from 'next-intl';

export function HardwareSerialRow({
  serial,
  source,
}: {
  serial?: string | null;
  source?: string | null;
}) {
  const t = useTranslations('screens.hardwareSerial');
  const value = typeof serial === 'string' && serial.trim() ? serial.trim() : null;
  const src = typeof source === 'string' ? source : null;

  const sourceLabel = (() => {
    if (!src) return null;
    if (src === 'device-owner') return t('srcDeviceOwner');
    if (src === 'build-serial') return t('srcBuildSerial');
    if (src === 'get-serial') return t('srcGetSerial');
    if (src.startsWith('prop:')) return t('srcProp', { key: src.slice(5) });
    return null;
  })();

  const hint = value
    ? (sourceLabel ? t('source', { source: sourceLabel }) : null)
    : src === 'none'
      ? t('notExposed')
      : t('notReported');

  return (
    <div className="px-3.5 py-2.5 border-t border-slate-100 bg-slate-50/40" data-testid="hardware-serial-row">
      <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-1">{t('label')}</div>
      {value ? (
        <div className="font-mono text-[11px] text-slate-700 break-all leading-tight select-all" data-testid="hardware-serial-value">
          {value}
        </div>
      ) : (
        <div className="text-[11px] text-slate-400 italic" data-testid="hardware-serial-value">
          {t('notAvailable')}
        </div>
      )}
      {hint && (
        <div className="mt-0.5 text-[10px] text-slate-400 leading-snug" data-testid="hardware-serial-hint">
          {hint}
        </div>
      )}
    </div>
  );
}
