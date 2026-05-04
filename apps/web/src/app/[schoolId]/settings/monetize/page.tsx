'use client';

/**
 * /[schoolId]/settings/monetize — Ad-network monetization admin.
 *
 * Sprint 8d (2026-05-03). Three sections:
 *   1. Earnings summary card (today / month / year + top network)
 *   2. Active connections (status, content controls, pause / resume)
 *   3. Available networks catalog (connect new)
 *
 * K-12 tenants only see the "house-only" network — schools cannot
 * legally run third-party advertising on their screens, and the
 * server enforces this regardless of UI state (k12Forbidden flag
 * in ad-network.ts).
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { Loader2, ExternalLink, Trash2, X, AlertCircle, CheckCircle2, ShieldAlert, Pause, Play, DollarSign, TrendingUp } from 'lucide-react';

interface AdNetwork {
  id: string;
  name: string;
  category: string;
  integrationTier: 'DIRECT' | 'PARTNER' | 'CLOSED';
  blurb: string;
  iconEmoji?: string;
  auth: string;
  pricingModel: 'cpm' | 'cpc' | 'cpd' | 'revshare';
  typicalCpmCents?: { low: number; high: number };
  takeRateBps?: number;
  pricingNote?: string;
  docsUrl?: string;
  websiteUrl?: string;
  bestFor?: string[];
  capabilities: Record<string, boolean>;
  salesLedOnly?: boolean;
  k12Forbidden?: boolean;
  tierReason?: string;
}

interface AdConnection {
  id: string;
  networkId: string;
  networkName: string;
  status: 'PENDING' | 'ACTIVE' | 'PAUSED' | 'EXPIRED' | 'REVOKED' | 'ERROR';
  statusReason?: string;
  impressionsTotal: number;
  grossRevenueCents: number;
  feeCents: number;
  contentControls: {
    blockedCategories: string[];
    pauseDuringEmergency: boolean;
  };
}

interface EarningsSummary {
  todayImpressions: number;
  todayRevenueCents: number;
  monthImpressions: number;
  monthRevenueCents: number;
  yearImpressions: number;
  yearRevenueCents: number;
  topNetwork?: { id: string; name: string; revenueCents: number };
}

const CATEGORY_LABELS: Record<string, string> = {
  'dooh-programmatic': '⚡ Programmatic DOOH',
  'venue-network': '🏢 Venue networks',
  'dooh-direct': '🤝 Direct sales',
  'house-only': '🏠 House ads only',
};

function fmtUSD(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function MonetizeSettingsPage() {
  const qc = useQueryClient();
  const networks = useQuery<AdNetwork[]>({ queryKey: ['ads-networks'], queryFn: () => apiFetch<AdNetwork[]>('/ads/networks') });
  const connections = useQuery<AdConnection[]>({ queryKey: ['ads-connections'], queryFn: () => apiFetch<AdConnection[]>('/ads/connections') });
  const earnings = useQuery<EarningsSummary>({ queryKey: ['ads-earnings'], queryFn: () => apiFetch<EarningsSummary>('/ads/earnings') });
  const [connectModalNetwork, setConnectModalNetwork] = useState<AdNetwork | null>(null);

  const grouped = (networks.data || []).reduce<Record<string, AdNetwork[]>>((acc, n) => {
    (acc[n.category] = acc[n.category] || []).push(n);
    return acc;
  }, {});

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="rounded-2xl bg-gradient-to-br from-emerald-600 via-teal-600 to-cyan-600 p-6 text-white relative overflow-hidden">
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(white 1px, transparent 1px)', backgroundSize: '24px 24px' }} />
        <div className="relative">
          <h1 className="text-2xl font-extrabold tracking-tight flex items-center gap-2">
            <DollarSign className="w-6 h-6" /> Monetize your screens
          </h1>
          <p className="text-emerald-50 mt-1.5 text-sm max-w-xl">
            Opt your screens into a programmatic ad network and earn per impression. You set the content controls; we route the inventory and pay you the rev share.
          </p>
        </div>
      </div>

      {/* Earnings summary */}
      <section>
        <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Earnings</h2>
        {earnings.isLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
        ) : earnings.data ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <EarningCard label="Today"      impressions={earnings.data.todayImpressions} revenueCents={earnings.data.todayRevenueCents} />
            <EarningCard label="This month" impressions={earnings.data.monthImpressions} revenueCents={earnings.data.monthRevenueCents} accent />
            <EarningCard label="This year"  impressions={earnings.data.yearImpressions}  revenueCents={earnings.data.yearRevenueCents} />
          </div>
        ) : null}
        {earnings.data?.topNetwork && (
          <div className="mt-3 p-3 bg-white border border-slate-200 rounded-xl text-xs text-slate-700 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-emerald-600" />
            Top earner this year: <strong>{earnings.data.topNetwork.name}</strong> — {fmtUSD(earnings.data.topNetwork.revenueCents)}
          </div>
        )}
      </section>

      {/* Connections */}
      <section>
        <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Active connections</h2>
        {connections.isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
        ) : connections.data && connections.data.length > 0 ? (
          <div className="grid gap-3">
            {connections.data.map((c) => (
              <ConnectionRow
                key={c.id}
                connection={c}
                onTogglePause={async () => {
                  const next = c.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
                  await apiFetch(`/ads/connections/${c.id}/status`, {
                    method: 'PATCH',
                    body: JSON.stringify({ status: next }),
                  });
                  qc.invalidateQueries({ queryKey: ['ads-connections'] });
                }}
                onDisconnect={async () => {
                  if (!confirm(`Disconnect ${c.networkName}? Future impressions stop earning.`)) return;
                  await apiFetch(`/ads/connections/${c.id}`, { method: 'DELETE' });
                  qc.invalidateQueries({ queryKey: ['ads-connections'] });
                }}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
            No ad networks connected. Pick one below to start earning per impression.
          </div>
        )}
      </section>

      {/* Network catalog */}
      <section>
        <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Available networks</h2>
        {networks.isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
        ) : (
          <div className="space-y-6">
            {Object.entries(grouped).map(([cat, list]) => (
              <div key={cat}>
                <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-2">
                  {CATEGORY_LABELS[cat] || cat}
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {list.map((n) => (
                    <NetworkTile
                      key={n.id}
                      network={n}
                      connected={connections.data?.some((c) => c.networkId === n.id)}
                      onConnect={() => setConnectModalNetwork(n)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {connectModalNetwork && (
        <ConnectModal
          network={connectModalNetwork}
          onClose={() => setConnectModalNetwork(null)}
          onConnected={() => {
            qc.invalidateQueries({ queryKey: ['ads-connections'] });
            setConnectModalNetwork(null);
          }}
        />
      )}
    </div>
  );
}

function EarningCard({ label, impressions, revenueCents, accent }: { label: string; impressions: number; revenueCents: number; accent?: boolean }) {
  return (
    <div className={`rounded-2xl p-5 ${accent ? 'bg-gradient-to-br from-emerald-500 to-teal-600 text-white' : 'bg-white border border-slate-200'}`}>
      <div className={`text-[11px] font-bold uppercase tracking-wider ${accent ? 'text-emerald-100' : 'text-slate-500'}`}>{label}</div>
      <div className={`text-3xl font-extrabold mt-1 ${accent ? 'text-white' : 'text-slate-800'}`}>{fmtUSD(revenueCents)}</div>
      <div className={`text-xs mt-1 ${accent ? 'text-emerald-100' : 'text-slate-500'}`}>{impressions.toLocaleString()} impression{impressions === 1 ? '' : 's'}</div>
    </div>
  );
}

function ConnectionRow({ connection, onTogglePause, onDisconnect }: { connection: AdConnection; onTogglePause: () => void; onDisconnect: () => void }) {
  const statusColor =
    connection.status === 'ACTIVE' ? 'text-emerald-700 bg-emerald-50 border-emerald-200' :
    connection.status === 'PAUSED' ? 'text-amber-700 bg-amber-50 border-amber-200' :
    connection.status === 'PENDING' ? 'text-slate-700 bg-slate-50 border-slate-200' :
    'text-rose-700 bg-rose-50 border-rose-200';
  return (
    <div className="flex items-center gap-3 p-4 bg-white rounded-xl border border-slate-200 shadow-sm">
      <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center text-white font-bold text-lg flex-shrink-0">
        {connection.networkName.charAt(0)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-bold text-slate-800">{connection.networkName}</span>
          <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold uppercase tracking-wider ${statusColor}`}>{connection.status}</span>
        </div>
        <div className="text-xs text-slate-500 mt-0.5">
          {connection.impressionsTotal.toLocaleString()} impressions · earned {fmtUSD(connection.grossRevenueCents - connection.feeCents)}
          {connection.contentControls.pauseDuringEmergency && <span className="ml-2 text-emerald-700">· pauses during emergency</span>}
          {connection.contentControls.blockedCategories.length > 0 && (
            <span className="ml-2 text-slate-600">· {connection.contentControls.blockedCategories.length} blocked categor{connection.contentControls.blockedCategories.length === 1 ? 'y' : 'ies'}</span>
          )}
        </div>
      </div>
      <button onClick={onTogglePause} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-50 text-slate-700 hover:bg-slate-100 inline-flex items-center gap-1.5">
        {connection.status === 'ACTIVE' ? <><Pause className="w-3 h-3" /> Pause</> : <><Play className="w-3 h-3" /> Resume</>}
      </button>
      <button onClick={onDisconnect} aria-label="Disconnect" className="p-1.5 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600">
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}

function NetworkTile({ network, connected, onConnect }: { network: AdNetwork; connected?: boolean; onConnect: () => void }) {
  const cpmRange = network.typicalCpmCents
    ? `$${(network.typicalCpmCents.low / 100).toFixed(0)}-$${(network.typicalCpmCents.high / 100).toFixed(0)} CPM`
    : null;
  const isClosed = network.integrationTier === 'CLOSED';
  const isPartner = network.integrationTier === 'PARTNER';
  // Cycle-2 BUG-004 fix (2026-05-03) — PARTNER networks (Hivestack,
  // Vistar, Place Exchange, Broadsign Reach, Loop Media) all require
  // a publisher contract before activation. Opening the same Connect
  // form as DIRECT tiles created empty-cred PENDING rows that never
  // resolved. Now PARTNER tiles open the vendor's publisher page in
  // a new tab so the operator can apply for partnership instead.
  const handleClick = isClosed
    ? () => network.docsUrl && window.open(network.docsUrl, '_blank')
    : isPartner
      ? () => {
          const url = network.docsUrl || network.websiteUrl;
          if (url) window.open(url, '_blank', 'noopener,noreferrer');
          else window.location.href = `mailto:partners@venueos.com?subject=${encodeURIComponent(`Partnership inquiry — ${network.name}`)}`;
        }
      : onConnect;
  return (
    <button
      onClick={handleClick}
      disabled={connected}
      className={`text-left p-4 rounded-xl border-2 transition-all ${
        connected ? 'bg-emerald-50 border-emerald-200 cursor-default'
                  : isClosed ? 'bg-slate-50 border-slate-200 opacity-75'
                  : isPartner ? 'bg-amber-50/30 border-amber-200 hover:border-amber-400 hover:shadow-md'
                  : 'bg-white border-slate-200 hover:border-emerald-300 hover:shadow-md'
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="text-2xl">{network.iconEmoji || '💰'}</div>
        <div className="flex items-center gap-1">
          {connected && <CheckCircle2 className="w-5 h-5 text-emerald-600" />}
          {isClosed && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-200 text-slate-600 uppercase tracking-wider">Info only</span>}
          {isPartner && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 uppercase tracking-wider">Partnership</span>}
          {network.integrationTier === 'DIRECT' && !connected && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 uppercase tracking-wider">Self-serve</span>
          )}
        </div>
      </div>
      <div className="font-bold text-slate-800 text-sm">{network.name}</div>
      <div className="text-[11px] text-slate-500 mt-1 leading-snug line-clamp-2">{network.blurb}</div>
      {network.tierReason && (
        <div className="text-[10px] text-slate-400 mt-1 leading-snug italic line-clamp-2">{network.tierReason}</div>
      )}
      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        {cpmRange && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">{cpmRange}</span>}
        {network.takeRateBps != null && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">we take {network.takeRateBps / 100}%</span>}
      </div>
      {isPartner && !connected && (
        <div className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold text-amber-700">
          <ExternalLink className="w-2.5 h-2.5" /> Apply for partnership
        </div>
      )}
    </button>
  );
}

function ConnectModal({ network, onClose, onConnected }: { network: AdNetwork; onClose: () => void; onConnected: () => void }) {
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [pauseDuringEmergency, setPauseDuringEmergency] = useState(true);
  const [blockedCategories, setBlockedCategories] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const TOGGLE_CATEGORIES = [
    { id: 'IAB7-39', label: 'Alcohol' },
    { id: 'IAB8',    label: 'Pharma' },
    { id: 'IAB9',    label: 'Gambling' },
    { id: 'IAB7',    label: 'Health' },
    { id: 'IAB23',   label: 'Religion' },
    { id: 'IAB24',   label: 'Politics' },
  ];

  const submit = async () => {
    setSubmitting(true); setErr(null);
    try {
      await apiFetch('/ads/connections', {
        method: 'POST',
        body: JSON.stringify({
          networkId: network.id,
          credentials,
          contentControls: { blockedCategories, pauseDuringEmergency, dayparts: [] },
        }),
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
            <div className="text-4xl">{network.iconEmoji || '💰'}</div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">Connect {network.name}</h2>
              <p className="text-xs text-slate-500">{network.blurb}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>

        {network.docsUrl && (
          <a href={network.docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-emerald-600 hover:underline">
            <ExternalLink className="w-3 h-3" /> Network documentation
          </a>
        )}

        <div className="space-y-3">
          {network.auth === 'apiKey' && (
            <Field label="API key" placeholder="..." value={credentials.apiKey || ''} onChange={(v) => setCredentials({ ...credentials, apiKey: v })} />
          )}
          {network.auth === 'partnerKey' && (
            <Field label="Partner key" placeholder="..." value={credentials.partnerKey || ''} onChange={(v) => setCredentials({ ...credentials, partnerKey: v })} />
          )}
          {network.auth === 'oauth2' && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
              OAuth flow not yet implemented for {network.name}. Save the row now — the OAuth callback ships in a follow-up release.
            </div>
          )}
        </div>

        {/* Content controls */}
        <div className="space-y-2">
          <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Content controls</h3>
          <label className="flex items-start gap-2 text-xs text-slate-700 p-2 rounded-lg cursor-pointer hover:bg-slate-50">
            <input type="checkbox" checked={pauseDuringEmergency} onChange={(e) => setPauseDuringEmergency(e.target.checked)} className="mt-0.5" />
            <span>Pause this network during emergency mode (recommended)</span>
          </label>
          <div className="text-[11px] font-bold text-slate-500 mt-2">Block these IAB content categories:</div>
          <div className="grid grid-cols-2 gap-1">
            {TOGGLE_CATEGORIES.map((cat) => (
              <label key={cat.id} className="flex items-center gap-2 text-xs text-slate-700 p-1.5 rounded cursor-pointer hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={blockedCategories.includes(cat.id)}
                  onChange={(e) => {
                    if (e.target.checked) setBlockedCategories([...blockedCategories, cat.id]);
                    else setBlockedCategories(blockedCategories.filter((c) => c !== cat.id));
                  }}
                />
                {cat.label}
              </label>
            ))}
          </div>
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
            className="px-4 py-2 text-sm font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 inline-flex items-center gap-2"
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
        className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-emerald-300"
      />
    </label>
  );
}
