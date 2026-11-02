"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { useAppStore } from '@/lib/store';
import { API_URL } from '@/lib/api-url';
import { fetchWithTimeout } from '@/lib/fetch-timeout';
import {
  AlertTriangle, Megaphone, ShieldAlert, Send, Loader2, X, Image as ImageIcon,
  Volume2, Video, MonitorPlay, Clock3, Check, CheckCircle2, RefreshCw, Radio,
} from 'lucide-react';
import { canSendAllClear, hasPanicAuthority } from '@/lib/emergency-capability';
import * as Sentry from '@sentry/nextjs';
import { useEmergencyAnnouncer } from '@/components/emergency/EmergencyLiveRegion';
import { AssetPicker, type AssetKind } from '@/components/assets/AssetPicker';
import { transformedImageUrl } from '@/lib/asset-image';
import type { BroadcastInput, MediaAlertInput } from '@cms/api-types';
import { BroadcastBannerBar } from '@/components/player/BroadcastBannerBar';
import { BANNER_PRESET_COLORS, BANNER_SPEEDS, normalizeHex, type BannerMode, type BannerSpeed } from '@cms/api-types';
import {
  bannerForSend, contrastReport, durationMinutesFor, resolveColorChoice,
  type BrandColors, type ColorChoice, type DurationPreset,
} from '@/lib/broadcast-banner';
import { EmergencyTargetBar } from '@/components/emergency/EmergencyTargetBar';
import { EmergencyTargetPicker } from '@/components/emergency/EmergencyTargetPicker';
import { fetchEmergencyTargets } from '@/lib/emergency-api';
import {
  allScreensTarget, groupDisplayName, isAllScreens, targetChipLabel,
  type EmergencyTarget, type EmergencyTargets, type TargetScreen,
} from '@/lib/emergency-target';

type Severity = 'INFO' | 'WARN' | 'CRITICAL';
type Phase = 'idle' | 'holding' | 'sending' | 'sent' | 'error';

interface ActiveMsg {
  id: string;
  type: 'SOS' | 'TEXT_BROADCAST' | 'MEDIA_ALERT';
  scopeType?: string;
  scopeId?: string;
  screenIds?: string[];
  severity: Severity;
  textBlob: string | null;
  mediaUrls: string[];
  audioUrl: string | null;
  expiresAt: number | null;
  createdAt: string;
}

const HOLD_MS = 3000;
// The player displays four visual attachments per alert.
const MAX_ATTACHMENTS = 4;
const MSG_TYPE_KEY: Record<string, string> = {
  SOS: 'msgTypeSos', TEXT_BROADCAST: 'msgTypeText', MEDIA_ALERT: 'msgTypeMedia',
};
const SEVERITY_KEY: Record<string, string> = {
  INFO: 'sevInfo', WARN: 'sevWarn', CRITICAL: 'sevCritical',
};
const SEVERITIES = ['INFO', 'WARN', 'CRITICAL'] as const;
const SEVERITY_STYLE = {
  INFO: { selected: 'border-indigo-500 bg-indigo-50 text-indigo-700', badge: 'bg-indigo-50 text-indigo-700 ring-indigo-200', preview: 'bg-yellow-400 text-slate-950', icon: Megaphone },
  WARN: { selected: 'border-amber-500 bg-amber-50 text-amber-800', badge: 'bg-amber-50 text-amber-800 ring-amber-200', preview: 'bg-orange-500 text-white', icon: AlertTriangle },
  CRITICAL: { selected: 'border-red-500 bg-red-50 text-red-700', badge: 'bg-red-50 text-red-700 ring-red-200', preview: 'bg-red-700 text-white', icon: ShieldAlert },
};
const DURATION_PRESETS: Array<{ id: DurationPreset; key: string }> = [
  { id: '15m', key: 'd15m' }, { id: '1h', key: 'd1h' }, { id: '4h', key: 'd4h' },
  { id: 'eod', key: 'dEod' }, { id: 'manual', key: 'dManual' }, { id: 'custom', key: 'dCustom' },
];
const PREVIEW_STAGE_W = 1920;
const PREVIEW_STAGE_H = 1080;
const SEVERITY_SWATCH = { INFO: '#facc15', WARN: '#f97316', CRITICAL: '#b91c1c' } as const;
const inputClass = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:opacity-60';
const secondaryButton = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-indigo-300 hover:bg-indigo-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:opacity-50';

function mediaName(url: string): string {
  try { return decodeURIComponent(new URL(url).pathname.split('/').pop() || url); }
  catch { return url; }
}

function MediaPreview({ url, alt }: { url: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <div className="flex h-full items-center justify-center gap-2 p-3 text-xs"><ImageIcon className="h-5 w-5 shrink-0" />{alt}</div>;
  if (/\.(mp4|webm|ogg)(\?|$)/i.test(url)) {
    return <video src={url} controls muted playsInline preload="metadata" aria-label={alt} onError={() => setFailed(true)} className="h-full w-full object-contain" />;
  }
  // This is a dashboard thumbnail; screens keep the original stored URL.
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/no-noninteractive-element-interactions -- onError handles image decoding.
  return <img src={transformedImageUrl(url, { width: 800, quality: 80 })} alt={alt} onError={() => setFailed(true)} className="h-full w-full object-contain" />;
}

export default function BroadcastPage() {
  const params = useParams<{ schoolId: string }>();
  const t = useTranslations('emergency.broadcast');
  const tt = useTranslations();
  const locale = useLocale();
  const { user, token } = useAppStore();
  // Routes use a workspace slug; emergency APIs require the signed-in tenant ID.
  const tenantId = user?.tenantId || params.schoolId;
  const canSend = hasPanicAuthority(user) && user?.role !== 'RESTRICTED_VIEWER';
  const canClear = canSendAllClear(user) && user?.role !== 'RESTRICTED_VIEWER';
  const [text, setText] = useState('');
  const [severity, setSeverity] = useState<Severity>('WARN');
  const [durationMin, setDurationMin] = useState('5');
  const [durationPreset, setDurationPreset] = useState<DurationPreset>('custom');
  // Banner style (INFO / WARN text banners only). Default: the severity's own colour, static text.
  const [colorChoice, setColorChoice] = useState<ColorChoice>({ kind: 'default' });
  const [customHex, setCustomHex] = useState('#');
  const [bannerMode, setBannerMode] = useState<BannerMode>('static');
  const [bannerSpeed, setBannerSpeed] = useState<BannerSpeed>('normal');
  const [brand, setBrand] = useState<BrandColors>({ primary: null, accent: null });
  const previewBox = useRef<HTMLDivElement>(null);
  const [previewScale, setPreviewScale] = useState(0.3);
  const [mediaUrls, setMediaUrls] = useState<string[]>([]);
  const [audioUrl, setAudioUrl] = useState('');
  const [withMedia, setWithMedia] = useState(false);
  const [picker, setPicker] = useState<AssetKind | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [snapshot, setSnapshot] = useState<{ tenantId: string; active: ActiveMsg[]; status: 'loading' | 'ready' | 'error' }>({ tenantId, active: [], status: 'loading' });
  // A workspace switch must never briefly show another workspace's alerts.
  const active = snapshot.tenantId === tenantId ? snapshot.active : [];
  const status = snapshot.tenantId === tenantId ? snapshot.status : 'loading';
  const [clearingId, setClearingId] = useState<string | null>(null);
  // WHERE the broadcast goes. Default: all screens (today's behaviour). The
  // list behind "Choose screens" is read once and never blocks sending.
  const [targets, setTargets] = useState<EmergencyTargets | null>(null);
  const [targetsStatus, setTargetsStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [targetsTry, setTargetsTry] = useState(0);
  const [chosenTarget, setChosenTarget] = useState<EmergencyTarget | null>(null);
  const [targetPickerOpen, setTargetPickerOpen] = useState(false);
  const allScreens = useMemo(() => allScreensTarget(tenantId, targets?.allScreensCount ?? null), [tenantId, targets?.allScreensCount]);
  // A hand-picked set of screens (checkbox mode of the shared picker).
  const [chosenScreens, setChosenScreens] = useState<TargetScreen[]>([]);
  const multi = chosenScreens.length > 0;
  const target: EmergencyTarget = multi
    ? {
        scopeType: 'device',
        scopeId: 'multi',
        name: chosenScreens.length === 1 ? chosenScreens[0].name : `${chosenScreens[0].name} +${chosenScreens.length - 1}`,
        screenCount: chosenScreens.reduce((n, x) => n + (x.displayScreenCount || 1), 0),
      }
    : chosenTarget ?? allScreens;
  useEffect(() => {
    if (!token) return;
    let live = true;
    setTargetsStatus('loading');
    fetchEmergencyTargets(token)
      .then((data) => { if (live) { setTargets(data); setTargetsStatus('ready'); } })
      .catch(() => { if (live) setTargetsStatus('error'); });
    return () => { live = false; };
  }, [token, tenantId, targetsTry]);
  // A workspace switch must not carry a screen of the old workspace along.
  useEffect(() => { setChosenTarget(null); setChosenScreens([]); }, [tenantId]);
  const scopeNameOf = (m: ActiveMsg): string | null => {
    if (m.scopeType === 'group') {
      const g = targets?.groups?.find((x) => x.id === m.scopeId);
      return g ? groupDisplayName(tt, g.name) : null;
    }
    if (m.scopeType === 'devices') return null;
    if (m.scopeType === 'device') return targets?.screens?.find((x) => x.id === m.scopeId)?.name ?? null;
    return null;
  };
  // Brand colours for the presets: best-effort, never blocks the composer.
  useEffect(() => {
    if (!token) return;
    let live = true;
    Promise.resolve(fetchWithTimeout(`${API_URL}/branding/me`, { headers: { Authorization: `Bearer ${token}` }, credentials: 'include' }, 4000))
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        const palette = json && typeof json === 'object' ? (json as { palette?: { primary?: unknown; accent?: unknown } }).palette : null;
        if (live && palette) setBrand({ primary: normalizeHex(palette.primary), accent: normalizeHex(palette.accent) });
      })
      .catch(() => { /* no brand presets */ });
    return () => { live = false; };
  }, [token, tenantId]);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const mounted = useRef(true);
  const statusRequest = useRef(0);
  const invalidateStatus = useCallback(() => { ++statusRequest.current; }, []);
  const { announce, region: liveRegion } = useEmergencyAnnouncer();
  const locked = phase === 'holding' || phase === 'sending';
  const takeover = withMedia || severity === 'CRITICAL';
  const SeverityIcon = SEVERITY_STYLE[severity].icon;
  const bannerHex = resolveColorChoice(colorChoice, brand);
  const contrast = contrastReport(bannerHex);
  const customInvalid = colorChoice.kind === 'custom' && !normalizeHex(colorChoice.hex);
  const isBannerSend = !takeover;
  const minutesToSend = () => durationMinutesFor(durationPreset, Number(durationMin));
  // The preview draws the real 1920x1080 stage and scales it to fit.
  useEffect(() => {
    const el = previewBox.current;
    if (!el) return;
    const measure = () => { if (el.offsetWidth > 0) setPreviewScale(el.offsetWidth / PREVIEW_STAGE_W); };
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    observer?.observe(el);
    return () => observer?.disconnect();
  }, [canSend, takeover]);
  const severityLabel = (s: string) => SEVERITY_KEY[s] ? t(SEVERITY_KEY[s]) : s;
  const msgTypeLabel = (m: string) => MSG_TYPE_KEY[m] ? t(MSG_TYPE_KEY[m]) : m;

  const resetHold = useCallback(() => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    if (progressTimer.current) clearInterval(progressTimer.current);
    holdTimer.current = null;
    progressTimer.current = null;
  }, []);

  // A released key, interrupted touch, hidden tab or navigation must never send.
  const cancelHold = useCallback(() => {
    const wasHolding = holdTimer.current !== null;
    resetHold();
    if (wasHolding) {
      setPhase('idle');
      setProgress(0);
    }
  }, [resetHold]);

  useEffect(() => {
    mounted.current = true;
    const onHidden = () => { if (document.hidden) cancelHold(); };
    window.addEventListener('blur', cancelHold);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      mounted.current = false;
      resetHold();
      window.removeEventListener('blur', cancelHold);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, [cancelHold, resetHold]);

  useEffect(() => { cancelHold(); }, [tenantId, token, canSend, cancelHold]);

  const fetchActive = useCallback(async () => {
    const requestId = ++statusRequest.current;
    try {
      const res = await fetchWithTimeout(
        `${API_URL}/emergency/status?tenantId=${encodeURIComponent(tenantId)}`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {}, credentials: 'include' },
        4000,
      );
      if (!res.ok) throw new Error(String(res.status));
      const json = await res.json();
      if (!Array.isArray(json.active)) throw new Error('Invalid status response');
      if (mounted.current && requestId === statusRequest.current) {
        setSnapshot({ tenantId, active: json.active, status: 'ready' });
      }
    } catch {
      if (mounted.current && requestId === statusRequest.current) setSnapshot((previous) => ({ tenantId, active: previous.tenantId === tenantId ? previous.active : [], status: 'error' }));
    }
  }, [tenantId, token]);

  useEffect(() => {
    void Promise.resolve().then(fetchActive);
    const interval = setInterval(() => { void fetchActive(); }, 5000);
    return () => { clearInterval(interval); invalidateStatus(); };
  }, [fetchActive, invalidateStatus]);

  const submit = async () => {
    resetHold();
    setPhase('sending');
    setErrorMsg('');
    announce(isAllScreens(target) ? t('annSending') : t('annSendingTo', { target: targetChipLabel(tt, target) }));
    try {
      const sendScope = multi || isAllScreens(target)
        ? { scopeType: 'tenant' as const, scopeId: tenantId }
        : { scopeType: target.scopeType as 'group' | 'device', scopeId: target.scopeId };
      const screenIds = multi ? chosenScreens.map((x) => x.id) : undefined;
      const body: BroadcastInput | MediaAlertInput = withMedia
        ? { scopeType: sendScope.scopeType, scopeId: sendScope.scopeId, ...(screenIds ? { screenIds } : {}), mediaUrls, audioUrl: audioUrl || undefined,
            textBlob: text.trim(), severity, expiresAt: Math.floor(Date.now() / 1000) + minutesToSend() * 60 }
        : { scopeType: sendScope.scopeType, scopeId: sendScope.scopeId, ...(screenIds ? { screenIds } : {}), text: text.trim(), severity,
            durationMs: minutesToSend() * 60 * 1000,
            ...(isBannerSend ? { banner: bannerForSend(bannerHex, bannerMode, bannerSpeed) } : {}) };
      const res = await fetchWithTimeout(`${API_URL}/emergency/${withMedia ? 'media-alert' : 'broadcast'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body), credentials: 'include',
      }, 12000);
      if (!res.ok) throw new Error(t('errSendFailed', { status: res.status }));
      if (!mounted.current) return;
      setPhase('sent');
      announce(isAllScreens(target) ? t('annDispatched') : t('annDispatchedTo', { target: targetChipLabel(tt, target) }));
      setText('');
      setMediaUrls([]);
      setAudioUrl('');
      void fetchActive();
    } catch (error) {
      if (!mounted.current) return;
      const message = error instanceof Error ? error.message : t('errBroadcastFailed');
      setErrorMsg(message);
      setPhase('error');
      announce(t('annFailed', { error: message }));
    }
  };

  const startHold = () => {
    if (!canSend || locked || holdTimer.current || picker) return;
    const invalid = !text.trim() ? t('errMessageRequired')
      : durationPreset === 'custom' && (!Number.isInteger(Number(durationMin)) || Number(durationMin) < 1 || Number(durationMin) > 120) ? t('errDuration')
      : isBannerSend && customInvalid ? t('errBannerColor')
      : withMedia && mediaUrls.length === 0 && !audioUrl ? t('errMediaRequired') : '';
    if (invalid) {
      setErrorMsg(invalid);
      setPhase('error');
      announce(invalid);
      return;
    }
    setErrorMsg('');
    setPhase('holding');
    setProgress(0);
    announce(t('annHolding', { severity: severityLabel(severity).toLowerCase() }));
    const start = Date.now();
    progressTimer.current = setInterval(() => setProgress(Math.min(100, (Date.now() - start) / HOLD_MS * 100)), 50);
    holdTimer.current = setTimeout(() => { void submit(); }, HOLD_MS);
  };

  const clearMessage = async (id: string) => {
    if (!canClear || clearingId) return;
    setClearingId(id);
    setErrorMsg('');
    try {
      const res = await fetchWithTimeout(`${API_URL}/emergency/messages/${id}/all-clear`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        credentials: 'include',
      }, 12000);
      if (!res.ok) throw new Error(t('errClearFailed', { status: res.status }));
      if (!mounted.current) return;
      announce(t('annCleared'));
      void fetchActive();
    } catch (error) {
      Sentry.captureException(error, { tags: { component: 'BroadcastPage', action: 'clearMessage' }, extra: { messageId: id } });
      if (!mounted.current) return;
      const message = error instanceof Error ? error.message : String(error);
      setErrorMsg(t('errClearFailedBanner', { error: message }));
      announce(t('annClearFailed', { error: message }));
    } finally {
      if (mounted.current) setClearingId(null);
    }
  };

  const pickMedia = (url: string) => {
    // The shared picker supplies a stored URL only after the upload and any
    // video conversion finish. Never send blob URLs or an unconverted video.
    if (picker === 'audio') setAudioUrl(url);
    else setMediaUrls((urls) => urls.includes(url) || urls.length >= MAX_ATTACHMENTS ? urls : [...urls, url]);
    setPicker(null);
  };

  const time = (value: string | number) => new Date(typeof value === 'number' ? value * 1000 : value).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });

  return (
    <div className="space-y-6" data-testid="broadcast-page">
      {liveRegion}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 ring-1 ring-indigo-100"><Megaphone className="h-5 w-5" aria-hidden /></span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">{t('title')}</h1>
            <p className="mt-1 text-sm text-slate-600">{t('subtitle')}</p>
          </div>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600"><MonitorPlay className="h-4 w-4 text-indigo-500" aria-hidden />{t('workspaceScope')}</span>
      </header>

      {errorMsg && <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /><span>{errorMsg}</span></div>}
      {phase === 'sent' && <div role="status" className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"><CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden />{t('dispatched')}</div>}

      <div className={`grid items-start gap-6 ${canSend ? 'xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]' : ''}`}>
        {canSend && <section aria-labelledby="composer-heading" className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
            <h2 id="composer-heading" className="text-base font-bold text-slate-900">{t('composeTitle')}</h2>
            <p className="mt-1 text-xs text-slate-500">{t('composeHint')}</p>
          </div>
          <fieldset disabled={locked} className="min-w-0 space-y-6 p-5 sm:p-6">
            <div className="rounded-2xl bg-slate-900 p-1">
              <EmergencyTargetBar
                target={target}
                disabled={locked}
                onChoose={() => setTargetPickerOpen(true)}
                onReset={() => { setChosenTarget(null); setChosenScreens([]); announce(tt('emergency.target.announceTargetSet', { target: tt('emergency.target.allScreens') })); }}
              />
            </div>
            <fieldset>
              <legend className="mb-2.5 text-sm font-semibold text-slate-800">{t('severity')}</legend>
              <div className="grid grid-cols-3 gap-2">
                {SEVERITIES.map((s) => {
                  const Icon = SEVERITY_STYLE[s].icon;
                  return <label key={s} className={`relative flex cursor-pointer flex-col items-start gap-2 rounded-xl border p-3 text-xs transition sm:text-sm ${severity === s ? SEVERITY_STYLE[s].selected : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
                    <input type="radio" name="broadcast-severity" value={s} checked={severity === s} onChange={() => setSeverity(s)} className="peer sr-only" />
                    <span className="absolute inset-0 rounded-xl peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-indigo-500" />
                    <span className="flex w-full items-center justify-between"><Icon className="h-4 w-4" aria-hidden />{severity === s && <Check className="h-3.5 w-3.5" aria-hidden />}</span>
                    <span className="font-semibold">{severityLabel(s)}</span>
                  </label>;
                })}
              </div>
            </fieldset>

            <div>
              <div className="mb-2 flex items-center justify-between gap-3"><label htmlFor="broadcast-message" className="text-sm font-semibold text-slate-800">{t('message')}</label><span className="text-xs tabular-nums text-slate-500">{text.length.toLocaleString(locale)} / 2,000</span></div>
              <textarea id="broadcast-message" value={text} onChange={(e) => { setText(e.target.value); if (phase === 'sent') setPhase('idle'); }} rows={4} maxLength={2000} placeholder={t('messagePlaceholder')} className={`${inputClass} min-h-32 resize-y leading-relaxed`} />
            </div>

            <div className="space-y-3">
              <label htmlFor="broadcast-media" aria-label={t('includeMedia')} className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
                <input id="broadcast-media" type="checkbox" checked={withMedia} onChange={(e) => setWithMedia(e.target.checked)} className="mt-0.5 h-4 w-4 accent-indigo-600" />
                <span><span className="block text-sm font-semibold text-slate-800">{t('includeMedia')}</span><span className="mt-0.5 block text-xs leading-relaxed text-slate-500">{t('mediaHint')}</span></span>
              </label>
              {withMedia && <div className="space-y-3 rounded-xl border border-slate-200 p-3.5">
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={mediaUrls.length >= MAX_ATTACHMENTS} onClick={() => setPicker('image')} className={secondaryButton}><ImageIcon className="h-4 w-4" aria-hidden />{t('addImage')}</button>
                  <button type="button" disabled={mediaUrls.length >= MAX_ATTACHMENTS} onClick={() => setPicker('video')} className={secondaryButton}><Video className="h-4 w-4" aria-hidden />{t('addVideo')}</button>
                  <button type="button" onClick={() => setPicker('audio')} className={secondaryButton}><Volume2 className="h-4 w-4" aria-hidden />{t(audioUrl ? 'replaceAudio' : 'addAudio')}</button>
                </div>
                {mediaUrls.length === 0 && !audioUrl && <p className="text-xs leading-relaxed text-slate-500">{t('uploadHint')}</p>}
                {mediaUrls.length > 0 && <ul className="space-y-2">{mediaUrls.map((url, i) => <li key={url} className="flex items-center gap-3 rounded-lg bg-slate-50 p-2">
                  <div className="h-12 w-16 shrink-0 overflow-hidden rounded-md bg-slate-100"><MediaPreview url={url} alt={t('attachment', { number: i + 1 })} /></div>
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-700" title={mediaName(url)}>{mediaName(url)}</span>
                  <button type="button" onClick={() => setMediaUrls((urls) => urls.filter((u) => u !== url))} aria-label={t('removeAttachment', { number: i + 1 })} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-600"><X className="h-4 w-4" /></button>
                </li>)}</ul>}
                {audioUrl && <div className="space-y-2 rounded-lg bg-slate-50 p-2">
                  <div className="flex items-center gap-2"><Volume2 className="h-4 w-4 shrink-0 text-indigo-500" /><span className="min-w-0 flex-1 truncate text-xs text-slate-700">{mediaName(audioUrl)}</span><button type="button" onClick={() => setAudioUrl('')} aria-label={t('removeAudio')} className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-600"><X className="h-4 w-4" /></button></div>
                  <audio src={audioUrl} controls preload="none" aria-label={t('audioPreview')} className="h-9 w-full" />
                </div>}
                <p className="text-xs text-slate-500">{t('attachmentLimit', { count: mediaUrls.length })}</p>
              </div>}
            </div>

            {isBannerSend && <fieldset className="space-y-4 rounded-xl border border-slate-200 p-3.5" data-testid="banner-style">
              <legend className="px-1 text-sm font-semibold text-slate-800">{t('bannerStyle')}</legend>
              <div>
                <p className="mb-2 text-xs font-semibold text-slate-700">{t('bannerColor')}</p>
                <div className="flex flex-wrap" role="radiogroup" aria-label={t('bannerColor')}>
                  {([
                    { key: 'default', label: t('colorDefault'), hex: null as string | null, choice: { kind: 'default' } as ColorChoice },
                    ...(brand.primary ? [{ key: 'brand-primary', label: t('colorBrandPrimary'), hex: brand.primary as string | null, choice: { kind: 'brand-primary' } as ColorChoice }] : []),
                    ...(brand.accent ? [{ key: 'brand-accent', label: t('colorBrandAccent'), hex: brand.accent as string | null, choice: { kind: 'brand-accent' } as ColorChoice }] : []),
                    ...BANNER_PRESET_COLORS.map((c) => ({ key: `preset-${c.id}`, label: t(`color_${c.id}`), hex: c.hex as string | null, choice: { kind: 'preset', id: c.id } as ColorChoice })),
                    { key: 'custom', label: t('colorCustom'), hex: null as string | null, choice: { kind: 'custom', hex: customHex } as ColorChoice },
                  ]).map((o) => {
                    const selected = o.choice.kind === colorChoice.kind && (o.choice.kind !== 'preset' || (colorChoice.kind === 'preset' && colorChoice.id === o.choice.id));
                    return <button key={o.key} type="button" role="radio" aria-checked={selected} data-testid={`banner-color-${o.key}`}
                      onClick={() => setColorChoice(o.choice)}
                      className={`mb-2 mr-2 inline-flex min-h-11 items-center rounded-lg border px-3 py-2 text-xs font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 ${selected ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}>
                      <span aria-hidden className="mr-2 inline-block h-4 w-4 rounded-full border border-slate-300" style={{ background: o.hex ?? (o.key === 'default' ? SEVERITY_SWATCH[severity] : 'conic-gradient(#ef4444,#f59e0b,#22c55e,#3b82f6,#a855f7,#ef4444)') }} />
                      {o.label}
                    </button>;
                  })}
                </div>
                {colorChoice.kind === 'custom' && <div className="mt-1">
                  <label htmlFor="banner-custom-hex" className="mb-1 block text-xs font-semibold text-slate-700">{t('customHexLabel')}</label>
                  <input id="banner-custom-hex" value={colorChoice.hex} maxLength={7} autoComplete="off" spellCheck={false}
                    onChange={(e) => { setCustomHex(e.target.value); setColorChoice({ kind: 'custom', hex: e.target.value }); }}
                    aria-invalid={customInvalid} placeholder="#1d4ed8" className={`${inputClass} w-36 font-mono`} />
                  {customInvalid && <p role="status" className="mt-1 text-xs text-red-700">{t('customHexInvalid')}</p>}
                </div>}
                {contrast && <p data-testid="banner-contrast" role="status" className={`mt-1 text-xs leading-relaxed ${contrast.passesAA ? 'text-slate-500' : 'font-semibold text-amber-800'}`}>
                  {contrast.passesAA ? t('contrastAuto') : t('contrastWarn', { ratio: contrast.ratio.toFixed(1) })}
                </p>}
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold text-slate-700">{t('bannerText')}</p>
                <div className="flex flex-wrap" role="radiogroup" aria-label={t('bannerText')}>
                  {(['static', 'scroll'] as const).map((m) => <button key={m} type="button" role="radio" aria-checked={bannerMode === m} data-testid={`banner-mode-${m}`}
                    onClick={() => setBannerMode(m)}
                    className={`mb-2 mr-2 inline-flex min-h-11 items-center rounded-lg border px-3 py-2 text-xs font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 ${bannerMode === m ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}>{t(m === 'static' ? 'modeStatic' : 'modeScroll')}</button>)}
                </div>
                <p className="text-xs leading-relaxed text-slate-500">{t(bannerMode === 'static' ? 'modeStaticHint' : 'modeScrollHint')}</p>
                {bannerMode === 'scroll' && <div className="mt-2 flex flex-wrap" role="radiogroup" aria-label={t('speed')}>
                  {BANNER_SPEEDS.map((sp) => <button key={sp} type="button" role="radio" aria-checked={bannerSpeed === sp} data-testid={`banner-speed-${sp}`}
                    onClick={() => setBannerSpeed(sp)}
                    className={`mb-2 mr-2 inline-flex min-h-11 items-center rounded-lg border px-3 py-2 text-xs font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 ${bannerSpeed === sp ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}>{t(sp === 'slow' ? 'speedSlow' : sp === 'fast' ? 'speedFast' : 'speedNormal')}</button>)}
                </div>}
              </div>
            </fieldset>}
            {!isBannerSend && severity === 'CRITICAL' && <p className="text-xs leading-relaxed text-slate-500">{t('criticalColorNote')}</p>}

            <div className="space-y-3 rounded-xl border border-slate-200 px-3.5 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label htmlFor="broadcast-duration" className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Clock3 className="h-4 w-4 text-slate-400" aria-hidden />{t('duration')}</label>
                <div className="flex items-center gap-2"><input id="broadcast-duration" type="number" min={1} max={120} step={1} value={durationMin} onChange={(e) => { setDurationMin(e.target.value); setDurationPreset('custom'); }} className={`${inputClass} w-20 text-center tabular-nums`} /><span className="text-xs text-slate-500">{t('minutes')}</span></div>
              </div>
              <div className="flex flex-wrap" role="radiogroup" aria-label={t('autoClear')}>
                {DURATION_PRESETS.map((d) => <button key={d.id} type="button" role="radio" aria-checked={durationPreset === d.id} data-testid={`duration-${d.id}`}
                  onClick={() => setDurationPreset(d.id)}
                  className={`mb-2 mr-2 inline-flex min-h-11 items-center rounded-lg border px-3 py-2 text-xs font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 ${durationPreset === d.id ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}>{t(d.key)}</button>)}
              </div>
            </div>
          </fieldset>
          <div className="space-y-3 border-t border-slate-100 bg-slate-50/60 p-5 sm:px-6">
            <button type="button"
              onPointerDown={(e) => { if (e.button > 0) return; e.preventDefault(); startHold(); }}
              onPointerUp={cancelHold} onPointerLeave={cancelHold} onPointerCancel={cancelHold} onLostPointerCapture={cancelHold} onBlur={cancelHold}
              onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (!e.repeat) startHold(); } }}
              onKeyUp={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); cancelHold(); } }}
              onContextMenu={(e) => e.preventDefault()} disabled={phase === 'sending' || !!picker}
              aria-label={t('sendAria')}
              className="relative flex min-h-12 w-full touch-none select-none items-center justify-center overflow-hidden rounded-xl bg-indigo-600 px-4 py-3.5 text-sm font-bold text-white shadow-sm transition hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-wait disabled:opacity-60"
            >
              {phase === 'holding' && <span className="absolute inset-y-0 left-0 bg-black/20" style={{ width: `${progress}%` }} />}
              <span className="relative flex items-center gap-2">{phase === 'sending' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}{phase === 'sending' ? t('sending') : phase === 'holding' ? t('holdingPct', { pct: Math.floor(progress) }) : t('holdToBroadcast')}</span>
            </button>
            <p className="text-center text-xs leading-relaxed text-slate-500">{t('holdHint')}</p>
          </div>
        </section>}

        <div className="min-w-0 space-y-6">
          {canSend && <section aria-labelledby="preview-heading" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4"><h2 id="preview-heading" className="flex items-center gap-2 text-sm font-bold text-slate-900"><MonitorPlay className="h-4 w-4 text-slate-400" aria-hidden />{t('preview')}</h2><span className="text-xs font-medium text-slate-500">{t(takeover ? 'fullScreen' : 'textBanner')}</span></div>
            <div className="p-4 sm:p-5">
              {takeover ? <div data-testid="broadcast-preview" className={`relative flex aspect-video flex-col overflow-auto rounded-xl ${SEVERITY_STYLE[severity].preview}`}>
                <div className="relative flex flex-1 flex-col items-center justify-center gap-2.5 p-4 text-center">
                  <SeverityIcon className="h-7 w-7 shrink-0" aria-hidden />
                  <p className="whitespace-pre-wrap break-words text-sm font-bold leading-relaxed [overflow-wrap:anywhere]">{text || t('previewPlaceholder')}</p>
                  {withMedia && mediaUrls.length > 0 && <div className="grid w-full grid-cols-2 gap-2">{mediaUrls.map((url, i) => <div key={url} className={`overflow-hidden rounded-md bg-black/10 ${mediaUrls.length === 1 ? 'col-span-2 h-24 sm:h-32' : 'h-20'}`}><MediaPreview url={url} alt={t('attachment', { number: i + 1 })} /></div>)}</div>}
                  {withMedia && audioUrl && <span className="inline-flex items-center gap-1.5 text-xs"><Volume2 className="h-3.5 w-3.5" aria-hidden />{t('audioIncluded')}</span>}
                </div>
              </div> : <div ref={previewBox} data-testid="broadcast-preview" className="relative aspect-video overflow-hidden rounded-xl bg-slate-100">
                {/* The real 1920x1080 screen, scaled to fit: the same bar component the player draws. */}
                <div style={{ position: 'absolute', top: 0, left: 0, width: PREVIEW_STAGE_W, height: PREVIEW_STAGE_H, transform: `scale(${previewScale})`, transformOrigin: 'top left' }}>
                  <BroadcastBannerBar
                    severity={severity === 'INFO' ? 'INFO' : 'WARN'}
                    text={text || t('previewPlaceholder')}
                    options={bannerForSend(bannerHex, bannerMode, bannerSpeed)}
                    stageWidth={PREVIEW_STAGE_W}
                    style={{ width: PREVIEW_STAGE_W, maxHeight: PREVIEW_STAGE_H * 0.4 }}
                    rootProps={{ 'data-testid': 'broadcast-preview-bar' }}
                  />
                  <div style={{ position: 'absolute', top: 160, left: 0, width: PREVIEW_STAGE_W, height: PREVIEW_STAGE_H - 160, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>
                    <MonitorPlay style={{ width: 120, height: 120 }} aria-hidden />
                    <span style={{ fontSize: 40, marginTop: 16 }}>{t('scheduledContent')}</span>
                  </div>
                </div>
              </div>}
              <p className="mt-3 text-xs leading-relaxed text-slate-500">{t(takeover ? 'takeoverHint' : 'bannerHint')}</p>
            </div>
          </section>}

          <section aria-labelledby="active-heading" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <h2 id="active-heading" className="flex items-center gap-2 text-sm font-bold text-slate-900"><Radio className="h-4 w-4 text-slate-400" aria-hidden />{t('activeTitle')}{status === 'ready' && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">{active.length}</span>}</h2>
              <button type="button" onClick={() => { void fetchActive(); }} aria-label={t('refresh')} className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-50 hover:text-indigo-600"><RefreshCw className={`h-4 w-4 ${status === 'loading' ? 'animate-spin' : ''}`} /></button>
            </div>
            <div className="p-5">
              {status === 'loading' && <p role="status" className="flex items-center gap-2 py-4 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />{t('loadingActive')}</p>}
              {status === 'error' && <p role="alert" className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">{t('statusError')}</p>}
              {status === 'ready' && active.length === 0 && <div className="py-7 text-center"><span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"><CheckCircle2 className="h-5 w-5" aria-hidden /></span><p className="text-sm font-semibold text-slate-800">{t('noneActive')}</p><p className="mt-1.5 text-xs leading-relaxed text-slate-500">{t('emptyHint')}</p></div>}
              {active.length > 0 && <ul className="space-y-3">{active.map((message) => <li key={message.id} className="space-y-3 rounded-xl border border-slate-200 p-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2"><span className={`rounded-md px-2 py-1 text-xs font-semibold ring-1 ring-inset ${SEVERITY_STYLE[message.severity]?.badge || 'bg-slate-50 text-slate-700 ring-slate-200'}`}>{severityLabel(message.severity)}</span><span className="text-xs text-slate-500">{msgTypeLabel(message.type)}</span></div>
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-800 [overflow-wrap:anywhere]">{message.textBlob || t('noText')}</p>
                {message.scopeType === 'devices' && <p className="text-xs font-semibold text-slate-600" data-testid="broadcast-active-scope">{t('activeScopeMany', { count: message.screenIds?.length ?? 0 })}</p>}
                {(message.scopeType === 'group' || message.scopeType === 'device') && <p className="text-xs font-semibold text-slate-600" data-testid="broadcast-active-scope">{scopeNameOf(message) ? t('activeScope', { name: scopeNameOf(message) as string }) : t('activeScopeUnknown')}</p>}
                {(message.mediaUrls.length > 0 || message.audioUrl) && <p className="text-xs text-slate-500">{t('mediaAttachments', { count: message.mediaUrls.length + (message.audioUrl ? 1 : 0) })}</p>}
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3"><p className="text-xs leading-relaxed text-slate-500">{t('startedAt', { time: time(message.createdAt) })}<span className="block">{message.expiresAt ? t('endsAt', { time: time(message.expiresAt) }) : t('untilCleared')}</span></p>
                  {canClear && <button type="button" disabled={!!clearingId} onClick={() => { void clearMessage(message.id); }} className={secondaryButton}>{clearingId === message.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <X className="h-3.5 w-3.5" aria-hidden />}{t('clear')}</button>}
                </div>
              </li>)}</ul>}
            </div>
          </section>
        </div>
      </div>
      <EmergencyTargetPicker
        open={targetPickerOpen}
        targets={targets}
        status={targetsStatus}
        selected={target}
        allScreens={allScreens}
        multiple
        selectedScreenIds={chosenScreens.map((x) => x.id)}
        onSelectScreens={(list) => {
          setChosenScreens(list);
          setChosenTarget(null);
          announce(tt('emergency.target.announceTargetSet', { target: list.length ? tt('emergency.target.screensSelected', { count: list.length }) : tt('emergency.target.allScreens') }));
        }}
        onSelect={(next) => {
          setChosenScreens([]);
          setChosenTarget(isAllScreens(next) ? null : next);
          announce(tt('emergency.target.announceTargetSet', { target: targetChipLabel(tt, next) }));
        }}
        onClose={() => setTargetPickerOpen(false)}
        onRetry={() => setTargetsTry((n) => n + 1)}
      />
      {picker && <AssetPicker kind={picker} title={t(picker === 'image' ? 'chooseImage' : picker === 'video' ? 'chooseVideo' : 'chooseAudio')} onPick={pickMedia} onClose={() => setPicker(null)} />}
    </div>
  );
}
