'use client';

/**
 * /[schoolId]/settings/pos — POS providers admin.
 *
 * Sprint 8d (2026-05-03). Connect a POS, sync the catalog, surface
 * synced items to menu-board widgets. Same UX shape as
 * /settings/streaming (provider tile grid → connect modal → list of
 * connections + sync status).
 *
 * What actually works today (2026-05-28 honesty pass):
 *   • DIRECT providers — Square (OAuth → catalog sync → MenuBoard) and
 *     Custom Webhook (you POST your catalog to us) — show real connect
 *     forms and sync end-to-end.
 *   • PARTNER providers — Toast / Clover / Lightspeed / Shopify /
 *     Stripe-catalog / MINDBODY — have NO sync handler yet, so their
 *     connect modal shows an honest "connector in development" panel
 *     (no credential form). They no longer save inert PENDING rows.
 *   • CLOSED providers (Aloha/NCR) are info-only tiles linking to docs.
 * Per-provider sync handlers will ship in apps/api/src/pos/providers/<id>.ts.
 */
import { useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { appConfirm, appAlert } from '@/components/ui/app-dialog';
import { useOverlayLock } from '@/hooks/use-overlay-lock';
import { Loader2, ExternalLink, Trash2, X, AlertCircle, CheckCircle2, ShieldAlert, RefreshCw, Utensils } from 'lucide-react';
import { SettingsPageFrame } from '@/components/settings/shell/SettingsPageFrame';
import { ContextAction, ContextModule, EditorHead } from '@/components/settings/shell/primitives';

interface PosProvider {
  id: string;
  name: string;
  scope: string;
  integrationTier: 'DIRECT' | 'PARTNER' | 'CLOSED';
  blurb: string;
  iconEmoji?: string;
  iconUrl?: string;
  auth: 'oauth2' | 'apiKey' | 'partnerKey' | 'webhook';
  pricingNote?: string;
  docsUrl?: string;
  websiteUrl?: string;
  bestFor?: string[];
  capabilities: {
    menuSync?: boolean;
    categorySync?: boolean;
    availabilitySync?: boolean;
    locationsSync?: boolean;
    realtimeUpdates?: boolean;
  };
  salesLedOnly?: boolean;
  tierReason?: string;
}

interface PosConnection {
  id: string;
  providerId: string;
  providerName: string;
  status: 'PENDING' | 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'ERROR';
  statusReason?: string;
  lastSyncedAt?: string;
  itemCount: number;
}

const SCOPE_LABELS: Record<string, string> = {
  'restaurant-qsr': "🍔 Restaurant / QSR",
  'restaurant-table': "🍽 Full-service dining",
  'retail': "🛍 Retail",
  'bar': "🍺 Bar",
  'universal': "🔗 Universal",
};

export default function PosSettingsPage() {
  const t = useTranslations();
  const params = useParams();
  const schoolId = params?.schoolId as string;
  const qc = useQueryClient();
  const providers = useQuery<PosProvider[]>({ queryKey: ['pos-providers'], queryFn: () => apiFetch<PosProvider[]>('/pos/providers') });
  const connections = useQuery<PosConnection[]>({ queryKey: ['pos-connections'], queryFn: () => apiFetch<PosConnection[]>('/pos/connections') });
  const [connectModalProvider, setConnectModalProvider] = useState<PosProvider | null>(null);

  const grouped = (providers.data || []).reduce<Record<string, PosProvider[]>>((acc, p) => {
    (acc[p.scope] = acc[p.scope] || []).push(p);
    return acc;
  }, {});

  // Context rail (§6.6) — derived from the same `/pos/connections` rows
  // the list renders, plus the newest `lastSyncedAt` those rows carry.
  const activeCount = (connections.data || []).filter((c) => c.status === 'ACTIVE').length;
  const attentionCount = (connections.data || []).filter((c) => c.status !== 'ACTIVE').length;
  const lastSyncedAt = (connections.data || [])
    .map((c) => c.lastSyncedAt)
    .filter((d): d is string => !!d)
    .sort()
    .pop();
  const searchItems = useMemo(() => ([{ label: t('billingCommerce.yourConnections'), keywords: ['pos', 'menu', 'catalog', 'square', 'toast', 'clover'] }] as const), []); // eslint-disable-line react-hooks/exhaustive-deps

  // MUST be memoized: <SettingsPageFrame> lists `context` / `searchItems`
  // in its registration effect's dependency array, so an inline node or a
  // fresh array re-registers on every render and the shell's setState
  // re-renders us - an unbounded loop ("Maximum update depth exceeded").
  const context = useMemo(
    () => (
    <>
      <ContextModule
        label={t('settings.cc.integrations.providerRail.connectionsLabel')}
        title={t('settings.cc.integrations.providerRail.connections', { count: activeCount })}
      >
        {t('settings.cc.integrations.providerRail.attention', { count: attentionCount })}
      </ContextModule>
      <ContextModule label={t('settings.cc.integrations.providerRail.lastSyncLabel')}>
        {lastSyncedAt
          ? new Date(lastSyncedAt).toLocaleString()
          : t('settings.cc.integrations.providerRail.noSync')}
      </ContextModule>
      <ContextModule label={t('settings.cc.integrations.railAuditLabel')}>
        <ContextAction href={`/${schoolId}/audit`}>{t('settings.cc.integrations.railAuditAction')}</ContextAction>
      </ContextModule>
    </>
    ),
    // `t` is intentionally NOT a dependency: useTranslations() returns a
    // fresh function identity on every render, which would defeat the
    // memo and re-register the page in a loop. Copy is static per locale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [schoolId, activeCount, attentionCount, lastSyncedAt],
  );

  return (
    <SettingsPageFrame
      section="integrations"
      subtitle={t('settings.cc.integrations.families.pos')}
      title={t('settings.cc.integrations.pages.pos.title')}
      description={t('settings.cc.integrations.pages.pos.description')}
      context={context}
      searchItems={searchItems}
    >
    <div className="space-y-6">
      <EditorHead
        icon={Utensils}
        title={t('billingCommerce.posCatalogSync')}
        description={t('billingCommerce.posHeroSubtitle')}
      />

      {/* 2026-06-02: catalog sync is LIVE for self-serve providers. */}
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 flex items-start gap-3 text-emerald-900">
        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
        <div className="text-xs leading-relaxed">
          <strong className="font-bold">{t('billingCommerce.catalogSyncIsLive')}</strong> {t('billingCommerce.catalogSyncLiveDetail')} <strong>{t('billingCommerce.multiLocationChains')}</strong>{' '}
          {t('billingCommerce.onceConnectedMapStore')} <em>{t('billingCommerce.storesLabel')}</em> {t('billingCommerce.posDrivesPricesDetail')}
        </div>
      </div>

      {/* Connections */}
      <section>
        <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">{t('billingCommerce.yourConnections')}</h2>
        {connections.isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
        ) : connections.data && connections.data.length > 0 ? (
          <div className="grid gap-3">
            {connections.data.map((c) => (
              <ConnectionRow
                key={c.id}
                connection={c}
                onSync={async () => {
                  const r: any = await apiFetch(`/pos/connections/${c.id}/sync`, { method: 'POST' });
                  if (r?.message) await appAlert({ title: t('billingCommerce.posSync'), message: r.message, tone: 'info' });
                  qc.invalidateQueries({ queryKey: ['pos-connections'] });
                }}
                onDisconnect={async () => {
                  if (!(await appConfirm({
                    title: t('billingCommerce.disconnectPosProvider'),
                    message: t('billingCommerce.posDisconnectMessage', { name: c.providerName }),
                    confirmLabel: t('billingCommerce.disconnect'),
                    tone: 'danger',
                  }))) return;
                  await apiFetch(`/pos/connections/${c.id}`, { method: 'DELETE' });
                  qc.invalidateQueries({ queryKey: ['pos-connections'] });
                }}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
            {t('billingCommerce.noPosConnected')}
          </div>
        )}
      </section>

      {/* Provider catalog */}
      <section>
        <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">{t('billingCommerce.availablePosProviders')}</h2>
        {providers.isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
        ) : (
          <div className="space-y-6">
            {Object.entries(grouped).map(([scope, list]) => (
              <div key={scope}>
                <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-2">
                  {SCOPE_LABELS[scope] || scope}
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {list.map((p) => (
                    <ProviderTile
                      key={p.id}
                      provider={p}
                      connected={connections.data?.some((c) => c.providerId === p.id)}
                      onConnect={() => setConnectModalProvider(p)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {connectModalProvider && (
        <ConnectModal
          provider={connectModalProvider}
          onClose={() => setConnectModalProvider(null)}
          onConnected={() => {
            qc.invalidateQueries({ queryKey: ['pos-connections'] });
            setConnectModalProvider(null);
          }}
        />
      )}
    </div>
    </SettingsPageFrame>
  );
}

function ConnectionRow({ connection, onSync, onDisconnect }: { connection: PosConnection; onSync: () => void; onDisconnect: () => void }) {
  const t = useTranslations();
  const statusColor =
    connection.status === 'ACTIVE' ? 'text-emerald-700 bg-emerald-50 border-emerald-200' :
    connection.status === 'PENDING' ? 'text-amber-700 bg-amber-50 border-amber-200' :
    'text-rose-700 bg-rose-50 border-rose-200';
  const lastSync = connection.lastSyncedAt
    ? new Date(connection.lastSyncedAt).toLocaleString()
    : t('billingCommerce.never');
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
      <div className="flex items-center gap-3 p-4">
        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center text-white font-bold text-lg flex-shrink-0">
          {connection.providerName.charAt(0)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-800">{connection.providerName}</span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold uppercase tracking-wider ${statusColor}`}>
              {connection.status}
            </span>
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            {t('billingCommerce.itemsLastSynced', { count: connection.itemCount, lastSync })}
            {connection.statusReason && <span className="ml-2 text-rose-600">· {connection.statusReason}</span>}
          </div>
        </div>
        <button onClick={onSync} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-100 inline-flex items-center gap-1.5">
          <RefreshCw className="w-3 h-3" /> {t('billingCommerce.syncNow')}
        </button>
        <button onClick={onDisconnect} aria-label={t('billingCommerce.disconnect')} className="p-1.5 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
      {connection.status === 'ACTIVE' && (
        <div className="px-4 pb-4">
          <StoreMappingPanel connectionId={connection.id} />
        </div>
      )}
    </div>
  );
}

/**
 * Multi-location store→location mapping (2026-06-02). Lists the POS stores
 * synced under this connection (Square locations, etc.) and lets the operator
 * map each to one of their locations. Mapping a store is what lets the POS
 * drive THAT store's per-location pricing — the bridge writes per-location
 * overrides only for mapped stores. Renders nothing for single-location
 * connections (no synced POS locations).
 */
interface PosStore { id: string; externalId: string; name: string; address?: string | null; locationTenantId?: string | null; isActive?: boolean }
function StoreMappingPanel({ connectionId }: { connectionId: string }) {
  const t = useTranslations();
  const qc = useQueryClient();
  const locations = useQuery({
    queryKey: ['pos-locations', connectionId],
    queryFn: () => apiFetch<PosStore[]>(`/pos/connections/${connectionId}/locations`),
  });
  const children = useQuery({
    queryKey: ['tenant-children-for-pos'],
    queryFn: () =>
      apiFetch<{ districtId: string; children: { id: string; name: string }[] }>('/tenants/children')
        .catch(() => ({ districtId: '', children: [] as { id: string; name: string }[] })),
  });
  const mapStore = useMutation({
    mutationFn: ({ locationId, locationTenantId }: { locationId: string; locationTenantId: string | null }) =>
      apiFetch(`/pos/connections/${connectionId}/locations/${locationId}`, {
        method: 'PUT',
        body: JSON.stringify({ locationTenantId }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pos-locations', connectionId] }),
  });

  const stores = locations.data || [];
  if (locations.isLoading || stores.length === 0) return null; // single-location → nothing to map
  const kids = children.data?.children || [];
  const mapped = stores.filter((s) => s.locationTenantId).length;

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="text-xs font-bold text-slate-600 mb-2">
        {t('billingCommerce.storesMappedCount', { total: stores.length, mapped })}
        <span className="font-normal text-slate-400">{t('billingCommerce.mapStoreHint')}</span>
      </div>
      <div className="space-y-1.5">
        {stores.map((s) => (
          <div key={s.id} className="flex items-center gap-2 text-xs">
            <span className="flex-1 min-w-0 truncate font-medium text-slate-700">
              {s.name}
              {s.address ? <span className="text-slate-400"> · {s.address}</span> : null}
            </span>
            <select
              value={s.locationTenantId || ''}
              onChange={(e) => mapStore.mutate({ locationId: s.id, locationTenantId: e.target.value || null })}
              className="px-2 py-1 rounded-md border border-slate-300 bg-white text-slate-700 max-w-[13rem]"
            >
              <option value="">{t('billingCommerce.notMapped')}</option>
              {kids.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
            </select>
          </div>
        ))}
      </div>
      {kids.length === 0 && (
        <p className="mt-2 text-[11px] text-slate-400">
          {t('billingCommerce.noLocationsFound')}
        </p>
      )}
    </div>
  );
}

function ProviderTile({ provider, connected, onConnect }: { provider: PosProvider; connected?: boolean; onConnect: () => void }) {
  const t = useTranslations();
  const caps = provider.capabilities;
  const isClosed = provider.integrationTier === 'CLOSED';
  const isPartner = provider.integrationTier === 'PARTNER';
  return (
    <button
      onClick={isClosed ? () => provider.docsUrl && window.open(provider.docsUrl, '_blank') : onConnect}
      disabled={connected}
      className={`text-left p-4 rounded-xl border-2 transition-all ${
        connected ? 'bg-emerald-50 border-emerald-200 cursor-default'
                  : isClosed ? 'bg-slate-50 border-slate-200 opacity-75'
                  : isPartner ? 'bg-amber-50/30 border-amber-200 hover:border-amber-400 hover:shadow-md'
                  : 'bg-white border-slate-200 hover:border-amber-300 hover:shadow-md'
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="text-2xl">{provider.iconEmoji || '🛒'}</div>
        <div className="flex items-center gap-1">
          {connected && <CheckCircle2 className="w-5 h-5 text-emerald-600" />}
          {isClosed && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-200 text-slate-600 uppercase tracking-wider">{t('billingCommerce.infoOnly')}</span>}
          {isPartner && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 uppercase tracking-wider">{t('billingCommerce.partnership')}</span>}
          {provider.integrationTier === 'DIRECT' && !connected && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 uppercase tracking-wider">{t('billingCommerce.selfServe')}</span>
          )}
        </div>
      </div>
      <div className="font-bold text-slate-800 text-sm">{provider.name}</div>
      <div className="text-[11px] text-slate-500 mt-1 leading-snug line-clamp-2">{provider.blurb}</div>
      {provider.tierReason && (
        <div className="text-[10px] text-slate-400 mt-1 leading-snug italic line-clamp-2">{provider.tierReason}</div>
      )}
      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        {provider.pricingNote && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{provider.pricingNote}</span>
        )}
        {caps.realtimeUpdates && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">{t('billingCommerce.realtimeBadge')}</span>
        )}
        {caps.locationsSync && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700">{t('billingCommerce.multiLoc')}</span>
        )}
      </div>
    </button>
  );
}

function ConnectModal({ provider, onClose, onConnected }: { provider: PosProvider; onClose: () => void; onConnected: () => void }) {
  const t = useTranslations();
  useOverlayLock(); // hide mobile tab bar so the modal footer clears it
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [displayName, setDisplayName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true); setErr(null);
    try {
      await apiFetch('/pos/connections', {
        method: 'POST',
        body: JSON.stringify({ providerId: provider.id, displayName: displayName || undefined, credentials }),
      });
      onConnected();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    // Backdrop — mouse-only convenience; the X icon button and Close/Cancel
    // button below are the keyboard/AT-accessible dismissal paths.
    // a11y wave (2026-08-24).
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[85dvh] overflow-y-auto p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="text-4xl">{provider.iconEmoji || '🛒'}</div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">{t('billingCommerce.connectProvider', { name: provider.name })}</h2>
              <p className="text-xs text-slate-500">{provider.blurb}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>

        {provider.docsUrl && (
          <a href={provider.docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-amber-600 hover:underline">
            <ExternalLink className="w-3 h-3" /> {t('billingCommerce.providerDocumentation')}
          </a>
        )}

        <div className="space-y-3">
          {/* 2026-05-28 audit P1-6: PARTNER-tier POS providers have no
              live sync handler yet (Toast / Clover / Lightspeed /
              Shopify / Stripe-catalog / MINDBODY). Show an honest
              "on the roadmap" panel instead of a credential form that
              saves a PENDING row which can never sync. Mirrors the
              streaming page's PARTNER treatment. DIRECT providers
              (Square OAuth + Custom Webhook) keep their real forms. */}
          {provider.integrationTier === 'PARTNER' ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800 space-y-2">
              <p className="font-bold flex items-center gap-1.5">
                <ShieldAlert className="w-4 h-4" /> {t('billingCommerce.connectorInDevelopment', { name: provider.name })}
              </p>
              <p>
                {provider.tierReason ||
                  t('billingCommerce.requiresPartnerIntegration', { name: provider.name })}
              </p>
              <p className="text-amber-700">
                {t('billingCommerce.wantThisPrioritized')}{' '}
                <a href="mailto:sales@venueos.com" className="font-bold underline">sales@venueos.com</a>{' '}
                {t('billingCommerce.fastTrackIt')}{' '}
                <strong>Custom Webhook</strong> {t('billingCommerce.webhookWorksToday')}
              </p>
            </div>
          ) : (
          <>
          <Field label={t('billingCommerce.displayNameOptional')} placeholder={provider.name} value={displayName} onChange={setDisplayName} />

          {provider.auth === 'apiKey' && (
            <>
              <Field label={t('billingCommerce.apiKey')} placeholder="..." value={credentials.apiKey || ''} onChange={(v) => setCredentials({ ...credentials, apiKey: v })} />
              <Field label={t('billingCommerce.accountIdOptional')} placeholder="..." value={credentials.accountId || ''} onChange={(v) => setCredentials({ ...credentials, accountId: v })} />
            </>
          )}
          {provider.auth === 'partnerKey' && (
            <Field label={t('billingCommerce.partnerKey')} placeholder="..." value={credentials.partnerKey || ''} onChange={(v) => setCredentials({ ...credentials, partnerKey: v })} />
          )}
          {provider.auth === 'webhook' && (
            <>
              <Field label={t('billingCommerce.webhookSecret')} placeholder={t('billingCommerce.chooseRandomString')} value={credentials.webhookSecret || ''} onChange={(v) => setCredentials({ ...credentials, webhookSecret: v })} />
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-600 space-y-2">
                <p>
                  {t('billingCommerce.webhookAfterConnecting')} <code className="font-mono">POST</code> {t('billingCommerce.webhookYourCatalogTo')}{' '}
                  <code className="font-mono break-all">/api/v1/pos/webhook/{provider.id}</code> {t('billingCommerce.webhookWithThisSecret')} <code className="font-mono">X-Webhook-Secret</code> {t('billingCommerce.webhookHeaderRepost')} <code className="font-mono">id</code>{' '}
                  {t('billingCommerce.webhookUpdatedInPlace')}
                </p>
                <p className="font-bold text-slate-700">{t('billingCommerce.bodyApplicationJson')}</p>
                <pre className="bg-white border border-slate-200 rounded-md p-2 overflow-x-auto text-[10px] leading-relaxed text-slate-700">{`{
  "items": [
    {
      "id": "burger-01",
      "name": "Classic Burger",
      "priceCents": 799,
      "description": "1/4 lb, lettuce, tomato",
      "category": "Burgers",
      "available": true,
      "imageUrl": "https://...",
      "salePriceCents": 599,
      "badges": ["GF"]
    }
  ]
}`}</pre>
                <p className="text-slate-500">
                  {t('billingCommerce.webhookRequiredPerItem')} <code className="font-mono">id</code> {t('billingCommerce.webhookOr')}{' '}
                  <code className="font-mono">externalId</code>{t('billingCommerce.webhookAnd')} <code className="font-mono">name</code>{t('billingCommerce.webhookPriceCents')}<code className="font-mono">priceCents</code>{t('billingCommerce.webhookOrDollar')}<code className="font-mono">price</code>{t('billingCommerce.webhookEg')} <code className="font-mono">7.99</code>{t('billingCommerce.webhookEverythingOptional')} <code className="font-mono">available</code> {t('billingCommerce.webhookItemShows')} <code className="font-mono">{`{ ok: true, upserted, skipped }`}</code>.
                </p>
              </div>
            </>
          )}
          {provider.auth === 'oauth2' && provider.integrationTier === 'DIRECT' && (
            <OAuthConnectPanel provider={provider} onStart={onClose} />
          )}
          </>
          )}
        </div>

        {err && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {err}
          </div>
        )}

        <div className="flex gap-2 justify-end pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm font-bold rounded-lg text-slate-600 hover:bg-slate-50">{provider.integrationTier === 'PARTNER' ? t('billingCommerce.close') : t('billingCommerce.cancel')}</button>
          {/* No Connect for PARTNER (no handler — would save a dead row)
              or oauth2 (uses its own redirect button). */}
          {provider.auth !== 'oauth2' && provider.integrationTier !== 'PARTNER' && (
            <button
              onClick={submit}
              disabled={submitting}
              className="px-4 py-2 text-sm font-bold rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
            >
              {submitting && <Loader2 className="w-3 h-3 animate-spin" />}
              {t('billingCommerce.connect')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Generic OAuth connect button for any DIRECT-tier OAuth POS provider
 * (Square / Clover / Lightspeed / Shopify). Fetches the authorize URL from
 * `/pos/oauth/{id}/authorize` (which mints CSRF state server-side + resolves
 * the right connector) then redirects the operator to the provider. After
 * approval the provider redirects back to `/api/v1/pos/oauth/{id}/callback`,
 * which lands on `/connect/{id}/done?status=...`.
 *
 * Shopify needs the shop domain BEFORE the redirect (its authorize URL is
 * per-shop), so for that provider we collect it here and pass `?shop=`.
 */
function OAuthConnectPanel({ provider, onStart }: { provider: { id: string; name: string }; onStart: () => void }) {
  const t = useTranslations();
  const needsShop = provider.id === 'shopify-pos';
  const [shop, setShop] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const start = async () => {
    setLoading(true); setErr(null);
    try {
      const qs = needsShop ? `?shop=${encodeURIComponent(shop.trim())}` : '';
      const r = await apiFetch<{ url: string }>(`/pos/oauth/${provider.id}/authorize${qs}`);
      onStart();
      window.location.href = r.url;
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setLoading(false);
    }
  };
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 space-y-2">
      <p className="font-bold">{t('billingCommerce.connectWithProvider', { name: provider.name })}</p>
      <p>{t('billingCommerce.redirectedToAuthorize', { name: provider.name })}</p>
      {needsShop && (
        <label className="block">
          <span className="font-bold">{t('billingCommerce.yourStoreDomain')}</span>
          <input
            type="text"
            value={shop}
            onChange={(e) => setShop(e.target.value)}
            placeholder="your-store.myshopify.com"
            className="mt-1 w-full px-2 py-1.5 rounded-md border border-emerald-300 text-emerald-900 placeholder:text-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400"
          />
        </label>
      )}
      <button
        onClick={start}
        disabled={loading || (needsShop && !shop.trim())}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 disabled:opacity-50"
      >
        {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <ExternalLink className="w-3 h-3" />}
        {t('billingCommerce.signInWith', { name: provider.name })}
      </button>
      {err && <p className="text-rose-700 text-[11px]">{err}</p>}
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="text-xs font-bold text-slate-600">{label}</span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-300"
      />
    </label>
  );
}
