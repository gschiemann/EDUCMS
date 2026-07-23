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
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { appConfirm } from '@/components/ui/app-dialog';
import { useOverlayLock } from '@/hooks/use-overlay-lock';
import { ArrowLeft, Loader2, Tv, ExternalLink, Trash2, Plus, X, AlertCircle, CheckCircle2, ShieldAlert, Wrench, Cable, ArrowRight, Globe, Music, Radio, Lock, Zap, Sparkles } from 'lucide-react';

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
  const t = useTranslations();
  const params = useParams();
  const schoolId = params?.schoolId as string;
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
  // CYCLE-4 integrations-BUG-008 — Soundtrack uses provider.auth === 'oauth2'
  // and the OAuth flow isn't implemented yet, so the Connect button in the
  // ConnectModal is permanently disabled for it. The Quick Start "Background
  // music" card was previously calling setConnectModalProvider(soundtrack)
  // which dropped the operator into a dead-end modal. Replace with an
  // explicit "coming soon — contact sales" info modal.
  const [showSoundtrackComingSoon, setShowSoundtrackComingSoon] = useState(false);
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
      setQuickStartStatus({ kind: 'ok', msg: res?.message || t('streamingSso.connectedDropWidget') });
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
      <Link
        href={`/${schoolId}/settings`}
        className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-fuchsia-600"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> {t('streamingSso.settings')}
      </Link>
      {/* Hero */}
      <div className="rounded-2xl bg-gradient-to-br from-violet-600 via-fuchsia-600 to-pink-600 p-6 text-white relative overflow-hidden">
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(white 1px, transparent 1px)', backgroundSize: '24px 24px' }} />
        <div className="relative flex items-start justify-between gap-6">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight flex items-center gap-2">
              <Tv className="w-6 h-6" /> {t('streamingSso.streamingHeading')}
            </h1>
            <p className="text-fuchsia-100 mt-1.5 text-sm max-w-xl">
              {t('streamingSso.heroSubtitle')}
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
          <Sparkles className="w-3.5 h-3.5 text-amber-500" /> {t('streamingSso.quickStartTitle')}
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
            badge={t('streamingSso.badge1ClickFree')}
            title={t('streamingSso.freeTvTitle')}
            blurb={t('streamingSso.freeTvBlurb')}
            cta={quickStartRunning === 'public-broadcasters' ? t('streamingSso.adding') : t('streamingSso.add9FreeChannels')}
            disabled={quickStartRunning !== null}
            onClick={() => runQuickStart('public-broadcasters', '/sample-data/streaming/public-broadcasters')}
          />
          {/* 2. YouTube — paste URL, no account needed */}
          <QuickStartCard
            tone="rose"
            icon={<Tv className="w-5 h-5" />}
            badge={t('streamingSso.badgePasteUrl')}
            title={t('streamingSso.youtubeChannelTitle')}
            blurb={t('streamingSso.youtubeBlurb')}
            cta={t('streamingSso.connectYoutube')}
            onClick={() => {
              const yt = providers.data?.find((p) => p.id === 'youtube');
              if (yt) setConnectModalProvider(yt);
            }}
          />
          {/* 3. Custom HLS — for owned content / IPTV / capture bridges */}
          <QuickStartCard
            tone="indigo"
            icon={<Zap className="w-5 h-5" />}
            badge={t('streamingSso.badgeOwnUrl')}
            title={t('streamingSso.myVideoStreamTitle')}
            blurb={t('streamingSso.customStreamBlurb')}
            cta={t('streamingSso.addCustomStream')}
            onClick={() => {
              const hls = providers.data?.find((p) => p.id === 'custom-hls');
              if (hls) setConnectModalProvider(hls);
            }}
          />
          {/* 4. Music — Soundtrack Your Brand (real OAuth + commercial license)
              CYCLE-4 integrations-BUG-008 — OAuth flow is not yet implemented;
              opening the regular Connect modal lands on a permanently-disabled
              Connect button. Replaced with a Coming Soon info modal that
              points at sales for activation. */}
          <QuickStartCard
            tone="violet"
            icon={<Music className="w-5 h-5" />}
            badge={t('streamingSso.badgeComingSoon')}
            title={t('streamingSso.backgroundMusicTitle')}
            blurb={t('streamingSso.backgroundMusicBlurb')}
            cta={t('streamingSso.comingSoonContactSales')}
            onClick={() => setShowSoundtrackComingSoon(true)}
          />
          {/* 5. Premium streaming — HONEST about why this is the hard one */}
          <QuickStartCard
            tone="amber"
            icon={<Lock className="w-5 h-5" />}
            badge={t('streamingSso.badgeHardwareBridge')}
            title="Hulu / Netflix / Disney+ / Max"
            blurb={t('streamingSso.premiumStreamingBlurb')}
            cta={t('streamingSso.whySetupGuide')}
            onClick={() => setShowWhyClosed(true)}
          />
          {/* 6. Atmosphere — partner content via bridge */}
          <QuickStartCard
            tone="sky"
            icon={<Radio className="w-5 h-5" />}
            badge={t('streamingSso.badgeHardwareBridge')}
            title="Atmosphere TV / DIRECTV"
            blurb={t('streamingSso.atmosphereBlurb')}
            cta={t('streamingSso.setupGuide')}
            onClick={() => {
              const atmo = providers.data?.find((p) => p.id === 'atmosphere');
              if (atmo) setBridgeGuideProvider(atmo);
            }}
          />
        </div>
        <p className="text-[11px] text-slate-500 mt-3 leading-relaxed">
          {t('streamingSso.newToStreaming')}{' '}
          <button onClick={() => setShowWhyClosed(true)} className="underline text-indigo-600 hover:text-indigo-700">
            {t('streamingSso.whyHuluPassword')}
          </button>
          {' '}{t('streamingSso.shortHonestAnswer')}
        </p>
      </section>

      {/* Connections */}
      <section>
        <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">{t('streamingSso.yourConnections')}</h2>
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
                  if (!(await appConfirm({
                    title: t('streamingSso.disconnectConfirmTitle'),
                    message: t('streamingSso.disconnectConfirmMessage', { provider: c.providerName }),
                    confirmLabel: t('streamingSso.disconnect'),
                    tone: 'danger',
                  }))) return;
                  await apiFetch(`/streaming/connections/${c.id}`, { method: 'DELETE' });
                  qc.invalidateQueries({ queryKey: ['streaming-connections'] });
                  qc.invalidateQueries({ queryKey: ['streaming-channels'] });
                }}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
            {t('streamingSso.noConnections')}
          </div>
        )}
      </section>

      {/* Provider catalog */}
      <section>
        <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">{t('streamingSso.availableProviders')}</h2>
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

      {/* CYCLE-4 integrations-BUG-008 — Soundtrack Coming Soon modal */}
      {showSoundtrackComingSoon && (
        <SoundtrackComingSoonModal onClose={() => setShowSoundtrackComingSoon(false)} />
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
                name: `${bridgeGuideProvider.name} ${t('streamingSso.viaCustomHlsBridge')}`,
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
  const t = useTranslations();
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
          {t('streamingSso.channelsPicked', { count: channelCount })}
          {connection.statusReason && <span className="ml-2 text-rose-600">· {connection.statusReason}</span>}
        </div>
      </div>
      <button onClick={onPickChannels} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100">
        {t('streamingSso.pickChannels')}
      </button>
      <button onClick={onDisconnect} aria-label={t('streamingSso.disconnect')} className="p-1.5 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600">
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}

// ─── Provider tile ──────────────────────────────────────────────────────
function ProviderTile({ provider, connected, onConnect }: { provider: Provider; connected?: boolean; onConnect: () => void }) {
  const t = useTranslations();
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
              {t('streamingSso.infoOnly')}
            </span>
          )}
          {isPartner && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 uppercase tracking-wider">
              {t('streamingSso.partnership')}
            </span>
          )}
          {isBridge && !connected && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 uppercase tracking-wider inline-flex items-center gap-0.5">
              <Cable className="w-2.5 h-2.5" /> {t('streamingSso.hardwareBridge')}
            </span>
          )}
          {provider.integrationTier === 'DIRECT' && !connected && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 uppercase tracking-wider">
              {t('streamingSso.selfServe')}
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
            <ShieldAlert className="w-2.5 h-2.5" /> {t('streamingSso.licenseRequired')}
          </span>
        )}
        {!provider.allowsAdOverlay && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500" title={t('streamingSso.noOverlayTooltip')}>
            {t('streamingSso.noOverlay')}
          </span>
        )}
      </div>
    </button>
  );
}

// ─── Connect modal ──────────────────────────────────────────────────────
function ConnectModal({ provider, onClose, onConnected }: { provider: Provider; onClose: () => void; onConnected: () => void }) {
  const t = useTranslations();
  useOverlayLock(); // hide mobile tab bar so the modal footer clears it
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
      setErr(t('streamingSso.confirmVenueLicenseError'));
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
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[85dvh] overflow-y-auto p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="text-4xl">{provider.iconEmoji || '📺'}</div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">{t('streamingSso.connectProvider', { provider: provider.name })}</h2>
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
            <ExternalLink className="w-3 h-3" /> {t('streamingSso.providerDocumentation')}
          </a>
        )}

        {/* Auth fields per provider */}
        <div className="space-y-3">
          <Field label={t('streamingSso.displayNameOptional')} placeholder={provider.name} value={displayName} onChange={setDisplayName} />

          {provider.auth === 'none' && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">
              {t('streamingSso.noCredsNeeded')}
            </div>
          )}

          {provider.auth === 'apiKey' && (
            <>
              <Field label={t('streamingSso.apiKeyLabel')} placeholder="..." value={credentials.apiKey || ''} onChange={(v) => setCredentials({ ...credentials, apiKey: v })} />
              <Field label={t('streamingSso.accountIdOptional')} placeholder="..." value={credentials.accountId || ''} onChange={(v) => setCredentials({ ...credentials, accountId: v })} />
            </>
          )}

          {provider.auth === 'license' && (
            <>
              <Field label={t('streamingSso.licenseAccountNumber')} placeholder={t('streamingSso.licenseNumberPlaceholder')} value={credentials.licenseNumber || ''} onChange={(v) => setCredentials({ ...credentials, licenseNumber: v })} />
              <Field label={t('streamingSso.region')} placeholder={t('streamingSso.regionPlaceholder')} value={credentials.region || ''} onChange={(v) => setCredentials({ ...credentials, region: v })} />
            </>
          )}

          {provider.auth === 'customHls' && (
            <>
              <Field label={t('streamingSso.playbackUrlLabel')} placeholder="https://example.com/live.m3u8" value={credentials.playbackUrl || ''} onChange={(v) => setCredentials({ ...credentials, playbackUrl: v })} />
              <p className="text-[11px] text-slate-500">
                {t('streamingSso.customHlsCertify')}
              </p>
            </>
          )}

          {provider.auth === 'iframeOnly' && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
              {t('streamingSso.iframeNoCreds')}
            </div>
          )}

          {provider.auth === 'oauth2' && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
              {t('streamingSso.oauthNotImplemented', { provider: provider.name })}
            </div>
          )}

          {provider.requiresVenueLicense && (
            <label className="flex items-start gap-2 text-xs text-slate-700 p-3 bg-amber-50 border border-amber-200 rounded-lg cursor-pointer">
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5" />
              <span>
                {t('streamingSso.venueLicenseConfirm', { provider: provider.name })}
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
            {t('streamingSso.cancel')}
          </button>
          <button
            onClick={submit}
            disabled={submitting || provider.auth === 'oauth2' || !agreed}
            className="px-4 py-2 text-sm font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
          >
            {submitting && <Loader2 className="w-3 h-3 animate-spin" />}
            {t('streamingSso.connect')}
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
  const t = useTranslations();
  useOverlayLock(); // hide mobile tab bar so the modal footer clears it
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
  // 2026-05-25 streaming-overhaul — operator screenshot showed a
  // YouTube embed Error 153 going live because no one had pre-checked
  // embeddability. validationState captures the server's structured
  // probe result so the operator sees it BEFORE the screen does.
  const [validationState, setValidationState] = useState<
    | null
    | { kind: 'checking' }
    | { kind: 'ok'; type: string; note?: string }
    | { kind: 'warn'; type: string; reason: string; suggestion?: string }
    | { kind: 'block'; type: string; reason: string; suggestion?: string }
  >(null);

  const pick = useMutation({
    mutationFn: async (data: any) => apiFetch('/streaming/channels', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => onChanged(),
  });

  const unpick = useMutation({
    mutationFn: async (id: string) => apiFetch(`/streaming/channels/${id}`, { method: 'DELETE' }),
    onSuccess: () => onChanged(),
  });

  const handleManualAdd = async () => {
    if (!manualUrl) return;
    // Always run the server-side embeddability probe BEFORE saving.
    // If the URL is broken / embedding-disabled, we block the save so
    // the operator can't ship a known-bad channel to their screen.
    setValidationState({ kind: 'checking' });
    let probe: any = null;
    try {
      probe = await apiFetch<any>('/streaming/validate', {
        method: 'POST',
        body: JSON.stringify({ url: manualUrl }),
      });
    } catch (e) {
      // Validator down is not a save-blocker; let the operator
      // continue but show a soft warning.
      probe = {
        ok: true,
        type: 'unknown',
        embeddable: true,
        reason: t('streamingSso.validatorUnreachable'),
      };
    }

    if (probe.ok === false && probe.embeddable === false) {
      // Hard fail — surface the structural problem and DON'T save.
      setValidationState({
        kind: 'block',
        type: probe.type || 'unknown',
        reason: probe.reason || t('streamingSso.cannotEmbed'),
        suggestion: probe.suggestion,
      });
      return;
    }

    if (probe.reason) {
      // Soft warning — save but show the note.
      setValidationState({
        kind: 'warn',
        type: probe.type || 'unknown',
        reason: probe.reason,
        suggestion: probe.suggestion,
      });
    } else {
      setValidationState({ kind: 'ok', type: probe.type || 'unknown' });
    }

    let playbackType = 'hls';
    let externalId = manualUrl;
    if (/youtube\.com|youtu\.be/i.test(manualUrl) || /twitch\.tv|vimeo\.com/i.test(manualUrl)) playbackType = 'iframe';
    if (/\.mpd(\?|$)/i.test(manualUrl)) playbackType = 'dash';
    pick.mutate({
      connectionId: connection.id,
      externalId: externalId.slice(0, 250),
      title: manualTitle || manualUrl.slice(0, 80),
      // S1 fix (2026-07-16): persist the pasted URL into playbackUrl for
      // iframe channels too. Previously this was `undefined` for iframe,
      // leaving the URL only in externalId — the picker then copied an
      // undefined playbackUrl/embedUrl into the widget and it rendered
      // "No channel selected". The StreamingWidget/IframeStream normalize
      // a raw YouTube/Twitch/Vimeo watch URL into its embed form, so the
      // full URL is exactly what the iframe path needs.
      playbackUrl: manualUrl,
      playbackType,
      kind: 'LIVE',
    });
    setManualUrl('');
    setManualTitle('');
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[85dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-6 border-b border-slate-100 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-800">{t('streamingSso.channelsForProvider', { provider: connection.providerName })}</h2>
            <p className="text-xs text-slate-500 mt-1">{t('streamingSso.pickChannelsForWidget', { count: pickedExternalIds.size })}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-6 space-y-6">
          {/* Preset channels */}
          {presets.data && presets.data.length > 0 && (
            <div>
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">{t('streamingSso.suggestedChannels')}</h3>
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
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">{t('streamingSso.addChannelByUrl')}</h3>
            <div className="space-y-2">
              <Field label={t('streamingSso.title')} placeholder="ESPN" value={manualTitle} onChange={setManualTitle} />
              <Field label={t('streamingSso.url')} placeholder="https://example.com/live.m3u8 or https://youtube.com/watch?v=..." value={manualUrl} onChange={(v) => { setManualUrl(v); setValidationState(null); }} />
              {/* 2026-05-25 streaming-overhaul — server-side
                  embeddability probe result. Blocks save when the
                  channel is provably not playable (YouTube Error 153,
                  HLS 404, etc.). Lets the operator fix the URL or
                  switch to a working source instead of finding out
                  after the screen goes black. */}
              {validationState?.kind === 'checking' && (
                <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs text-slate-600 inline-flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  {t('streamingSso.checkingUrl')}
                </div>
              )}
              {validationState?.kind === 'ok' && (
                <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-800 inline-flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {t('streamingSso.looksGoodDetected', { type: validationState.type.toUpperCase() })}
                </div>
              )}
              {validationState?.kind === 'warn' && (
                <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
                  <div className="font-bold flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5" /> {t('streamingSso.headsUp')}
                  </div>
                  <div className="mt-1">{validationState.reason}</div>
                  {validationState.suggestion && (
                    <div className="mt-1.5 text-amber-700">→ {validationState.suggestion}</div>
                  )}
                </div>
              )}
              {validationState?.kind === 'block' && (
                <div className="rounded-lg bg-rose-50 border border-rose-200 p-3 text-xs text-rose-800">
                  <div className="font-bold flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5" /> {t('streamingSso.urlWontPlay')}
                  </div>
                  <div className="mt-1">{validationState.reason}</div>
                  {validationState.suggestion && (
                    <div className="mt-1.5 text-rose-700">→ {validationState.suggestion}</div>
                  )}
                </div>
              )}
              <button
                onClick={handleManualAdd}
                disabled={!manualUrl || pick.isPending || validationState?.kind === 'checking'}
                className="px-4 py-2 text-sm font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 inline-flex items-center gap-2"
              >
                <Plus className="w-4 h-4" /> {t('streamingSso.addChannel')}
              </button>
            </div>
          </div>

          {/* Already picked */}
          {myConnectionChannels.length > 0 && (
            <div>
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">{t('streamingSso.pickedChannels')}</h3>
              <div className="grid gap-2">
                {myConnectionChannels.map((c) => (
                  <div key={c.id} className="flex items-center gap-3 p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-slate-800 text-sm">{c.title}</div>
                      {c.description && <div className="text-[11px] text-slate-500 truncate">{c.description}</div>}
                    </div>
                    <button onClick={() => unpick.mutate(c.id)} aria-label={t('streamingSso.remove')} className="p-1.5 rounded-lg text-slate-400 hover:bg-rose-100 hover:text-rose-600">
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
  const t = useTranslations();
  useOverlayLock(); // hide mobile tab bar so the modal footer clears it
  const [confirmed, setConfirmed] = useState<Record<number, boolean>>({});
  const steps = provider.bridgeSteps || [];
  const allConfirmed = steps.length > 0 && steps.every((_, i) => confirmed[i]);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="p-6 border-b border-slate-100 sticky top-0 bg-white rounded-t-2xl flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-sky-400 to-indigo-500 flex items-center justify-center text-white">
              <Cable className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                {t('streamingSso.bridgeProvider', { provider: provider.name })} <span className="text-2xl">{provider.iconEmoji}</span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">{t('streamingSso.hardwareCaptureWorkflow')}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>

        {/* Why this is needed */}
        <div className="p-6 space-y-4 bg-sky-50/40 border-b border-sky-100">
          <div className="flex items-start gap-2">
            <Wrench className="w-4 h-4 text-sky-600 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-slate-700 leading-relaxed">
              <strong className="text-slate-900">{provider.name}</strong> {t('streamingSso.bridgeNoApi')}
              {' '}
              {provider.tierReason}
              <br /><br />
              {t('streamingSso.theGoodNews')} <strong>{t('streamingSso.subscriptionFine')}</strong> {t('streamingSso.bridgeCaptureExplain', { provider: provider.name })}
            </div>
          </div>
        </div>

        {/* Steps */}
        <div className="p-6 space-y-4">
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">{t('streamingSso.setupChecklist')}</h3>

          {steps.length === 0 ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
              {t('streamingSso.bridgeStepsPending')}
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
                            {t('streamingSso.stepN', { n: i + 1 })}
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
            <strong className="text-slate-800">{t('streamingSso.needHelpWiring')}</strong> See{' '}
            <a href="https://github.com/gschiemann/EDUCMS/blob/master/docs/HARDWARE_BRIDGE.md" target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline inline-flex items-center gap-0.5">
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
            {t('streamingSso.illDoThisLater')}
          </button>
          <button
            onClick={onContinue}
            disabled={!allConfirmed && steps.length > 0}
            className="px-4 py-2 text-sm font-bold rounded-lg bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
            title={!allConfirmed && steps.length > 0 ? t('streamingSso.confirmEachStep') : ''}
          >
            {t('streamingSso.captureRunningConnect')} <ArrowRight className="w-4 h-4" />
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
  const t = useTranslations();
  useOverlayLock(); // hide mobile tab bar so the modal footer clears it
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-6 border-b border-slate-100 flex items-start justify-between sticky top-0 bg-white rounded-t-2xl">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center text-amber-700">
              <Lock className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">{t('streamingSso.whyHuluPassword')}</h2>
              <p className="text-xs text-slate-500 mt-0.5">{t('streamingSso.shortHonestAnswerPath')}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-6 space-y-5 text-sm text-slate-700 leading-relaxed">
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-4">
            <p>
              <strong className="text-amber-900">{t('streamingSso.noCmsCanPlay')}</strong> {t('streamingSso.notVenueosLimitation')}
            </p>
          </div>

          <ol className="list-decimal pl-5 space-y-3">
            <li>
              <strong>{t('streamingSso.noPublicApi')}</strong> {t('streamingSso.noPublicApiDetail')}
            </li>
            <li>
              <strong>{t('streamingSso.drmLabel')}</strong> {t('streamingSso.drmDetail')}
            </li>
            <li>
              <strong>{t('streamingSso.commercialForbidden')}</strong> {t('streamingSso.commercialForbiddenDetail')}
            </li>
          </ol>

          <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-4 space-y-3">
            <h3 className="font-bold text-emerald-900 flex items-center gap-2">
              <Cable className="w-4 h-4" /> {t('streamingSso.whatWorksBridge')}
            </h3>
            <p className="text-emerald-900/90">
              {t('streamingSso.bridgeExplainDetail')} <strong>{t('streamingSso.bridge430')}</strong>
            </p>
            <p className="text-emerald-900/90 text-xs">
              {t('streamingSso.bridgeWorksAll')}
            </p>
            <div className="flex gap-2 pt-2">
              <button
                onClick={onPickAtmosphere}
                className="flex-1 px-3 py-2 text-xs font-bold rounded-lg bg-sky-600 text-white hover:bg-sky-700 inline-flex items-center justify-center gap-1.5"
              >
                <Cable className="w-3.5 h-3.5" /> {t('streamingSso.atmosphereBridgeGuide')}
              </button>
              <button
                onClick={onPickDirectv}
                className="flex-1 px-3 py-2 text-xs font-bold rounded-lg bg-sky-600 text-white hover:bg-sky-700 inline-flex items-center justify-center gap-1.5"
              >
                <Cable className="w-3.5 h-3.5" /> {t('streamingSso.directvBridgeGuide')}
              </button>
            </div>
          </div>

          <div className="rounded-lg bg-slate-50 border border-slate-200 p-4 text-xs space-y-2">
            <h4 className="font-bold text-slate-800">{t('streamingSso.whatWorksNoBridge')}</h4>
            <ul className="list-disc pl-5 space-y-1 text-slate-700">
              <li><strong>{t('streamingSso.publicBroadcasters')}</strong> {t('streamingSso.publicBroadcastersDetail')}</li>
              <li><strong>YouTube + Twitch + Vimeo</strong> {t('streamingSso.youtubeTwitchVimeoDetail')}</li>
              <li><strong>Custom HLS / DASH / IPTV M3U</strong> {t('streamingSso.customHlsDetail')}</li>
              <li><strong>Soundtrack Your Brand</strong> {t('streamingSso.soundtrackDetail')}</li>
            </ul>
            <p className="pt-2">
              {t('streamingSso.fullSetupGuide')}{' '}
              <a href="https://github.com/gschiemann/EDUCMS/blob/master/docs/HARDWARE_BRIDGE.md" target="_blank" rel="noreferrer" className="text-indigo-600 underline inline-flex items-center gap-0.5">
                docs/HARDWARE_BRIDGE.md <ExternalLink className="w-3 h-3" />
              </a>
            </p>
          </div>
        </div>

        <div className="p-6 border-t border-slate-100 flex justify-end sticky bottom-0 bg-white rounded-b-2xl">
          <button onClick={onClose} className="px-4 py-2 text-sm font-bold rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200">
            {t('streamingSso.gotIt')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Soundtrack Coming Soon modal ──────────────────────────────────────
//
// CYCLE-4 integrations-BUG-008 — Soundtrack Your Brand is gated behind
// OAuth approval that hasn't completed yet. The Quick Start "Background
// music" card used to drop operators into the regular ConnectModal, where
// the Connect button stayed permanently disabled (provider.auth ===
// 'oauth2'). Honest, friendly stand-in until the OAuth flow ships.
function SoundtrackComingSoonModal({ onClose }: { onClose: () => void }) {
  const t = useTranslations();
  useOverlayLock(); // hide mobile tab bar so the modal footer clears it
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[85dvh] overflow-y-auto p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-violet-100 flex items-center justify-center text-violet-700">
              <Music className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">{t('streamingSso.soundtrackComingSoon')}</h2>
              <p className="text-xs text-slate-500 mt-0.5">{t('streamingSso.oauthPendingApproval')}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="rounded-lg bg-violet-50 border border-violet-200 p-4 text-sm text-slate-700 leading-relaxed">
          <p>
            {t('streamingSso.soundtrackFinalizing')}
          </p>
        </div>

        <div className="rounded-lg bg-slate-50 border border-slate-200 p-4 text-xs text-slate-600 leading-relaxed">
          <strong className="text-slate-800">{t('streamingSso.needMusicSooner')}</strong> {t('streamingSso.emailLeadIn')}{' '}
          <a href="mailto:sales@venueos.com" className="text-indigo-600 hover:underline">sales@venueos.com</a>{' '}
          {t('streamingSso.soundtrackProvisionByHand')}
        </div>

        <div className="flex gap-2 justify-end pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm font-bold rounded-lg text-slate-600 hover:bg-slate-50">
            {t('streamingSso.close')}
          </button>
          <a
            href="mailto:sales@venueos.com?subject=Soundtrack%20activation%20request"
            className="px-4 py-2 text-sm font-bold rounded-lg bg-violet-600 text-white hover:bg-violet-700 inline-flex items-center gap-2"
          >
            {t('streamingSso.contactSales')}
          </a>
        </div>
      </div>
    </div>
  );
}
