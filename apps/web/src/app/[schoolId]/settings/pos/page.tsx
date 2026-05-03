'use client';

/**
 * /[schoolId]/settings/pos — POS providers admin.
 *
 * Sprint 8d (2026-05-03). Connect a POS, sync the catalog, surface
 * synced items to menu-board widgets. Same UX shape as
 * /settings/streaming (provider tile grid → connect modal → list of
 * connections + sync status).
 *
 * Per-provider OAuth/sync handlers ship in
 * apps/api/src/pos/providers/<id>.ts. Until they ship, the wizard
 * accepts credentials but the sync button returns "Sync handler not
 * yet implemented" — so an operator can still PRE-CONFIGURE a
 * provider and trigger sync once the handler lands.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { Loader2, ExternalLink, Trash2, X, AlertCircle, CheckCircle2, ShieldAlert, RefreshCw, Utensils } from 'lucide-react';

interface PosProvider {
  id: string;
  name: string;
  scope: string;
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
  'restaurant-qsr': '🍔 Restaurant / QSR',
  'restaurant-table': '🍽 Full-service dining',
  'retail': '🛍 Retail',
  'bar': '🍺 Bar',
  'universal': '🔗 Universal',
};

export default function PosSettingsPage() {
  const qc = useQueryClient();
  const providers = useQuery<PosProvider[]>({ queryKey: ['pos-providers'], queryFn: () => apiFetch<PosProvider[]>('/pos/providers') });
  const connections = useQuery<PosConnection[]>({ queryKey: ['pos-connections'], queryFn: () => apiFetch<PosConnection[]>('/pos/connections') });
  const [connectModalProvider, setConnectModalProvider] = useState<PosProvider | null>(null);

  const grouped = (providers.data || []).reduce<Record<string, PosProvider[]>>((acc, p) => {
    (acc[p.scope] = acc[p.scope] || []).push(p);
    return acc;
  }, {});

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="rounded-2xl bg-gradient-to-br from-amber-600 via-orange-600 to-red-600 p-6 text-white relative overflow-hidden">
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(white 1px, transparent 1px)', backgroundSize: '24px 24px' }} />
        <div className="relative">
          <h1 className="text-2xl font-extrabold tracking-tight flex items-center gap-2">
            <Utensils className="w-6 h-6" /> POS catalog sync
          </h1>
          <p className="text-amber-50 mt-1.5 text-sm max-w-xl">
            Connect your point-of-sale. Menu boards, price callouts, and inventory widgets auto-sync from the live catalog. No more "we changed the burger price three weeks ago and the screens still say $7.99."
          </p>
        </div>
      </div>

      {/* Connections */}
      <section>
        <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Your connections</h2>
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
                  if (r?.message) alert(r.message);
                  qc.invalidateQueries({ queryKey: ['pos-connections'] });
                }}
                onDisconnect={async () => {
                  if (!confirm(`Disconnect ${c.providerName}? Synced menu items will be removed from your screens.`)) return;
                  await apiFetch(`/pos/connections/${c.id}`, { method: 'DELETE' });
                  qc.invalidateQueries({ queryKey: ['pos-connections'] });
                }}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
            No POS connected yet. Pick one below to get started.
          </div>
        )}
      </section>

      {/* Provider catalog */}
      <section>
        <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Available POS providers</h2>
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
  );
}

function ConnectionRow({ connection, onSync, onDisconnect }: { connection: PosConnection; onSync: () => void; onDisconnect: () => void }) {
  const statusColor =
    connection.status === 'ACTIVE' ? 'text-emerald-700 bg-emerald-50 border-emerald-200' :
    connection.status === 'PENDING' ? 'text-amber-700 bg-amber-50 border-amber-200' :
    'text-rose-700 bg-rose-50 border-rose-200';
  const lastSync = connection.lastSyncedAt
    ? new Date(connection.lastSyncedAt).toLocaleString()
    : 'never';
  return (
    <div className="flex items-center gap-3 p-4 bg-white rounded-xl border border-slate-200 shadow-sm">
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
          {connection.itemCount} item{connection.itemCount === 1 ? '' : 's'} · last synced {lastSync}
          {connection.statusReason && <span className="ml-2 text-rose-600">· {connection.statusReason}</span>}
        </div>
      </div>
      <button onClick={onSync} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-100 inline-flex items-center gap-1.5">
        <RefreshCw className="w-3 h-3" /> Sync now
      </button>
      <button onClick={onDisconnect} aria-label="Disconnect" className="p-1.5 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600">
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}

function ProviderTile({ provider, connected, onConnect }: { provider: PosProvider; connected?: boolean; onConnect: () => void }) {
  const caps = provider.capabilities;
  return (
    <button
      onClick={onConnect}
      disabled={connected || provider.salesLedOnly}
      className={`text-left p-4 rounded-xl border-2 transition-all ${
        connected ? 'bg-emerald-50 border-emerald-200 cursor-default'
                  : provider.salesLedOnly ? 'bg-slate-50 border-slate-200 opacity-60 cursor-not-allowed'
                  : 'bg-white border-slate-200 hover:border-amber-300 hover:shadow-md'
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="text-2xl">{provider.iconEmoji || '🛒'}</div>
        {connected && <CheckCircle2 className="w-5 h-5 text-emerald-600" />}
      </div>
      <div className="font-bold text-slate-800 text-sm">{provider.name}</div>
      <div className="text-[11px] text-slate-500 mt-1 leading-snug line-clamp-2">{provider.blurb}</div>
      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        {provider.pricingNote && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{provider.pricingNote}</span>
        )}
        {caps.realtimeUpdates && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">⚡ realtime</span>
        )}
        {caps.locationsSync && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700">multi-loc</span>
        )}
        {provider.salesLedOnly && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 inline-flex items-center gap-1">
            <ShieldAlert className="w-2.5 h-2.5" /> Sales-led
          </span>
        )}
      </div>
    </button>
  );
}

function ConnectModal({ provider, onClose, onConnected }: { provider: PosProvider; onClose: () => void; onConnected: () => void }) {
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
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="text-4xl">{provider.iconEmoji || '🛒'}</div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">Connect {provider.name}</h2>
              <p className="text-xs text-slate-500">{provider.blurb}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>

        {provider.docsUrl && (
          <a href={provider.docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-amber-600 hover:underline">
            <ExternalLink className="w-3 h-3" /> Provider documentation
          </a>
        )}

        <div className="space-y-3">
          <Field label="Display name (optional)" placeholder={provider.name} value={displayName} onChange={setDisplayName} />

          {provider.auth === 'apiKey' && (
            <>
              <Field label="API key" placeholder="..." value={credentials.apiKey || ''} onChange={(v) => setCredentials({ ...credentials, apiKey: v })} />
              <Field label="Account ID (optional)" placeholder="..." value={credentials.accountId || ''} onChange={(v) => setCredentials({ ...credentials, accountId: v })} />
            </>
          )}
          {provider.auth === 'partnerKey' && (
            <Field label="Partner key" placeholder="..." value={credentials.partnerKey || ''} onChange={(v) => setCredentials({ ...credentials, partnerKey: v })} />
          )}
          {provider.auth === 'webhook' && (
            <>
              <Field label="Webhook secret" placeholder="..." value={credentials.webhookSecret || ''} onChange={(v) => setCredentials({ ...credentials, webhookSecret: v })} />
              <p className="text-[11px] text-slate-500">After connecting, post your catalog to <code>/api/v1/pos/webhook/{provider.id}</code> with this secret in the <code>X-Webhook-Secret</code> header.</p>
            </>
          )}
          {provider.auth === 'oauth2' && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
              OAuth flow not yet implemented for {provider.name}. Save the row now — the sync handler will activate once the OAuth callback ships in a follow-up release.
            </div>
          )}
        </div>

        {err && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {err}
          </div>
        )}

        <div className="flex gap-2 justify-end pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm font-bold rounded-lg text-slate-600 hover:bg-slate-50">Cancel</button>
          <button
            onClick={submit}
            disabled={submitting}
            className="px-4 py-2 text-sm font-bold rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 inline-flex items-center gap-2"
          >
            {submitting && <Loader2 className="w-3 h-3 animate-spin" />}
            Connect
          </button>
        </div>
      </div>
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
