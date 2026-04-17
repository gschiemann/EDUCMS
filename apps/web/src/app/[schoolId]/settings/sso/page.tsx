"use client";

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Shield, Loader2, CheckCircle2, AlertCircle, KeyRound, Copy } from 'lucide-react';
import { RoleGate } from '@/components/RoleGate';
import { API_URL } from '@/lib/api-url';

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

const ROLES = ['DISTRICT_ADMIN', 'SCHOOL_ADMIN', 'CONTRIBUTOR', 'RESTRICTED_VIEWER'];

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
        enabled,
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
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-800 flex items-center gap-2">
          <Shield className="w-7 h-7 text-indigo-500" />
          Single Sign-On (SSO)
        </h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Connect your identity provider (Google Workspace, Microsoft Entra, Okta, ADFS) so admins
          can sign in with their work account.
        </p>
      </div>

      <RoleGate
        allowedRoles={['DISTRICT_ADMIN', 'SUPER_ADMIN']}
        fallback={
          <div className="bg-slate-50 p-8 rounded-xl border border-slate-200 text-center">
            <KeyRound className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <h3 className="text-sm font-bold text-slate-700">District Admin Access Required</h3>
            <p className="text-xs text-slate-500 mt-2">
              Only District Admins can configure SSO. Contact your district administrator.
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
                  Service Provider metadata (give these to your IdP)
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <CopyField label="Entity ID / Audience" value={sp.entityId} />
                  <CopyField label="SAML ACS URL" value={sp.acsUrl} />
                  <CopyField label="OIDC Redirect URI" value={sp.oidcRedirectUri} />
                </div>
              </div>
            )}

            <form
              onSubmit={handleSave}
              className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-5"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold text-slate-700">Identity Provider</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {config?.enabled
                      ? 'SSO is currently enabled for this tenant.'
                      : 'SSO is not enabled — admins can still sign in with email/password.'}
                  </p>
                </div>
                <label className="flex items-center gap-2 text-xs font-semibold">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => setEnabled(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300"
                  />
                  Enabled
                </label>
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">
                  Provider type
                </label>
                <select
                  value={provider}
                  onChange={(e) => setProvider(e.target.value as Provider)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="SAML">SAML 2.0 (ADFS, Okta, Entra)</option>
                  <option value="OIDC">OIDC (Google Workspace, Auth0, Azure AD)</option>
                </select>
              </div>

              {provider === 'SAML' ? (
                <div className="space-y-3">
                  <Field
                    label="Metadata URL / SSO Entry Point"
                    value={metadataUrl}
                    onChange={setMetadataUrl}
                    placeholder="https://idp.example.com/saml/sso"
                  />
                  <Field
                    label="IdP Entity ID (optional override)"
                    value={entityId}
                    onChange={setEntityId}
                    placeholder="https://idp.example.com/saml/metadata"
                  />
                  <Field
                    label="ACS URL (optional override)"
                    value={acsUrl}
                    onChange={setAcsUrl}
                    placeholder={sp?.acsUrl}
                  />
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">
                      IdP signing certificate (x509, PEM)
                      {config?.hasX509Cert && (
                        <span className="ml-2 text-emerald-600 normal-case font-normal">
                          (currently set — leave blank to keep)
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
                    label="OIDC Issuer URL"
                    value={oidcIssuer}
                    onChange={setOidcIssuer}
                    placeholder="https://accounts.google.com"
                  />
                  <Field
                    label="Client ID"
                    value={oidcClientId}
                    onChange={setOidcClientId}
                    placeholder="abc.apps.googleusercontent.com"
                  />
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">
                      Client Secret
                      {config?.hasOidcClientSecret && (
                        <span className="ml-2 text-emerald-600 normal-case font-normal">
                          (currently set — leave blank to keep)
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
                    Default role for new users
                  </label>
                  <select
                    value={defaultRole}
                    onChange={(e) => setDefaultRole(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r.replace('_', ' ')}
                      </option>
                    ))}
                  </select>
                </div>
                <Field
                  label="Allowed email domain"
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
                Auto-create user accounts on first successful SSO login
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
                  {saving ? 'Saving...' : 'Save SSO configuration'}
                </button>
                <button
                  type="button"
                  onClick={handleTest}
                  disabled={testing}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg"
                >
                  {testing ? 'Testing...' : 'Test connection'}
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
