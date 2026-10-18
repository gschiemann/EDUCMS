'use client';

/**
 * ScreenDeviceSettings — "Android settings" for one screen (2026-10-18).
 *
 * The everyday Android settings VenueOS can set on the unit itself, without
 * device owner: brightness, volume, screen timeout, rotation lock, automatic
 * date & time, automatic time zone, time server and one Wi-Fi network — plus
 * the unit's heat and load, as facts. Mounted by ScreenDisplayControls under
 * the live display controls; collapsed until opened, so a closed section
 * costs no request.
 *
 * Every rule about what to show lives in ./deviceSettingsView.ts (pure,
 * tested). The two that matter most:
 *   • a control appears only where the unit says it can set the setting;
 *     everywhere else the row says "Not possible on this unit: <reason>";
 *   • "Android reports …" is what the unit READ BACK, never what was sent.
 *
 * A save is stored at once and reaches the screen on its next native
 * heartbeat (≤ 5 min). The row says "waiting for the screen" until the unit
 * acknowledges that exact value — never "done" before it does.
 */

import { useState } from 'react';
import type * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronDown, ChevronRight, Settings2, Thermometer } from 'lucide-react';
import type { DeviceSettingKey, DeviceSettingsPatch, DeviceWifiSecurity } from '@cms/api-types';
import { useDeviceSettings, useUpdateDeviceSettings } from '@/hooks/use-device-settings';
import {
  ATTENTIVE_OPTIONS,
  BRIGHTNESS_OPTIONS,
  TIMEOUT_OPTIONS,
  VOLUME_OPTIONS,
  buildSection,
  formatMemory,
  hasLoadFacts,
  patchFor,
  selectValue,
  thermalLevel,
  timeoutParts,
  type DeviceSettingRow,
} from './deviceSettingsView';

function relative(locale: string, atMs: number, nowMs: number): string {
  const diffSec = Math.round((atMs - nowMs) / 1000);
  const abs = Math.abs(diffSec);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (abs < 60) return rtf.format(diffSec, 'second');
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(diffSec / 3600), 'hour');
  return rtf.format(Math.round(diffSec / 86_400), 'day');
}

// `appearance-none`: WebKit (Safari, iPhone) ignores min-height on a native
// select and draws it ~25 px tall — too small to tap. The chevron is ours.
const SELECT_CLASS =
  'appearance-none w-full min-h-[40px] rounded-lg border border-slate-200 bg-white pl-2 pr-7 text-[12px] text-slate-700 disabled:opacity-50 disabled:cursor-not-allowed';

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative w-full sm:w-auto">
      <select {...props} className={SELECT_CLASS} />
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400"
      />
    </div>
  );
}
const INPUT_CLASS =
  'w-full min-h-[40px] rounded-lg border border-slate-200 bg-white px-2 text-[12px] text-slate-700 disabled:opacity-50';
const BUTTON_CLASS =
  'min-h-[40px] px-3 rounded-lg border border-slate-200 bg-white text-[11px] font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed';

export function ScreenDeviceSettings({
  screenId,
  readOnly,
  nowMs,
}: {
  screenId: string;
  /** RESTRICTED_VIEWER — every control inert. */
  readOnly?: boolean;
  /** Test clock; the real one otherwise. */
  nowMs?: number;
}) {
  const t = useTranslations('screens.deviceSettings');
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-slate-100" data-testid="device-settings-section">
      <button
        type="button"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="w-full flex items-center gap-2 px-3.5 py-3 min-h-[44px] text-left text-[11px] font-bold text-slate-700 hover:bg-white"
      >
        <Settings2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        <span className="flex-1">{t('title')}</span>
        {open ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
      </button>
      {open && <DeviceSettingsBody screenId={screenId} readOnly={!!readOnly} nowMs={nowMs} />}
    </div>
  );
}

function DeviceSettingsBody({ screenId, readOnly, nowMs }: { screenId: string; readOnly: boolean; nowMs?: number }) {
  const t = useTranslations('screens.deviceSettings');
  const locale = useLocale();
  const q = useDeviceSettings(screenId);
  const save = useUpdateDeviceSettings(screenId);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<DeviceSettingKey | null>(null);
  const now = nowMs ?? Date.now();
  const ago = (iso: string | null | undefined) => (iso ? relative(locale, new Date(iso).getTime(), now) : null);

  // A role that cannot read the settings, or a screen that is gone: say nothing.
  if (q.isError) return null;
  if (q.isLoading || !q.data) {
    return <p className="px-3.5 pb-3 text-[10px] text-slate-400">{t('loading')}</p>;
  }

  const view = q.data;
  const model = buildSection(view);
  const checked = ago(view.reportedAt);

  const submit = async (key: DeviceSettingKey, patch: DeviceSettingsPatch) => {
    setBusy(key);
    setError(null);
    try {
      await save.mutateAsync(patch);
    } catch (e) {
      const err = e as { code?: string; message?: string };
      setError(
        err.code === 'DEVICE_SETTINGS_WIFI_PASSPHRASE_REQUIRED'
          ? t('errors.passwordRequired')
          : t('errors.save', { message: err.message || '' }),
      );
    } finally {
      setBusy(null);
    }
  };

  const header = (
    <div className="px-3.5 pb-1">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[10px] text-slate-500 leading-snug">{t('intro')}</p>
        {checked && <span className="text-[9px] text-slate-400 shrink-0">{t('checkedAgo', { ago: checked })}</span>}
      </div>
      <p className="text-[10px] text-slate-400 leading-snug mt-0.5">
        {t('notManaged')}: {t('stopManagingNote')}
      </p>
    </div>
  );

  if (model.kind === 'not-reported') {
    return (
      <div className="pb-3" data-testid="device-settings-not-reported">
        <p className="px-3.5 text-[10px] text-slate-500 leading-snug">{t('notReported')}</p>
      </div>
    );
  }
  if (model.kind === 'old-android') {
    return (
      <div className="pb-3" data-testid="device-settings-old-android">
        <p className="px-3.5 text-[10px] text-slate-500 leading-snug">
          {t('needsAndroid13', { sdk: model.sdk ?? '?' })}
        </p>
      </div>
    );
  }

  return (
    <div className="pb-2">
      {header}
      {model.rows.map((row) => (
        <SettingRow
          key={row.key}
          row={row}
          disabled={readOnly || busy !== null}
          saving={busy === row.key}
          onSave={(patch) => void submit(row.key, patch)}
        />
      ))}
      {error && (
        <p className="px-3.5 py-1.5 text-[10px] text-rose-700 bg-rose-50/60 border-t border-rose-100" role="alert">
          {error}
        </p>
      )}
      <LoadFacts
        load={model.load}
        asOf={ago(view.reportChangedAt)}
        agoMs={(ms) => relative(locale, ms, now)}
      />
    </div>
  );
}

function SettingRow({
  row,
  disabled,
  saving,
  onSave,
}: {
  row: DeviceSettingRow;
  disabled: boolean;
  saving: boolean;
  onSave: (patch: DeviceSettingsPatch) => void;
}) {
  const t = useTranslations('screens.deviceSettings');
  const id = `device-setting-${row.key}`;
  const label = t(`row.${row.key}`);
  const state = stateLine(t, row);

  return (
    <div className="px-3.5 py-2 border-t border-slate-100" data-testid={id}>
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
        <label htmlFor={`${id}-input`} className="text-[11px] font-bold text-slate-700">
          {label}
        </label>
        {row.editable && row.key !== 'ntpServer' && row.key !== 'wifi' && (
          <Select
            id={`${id}-input`}
            value={selectValue(row)}
            disabled={disabled}
            onChange={(e) => onSave(patchFor(row.key, e.target.value) as DeviceSettingsPatch)}
          >
            <option value="">{t('notManaged')}</option>
            {optionsFor(t, row.key)}
          </Select>
        )}
      </div>
      {row.editable && row.key === 'ntpServer' && (
        <NtpEditor row={row} disabled={disabled} onSave={onSave} inputId={`${id}-input`} />
      )}
      {row.editable && row.key === 'wifi' && (
        <WifiEditor row={row} disabled={disabled} onSave={onSave} inputId={`${id}-input`} />
      )}
      {row.key === 'attentiveTimeoutMs' && row.editable && (
        <p className="text-[10px] text-slate-400 leading-snug mt-1">{t('attentive.help')}</p>
      )}
      <p className="text-[10px] text-slate-500 leading-snug mt-1" data-testid={`${id}-observed`}>
        {observedText(t, row)}
      </p>
      {(saving || state) && (
        <p className={`text-[10px] leading-snug mt-0.5 ${state?.tone ?? 'text-slate-500'}`} data-testid={`${id}-state`}>
          {saving ? t('saving') : state!.text}
        </p>
      )}
    </div>
  );
}

type T = ReturnType<typeof useTranslations>;

function optionsFor(t: T, key: DeviceSettingKey) {
  switch (key) {
    case 'brightness':
      return BRIGHTNESS_OPTIONS.map((n) => (
        <option key={n} value={String(n)}>{t('percent', { n })}</option>
      ));
    case 'volume':
      return VOLUME_OPTIONS.map((n) => (
        <option key={n} value={String(n)}>{t('percent', { n })}</option>
      ));
    case 'screenOffTimeoutMs':
      return TIMEOUT_OPTIONS.map((ms) => (
        <option key={ms} value={String(ms)}>{timeoutText(t, ms)}</option>
      ));
    case 'attentiveTimeoutMs':
      return ATTENTIVE_OPTIONS.map((ms) => (
        <option key={ms} value={String(ms)}>{timeoutText(t, ms)}</option>
      ));
    case 'rotationLock':
      return [
        <option key="true" value="true">{t('rotation.locked')}</option>,
        <option key="false" value="false">{t('rotation.auto')}</option>,
      ];
    default:
      return [
        <option key="true" value="true">{t('on')}</option>,
        <option key="false" value="false">{t('off')}</option>,
      ];
  }
}

function timeoutText(t: T, ms: number): string {
  const p = timeoutParts(ms);
  return 'never' in p ? t('timeout.never') : t(`timeout.${p.unit}`, { n: p.n });
}

function observedText(t: T, row: DeviceSettingRow): string {
  const v = row.observed;
  if (v === undefined || v === null) return t('androidUnreadable');
  let value: string;
  switch (row.key) {
    case 'brightness':
    case 'volume':
      value = t('percent', { n: Number(v) });
      break;
    case 'screenOffTimeoutMs':
    case 'attentiveTimeoutMs':
      value = timeoutText(t, Number(v));
      break;
    case 'rotationLock':
      value = v === true ? t('rotation.locked') : t('rotation.auto');
      break;
    case 'autoTime':
    case 'autoTimeZone':
      value = v === true ? t('on') : t('off');
      break;
    case 'ntpServer':
      value = v === '' ? t('ntp.androidDefault') : String(v);
      break;
    case 'wifi': {
      const w = v as { ssid: string | null; approval: string };
      value = t('wifi.observed', {
        ssid: w.ssid ?? t('wifi.noneSuggested'),
        approval: t(`wifi.approval.${w.approval}`),
      });
      break;
    }
  }
  return t('android', { value });
}

function stateLine(t: T, row: DeviceSettingRow): { text: string; tone: string } | null {
  const s = row.state;
  const why = (code?: string) => (code ? t(`why.${code}`) : '');
  switch (s.kind) {
    case 'unknown':
    case 'not-managed':
      return null;
    case 'not-possible':
      return { text: t('state.notPossible', { reason: why(s.why) }), tone: 'text-slate-400' };
    case 'sending':
      return { text: t('state.sending'), tone: 'text-amber-700' };
    case 'applied':
      return {
        text:
          s.why === 'already-set' ? t('state.alreadySet') : s.why === 'unverified' ? t('state.unverified') : t('state.applied'),
        tone: 'text-emerald-700',
      };
    case 'waiting':
      return { text: t('state.waiting', { reason: why(s.why) }), tone: 'text-amber-700' };
    case 'failed':
      return { text: t('state.failed', { reason: why(s.why ?? 'error') }), tone: 'text-rose-700' };
    case 'not-possible-now':
      return { text: t('state.notPossibleNow', { reason: why(s.why) }), tone: 'text-rose-700' };
  }
}

function NtpEditor({
  row,
  disabled,
  onSave,
  inputId,
}: {
  row: DeviceSettingRow;
  disabled: boolean;
  onSave: (patch: DeviceSettingsPatch) => void;
  inputId: string;
}) {
  const t = useTranslations('screens.deviceSettings');
  const stored = typeof row.desired?.value === 'string' ? row.desired.value : '';
  const [draft, setDraft] = useState(stored);
  return (
    <div className="mt-1.5">
      <div className="flex flex-wrap gap-2">
        <input
          id={inputId}
          type="text"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className={`${INPUT_CLASS} flex-1 min-w-[10rem]`}
          placeholder={t('ntp.placeholder')}
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button
          type="button"
          className={BUTTON_CLASS}
          disabled={disabled || (row.desired !== undefined && draft.trim() === stored)}
          onClick={() => onSave({ ntpServer: draft.trim() })}
        >
          {t('save')}
        </button>
        {row.desired !== undefined && (
          <button type="button" className={BUTTON_CLASS} disabled={disabled} onClick={() => onSave({ ntpServer: null })}>
            {t('stopManaging')}
          </button>
        )}
      </div>
      <p className="text-[10px] text-slate-400 leading-snug mt-1">{t('ntp.help')}</p>
    </div>
  );
}

function WifiEditor({
  row,
  disabled,
  onSave,
  inputId,
}: {
  row: DeviceSettingRow;
  disabled: boolean;
  onSave: (patch: DeviceSettingsPatch) => void;
  inputId: string;
}) {
  const t = useTranslations('screens.deviceSettings');
  const stored =
    row.desired && typeof row.desired.value === 'object'
      ? row.desired.value
      : null;
  const [ssid, setSsid] = useState(stored?.ssid ?? '');
  const [security, setSecurity] = useState<DeviceWifiSecurity>(stored?.security ?? 'wpa2');
  const [hidden, setHidden] = useState(stored?.hidden ?? false);
  // Write-only: never pre-filled, never read back.
  const [password, setPassword] = useState('');
  const keepSaved = !!stored?.passphraseSaved && stored.ssid === ssid.trim() && stored.security === security;

  const submit = () => {
    const wifi: NonNullable<DeviceSettingsPatch['wifi']> = { ssid: ssid.trim(), security, hidden };
    if (security !== 'open' && password !== '') wifi.passphrase = password;
    onSave({ wifi });
    setPassword('');
  };

  return (
    <div className="mt-1.5 space-y-1.5">
      <input
        id={inputId}
        type="text"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        aria-label={t('wifi.ssid')}
        placeholder={t('wifi.ssid')}
        className={INPUT_CLASS}
        value={ssid}
        maxLength={32}
        disabled={disabled}
        onChange={(e) => setSsid(e.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <Select
          aria-label={t('wifi.security')}
          value={security}
          disabled={disabled}
          onChange={(e) => setSecurity(e.target.value as DeviceWifiSecurity)}
        >
          <option value="wpa2">{t('wifi.wpa2')}</option>
          <option value="wpa3">{t('wifi.wpa3')}</option>
          <option value="open">{t('wifi.open')}</option>
        </Select>
        {security !== 'open' && (
          <input
            type="password"
            autoComplete="new-password"
            aria-label={t('wifi.password')}
            placeholder={keepSaved ? t('wifi.passwordSaved') : t('wifi.password')}
            className={`${INPUT_CLASS} flex-1 min-w-[10rem]`}
            value={password}
            maxLength={63}
            disabled={disabled}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
      </div>
      <label className="flex items-center gap-2 text-[11px] text-slate-600 min-h-[32px]">
        <input type="checkbox" checked={hidden} disabled={disabled} onChange={(e) => setHidden(e.target.checked)} />
        {t('wifi.hidden')}
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={BUTTON_CLASS}
          disabled={disabled || ssid.trim() === '' || (security !== 'open' && password === '' && !keepSaved)}
          onClick={submit}
        >
          {t('save')}
        </button>
        {stored && (
          <button type="button" className={BUTTON_CLASS} disabled={disabled} onClick={() => onSave({ wifi: null })}>
            {t('stopManaging')}
          </button>
        )}
      </div>
      <p className="text-[10px] text-slate-400 leading-snug">{t('wifi.note')}</p>
    </div>
  );
}

function LoadFacts({
  load,
  asOf,
  agoMs,
}: {
  load: Parameters<typeof hasLoadFacts>[0];
  asOf: string | null;
  agoMs: (ms: number) => string;
}) {
  const t = useTranslations('screens.deviceSettings');
  const locale = useLocale();
  if (!hasLoadFacts(load)) return null;
  const level = thermalLevel(load.thermal);
  const lines: string[] = [];
  if (level) {
    const heat = t('load.thermal', { level: t(`load.level.${level}`) });
    lines.push(load.thermalAt ? `${heat} · ${t('load.thermalChanged', { ago: agoMs(load.thermalAt) })}` : heat);
  }
  if (load.headroom !== undefined) {
    lines.push(t('load.headroom', { value: new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(load.headroom) }));
  }
  if (load.socC !== undefined) lines.push(t('load.soc', { value: load.socC }));
  if (load.cpu !== undefined) {
    lines.push(
      load.sysCpu !== undefined
        ? t('load.cpuBoth', { player: t('percent', { n: load.cpu }), device: t('percent', { n: load.sysCpu }) })
        : t('load.cpu', { player: t('percent', { n: load.cpu }) }),
    );
  }
  if (load.memAvailMb !== undefined && load.memTotalMb !== undefined) {
    lines.push(t('load.memory', { free: formatMemory(load.memAvailMb, locale), total: formatMemory(load.memTotalMb, locale) }));
  }
  return (
    <div className="px-3.5 py-2 border-t border-slate-100" data-testid="device-load-facts">
      <div className="flex items-baseline justify-between gap-2">
        <span className="flex items-center gap-2 text-[11px] font-bold text-slate-700">
          <Thermometer className="w-3.5 h-3.5 text-slate-400" />
          {t('load.title')}
        </span>
        {asOf && <span className="text-[9px] text-slate-400">{t('load.asOf', { ago: asOf })}</span>}
      </div>
      {lines.map((l) => (
        <p key={l} className="text-[10px] text-slate-600 leading-snug mt-0.5">
          {l}
        </p>
      ))}
      {load.memLow && <p className="text-[10px] text-amber-700 leading-snug mt-0.5">{t('load.memoryLow')}</p>}
    </div>
  );
}
