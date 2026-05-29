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
import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { appConfirm, appAlert } from '@/components/ui/app-dialog';
import { ArrowLeft, Loader2, ExternalLink, Trash2, X, AlertCircle, CheckCircle2, ShieldAlert, RefreshCw, Utensils } from 'lucide-react';

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
  'restaurant-qsr': '🍔 Restaurant / QSR',
  'restaurant-table': '🍽 Full-service dining',
  'retail': '🛍 Retail',
  'bar': '🍺 Bar',
  'universal': '🔗 Universal',
};

export default function PosSettingsPage() {
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

  return (
    <div className="space-y-6 max-w-6xl">
      <Link
        href={`/${schoolId}/settings`}
        className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-orange-600"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Settings
      </Link>
      <div className="rounded-2xl bg-gradient-to-br from-amber-600 via-orange-600 to-red-600 p-6 text-white relative overflow-hidden">
        <div className="absolute top-0 right-0 bottom-0 left-0 opacity-10" style={{ backgroundImage: 'radial-gradient(white 1px, transparent 1px)', backgroundSize: '24px 24px' }} />
        <div className="relative">
          <h1 className="text-2xl font-extrabold tracking-tight flex items-center gap-2">
            <Utensils className="w-6 h-6" /> POS catalog sync
          </h1>
          <p className="text-amber-50 mt-1.5 text-sm max-w-xl">
            Connect your point-of-sale. Menu boards, price callouts, and inventory widgets auto-sync from the live catalog. No more &ldquo;we changed the burger price three weeks ago and the screens still say $7.99.&rdquo;
          </p>
        </div>
      </div>

      {/* 2026-05-23 launch audit P1: pre-warn operators that catalog
          sync handlers haven't shipped yet. Previously they could
          connect Square / Toast / Clover credentials, click "Sync now,"
          then get a generic "Sync handler not yet implemented" alert.
          Better to set expectations on the page header before they
          invest in the OAuth dance. */}
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 flex items-start gap-3 text-amber-900">
        <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
        <div className="text-xs leading-relaxed">
          <strong className="font-bold">Heads up — catalog sync is on the roadmap.</strong> You
          can pre-configure a provider connection today and we&rsquo;ll preserve your credentials, but
          the per-provider catalog handlers (Square / Toast / Clover, etc.) ship in a
          follow-up. Hitting <em>Sync now</em> will return a clear &ldquo;not yet implemented&rdquo;
          message until the handler lands.
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
                  if (r?.message) await appAlert({ title: 'POS sync', message: r.message, tone: 'info' });
                  qc.invalidateQueries({ queryKey: ['pos-connections'] });
                }}
                onDisconnect={async () => {
                  if (!(await appConfirm({
                    title: 'Disconnect POS provider?',
                    message: `${c.providerName} will be disconnected and synced menu items removed from your screens.`,
                    confirmLabel: 'Disconnect',
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
          {isClosed && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-200 text-slate-600 uppercase tracking-wider">Info only</span>}
          {isPartner && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 uppercase tracking-wider">Partnership</span>}
          {provider.integrationTier === 'DIRECT' && !connected && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 uppercase tracking-wider">Self-serve</span>
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
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">⚡ realtime</span>
        )}
        {caps.locationsSync && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700">multi-loc</span>
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
                <ShieldAlert className="w-4 h-4" /> {provider.name} connector is in development
              </p>
              <p>
                {provider.tierReason ||
                  `${provider.name} requires a partner integration we haven't shipped yet.`}
              </p>
              <p className="text-amber-700">
                Want this prioritized? Tell us at{' '}
                <a href="mailto:sales@venueos.com" className="font-bold underline">sales@venueos.com</a>{' '}
                and we&rsquo;ll fast-track it. In the meantime you can push your catalog through the{' '}
                <strong>Custom Webhook</strong> provider above — it works today.
              </p>
            </div>
          ) : (
          <>
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
              <Field label="Webhook secret" placeholder="Choose a long random string" value={credentials.webhookSecret || ''} onChange={(v) => setCredentials({ ...credentials, webhookSecret: v })} />
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-600 space-y-2">
                <p>
                  After connecting, <code className="font-mono">POST</code> your catalog to{' '}
                  <code className="font-mono break-all">/api/v1/pos/webhook/{provider.id}</code> with this
                  secret in the <code className="font-mono">X-Webhook-Secret</code> header. Re-post anytime
                  prices or availability change — items are matched by <code className="font-mono">id</code>{' '}
                  and updated in place.
                </p>
                <p className="font-bold text-slate-700">Body (application/json):</p>
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
                  Required per item: <code className="font-mono">id</code> (or{' '}
                  <code className="font-mono">externalId</code>) and <code className="font-mono">name</code>.
                  Price may be integer cents (<code className="font-mono">priceCents</code>) or a dollar
                  amount (<code className="font-mono">price</code>, e.g. <code className="font-mono">7.99</code>).
                  Everything else is optional; omit <code className="font-mono">available</code> and the item
                  shows. A correct push returns <code className="font-mono">{`{ ok: true, upserted, skipped }`}</code>.
                </p>
              </div>
            </>
          )}
          {provider.auth === 'oauth2' && provider.id === 'square' && (
            <SquareOAuthPanel onStart={onClose} />
          )}
          {provider.auth === 'oauth2' && provider.id !== 'square' && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
              OAuth flow not yet implemented for {provider.name}. Save the row now — the sync handler will activate once the OAuth callback ships in a follow-up release.
            </div>
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
          <button onClick={onClose} className="px-4 py-2 text-sm font-bold rounded-lg text-slate-600 hover:bg-slate-50">{provider.integrationTier === 'PARTNER' ? 'Close' : 'Cancel'}</button>
          {/* No Connect for PARTNER (no handler — would save a dead row)
              or oauth2 (uses its own redirect button). */}
          {provider.auth !== 'oauth2' && provider.integrationTier !== 'PARTNER' && (
            <button
              onClick={submit}
              disabled={submitting}
              className="px-4 py-2 text-sm font-bold rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
            >
              {submitting && <Loader2 className="w-3 h-3 animate-spin" />}
              Connect
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Square OAuth entry button. Fetches the authorize URL from the API
 * (which mints CSRF state server-side) then redirects the operator to
 * Square. After approval Square redirects back to
 * /api/v1/pos/oauth/square/callback which redirects to
 * /connect/square/done with a ?status flag.
 */
function SquareOAuthPanel({ onStart }: { onStart: () => void }) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const start = async () => {
    setLoading(true); setErr(null);
    try {
      const r = await apiFetch<{ url: string }>('/pos/oauth/square/authorize');
      onStart();
      window.location.href = r.url;
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setLoading(false);
    }
  };
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 space-y-2">
      <p className="font-bold">Connect with Square</p>
      <p>You&rsquo;ll be redirected to Square to authorize VenueOS to read your catalog. After approval Square sends you back here automatically and the first sync runs in the background.</p>
      <button
        onClick={start}
        disabled={loading}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 disabled:opacity-50"
      >
        {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <ExternalLink className="w-3 h-3" />}
        Sign in with Square
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
