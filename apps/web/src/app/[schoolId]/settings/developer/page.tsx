'use client';

/**
 * /[schoolId]/settings/developer — Developer & audit (handoff §7.10),
 * rendered inside the Settings Command Center shell.
 *
 * Operator feedback (2026-05-25): "what is the system info setting?
 * seems weird and something i wouldnt use ... if we need to offer API
 * info shouldnt we have a developer area then and dont we need API
 * keys and SDK info for integrations? lets build out a developer
 * section and add everything under that not just rando systems
 * settings"
 *
 * This page is the home for everything an engineer / integrator might
 * need but a regular location admin shouldn't have to look at:
 *
 *   - System & build: player URL + API endpoint + dashboard build commit,
 *     read-only, exactly what the deploy actually exposes.
 *   - Connected integrations: read-only list of every external system
 *     surface with Manage links to each dedicated page.
 *   - API keys: REAL, shipped, tenant-scoped REST tokens — minted with a
 *     role + optional scope grant, revealed ONCE, then only ever shown as
 *     prefix / role / scopes / expiry / last-used / revoke. (§7.10 forbids
 *     describing this implemented behaviour as a placeholder; the old
 *     "SCAFFOLDED" note in this header was exactly that lie.)
 *   - Webhooks: signed outbound POSTs, signing secret revealed ONCE.
 *   - SDK & documentation links.
 *   - Audit log ENTRY POINT — a link to /[schoolId]/audit. The audit data
 *     itself is never duplicated into Settings (§8).
 *   - Developer tooling (the sample-data harness) behind a stricter gate
 *     than the rest of the page — see DEVELOPER_TOOLS_VISIBLE below.
 *
 * Restricted to SUPER_ADMIN + DISTRICT_ADMIN; anyone else gets the shell's
 * PermissionDenied primitive naming the section and who can grant access
 * (§10), not a redirect to somewhere unrelated.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useUIStore } from '@/store/ui-store';
import {
  Code2,
  KeyRound,
  Webhook,
  Plug,
  ExternalLink,
  BookOpen,
  FileClock,
  Beaker,
  GitBranch,
  Plus,
  Copy,
  Check,
  Trash2,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Clock,
} from 'lucide-react';
import {
  useApiKeys,
  useApiKeyScopeCatalog,
  useMintApiKey,
  useRevokeApiKey,
  useWebhooks,
  useCreateWebhook,
  useDeleteWebhook,
} from '@/hooks/use-api';
import { appConfirm, appAlert } from '@/components/ui/app-dialog';
import { developerToolsVisible } from '@/components/settings/developer-tools';
import { SettingsPageFrame } from '@/components/settings/shell/SettingsPageFrame';
import {
  ContextModule,
  EditorHead,
  EditorSection,
  PermissionDenied,
  SectionAction,
} from '@/components/settings/shell/primitives';

export default function DeveloperSettingsPage() {
  const t = useTranslations();
  const params = useParams<{ schoolId: string }>();
  const schoolId = params?.schoolId || '';
  const user = useUIStore((s) => s.user);
  const role = user?.role || '';
  const isDeveloperAllowed = role === 'SUPER_ADMIN' || role === 'DISTRICT_ADMIN';

  // Pull the dashboard's API endpoint + player URL from the same env
  // vars the main settings page used to read. Falls back to localhost
  // for local dev; surfaces the misconfiguration loudly in that case.
  const apiUrl =
    process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';
  const playerUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/player`
      : '/player';
  const dashboardCommit = process.env.NEXT_PUBLIC_GIT_COMMIT || null;

  if (!isDeveloperAllowed) {
    return (
      <SettingsPageFrame
        section="developer"
        title={t('settings.shell.sections.developer.label')}
        description={t('settings.shell.sections.developer.description')}
      >
        <PermissionDenied
          sectionLabel={t('settings.shell.sections.developer.label')}
          grantedBy={t('settings.cc.developer.deniedGrantedBy')}
        />
      </SettingsPageFrame>
    );
  }

  return (
    <SettingsPageFrame
      section="developer"
      title={t('settings.shell.sections.developer.label')}
      description={t('settings.shell.sections.developer.description')}
      scope={{ kind: 'organization', label: user?.tenantName || '' }}
      searchItems={[
        { label: t('settings.cc.developer.searchApiKeys'), anchor: 'dev-api-keys', keywords: ['token', 'bearer', 'rest', 'scope'] },
        { label: t('settings.cc.developer.searchWebhooks'), anchor: 'dev-webhooks', keywords: ['callback', 'signing secret', 'hmac'] },
        { label: t('settings.cc.developer.searchAudit'), anchor: 'dev-audit', href: `/${schoolId}/audit`, keywords: ['history', 'log', 'who changed'] },
      ]}
      context={<DeveloperContextRail apiUrl={apiUrl} dashboardCommit={dashboardCommit} />}
    >
      <EditorHead
        icon={Code2}
        title={t('settings.cc.developer.editorTitle')}
        description={t('settings.cc.developer.editorDesc')}
      />

      {/* ── System & build ─────────────────────────────────────── */}
      <EditorSection
        id="dev-system"
        title={t('settings.cc.developer.systemTitle')}
        description={t('settings.cc.developer.systemDesc')}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <InfoCell label="Player URL" value={playerUrl} />
          <InfoCell label="API Endpoint" value={apiUrl} />
          {dashboardCommit && (
            <InfoCell
              label="Dashboard build"
              value={dashboardCommit.slice(0, 7)}
              mono
            />
          )}
        </div>
      </EditorSection>

      {/* ── Connected Integrations ─────────────────────────────── */}
      <EditorSection
        id="dev-integrations"
        title={t('settings.cc.developer.integrationsTitle')}
        description={t('settings.cc.developer.integrationsDesc')}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <IntegrationCard
            name="Stripe billing"
            blurb="Plans, invoices, customer portal."
            href={`/${schoolId}/settings/billing`}
          />
          <IntegrationCard
            name="Clever SIS"
            blurb="Roster import + class periods for K-12."
            href={`/${schoolId}/settings/integrations/clever`}
          />
          <IntegrationCard
            name="Streaming providers"
            blurb="Twitch / YouTube / Vimeo embeds for live tiles."
            href={`/${schoolId}/settings/streaming`}
          />
          <IntegrationCard
            name="POS catalog sync"
            blurb="Square / Toast / Clover for menu boards."
            href={`/${schoolId}/settings/pos`}
          />
          <IntegrationCard
            name="Ad networks"
            blurb="House ads + future ad-network OAuth."
            href={`/${schoolId}/settings/monetize`}
          />
          <IntegrationCard
            name="SSO / SAML / OIDC"
            blurb="District directory integration for staff login."
            href={`/${schoolId}/settings/sso`}
          />
          {/* 2026-05-25 — Design imports moved out of Settings into
              the Templates section ("its not a setting its a feature"
              — operator). The Developer integrations index still
              surfaces it because operators with the developer mindset
              expect to find every integration in one place, but the
              link now points at the new home. */}
          <IntegrationCard
            name="Design imports"
            blurb="PDF / Canva / Slides → template (or playlist)."
            href={`/${schoolId}/templates/imports`}
          />
          <IntegrationCard
            name="USB ingest"
            blurb="Sneakernet content updates for offline kiosks."
            href={`/${schoolId}/settings/usb`}
          />
        </div>
      </EditorSection>

      {/* ── API Keys ───────────────────────────────────────────── */}
      <ApiKeysSection />

      {/* ── Webhooks ───────────────────────────────────────────── */}
      <WebhooksSection />

      {/* ── SDK + Documentation ───────────────────────────────── */}
      <EditorSection
        id="dev-docs"
        title={t('settings.cc.developer.docsTitle')}
        description={t('settings.cc.developer.docsDesc')}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <DocLink
            href="https://github.com/gschiemann/EDUCMS"
            title="Public repo"
            blurb="Source-of-truth GitHub repository."
            icon={<GitBranch className="w-4 h-4" />}
            external
          />
          <DocLink
            href={`${apiUrl.replace(/\/api\/v1$/, '')}/api/v1/health`}
            title="API health endpoint"
            blurb="Liveness probe — also returns the current build commit + DB/Redis status."
            icon={<Plug className="w-4 h-4" />}
            external
          />
          <DocLink
            href={`/${schoolId}/settings/usb`}
            title="USB ingest manifest format"
            blurb="HMAC-signed manifest layout for sneakernet content updates on offline kiosks."
            icon={<BookOpen className="w-4 h-4" />}
          />
          <DocLink
            href="https://docs.venue-os.app"
            title="Documentation (coming soon)"
            blurb="REST API reference, embed snippets, and SDK quickstarts. Hosted docs ship alongside the API-token feature."
            icon={<BookOpen className="w-4 h-4" />}
            external
            unavailable
          />
        </div>
      </EditorSection>

      {/* ── Audit log ENTRY POINT (never a second copy of the log) ── */}
      <EditorSection
        id="dev-audit"
        title={t('settings.cc.developer.auditTitle')}
        action={
          <SectionAction href={`/${schoolId}/audit`}>
            <FileClock className="w-3.5 h-3.5" aria-hidden />
            {t('settings.cc.developer.auditAction')}
          </SectionAction>
        }
      >
        <p className="text-[12px] leading-[17px] text-slate-500">
          {t('settings.cc.developer.auditDesc')}
        </p>
      </EditorSection>

      {/* ── Developer tooling (sample data) ───────────────────── */}
      {developerToolsVisible(role) && (
        <EditorSection
          id="dev-tools"
          title={t('settings.cc.developer.toolsTitle')}
          description={t('settings.cc.developer.toolsDesc')}
          action={
            <SectionAction href={`/${schoolId}/settings/test-integrations`}>
              <Beaker className="w-3.5 h-3.5" aria-hidden />
              {t('settings.cc.developer.toolsAction')}
            </SectionAction>
          }
        >
          <p className="text-[12px] leading-[17px] text-slate-500">
            {t('settings.cc.developer.toolsAvailability')}
          </p>
        </EditorSection>
      )}
    </SettingsPageFrame>
  );
}

/**
 * Context rail (§6.6). Counts come from the same React Query caches the
 * sections use, so the rail can never disagree with the table below it, and
 * the build/environment lines state ONLY what this deploy actually exposes.
 */
function DeveloperContextRail({
  apiUrl,
  dashboardCommit,
}: {
  apiUrl: string;
  dashboardCommit: string | null;
}) {
  const t = useTranslations();
  const { data: keys, isLoading: keysLoading } = useApiKeys();
  const { data: hooks } = useWebhooks();
  const active = (keys ?? []).filter((k) => !k.revokedAt).length;
  const revoked = (keys ?? []).filter((k) => k.revokedAt).length;

  return (
    <>
      <ContextModule
        label={t('settings.cc.developer.railKeysLabel')}
        title={keysLoading ? t('settings.cc.developer.railKeysUnknown') : String(active)}
      >
        {keysLoading ? null : t('settings.cc.developer.railKeysValue', { active, revoked })}
      </ContextModule>
      <ContextModule
        label={t('settings.cc.developer.railWebhooksLabel')}
        title={t('settings.cc.developer.railWebhooksValue', { count: (hooks ?? []).length })}
      />
      <ContextModule label={t('settings.cc.developer.railEnvLabel')} title={apiUrl}>
        {dashboardCommit
          ? t('settings.cc.developer.railBuild', { commit: dashboardCommit.slice(0, 7) })
          : t('settings.cc.developer.railBuildUnknown')}
      </ContextModule>
    </>
  );
}

// ─── Small presentational primitives ───────────────────────────

function InfoCell({
  label,
  value,
  mono = true,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="bg-slate-50 rounded-lg p-3">
      <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">
        {label}
      </p>
      <code
        className={`text-xs text-slate-700 select-all break-all ${
          mono ? 'font-mono' : ''
        }`}
      >
        {value}
      </code>
    </div>
  );
}

function IntegrationCard({
  name,
  blurb,
  href,
}: {
  name: string;
  blurb: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-3 p-3 rounded-lg border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/40 transition-colors"
    >
      <div className="min-w-0">
        <div className="text-xs font-bold text-slate-800 truncate">{name}</div>
        <div className="text-[11px] text-slate-500 truncate">{blurb}</div>
      </div>
      <span className="text-[10px] font-bold text-indigo-600 shrink-0">
        Manage →
      </span>
    </Link>
  );
}

// ─── API Keys section ──────────────────────────────────────────

const ALLOWED_API_KEY_ROLES = [
  { value: 'DISTRICT_ADMIN', label: 'District admin' },
  { value: 'SCHOOL_ADMIN', label: 'School admin' },
  { value: 'CONTRIBUTOR', label: 'Contributor' },
  { value: 'RESTRICTED_VIEWER', label: 'Read-only viewer' },
] as const;

/**
 * Human-readable expiry for a key row.
 *
 * ACC-06 gave every key a real lifetime (90d default, 365d ceiling) but this
 * table had no expiry column at all — so a key that dies in three months looks
 * exactly like the never-expiring credential the old build actually minted.
 * That gap is how an integration goes dark on a Saturday with nobody knowing
 * why. `null` can only mean a pre-ACC-06 key now, and it is worth flagging
 * rather than hiding.
 */
function expiryLabel(expiresAt: string | null): { text: string; cls: string } {
  if (!expiresAt) return { text: 'Never (legacy)', cls: 'text-amber-600 font-semibold' };
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (!Number.isFinite(ms)) return { text: '—', cls: 'text-slate-500' };
  if (ms <= 0) return { text: 'Expired', cls: 'text-rose-600 font-semibold' };
  const days = Math.ceil(ms / 86_400_000);
  return {
    text: days <= 14 ? `in ${days}d` : new Date(expiresAt).toLocaleDateString(),
    cls: days <= 14 ? 'text-amber-600 font-semibold' : 'text-slate-500',
  };
}

function ApiKeysSection() {
  const t = useTranslations();
  const { data: keys, isLoading } = useApiKeys();
  const { data: catalog } = useApiKeyScopeCatalog();
  const mint = useMintApiKey();
  const revoke = useRevokeApiKey();
  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState('');
  const [role, setRole] = useState<string>('CONTRIBUTOR');
  // Scope selection. `null` = the operator explicitly chose an unrestricted
  // key (the old behaviour); a Set = a narrowed grant. Default is a NARROWED
  // key with nothing ticked, so the least-privilege path is the one you get by
  // not thinking about it. There is no emergency scope to tick — those routes
  // are refused for every API key, scoped or not.
  const [scopes, setScopes] = useState<Set<string> | null>(new Set<string>());
  const [justMinted, setJustMinted] = useState<{ token: string; prefix: string } | null>(null);
  const [copiedToken, setCopiedToken] = useState(false);

  const toggleScope = (scope: string) => {
    setScopes((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      // Ticking write implies read — the server treats it that way, so keep
      // the checkboxes honest rather than letting them imply otherwise.
      if (scope.endsWith(':write') && next.has(scope)) next.delete(scope.replace(':write', ':read'));
      return next;
    });
  };

  const handleMint = async () => {
    setJustMinted(null);
    try {
      const result = await mint.mutateAsync({
        name: name.trim(),
        role,
        scopes: scopes === null ? null : Array.from(scopes),
      });
      setJustMinted({ token: result.token, prefix: result.prefix });
      setName('');
      setRole('CONTRIBUTOR');
      setScopes(new Set<string>());
      setShowNew(false);
    } catch (err: any) {
      await appAlert({
        title: 'Could not create API key',
        message: err?.message || 'Something went wrong.',
        tone: 'danger',
      });
    }
  };

  const handleRevoke = async (id: string, label: string) => {
    if (
      !(await appConfirm({
        title: 'Revoke API key?',
        message: `"${label}" will stop working immediately. Anything using this token will start returning 401. This cannot be undone.`,
        confirmLabel: 'Revoke',
        tone: 'danger',
      }))
    )
      return;
    try {
      await revoke.mutateAsync(id);
    } catch (err: any) {
      await appAlert({
        title: 'Could not revoke',
        message: err?.message || 'Something went wrong.',
        tone: 'danger',
      });
    }
  };

  const copyToken = async () => {
    if (!justMinted) return;
    try {
      await navigator.clipboard.writeText(justMinted.token);
      setCopiedToken(true);
      setTimeout(() => setCopiedToken(false), 2000);
    } catch {
      // clipboard blocked; operator can select+copy manually
    }
  };

  const active = (keys ?? []).filter((k) => !k.revokedAt);
  const revoked = (keys ?? []).filter((k) => k.revokedAt);

  return (
    <EditorSection
      id="dev-api-keys"
      title={t('settings.cc.developer.apiKeysTitle')}
      description={t('settings.cc.developer.apiKeysDesc')}
      action={
        <SectionAction onClick={() => setShowNew((v) => !v)}>
          <Plus className="w-3.5 h-3.5" aria-hidden /> {showNew ? 'Cancel' : 'New key'}
        </SectionAction>
      }
    >
      <p className="text-[12px] leading-[17px] text-slate-500 mb-4">
        Each token carries a role — the same RBAC the dashboard uses applies —
        plus an optional scope grant that narrows it further. Keys{' '}
        <strong>expire after {catalog?.defaultExpiryDays ?? 90} days</strong> by
        default ({catalog?.maxExpiryDays ?? 365}-day maximum); rotate by minting
        a new one and revoking the old. No API key can trigger or clear an
        emergency — that always needs a signed-in person.
      </p>

      {/* Just-minted reveal banner — shows ONCE on creation. */}
      {justMinted && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <div className="text-xs font-bold text-emerald-800">
              Key created. Copy it now — we&rsquo;ll never show it again.
            </div>
          </div>
          <div className="flex items-center gap-2 bg-white border border-emerald-200 rounded-md px-3 py-2">
            <code className="flex-1 text-xs font-mono text-slate-800 break-all select-all">
              {justMinted.token}
            </code>
            <button
              type="button"
              onClick={copyToken}
              className="text-xs font-semibold px-2.5 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700 flex items-center gap-1.5 shrink-0"
            >
              {copiedToken ? (
                <>
                  <Check className="w-3 h-3" /> Copied
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3" /> Copy
                </>
              )}
            </button>
          </div>
          <button
            type="button"
            onClick={() => setJustMinted(null)}
            className="text-[11px] text-emerald-700 hover:underline mt-2"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* New-key form */}
      {showNew && (
        <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="text-[11px] font-bold text-slate-600 flex flex-col gap-1">
              Name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. CI pipeline"
                maxLength={80}
                className="px-3 py-2 border border-slate-200 rounded-lg text-sm font-normal text-slate-800"
              />
            </label>
            <label className="text-[11px] font-bold text-slate-600 flex flex-col gap-1">
              Role
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="px-3 py-2 border border-slate-200 rounded-lg text-sm font-normal text-slate-800 bg-white"
              >
                {ALLOWED_API_KEY_ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {/* Scope grant. Default = narrowed with nothing ticked, so
              least-privilege is what you get without thinking about it. */}
          {catalog && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-bold text-slate-600">What can this key touch?</p>
                <label className="flex items-center gap-1.5 text-[11px] text-slate-500 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={scopes === null}
                    onChange={(e) => setScopes(e.target.checked ? null : new Set<string>())}
                  />
                  Full access (no scope limit)
                </label>
              </div>
              {scopes === null ? (
                <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                  This key will reach every endpoint its role allows. Prefer
                  ticking only what the integration needs — a leaked
                  full-access token is a leak of everything the role can do.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {catalog.families.map((f) => (
                    <div
                      key={f.id}
                      className="flex items-start justify-between gap-3 bg-white border border-slate-200 rounded-md px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="text-[11px] font-bold text-slate-700">{f.label}</p>
                        <p className="text-[10px] text-slate-500">{f.blurb}</p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        {f.access.map((a) => {
                          const scope = `${f.id}:${a}`;
                          const writeHeld = scopes.has(`${f.id}:write`);
                          // Write implies read on the server, so show read as
                          // satisfied (and locked) once write is ticked.
                          const implied = a === 'read' && writeHeld;
                          return (
                            <label key={scope} className="flex items-center gap-1 text-[10px] font-semibold text-slate-600 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={scopes.has(scope) || implied}
                                disabled={implied}
                                onChange={() => toggleScope(scope)}
                              />
                              {a}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  {scopes.size === 0 && (
                    <p className="text-[10px] text-slate-400">
                      Nothing selected — this key will be refused on every
                      endpoint. Tick at least one.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleMint}
              disabled={mint.isPending || !name.trim() || (scopes !== null && scopes.size === 0)}
              className="text-xs font-semibold px-4 py-2 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              {mint.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Create key
            </button>
            <p className="text-[11px] text-slate-400 self-center">
              Expires in {catalog?.defaultExpiryDays ?? 90} days.
            </p>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-8 text-xs text-slate-400">
          <Loader2 className="w-4 h-4 animate-spin inline-block" /> Loading…
        </div>
      ) : active.length === 0 && revoked.length === 0 ? (
        <div className="text-center py-8 text-xs text-slate-400">
          No API keys yet. Click <strong>New key</strong> to mint one.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left border-b border-slate-200">
                <th className="py-2 font-bold text-slate-500 text-[10px] uppercase tracking-wider">
                  Name
                </th>
                <th className="py-2 font-bold text-slate-500 text-[10px] uppercase tracking-wider">
                  Prefix
                </th>
                <th className="py-2 font-bold text-slate-500 text-[10px] uppercase tracking-wider">
                  Role
                </th>
                <th className="py-2 font-bold text-slate-500 text-[10px] uppercase tracking-wider">
                  Scopes
                </th>
                <th className="py-2 font-bold text-slate-500 text-[10px] uppercase tracking-wider">
                  Expires
                </th>
                <th className="py-2 font-bold text-slate-500 text-[10px] uppercase tracking-wider">
                  Last used
                </th>
                <th className="py-2 font-bold text-slate-500 text-[10px] uppercase tracking-wider">
                  Status
                </th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {[...active, ...revoked].map((k) => (
                <tr key={k.id} className="border-b border-slate-100">
                  <td className="py-2.5 font-semibold text-slate-800 truncate max-w-[20ch]">
                    {k.name}
                  </td>
                  <td className="py-2.5 font-mono text-slate-500">vos_{k.prefix}…</td>
                  <td className="py-2.5 text-slate-600">{k.role}</td>
                  <td className="py-2.5 max-w-[24ch]">
                    {k.scopes === null ? (
                      <span className="text-amber-600 font-semibold" title="Unrestricted — reaches every endpoint this role allows.">
                        Full access
                      </span>
                    ) : k.scopes.length === 0 ? (
                      <span className="text-slate-400" title="Explicitly granted nothing — every endpoint is refused.">
                        None
                      </span>
                    ) : (
                      <span className="text-slate-600 break-words" title={k.scopes.join(', ')}>
                        {k.scopes.join(', ')}
                      </span>
                    )}
                  </td>
                  <td className={`py-2.5 ${expiryLabel(k.expiresAt).cls}`}>
                    {expiryLabel(k.expiresAt).text}
                  </td>
                  <td className="py-2.5 text-slate-500">
                    {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : '—'}
                  </td>
                  <td className="py-2.5">
                    {k.revokedAt ? (
                      <span className="text-rose-600 font-semibold">Revoked</span>
                    ) : (
                      <span className="text-emerald-600 font-semibold">Active</span>
                    )}
                  </td>
                  <td className="py-2.5 text-right">
                    {!k.revokedAt && (
                      <button
                        type="button"
                        onClick={() => handleRevoke(k.id, k.name)}
                        disabled={revoke.isPending}
                        className="text-xs text-rose-600 hover:text-rose-700 font-semibold inline-flex items-center gap-1"
                      >
                        <Trash2 className="w-3 h-3" /> Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </EditorSection>
  );
}

// ─── Webhooks section ──────────────────────────────────────────

const ALLOWED_WEBHOOK_EVENTS = [
  { value: 'emergency.triggered', label: 'Emergency triggered' },
  { value: 'emergency.cleared', label: 'Emergency cleared' },
] as const;

function WebhooksSection() {
  const t = useTranslations();
  const { data: hooks, isLoading } = useWebhooks();
  const create = useCreateWebhook();
  const del = useDeleteWebhook();
  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<string[]>([]);
  const [justCreated, setJustCreated] = useState<{ signingSecret: string } | null>(null);
  const [copiedSecret, setCopiedSecret] = useState(false);

  const toggleEvent = (v: string) => {
    setEvents((prev) => (prev.includes(v) ? prev.filter((e) => e !== v) : [...prev, v]));
  };

  const handleCreate = async () => {
    setJustCreated(null);
    try {
      const result = await create.mutateAsync({
        name: name.trim(),
        url: url.trim(),
        events,
      });
      setJustCreated({ signingSecret: result.signingSecret });
      setName('');
      setUrl('');
      setEvents([]);
      setShowNew(false);
    } catch (err: any) {
      await appAlert({
        title: 'Could not create webhook',
        message: err?.message || 'Something went wrong.',
        tone: 'danger',
      });
    }
  };

  const handleDelete = async (id: string, label: string) => {
    if (
      !(await appConfirm({
        title: 'Delete webhook?',
        message: `"${label}" will stop receiving events. Cannot be undone.`,
        confirmLabel: 'Delete',
        tone: 'danger',
      }))
    )
      return;
    try {
      await del.mutateAsync(id);
    } catch (err: any) {
      await appAlert({
        title: 'Could not delete',
        message: err?.message || 'Something went wrong.',
        tone: 'danger',
      });
    }
  };

  const copySecret = async () => {
    if (!justCreated) return;
    try {
      await navigator.clipboard.writeText(justCreated.signingSecret);
      setCopiedSecret(true);
      setTimeout(() => setCopiedSecret(false), 2000);
    } catch {
      /* user can select+copy manually */
    }
  };

  return (
    <EditorSection
      id="dev-webhooks"
      title={t('settings.cc.developer.webhooksTitle')}
      description={t('settings.cc.developer.webhooksDesc')}
      action={
        <SectionAction onClick={() => setShowNew((v) => !v)}>
          <Plus className="w-3.5 h-3.5" aria-hidden /> {showNew ? 'Cancel' : 'New webhook'}
        </SectionAction>
      }
    >
      <p className="text-[12px] leading-[17px] text-slate-500 mb-4">
        We&rsquo;ll POST signed JSON to your URL when subscribed events fire.
        Verify <code className="font-mono">X-VenueOS-Signature</code> with the
        HMAC-SHA256 secret we show you on creation.
      </p>

      {/* Just-created reveal banner */}
      {justCreated && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <div className="text-xs font-bold text-emerald-800">
              Webhook created. Copy the signing secret now — we won&rsquo;t show it
              again.
            </div>
          </div>
          <div className="flex items-center gap-2 bg-white border border-emerald-200 rounded-md px-3 py-2">
            <code className="flex-1 text-xs font-mono text-slate-800 break-all select-all">
              {justCreated.signingSecret}
            </code>
            <button
              type="button"
              onClick={copySecret}
              className="text-xs font-semibold px-2.5 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700 flex items-center gap-1.5 shrink-0"
            >
              {copiedSecret ? (
                <>
                  <Check className="w-3 h-3" /> Copied
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3" /> Copy
                </>
              )}
            </button>
          </div>
          <button
            type="button"
            onClick={() => setJustCreated(null)}
            className="text-[11px] text-emerald-700 hover:underline mt-2"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* New-webhook form */}
      {showNew && (
        <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="text-[11px] font-bold text-slate-600 flex flex-col gap-1">
              Name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. PagerDuty bridge"
                maxLength={80}
                className="px-3 py-2 border border-slate-200 rounded-lg text-sm font-normal text-slate-800"
              />
            </label>
            <label className="text-[11px] font-bold text-slate-600 flex flex-col gap-1">
              POST URL
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://your.receiver/webhook"
                className="px-3 py-2 border border-slate-200 rounded-lg text-sm font-normal text-slate-800 font-mono"
              />
            </label>
          </div>
          <div className="space-y-1.5">
            <div className="text-[11px] font-bold text-slate-600">
              Events to subscribe to
            </div>
            <div className="flex flex-wrap gap-2">
              {ALLOWED_WEBHOOK_EVENTS.map((e) => {
                const active = events.includes(e.value);
                return (
                  <button
                    key={e.value}
                    type="button"
                    onClick={() => toggleEvent(e.value)}
                    className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                      active
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-white text-slate-700 border-slate-200 hover:border-indigo-300'
                    }`}
                  >
                    {e.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleCreate}
              disabled={
                create.isPending ||
                !name.trim() ||
                !url.trim() ||
                events.length === 0
              }
              className="text-xs font-semibold px-4 py-2 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              {create.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Create webhook
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-8 text-xs text-slate-400">
          <Loader2 className="w-4 h-4 animate-spin inline-block" /> Loading…
        </div>
      ) : (hooks ?? []).length === 0 ? (
        <div className="text-center py-8 text-xs text-slate-400">
          No webhooks yet. Click <strong>New webhook</strong> to subscribe to events.
        </div>
      ) : (
        <div className="space-y-2">
          {(hooks ?? []).map((h) => (
            <div
              key={h.id}
              className="flex items-center justify-between gap-3 p-3 rounded-lg border border-slate-200"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="text-xs font-bold text-slate-800">{h.name}</div>
                  {h.lastDeliveryStatus != null && (
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        h.lastDeliveryStatus >= 200 && h.lastDeliveryStatus < 300
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-rose-100 text-rose-700'
                      }`}
                      title={h.lastDeliveryError || ''}
                    >
                      {h.lastDeliveryStatus >= 200 && h.lastDeliveryStatus < 300 ? (
                        <CheckCircle2 className="w-3 h-3 inline" />
                      ) : (
                        <AlertCircle className="w-3 h-3 inline" />
                      )}{' '}
                      {h.lastDeliveryStatus}
                    </span>
                  )}
                </div>
                <div className="text-[11px] font-mono text-slate-500 truncate">
                  {h.url}
                </div>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  {h.events.map((e) => (
                    <span
                      key={e}
                      className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700"
                    >
                      {e}
                    </span>
                  ))}
                  {h.lastDeliveryAt && (
                    <span className="text-[10px] text-slate-400 flex items-center gap-0.5">
                      <Clock className="w-2.5 h-2.5" />
                      {new Date(h.lastDeliveryAt).toLocaleString()}
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleDelete(h.id, h.name)}
                disabled={del.isPending}
                className="text-xs text-rose-600 hover:text-rose-700 font-semibold inline-flex items-center gap-1 shrink-0"
              >
                <Trash2 className="w-3 h-3" /> Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </EditorSection>
  );
}

function DocLink({
  href,
  title,
  blurb,
  icon,
  external = false,
  unavailable = false,
}: {
  href: string;
  title: string;
  blurb: string;
  icon: React.ReactNode;
  external?: boolean;
  unavailable?: boolean;
}) {
  const body = (
    <div className="flex items-start gap-3 p-3 rounded-lg border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/40 transition-colors">
      <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
          {title}
          {unavailable && (
            <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-200 text-slate-500">
              Soon
            </span>
          )}
          {external && !unavailable && <ExternalLink className="w-3 h-3 text-slate-400" />}
        </div>
        <div className="text-[11px] text-slate-500 mt-0.5">{blurb}</div>
      </div>
    </div>
  );
  if (unavailable) {
    return (
      <div className="opacity-60 cursor-not-allowed" aria-disabled>
        {body}
      </div>
    );
  }
  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {body}
      </a>
    );
  }
  return <Link href={href}>{body}</Link>;
}
