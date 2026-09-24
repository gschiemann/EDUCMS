'use client';

/**
 * /[schoolId]/settings/emergency — Emergency configuration (§7.5).
 *
 * Purpose: configure and VALIDATE alert readiness. This page is not the
 * trigger screen and never renders anything that could be mistaken for one.
 *
 * Structure (§7.5 content order — divider sections, not a card grid):
 *   1. Readiness summary
 *   2. Emergency capability enabled/configured state
 *   3. Delivery model — organization-wide or location-based
 *   4. Alert types and content wiring
 *   5. Floor-plan and location coverage
 *   6. Drill/test controls — DELIBERATELY ABSENT. No drill or test endpoint
 *      exists in the API (`apps/api/src/emergency/` has trigger, all-clear,
 *      readiness and nothing else), and §7.5 allows only controls that are
 *      "actually implemented". A "Run a drill" button that fires the real
 *      trigger endpoint would be a trigger wearing a test costume, and a
 *      disabled "coming soon" control is banned by §11. So: nothing.
 *   7. Audit/history link
 *
 * WHAT CHANGED 2026-09-02 (handoff §19.5). The master on/off used to live in
 * browser localStorage (`emergencyEnabled:${tenantId}`) — per-device,
 * per-profile, invisible to the server. It is now `Tenant.emergencyEnabled`
 * behind PUT /tenants/me/emergency-enabled, with an immutable audit row.
 * The old key is migrated once and deleted (see `useEnablementMigration`).
 *
 * SCOPE: configuration only. Nothing here touches the trigger / all-clear /
 * manifest path (CLAUDE.md "Emergency System (Load-Bearing)").
 *
 * The operator contract this page inherited (2026-05-25) is unchanged: the
 * operator never leaves this URL while configuring, floor-plan upload and
 * per-screen assignment happen inline, and turning the capability off is a
 * deliberate two-step (click a button, confirm a dialog) — never a control
 * you can hit by accident.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  ShieldCheck,
  ShieldOff,
  Loader2,
  Building2,
  MapPin,
  CheckCircle2,
  AlertTriangle,
  History,
  Stethoscope,
  Image as ImageIcon,
} from 'lucide-react';
import {
  useTenant,
  useAuditLog,
  useFloorPlans,
  useUploadFloorPlan,
  usePanicContent,
  useEmergencyEnablement,
  useSetEmergencyEnabled,
  useLocationBasedEmergencyConfig,
  useToggleLocationBasedEmergency,
  type PanicKind,
} from '@/hooks/use-api';
import { API_URL } from '@/lib/api-url';
import { useUIStore } from '@/store/ui-store';
import { PanicContentEditor } from '@/components/settings/PanicContentEditor';
import { EmergencyReadinessCard, useEmergencyReadiness } from '@/components/emergency/EmergencyReadinessCard';
import { EmbeddedFloorPlanView } from '@/components/floor-plans/EmbeddedFloorPlanView';
import { selectionAfterPlans } from '@/components/floor-plans/plan-selection';
import {
  SettingsPageFrame,
  ChoiceRow,
  ContextModule,
  EditorHead,
  EditorSection,
  ErrorSummary,
  PermissionDenied,
  ScopePath,
  StatusPill,
  useSettingsShellActions,
  type SettingsSearchItem,
} from '@/components/settings/shell';
import { appAlert, appConfirm } from '@/components/ui/app-dialog';

const CONFIG_ROLES = new Set(['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN']);
/** Roles allowed to see the raw delivery-path health report (§7.5 rail). */
const HEALTH_LINK_ROLES = new Set(['SUPER_ADMIN', 'DISTRICT_ADMIN']);

/** Anchor ids — also the `searchItems` targets for the ⌘K palette. */
const ANCHORS = {
  readiness: 'emergency-readiness',
  enablement: 'emergency-enabled',
  delivery: 'emergency-delivery',
  content: 'emergency-content',
  coverage: 'emergency-coverage',
  history: 'emergency-history',
} as const;

/** The six SRP alert types, in the two groups the operator thinks in. */
const CRITICAL_TYPES: ReadonlyArray<{ kind: PanicKind; accent: 'red' | 'orange' | 'rose' }> = [
  { kind: 'lockdown', accent: 'red' },
  { kind: 'evacuate', accent: 'orange' },
  { kind: 'medical', accent: 'rose' },
];
const AWARENESS_TYPES: ReadonlyArray<{ kind: PanicKind; accent: 'amber' | 'violet' | 'sky' }> = [
  { kind: 'secure', accent: 'amber' },
  { kind: 'weather', accent: 'violet' },
  { kind: 'hold', accent: 'sky' },
];
const ALL_KINDS: readonly PanicKind[] = [
  ...CRITICAL_TYPES.map((t) => t.kind),
  ...AWARENESS_TYPES.map((t) => t.kind),
];

// ────────────────────────────────────────────────────────────────
// Page
// ────────────────────────────────────────────────────────────────

export default function EmergencySettingsPage() {
  const t = useTranslations();
  const params = useParams<{ schoolId: string }>();
  const schoolId = params?.schoolId || '';
  const role = useUIStore((s) => (s.user as { role?: string } | undefined)?.role);
  const canConfigure = CONFIG_ROLES.has(role || '');

  const { data: tenant } = useTenant();
  const tenantName = (tenant as { name?: string } | undefined)?.name ?? '';

  // Runs for EVERY visitor, admin or not: a stale local answer must not
  // outlive the server's authority on anyone's machine.
  useEnablementMigration();

  const searchItems = useMemo<readonly SettingsSearchItem[]>(
    () => [
      { label: t('settings.cc.emergency.search.enable'), anchor: ANCHORS.enablement, keywords: ['on', 'off', 'capability'] },
      { label: t('settings.cc.emergency.search.delivery'), anchor: ANCHORS.delivery, keywords: ['location-based', 'organization-wide'] },
      { label: t('settings.cc.emergency.search.lockdown'), anchor: ANCHORS.content },
      { label: t('settings.cc.emergency.search.weather'), anchor: ANCHORS.content, keywords: ['shelter', 'storm'] },
      { label: t('settings.cc.emergency.search.evacuation'), anchor: ANCHORS.content, keywords: ['evacuate', 'fire', 'fire alarm'] },
      { label: t('settings.cc.emergency.search.floorPlans'), anchor: ANCHORS.coverage, keywords: ['map', 'building'] },
    ],
    [t],
  );

  return (
    <SettingsPageFrame
      section="emergency"
      title={t('settings.cc.emergency.title')}
      description={t('settings.cc.emergency.description')}
      scope={{ kind: 'organization', label: tenantName }}
      searchItems={searchItems}
      context={canConfigure ? <EmergencyContextRail role={role} /> : undefined}
    >
      {canConfigure ? (
        <EmergencyEditor schoolId={schoolId} />
      ) : (
        // §10: a forbidden deep link gets a permission page naming the
        // category — not a redirect, and not an empty editor that reads as
        // "emergency is not set up".
        <PermissionDenied sectionLabel={t('settings.cc.emergency.title')} />
      )}
    </SettingsPageFrame>
  );
}

// ────────────────────────────────────────────────────────────────
// Editor
// ────────────────────────────────────────────────────────────────

function EmergencyEditor({ schoolId }: { schoolId: string }) {
  const t = useTranslations();
  const { setSectionStatus } = useSettingsShellActions();
  const enablement = useEmergencyEnablement();
  const capabilityOn = enablement.enabled;

  // Readiness is only meaningful once the capability is on — grading a
  // capability the organization has turned off would manufacture an alarm.
  const readiness = useEmergencyReadiness({ enabled: capabilityOn && !enablement.isLoading });

  // §19.2 index status. `error` = a life-safety-critical piece is missing
  // (content or delivery), `attention` = it would deliver but has gaps.
  useEffect(() => {
    if (!capabilityOn || !readiness.data) {
      setSectionStatus('emergency', null);
      return;
    }
    const verdict = readiness.data.verdict;
    setSectionStatus(
      'emergency',
      verdict === 'NOT_CONFIGURED' ? 'error' : verdict === 'NEEDS_ATTENTION' ? 'attention' : null,
    );
  }, [capabilityOn, readiness.data, setSectionStatus]);
  // Clearing on unmount is separate on purpose: the effect above must not
  // re-clear-and-reset the dot on every readiness refetch.
  useEffect(() => () => setSectionStatus('emergency', null), [setSectionStatus]);

  return (
    <>
      <EditorHead
        icon={ShieldCheck}
        title={t('settings.cc.emergency.editorTitle')}
        description={t('settings.cc.emergency.editorDescription')}
      />

      {/* 1 — Readiness summary */}
      <EditorSection
        id={ANCHORS.readiness}
        title={t('settings.cc.emergency.readiness.title')}
        description={t('settings.cc.emergency.readiness.desc')}
      >
        {capabilityOn ? (
          <EmergencyReadinessCard />
        ) : (
          <p className="text-[13px] leading-[18px] text-slate-500">
            {t('settings.cc.emergency.readiness.disabled')}
          </p>
        )}
      </EditorSection>

      {/* 2 — Capability enabled/configured state */}
      <EnablementSection />

      {/* 3, 4, 5 */}
      {capabilityOn && <DeliveryAndContent schoolId={schoolId} />}

      {/* 6 — drill/test controls: none exist in the API. Nothing renders. */}

      {/* 7 — Audit / history */}
      <EditorSection
        id={ANCHORS.history}
        title={t('settings.cc.emergency.history.title')}
        description={t('settings.cc.emergency.history.desc')}
      >
        <Link
          href={`/${schoolId}/audit`}
          className="inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-[9px] border border-slate-200 bg-white text-[13px] font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
        >
          <History className="w-4 h-4" aria-hidden />
          {t('settings.cc.emergency.history.link')}
        </Link>
      </EditorSection>
    </>
  );
}

// ────────────────────────────────────────────────────────────────
// 2 — Capability enablement (server-backed)
// ────────────────────────────────────────────────────────────────

const ENABLEMENT_ERROR_ID = 'emergency-enabled-error';

function EnablementSection() {
  const t = useTranslations();
  const { enabled, locked, verticalStated, isLoading, isError } = useEmergencyEnablement();
  const setEnabled = useSetEmergencyEnabled();
  const [error, setError] = useState<string | null>(null);
  const [confirmedMessage, setConfirmedMessage] = useState<string | null>(null);

  const apply = async (next: boolean) => {
    const ok = await appConfirm(
      next
        ? {
            title: t('settings.cc.emergency.enablement.confirmOnTitle'),
            message: t('settings.cc.emergency.enablement.confirmOnBody'),
            confirmLabel: t('settings.cc.emergency.enablement.confirmOnCta'),
          }
        : {
            title: t('settings.cc.emergency.enablement.confirmOffTitle'),
            message: t('settings.cc.emergency.enablement.confirmOffBody'),
            confirmLabel: t('settings.cc.emergency.enablement.confirmOffCta'),
            tone: 'danger',
          },
    );
    if (!ok) return;
    setError(null);
    setConfirmedMessage(null);
    try {
      // §13.2 — no optimistic success. `mutateAsync` resolves only after the
      // tenant query has been re-read, so the confirmation below reports the
      // server's answer, never the button that was clicked.
      await setEnabled.mutateAsync(next);
      setConfirmedMessage(
        next
          ? t('settings.cc.emergency.enablement.savedOn')
          : t('settings.cc.emergency.enablement.savedOff'),
      );
    } catch (e: unknown) {
      const message = (e as { message?: string } | null)?.message
        || t('settings.cc.emergency.enablement.saveFailedFallback');
      setError(message);
      // The editor keeps showing the last state the SERVER confirmed — the
      // failed write changed nothing, and saying so is the whole point. Move
      // focus to the summary so a screen-reader operator is taken to the
      // explanation instead of being left on a button that did nothing.
      requestAnimationFrame(() => document.getElementById(ENABLEMENT_ERROR_ID)?.focus());
    }
  };

  return (
    <EditorSection
      id={ANCHORS.enablement}
      title={t('settings.cc.emergency.enablement.title')}
      description={t('settings.cc.emergency.enablement.desc')}
    >
      {error && (
        <ErrorSummary
          id={ENABLEMENT_ERROR_ID}
          title={t('settings.cc.emergency.enablement.saveFailed')}
          errors={[
            { message: error },
            { message: t('settings.cc.emergency.enablement.unchanged') },
          ]}
        />
      )}

      {isLoading ? (
        <p className="flex items-center gap-2 text-[13px] text-slate-500">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
          {t('settings.cc.emergency.enablement.loading')}
        </p>
      ) : isError ? (
        <p className="text-[13px] text-slate-600">{t('settings.cc.emergency.enablement.loadFailed')}</p>
      ) : (
        <div className="rounded-[11px] border border-slate-200 p-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0 flex items-start gap-3">
              {/* Emergency status colors are protected — never brand-tinted. */}
              <span
                className={`w-9 h-9 shrink-0 grid place-items-center rounded-[9px] ${
                  enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                }`}
              >
                {enabled ? <ShieldCheck className="w-4 h-4" aria-hidden /> : <ShieldOff className="w-4 h-4" aria-hidden />}
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <strong className="text-[13px] font-medium text-slate-900">
                    {enabled
                      ? t('settings.cc.emergency.enablement.onTitle')
                      : t('settings.cc.emergency.enablement.offTitle')}
                  </strong>
                  <StatusPill
                    kind={enabled ? 'ready' : 'notConfigured'}
                    label={
                      enabled
                        ? t('settings.cc.emergency.enablement.pillOn')
                        : t('settings.cc.emergency.enablement.pillOff')
                    }
                  />
                </div>
                <p className="mt-1 text-[12px] leading-[17px] text-slate-500 max-w-xl">
                  {enabled
                    ? t('settings.cc.emergency.enablement.onBody')
                    : t('settings.cc.emergency.enablement.offBody')}
                </p>
                {locked && (
                  <p className="mt-1.5 text-[12px] leading-[17px] text-slate-600">
                    {t('settings.cc.emergency.enablement.lockedNote')}
                  </p>
                )}
                {!locked && !verticalStated && enabled && (
                  <p className="mt-1.5 text-[12px] leading-[17px] text-slate-600" data-testid="emergency-industry-unset">
                    {t('settings.cc.emergency.enablement.industryUnsetNote')}
                  </p>
                )}
                {confirmedMessage && (
                  <p role="status" className="mt-1.5 text-[12px] leading-[17px] text-emerald-700">
                    {confirmedMessage}
                  </p>
                )}
              </div>
            </div>

            {!locked && (
              <button
                type="button"
                onClick={() => apply(!enabled)}
                disabled={setEnabled.isPending}
                className={`shrink-0 inline-flex items-center gap-2 min-h-[38px] px-3.5 rounded-[10px] text-[13px] font-medium disabled:opacity-60 ${
                  enabled
                    ? 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    : 'bg-rose-600 text-white hover:bg-rose-700'
                } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1`}
              >
                {setEnabled.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
                    {t('settings.cc.emergency.enablement.saving')}
                  </>
                ) : enabled ? (
                  t('settings.cc.emergency.enablement.turnOff')
                ) : (
                  t('settings.cc.emergency.enablement.turnOn')
                )}
              </button>
            )}
          </div>
        </div>
      )}
    </EditorSection>
  );
}

/**
 * One-time migration off the browser-localStorage gate.
 *
 * If this browser still holds `emergencyEnabled:${tenantId}` AND the server
 * has never been told (`stored === null`), an admin's browser hands that last
 * local answer to the server exactly once, then deletes the key. Everyone
 * else just deletes it — a stale local value must not outlive the server's
 * authority, and a non-admin cannot write the column anyway.
 *
 * A locked (K-12) tenant never PUTs: the column cannot be `false` there, and
 * writing `true` would only restate the always-on contract.
 */
function useEnablementMigration() {
  const { data: tenant } = useTenant();
  const tenantId = (tenant as { id?: string } | undefined)?.id ?? '';
  const { stored, locked, isLoading } = useEmergencyEnablement();
  const setEnabled = useSetEmergencyEnabled();
  const role = useUIStore((s) => (s.user as { role?: string } | undefined)?.role);
  // Guards the effect against React StrictMode's double mount in dev and
  // against a re-run when the tenant query refetches.
  const doneRef = useRef(false);

  const mutate = setEnabled.mutateAsync;
  const run = useCallback(async () => {
    if (doneRef.current || isLoading || !tenantId || typeof window === 'undefined') return;
    const key = `emergencyEnabled:${tenantId}`;
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(key);
    } catch {
      // Private mode / storage disabled — there is nothing to migrate.
      doneRef.current = true;
      return;
    }
    if (raw !== 'true' && raw !== 'false') {
      doneRef.current = true;
      return;
    }
    doneRef.current = true;
    const shouldPut = stored === null && !locked && CONFIG_ROLES.has(role || '');
    if (shouldPut) {
      try {
        await mutate(raw === 'true');
      } catch {
        // The server refused or is unreachable. Leave the key in place so a
        // later load can try again rather than losing the operator's answer.
        doneRef.current = false;
        return;
      }
    }
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* nothing to do — the key is unreadable anyway */
    }
  }, [isLoading, tenantId, stored, locked, role, mutate]);

  useEffect(() => {
    void run();
  }, [run]);
}

// ────────────────────────────────────────────────────────────────
// 3 / 4 / 5 — delivery model, content wiring, coverage
// ────────────────────────────────────────────────────────────────

function DeliveryAndContent({ schoolId }: { schoolId: string }) {
  const t = useTranslations();
  const { data: cfg, isLoading, isError } = useLocationBasedEmergencyConfig();
  const toggle = useToggleLocationBasedEmergency();
  const locationMode = !!cfg?.enabled;
  const [error, setError] = useState<string | null>(null);

  const switchMode = async (target: string) => {
    const wantLocation = target === 'location';
    if (wantLocation === locationMode) return;
    if (!wantLocation) {
      const ok = await appConfirm({
        title: t('settings.cc.emergency.delivery.confirmBackTitle'),
        message: t('settings.cc.emergency.delivery.confirmBackBody'),
        confirmLabel: t('settings.cc.emergency.delivery.confirmBackCta'),
      });
      if (!ok) return;
    }
    setError(null);
    try {
      await toggle.mutateAsync(wantLocation);
    } catch (e: unknown) {
      setError((e as { message?: string } | null)?.message || t('settings.cc.emergency.delivery.saveFailedFallback'));
    }
  };

  return (
    <>
      <EditorSection
        id={ANCHORS.delivery}
        title={t('settings.cc.emergency.delivery.title')}
        description={t('settings.cc.emergency.delivery.desc')}
      >
        {error && (
          <ErrorSummary title={t('settings.cc.emergency.delivery.saveFailed')} errors={[{ message: error }]} />
        )}
        {isLoading ? (
          <p className="flex items-center gap-2 text-[13px] text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
            {t('settings.cc.emergency.delivery.loading')}
          </p>
        ) : isError ? (
          <p className="text-[13px] text-slate-600">{t('settings.cc.emergency.delivery.loadFailed')}</p>
        ) : (
          <div className="grid gap-2">
            <ChoiceRow
              icon={Building2}
              name="emergency-delivery-model"
              value="organization"
              checked={!locationMode}
              disabled={toggle.isPending}
              onChange={switchMode}
              title={t('settings.cc.emergency.delivery.orgTitle')}
              description={t('settings.cc.emergency.delivery.orgBody')}
            />
            <ChoiceRow
              icon={MapPin}
              name="emergency-delivery-model"
              value="location"
              checked={locationMode}
              disabled={toggle.isPending}
              onChange={switchMode}
              title={t('settings.cc.emergency.delivery.locationTitle')}
              description={t('settings.cc.emergency.delivery.locationBody')}
            />
          </div>
        )}
      </EditorSection>

      <EditorSection
        id={ANCHORS.content}
        title={t('settings.cc.emergency.content.title')}
        description={t('settings.cc.emergency.content.desc')}
      >
        <h4 className="text-[12px] font-medium text-slate-500 mb-2">
          {t('settings.cc.emergency.content.criticalGroup')}
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {CRITICAL_TYPES.map(({ kind, accent }) => (
            <PanicContentEditor
              key={kind}
              kind={kind}
              accent={accent}
              label={t(`settings.cc.emergency.types.${kind}.label`)}
              hint={t(`settings.cc.emergency.types.${kind}.hint`)}
            />
          ))}
        </div>
        <h4 className="text-[12px] font-medium text-slate-500 mt-5 mb-2">
          {t('settings.cc.emergency.content.awarenessGroup')}
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {AWARENESS_TYPES.map(({ kind, accent }) => (
            <PanicContentEditor
              key={kind}
              kind={kind}
              accent={accent}
              label={t(`settings.cc.emergency.types.${kind}.label`)}
              hint={t(`settings.cc.emergency.types.${kind}.hint`)}
            />
          ))}
        </div>
      </EditorSection>

      <EditorSection
        id={ANCHORS.coverage}
        title={t('settings.cc.emergency.coverage.title')}
        description={t('settings.cc.emergency.coverage.desc')}
      >
        {locationMode ? (
          <LocationCoverage schoolId={schoolId} />
        ) : (
          <p className="text-[13px] leading-[18px] text-slate-500">
            {t('settings.cc.emergency.coverage.orgModeNote')}
          </p>
        )}
      </EditorSection>
    </>
  );
}

// ────────────────────────────────────────────────────────────────
// 5 — floor plans, INLINE (no nav-away; the 2026-05-25 contract)
// ────────────────────────────────────────────────────────────────

function LocationCoverage({ schoolId }: { schoolId: string }) {
  const t = useTranslations();
  const { data: rawFloorPlans, isLoading: plansLoading } = useFloorPlans();
  const [activePlanId, setActivePlanId] = useState<string | null>(null);
  const [addPlanOpen, setAddPlanOpen] = useState(false);
  // A plan deleted from the embedded view is still in the cached list until
  // the refetch lands. Drop it here the moment it's gone, or the auto-select
  // effect below bounces the operator straight back onto an id the server no
  // longer has and the pane reads "Floor plan not found".
  const [deletedPlanIds, setDeletedPlanIds] = useState<string[]>([]);
  const floorPlans = useMemo(
    () => (rawFloorPlans || []).filter((p) => !deletedPlanIds.includes(p.id)),
    [rawFloorPlans, deletedPlanIds],
  );

  // Auto-select the first plan whenever the list changes — and re-select
  // sanely when the plan the operator was standing on is deleted.
  useEffect(() => {
    setActivePlanId((prev) => selectionAfterPlans(floorPlans, prev));
  }, [floorPlans]);

  if (plansLoading) {
    return (
      <p className="flex items-center gap-2 text-[13px] text-slate-500">
        <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
        {t('settings.cc.emergency.coverage.loading')}
      </p>
    );
  }

  if (floorPlans.length === 0) {
    return (
      <div>
        <p className="text-[13px] leading-[18px] text-slate-600 mb-3 max-w-2xl">
          {t('settings.cc.emergency.coverage.emptyBody')}
        </p>
        <InlineFloorPlanUpload onUploaded={() => {}} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-[12px] text-slate-500">{t('settings.cc.emergency.coverage.pinHint')}</p>
        <button
          type="button"
          onClick={() => setAddPlanOpen((v) => !v)}
          className="inline-flex items-center min-h-[32px] px-2.5 rounded-lg border border-slate-200 bg-white text-[12px] font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
        >
          {addPlanOpen
            ? t('settings.cc.emergency.coverage.cancelAdd')
            : t('settings.cc.emergency.coverage.addPlan')}
        </button>
      </div>

      {addPlanOpen && (
        <div className="rounded-[11px] border border-slate-200 bg-slate-50 p-3">
          <InlineFloorPlanUpload onUploaded={() => setAddPlanOpen(false)} />
        </div>
      )}

      {floorPlans.length > 1 && (
        <div className="flex flex-wrap gap-1.5 border-b border-slate-200 pb-2">
          {floorPlans.map((p) => {
            const isActive = p.id === activePlanId;
            const sub = [p.buildingLabel, p.floorLabel].filter(Boolean).join(' · ');
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setActivePlanId(p.id)}
                aria-pressed={isActive}
                className={`inline-flex items-center gap-1.5 min-h-[32px] px-2.5 rounded-lg border text-[12px] font-medium ${
                  isActive ? 'border-slate-300 bg-slate-100 text-slate-900' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1`}
              >
                <Building2 className="w-3.5 h-3.5" aria-hidden />
                <span>{p.name}</span>
                {sub && <span className="font-normal opacity-70">· {sub}</span>}
              </button>
            );
          })}
        </div>
      )}

      {activePlanId && (
        <EmbeddedFloorPlanView
          key={activePlanId}
          planId={activePlanId}
          schoolId={schoolId}
          mode="embedded"
          // Deleting the plan you're standing on must not leave a blank pane
          // (or a "Floor plan not found") while the list refetches.
          onPlanDeleted={(deletedId) =>
            setDeletedPlanIds((prev) => (prev.includes(deletedId) ? prev : [...prev, deletedId]))
          }
        />
      )}
    </div>
  );
}

/**
 * Inline floor-plan upload — single-step flow, unchanged from the pre-shell
 * page (2026-05-25). One button → file picker → preview + labels → Save.
 */
function InlineFloorPlanUpload({ onUploaded }: { onUploaded: () => void }) {
  const upload = useUploadFloorPlan();
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [buildingLabel, setBuildingLabel] = useState('');
  const [floorLabel, setFloorLabel] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const previewUrl = file ? URL.createObjectURL(file) : null;
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const handleFile = (f: File | null) => {
    if (!f) return;
    setFile(f);
    // Auto-fill the name from the filename — the operator can override.
    setName(f.name.replace(/\.[^.]+$/, ''));
    setErr(null);
  };

  const reset = () => {
    setFile(null);
    setName('');
    setBuildingLabel('');
    setFloorLabel('');
    setErr(null);
  };

  const handleSubmit = async () => {
    if (!file || !name.trim()) return;
    setErr(null);
    try {
      await upload.mutateAsync({
        file,
        name: name.trim(),
        buildingLabel: buildingLabel.trim() || undefined,
        floorLabel: floorLabel.trim() || undefined,
      });
      reset();
      onUploaded();
    } catch (e: unknown) {
      const msg =
        (e as { message?: string } | null)?.message
        || 'Could not upload. Make sure the file is a PNG / JPG / WEBP under 25 MB.';
      setErr(msg);
      await appAlert({ title: 'Upload failed', message: msg, tone: 'danger' });
    }
  };

  if (!file) {
    return (
      <div>
        <label className="inline-flex items-center gap-2 min-h-[38px] px-3.5 rounded-[10px] bg-white border border-slate-200 text-[13px] font-medium text-slate-700 hover:bg-slate-50 cursor-pointer">
          <ImageIcon className="w-4 h-4" aria-hidden />
          Choose floor plan image
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            onChange={(e) => handleFile(e.target.files?.[0] || null)}
          />
        </label>
        <p className="text-[12px] text-slate-500 mt-2">
          PNG / JPG / WEBP, up to 25 MB. We&rsquo;ll detect the image dimensions automatically.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 p-3 rounded-[10px] bg-white border border-slate-200">
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt="Floor plan preview" className="w-14 h-14 rounded object-cover border border-slate-200" />
        ) : (
          <div className="w-14 h-14 rounded bg-slate-100 grid place-items-center">
            <ImageIcon className="w-5 h-5 text-slate-400" aria-hidden />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium text-slate-900 truncate">{file.name}</div>
          <div className="text-[12px] text-slate-500">{Math.round(file.size / 1024)} KB</div>
        </div>
        <button type="button" onClick={reset} className="text-[12px] font-medium text-slate-500 hover:text-slate-800">
          Pick a different file
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <label className="text-[12px] font-medium text-slate-600 flex flex-col gap-1">
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. North wing"
            maxLength={80}
            className="min-h-[38px] px-3 border border-slate-200 rounded-[9px] text-[13px] font-normal text-slate-900"
          />
        </label>
        <label className="text-[12px] font-medium text-slate-600 flex flex-col gap-1">
          Building
          <input
            value={buildingLabel}
            onChange={(e) => setBuildingLabel(e.target.value)}
            placeholder="Optional, e.g. Main"
            maxLength={40}
            className="min-h-[38px] px-3 border border-slate-200 rounded-[9px] text-[13px] font-normal text-slate-900"
          />
        </label>
        <label className="text-[12px] font-medium text-slate-600 flex flex-col gap-1">
          Floor
          <input
            value={floorLabel}
            onChange={(e) => setFloorLabel(e.target.value)}
            placeholder="Optional, e.g. 2"
            maxLength={20}
            className="min-h-[38px] px-3 border border-slate-200 rounded-[9px] text-[13px] font-normal text-slate-900"
          />
        </label>
      </div>

      {err && (
        <div className="text-[12px] text-red-900 bg-red-50 border border-red-200 rounded-[9px] px-3 py-2 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden /> {err}
        </div>
      )}

      <div className="flex gap-2 items-center">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!name.trim() || upload.isPending}
          className="inline-flex items-center gap-2 min-h-[38px] px-3.5 rounded-[10px] bg-slate-900 text-white text-[13px] font-medium disabled:opacity-50"
        >
          {upload.isPending ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <CheckCircle2 className="w-4 h-4" aria-hidden />}
          {upload.isPending ? 'Saving…' : 'Save floor plan'}
        </button>
        <button
          type="button"
          onClick={reset}
          disabled={upload.isPending}
          className="text-[12px] font-medium text-slate-500 hover:text-slate-800 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Context rail (§6.6 / §7.5)
// ────────────────────────────────────────────────────────────────

function EmergencyContextRail({ role }: { role?: string }) {
  const t = useTranslations();
  const { enabled: capabilityOn, isLoading: enablementLoading } = useEmergencyEnablement();
  const readiness = useEmergencyReadiness({ enabled: capabilityOn && !enablementLoading });
  const { data: cfg } = useLocationBasedEmergencyConfig();
  const locationMode = !!cfg?.enabled;

  if (!capabilityOn) {
    return (
      <ContextModule label={t('settings.cc.emergency.rail.capability')} title={t('settings.cc.emergency.enablement.offTitle')}>
        {t('settings.cc.emergency.rail.capabilityOffBody')}
      </ContextModule>
    );
  }

  const items = readiness.data?.items ?? [];
  const screens = items.find((i) => i.key === 'screens');

  return (
    <>
      <AlertTypeRail />

      {/* Coverage — only what the server can actually attest to. */}
      {screens && (
        <ContextModule label={t('settings.cc.emergency.rail.coverage')} title={screens.detail}>
          {locationMode ? t('settings.cc.emergency.rail.coverageLocation') : t('settings.cc.emergency.rail.coverageOrg')}
        </ContextModule>
      )}

      <ContextModule label={t('settings.cc.emergency.rail.scope')}>
        <ScopePath
          from={t('settings.cc.emergency.rail.scopeOrganization')}
          to={locationMode ? t('settings.cc.emergency.rail.scopePerScreen') : t('settings.cc.emergency.rail.scopeAllScreens')}
        />
      </ContextModule>

      <LastExercisedModule enabled={CONFIG_ROLES.has(role || '')} />

      {HEALTH_LINK_ROLES.has(role || '') && (
        <ContextModule label={t('settings.cc.emergency.rail.health')}>
          {t('settings.cc.emergency.rail.healthHint')}
          <a
            href={`${API_URL}/health/emergency-path`}
            target="_blank"
            rel="noreferrer"
            className="mt-2.5 w-full min-h-[36px] inline-flex items-center justify-center gap-1.5 rounded-[9px] border border-slate-200 bg-white text-[12px] font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
          >
            <Stethoscope className="w-3.5 h-3.5" aria-hidden />
            {t('settings.cc.emergency.rail.healthLink')}
          </a>
        </ContextModule>
      )}
    </>
  );
}

/**
 * Readiness BY ALERT TYPE. Sourced from the same `panic-content` queries the
 * editors below use (identical query keys → one request each, shared cache),
 * so a type reads "Configured" only when the server actually holds media for
 * it in at least one orientation.
 */
function AlertTypeRail() {
  const t = useTranslations();
  // Hooks must be unconditional and in a stable order: one fixed-length list,
  // one query per kind, never a loop over server-driven data.
  const lockdown = usePanicContent('lockdown', 'landscape');
  const lockdownP = usePanicContent('lockdown', 'portrait');
  const evacuate = usePanicContent('evacuate', 'landscape');
  const evacuateP = usePanicContent('evacuate', 'portrait');
  const medical = usePanicContent('medical', 'landscape');
  const medicalP = usePanicContent('medical', 'portrait');
  const secure = usePanicContent('secure', 'landscape');
  const secureP = usePanicContent('secure', 'portrait');
  const weather = usePanicContent('weather', 'landscape');
  const weatherP = usePanicContent('weather', 'portrait');
  const hold = usePanicContent('hold', 'landscape');
  const holdP = usePanicContent('hold', 'portrait');

  const pairs = [
    [lockdown, lockdownP],
    [evacuate, evacuateP],
    [medical, medicalP],
    [secure, secureP],
    [weather, weatherP],
    [hold, holdP],
  ] as const;

  return (
    <ContextModule label={t('settings.cc.emergency.rail.byType')}>
      <ul className="mt-1 space-y-1.5">
        {ALL_KINDS.map((kind, i) => {
          const [land, port] = pairs[i];
          const loaded = !land.isLoading && !port.isLoading;
          const count = (land.data?.items?.length ?? 0) + (port.data?.items?.length ?? 0);
          return (
            <li key={kind} className="flex items-center justify-between gap-2">
              <span className="text-[12px] text-slate-600">{t(`settings.cc.emergency.types.${kind}.label`)}</span>
              {loaded ? (
                <StatusPill
                  kind={count > 0 ? 'ready' : 'notConfigured'}
                  label={
                    count > 0
                      ? t('settings.cc.emergency.rail.typeConfigured')
                      : t('settings.cc.emergency.rail.typeNotConfigured')
                  }
                />
              ) : (
                <StatusPill kind="unknown" label={t('settings.cc.emergency.rail.typeChecking')} />
              )}
            </li>
          );
        })}
      </ul>
    </ContextModule>
  );
}

/**
 * "Last successful verification". The only evidence that exists is the audit
 * row for the last real trigger — so that is what this reports, with its real
 * timestamp, and the module renders NOTHING when there is no such row. It
 * never invents a "last verified" from a page load.
 */
function LastExercisedModule({ enabled }: { enabled: boolean }) {
  const t = useTranslations();
  const { data } = useAuditLog({ action: 'TRIGGER_EMERGENCY', limit: 1, enabled });
  const row = data?.items?.[0] as { createdAt?: string } | undefined;
  if (!row?.createdAt) return null;
  const when = new Date(row.createdAt);
  if (Number.isNaN(when.getTime())) return null;
  return (
    <ContextModule label={t('settings.cc.emergency.rail.lastExercised')} title={when.toLocaleString()}>
      {t('settings.cc.emergency.rail.lastExercisedBody')}
    </ContextModule>
  );
}
