"use client";

/**
 * /[schoolId]/settings/player — Player & offline (§7.6).
 *
 * An operational rollout surface, not a list of toggles. Every control here
 * was extracted from the all-in-one settings page (`_legacy/
 * LegacySettingsPage.tsx`: AutoUpdatePlayerToggle, OtaMaintenanceWindowCard,
 * CanaryRolloutCard, the Player APK card) — same endpoints, same guards, same
 * confirmations. What is new is the truth model around them.
 *
 * ── The one rule this page exists to keep (§7.6 / §13.2) ─────────────
 * A policy save is NOT a deployment. `PUT /tenants/me/*` returning 200 means
 * the tenant row changed — nothing more. So:
 *   • Policy writes await the server, re-read authoritative state, and only
 *     then say "Policy saved". No optimistic success message.
 *   • "Rollout verified on N/M screens" is a SEPARATE line, and it is derived
 *     only from what `Screen` rows reported about themselves.
 *   • The status pill comes from `derivePlayerRolloutState()`, which grades
 *     nothing it cannot evidence (CLAUDE.md Player Reliability rule 10).
 *
 * ── Audit honesty ────────────────────────────────────────────────────
 * `PUT me/ota-window` and `PUT me/canary-rollout` write an AuditLog row
 * (OTA_WINDOW_UPDATED / CANARY_ROLLOUT_UPDATED — verified in
 * apps/api/src/tenants/tenants.controller.ts). `PUT me/auto-update-player`,
 * `PUT me/usb-ingest` and `POST me/usb-ingest/rotate-key` do NOT. The page
 * therefore claims an audit record only for the two that write one, and
 * stays silent for the rest rather than implying one exists.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  AlertTriangle, Clock, Download, KeyRound, Loader2, MonitorPlay, RefreshCw, Usb,
} from 'lucide-react';
import {
  useAutoUpdatePlayerConfig,
  useCanaryRollout,
  useLatestPlayerVersion,
  useOtaWindowConfig,
  useScreens,
  useTenant,
  useToggleAutoUpdatePlayer,
  useUpdateCanaryRollout,
  useUpdateOtaWindow,
  useUsbIngestConfig,
} from '@/hooks/use-api';
import { useUIStore } from '@/store/ui-store';
import { appConfirm } from '@/components/ui/app-dialog';
import { SettingsPageFrame } from '@/components/settings/shell/SettingsPageFrame';
import {
  ContextAction,
  ContextModule,
  EditorHead,
  EditorSection,
  ErrorSummary,
  SectionAction,
  StatusPill,
  type SettingsStatusKind,
} from '@/components/settings/shell/primitives';
import { useSettingsShellActions } from '@/components/settings/shell/SettingsShellContext';
import {
  derivePlayerRolloutState,
  rolloutVerification,
  type PlayerRolloutState,
  type RolloutScreen,
} from '@/components/settings/player/playerRollout';

const ADMIN_ROLES = new Set(['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN']);
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** i18n key segment per state (hyphenated state ids are not message keys). */
const STATE_KEY: Record<PlayerRolloutState, string> = {
  failed: 'failed',
  paused: 'paused',
  'unknown-stale': 'unknownStale',
  'canary-in-progress': 'canaryInProgress',
  'rollout-scheduled': 'rolloutScheduled',
  'partially-deployed': 'partiallyDeployed',
  'update-available': 'updateAvailable',
  current: 'current',
};

/** §11 pill vocabulary per §7.6 state. Text is always present, never colour alone. */
const STATE_PILL: Record<PlayerRolloutState, SettingsStatusKind> = {
  failed: 'blocked',
  paused: 'attention',
  'unknown-stale': 'unknown',
  'canary-in-progress': 'notConfigured',
  'rollout-scheduled': 'notConfigured',
  'partially-deployed': 'attention',
  'update-available': 'notConfigured',
  current: 'ready',
};

export default function PlayerSettingsPage() {
  const t = useTranslations();
  const params = useParams<{ schoolId: string }>();
  const schoolId = params?.schoolId ?? '';
  const role = useUIStore((s) => s.user?.role as string | undefined);
  const canManage = !!role && ADMIN_ROLES.has(role);
  const { setSectionStatus } = useSettingsShellActions();

  const { data: tenant } = useTenant();
  const { data: screens } = useScreens();
  const { data: latest, isLoading: latestLoading } = useLatestPlayerVersion();
  const autoUpdateQ = useAutoUpdatePlayerConfig();
  const toggleAutoUpdate = useToggleAutoUpdatePlayer();
  const windowQ = useOtaWindowConfig();
  const updateWindow = useUpdateOtaWindow();
  const canaryQ = useCanaryRollout();
  const updateCanary = useUpdateCanaryRollout();
  const usbQ = useUsbIngestConfig();

  // ── Local edit state (§13.1: live edits stay local until Save) ──────
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [timezone, setTimezone] = useState('');
  const [percent, setPercent] = useState(100);
  const [soakHours, setSoakHours] = useState(24);
  const [autoPromote, setAutoPromote] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<{ message: string; fieldId?: string }[]>([]);
  /** Set ONLY after the server answered and authoritative state was re-read. */
  const [policySavedAt, setPolicySavedAt] = useState<number | null>(null);
  const [autoUpdateNote, setAutoUpdateNote] = useState<string | null>(null);

  const windowCfg = windowQ.data;
  const canaryCfg = canaryQ.data;

  const hydrateWindow = useCallback(() => {
    setStart(windowCfg?.start || '');
    setEnd(windowCfg?.end || '');
    setTimezone(windowCfg?.timezone || '');
  }, [windowCfg]);
  const hydrateCanary = useCallback(() => {
    setPercent(canaryCfg?.percent ?? 100);
    setSoakHours(canaryCfg?.soakHours ?? 24);
    setAutoPromote(canaryCfg?.autoPromote ?? true);
  }, [canaryCfg]);

  useEffect(() => { hydrateWindow(); }, [hydrateWindow]);
  useEffect(() => { hydrateCanary(); }, [hydrateCanary]);

  const windowDirty =
    start !== (windowCfg?.start || '') ||
    end !== (windowCfg?.end || '') ||
    timezone !== (windowCfg?.timezone || '');
  const canaryDirty =
    percent !== (canaryCfg?.percent ?? 100) ||
    soakHours !== (canaryCfg?.soakHours ?? 24) ||
    autoPromote !== (canaryCfg?.autoPromote ?? true);
  const dirtyCount = (windowDirty ? 1 : 0) + (canaryDirty ? 1 : 0);

  // ── The derivation every drawing on this page reads ─────────────────
  const rollout = useMemo(
    () =>
      derivePlayerRolloutState({
        now: Date.now(),
        screens: (screens as RolloutScreen[] | undefined) ?? [],
        latest,
        autoUpdateEnabled: autoUpdateQ.data?.enabled,
        canary: canaryCfg ?? null,
        window: windowCfg ?? null,
      }),
    [screens, latest, autoUpdateQ.data?.enabled, canaryCfg, windowCfg],
  );
  const verification = rolloutVerification(rollout);

  // Index dot (§6.4). Cleared on unmount so a stale dot never outlives the page.
  useEffect(() => {
    setSectionStatus('player', rollout.sectionStatus);
  }, [rollout.sectionStatus, setSectionStatus]);
  useEffect(() => () => setSectionStatus('player', null), [setSectionStatus]);

  /**
   * Everything the save handler reads, in a ref.
   *
   * `handleSave` / `handleDiscard` are handed to the shell through the
   * registration EFFECT, so they must be referentially stable for the life of
   * the page. They cannot close over React Query results directly: a query
   * result is a NEW object on every render, which would change the callback
   * identity, re-register, re-render and loop forever. The ref carries the
   * current values instead; the callbacks below have empty dependency lists.
   */
  const liveRef = useRef({
    start, end, timezone, windowDirty, canaryDirty, percent, soakHours, autoPromote,
    serverPercent: canaryCfg?.percent ?? 100, totalScreens: rollout.counts.total,
    updateWindow, updateCanary, windowQ, canaryQ, t, hydrateWindow, hydrateCanary,
  });
  liveRef.current = {
    start, end, timezone, windowDirty, canaryDirty, percent, soakHours, autoPromote,
    serverPercent: canaryCfg?.percent ?? 100, totalScreens: rollout.counts.total,
    updateWindow, updateCanary, windowQ, canaryQ, t, hydrateWindow, hydrateCanary,
  };

  // ── Save (§13.2): await the server, re-read, THEN say "Policy saved" ──
  const handleSave = useCallback(async () => {
    const {
      start, end, timezone, windowDirty, canaryDirty, percent, soakHours, autoPromote,
      serverPercent, totalScreens, updateWindow, updateCanary, windowQ, canaryQ, t,
    } = liveRef.current;
    const found: { message: string; fieldId?: string }[] = [];
    const bothOrNeither = (!!start && !!end && !!timezone) || (!start && !end && !timezone);
    if (windowDirty) {
      if (!bothOrNeither) found.push({ message: t('settings.cc.player.errWindowIncomplete'), fieldId: 'ota-window-start' });
      if (start && !HHMM.test(start)) found.push({ message: t('settings.cc.player.errStartFormat'), fieldId: 'ota-window-start' });
      if (end && !HHMM.test(end)) found.push({ message: t('settings.cc.player.errEndFormat'), fieldId: 'ota-window-end' });
      if (timezone) {
        try {
          new Intl.DateTimeFormat('en-US', { timeZone: timezone });
        } catch {
          found.push({ message: t('settings.cc.player.errTimezone'), fieldId: 'ota-window-tz' });
        }
      }
    }
    if (found.length) {
      setErrors(found);
      document.getElementById('player-error-summary')?.focus();
      return;
    }
    setErrors([]);

    // High-risk cohort moves get an impact confirmation naming the scope
    // (§13.3). Lowering the cohort pauses/rolls back delivery for real screens.
    if (canaryDirty && percent < serverPercent) {
      const ok = await appConfirm({
        title: percent === 0 ? t('settings.cc.player.confirmPauseTitle') : t('settings.cc.player.confirmNarrowTitle'),
        message: t('settings.cc.player.confirmNarrowBody', {
          percent,
          screens: totalScreens,
        }),
        confirmLabel: t('settings.cc.player.confirmNarrowLabel'),
        tone: 'warn',
      });
      if (!ok) return;
    }

    setSaving(true);
    try {
      if (windowDirty) {
        await updateWindow.mutateAsync({
          start: start || null,
          end: end || null,
          timezone: timezone || null,
        });
      }
      if (canaryDirty) {
        await updateCanary.mutateAsync({ percent, soakHours, autoPromote });
      }
      // Re-read authoritative state before claiming anything (§13.2).
      const [w, c] = await Promise.all([
        windowDirty ? windowQ.refetch() : Promise.resolve(null),
        canaryDirty ? canaryQ.refetch() : Promise.resolve(null),
      ]);
      if ((windowDirty && w && w.isError) || (canaryDirty && c && c.isError)) {
        setErrors([{ message: t('settings.cc.player.errReadBack') }]);
        return;
      }
      setPolicySavedAt(Date.now());
    } catch (e: any) {
      // Input is preserved — the local state above is untouched (§13.1).
      setErrors([{ message: e?.message || t('settings.cc.player.errSaveFailed') }]);
      document.getElementById('player-error-summary')?.focus();
    } finally {
      setSaving(false);
    }
  }, []);

  const handleDiscard = useCallback(() => {
    liveRef.current.hydrateWindow();
    liveRef.current.hydrateCanary();
    setErrors([]);
  }, []);

  const save = useMemo(
    () => (canManage ? { dirty: dirtyCount, saving, onSave: handleSave, onDiscard: handleDiscard } : undefined),
    [canManage, dirtyCount, saving, handleSave, handleDiscard],
  );

  // ── Auto-update: an immediate policy action, confirmed before turning ON ──
  const autoUpdateEnabled = !!autoUpdateQ.data?.enabled;
  const handleAutoUpdate = async (next: boolean) => {
    if (next) {
      const ok = await appConfirm({
        title: t('settings.cc.player.confirmAutoUpdateTitle'),
        message: t('settings.cc.player.confirmAutoUpdateBody'),
        confirmLabel: t('settings.cc.player.confirmAutoUpdateLabel'),
        tone: 'warn',
      });
      if (!ok) return;
    }
    setAutoUpdateNote(null);
    try {
      await toggleAutoUpdate.mutateAsync(next);
      const re = await autoUpdateQ.refetch();
      if (re.isError) {
        setAutoUpdateNote(t('settings.cc.player.errReadBack'));
        return;
      }
      setAutoUpdateNote(t('settings.cc.player.policySavedPlain'));
    } catch (e: any) {
      setAutoUpdateNote(e?.message || t('settings.cc.player.errSaveFailed'));
    }
  };

  // ── Promote the cohort to 100% — an impact-confirmed rollout action ──
  const handlePromote = async () => {
    const ok = await appConfirm({
      title: t('settings.cc.player.confirmPromoteTitle'),
      message: t('settings.cc.player.confirmPromoteBody', { screens: rollout.counts.total }),
      confirmLabel: t('settings.cc.player.confirmPromoteLabel'),
      tone: 'warn',
    });
    if (!ok) return;
    setSaving(true);
    try {
      await updateCanary.mutateAsync({ percent: 100 });
      await canaryQ.refetch();
      setPolicySavedAt(Date.now());
    } catch (e: any) {
      setErrors([{ message: e?.message || t('settings.cc.player.errSaveFailed') }]);
    } finally {
      setSaving(false);
    }
  };

  const apkHref = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1'}/player/apk/latest`;
  const tenantName = (tenant as { name?: string } | undefined)?.name ?? '';
  const stateLabel = t(`settings.cc.player.state.${STATE_KEY[rollout.state]}`);
  const soakHoursLeft = rollout.soakRemainingMs !== null ? Math.ceil(rollout.soakRemainingMs / 3_600_000) : null;
  const windowLabel = rollout.windowConfigured
    ? `${windowCfg!.start}–${windowCfg!.end} ${windowCfg!.timezone}`
    : t('settings.ota.notSetInstallsImmediately');

  /**
   * The frame registration is an effect keyed on these props, so they MUST be
   * referentially stable — an inline array/node here re-registers on every
   * render and the shell re-renders in a loop.
   */
  const scope = useMemo(() => ({ kind: 'organization' as const, label: tenantName }), [tenantName]);
  const searchItems = useMemo(
    () => [
        { label: t('settings.cc.player.searchApk'), anchor: 'player-version', keywords: ['apk', 'download', 'version', 'sideload'] },
        { label: t('settings.cc.player.searchAutoUpdate'), anchor: 'player-auto-update', keywords: ['auto update', 'ota', 'automatic'] },
        { label: t('settings.cc.player.searchWindow'), anchor: 'player-window', keywords: ['maintenance window', 'update window', 'install window', 'timezone'] },
        { label: t('settings.cc.player.searchCanary'), anchor: 'player-canary', keywords: ['canary', 'rollout', 'staged', 'cohort', 'soak'] },
        { label: t('settings.cc.player.searchRollout'), anchor: 'player-version', keywords: ['rollout', 'deployed', 'fleet versions'] },
        { label: t('settings.cc.player.searchUsb'), href: `/${schoolId}/settings/player/offline`, keywords: ['usb', 'sneakernet', 'signed bundle'] },
        { label: t('settings.cc.player.searchOffline'), href: `/${schoolId}/settings/player/offline`, keywords: ['offline', 'export'] },
        { label: t('settings.cc.player.searchDeviceKey'), href: `/${schoolId}/settings/player/offline`, keywords: ['device key', 'rotate', 'hmac', 'signing key'] },
    ],
    // `t` is deliberately not a dependency: next-intl returns a fresh function
    // every render, and these props feed a registration EFFECT — including it
    // would re-register on every render. A locale change remounts the tree.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [schoolId],
  );
  const contextRail = useMemo(
    () => (
        <>
          <ContextModule label={t('settings.cc.player.railDistribution')} title={t('settings.cc.player.railScreenCount', { count: rollout.counts.total })}>
            {rollout.counts.total === 0 ? (
              <span>{t('settings.cc.player.railNoScreens')}</span>
            ) : (
              <ul className="space-y-1">
                {rollout.distribution.map((b) => (
                  <li key={b.version ?? 'unknown'} className="flex items-center justify-between gap-2">
                    <span className="font-mono truncate">{b.version ? `v${b.version}` : t('settings.cc.player.railUnknownBucket')}</span>
                    <span className="shrink-0 tabular-nums">
                      {b.count}
                      {b.stale > 0 && <span className="ml-1 text-amber-700">{t('settings.cc.player.railStaleSuffix', { count: b.stale })}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </ContextModule>

          <ContextModule label={t('settings.cc.player.railStage')} title={stateLabel}>
            {rollout.canaryActive
              ? t('settings.cc.player.railCohort', { percent: canaryCfg?.percent ?? 100 })
              : t('settings.cc.player.railFullRollout')}
            {soakHoursLeft !== null && (
              <span className="block">
                {soakHoursLeft > 0
                  ? t('settings.cc.player.railSoakLeft', { hours: soakHoursLeft })
                  : t('settings.cc.player.railSoakElapsed')}
              </span>
            )}
          </ContextModule>

          <ContextModule label={t('settings.cc.player.railWindow')} title={windowLabel}>
            {rollout.windowConfigured
              ? t('settings.cc.player.railWindowTz', { tz: windowCfg!.timezone! })
              : t('settings.cc.player.railWindowNone')}
          </ContextModule>

          <ContextModule label={t('settings.cc.player.railLastChange')} title={policySavedAt ? new Date(policySavedAt).toLocaleString() : t('settings.cc.player.railNoChangeThisSession')}>
            {t('settings.cc.player.railAuditHint')}
            <ContextAction href={`/${schoolId}/audit`}>{t('settings.cc.player.railOpenAudit')}</ContextAction>
          </ContextModule>

          <ContextModule label={t('settings.cc.player.railAffected')} title={t('settings.cc.player.railAffectedTitle', { count: rollout.counts.total })}>
            {t('settings.cc.player.railAffectedBody')}
            <ContextAction href={`/${schoolId}/screens`}>{t('settings.cc.player.railOpenScreens')}</ContextAction>
          </ContextModule>
        </>
    ),
    // `t` omitted for the same reason as above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [schoolId, rollout, canaryCfg, windowCfg, stateLabel, soakHoursLeft, windowLabel, policySavedAt],
  );

  return (
    <SettingsPageFrame
      section="player"
      title={t('settings.shell.sections.player.label')}
      description={t('settings.shell.sections.player.description')}
      scope={scope}
      save={save}
      searchItems={searchItems}
      context={contextRail}
    >
      <EditorHead
        icon={MonitorPlay}
        title={t('settings.cc.player.editorTitle')}
        description={t('settings.cc.player.editorDescription')}
        badge={<StatusPill kind={STATE_PILL[rollout.state]} label={stateLabel} />}
      />

      <ErrorSummary id="player-error-summary" title={t('settings.cc.player.errSummaryTitle')} errors={errors} />

      {/* ── Rollout truth: policy vs telemetry, never merged ───────────── */}
      <div className="mb-5 rounded-[11px] border border-slate-200 bg-slate-50/70 px-4 py-3" aria-live="polite">
        <p className="text-[13px] text-slate-900">
          {verification
            ? t('settings.cc.player.verified', { verified: verification.verified, of: verification.of })
            : t('settings.cc.player.verifiedUnknown')}
        </p>
        <p className="mt-1 text-[12px] text-slate-500">
          {t('settings.cc.player.verifiedEvidence')}
          {(rollout.counts.stale > 0 || rollout.counts.unreported > 0) && (
            <>
              {' '}
              {t('settings.cc.player.verifiedNoTelemetry', {
                stale: rollout.counts.stale,
                unreported: rollout.counts.unreported,
              })}
            </>
          )}
        </p>
        {policySavedAt && (
          <p className="mt-2 text-[12px] font-medium text-emerald-800">
            {t('settings.cc.player.policySaved', { time: new Date(policySavedAt).toLocaleTimeString() })}
          </p>
        )}
        {rollout.counts.failed > 0 && (
          <p className="mt-2 flex items-start gap-1.5 text-[12px] font-medium text-red-800">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden />
            {t('settings.cc.player.failedOnDevices', { count: rollout.counts.failed })}
          </p>
        )}
      </div>

      {/* ── Current recommended version + manual APK ───────────────────── */}
      <EditorSection
        id="player-version"
        title={t('settings.cc.player.versionTitle')}
        description={t('settings.cc.player.versionDescription')}
        action={
          <SectionAction href={apkHref}>
            <Download className="w-3.5 h-3.5" aria-hidden />
            {t('settings.ota.downloadApk')}
          </SectionAction>
        }
      >
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 text-[13px]">
          <div>
            <dt className="text-[12px] text-slate-500">{t('settings.cc.player.recommendedVersion')}</dt>
            <dd className="font-mono text-slate-900">
              {latestLoading ? t('settings.cc.player.loading') : latest?.versionName ? `v${latest.versionName}` : t('settings.cc.player.versionUnknown')}
            </dd>
          </div>
          <div>
            <dt className="text-[12px] text-slate-500">{t('settings.cc.player.managerVersion')}</dt>
            <dd className="font-mono text-slate-900">
              {latest?.managerVersionName ? `v${latest.managerVersionName}` : t('settings.cc.player.versionUnknown')}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-[12px] text-slate-500">{t('settings.cc.player.platform')}</dt>
            <dd className="text-slate-700">{t('settingsIndex.apkDesc')}</dd>
          </div>
        </dl>
        <p className="mt-2.5 text-[12px] text-slate-500">
          {latest?.versionName
            ? t('settings.cc.player.releaseMetadataAbsent')
            : t('settings.cc.player.releaseFeedUnavailable')}
        </p>
      </EditorSection>

      {/* ── Automatic updates ─────────────────────────────────────────── */}
      <EditorSection
        id="player-auto-update"
        title={t('settings.ota.autoUpdateTitle')}
        description={autoUpdateEnabled ? t('settings.ota.autoUpdateOnDesc') : t('settings.ota.autoUpdateOffDesc')}
      >
        <div className="flex flex-wrap items-center gap-3">
          <StatusPill
            kind={autoUpdateEnabled ? 'attention' : 'ready'}
            label={autoUpdateEnabled ? t('settings.ota.on') : t('settings.ota.offRecommended')}
          />
          <button
            type="button"
            onClick={() => handleAutoUpdate(!autoUpdateEnabled)}
            disabled={!canManage || toggleAutoUpdate.isPending}
            aria-pressed={autoUpdateEnabled}
            className="inline-flex items-center gap-2 min-h-[40px] px-3 rounded-[10px] border border-slate-200 bg-white text-[13px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
          >
            {toggleAutoUpdate.isPending && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />}
            {autoUpdateEnabled ? t('settings.cc.player.turnAutoUpdateOff') : t('settings.cc.player.turnAutoUpdateOn')}
          </button>
          {autoUpdateNote && <span className="text-[12px] text-slate-600" aria-live="polite">{autoUpdateNote}</span>}
        </div>
        <p className="mt-2.5 text-[12px] text-slate-500">{t('settings.cc.player.autoUpdatePerScreenNote')}</p>
      </EditorSection>

      {/* ── Maintenance window ────────────────────────────────────────── */}
      <EditorSection
        id="player-window"
        title={t('settings.ota.installWindowTitle')}
        description={t('settings.ota.installWindowDesc')}
      >
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="ota-window-start" className="block text-[12px] font-medium text-slate-600">{t('settings.ota.start')}</label>
            <input
              id="ota-window-start"
              type="time"
              value={start}
              disabled={!canManage}
              onChange={(e) => setStart(e.target.value)}
              className="mt-1 px-2.5 py-2 bg-white border border-slate-200 rounded-[9px] text-[13px] font-mono disabled:bg-slate-50"
            />
          </div>
          <div>
            <label htmlFor="ota-window-end" className="block text-[12px] font-medium text-slate-600">{t('settings.ota.end')}</label>
            <input
              id="ota-window-end"
              type="time"
              value={end}
              disabled={!canManage}
              onChange={(e) => setEnd(e.target.value)}
              className="mt-1 px-2.5 py-2 bg-white border border-slate-200 rounded-[9px] text-[13px] font-mono disabled:bg-slate-50"
            />
          </div>
          <div className="flex-1 min-w-[200px]">
            <label htmlFor="ota-window-tz" className="block text-[12px] font-medium text-slate-600">{t('settings.ota.timezoneIana')}</label>
            <input
              id="ota-window-tz"
              type="text"
              value={timezone}
              disabled={!canManage}
              onChange={(e) => setTimezone(e.target.value)}
              placeholder="America/Chicago"
              className="mt-1 w-full px-2.5 py-2 bg-white border border-slate-200 rounded-[9px] text-[13px] font-mono disabled:bg-slate-50"
            />
          </div>
          {canManage && (start || end || timezone) && (
            <button
              type="button"
              onClick={() => { setStart(''); setEnd(''); setTimezone(''); }}
              className="min-h-[40px] px-3 rounded-[10px] border border-slate-200 bg-white text-[13px] font-medium text-slate-600 hover:bg-slate-50"
            >
              {t('settings.cc.player.clearWindow')}
            </button>
          )}
        </div>
        <p className="mt-2.5 flex items-start gap-1.5 text-[12px] text-slate-500">
          <Clock className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden />
          <span>
            {t('settings.ota.wraparoundPrefix')} <span className="font-mono">22:00 → 04:00</span> {t('settings.ota.wraparoundSuffix')}
            {' '}{t('settings.cc.player.windowTzNote')}
            {' '}{t('settings.cc.player.auditedChange')}
          </span>
        </p>
      </EditorSection>

      {/* ── Staged / canary rollout ───────────────────────────────────── */}
      <EditorSection
        id="player-canary"
        title={t('settings.ota.canaryTitle')}
        description={t('settings.ota.canaryDesc')}
        action={
          canManage && rollout.canaryActive ? (
            <SectionAction onClick={handlePromote}>
              <RefreshCw className="w-3.5 h-3.5" aria-hidden />
              {t('settings.cc.player.promoteToFull')}
            </SectionAction>
          ) : undefined
        }
      >
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label htmlFor="canary-percent" className="block text-[12px] font-medium text-slate-600">{t('settings.ota.cohortPercent')}</label>
            <input
              id="canary-percent"
              type="number"
              min={0}
              max={100}
              step={1}
              value={percent}
              disabled={!canManage}
              onChange={(e) => setPercent(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
              className="mt-1 w-24 px-2.5 py-2 bg-white border border-slate-200 rounded-[9px] text-[13px] font-mono disabled:bg-slate-50"
            />
          </div>
          <div>
            <label htmlFor="canary-soak" className="block text-[12px] font-medium text-slate-600">{t('settings.ota.soakHours')}</label>
            <input
              id="canary-soak"
              type="number"
              min={1}
              max={720}
              step={1}
              value={soakHours}
              disabled={!canManage}
              onChange={(e) => setSoakHours(Math.max(1, Math.min(720, Number(e.target.value) || 24)))}
              className="mt-1 w-24 px-2.5 py-2 bg-white border border-slate-200 rounded-[9px] text-[13px] font-mono disabled:bg-slate-50"
            />
          </div>
          <label htmlFor="canary-auto-promote" className="flex items-center gap-2 min-h-[40px] text-[13px] text-slate-700">
            <input
              id="canary-auto-promote"
              type="checkbox"
              checked={autoPromote}
              disabled={!canManage}
              onChange={(e) => setAutoPromote(e.target.checked)}
              className="w-4 h-4"
              style={{ accentColor: 'var(--brand-primary)' }}
            />
            {t('settings.ota.autoPromoteAfterSoak')}
          </label>
        </div>
        <p className="mt-2.5 text-[12px] text-slate-500">
          {t('settings.ota.canaryHelp')} {t('settings.cc.player.auditedChange')}
        </p>
        {rollout.state === 'paused' && (
          <p className="mt-2 text-[12px] font-medium text-amber-800">{t('settings.cc.player.pausedNote')}</p>
        )}
      </EditorSection>

      {/* ── Offline continuity + device key ───────────────────────────── */}
      <EditorSection
        id="player-offline"
        title={t('settings.cc.player.offlineTitle')}
        description={t('settings.cc.player.offlineDescription')}
        action={
          <SectionAction href={`/${schoolId}/settings/player/offline`}>
            <Usb className="w-3.5 h-3.5" aria-hidden />
            {t('settings.cc.player.openOffline')}
          </SectionAction>
        }
      >
        <div className="flex flex-wrap items-center gap-3 text-[13px]">
          <StatusPill
            kind={usbQ.data?.enabled ? 'connected' : 'notConfigured'}
            label={usbQ.data?.enabled ? t('settings.usb.ingestEnabled') : t('settings.usb.ingestDisabled')}
          />
          <span className="inline-flex items-center gap-1.5 text-slate-600">
            <KeyRound className="w-3.5 h-3.5" aria-hidden />
            {usbQ.data?.hasKey
              ? usbQ.data.keyRotatedAt
                ? t('settings.usb.rotatedAt', { date: new Date(usbQ.data.keyRotatedAt).toLocaleString() })
                : t('settings.cc.player.railKeySetUndated')
              : t('settings.cc.player.railNoKey')}
          </span>
        </div>
        <p className="mt-2.5 text-[12px] text-slate-500">{t('settings.cc.player.keyRotationNote')}</p>
      </EditorSection>

      {!canManage && (
        <p className="mt-4 text-[12px] text-slate-500">{t('settings.cc.player.readOnlyNote')}</p>
      )}
    </SettingsPageFrame>
  );
}
