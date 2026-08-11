'use client';

/**
 * ConnectScoreboardFeed — the guided "plug in your Scorebird / Sportzcast"
 * feed-setup card (Inputs-wave GUIDED, 2026-08-10).
 *
 * HONESTY RULE (discovery.service.ts "zero costumes"): the vendor chips are
 * RECIPE cards — per-vendor setup instructions over the SAME shipped generic
 * HMAC score feed (`POST /sports/board/:id/feed`, header `x-feed-token`).
 * There is NO native Sportzcast/Scorebird protocol adapter; every chip swaps
 * ONLY the instruction text, never the credential or the wire format.
 *
 * Structure mirrors ShareConsoleLink.tsx: mint-on-open 4-state machine
 * (loading / ready / revoked / error) + a sessionStorage revoke-sticky flag
 * so a revoke whose replacement never rendered can't be silently re-armed by
 * a remount. Visuals mirror the POS ConnectModal's copy-paste doc block
 * (settings/pos/page.tsx). Deliberately NO ?token= URL mode, NO QR, and NO
 * test-connection button in v1 (a synthetic test POST would share the real
 * bridge's 40/10s rate bucket and could 429 a live vendor feed).
 *
 * The status row (`Waiting for first packet…` → `Receiving — Xs ago` →
 * stale) reads `stats.feed` off the EXISTING useGame 4s poll via the `stats`
 * prop — no new poller (mobile-perf standard). The 1 Hz local tick mirrors
 * CtsConsoleStatus: no network, just a re-render so ages count up live.
 */

import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, RefreshCw } from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import { computeFeedStatus, type FeedStatus } from '@/lib/cts-merge';

interface FeedCredentials {
  ingestUrl: string;
  tokenHeader: string;
  token: string;
  expiresAt?: string;
  feedTokenVersion?: number;
  curlExample?: string;
  accepts?: string[];
}

interface RevokeResponse {
  success?: boolean;
  feedTokenVersion?: number;
  token?: string;
  tokenExpiresAt?: string;
}

const ACCEPTED_FIELDS_FALLBACK = ['homeScore', 'awayScore', 'clockMs', 'clockRunning', 'segment'];

/**
 * Revoke-sticky flag (ShareConsoleLink precedent, refuter P2): set the
 * moment a revoke lands server-side, cleared once replacement credentials
 * actually render. If the replace step fails (or the tab dies in between),
 * a remount holds at the revoked panel instead of silently auto-minting —
 * the operator explicitly clicks "Create new credentials" to re-arm.
 */
function revokeFlagKey(gameId: string): string {
  return `venueos_feed_revoked_${gameId}`;
}
function hasRevokeFlag(gameId: string): boolean {
  try {
    return sessionStorage.getItem(revokeFlagKey(gameId)) === '1';
  } catch {
    return false;
  }
}
function setRevokeFlag(gameId: string, on: boolean): void {
  try {
    if (on) sessionStorage.setItem(revokeFlagKey(gameId), '1');
    else sessionStorage.removeItem(revokeFlagKey(gameId));
  } catch {
    /* storage blocked (private mode) — degrade to per-mount behavior */
  }
}

type VendorKey = 'sportzcast' | 'scorebird' | 'generic';

const VENDORS: { key: VendorKey; label: string }[] = [
  { key: 'sportzcast', label: 'Sportzcast' },
  { key: 'scorebird', label: 'Scorebird' },
  { key: 'generic', label: 'Anything else' },
];

/** Per-vendor recipe steps. Instructions ONLY — same URL, same token, same
 *  JSON for every vendor (see the honesty note in the component). */
function vendorSteps(vendor: VendorKey): string[] {
  switch (vendor) {
    case 'sportzcast':
      return [
        'In your Sportzcast cloud portal (ScoreHub / ScoreLink), open the data-output settings for the Scorebot at this venue.',
        'Add an HTTP push (webhook) output and paste the ingest URL below as the destination.',
        'Add a request header named x-feed-token with the token below.',
        'Map the output to the JSON fields listed below (any subset works). If your plan only pushes a fixed format, run their bridge/relay — or any small script — that reposts to this URL; the curl line is a working packet.',
      ];
    case 'scorebird':
      return [
        'In your Scorebird dashboard (MyScorebird), open the integrations / data-feed settings for this scoreboard’s nest.',
        'Add an HTTP push (webhook) pointing at the ingest URL below.',
        'Add a request header named x-feed-token with the token below.',
        'Map the push to the JSON fields listed below (any subset works). If the portal can’t shape the JSON, a tiny relay script that reposts works — the curl line is a working packet.',
      ];
    case 'generic':
      return [
        'Anything that can POST JSON works: a console-reader bridge, Node-RED, a stats app, or a 5-line script.',
        'POST to the ingest URL below with the x-feed-token header set to the token.',
        'Send any subset of the JSON fields listed below — omitted fields are left unchanged.',
        'The curl line below is a complete working packet you can adapt.',
      ];
  }
}

/** The plaintext block the copy button writes — same shape the old
 *  copy-feed-URL button produced, so existing vendor notes stay valid. */
function buildCopyBlock(c: FeedCredentials): string {
  const fields = (c.accepts && c.accepts.length ? c.accepts : ACCEPTED_FIELDS_FALLBACK).join(', ');
  return (
    `VenueOS live score feed\n` +
    `POST to: ${c.ingestUrl}\n` +
    `Header:   ${c.tokenHeader || 'x-feed-token'}: ${c.token}\n` +
    `Fields:   ${fields} (any subset)\n\n` +
    `Test:\n${c.curlExample || ''}`
  );
}

function formatAge(ageMs: number): string {
  const s = Math.max(0, Math.round(ageMs / 1000));
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ago`;
}

/**
 * Live status row — `Waiting for first packet…` / `Receiving — Xs ago` /
 * stale. Pure derivation from the `stats` prop (already refreshed by the
 * page's existing useGame poll) via computeFeedStatus; the 1 Hz tick only
 * re-renders so the age counts up between polls (CtsConsoleStatus pattern).
 */
function FeedStatusRow({ stats }: { stats: Record<string, unknown> }) {
  // Browser clock as the reference — same documented choice as
  // CtsConsoleStatus: we only care how long ago the server-stamped packet
  // arrived, and the 20s window absorbs reasonable skew. The clock sample
  // lives in STATE (updated by the 1 Hz interval) so the render itself
  // stays pure (react-hooks/purity).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const status: FeedStatus = computeFeedStatus(stats, now);

  const dot: Record<FeedStatus['kind'], string> = {
    fresh: 'bg-green-500 animate-pulse',
    stale: 'bg-amber-500',
    never: 'bg-slate-400 animate-pulse',
  };
  const box: Record<FeedStatus['kind'], string> = {
    fresh: 'ring-1 ring-green-300 bg-green-50 text-green-900',
    stale: 'ring-1 ring-amber-300 bg-amber-50 text-amber-900',
    never: 'ring-1 ring-slate-200 bg-slate-50 text-slate-600',
  };
  const via =
    status.source === 'cts'
      ? ' (via CTS console)'
      : status.source === 'swim'
        ? ' (via swim timing)'
        : '';
  const text =
    status.kind === 'never'
      ? 'Waiting for first packet…'
      : status.kind === 'fresh'
        ? `Receiving${via}${status.ageMs !== null ? ` — ${formatAge(status.ageMs)}` : ''}`
        : `No packets${status.ageMs !== null ? ` — last one ${formatAge(status.ageMs)}` : ''}`;

  return (
    <div
      className={`mt-2 flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] font-semibold ${box[status.kind]}`}
      data-testid="feed-status-row"
    >
      <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${dot[status.kind]}`} />
      <span className="min-w-0 flex-1">{text}</span>
    </div>
  );
}

export function ConnectScoreboardFeed({
  gameId,
  stats,
}: {
  gameId: string;
  stats: Record<string, unknown>;
}) {
  const [state, setState] = useState<'loading' | 'ready' | 'revoked' | 'error'>('loading');
  const [creds, setCreds] = useState<FeedCredentials | null>(null);
  const [vendor, setVendor] = useState<VendorKey>('sportzcast');
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [rotatedNow, setRotatedNow] = useState(false);

  const mint = useCallback(async () => {
    setState('loading');
    setConfirming(false);
    setRevokeFlag(gameId, false);
    try {
      const c = await apiFetch<FeedCredentials>(`/sports/games/${gameId}/feed-credentials`);
      if (!c?.ingestUrl || !c?.token) throw new Error('mint failed');
      setCreds(c);
      setState('ready');
    } catch {
      setState('error');
    }
  }, [gameId]);

  useEffect(() => {
    // A remount after a revoke whose replacement never rendered holds at
    // the revoked panel — re-minting requires the explicit button click.
    if (hasRevokeFlag(gameId)) {
      setState('revoked');
      return;
    }
    mint();
  }, [gameId, mint]);

  // Regenerate = revoke-and-replace: the revoke endpoint bumps
  // Game.feedTokenVersion (killing EVERY outstanding token for this game,
  // including the legacy bare token) AND returns a fresh credential, which
  // we swap in place so the operator can re-paste it into their vendor.
  const regenerate = async () => {
    setConfirming(false);
    setState('loading');
    setRevokeFlag(gameId, true); // sticky until the replacement renders
    try {
      const r = await apiFetch<RevokeResponse>(`/sports/games/${gameId}/revoke-feed-token`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      if (!r?.token) {
        // Revoke landed but no replacement — hold at the revoked panel.
        setCreds(null);
        setState('revoked');
        return;
      }
      setCreds((prev) => ({
        ingestUrl: prev?.ingestUrl || '',
        tokenHeader: prev?.tokenHeader || 'x-feed-token',
        token: r.token as string,
        expiresAt: r.tokenExpiresAt,
        feedTokenVersion: r.feedTokenVersion,
        // Rebuild the example around the new token so the copy block never
        // carries a dead credential.
        curlExample: prev?.ingestUrl
          ? `curl -X POST "${prev.ingestUrl}" -H "x-feed-token: ${r.token}" -H "Content-Type: application/json" -d '{"homeScore":14,"awayScore":7,"clockMs":420000,"clockRunning":true,"segment":2}'`
          : undefined,
        accepts: prev?.accepts,
      }));
      setRotatedNow(true);
      setRevokeFlag(gameId, false);
      setState('ready');
    } catch {
      setState('error');
    }
  };

  const copyDetails = async () => {
    if (!creds) return;
    const block = buildCopyBlock(creds);
    try {
      await navigator.clipboard?.writeText(block);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      window.prompt('Copy the score-feed details:', block);
    }
  };

  const fields = (creds?.accepts && creds.accepts.length ? creds.accepts : ACCEPTED_FIELDS_FALLBACK).join(
    ', ',
  );

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="text-[13px] font-bold text-slate-900">
        Scoreboard feed — Sportzcast / Scorebird / anything
      </div>
      <p className="mt-0.5 text-[11px] text-slate-500">
        Point your score box at this game and the live score &amp; clock flow in
        machine-to-machine — no login on the sending side. Pick your vendor for
        step-by-step instructions.
      </p>

      {/* Vendor recipe chips — swap ONLY the instruction text. */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {VENDORS.map((v) => (
          <button
            key={v.key}
            type="button"
            onClick={() => setVendor(v.key)}
            aria-pressed={vendor === v.key}
            className={`min-h-[32px] rounded-full border px-3 py-1 text-[12px] font-bold transition-colors ${
              vendor === v.key
                ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-[10px] text-slate-400">
        Every vendor uses the same VenueOS score feed (one URL + one token) —
        these are setup instructions for your vendor&apos;s HTTP push, not a
        separate per-vendor connection.
      </p>

      <ol className="mt-2 list-decimal space-y-1 pl-4 text-[11px] leading-snug text-slate-600">
        {vendorSteps(vendor).map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>

      {state === 'loading' && (
        <div className="mt-2 text-[12px] font-semibold text-slate-400">Creating credentials…</div>
      )}

      {state === 'error' && (
        <div className="mt-2 flex items-center">
          <span className="text-[12px] font-semibold text-red-600">
            Couldn&apos;t load the feed credentials.
          </span>
          <button
            type="button"
            onClick={mint}
            className="ml-2 rounded-md bg-slate-100 px-2 py-1 text-[12px] font-bold text-slate-700 hover:bg-slate-200"
          >
            Retry
          </button>
        </div>
      )}

      {state === 'revoked' && (
        <div className="mt-2 flex items-center">
          <span className="text-[12px] font-semibold text-emerald-700">
            All feed credentials for this game are revoked.
          </span>
          <button
            type="button"
            onClick={mint}
            className="ml-2 min-h-[36px] rounded-md bg-indigo-50 px-2 py-1 text-[12px] font-bold text-indigo-700 hover:bg-indigo-100"
          >
            Create new credentials
          </button>
        </div>
      )}

      {state === 'ready' && creds && (
        <>
          {(rotatedNow || (creds.feedTokenVersion ?? 0) > 0) && (
            <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
              <span className="font-bold">Rotated</span> — tokens issued before the
              last regenerate (including the original one) no longer work. Make sure
              your vendor has the token below.
            </div>
          )}

          {/* Copy-paste doc block — POS ConnectModal webhook-block pattern. */}
          <div className="mt-2 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-600">
            <p className="break-all">
              <span className="font-bold text-slate-700">POST to</span>{' '}
              <code className="font-mono">{creds.ingestUrl}</code>
            </p>
            <p className="break-all">
              <span className="font-bold text-slate-700">Header</span>{' '}
              <code className="font-mono">{creds.tokenHeader || 'x-feed-token'}: {creds.token}</code>
            </p>
            <p>
              <span className="font-bold text-slate-700">Fields</span>{' '}
              <code className="font-mono">{fields}</code> — any subset
            </p>
            {creds.curlExample && (
              <>
                <p className="font-bold text-slate-700">Test packet:</p>
                <pre className="overflow-x-auto rounded-md border border-slate-200 bg-white p-2 text-[10px] leading-relaxed text-slate-700">{creds.curlExample}</pre>
              </>
            )}
            {creds.expiresAt && (
              <p className="text-slate-400">
                Token expires {new Date(creds.expiresAt).toLocaleString()} — reopen
                this card any time for a current one.
              </p>
            )}
          </div>

          <div className="mt-2 flex flex-wrap items-center">
            <button
              type="button"
              onClick={copyDetails}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-indigo-50 px-2.5 py-1 text-[12px] font-bold text-indigo-700 hover:bg-indigo-100"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-600" /> Copied setup details
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" /> Copy URL + token
                </>
              )}
            </button>
            {confirming ? (
              <>
                <button
                  type="button"
                  onClick={regenerate}
                  className="ml-2 min-h-[36px] rounded-lg bg-red-600 px-2.5 py-1 text-[12px] font-bold text-white hover:bg-red-700"
                >
                  Yes — revoke &amp; replace
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="ml-1.5 min-h-[36px] rounded-lg px-2 py-1 text-[12px] font-semibold text-slate-500 hover:bg-slate-100"
                >
                  Keep
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                title="Revoke-and-replace: every previously deployed credential for this game stops working, and a fresh token is issued"
                className="ml-2 inline-flex min-h-[36px] items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] font-bold text-red-600 hover:bg-red-50"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Regenerate…
              </button>
            )}
          </div>
          {confirming && (
            <p className="mt-1 text-[11px] text-red-600">
              This kills every credential already deployed for this game (including
              the original token) the moment you confirm — your vendor stops
              syncing until you paste in the new one.
            </p>
          )}
        </>
      )}

      <FeedStatusRow stats={stats} />

      <p className="mt-2 text-[10px] text-slate-400">
        Credentials are per-game: for the next game, open this card on that
        game and give your vendor its new URL + token.
      </p>
    </div>
  );
}
