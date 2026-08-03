"use client";

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Shield, Loader2, CheckCircle2, AlertCircle, KeyRound, Copy } from 'lucide-react';
import { RoleGate } from '@/components/RoleGate';
import { API_URL } from '@/lib/api-url';
import { useAppStore } from '@/lib/store';
import { tenantRoleOptions } from '@/lib/role-assignment';

/**
 * SSO Settings — DISTRICT_ADMIN / SUPER_ADMIN only.
 *
 * Lets a district admin configure SAML 2.0 or OIDC for their tenant and shows
 * the generated SP metadata values (entity ID, ACS URL, OIDC redirect URI) for
 * IdP-side configuration.
 */

type Provider = 'SAML' | 'OIDC';

interface ConfigSafe {
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

/*
 * The `defaultRole` options are computed per-caller (see `tenantRoleOptions`),
 * not hard-coded.
 *
 * This list used to be a flat `['DISTRICT_ADMIN', 'SCHOOL_ADMIN',
 * 'CONTRIBUTOR', 'RESTRICTED_VIEWER']`. ACC-01 (2026-08-01) gave the writer a
 * rank gate — a caller may only assign roles strictly BELOW their own — which
 * made the first option a guaranteed 403 for the very role this page is gated
 * to: a DISTRICT_ADMIN cannot assign DISTRICT_ADMIN. The operator picked a
 * legitimate-looking option, saved, and got an error with no way to tell it
 * apart from a broken page. SUPER_ADMIN was never offered and never will be —
 * a tenant-scoped surface must not be able to mint a platform-owner role.
 */

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const doCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* ignore */
    }
  };
  return (
    <div className="bg-slate-50 rounded-lg p-3">
      <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">{label}</p>
      <div className="flex items-center gap-2">
        <code className="text-xs text-slate-700 select-all break-all flex-1">{value}</code>
        <button
          type="button"
          onClick={doCopy}
          className="text-slate-400 hover:text-indigo-500 transition-colors shrink-0"
          aria-label={`Copy ${label}`}
        >
          {copied ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}

export default function SsoSettingsPage() {
  const t = useTranslations();
  const { schoolId } = useParams<{ schoolId: string }>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [config, setConfig] = useState<ConfigSafe | null>(null);
  const [sp, setSp] = useState<SpMeta | null>(null);

  // Form state
  const [provider, setProvider] = useState<Provider>('SAML');
  const [enabled, setEnabled] = useState(false);
  const [metadataUrl, setMetadataUrl] = useState('');
  const [entityId, setEntityId] = useState('');
  const [acsUrl, setAcsUrl] = useState('');
  const [x509Cert, setX509Cert] = useState('');
  const [oidcIssuer, setOidcIssuer] = useState('');
  const [oidcClientId, setOidcClientId] = useState('');
  const [oidcClientSecret, setOidcClientSecret] = useState('');
  const [defaultRole, setDefaultRole] = useState('RESTRICTED_VIEWER');
  const [allowedEmailDomain, setAllowedEmailDomain] = useState('');
  const [autoProvision, setAutoProvision] = useState(false);

  // Only roles this caller can actually assign (ACC-01 rank gate). An already
  // stored value is kept in the list even if the caller could not have set it,
  // so an existing config renders its own value rather than silently showing
  // someone else's choice.
  const callerRole = useAppStore((s) => s.user?.role);
  const roleOptions = tenantRoleOptions(callerRole, defaultRole);

  const getToken = () =>
    typeof window !== 'undefined' ? localStorage.getItem('auth_token') || '' : '';

  const loadConfig = async () => {
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
      setSp(data.sp);
      if (data.config) {
        const c: ConfigSafe = data.config;
        setConfig(c);
        setProvider(c.provider);
        setEnabled(c.enabled);
        setMetadataUrl(c.metadataUrl || '');
        setEntityId(c.entityId || '');
        setAcsUrl(c.acsUrl || '');
        setOidcIssuer(c.oidcIssuer || '');
        setOidcClientId(c.oidcClientId || '');
        setDefaultRole(c.defaultRole || 'RESTRICTED_VIEWER');
        setAllowedEmailDomain(c.allowedEmailDomain || '');
        setAutoProvision(c.autoProvision);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (schoolId) loadConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setTestResult(null);
    try {
      const body: Record<string, unknown> = {
        provider,
        // SAML can't be armed in this build (lib removed for CVE-2025-54419 +
        // API forbids arming it) — never submit enabled:true for SAML, which
        // matches the disabled checkbox and avoids an opaque server rejection.
        enabled: provider === 'SAML' ? false : enabled,
        defaultRole,
        autoProvision,
        allowedEmailDomain: allowedEmailDomain || null,
      };
      if (provider === 'SAML') {
        body.metadataUrl = metadataUrl || null;
        body.entityId = entityId || null;
        body.acsUrl = acsUrl || null;
        if (x509Cert) body.x509Cert = x509Cert;
      } else {
        body.oidcIssuer = oidcIssuer || null;
        body.oidcClientId = oidcClientId || null;
        if (oidcClientSecret) body.oidcClientSecret = oidcClientSecret;
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
      // Clear secret fields on successful save so they aren't re-submitted.
      setX509Cert('');
      setOidcClientSecret('');
      await loadConfig();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

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

  return (
    <div className="max-w-4xl space-y-8">
      <Link
        href={`/${schoolId}/settings`}
        className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-indigo-600"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> {t('streamingSso.settings')}
      </Link>
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-800 flex items-center gap-2">
          <Shield className="w-7 h-7 text-indigo-500" />
          {t('streamingSso.ssoHeading')}
        </h1>
        <p className="text-sm text-slate-500 mt-0.5">
          {t('streamingSso.ssoSubtitle')}
        </p>
      </div>

      <RoleGate
        allowedRoles={['DISTRICT_ADMIN', 'SUPER_ADMIN']}
        fallback={
          <div className="bg-slate-50 p-8 rounded-xl border border-slate-200 text-center">
            <KeyRound className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <h3 className="text-sm font-bold text-slate-700">{t('streamingSso.districtAdminAccessRequired')}</h3>
            <p className="text-xs text-slate-500 mt-2">
              {t('streamingSso.onlyDistrictAdmins')}
            </p>
          </div>
        }
      >
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
          </div>
        ) : (
          <>
            {sp && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                <h2 className="text-sm font-bold text-slate-700 mb-4">
                  {t('streamingSso.spMetadata')}
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <CopyField label={t('streamingSso.entityIdAudience')} value={sp.entityId} />
                  <CopyField label="SAML ACS URL" value={sp.acsUrl} />
                  <CopyField label={t('streamingSso.oidcRedirectUri')} value={sp.oidcRedirectUri} />
                </div>
              </div>
            )}

            <form
              onSubmit={handleSave}
              className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-5"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold text-slate-700">{t('streamingSso.identityProvider')}</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {config?.enabled
                      ? t('streamingSso.ssoEnabledForTenant')
                      : t('streamingSso.ssoNotEnabled')}
                  </p>
                </div>
                {/* SAML is intentionally non-armable in this build:
                    passport-saml@3 was removed to remediate CVE-2025-54419,
                    so buildSamlLoginUrl/validateSamlCallback always 503, and
                    the API ForbidS a non-SUPER_ADMIN from flipping SAML on.
                    Don't offer an Enabled checkbox the operator can't honor —
                    OIDC still arms normally. Storing SAML config is still
                    allowed (the form below saves fine). */}
                <label className={`flex items-center gap-2 text-xs font-semibold ${provider === 'SAML' ? 'text-slate-300 cursor-not-allowed' : ''}`}>
                  <input
                    type="checkbox"
                    checked={provider === 'SAML' ? false : enabled}
                    disabled={provider === 'SAML'}
                    onChange={(e) => setEnabled(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 disabled:opacity-50"
                  />
                  {t('streamingSso.enabled')}
                </label>
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">
                  {t('streamingSso.providerType')}
                </label>
                <select
                  value={provider}
                  onChange={(e) => setProvider(e.target.value as Provider)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="SAML">{t('streamingSso.samlOption')}</option>
                  <option value="OIDC">OIDC (Google Workspace, Auth0, Azure AD)</option>
                </select>
              </div>

              {provider === 'SAML' ? (
                <div className="space-y-3">
                  {/* Honest state — SAML login can't actually run in this build:
                      the SAML library (passport-saml@3) was removed to remediate
                      CVE-2025-54419, so the login + callback paths return 503 and
                      the API blocks arming SAML. You can still store your config
                      here so it's ready when SAML returns; use OIDC today. */}
                  <div className="flex items-start gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg">
                    <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-800 font-medium leading-relaxed">
                      <span className="font-bold">{t('streamingSso.samlUnavailableBold')}</span>{' '}
                      The SAML library was removed to remediate a security advisory
                      (CVE-2025-54419) and returns in a follow-up. You can save your
                      SAML configuration below so it&rsquo;s ready when it ships, but it
                      can&rsquo;t be enabled yet — use <span className="font-bold">OIDC</span> or
                      email + password for now.
                    </p>
                  </div>
                  <Field
                    label={t('streamingSso.metadataUrlLabel')}
                    value={metadataUrl}
                    onChange={setMetadataUrl}
                    placeholder="https://idp.example.com/saml/sso"
                  />
                  <Field
                    label={t('streamingSso.idpEntityIdLabel')}
                    value={entityId}
                    onChange={setEntityId}
                    placeholder="https://idp.example.com/saml/metadata"
                  />
                  <Field
                    label={t('streamingSso.acsUrlLabel')}
                    value={acsUrl}
                    onChange={setAcsUrl}
                    placeholder={sp?.acsUrl}
                  />
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">
                      {t('streamingSso.idpSigningCert')}
                      {config?.hasX509Cert && (
                        <span className="ml-2 text-emerald-600 normal-case font-normal">
                          {t('streamingSso.currentlySetLeaveBlank')}
                        </span>
                      )}
                    </label>
                    <textarea
                      value={x509Cert}
                      onChange={(e) => setX509Cert(e.target.value)}
                      placeholder="-----BEGIN CERTIFICATE-----\n..."
                      rows={5}
                      className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <Field
                    label={t('streamingSso.oidcIssuerUrl')}
                    value={oidcIssuer}
                    onChange={setOidcIssuer}
                    placeholder="https://accounts.google.com"
                  />
                  <Field
                    label={t('streamingSso.clientId')}
                    value={oidcClientId}
                    onChange={setOidcClientId}
                    placeholder="abc.apps.googleusercontent.com"
                  />
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">
                      {t('streamingSso.clientSecret')}
                      {config?.hasOidcClientSecret && (
                        <span className="ml-2 text-emerald-600 normal-case font-normal">
                          {t('streamingSso.currentlySetLeaveBlank')}
                        </span>
                      )}
                    </label>
                    <input
                      type="password"
                      value={oidcClientSecret}
                      onChange={(e) => setOidcClientSecret(e.target.value)}
                      placeholder="••••••••••••"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>
              )}

              <hr className="border-slate-100" />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">
                    {t('streamingSso.defaultRoleNewUsers')}
                  </label>
                  <select
                    value={defaultRole}
                    onChange={(e) => setDefaultRole(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    {roleOptions.map((r) => (
                      <option key={r} value={r}>
                        {r.replace('_', ' ')}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[10px] text-slate-400">
                    {t('streamingSso.defaultRoleRankNote')}
                  </p>
                </div>
                <Field
                  label={t('streamingSso.allowedEmailDomain')}
                  value={allowedEmailDomain}
                  onChange={setAllowedEmailDomain}
                  placeholder="acme.edu"
                />
              </div>

              <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                <input
                  type="checkbox"
                  checked={autoProvision}
                  onChange={(e) => setAutoProvision(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300"
                />
                {t('streamingSso.autoCreateAccounts')}
              </label>

              {error && (
                <div className="flex items-start gap-2 px-3 py-2.5 bg-red-50 border border-red-200 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-red-700 font-medium">{error}</p>
                </div>
              )}

              {testResult && (
                <div
                  className={`flex items-start gap-2 px-3 py-2.5 rounded-lg border ${
                    testResult.ok
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                      : 'bg-amber-50 border-amber-200 text-amber-700'
                  }`}
                >
                  {testResult.ok ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  )}
                  <p className="text-xs font-medium">{testResult.message}</p>
                </div>
              )}

              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg"
                >
                  {saving ? t('streamingSso.saving') : t('streamingSso.saveSsoConfig')}
                </button>
                <button
                  type="button"
                  onClick={handleTest}
                  disabled={testing}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg"
                >
                  {testing ? t('streamingSso.testing') : t('streamingSso.testConnection')}
                </button>
              </div>
            </form>
          </>
        )}
      </RoleGate>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
      />
    </div>
  );
}
