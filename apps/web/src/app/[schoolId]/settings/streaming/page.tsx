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
import { useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { appConfirm } from '@/components/ui/app-dialog';
import { useOverlayLock } from '@/hooks/use-overlay-lock';
import { Loader2, Tv, ExternalLink, Trash2, Plus, X, AlertCircle, CheckCircle2, ShieldAlert, Music, Radio, Lock, Zap, Sparkles } from 'lucide-react';
import { SettingsPageFrame } from '@/components/settings/shell/SettingsPageFrame';
import { ContextAction, ContextModule, EditorHead } from '@/components/settings/shell/primitives';

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

interface PresetChannel {
  externalId: string;
  title: string;
  description?: string;
  category?: string;
  thumbnailUrl?: string;
  playbackUrl?: string;
  embedUrl?: string;
  playbackType?: string;
  allowAdOverlay?: boolean;
}

interface CreateChannelInput {
  connectionId: string;
  externalId: string;
  title: string;
  description?: string;
  category?: string;
  thumbnailUrl?: string;
  playbackUrl?: string;
  playbackType?: string;
  kind?: 'LIVE' | 'VOD';
  allowAdOverlay?: boolean;
}

interface StreamValidationProbe {
  ok: boolean;
  type?: string;
  embeddable?: boolean;
  reason?: string;
  suggestion?: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  'venue-fast': '🏢 Business services · external provider players',
  'free-fast': '🌍 Direct distribution agreement required',
  'live-platform': '📡 Consumer embeds blocked for public playback',
  'music': '🎵 Licensed business music · adapters pending',
  'sports-news': '🏈 Business TV · external provider devices',
  'custom': '🔗 Customer-owned or licensed feeds',
};

const EXTERNAL_DEVICE_PROVIDER_IDS = new Set([
  'atmosphere',
  'directv-business',
  'dish-business',
  'mood-media',
  'iheart-business',
]);

const BLOCKED_PROVIDER_IDS = new Set([
  'public-broadcasters',
  'youtube',
  'twitch',
]);

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
  const [pickerConnection, setPickerConnection] = useState<Connection | null>(null);
  const [showWhyClosed, setShowWhyClosed] = useState(false);
  const [pendingProvider, setPendingProvider] = useState<Provider | null>(null);
  const grouped = (providers.data || []).reduce<Record<string, Provider[]>>((acc, p) => {
    (acc[p.category] = acc[p.category] || []).push(p);
    return acc;
  }, {});

  // Context rail (§6.6) — counted from the SAME `/streaming/connections`
  // rows the list below renders, so the rail can never disagree with it.
  const activeCount = (connections.data || []).filter((c) => c.status === 'ACTIVE').length;
  const attentionCount = (connections.data || []).filter((c) => c.status !== 'ACTIVE').length;
  const searchItems = useMemo(() => ([
        { label: t('streamingSso.myVideoStreamTitle'), keywords: ['hls', 'custom stream', 'm3u8'] },
        { label: t('streamingSso.yourConnections'), keywords: ['streaming connections'] },
      ] as const), []); // eslint-disable-line react-hooks/exhaustive-deps

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
      <ContextModule
        label={t('settings.cc.integrations.providerRail.appliesToLabel')}
        title={t('settings.cc.integrations.providerRail.appliesToValue')}
      />
      <ContextModule label={t('settings.cc.integrations.railAuditLabel')}>
        <ContextAction href={`/${schoolId}/audit`}>{t('settings.cc.integrations.railAuditAction')}</ContextAction>
      </ContextModule>
    </>
    ),
    // `t` is intentionally NOT a dependency: useTranslations() returns a
    // fresh function identity on every render, which would defeat the
    // memo and re-register the page in a loop. Copy is static per locale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [schoolId, activeCount, attentionCount],
  );

  return (
    <SettingsPageFrame
      section="integrations"
      subtitle={t('settings.cc.integrations.families.streaming')}
      title={t('settings.cc.integrations.pages.streaming.title')}
      description={t('settings.cc.integrations.pages.streaming.description')}
      context={context}
      searchItems={searchItems}
    >
    <div className="space-y-6">
      <EditorHead
        icon={Tv}
        title={t('streamingSso.streamingHeading')}
        description={t('streamingSso.heroSubtitle')}
      />

      {/* ─── Quick Start — only routes VenueOS can describe honestly. ─── */}
      <section>
        <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5 text-amber-500" /> {t('streamingSso.quickStartTitle')}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {/* 1. Native HLS — only for customer-owned/licensed feeds. */}
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
          {/* 2. Business music — documented provider APIs, adapter pending. */}
          <QuickStartCard
            tone="violet"
            icon={<Music className="w-5 h-5" />}
            badge={t('streamingSso.badgeComingSoon')}
            title={t('streamingSso.backgroundMusicTitle')}
            blurb={t('streamingSso.backgroundMusicBlurb')}
            cta={t('streamingSso.comingSoonContactSales')}
            onClick={() => {
              const soundtrack = providers.data?.find((p) => p.id === 'soundtrack');
              if (soundtrack) setPendingProvider(soundtrack);
            }}
          />
          {/* 3. Consumer entertainment services are explicitly blocked. */}
          <QuickStartCard
            tone="amber"
            icon={<Lock className="w-5 h-5" />}
            badge={t('streamingSso.badgeBlocked')}
            title="Hulu / Netflix / Disney+ / Max"
            blurb={t('streamingSso.premiumStreamingBlurb')}
            cta={t('streamingSso.whyBlocked')}
            onClick={() => setShowWhyClosed(true)}
          />
          {/* 4. Business TV stays on the provider's licensed device today. */}
          <QuickStartCard
            tone="sky"
            icon={<Radio className="w-5 h-5" />}
            badge="External licensed device"
            title="Atmosphere TV / DIRECTV"
            blurb="Commercial programming stays on the approved provider player. VenueOS control and heartbeat adapters are not complete yet."
            cta={t('streamingSso.viewBusinessProvider')}
            onClick={() => {
              const atmo = providers.data?.find((p) => p.id === 'atmosphere');
              if (atmo?.websiteUrl) window.open(atmo.websiteUrl, '_blank', 'noopener,noreferrer');
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
                        if (p.integrationTier === 'DIRECT') {
                          setConnectModalProvider(p);
                        } else if (p.integrationTier === 'PARTNER') {
                          setPendingProvider(p);
                        } else if (EXTERNAL_DEVICE_PROVIDER_IDS.has(p.id)) {
                          const destination = p.websiteUrl || p.docsUrl;
                          if (destination) window.open(destination, '_blank', 'noopener,noreferrer');
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

      {/* Consumer-service explainer with only sanctioned paths forward. */}
      {showWhyClosed && (
        <WhyClosedModal
          onClose={() => setShowWhyClosed(false)}
          onOpenAtmosphere={() => {
            setShowWhyClosed(false);
            const atmo = providers.data?.find((p) => p.id === 'atmosphere');
            const destination = atmo?.websiteUrl || atmo?.docsUrl;
            if (destination) window.open(destination, '_blank', 'noopener,noreferrer');
          }}
          onOpenDirectv={() => {
            setShowWhyClosed(false);
            const dtv = providers.data?.find((p) => p.id === 'directv-business');
            const destination = dtv?.websiteUrl || dtv?.docsUrl;
            if (destination) window.open(destination, '_blank', 'noopener,noreferrer');
          }}
        />
      )}

      {pendingProvider && (
        <PartnerAdapterPendingModal
          provider={pendingProvider}
          onClose={() => setPendingProvider(null)}
        />
      )}
    </div>
    </SettingsPageFrame>
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
  const isExternalDevice = EXTERNAL_DEVICE_PROVIDER_IDS.has(provider.id) || provider.integrationTier === 'BRIDGE';
  const isBlocked = BLOCKED_PROVIDER_IDS.has(provider.id) || (!provider.commercialUseLegal && isClosed);
  const destination = provider.websiteUrl || provider.docsUrl;
  return (
    <button
      onClick={
        isBlocked
          ? undefined
          : (isClosed || isExternalDevice) && destination
            ? () => window.open(destination, '_blank', 'noopener,noreferrer')
            : onConnect
      }
      disabled={connected || isBlocked || ((isClosed || isExternalDevice) && !destination)}
      className={`text-left p-4 rounded-xl border-2 transition-all ${
        connected ? 'bg-emerald-50 border-emerald-200 cursor-default'
                  : isBlocked ? 'bg-rose-50/40 border-rose-200 cursor-not-allowed'
                  : isExternalDevice ? 'bg-sky-50/40 border-sky-200 hover:border-sky-400 hover:shadow-md'
                  : isClosed ? 'bg-slate-50 border-slate-200 opacity-75'
                  : isPartner ? 'bg-amber-50/30 border-amber-200 hover:border-amber-400 hover:shadow-md'
                  : 'bg-white border-slate-200 hover:border-indigo-300 hover:shadow-md'
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="text-2xl">{provider.iconEmoji || '📺'}</div>
        <div className="flex items-center gap-1">
          {connected && <CheckCircle2 className="w-5 h-5 text-emerald-600" />}
          {isBlocked && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 uppercase tracking-wider">
              {t('streamingSso.blocked')}
            </span>
          )}
          {isExternalDevice && !isBlocked && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 uppercase tracking-wider inline-flex items-center gap-0.5">
              <ExternalLink className="w-2.5 h-2.5" /> {t('streamingSso.externalDevice')}
            </span>
          )}
          {isClosed && !isExternalDevice && !isBlocked && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-200 text-slate-600 uppercase tracking-wider">
              {t('streamingSso.infoOnly')}
            </span>
          )}
          {isPartner && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 uppercase tracking-wider">
              {t('streamingSso.adapterPending')}
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
  // A direct source that requires a venue license stays blocked until the
  // operator certifies the rights for that location.
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
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="Close provider connection" className="absolute inset-0 cursor-default" onClick={onClose} />
      <div role="dialog" aria-modal="true" className="relative z-10 bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[85dvh] overflow-y-auto p-6 space-y-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="text-4xl">{provider.iconEmoji || '📺'}</div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">{t('streamingSso.connectProvider', { provider: provider.name })}</h2>
              <p className="text-xs text-slate-500">{provider.blurb}</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close provider connection" className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
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
  const presets = useQuery<PresetChannel[]>({
    queryKey: ['streaming-presets', connection.providerId],
    queryFn: () => apiFetch<PresetChannel[]>(`/streaming/providers/${connection.providerId}/channels`),
  });
  const myChannels = useQuery<Channel[]>({
    queryKey: ['streaming-channels'],
    queryFn: () => apiFetch<Channel[]>('/streaming/channels'),
  });
  const myConnectionChannels = (myChannels.data || []).filter((c) => c.connectionId === connection.id);
  const pickedExternalIds = new Set(myConnectionChannels.map((c) => c.externalId));

  const isBlockedConsumerConnection = BLOCKED_PROVIDER_IDS.has(connection.providerId);
  const isCustomHlsConnection = connection.providerId === 'custom-hls';

  // Manual entry is for customer-owned or explicitly licensed feeds. It is
  // deliberately not a generic public-URL embed path.
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

  const pick = useMutation<unknown, Error, CreateChannelInput>({
    mutationFn: async (data) => apiFetch('/streaming/channels', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => onChanged(),
  });

  const unpick = useMutation({
    mutationFn: async (id: string) => apiFetch(`/streaming/channels/${id}`, { method: 'DELETE' }),
    onSuccess: () => onChanged(),
  });

  const handleManualAdd = async () => {
    if (!manualUrl) return;
    if (isBlockedConsumerConnection || /(?:youtube\.com|youtu\.be|twitch\.tv)/i.test(manualUrl)) {
      setValidationState({
        kind: 'block',
        type: 'consumer',
        reason: t('streamingSso.consumerUrlBlocked'),
      });
      return;
    }
    if (isCustomHlsConnection && !/\.m3u8(?:[?#]|$)/i.test(manualUrl)) {
      setValidationState({
        kind: 'block',
        type: 'hls',
        reason: t('streamingSso.licensedHlsRequired'),
      });
      return;
    }
    // Always run the server-side embeddability probe BEFORE saving.
    // If the URL is broken / embedding-disabled, we block the save so
    // the operator can't ship a known-bad channel to their screen.
    setValidationState({ kind: 'checking' });
    let probe: StreamValidationProbe;
    try {
      probe = await apiFetch<StreamValidationProbe>('/streaming/validate', {
        method: 'POST',
        body: JSON.stringify({ url: manualUrl }),
      });
    } catch {
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

    const playbackType = 'hls';
    const externalId = manualUrl;
    pick.mutate({
      connectionId: connection.id,
      externalId: externalId.slice(0, 250),
      title: manualTitle || manualUrl.slice(0, 80),
      playbackUrl: manualUrl,
      playbackType,
      kind: 'LIVE',
    });
    setManualUrl('');
    setManualTitle('');
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="Close channel picker" className="absolute inset-0 cursor-default" onClick={onClose} />
      <div role="dialog" aria-modal="true" className="relative z-10 bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[85dvh] overflow-y-auto">
        <div className="p-6 border-b border-slate-100 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-800">{t('streamingSso.channelsForProvider', { provider: connection.providerName })}</h2>
            <p className="text-xs text-slate-500 mt-1">{t('streamingSso.pickChannelsForWidget', { count: pickedExternalIds.size })}</p>
          </div>
          <button onClick={onClose} aria-label="Close channel picker" className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-6 space-y-6">
          {isBlockedConsumerConnection && (
            <div className="rounded-lg bg-rose-50 border border-rose-200 p-4 text-sm text-rose-800 flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{t('streamingSso.blockedLegacyConnection')}</span>
            </div>
          )}

          {/* Preset channels */}
          {!isBlockedConsumerConnection && presets.data && presets.data.length > 0 && (
            <div>
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">{t('streamingSso.suggestedChannels')}</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {presets.data.map((p) => {
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
          {!isBlockedConsumerConnection && (
          <div>
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">{t('streamingSso.addChannelByUrl')}</h3>
            <div className="space-y-2">
              <Field label={t('streamingSso.title')} placeholder={t('streamingSso.channelTitlePlaceholder')} value={manualTitle} onChange={setManualTitle} />
              <Field label={t('streamingSso.url')} placeholder="https://media.example.com/live/playlist.m3u8" value={manualUrl} onChange={(v) => { setManualUrl(v); setValidationState(null); }} />
              <p className="text-[11px] text-slate-500">{t('streamingSso.licensedHlsHelp')}</p>
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
          )}

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
// ─── Quick Start card ──────────────────────────────────────────────────
//
// One of the cards in the "what do you want to play?" hero at
// the top of /settings/streaming. Each card is one CTA — no nested
// drilldowns. The visual tone (emerald / rose / indigo / etc) is keyed
// to the action's complexity so the easiest paths read as the most
// inviting:
//   • rose / indigo — paste-URL forms
//   • violet — licensed provider adapter pending
//   • amber — closed platform / explainer
//   • sky — approved external provider device
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
// short, and ends with sanctioned business-content paths. Consumer HDMI
// capture/re-encoding is deliberately not presented as a VenueOS feature.
function WhyClosedModal({
  onClose,
  onOpenAtmosphere,
  onOpenDirectv,
}: {
  onClose: () => void;
  onOpenAtmosphere: () => void;
  onOpenDirectv: () => void;
}) {
  const t = useTranslations();
  useOverlayLock(); // hide mobile tab bar so the modal footer clears it
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="Close streaming explanation" className="absolute inset-0 cursor-default" onClick={onClose} />
      <div role="dialog" aria-modal="true" className="relative z-10 bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90dvh] overflow-y-auto">
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
          <button onClick={onClose} aria-label="Close streaming explanation" className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
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

          <div className="rounded-lg bg-sky-50 border border-sky-200 p-4 space-y-3">
            <h3 className="font-bold text-sky-950 flex items-center gap-2">
              <ExternalLink className="w-4 h-4" /> Licensed business TV stays on the provider player
            </h3>
            <p className="text-sky-950/90">
              Atmosphere TV and DIRECTV for Business are valid commercial services, but VenueOS does not capture,
              re-encode, or rebroadcast their protected output. Playback remains on the approved receiver or app;
              a future VenueOS adapter can add input control and verified device health.
            </p>
            <div className="flex flex-col sm:flex-row gap-2 pt-1">
              <button
                onClick={onOpenAtmosphere}
                className="flex-1 px-3 py-2 text-xs font-bold rounded-lg bg-sky-600 text-white hover:bg-sky-700 inline-flex items-center justify-center gap-1.5"
              >
                <ExternalLink className="w-3.5 h-3.5" /> Open Atmosphere TV
              </button>
              <button
                onClick={onOpenDirectv}
                className="flex-1 px-3 py-2 text-xs font-bold rounded-lg bg-sky-600 text-white hover:bg-sky-700 inline-flex items-center justify-center gap-1.5"
              >
                <ExternalLink className="w-3.5 h-3.5" /> Open DIRECTV for Business
              </button>
            </div>
          </div>

          <div className="rounded-lg bg-slate-50 border border-slate-200 p-4 text-xs space-y-2">
            <h4 className="font-bold text-slate-800">What VenueOS can support honestly</h4>
            <ul className="list-disc pl-5 space-y-1 text-slate-700">
              <li><strong>Owned/licensed MP4:</strong> native playback works today.</li>
              <li><strong>Customer-authorized HLS:</strong> the player exists; signed grants, rights records, and unified recovery telemetry still need completion.</li>
              <li><strong>Soundtrack, Rockbot, and SoundMachine:</strong> official business APIs are viable adapter targets; audio remains on the provider player.</li>
              <li><strong>Fitness On Demand, Wexer, and LES MILLS:</strong> require provider agreements and certified VenueOS adapters.</li>
            </ul>
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

// ─── Partner adapter pending ────────────────────────────────────────────
// A provider can have a legitimate business API without VenueOS having a
// completed adapter. This modal prevents the catalog from turning that API
// possibility into a false "connect now" claim.
function PartnerAdapterPendingModal({ provider, onClose }: { provider: Provider; onClose: () => void }) {
  useOverlayLock(); // hide mobile tab bar so the modal footer clears it
  const destination = provider.websiteUrl || provider.docsUrl;
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="Close partner adapter details" className="absolute inset-0 cursor-default" onClick={onClose} />
      <div role="dialog" aria-modal="true" className="relative z-10 bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[85dvh] overflow-y-auto p-6 space-y-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-violet-100 flex items-center justify-center text-violet-700">
              <Music className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">{provider.name} adapter pending</h2>
              <p className="text-xs text-slate-500 mt-0.5">A real provider route, not a finished VenueOS connection.</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close partner adapter details" className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="rounded-lg bg-violet-50 border border-violet-200 p-4 text-sm text-slate-700 leading-relaxed">
          <p>{provider.tierReason || `${provider.name} requires approved partner access and a certified VenueOS adapter.`}</p>
        </div>

        <div className="rounded-lg bg-slate-50 border border-slate-200 p-4 text-xs text-slate-600 leading-relaxed">
          <strong className="text-slate-800">Current behavior:</strong> no customer token is collected and no tile is marked connected.
          VenueOS must first implement server-side credentials, tenant isolation, permitted controls, health telemetry,
          disconnected states, and provider-specific acceptance tests.
        </div>

        <div className="flex flex-wrap gap-2 justify-end pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm font-bold rounded-lg text-slate-600 hover:bg-slate-50">
            Close
          </button>
          {destination && (
            <a
              href={destination}
              target="_blank"
              rel="noreferrer"
              className="px-4 py-2 text-sm font-bold rounded-lg border border-violet-200 text-violet-700 hover:bg-violet-50 inline-flex items-center gap-2"
            >
              Provider site <ExternalLink className="w-4 h-4" />
            </a>
          )}
          <a
            href={`mailto:sales@venueos.com?subject=${encodeURIComponent(`${provider.name} VenueOS adapter request`)}`}
            className="px-4 py-2 text-sm font-bold rounded-lg bg-violet-600 text-white hover:bg-violet-700 inline-flex items-center gap-2"
          >
            Request adapter
          </a>
        </div>
      </div>
    </div>
  );
}
