"use client";

/**
 * SSO configuration — the editor body of /[schoolId]/settings/people/sso
 * (and the preserved old URL /[schoolId]/settings/sso, §8).
 *
 * MOVED, not rewritten, from `app/[schoolId]/settings/sso/page.tsx`:
 * SAML/OIDC config, SP metadata, domain + auto-provision, the rank-limited
 * `defaultRole` picker (`tenantRoleOptions` — SUPER_ADMIN is never offered
 * from a tenant surface) and the test-configuration flow all survive
 * unchanged. The API (`@RequireRoles('SUPER_ADMIN','DISTRICT_ADMIN')` on
 * GET/POST/test) remains the authority.
 *
 * What the shell migration adds (§13.2 — access/SSO is a critical setting):
 *   - a real dirty count driving the shared Save / Discard header buttons
 *   - no optimistic success: Save awaits the server, then RE-READS the
 *     stored config before the form reports itself clean
 *   - an ErrorSummary at the top of the editor on failure, focused after
 *     submit, with every typed value preserved
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Shield, Loader2, CheckCircle2, AlertCircle, Copy } from 'lucide-react';
import { API_URL } from '@/lib/api-url';
import { apiFetch } from '@/lib/api-client';
import { useUIStore } from '@/store/ui-store';
import { tenantRoleOptions } from '@/lib/role-assignment';
import { useTenantCopy } from '@/hooks/use-tenant-copy';
import { useTenant } from '@/hooks/use-api';
import { SettingsPageFrame } from '@/components/settings/shell/SettingsPageFrame';
import {
  EditorHead, EditorSection, ErrorSummary, EditorSkeleton, PermissionDenied, StatusPill,
  ContextModule, ContextAction,
} from '@/components/settings/shell/primitives';

type Provider = 'SAML' | 'OIDC';

export interface SsoConfigSafe {
  id: string;
  tenantId: string;
  provider: Provider;
  enabled: boolean;
  metadataUrl?: string | null;
  entityId?: string | null;
  acsUrl?: string | null;
  hasX509Cert?: boolean;
  oidcIssuer?: string | null;
  oidcClientId?: string | null;
  hasOidcClientSecret?: boolean;
  defaultRole: string;
  allowedEmailDomain?: string | null;
  autoProvision: boolean;
}

interface SpMeta {
  entityId: string;
  acsUrl: string;
  oidcRedirectUri: string;
}

/** Roles the SSO read endpoint accepts. Presentation mirror only. */
export const SSO_ROLES = ['SUPER_ADMIN', 'DISTRICT_ADMIN'];

/**
 * GET /tenants/:tenantSlug/sso — shared by this editor and the People
 * context rail so the summary and the form never disagree.
 */
export function useSsoSettings(tenantSlug: string, enabled: boolean) {
  return useQuery<{ config: SsoConfigSafe | null; sp: SpMeta | null }>({
    queryKey: ['sso-config', tenantSlug],
    queryFn: () => apiFetch(`/tenants/${tenantSlug}/sso`),
    enabled: enabled && !!tenantSlug,
  });
}

function CopyField({ label, value }: { label: string; value: string }) {
  const t = useTranslations();
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-[10px] bg-slate-50 border border-slate-200 p-3">
      <p className="text-[11px] font-medium tracking-[.06em] uppercase text-slate-500 mb-1">{label}</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 text-[12px] text-slate-700 select-all break-all">{value}</code>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            } catch { /* clipboard unavailable — the value is selectable */ }
          }}
          className="shrink-0 w-9 h-9 grid place-items-center rounded-[8px] text-slate-400 hover:text-slate-900 hover:bg-white"
          aria-label={`${t('settings.common.copy')} ${label}`}
        >
          {copied ? <CheckCircle2 className="w-4 h-4 text-emerald-500" aria-hidden /> : <Copy className="w-4 h-4" aria-hidden />}
        </button>
      </div>
    </div>
  );
}

function Field({ id, label, value, onChange, placeholder, type = 'text' }: {
  id: string; label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-[12px] font-medium text-slate-700 mb-1">{label}</label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full min-h-[42px] px-3 rounded-[9px] border border-slate-300 bg-white text-[13px]"
      />
    </div>
  );
}

const EMPTY_FORM = {
  provider: 'SAML' as Provider,
  enabled: false,
  metadataUrl: '',
  entityId: '',
  acsUrl: '',
  x509Cert: '',
  oidcIssuer: '',
  oidcClientId: '',
  oidcClientSecret: '',
  defaultRole: 'RESTRICTED_VIEWER',
  allowedEmailDomain: '',
  autoProvision: false,
};
type Form = typeof EMPTY_FORM;

function formFromConfig(c: SsoConfigSafe | null | undefined): Form {
  if (!c) return { ...EMPTY_FORM };
  return {
    provider: c.provider,
    enabled: c.enabled,
    metadataUrl: c.metadataUrl || '',
    entityId: c.entityId || '',
    acsUrl: c.acsUrl || '',
    x509Cert: '',
    oidcIssuer: c.oidcIssuer || '',
    oidcClientId: c.oidcClientId || '',
    oidcClientSecret: '',
    defaultRole: c.defaultRole || 'RESTRICTED_VIEWER',
    allowedEmailDomain: c.allowedEmailDomain || '',
    autoProvision: c.autoProvision,
  };
}

export function SsoSettingsEditor() {
  const t = useTranslations();
  const tenantCopy = useTenantCopy();
  const { schoolId } = useParams<{ schoolId: string }>();
  const role = useUIStore((s) => s.user?.role as string | undefined);
  const { data: tenant } = useTenant();
  const tenantName = (tenant as { name?: string } | undefined)?.name ?? '';
  const allowed = !!role && SSO_ROLES.includes(role);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [config, setConfig] = useState<SsoConfigSafe | null>(null);
  const [sp, setSp] = useState<SpMeta | null>(null);
  const [form, setForm] = useState<Form>({ ...EMPTY_FORM });
  const [baseline, setBaseline] = useState<Form>({ ...EMPTY_FORM });
  const errorRef = useRef<HTMLDivElement>(null);

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const getToken = () =>
    typeof window !== 'undefined' ? localStorage.getItem('auth_token') || '' : '';

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/tenants/${schoolId}/sso`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setSp(data.sp ?? null);
      setConfig(data.config ?? null);
      const next = formFromConfig(data.config);
      setForm(next);
      setBaseline(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [schoolId]);

  useEffect(() => {
    if (schoolId && allowed) loadConfig();
    else if (!allowed) setLoading(false);
  }, [schoolId, allowed, loadConfig]);

  // Dirty count drives the shared header Save button ("Save 2 changes", §6.2).
  const dirtyCount = useMemo(() => {
    let n = 0;
    (Object.keys(EMPTY_FORM) as (keyof Form)[]).forEach((k) => {
      if (form[k] !== baseline[k]) n += 1;
    });
    return n;
  }, [form, baseline]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    setTestResult(null);
    try {
      const body: Record<string, unknown> = {
        provider: form.provider,
        // SAML can't be armed in this build (the library was removed for
        // CVE-2025-54419 and the API forbids arming it) — never submit
        // enabled:true for SAML, which matches the disabled checkbox.
        enabled: form.provider === 'SAML' ? false : form.enabled,
        defaultRole: form.defaultRole,
        autoProvision: form.autoProvision,
        allowedEmailDomain: form.allowedEmailDomain || null,
      };
      if (form.provider === 'SAML') {
        body.metadataUrl = form.metadataUrl || null;
        body.entityId = form.entityId || null;
        body.acsUrl = form.acsUrl || null;
        if (form.x509Cert) body.x509Cert = form.x509Cert;
      } else {
        body.oidcIssuer = form.oidcIssuer || null;
        body.oidcClientId = form.oidcClientId || null;
        if (form.oidcClientSecret) body.oidcClientSecret = form.oidcClientSecret;
      }
      const res = await fetch(`${API_URL}/tenants/${schoolId}/sso`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.message || `HTTP ${res.status}`);
      }
      // §13.2 — no optimistic success. Re-read the stored config; only the
      // values that came BACK from the server become the new baseline.
      await loadConfig();
    } catch (e) {
      setError((e as Error).message);
      // Keep every typed value; move focus to the summary after a failed submit.
      setTimeout(() => errorRef.current?.focus(), 0);
      throw e;
    } finally {
      setSaving(false);
    }
  }, [form, schoolId, loadConfig]);

  const handleDiscard = useCallback(() => {
    setForm({ ...baseline });
    setError(null);
  }, [baseline]);

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`${API_URL}/tenants/${schoolId}/sso/test`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      setTestResult(data);
    } catch (e) {
      setTestResult({ ok: false, message: (e as Error).message });
    } finally {
      setTesting(false);
    }
  };

  const roleOptions = tenantRoleOptions(role, form.defaultRole);

  const statusKind = !config ? 'notConfigured' : config.enabled ? 'ready' : 'attention';
  const statusLabel = !config
    ? t('settings.cc.people.ssoNotConfigured')
    : config.enabled
      ? t('settings.cc.people.ssoEnabled')
      : t('settings.cc.people.ssoStored');

  const context = (
    <>
      <ContextModule label={t('settings.cc.people.railStatus')} title={statusLabel}>
        {t('settings.cc.people.ssoStatusHelp')}
      </ContextModule>
      <ContextModule label={t('settings.cc.people.railAppliesTo')} title={t('settings.cc.people.ssoAppliesTo')}>
        {t('settings.cc.people.ssoAppliesToHelp')}
        <ContextAction href={`/${schoolId}/settings/people`}>{t('settings.cc.people.backToPeople')}</ContextAction>
      </ContextModule>
    </>
  );

  return (
    <SettingsPageFrame
      section="people"
      title={t('settings.cc.people.ssoTitle')}
      description={t('settings.cc.people.ssoDescription')}
      subtitle={t('settings.cc.people.ssoBreadcrumb')}
      scope={{ kind: 'organization', label: tenantName }}
      save={allowed ? { dirty: dirtyCount, saving, onSave: handleSave, onDiscard: handleDiscard } : undefined}
      context={context}
      searchItems={[
        { label: t('settings.cc.people.ssoTitle'), keywords: ['sso', 'saml', 'oidc', 'login', 'okta'], href: `/${schoolId}/settings/people/sso` },
      ]}
    >
      {!allowed ? (
        <PermissionDenied sectionLabel={t('settings.cc.people.ssoTitle')} />
      ) : loading ? (
        <EditorSkeleton groups={3} />
      ) : (
        <>
          {error && (
            <div ref={errorRef} tabIndex={-1} className="focus:outline-none">
              <ErrorSummary title={t('settings.cc.people.ssoSaveFailed')} errors={[{ message: error }]} />
            </div>
          )}

          <EditorHead
            icon={Shield}
            title={t('settings.cc.people.ssoTitle')}
            description={t('settings.cc.people.ssoEditorDescription')}
            badge={<StatusPill kind={statusKind} label={statusLabel} className="ml-auto" />}
          />

          {sp && (
            <EditorSection
              id="sso-sp"
              title={t('streamingSso.spMetadata')}
              description={t('settings.cc.people.spMetadataHelp')}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <CopyField label={t('streamingSso.entityIdAudience')} value={sp.entityId} />
                <CopyField label="SAML ACS URL" value={sp.acsUrl} />
                <CopyField label={t('streamingSso.oidcRedirectUri')} value={sp.oidcRedirectUri} />
              </div>
            </EditorSection>
          )}

          <EditorSection
            id="sso-provider"
            title={t('streamingSso.identityProvider')}
            description={config?.enabled ? t('streamingSso.ssoEnabledForTenant') : t('streamingSso.ssoNotEnabled')}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label htmlFor="sso-provider-select" className="block text-[12px] font-medium text-slate-700 mb-1">
                  {t('streamingSso.providerType')}
                </label>
                <select
                  id="sso-provider-select"
                  value={form.provider}
                  onChange={(e) => set('provider', e.target.value as Provider)}
                  className="w-full min-h-[42px] px-3 rounded-[9px] border border-slate-300 bg-white text-[13px]"
                >
                  <option value="SAML">{t('streamingSso.samlOption')}</option>
                  <option value="OIDC">OIDC (Google Workspace, Auth0, Azure AD)</option>
                </select>
              </div>
              <div className="flex items-end">
                <label className={`inline-flex items-center gap-2 min-h-[42px] text-[13px] font-medium ${form.provider === 'SAML' ? 'text-slate-400' : 'text-slate-700'}`}>
                  <input
                    type="checkbox"
                    checked={form.provider === 'SAML' ? false : form.enabled}
                    disabled={form.provider === 'SAML'}
                    onChange={(e) => set('enabled', e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 disabled:opacity-50"
                  />
                  {t('streamingSso.enabled')}
                </label>
              </div>
            </div>

            {form.provider === 'SAML' ? (
              <div className="mt-3 space-y-3">
                {/* Honest state — SAML login cannot run in this build. */}
                <div className="flex items-start gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-[10px]">
                  <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" aria-hidden />
                  <p className="text-[12px] leading-[17px] text-amber-900">
                    <span className="font-semibold">{t('streamingSso.samlUnavailableBold')}</span>{' '}
                    {t('settings.cc.people.samlUnavailableBody')}
                  </p>
                </div>
                <Field id="sso-metadata-url" label={t('streamingSso.metadataUrlLabel')} value={form.metadataUrl}
                  onChange={(v) => set('metadataUrl', v)} placeholder="https://idp.example.com/saml/sso" />
                <Field id="sso-entity-id" label={t('streamingSso.idpEntityIdLabel')} value={form.entityId}
                  onChange={(v) => set('entityId', v)} placeholder="https://idp.example.com/saml/metadata" />
                <Field id="sso-acs-url" label={t('streamingSso.acsUrlLabel')} value={form.acsUrl}
                  onChange={(v) => set('acsUrl', v)} placeholder={sp?.acsUrl} />
                <div>
                  <label htmlFor="sso-x509" className="block text-[12px] font-medium text-slate-700 mb-1">
                    {t('streamingSso.idpSigningCert')}
                    {config?.hasX509Cert && (
                      <span className="ml-2 font-normal text-emerald-700">{t('streamingSso.currentlySetLeaveBlank')}</span>
                    )}
                  </label>
                  <textarea
                    id="sso-x509"
                    value={form.x509Cert}
                    onChange={(e) => set('x509Cert', e.target.value)}
                    rows={5}
                    className="w-full px-3 py-2 rounded-[9px] border border-slate-300 bg-white text-[12px] font-mono"
                  />
                </div>
              </div>
            ) : (
              <div className="mt-3 space-y-3">
                <Field id="sso-oidc-issuer" label={t('streamingSso.oidcIssuerUrl')} value={form.oidcIssuer}
                  onChange={(v) => set('oidcIssuer', v)} placeholder="https://accounts.google.com" />
                <Field id="sso-oidc-client" label={t('streamingSso.clientId')} value={form.oidcClientId}
                  onChange={(v) => set('oidcClientId', v)} placeholder="abc.apps.googleusercontent.com" />
                <div>
                  <label htmlFor="sso-oidc-secret" className="block text-[12px] font-medium text-slate-700 mb-1">
                    {t('streamingSso.clientSecret')}
                    {config?.hasOidcClientSecret && (
                      <span className="ml-2 font-normal text-emerald-700">{t('streamingSso.currentlySetLeaveBlank')}</span>
                    )}
                  </label>
                  <input
                    id="sso-oidc-secret"
                    type="password"
                    value={form.oidcClientSecret}
                    onChange={(e) => set('oidcClientSecret', e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full min-h-[42px] px-3 rounded-[9px] border border-slate-300 bg-white text-[13px]"
                  />
                </div>
              </div>
            )}
          </EditorSection>

          <EditorSection
            id="sso-provisioning"
            title={t('settings.cc.people.ssoProvisioningTitle')}
            description={t('settings.cc.people.ssoProvisioningDescription')}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label htmlFor="sso-default-role" className="block text-[12px] font-medium text-slate-700 mb-1">
                  {t('streamingSso.defaultRoleNewUsers')}
                </label>
                <select
                  id="sso-default-role"
                  value={form.defaultRole}
                  onChange={(e) => set('defaultRole', e.target.value)}
                  aria-describedby="sso-default-role-help"
                  className="w-full min-h-[42px] px-3 rounded-[9px] border border-slate-300 bg-white text-[13px]"
                >
                  {roleOptions.map((r) => (
                    <option key={r} value={r}>{tenantCopy.roleLabel(r)}</option>
                  ))}
                </select>
                <p id="sso-default-role-help" className="mt-1 text-[12px] text-slate-500">
                  {t('streamingSso.defaultRoleRankNote')}
                </p>
              </div>
              <Field id="sso-domain" label={t('streamingSso.allowedEmailDomain')} value={form.allowedEmailDomain}
                onChange={(v) => set('allowedEmailDomain', v)} placeholder="acme.edu" />
            </div>
            <label className="mt-3 inline-flex items-center gap-2 text-[13px] font-medium text-slate-700">
              <input
                type="checkbox"
                checked={form.autoProvision}
                onChange={(e) => set('autoProvision', e.target.checked)}
                className="w-4 h-4 rounded border-slate-300"
              />
              {t('streamingSso.autoCreateAccounts')}
            </label>
          </EditorSection>

          <EditorSection
            id="sso-test"
            title={t('settings.cc.people.ssoTestTitle')}
            description={t('settings.cc.people.ssoTestDescription')}
          >
            <button
              type="button"
              onClick={handleTest}
              disabled={testing}
              className="inline-flex items-center gap-1.5 min-h-[42px] px-4 rounded-[10px] border border-slate-200 bg-white text-[13px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {testing ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : null}
              {testing ? t('streamingSso.testing') : t('streamingSso.testConnection')}
            </button>
            {testResult && (
              <div
                role="status"
                className={`mt-3 flex items-start gap-2 px-3 py-2.5 rounded-[10px] border text-[12px] ${
                  testResult.ok
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-amber-50 border-amber-200 text-amber-900'
                }`}
              >
                {testResult.ok
                  ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
                  : <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />}
                <p className="font-medium">{testResult.message}</p>
              </div>
            )}
          </EditorSection>
        </>
      )}
    </SettingsPageFrame>
  );
}
