'use client';

/**
 * ShareConsoleLink — the operator's "hand a volunteer the pad" card
 * (Phase-2 Domain SHARE; role links added for the K-12 launch program,
 * register row K12-F16). Self-contained component + ONE mount line in the
 * console page's SEND TO DEVICE sheet (same pattern as ConnectionBanner),
 * sitting under the role-view QR list: those links require a logged-in
 * operator; THIS one is the no-account path — a revocable, always-expiring
 * /console/<token> capability link.
 *
 * WHO IS THE LINK FOR (K12-F16). The operator picks a job — the whole table,
 * the scorekeeper, the clock operator, the shot/play-clock operator — and
 * the minted link carries that role INSIDE its HMAC; the API enforces it on
 * every tap (a clock operator's link cannot change the score). Only the
 * roles the sport has any use for are offered (@cms/api-types
 * consoleRolesForSport — no clock operator for volleyball). Each role's link
 * is minted once per sheet-open and cached, so switching tabs does not
 * spray new credentials.
 *
 * Mint on open: POST /sports/games/:id/console-share { role } issues a fresh
 * token against the game's live consoleTokenVersion (server AuditLogs the
 * mint, with the role) — UNLESS the operator revoked in this tab session,
 * which pins the revoked panel until an explicit "Create a new link" (see
 * revokeFlagKey below). Copy-link + QR (client-side qrcode lib — the token
 * is a WRITE credential and must never round-trip a third-party QR
 * service). Revoke (with confirm) bumps the version server-side, killing
 * EVERY outstanding link for this game, whatever its role.
 */

import { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Check, Copy } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  consoleRolesForSport,
  findSport,
  isConsoleRole,
  type ConsoleRole,
} from '@cms/api-types';
import { apiFetch } from '@/lib/api-client';
import { consoleShareUrl } from '@/lib/console-share';

interface MintResponse {
  token: string;
  url?: string;
  expiresAt?: string;
  consoleTokenVersion?: number;
  role?: string | null;
}

interface Minted {
  url: string;
  expiresAt: string | null;
  /** The role the SERVER put in the link — null when it issued a pre-role
   *  link (an API from before role links), which the card says plainly. */
  granted: ConsoleRole | null;
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

export function ShareConsoleLink({ gameId, sport }: { gameId: string; sport?: string }) {
  const t = useTranslations('sportsShareLink');
  const def = findSport(sport);
  const roles = consoleRolesForSport(def);
  const offered: ConsoleRole[] = roles.length > 0 ? roles : ['table'];
  const [role, setRole] = useState<ConsoleRole>(offered[0]);
  const [state, setState] = useState<'loading' | 'ready' | 'revoked' | 'error'>('loading');
  const [links, setLinks] = useState<Partial<Record<ConsoleRole, Minted>>>({});
  const [qr, setQr] = useState('');
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const current = links[role];

  const mint = useCallback(
    async (forRole: ConsoleRole) => {
      setState('loading');
      setConfirming(false);
      setRevokeFlag(gameId, false);
      try {
        const res = await apiFetch<MintResponse>(`/sports/games/${gameId}/console-share`, {
          method: 'POST',
          body: JSON.stringify({ role: forRole }),
        });
        // Prefer the page's own origin (what the operator's phone can reach);
        // the server-built URL is the fallback for odd proxy setups.
        const link =
          typeof window !== 'undefined' && res?.token
            ? consoleShareUrl(window.location.origin, res.token)
            : res?.url || '';
        if (!link) throw new Error('mint failed');
        const grantedRole = res?.role;
        setLinks((cur) => ({
          ...cur,
          [forRole]: {
            url: link,
            expiresAt: res?.expiresAt || null,
            granted: isConsoleRole(grantedRole) ? grantedRole : null,
          },
        }));
        setState('ready');
      } catch {
        setState('error');
      }
    },
    [gameId],
  );

  useEffect(() => {
    // A remount after "Revoke all links" holds at the revoked panel —
    // minting again requires the explicit "Create a new link" click.
    if (hasRevokeFlag(gameId)) {
      setState('revoked');
      return;
    }
    if (links[role]) {
      setState('ready');
      return;
    }
    void mint(role);
    // Mint once per (game, role) — `links` is read, not a trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, role, mint]);

  useEffect(() => {
    const url = current?.url || '';
    if (!url) {
      setQr('');
      return;
    }
    let alive = true;
    QRCode.toDataURL(url, { width: 180, margin: 1 })
      .then((d) => { if (alive) setQr(d); })
      .catch(() => { if (alive) setQr(''); });
    return () => { alive = false; };
  }, [current?.url]);

  const revoke = async () => {
    try {
      await apiFetch(`/sports/games/${gameId}/console-share`, { method: 'DELETE' });
      setRevokeFlag(gameId, true);
      setLinks({});
      setQr('');
      setState('revoked');
      setConfirming(false);
    } catch {
      setState('error');
    }
  };

  const roleLabel = (r: ConsoleRole) =>
    r === 'shot' && def?.key === 'football' ? t('rolePlay') : t(`role.${r}`);
  const roleHint = (r: ConsoleRole) =>
    r === 'shot' && def?.key === 'football' ? t('hintPlay') : t(`hint.${r}`);

  return (
    <div className="mt-3 border-t border-slate-200 pt-3" data-testid="share-console-link">
      <div className="text-[13px] font-bold text-slate-900">{t('title')}</div>
      <p className="mt-0.5 text-[11px] text-slate-500">{t('intro')}</p>

      <div className="mt-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">{t('whoLabel')}</div>
      <div className="mt-1 grid grid-cols-2 gap-1.5" role="radiogroup" aria-label={t('whoLabel')}>
        {offered.map((r) => (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={role === r}
            onClick={() => {
              setRole(r);
              setCopied(false);
            }}
            className={`flex min-h-[44px] flex-col items-start justify-center rounded-lg border px-2.5 py-1.5 text-left transition-colors ${
              role === r
                ? 'border-indigo-500 bg-indigo-50 text-indigo-800'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            <span className="text-[12px] font-black">{roleLabel(r)}</span>
            <span className="text-[10px] font-semibold text-slate-500">{roleHint(r)}</span>
          </button>
        ))}
      </div>

      {state === 'loading' && (
        <div className="mt-2 text-[12px] font-semibold text-slate-400">{t('creating')}</div>
      )}

      {state === 'error' && (
        <div className="mt-2 flex items-center">
          <span className="text-[12px] font-semibold text-red-600">{t('error')}</span>
          <button
            type="button"
            onClick={() => void mint(role)}
            className="ml-2 min-h-[36px] max-md:min-h-[44px] rounded-md bg-slate-100 px-2 py-1 text-[12px] font-bold text-slate-700 hover:bg-slate-200"
          >
            {t('retry')}
          </button>
        </div>
      )}

      {state === 'revoked' && (
        <div className="mt-2 flex items-center">
          <span className="text-[12px] font-semibold text-emerald-700">{t('revokedAll')}</span>
          <button
            type="button"
            onClick={() => void mint(role)}
            className="ml-2 min-h-[36px] max-md:min-h-[44px] rounded-md bg-indigo-50 px-2 py-1 text-[12px] font-bold text-indigo-700 hover:bg-indigo-100"
          >
            {t('createNew')}
          </button>
        </div>
      )}

      {state === 'ready' && current && (
        <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50/60 p-2.5">
          {current.granted !== role && (
            <p className="mb-2 text-[11px] font-semibold text-amber-800" role="status">
              {t('roleNotApplied')}
            </p>
          )}
          <div className="flex items-center gap-3">
            {qr ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={qr}
                alt={t('qrAlt', { role: roleLabel(role) })}
                className="h-[72px] w-[72px] shrink-0 rounded-md bg-white"
              />
            ) : (
              <div className="h-[72px] w-[72px] shrink-0 rounded-md bg-slate-100" aria-hidden />
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-[11px] text-slate-500">{current.url}</div>
              {current.expiresAt && (
                <div className="text-[10px] text-slate-400">
                  {t('expires', { when: new Date(current.expiresAt).toLocaleString() })}
                </div>
              )}
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard?.writeText(current.url);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1800);
                    } catch {
                      /* clipboard blocked (insecure ctx) — QR still works */
                    }
                  }}
                  className="inline-flex min-h-[36px] max-md:min-h-[44px] items-center gap-1.5 rounded-lg bg-indigo-50 px-2.5 py-1 text-[12px] font-bold text-indigo-700 hover:bg-indigo-100"
                >
                  {copied ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-600" /> {t('copied')}
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" /> {t('copy')}
                    </>
                  )}
                </button>
                {confirming ? (
                  <>
                    <button
                      type="button"
                      onClick={revoke}
                      className="min-h-[36px] max-md:min-h-[44px] rounded-lg bg-red-600 px-2.5 py-1 text-[12px] font-bold text-white hover:bg-red-700"
                    >
                      {t('revokeAll')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirming(false)}
                      className="min-h-[36px] max-md:min-h-[44px] rounded-lg px-2 py-1 text-[12px] font-semibold text-slate-500 hover:bg-slate-100"
                    >
                      {t('keep')}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirming(true)}
                    className="min-h-[36px] max-md:min-h-[44px] rounded-lg px-2.5 py-1 text-[12px] font-bold text-red-600 hover:bg-red-50"
                  >
                    {t('revoke')}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
