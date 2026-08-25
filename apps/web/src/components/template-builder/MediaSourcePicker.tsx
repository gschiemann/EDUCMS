'use client';

/**
 * MediaSourcePicker — connect a gym media board to its sources, in the
 * editor, without leaving the board.
 *
 * WHY THIS IS NOT A LINK TO SETTINGS
 * The POS picker on the menu boards sends the operator to
 * Settings → POS and hopes they come back. For media that round trip is
 * worse than an inconvenience: the operator is looking at a board that
 * says SOURCE NOT CONFIGURED and has no way to act on it from where they
 * are standing. So the connect form lives here — pick a provider, enter
 * what it needs, and the board's badge changes while you watch.
 *
 * WHAT IT WILL NOT DO
 * It offers only sources the API would actually accept. A provider whose
 * terms forbid public performance, or that has no adapter, is shown with
 * the reason and cannot be selected — rather than being hidden (the
 * operator asks "where's YouTube?" and the answer needs to exist) and
 * rather than being offered and failing at save (which reads as a bug in
 * our software instead of a fact about the provider).
 *
 * Capability comes from the server (`mediaRole` on the connection DTO).
 * The editor deliberately does not infer "can this drive a screen?" from
 * a provider id — that inference is how a board ends up claiming a live
 * feed it does not have.
 */

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { Loader2, Plus, X, CheckCircle2, AlertCircle, Lock, Clock, Tv, Music } from 'lucide-react';

interface ProviderLite {
  id: string;
  name: string;
  category: string;
  integrationTier: 'DIRECT' | 'PARTNER' | 'BRIDGE' | 'CLOSED';
  blurb: string;
  iconEmoji?: string;
  auth: 'none' | 'apiKey' | 'oauth2' | 'license' | 'customHls' | 'iframeOnly';
  commercialUseLegal: boolean;
  requiresVenueLicense?: boolean;
  tierReason?: string;
  pricingNote?: string;
}

interface ConnectionLite {
  id: string;
  providerId: string;
  providerName: string;
  displayName?: string;
  status: 'PENDING' | 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'ERROR';
  statusReason?: string;
  mediaRole?: 'RENDERS' | 'EXTERNAL' | 'PENDING_ADAPTER';
  isMusic?: boolean;
}

export interface MediaSourceBinding {
  programConnectionId?: string;
  musicConnectionId?: string;
}

/** Why a provider cannot be connected, in the operator's terms. */
function blockedReason(p: ProviderLite): string | null {
  if (!p.commercialUseLegal) {
    return 'Their terms do not allow showing this in a business. A consumer subscription is not a venue license.';
  }
  if (p.integrationTier === 'CLOSED' || p.integrationTier === 'BRIDGE') {
    return p.tierReason || 'Playback stays on the provider’s own licensed device. VenueOS has no adapter for it yet.';
  }
  if (p.auth === 'oauth2') {
    return 'This provider has a real business API. Our sign-in flow for it is not finished, so it cannot be connected yet.';
  }
  return null;
}

function StatusPill({ c }: { c: ConnectionLite }) {
  const map: Record<string, { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
    ACTIVE: { label: 'Verified', cls: 'text-emerald-700 bg-emerald-50 border-emerald-200', Icon: CheckCircle2 },
    PENDING: { label: 'Adapter pending', cls: 'text-amber-700 bg-amber-50 border-amber-200', Icon: Clock },
    ERROR: { label: 'Not reachable', cls: 'text-rose-700 bg-rose-50 border-rose-200', Icon: AlertCircle },
    EXPIRED: { label: 'Expired', cls: 'text-rose-700 bg-rose-50 border-rose-200', Icon: AlertCircle },
    REVOKED: { label: 'Revoked', cls: 'text-rose-700 bg-rose-50 border-rose-200', Icon: AlertCircle },
  };
  const s = map[c.status] || map.PENDING;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${s.cls}`}>
      <s.Icon className="w-3 h-3" /> {s.label}
    </span>
  );
}

/** One bound slot — program video or business music. */
function Slot({
  title, Icon, connections, value, onChange, onConnect, onTest, testing, emptyHint,
}: {
  title: string;
  Icon: typeof Tv;
  connections: ConnectionLite[];
  value?: string;
  onChange: (id: string | undefined) => void;
  onConnect: () => void;
  onTest: (id: string) => void;
  testing: string | null;
  emptyHint: string;
}) {
  const chosen = connections.find((c) => c.id === value);
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Icon className="w-3.5 h-3.5 text-slate-500" />
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600">{title}</span>
      </div>

      <select
        value={value || ''}
        onChange={(e) => onChange(e.target.value || undefined)}
        className="w-full px-2 py-1.5 rounded-md border border-slate-300 bg-white text-xs font-medium text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500"
      >
        <option value="">Not connected</option>
        {connections.map((c) => (
          <option key={c.id} value={c.id}>
            {c.displayName || c.providerName}
            {c.status === 'ACTIVE' ? ' — verified' : c.status === 'ERROR' ? ' — not reachable' : ' — adapter pending'}
          </option>
        ))}
      </select>

      {chosen ? (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <StatusPill c={chosen} />
            {chosen.mediaRole === 'RENDERS' && (
              <button
                type="button"
                onClick={() => onTest(chosen.id)}
                disabled={testing === chosen.id}
                className="text-[10px] font-semibold text-indigo-600 hover:underline disabled:opacity-50"
              >
                {testing === chosen.id ? 'Testing…' : 'Test again'}
              </button>
            )}
          </div>
          <p className="text-[10px] leading-relaxed text-slate-500">
            {chosen.mediaRole === 'RENDERS' && chosen.status === 'ACTIVE' &&
              'VenueOS plays this feed. The board shows LIVE once the screen reports it playing.'}
            {chosen.mediaRole === 'RENDERS' && chosen.status === 'ERROR' &&
              (chosen.statusReason || 'We could not reach this stream. The board will show SOURCE OFFLINE.')}
            {chosen.mediaRole === 'EXTERNAL' &&
              'Playback stays on the provider’s licensed device. The board shows EXTERNAL LICENSED DEVICE — never LIVE.'}
            {chosen.mediaRole === 'PENDING_ADAPTER' &&
              'Recorded, but our adapter for this provider is not finished — it cannot drive the screen yet.'}
          </p>
        </div>
      ) : (
        <p className="text-[10px] leading-relaxed text-slate-500">{emptyHint}</p>
      )}

      <button
        type="button"
        onClick={onConnect}
        className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:underline"
      >
        <Plus className="w-3 h-3" /> Connect a source
      </button>
    </div>
  );
}

/** Inline connect sheet — the whole point of this component. */
function ConnectSheet({
  providers, onClose, onConnected,
}: {
  providers: ProviderLite[];
  onClose: () => void;
  onConnected: (id: string) => void;
}) {
  const [picked, setPicked] = useState<ProviderLite | null>(null);
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [displayName, setDisplayName] = useState('');
  const [attested, setAttested] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const connectable = providers.filter((p) => !blockedReason(p));
  const blocked = providers.filter((p) => blockedReason(p));

  const save = useMutation({
    mutationFn: async () => {
      if (!picked) throw new Error('Pick a source first.');
      return apiFetch<{ id: string }>('/streaming/connections', {
        method: 'POST',
        body: JSON.stringify({ providerId: picked.id, displayName: displayName || undefined, credentials: creds }),
      });
    },
    onSuccess: (row) => onConnected(row.id),
    onError: (e: unknown) => setErr(e instanceof Error ? e.message : String(e)),
  });

  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-700">Connect a media source</span>
        <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-600">
          <X className="w-4 h-4" />
        </button>
      </div>

      {!picked ? (
        <div className="space-y-2">
          {connectable.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => { setPicked(p); setErr(null); setAttested(!p.requiresVenueLicense); }}
              className="w-full text-left rounded-md border border-slate-200 bg-white p-2 hover:border-indigo-400"
            >
              <div className="flex items-center gap-2">
                <span className="text-base">{p.iconEmoji || '📺'}</span>
                <span className="text-xs font-semibold text-slate-800">{p.name}</span>
                {p.pricingNote && <span className="ml-auto text-[10px] text-slate-400">{p.pricingNote}</span>}
              </div>
              <p className="mt-0.5 text-[10px] leading-relaxed text-slate-500">{p.blurb}</p>
            </button>
          ))}

          {blocked.length > 0 && (
            <details className="rounded-md border border-slate-200 bg-white/70 p-2">
              <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                <Lock className="inline w-3 h-3 mr-1 -mt-0.5" />
                {blocked.length} sources we can’t connect — and why
              </summary>
              <ul className="mt-2 space-y-2">
                {blocked.map((p) => (
                  <li key={p.id} className="text-[10px] leading-relaxed">
                    <span className="font-semibold text-slate-700">{p.iconEmoji || '📺'} {p.name}</span>
                    <span className="block text-slate-500">{blockedReason(p)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-base">{picked.iconEmoji || '📺'}</span>
            <span className="text-xs font-semibold text-slate-800">{picked.name}</span>
            <button type="button" onClick={() => setPicked(null)} className="ml-auto text-[10px] text-indigo-600 hover:underline">
              Change
            </button>
          </div>

          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={`Name it (optional) — e.g. “${picked.name} · Cardio floor”`}
            className="w-full px-2 py-1.5 rounded-md border border-slate-300 text-xs outline-none focus:ring-2 focus:ring-indigo-500"
          />

          {picked.auth === 'customHls' && (
            <>
              <input
                value={creds.playbackUrl || ''}
                onChange={(e) => setCreds({ ...creds, playbackUrl: e.target.value })}
                placeholder="https://…/master.m3u8"
                className="w-full px-2 py-1.5 rounded-md border border-slate-300 text-xs outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <p className="text-[10px] leading-relaxed text-slate-500">
                Your own feed, or one you hold a written licence to show. We check that the URL plays — that
                check cannot tell us whether you are licensed, so that part is on you.
              </p>
            </>
          )}

          {picked.auth === 'apiKey' && (
            <input
              value={creds.apiKey || ''}
              onChange={(e) => setCreds({ ...creds, apiKey: e.target.value })}
              placeholder="API key from your provider account"
              className="w-full px-2 py-1.5 rounded-md border border-slate-300 text-xs outline-none focus:ring-2 focus:ring-indigo-500"
            />
          )}

          {picked.auth === 'license' && (
            <input
              value={creds.licenseNumber || ''}
              onChange={(e) => setCreds({ ...creds, licenseNumber: e.target.value })}
              placeholder="Commercial account / licence number"
              className="w-full px-2 py-1.5 rounded-md border border-slate-300 text-xs outline-none focus:ring-2 focus:ring-indigo-500"
            />
          )}

          {picked.requiresVenueLicense && (
            <label className="flex items-start gap-2 text-[10px] leading-relaxed text-slate-600">
              <input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} className="mt-0.5" />
              <span>This location holds a current commercial licence for this content.</span>
            </label>
          )}

          {err && <p className="text-[10px] font-medium text-rose-600">{err}</p>}

          <button
            type="button"
            disabled={save.isPending || (picked.requiresVenueLicense && !attested)}
            onClick={() => { setErr(null); save.mutate(); }}
            className="w-full rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {save.isPending ? <><Loader2 className="inline w-3 h-3 animate-spin mr-1" />Checking the source…</> : 'Connect'}
          </button>
        </div>
      )}
    </div>
  );
}

export function MediaSourcePicker({
  cfg, setField,
}: {
  cfg: Record<string, unknown>;
  setField: (patch: Record<string, unknown>) => void;
}) {
  const qc = useQueryClient();
  const [connecting, setConnecting] = useState<null | 'program' | 'music'>(null);
  const [testing, setTesting] = useState<string | null>(null);

  const providersQ = useQuery<ProviderLite[]>({
    queryKey: ['stream-providers'],
    queryFn: () => apiFetch<ProviderLite[]>('/streaming/providers'),
    staleTime: 300_000, retry: false,
  });
  const connsQ = useQuery<ConnectionLite[]>({
    queryKey: ['stream-connections'],
    queryFn: () => apiFetch<ConnectionLite[]>('/streaming/connections'),
    staleTime: 30_000, retry: false,
  });

  const binding = (cfg.mediaSource && typeof cfg.mediaSource === 'object'
    ? cfg.mediaSource : {}) as MediaSourceBinding;
  const conns = useMemo(() => connsQ.data || [], [connsQ.data]);
  const videoConns = useMemo(() => conns.filter((c) => !c.isMusic), [conns]);
  const musicConns = useMemo(() => conns.filter((c) => c.isMusic), [conns]);
  const providers = providersQ.data || [];

  const bind = (patch: MediaSourceBinding) =>
    setField({ mediaSource: { ...binding, ...patch } });

  const test = async (id: string) => {
    setTesting(id);
    try {
      await apiFetch(`/streaming/connections/${id}/test`, { method: 'POST' });
      await qc.invalidateQueries({ queryKey: ['stream-connections'] });
    } catch { /* the refreshed row carries the reason */ }
    finally { setTesting(null); }
  };

  const onConnected = async (slot: 'program' | 'music', id: string) => {
    const fresh = await qc.fetchQuery<ConnectionLite[]>({
      queryKey: ['stream-connections'],
      queryFn: () => apiFetch<ConnectionLite[]>('/streaming/connections'),
    });
    const row = fresh.find((c) => c.id === id);
    // Bind to whichever slot the operator opened, but respect what the
    // source actually is: connecting a music service from the video slot
    // binds it as music rather than silently mis-slotting it.
    const isMusic = row?.isMusic ?? (slot === 'music');
    bind(isMusic ? { musicConnectionId: id } : { programConnectionId: id });
    setConnecting(null);
  };

  if (connsQ.isLoading || providersQ.isLoading) {
    return (
      <div data-edit-media className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-500">
        <Loader2 className="inline w-3 h-3 animate-spin mr-1" /> Loading your media sources…
      </div>
    );
  }

  return (
    // data-edit-media is the jump target for a `kind:'media'` click on the
    // board — tapping the now-playing track lands here.
    <div className="space-y-2" data-edit-media>
      <Slot
        title="Program video"
        Icon={Tv}
        connections={videoConns}
        value={binding.programConnectionId}
        onChange={(id) => bind({ programConnectionId: id })}
        onConnect={() => setConnecting('program')}
        onTest={test}
        testing={testing}
        emptyHint="Until a source is connected the board reads SOURCE NOT CONFIGURED on screen. That is deliberate — it never pretends to be live."
      />
      <Slot
        title="Business music"
        Icon={Music}
        connections={musicConns}
        value={binding.musicConnectionId}
        onChange={(id) => bind({ musicConnectionId: id })}
        onConnect={() => setConnecting('music')}
        onTest={test}
        testing={testing}
        emptyHint="Optional. Track and provider details appear only once a music adapter reports them — the board will not invent a now-playing track."
      />

      {connecting && (
        <ConnectSheet
          providers={providers}
          onClose={() => setConnecting(null)}
          onConnected={(id) => onConnected(connecting, id)}
        />
      )}
    </div>
  );
}
