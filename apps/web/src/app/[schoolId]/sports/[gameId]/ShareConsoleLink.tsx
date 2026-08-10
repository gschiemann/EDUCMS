'use client';

/**
 * ShareConsoleLink — the operator's "hand a scorekeeper the pad" card
 * (Phase-2 Domain SHARE). Self-contained component + ONE mount line in
 * the console page's SEND TO DEVICE sheet (same pattern as
 * ConnectionBanner), sitting under the role-view QR list: those links
 * require a logged-in operator; THIS one is the no-account path — a
 * revocable, always-expiring /console/<token> capability link.
 *
 * Mint on open: the sheet mounts this component → POST
 * /sports/games/:id/console-share issues a fresh token against the game's
 * live consoleTokenVersion (server AuditLogs the mint) — UNLESS the
 * operator revoked in this tab session, which pins the revoked panel
 * until an explicit "Create a new link" (see revokeFlagKey below). Copy-link + QR
 * (client-side qrcode lib, same privacy rationale as RoleViewQr — the
 * token is a WRITE credential and must never round-trip a third-party QR
 * service). Revoke (with confirm) bumps the version server-side, killing
 * EVERY outstanding link for this game, then offers a re-mint.
 */

import { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Check, Copy } from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import { consoleShareUrl } from '@/lib/console-share';

interface MintResponse {
  token: string;
  url?: string;
  expiresAt?: string;
  consoleTokenVersion?: number;
}

/**
 * Revoke must stick across sheet remounts (refuter P2, Phase-2 SHARE):
 * without this, "Revoke all links" → close sheet → reopen silently
 * auto-mints a fresh live 24h credential and renders it as a QR — the
 * exact re-arm the operator just said no to. A sessionStorage flag per
 * game suppresses the auto-mint until the operator explicitly clicks
 * "Create a new link" (per-tab scope is the right blast radius: another
 * device/operator opening the sheet is a fresh decision, not this one's).
 */
function revokeFlagKey(gameId: string): string {
  return `venueos_console_share_revoked_${gameId}`;
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
    /* storage blocked (private mode) — degrade to old per-mount behavior */
  }
}

export function ShareConsoleLink({ gameId }: { gameId: string }) {
  const [state, setState] = useState<'loading' | 'ready' | 'revoked' | 'error'>('loading');
  const [url, setUrl] = useState('');
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [qr, setQr] = useState('');
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const mint = useCallback(async () => {
    setState('loading');
    setConfirming(false);
    setRevokeFlag(gameId, false);
    try {
      const res = await apiFetch<MintResponse>(`/sports/games/${gameId}/console-share`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      // Prefer the page's own origin (what the operator's phone can reach);
      // the server-built URL is the fallback for odd proxy setups.
      const link =
        typeof window !== 'undefined' && res?.token
          ? consoleShareUrl(window.location.origin, res.token)
          : res?.url || '';
      if (!link) throw new Error('mint failed');
      setUrl(link);
      setExpiresAt(res?.expiresAt || null);
      setState('ready');
    } catch {
      setState('error');
    }
  }, [gameId]);

  useEffect(() => {
    // A remount after "Revoke all links" holds at the revoked panel —
    // minting again requires the explicit "Create a new link" click.
    if (hasRevokeFlag(gameId)) {
      setState('revoked');
      return;
    }
    mint();
  }, [gameId, mint]);

  useEffect(() => {
    if (!url) {
      setQr('');
      return;
    }
    let alive = true;
    QRCode.toDataURL(url, { width: 180, margin: 1 })
      .then((d) => { if (alive) setQr(d); })
      .catch(() => { if (alive) setQr(''); });
    return () => { alive = false; };
  }, [url]);

  const revoke = async () => {
    try {
      await apiFetch(`/sports/games/${gameId}/console-share`, { method: 'DELETE' });
      setRevokeFlag(gameId, true);
      setUrl('');
      setQr('');
      setState('revoked');
      setConfirming(false);
    } catch {
      setState('error');
    }
  };

  return (
    <div className="mt-3 border-t border-slate-200 pt-3">
      <div className="text-[13px] font-bold text-slate-900">Scorekeeper link — no login</div>
      <p className="mt-0.5 text-[11px] text-slate-500">
        Limited controls only (score, clock, period, timeouts, celebrations).
        Anyone with this link can run the pad until it expires or you revoke it.
      </p>

      {state === 'loading' && (
        <div className="mt-2 text-[12px] font-semibold text-slate-400">Creating link…</div>
      )}

      {state === 'error' && (
        <div className="mt-2 flex items-center">
          <span className="text-[12px] font-semibold text-red-600">Couldn&apos;t create the link.</span>
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
            All scorekeeper links for this game are revoked.
          </span>
          <button
            type="button"
            onClick={mint}
            className="ml-2 rounded-md bg-indigo-50 px-2 py-1 text-[12px] font-bold text-indigo-700 hover:bg-indigo-100"
          >
            Create a new link
          </button>
        </div>
      )}

      {state === 'ready' && (
        <div className="mt-2 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50/60 p-2.5">
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={qr}
              alt="QR code to open the scorekeeper pad"
              className="h-[72px] w-[72px] shrink-0 rounded-md bg-white"
            />
          ) : (
            <div className="h-[72px] w-[72px] shrink-0 rounded-md bg-slate-100" aria-hidden />
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-[11px] text-slate-500">{url}</div>
            {expiresAt && (
              <div className="text-[10px] text-slate-400">
                Expires {new Date(expiresAt).toLocaleString()}
              </div>
            )}
            <div className="mt-1.5 flex items-center">
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard?.writeText(url);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1800);
                  } catch {
                    /* clipboard blocked (insecure ctx) — QR still works */
                  }
                }}
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-indigo-50 px-2.5 py-1 text-[12px] font-bold text-indigo-700 hover:bg-indigo-100"
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-600" /> Copied link
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" /> Copy link
                  </>
                )}
              </button>
              {confirming ? (
                <>
                  <button
                    type="button"
                    onClick={revoke}
                    className="ml-2 min-h-[36px] rounded-lg bg-red-600 px-2.5 py-1 text-[12px] font-bold text-white hover:bg-red-700"
                  >
                    Revoke all links
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
                  className="ml-2 min-h-[36px] rounded-lg px-2.5 py-1 text-[12px] font-bold text-red-600 hover:bg-red-50"
                >
                  Revoke…
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
