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
import { Loader2, Tv, ExternalLink, Trash2, Plus, X, AlertCircle, CheckCircle2, ShieldAlert, Wrench, Cable, ArrowRight, Globe, Music, Radio, Lock, Zap, Sparkles } from 'lucide-react';

interface Provider {
  id: string;
  name: string;
  category: string;
  integrationTier: 'DIRECT' | 'PARTNER' | 'BRIDGE' | 'CLOSED';
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
  bridgeSteps?: Array<{ step: string; detail?: string; productExamples?: string[] }>;
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
  const [bridgeGuideProvider, setBridgeGuideProvider] = useState<Provider | null>(null);
  const [pickerConnection, setPickerConnection] = useState<Connection | null>(null);
  const [showWhyClosed, setShowWhyClosed] = useState(false);
  const [quickStartStatus, setQuickStartStatus] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [quickStartRunning, setQuickStartRunning] = useState<string | null>(null);

  // Quick Start one-click — calls sample-data endpoint to auto-connect
  // Public Broadcasters with all 9 channels picked. Same path the
  // /settings/test-integrations page uses; here it's the dummy-proof
  // entry for "I just want free TV on my screen, do everything for me".
  const runQuickStart = async (key: string, path: string) => {
    setQuickStartRunning(key);
    setQuickStartStatus(null);
    try {
      const res: any = await apiFetch(path, { method: 'POST' });
      qc.invalidateQueries({ queryKey: ['streaming-connections'] });
      qc.invalidateQueries({ queryKey: ['streaming-channels'] });
      setQuickStartStatus({ kind: 'ok', msg: res?.message || 'Connected. Drop a Live Stream widget on any template to play.' });
    } catch (e) {
      setQuickStartStatus({ kind: 'err', msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setQuickStartRunning(null);
    }
  };

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
              Pick what you want to play. We handle the setup. Your content shows up in any template's Live Stream widget within seconds.
            </p>
          </div>
        </div>
      </div>

      {/* ─── Quick Start — dummy-proof "what do you want to play?" hero ───
          Operator (2026-05-03): "did you make it easy so the customer just
          enters their credentials and it loads up the supported streaming
          app? make this dummy proof". Five big visual cards ranked by
          how-fast-can-you-go: free 1-click → URL paste → premium bridge.
          Honest about closed platforms (Hulu/Netflix/Disney+) — they're a
          full card with the explainer link rather than buried in a tier
          badge. */}
      <section>
        <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5 text-amber-500" /> Quick start — what do you want to play?
        </h2>
        {quickStartStatus && (
          <div className={`mb-3 rounded-xl px-4 py-3 text-xs flex items-start gap-2 ${
            quickStartStatus.kind === 'ok'
              ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border border-rose-200 text-rose-800'
          }`}>
            {quickStartStatus.kind === 'ok'
              ? <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
              : <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />}
            <div>{quickStartStatus.msg}</div>
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {/* 1. Free TV — one click, zero auth, plays today */}
          <QuickStartCard
            tone="emerald"
            icon={<Globe className="w-5 h-5" />}
            badge="1 CLICK · FREE"
            title="Free venue TV"
            blurb="9 free channels: NHK, France 24, DW, Al Jazeera, Bloomberg, Sky News, CBS. Legal for venues. No signup."
            cta={quickStartRunning === 'public-broadcasters' ? 'Adding…' : 'Add 9 free channels'}
            disabled={quickStartRunning !== null}
            onClick={() => runQuickStart('public-broadcasters', '/sample-data/streaming/public-broadcasters')}
          />
          {/* 2. YouTube — paste URL, no account needed */}
          <QuickStartCard
            tone="rose"
            icon={<Tv className="w-5 h-5" />}
            badge="PASTE URL"
            title="YouTube channel"
            blurb="Any public YouTube channel or live stream. Paste the URL, that's it. Same for Twitch and Vimeo."
            cta="Connect YouTube"
            onClick={() => {
              const yt = providers.data?.find((p) => p.id === 'youtube');
              if (yt) setConnectModalProvider(yt);
            }}
          />
          {/* 3. Custom HLS — for owned content / IPTV / capture bridges */}
          <QuickStartCard
            tone="indigo"
            icon={<Zap className="w-5 h-5" />}
            badge="OWN URL"
            title="My own video stream"
            blurb="Got an HLS / DASH / IPTV URL from your AV integrator? Paste it. Works with anything that ends .m3u8 or .mpd."
            cta="Add custom stream"
            onClick={() => {
              const hls = providers.data?.find((p) => p.id === 'custom-hls');
              if (hls) setConnectModalProvider(hls);
            }}
          />
          {/* 4. Music — Soundtrack Your Brand (real OAuth + commercial license) */}
          <QuickStartCard
            tone="violet"
            icon={<Music className="w-5 h-5" />}
            badge="OAUTH · ~$35/MO"
            title="Background music"
            blurb="Soundtrack Your Brand — millions of commercial-licensed songs. Spotify-backed. ~$35/mo per location."
            cta="Connect Soundtrack"
            onClick={() => {
              const sb = providers.data?.find((p) => p.id === 'soundtrack');
              if (sb) setConnectModalProvider(sb);
            }}
          />
          {/* 5. Premium streaming — HONEST about why this is the hard one */}
          <QuickStartCard
            tone="amber"
            icon={<Lock className="w-5 h-5" />}
            badge="HARDWARE BRIDGE"
            title="Hulu / Netflix / Disney+ / Max"
            blurb="Premium streaming services don't have a public API — no signage CMS can play them directly. We fix this with an HDMI capture bridge (~$430 one-time)."
            cta="Why? + setup guide"
            onClick={() => setShowWhyClosed(true)}
          />
          {/* 6. Atmosphere — partner content via bridge */}
          <QuickStartCard
            tone="sky"
            icon={<Radio className="w-5 h-5" />}
            badge="HARDWARE BRIDGE"
            title="Atmosphere TV / DIRECTV"
            blurb="Venue-friendly TV from Atmosphere, DIRECTV for Business, DISH Business — same HDMI capture bridge as premium streaming."
            cta="Setup guide"
            onClick={() => {
              const atmo = providers.data?.find((p) => p.id === 'atmosphere');
              if (atmo) setBridgeGuideProvider(atmo);
            }}
          />
        </div>
        <p className="text-[11px] text-slate-500 mt-3 leading-relaxed">
          New to streaming on signage?{' '}
          <button onClick={() => setShowWhyClosed(true)} className="underline text-indigo-600 hover:text-indigo-700">
            Why can't I just paste my Hulu password?
          </button>
          {' '}— short, honest answer.
        </p>
      </section>

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
                      onConnect={() => {
                        if (p.integrationTier === 'BRIDGE') {
                          // Bridge tier opens the setup wizard first;
                          // the operator finishes wiring their capture
                          // card, then we jump them to the regular
                          // Custom HLS connect modal pre-filled.
                          setBridgeGuideProvider(p);
                        } else {
                          setConnectModalProvider(p);
                        }
                      }}
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

      {/* Why-closed explainer — the dummy-proof "but why can't I just
          paste my Hulu password?" answer in plain English with a CTA
          to the bridge wizard. */}
      {showWhyClosed && (
        <WhyClosedModal
          onClose={() => setShowWhyClosed(false)}
          onPickAtmosphere={() => {
            setShowWhyClosed(false);
            const atmo = providers.data?.find((p) => p.id === 'atmosphere');
            if (atmo) setBridgeGuideProvider(atmo);
          }}
          onPickDirectv={() => {
            setShowWhyClosed(false);
            const dtv = providers.data?.find((p) => p.id === 'directv-business');
            if (dtv) setBridgeGuideProvider(dtv);
          }}
        />
      )}

      {/* Bridge setup wizard */}
      {bridgeGuideProvider && (
        <BridgeSetupModal
          provider={bridgeGuideProvider}
          onClose={() => setBridgeGuideProvider(null)}
          onContinue={() => {
            // Once the operator says they have the capture card running,
            // jump them straight into the Custom HLS connect modal so
            // they can paste their local HLS URL.
            setBridgeGuideProvider(null);
            const customHls = providers.data?.find((p) => p.id === 'custom-hls');
            if (customHls) {
              setConnectModalProvider({
                ...customHls,
                name: `${bridgeGuideProvider.name} (via Custom HLS bridge)`,
              });
            }
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
  const isBridge = provider.integrationTier === 'BRIDGE';
  return (
    <button
      onClick={isClosed ? () => provider.docsUrl && window.open(provider.docsUrl, '_blank') : onConnect}
      disabled={connected}
      className={`text-left p-4 rounded-xl border-2 transition-all ${
        connected ? 'bg-emerald-50 border-emerald-200 cursor-default'
                  : isClosed ? 'bg-slate-50 border-slate-200 opacity-75'
                  : isPartner ? 'bg-amber-50/30 border-amber-200 hover:border-amber-400 hover:shadow-md'
                  : isBridge ? 'bg-sky-50/40 border-sky-200 hover:border-sky-400 hover:shadow-md'
                  : 'bg-white border-slate-200 hover:border-indigo-300 hover:shadow-md'
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="text-2xl">{provider.iconEmoji || '📺'}</div>
        <div className="flex items-center gap-1">
          {connected && <CheckCircle2 className="w-5 h-5 text-emerald-600" />}
          {/* 2026-05-03 — integration-tier badge. Operator audit:
              be honest about which providers actually have a public
              API path vs. which are closed-app-only.
              BRIDGE = customer brings their own subscription (DIRECTV,
              Atmosphere, etc.) and we connect via an HDMI capture card →
              local HLS → our Custom HLS connector. Real working path,
              just needs hardware on the venue side. */}
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
          {isBridge && !connected && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 uppercase tracking-wider inline-flex items-center gap-0.5">
              <Cable className="w-2.5 h-2.5" /> Hardware bridge
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
  // 2026-05-03 BUG FIX (cycle 1 integrations BUG-001+002) — `agreed`
  // was a venue-license confirmation but the default was `provider.auth
  // === 'none'`, leaving the Connect button permanently disabled for
  // every provider that didn't require a venue license AND wasn't auth=
  // 'none'. That killed YouTube / Twitch / Custom HLS / IPTV / Atmosphere
  // setup-bridge / etc. Now the checkbox defaults to true UNLESS the
  // provider actually requires a venue license, in which case the
  // operator must tick the box first (existing UX) and the Connect
  // button remains disabled until they do.
  const [agreed, setAgreed] = useState(!provider.requiresVenueLicense);
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

// ─── Bridge setup wizard ────────────────────────────────────────────────
/**
 * BRIDGE-tier providers (DIRECTV, Atmosphere TV, DISH Business, Mood
 * Media, iHeart for Business) don't have a public API we can call. They
 * sell their content through their own player apps + venue accounts.
 *
 * The bridge workflow: customer keeps their existing subscription → runs
 * the provider's app on a cheap streaming stick → HDMI out into a USB
 * capture card → mini-PC running ffmpeg pushes a local HLS stream → our
 * "Custom HLS" connector picks it up. Total parts ~$300-700 one-time per
 * venue, cheaper than the $1,000+/yr signage retainers competitors charge.
 *
 * This modal walks the operator through the steps with concrete product
 * recommendations + price points pulled from the catalog's bridgeSteps.
 * When they confirm "I've got my capture working," we jump them straight
 * into the Custom HLS connect modal so they can paste their local URL.
 */
function BridgeSetupModal({ provider, onClose, onContinue }: {
  provider: Provider;
  onClose: () => void;
  onContinue: () => void;
}) {
  const [confirmed, setConfirmed] = useState<Record<number, boolean>>({});
  const steps = provider.bridgeSteps || [];
  const allConfirmed = steps.length > 0 && steps.every((_, i) => confirmed[i]);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="p-6 border-b border-slate-100 sticky top-0 bg-white rounded-t-2xl flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-sky-400 to-indigo-500 flex items-center justify-center text-white">
              <Cable className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                Bridge {provider.name} <span className="text-2xl">{provider.iconEmoji}</span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">Hardware capture workflow — about 30 minutes one-time setup.</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>

        {/* Why this is needed */}
        <div className="p-6 space-y-4 bg-sky-50/40 border-b border-sky-100">
          <div className="flex items-start gap-2">
            <Wrench className="w-4 h-4 text-sky-600 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-slate-700 leading-relaxed">
              <strong className="text-slate-900">{provider.name}</strong> doesn't expose a public API for content delivery —
              they sell through their own player app on dedicated devices.
              {' '}
              {provider.tierReason}
              <br /><br />
              The good news: <strong>your subscription is fine as-is.</strong> We capture
              the HDMI output of {provider.name}'s player and stream it into VenueOS as a
              regular channel, so it shows up in our templates with overlays, ad slots,
              schedules, and emergency takeover just like any other source.
            </div>
          </div>
        </div>

        {/* Steps */}
        <div className="p-6 space-y-4">
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Setup checklist</h3>

          {steps.length === 0 ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
              Bridge setup steps are still being authored for this provider. In the meantime,
              the general workflow is: HDMI output → USB capture card → mini-PC running ffmpeg →
              local HLS URL. Reach out to support and we'll walk you through it.
            </div>
          ) : (
            <ol className="space-y-3">
              {steps.map((s, i) => {
                const isChecked = confirmed[i] ?? false;
                return (
                  <li key={i}>
                    <label className={`flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${
                      isChecked ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-slate-200 hover:border-sky-300'
                    }`}>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => setConfirmed({ ...confirmed, [i]: e.target.checked })}
                        className="mt-0.5 flex-shrink-0 w-4 h-4 rounded border-slate-300 text-sky-600 focus:ring-sky-400"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start gap-2">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider flex-shrink-0 ${
                            isChecked ? 'bg-emerald-200 text-emerald-800' : 'bg-slate-200 text-slate-700'
                          }`}>
                            Step {i + 1}
                          </span>
                          <span className={`text-sm font-semibold ${isChecked ? 'text-emerald-900' : 'text-slate-800'}`}>
                            {s.step}
                          </span>
                        </div>
                        {s.detail && (
                          <p className="text-[11px] text-slate-500 mt-1 ml-2 leading-relaxed">{s.detail}</p>
                        )}
                        {s.productExamples && s.productExamples.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-2 ml-1">
                            {s.productExamples.map((ex, k) => (
                              <span
                                key={k}
                                className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200"
                              >
                                {ex}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </label>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        {/* Help box */}
        <div className="px-6 pb-2">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-600 leading-relaxed">
            <strong className="text-slate-800">Need help wiring this up?</strong> See{' '}
            <a href="/docs/HARDWARE_BRIDGE.md" target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline inline-flex items-center gap-0.5">
              docs/HARDWARE_BRIDGE.md <ExternalLink className="w-2.5 h-2.5" />
            </a>{' '}
            for the full guide, including the one-line ffmpeg command and our{' '}
            <code className="text-[10px] bg-slate-200 px-1 py-0.5 rounded">venueos/hls-bridge</code> Docker image.
            Email{' '}
            <a href="mailto:support@venueos.com" className="text-indigo-600 hover:underline">support@venueos.com</a>{' '}
            and we'll do the install over Zoom.
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-slate-100 sticky bottom-0 bg-white rounded-b-2xl flex gap-2 justify-between items-center">
          <button onClick={onClose} className="px-4 py-2 text-sm font-bold rounded-lg text-slate-600 hover:bg-slate-50">
            I'll do this later
          </button>
          <button
            onClick={onContinue}
            disabled={!allConfirmed && steps.length > 0}
            className="px-4 py-2 text-sm font-bold rounded-lg bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
            title={!allConfirmed && steps.length > 0 ? 'Confirm each step above' : ''}
          >
            My capture is running — connect Custom HLS <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Quick Start card ──────────────────────────────────────────────────
//
// One of 6 cards in the dummy-proof "what do you want to play?" hero at
// the top of /settings/streaming. Each card is one CTA — no nested
// drilldowns. The visual tone (emerald / rose / indigo / etc) is keyed
// to the action's complexity so the easiest paths read as the most
// inviting:
//   • emerald — 1-click free
//   • rose / indigo — paste-URL forms
//   • violet — OAuth / paid
//   • amber — closed platform / explainer
//   • sky — partner content via bridge
const TONE_STYLES: Record<string, { bg: string; ring: string; iconBg: string; iconText: string; badge: string; cta: string }> = {
  emerald: { bg: 'bg-emerald-50/60', ring: 'border-emerald-200 hover:border-emerald-400', iconBg: 'bg-emerald-100', iconText: 'text-emerald-700', badge: 'bg-emerald-100 text-emerald-800', cta: 'bg-emerald-600 hover:bg-emerald-700' },
  rose:    { bg: 'bg-rose-50/60',    ring: 'border-rose-200 hover:border-rose-400',       iconBg: 'bg-rose-100',    iconText: 'text-rose-700',    badge: 'bg-rose-100 text-rose-800',       cta: 'bg-rose-600 hover:bg-rose-700' },
  indigo:  { bg: 'bg-indigo-50/60',  ring: 'border-indigo-200 hover:border-indigo-400',   iconBg: 'bg-indigo-100',  iconText: 'text-indigo-700',  badge: 'bg-indigo-100 text-indigo-800',   cta: 'bg-indigo-600 hover:bg-indigo-700' },
  violet:  { bg: 'bg-violet-50/60',  ring: 'border-violet-200 hover:border-violet-400',   iconBg: 'bg-violet-100',  iconText: 'text-violet-700',  badge: 'bg-violet-100 text-violet-800',   cta: 'bg-violet-600 hover:bg-violet-700' },
  amber:   { bg: 'bg-amber-50/60',   ring: 'border-amber-200 hover:border-amber-400',     iconBg: 'bg-amber-100',   iconText: 'text-amber-700',   badge: 'bg-amber-100 text-amber-800',     cta: 'bg-amber-600 hover:bg-amber-700' },
  sky:     { bg: 'bg-sky-50/60',     ring: 'border-sky-200 hover:border-sky-400',         iconBg: 'bg-sky-100',     iconText: 'text-sky-700',     badge: 'bg-sky-100 text-sky-800',         cta: 'bg-sky-600 hover:bg-sky-700' },
};
function QuickStartCard({
  tone, icon, badge, title, blurb, cta, disabled, onClick,
}: {
  tone: 'emerald' | 'rose' | 'indigo' | 'violet' | 'amber' | 'sky';
  icon: React.ReactNode;
  badge: string;
  title: string;
  blurb: string;
  cta: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  const t = TONE_STYLES[tone];
  return (
    <div className={`rounded-xl border-2 p-4 flex flex-col gap-3 transition-all shadow-sm hover:shadow-md ${t.bg} ${t.ring}`}>
      <div className="flex items-start justify-between gap-2">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${t.iconBg} ${t.iconText}`}>
          {icon}
        </div>
        <span className={`text-[9px] font-bold tracking-wider uppercase px-2 py-0.5 rounded ${t.badge}`}>{badge}</span>
      </div>
      <div className="flex-1">
        <h3 className="text-sm font-bold text-slate-900">{title}</h3>
        <p className="text-[11px] text-slate-600 leading-relaxed mt-1">{blurb}</p>
      </div>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={`w-full text-xs font-bold rounded-lg py-2 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${t.cta}`}
      >
        {cta}
      </button>
    </div>
  );
}

// ─── "Why can't I just paste my Hulu password?" explainer ──────────────
//
// Operator-friendly answer to the FAQ that comes up the moment they look
// at the Streaming Hub and see Hulu / Netflix / Disney+ tiles. Honest,
// short, and ends with a path forward (the BRIDGE workflow).
//
// Marketing differentiator: every signage CMS hits the same wall on
// closed platforms. We're the only one who explains it upfront and
// ships a working alternative (HDMI capture → local HLS → custom-hls).
function WhyClosedModal({
  onClose,
  onPickAtmosphere,
  onPickDirectv,
}: {
  onClose: () => void;
  onPickAtmosphere: () => void;
  onPickDirectv: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-6 border-b border-slate-100 flex items-start justify-between sticky top-0 bg-white rounded-t-2xl">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center text-amber-700">
              <Lock className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">Why can't I just paste my Hulu password?</h2>
              <p className="text-xs text-slate-500 mt-0.5">Short, honest answer + the path forward.</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-6 space-y-5 text-sm text-slate-700 leading-relaxed">
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-4">
            <p>
              <strong className="text-amber-900">No signage CMS can play Hulu, Netflix, Disney+, Max, Peacock,
              Paramount+, fuboTV, or Sling directly.</strong> That's not a VenueOS limitation —
              none of our competitors (Yodeck, Rise Vision, OptiSigns, ScreenCloud,
              BrightSign) can either. Three reasons:
            </p>
          </div>

          <ol className="list-decimal pl-5 space-y-3">
            <li>
              <strong>No public API.</strong> These services don't publish a way for
              third-party apps to authenticate and play their content. Their apps
              only run on licensed devices (Roku, Fire TV, Apple TV, Smart TVs).
            </li>
            <li>
              <strong>DRM (Widevine / FairPlay).</strong> Their video files are encrypted
              with DRM that requires a hardware-backed license. Browser-based
              players in a CMS don't have those licenses.
            </li>
            <li>
              <strong>Commercial use forbidden.</strong> Even if you could technically embed
              their video, their consumer Terms of Service explicitly prohibit
              displaying it in commercial venues. That's a contract problem,
              not a tech problem.
            </li>
          </ol>

          <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-4 space-y-3">
            <h3 className="font-bold text-emerald-900 flex items-center gap-2">
              <Cable className="w-4 h-4" /> What works: the Hardware Bridge
            </h3>
            <p className="text-emerald-900/90">
              You keep your existing Hulu / Netflix subscription on a $50 Fire TV
              Stick. We capture its HDMI output through a $180 USB capture card,
              encode to HLS on a $170 mini-PC, and play that HLS stream inside
              VenueOS like any other channel. <strong>~$430 one-time per venue.</strong>
            </p>
            <p className="text-emerald-900/90 text-xs">
              The same bridge works for every closed platform: DIRECTV for Business,
              DISH, Atmosphere TV, Mood Media, Stingray (iHeart for Business).
              Setup takes about 30 minutes — we ship a step-by-step wizard.
            </p>
            <div className="flex gap-2 pt-2">
              <button
                onClick={onPickAtmosphere}
                className="flex-1 px-3 py-2 text-xs font-bold rounded-lg bg-sky-600 text-white hover:bg-sky-700 inline-flex items-center justify-center gap-1.5"
              >
                <Cable className="w-3.5 h-3.5" /> Atmosphere bridge guide
              </button>
              <button
                onClick={onPickDirectv}
                className="flex-1 px-3 py-2 text-xs font-bold rounded-lg bg-sky-600 text-white hover:bg-sky-700 inline-flex items-center justify-center gap-1.5"
              >
                <Cable className="w-3.5 h-3.5" /> DIRECTV bridge guide
              </button>
            </div>
          </div>

          <div className="rounded-lg bg-slate-50 border border-slate-200 p-4 text-xs space-y-2">
            <h4 className="font-bold text-slate-800">What works without a bridge today</h4>
            <ul className="list-disc pl-5 space-y-1 text-slate-700">
              <li><strong>Public Broadcasters</strong> (NHK, France 24, DW, Al Jazeera, Bloomberg, Sky News, CBS) — 1-click connect, free, legal for venues</li>
              <li><strong>YouTube + Twitch + Vimeo</strong> — paste any public URL, plays as iframe</li>
              <li><strong>Custom HLS / DASH / IPTV M3U</strong> — paste any URL you own or are licensed for</li>
              <li><strong>Soundtrack Your Brand</strong> — commercial-licensed background music (~$35/mo)</li>
            </ul>
            <p className="pt-2">
              Full setup guide:{' '}
              <a href="/docs/HARDWARE_BRIDGE.md" target="_blank" rel="noreferrer" className="text-indigo-600 underline inline-flex items-center gap-0.5">
                docs/HARDWARE_BRIDGE.md <ExternalLink className="w-3 h-3" />
              </a>
            </p>
          </div>
        </div>

        <div className="p-6 border-t border-slate-100 flex justify-end sticky bottom-0 bg-white rounded-b-2xl">
          <button onClick={onClose} className="px-4 py-2 text-sm font-bold rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200">
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
