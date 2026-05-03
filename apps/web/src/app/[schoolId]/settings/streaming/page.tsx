'use client';

/**
 * /[schoolId]/settings/streaming — Streaming providers admin.
 *
 * Sprint 8c (2026-05-03). Connect / disconnect providers + pick
 * channels + (future) schedule ad slots.
 *
 * UX:
 *   • Top: existing connections (status pill, channel count, disconnect).
 *   • Middle: provider catalog grouped by tier (venue / public / live /
 *     music / custom). Click a tile → connect modal.
 *   • Connect modal: provider-specific auth fields (apiKey, license,
 *     custom URL, "no auth"). On save → POST /streaming/connections.
 *   • Bottom: picked channels list (per-connection drill-down).
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { Loader2, Tv, ExternalLink, Trash2, Plus, X, AlertCircle, CheckCircle2, ShieldAlert } from 'lucide-react';

interface Provider {
  id: string;
  name: string;
  category: string;
  integrationTier: 'DIRECT' | 'PARTNER' | 'CLOSED';
  blurb: string;
  iconEmoji?: string;
  iconUrl?: string;
  auth: 'none' | 'apiKey' | 'oauth2' | 'license' | 'customHls' | 'iframeOnly';
  playback: string;
  commercialUseLegal: boolean;
  allowsAdOverlay: boolean;
  pricingNote?: string;
  docsUrl?: string;
  websiteUrl?: string;
  bestFor?: string[];
  requiresVenueLicense?: boolean;
  tierReason?: string;
}

interface Connection {
  id: string;
  providerId: string;
  providerName: string;
  displayName?: string;
  status: 'PENDING' | 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'ERROR';
  statusReason?: string;
  channelCount: number;
  createdAt: string;
}

interface Channel {
  id: string;
  connectionId: string;
  providerId: string;
  externalId: string;
  title: string;
  description?: string;
  thumbnailUrl?: string;
  category?: string;
  playbackUrl?: string;
  playbackType?: string;
  allowAdOverlay: boolean;
  status: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  'venue-fast': '🏢 Built for venues',
  'free-fast': '🌍 Free & venue-friendly',
  'live-platform': '📡 Live streaming platforms',
  'music': '🎵 Music & radio',
  'sports-news': '🏈 Sports & news',
  'custom': '🔗 Bring your own',
};

export default function StreamingSettingsPage() {
  const qc = useQueryClient();
  const providers = useQuery<Provider[]>({
    queryKey: ['streaming-providers'],
    queryFn: () => apiFetch<Provider[]>('/streaming/providers'),
  });
  const connections = useQuery<Connection[]>({
    queryKey: ['streaming-connections'],
    queryFn: () => apiFetch<Connection[]>('/streaming/connections'),
  });
  const channels = useQuery<Channel[]>({
    queryKey: ['streaming-channels'],
    queryFn: () => apiFetch<Channel[]>('/streaming/channels'),
  });

  const [connectModalProvider, setConnectModalProvider] = useState<Provider | null>(null);
  const [pickerConnection, setPickerConnection] = useState<Connection | null>(null);

  const grouped = (providers.data || []).reduce<Record<string, Provider[]>>((acc, p) => {
    (acc[p.category] = acc[p.category] || []).push(p);
    return acc;
  }, {});

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Hero */}
      <div className="rounded-2xl bg-gradient-to-br from-violet-600 via-fuchsia-600 to-pink-600 p-6 text-white relative overflow-hidden">
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(white 1px, transparent 1px)', backgroundSize: '24px 24px' }} />
        <div className="relative flex items-start justify-between gap-6">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight flex items-center gap-2">
              <Tv className="w-6 h-6" /> Streaming
            </h1>
            <p className="text-fuchsia-100 mt-1.5 text-sm max-w-xl">
              Connect a provider, pick channels, and stream live content to your venue screens — with optional ad overlays.
            </p>
          </div>
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
                channelCount={(channels.data || []).filter((ch) => ch.connectionId === c.id).length}
                onPickChannels={() => setPickerConnection(c)}
                onDisconnect={async () => {
                  if (!confirm(`Disconnect ${c.providerName}? Channels picked from this provider will stop playing.`)) return;
                  await apiFetch(`/streaming/connections/${c.id}`, { method: 'DELETE' });
                  qc.invalidateQueries({ queryKey: ['streaming-connections'] });
                  qc.invalidateQueries({ queryKey: ['streaming-channels'] });
                }}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
            No streaming providers connected yet. Pick one below to get started.
          </div>
        )}
      </section>

      {/* Provider catalog */}
      <section>
        <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Available providers</h2>
        {providers.isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
        ) : (
          <div className="space-y-6">
            {Object.entries(grouped).map(([cat, list]) => (
              <div key={cat}>
                <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-2">
                  {CATEGORY_LABELS[cat] || cat}
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

      {/* Connect modal */}
      {connectModalProvider && (
        <ConnectModal
          provider={connectModalProvider}
          onClose={() => setConnectModalProvider(null)}
          onConnected={() => {
            qc.invalidateQueries({ queryKey: ['streaming-connections'] });
            setConnectModalProvider(null);
          }}
        />
      )}

      {/* Channel picker */}
      {pickerConnection && (
        <ChannelPickerModal
          connection={pickerConnection}
          onClose={() => setPickerConnection(null)}
          onChanged={() => {
            qc.invalidateQueries({ queryKey: ['streaming-channels'] });
          }}
        />
      )}
    </div>
  );
}

// ─── Connection row ─────────────────────────────────────────────────────
function ConnectionRow({ connection, channelCount, onPickChannels, onDisconnect }: {
  connection: Connection;
  channelCount: number;
  onPickChannels: () => void;
  onDisconnect: () => void;
}) {
  const statusColor =
    connection.status === 'ACTIVE' ? 'text-emerald-700 bg-emerald-50 border-emerald-200' :
    connection.status === 'PENDING' ? 'text-amber-700 bg-amber-50 border-amber-200' :
    'text-rose-700 bg-rose-50 border-rose-200';

  return (
    <div className="flex items-center gap-3 p-4 bg-white rounded-xl border border-slate-200 shadow-sm hover:border-indigo-200 transition-colors">
      <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center text-white font-bold text-lg flex-shrink-0">
        {connection.providerName.charAt(0)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-bold text-slate-800">{connection.displayName || connection.providerName}</span>
          <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold uppercase tracking-wider ${statusColor}`}>
            {connection.status}
          </span>
        </div>
        <div className="text-xs text-slate-500 mt-0.5">
          {channelCount} channel{channelCount === 1 ? '' : 's'} picked
          {connection.statusReason && <span className="ml-2 text-rose-600">· {connection.statusReason}</span>}
        </div>
      </div>
      <button onClick={onPickChannels} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100">
        Pick channels
      </button>
      <button onClick={onDisconnect} aria-label="Disconnect" className="p-1.5 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600">
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}

// ─── Provider tile ──────────────────────────────────────────────────────
function ProviderTile({ provider, connected, onConnect }: { provider: Provider; connected?: boolean; onConnect: () => void }) {
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
                  : 'bg-white border-slate-200 hover:border-indigo-300 hover:shadow-md'
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="text-2xl">{provider.iconEmoji || '📺'}</div>
        <div className="flex items-center gap-1">
          {connected && <CheckCircle2 className="w-5 h-5 text-emerald-600" />}
          {/* 2026-05-03 — integration-tier badge. Operator audit:
              be honest about which providers actually have a public
              API path vs. which are closed-app-only. */}
          {isClosed && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-200 text-slate-600 uppercase tracking-wider">
              Info only
            </span>
          )}
          {isPartner && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 uppercase tracking-wider">
              Partnership
            </span>
          )}
          {provider.integrationTier === 'DIRECT' && !connected && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 uppercase tracking-wider">
              Self-serve
            </span>
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
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
            {provider.pricingNote}
          </span>
        )}
        {provider.requiresVenueLicense && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 inline-flex items-center gap-1">
            <ShieldAlert className="w-2.5 h-2.5" /> License req'd
          </span>
        )}
        {!provider.allowsAdOverlay && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500" title="Provider's own ads run; venue overlays not permitted">
            no overlay
          </span>
        )}
      </div>
    </button>
  );
}

// ─── Connect modal ──────────────────────────────────────────────────────
function ConnectModal({ provider, onClose, onConnected }: { provider: Provider; onClose: () => void; onConnected: () => void }) {
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [displayName, setDisplayName] = useState('');
  const [agreed, setAgreed] = useState(provider.auth === 'none');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (provider.requiresVenueLicense && !agreed) {
      setErr('Please confirm you have a venue license from this provider.');
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      await apiFetch('/streaming/connections', {
        method: 'POST',
        body: JSON.stringify({
          providerId: provider.id,
          displayName: displayName || undefined,
          credentials,
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
            <div className="text-4xl">{provider.iconEmoji || '📺'}</div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">Connect {provider.name}</h2>
              <p className="text-xs text-slate-500">{provider.blurb}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>

        {provider.docsUrl && (
          <a
            href={provider.docsUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline"
          >
            <ExternalLink className="w-3 h-3" /> Provider documentation
          </a>
        )}

        {/* Auth fields per provider */}
        <div className="space-y-3">
          <Field label="Display name (optional)" placeholder={provider.name} value={displayName} onChange={setDisplayName} />

          {provider.auth === 'none' && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">
              No credentials needed — this provider streams free public content.
            </div>
          )}

          {provider.auth === 'apiKey' && (
            <>
              <Field label="API key" placeholder="..." value={credentials.apiKey || ''} onChange={(v) => setCredentials({ ...credentials, apiKey: v })} />
              <Field label="Account ID (optional)" placeholder="..." value={credentials.accountId || ''} onChange={(v) => setCredentials({ ...credentials, accountId: v })} />
            </>
          )}

          {provider.auth === 'license' && (
            <>
              <Field label="License / account number" placeholder="e.g. 1234567890" value={credentials.licenseNumber || ''} onChange={(v) => setCredentials({ ...credentials, licenseNumber: v })} />
              <Field label="Region" placeholder="e.g. US-CA" value={credentials.region || ''} onChange={(v) => setCredentials({ ...credentials, region: v })} />
            </>
          )}

          {provider.auth === 'customHls' && (
            <>
              <Field label="Playback URL (.m3u8 / .mpd)" placeholder="https://example.com/live.m3u8" value={credentials.playbackUrl || ''} onChange={(v) => setCredentials({ ...credentials, playbackUrl: v })} />
              <p className="text-[11px] text-slate-500">
                You certify you own or are licensed for the content at this URL. We do not validate licensing.
              </p>
            </>
          )}

          {provider.auth === 'iframeOnly' && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
              No credentials needed for embed. After connecting you'll paste channel URLs (YouTube watch URL, Twitch login, etc.) when picking channels.
            </div>
          )}

          {provider.auth === 'oauth2' && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
              OAuth flow not yet implemented. Contact sales to enable {provider.name} on your account.
            </div>
          )}

          {provider.requiresVenueLicense && (
            <label className="flex items-start gap-2 text-xs text-slate-700 p-3 bg-amber-50 border border-amber-200 rounded-lg cursor-pointer">
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5" />
              <span>
                I confirm we have a current venue license from {provider.name} and are authorized to display this content commercially at our location.
              </span>
            </label>
          )}
        </div>

        {err && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {err}
          </div>
        )}

        <div className="flex gap-2 justify-end pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm font-bold rounded-lg text-slate-600 hover:bg-slate-50">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting || provider.auth === 'oauth2' || !agreed}
            className="px-4 py-2 text-sm font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
          >
            {submitting && <Loader2 className="w-3 h-3 animate-spin" />}
            Connect
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Channel picker modal ──────────────────────────────────────────────
function ChannelPickerModal({ connection, onClose, onChanged }: {
  connection: Connection;
  onClose: () => void;
  onChanged: () => void;
}) {
  const presets = useQuery<any[]>({
    queryKey: ['streaming-presets', connection.providerId],
    queryFn: () => apiFetch<any[]>(`/streaming/providers/${connection.providerId}/channels`),
  });
  const myChannels = useQuery<Channel[]>({
    queryKey: ['streaming-channels'],
    queryFn: () => apiFetch<Channel[]>('/streaming/channels'),
  });
  const myConnectionChannels = (myChannels.data || []).filter((c) => c.connectionId === connection.id);
  const pickedExternalIds = new Set(myConnectionChannels.map((c) => c.externalId));

  // Manual entry for providers without a preset list (custom HLS, YouTube, Twitch)
  const [manualUrl, setManualUrl] = useState('');
  const [manualTitle, setManualTitle] = useState('');

  const pick = useMutation({
    mutationFn: async (data: any) => apiFetch('/streaming/channels', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => onChanged(),
  });

  const unpick = useMutation({
    mutationFn: async (id: string) => apiFetch(`/streaming/channels/${id}`, { method: 'DELETE' }),
    onSuccess: () => onChanged(),
  });

  const handleManualAdd = () => {
    if (!manualUrl) return;
    let playbackType = 'hls';
    let externalId = manualUrl;
    if (/youtube\.com|youtu\.be/i.test(manualUrl) || /twitch\.tv|vimeo\.com/i.test(manualUrl)) playbackType = 'iframe';
    if (/\.mpd(\?|$)/i.test(manualUrl)) playbackType = 'dash';
    pick.mutate({
      connectionId: connection.id,
      externalId: externalId.slice(0, 250),
      title: manualTitle || manualUrl.slice(0, 80),
      playbackUrl: playbackType === 'iframe' ? undefined : manualUrl,
      playbackType,
      kind: 'LIVE',
    });
    setManualUrl('');
    setManualTitle('');
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-6 border-b border-slate-100 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Channels — {connection.providerName}</h2>
            <p className="text-xs text-slate-500 mt-1">Pick channels for the streaming widget. {pickedExternalIds.size} picked.</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-6 space-y-6">
          {/* Preset channels */}
          {presets.data && presets.data.length > 0 && (
            <div>
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Suggested channels</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {presets.data.map((p: any) => {
                  const picked = pickedExternalIds.has(p.externalId);
                  return (
                    <button
                      key={p.externalId}
                      disabled={picked || pick.isPending}
                      onClick={() => pick.mutate({
                        connectionId: connection.id,
                        externalId: p.externalId,
                        title: p.title,
                        description: p.description,
                        category: p.category,
                        thumbnailUrl: p.thumbnailUrl,
                        playbackUrl: p.embedUrl || p.playbackUrl,
                        playbackType: p.playbackType,
                        allowAdOverlay: p.allowAdOverlay,
                      })}
                      className={`flex items-start gap-3 p-3 rounded-lg border text-left transition-all ${
                        picked ? 'bg-emerald-50 border-emerald-200 cursor-default'
                               : 'bg-white border-slate-200 hover:border-indigo-300 hover:shadow-sm'
                      }`}
                    >
                      <div className="w-10 h-10 bg-gradient-to-br from-slate-200 to-slate-300 rounded flex items-center justify-center text-lg flex-shrink-0">
                        📺
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-slate-800 text-sm truncate">{p.title}</div>
                        {p.description && <div className="text-[11px] text-slate-500 truncate">{p.description}</div>}
                      </div>
                      {picked ? <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" /> : <Plus className="w-5 h-5 text-indigo-500 flex-shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Manual entry */}
          <div>
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Add a channel by URL</h3>
            <div className="space-y-2">
              <Field label="Title" placeholder="ESPN" value={manualTitle} onChange={setManualTitle} />
              <Field label="URL" placeholder="https://example.com/live.m3u8 or https://youtube.com/watch?v=..." value={manualUrl} onChange={setManualUrl} />
              <button
                onClick={handleManualAdd}
                disabled={!manualUrl || pick.isPending}
                className="px-4 py-2 text-sm font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 inline-flex items-center gap-2"
              >
                <Plus className="w-4 h-4" /> Add channel
              </button>
            </div>
          </div>

          {/* Already picked */}
          {myConnectionChannels.length > 0 && (
            <div>
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Picked channels</h3>
              <div className="grid gap-2">
                {myConnectionChannels.map((c) => (
                  <div key={c.id} className="flex items-center gap-3 p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-slate-800 text-sm">{c.title}</div>
                      {c.description && <div className="text-[11px] text-slate-500 truncate">{c.description}</div>}
                    </div>
                    <button onClick={() => unpick.mutate(c.id)} aria-label="Remove" className="p-1.5 rounded-lg text-slate-400 hover:bg-rose-100 hover:text-rose-600">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
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
        className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-300"
      />
    </label>
  );
}
