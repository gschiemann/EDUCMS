"use client";

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Download,
  Fingerprint,
  Loader2,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import {
  useMfaStatus,
  usePasskeys,
  usePasskeyRegisterOptions,
  usePasskeyRegisterVerify,
  usePasskeyRename,
  usePasskeyDelete,
  type PasskeySummary,
} from '@/hooks/use-api';
import {
  createPasskey,
  describePasskeyError,
  formatPasskeyLastUsed,
  guessDeviceLabel,
  passkeysSupported,
} from '@/lib/passkeys';

/**
 * PasskeyCard — enroll / rename / remove WebAuthn passkeys for the signed-in
 * user. Mounted ABOVE <MfaCard /> in /[schoolId]/settings/security.
 *
 * Operator (2026-09-21): "im sick of the damn auth app". A passkey is the
 * answer to that sentence, so it gets the top of the page and MfaCard keeps
 * its place underneath as the fallback factor.
 *
 * The card deliberately mirrors MfaCard's shell, type scale and buttons —
 * same header row, same inline password re-auth panel, same "save these now"
 * backup-code treatment. Two security-relevant behaviours it copies on
 * purpose: adding and removing a credential both re-ask for the account
 * password (a stolen session alone must not be able to mint or strip a
 * permanent factor), and recovery codes are shown exactly once.
 *
 * What it does NOT do: turn anything off. Enrolling a passkey never disables
 * the authenticator app — it only surfaces a sentence telling the operator
 * they may now do so themselves.
 */

/** apiFetch attaches `code` + `message` from the API's normalized envelope. */
type ApiError = Error & { code?: string; status?: number };

export function PasskeyCard({ autoOpenAdd = false }: { autoOpenAdd?: boolean } = {}) {
  const t = useTranslations();
  const locale = useLocale();

  // `supported` is resolved AFTER mount, never during render: reading a
  // browser capability inline makes the server-rendered HTML and the first
  // client paint disagree, which is a hydration mismatch (the same class of
  // bug that hydration-failed the kiosk splash for months).
  const [supported, setSupported] = useState<boolean | null>(null);
  useEffect(() => { setSupported(passkeysSupported()); }, []);

  const [error, setError] = useState<string | null>(null);

  // ── Add flow ────────────────────────────────────────────────────────
  // The operator opens the password panel, we trade the password for creation
  // options, run the ceremony, then verify. `adding` covers the whole chain
  // including the browser sheet, which no mutation's isPending can see.
  const [showAdd, setShowAdd] = useState(false);
  const [addPassword, setAddPassword] = useState('');
  const [adding, setAdding] = useState(false);
  // `?add=passkey` (2026-09-24) — the account menu's "Set up a passkey" lands
  // on this card with the password panel ALREADY open, once the browser is
  // known to be able to create one. Once only: closing it must stay closed.
  const autoOpened = useRef(false);
  useEffect(() => {
    if (!autoOpenAdd || autoOpened.current || supported !== true) return;
    autoOpened.current = true;
    setShowAdd(true);
  }, [autoOpenAdd, supported]);

  // ── Remove flow (one row at a time) ─────────────────────────────────
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [removePassword, setRemovePassword] = useState('');

  // ── Rename (inline, one row at a time) ──────────────────────────────
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // ── Backup codes, shown ONCE ────────────────────────────────────────
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [copiedCodes, setCopiedCodes] = useState(false);

  const { data, isLoading } = usePasskeys();
  const optionsMut = usePasskeyRegisterOptions();
  const verifyMut = usePasskeyRegisterVerify();
  const renameMut = usePasskeyRename();
  const deleteMut = usePasskeyDelete();

  // The list endpoint can legitimately answer with nothing (an older API, or
  // a test harness that stubs every call) — treat that as "no passkeys yet",
  // never as a crash.
  const passkeys: PasskeySummary[] = data?.passkeys ?? [];
  const max = data?.max ?? 10;
  const atLimit = passkeys.length >= max;

  /** Turn an API rejection into the most specific sentence we have. */
  const apiMessage = (err: unknown, fallbackKey: string): string => {
    const e = err as ApiError | undefined;
    switch (e?.code) {
      case 'PASSKEY_PASSWORD_REQUIRED':
        return t('passkeys.errPasswordRequired');
      case 'PASSKEY_LIMIT':
        return t('passkeys.errLimit', { max });
      case 'PASSKEY_ORIGIN_NOT_ALLOWED':
        return t('passkeys.errWrongDomain');
      case 'PASSKEY_LAST_FACTOR':
        return t('passkeys.errLastFactor');
      case 'PASSKEY_VERIFICATION_FAILED':
        return t('passkeys.errVerificationFailed');
      // A wrong password on a VALID session is a 403, never a 401: apiFetch
      // treats every 401 as "your session expired" and signs the operator out,
      // so a typo here used to throw them back to the login page (lead's
      // end-to-end run, 2026-09-21).
      case 'PASSKEY_BAD_PASSWORD':
        return t('passkeys.errWrongPassword');
      default:
        break;
    }
    if (e?.status === 401) return t('passkeys.errWrongPassword');
    if (e?.status === 429) return t('passkeys.errTooMany');
    return (e && e.message) || t(fallbackKey);
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!addPassword) {
      setError(t('passkeys.enterPasswordToAdd'));
      return;
    }
    setAdding(true);
    try {
      const { options } = await optionsMut.mutateAsync({ password: addPassword });
      // Clear the password the moment the server has accepted it — it is not
      // needed for the rest of the chain and the browser sheet can sit open
      // for a long time.
      setAddPassword('');
      let attestation;
      try {
        attestation = await createPasskey(options);
      } catch (ceremonyErr) {
        const described = describePasskeyError(ceremonyErr, 'create');
        // A dismissed Face ID sheet is a decision, not a failure. Close the
        // panel and say nothing.
        if (described.quiet) { setShowAdd(false); return; }
        setError(t(described.messageKey as string));
        return;
      }
      const res = await verifyMut.mutateAsync({
        response: attestation,
        label: guessDeviceLabel(),
      });
      setShowAdd(false);
      if (Array.isArray(res.backupCodes) && res.backupCodes.length) {
        setBackupCodes(res.backupCodes);
      }
    } catch (err) {
      setError(apiMessage(err, 'passkeys.errAddFailed'));
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!removeId) return;
    if (!removePassword) {
      setError(t('passkeys.enterPasswordToRemove'));
      return;
    }
    try {
      await deleteMut.mutateAsync({ id: removeId, password: removePassword });
      setRemoveId(null);
      setRemovePassword('');
    } catch (err) {
      setError(apiMessage(err, 'passkeys.errRemoveFailed'));
    }
  };

  const handleRename = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!renameId) return;
    const label = renameValue.trim();
    if (!label) {
      setError(t('passkeys.enterName'));
      return;
    }
    try {
      await renameMut.mutateAsync({ id: renameId, label });
      setRenameId(null);
      setRenameValue('');
    } catch (err) {
      setError(apiMessage(err, 'passkeys.errRenameFailed'));
    }
  };

  const copyCodes = async () => {
    if (!backupCodes) return;
    try {
      await navigator.clipboard.writeText(backupCodes.join('\n'));
      setCopiedCodes(true);
      setTimeout(() => setCopiedCodes(false), 1500);
    } catch { /* clipboard unavailable — the codes are on screen anyway */ }
  };

  const downloadCodes = () => {
    if (!backupCodes) return;
    const blob = new Blob(
      [
        t('mfaCard.backupFileHeader') + '\n',
        t('mfaCard.backupFileNote') + '\n\n',
        backupCodes.join('\n'),
        '\n',
      ],
      { type: 'text/plain' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'venueos-backup-codes.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const hasPasskeys = passkeys.length > 0;
  // Whether the authenticator app is ON — the same cached read the Security
  // page's rail makes (['mfa-status']), so this costs no request of its own.
  const { data: mfaStatus } = useMfaStatus();
  const totpOn = mfaStatus?.enabled === true;

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Header row — same shape as MfaCard's. */}
      <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
            hasPasskeys ? 'bg-emerald-50' : 'bg-slate-100'
          }`}>
            <Fingerprint className={`w-4 h-4 ${hasPasskeys ? 'text-emerald-600' : 'text-slate-500'}`} />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              {t('passkeys.title')}
              {hasPasskeys && (
                <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                  {t('passkeys.statusOn')}
                </span>
              )}
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">{t('passkeys.subtitle')}</p>
          </div>
        </div>
        {supported && !showAdd && !atLimit && (
          <button
            type="button"
            onClick={() => { setShowAdd(true); setError(null); setAddPassword(''); setRemoveId(null); setRenameId(null); }}
            className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 transition-colors disabled:opacity-60"
          >
            <Plus className="w-4 h-4" /> {t('passkeys.addPasskey')}
          </button>
        )}
      </div>

      <div className="p-6 space-y-5">
        {/* aria-live so a screen reader hears the failure without having to
            go hunting for it — same contract the login page uses. */}
        <div aria-live="polite">
          {error && (
            <div className="flex items-start gap-2 px-3 py-2.5 bg-rose-50 border border-rose-200 rounded-lg">
              <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
              <p className="text-xs text-rose-700 font-medium">{error}</p>
            </div>
          )}
        </div>

        {/* Unsupported browser — say so calmly and offer no button. */}
        {supported === false && (
          <p className="text-xs text-slate-500 leading-relaxed">{t('passkeys.unsupported')}</p>
        )}

        {supported !== false && (
          <p className="text-xs text-slate-500 leading-relaxed">{t('passkeys.pitch')}</p>
        )}

        {/* ── Backup codes (shown once) ────────────────────────────── */}
        {backupCodes && (
          <div className="space-y-4">
            <div className="flex items-start gap-2 px-3 py-2.5 bg-emerald-50 border border-emerald-200 rounded-lg">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <p className="text-xs text-emerald-800 font-medium">{t('passkeys.codesSuccess')}</p>
            </div>
            <div className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
              {backupCodes.map((c) => (
                <code key={c} className="text-sm font-mono text-slate-700 select-all text-center">{c}</code>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={copyCodes}
                className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg inline-flex items-center gap-1.5"
              >
                {copiedCodes ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                {copiedCodes ? t('mfaCard.copied') : t('mfaCard.copyCodes')}
              </button>
              <button
                type="button"
                onClick={downloadCodes}
                className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg inline-flex items-center gap-1.5"
              >
                <Download className="w-4 h-4" /> {t('mfaCard.download')}
              </button>
              <button
                type="button"
                onClick={() => setBackupCodes(null)}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg ml-auto"
              >
                {t('mfaCard.savedThem')}
              </button>
            </div>
          </div>
        )}

        {/* ── Add: password re-auth ────────────────────────────────── */}
        {showAdd && (
          <form onSubmit={handleAdd} className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
            <p className="text-xs font-semibold text-slate-700">{t('passkeys.confirmPasswordAdd')}</p>
            <p className="text-[11px] text-slate-500">{t('passkeys.confirmPasswordAddWhy')}</p>
            <label htmlFor="passkey-add-password" className="sr-only">{t('mfaCard.yourPassword')}</label>
            <input
              id="passkey-add-password"
              type="password"
              autoComplete="current-password"
              // The panel only ever appears on purpose (the Add button, or
              // `?add=passkey`), and the password is its one field.
              autoFocus
              placeholder={t('mfaCard.yourPassword')}
              value={addPassword}
              onChange={(e) => setAddPassword(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={adding}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg inline-flex items-center gap-2"
              >
                {adding
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> {t('passkeys.creating')}</>
                  : <><Fingerprint className="w-4 h-4" /> {t('passkeys.continueAdd')}</>}
              </button>
              <button
                type="button"
                onClick={() => { setShowAdd(false); setAddPassword(''); setError(null); }}
                className="px-4 py-2 text-slate-500 hover:text-slate-700 text-xs font-semibold"
              >
                {t('mfaCard.cancel')}
              </button>
            </div>
          </form>
        )}

        {atLimit && supported && (
          <p className="text-[11px] text-slate-400">{t('passkeys.atLimit', { max })}</p>
        )}

        {/* ── The list ─────────────────────────────────────────────── */}
        {isLoading ? (
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Loader2 className="w-4 h-4 animate-spin" /> {t('passkeys.loading')}
          </div>
        ) : hasPasskeys ? (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 list-none">
            {passkeys.map((pk) => {
              const lastUsed = pk.lastUsedAt ? formatPasskeyLastUsed(pk.lastUsedAt, locale) : null;
              return (
                <li key={pk.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-800 truncate">
                        {pk.label || t('passkeys.unnamed')}
                      </p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {t('passkeys.addedOn', { date: new Date(pk.createdAt).toLocaleDateString(locale) })}
                        {' · '}
                        {lastUsed ? t('passkeys.lastUsed', { when: lastUsed }) : t('passkeys.neverUsed')}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        aria-label={t('passkeys.renameAria', { name: pk.label || t('passkeys.unnamed') })}
                        onClick={() => {
                          setRenameId(pk.id);
                          setRenameValue(pk.label || '');
                          setRemoveId(null);
                          setError(null);
                        }}
                        className="p-2 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-slate-100 transition-colors"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        aria-label={t('passkeys.removeAria', { name: pk.label || t('passkeys.unnamed') })}
                        onClick={() => {
                          setRemoveId(pk.id);
                          setRemovePassword('');
                          setRenameId(null);
                          setError(null);
                        }}
                        className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {renameId === pk.id && (
                    <form onSubmit={handleRename} className="mt-3 flex flex-wrap items-center gap-2">
                      <label htmlFor={`passkey-rename-${pk.id}`} className="sr-only">
                        {t('passkeys.nameLabel')}
                      </label>
                      <input
                        id={`passkey-rename-${pk.id}`}
                        type="text"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        placeholder={t('passkeys.namePlaceholder')}
                        className="flex-1 min-w-[10rem] px-3 py-2 text-sm border border-slate-300 rounded-lg"
                      />
                      <button
                        type="submit"
                        disabled={renameMut.isPending}
                        className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg"
                      >
                        {t('passkeys.save')}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setRenameId(null); setError(null); }}
                        className="px-3 py-2 text-slate-500 hover:text-slate-700 text-xs font-semibold"
                      >
                        {t('mfaCard.cancel')}
                      </button>
                    </form>
                  )}

                  {removeId === pk.id && (
                    <form onSubmit={handleRemove} className="mt-3 rounded-lg border border-rose-200 bg-rose-50/60 p-4 space-y-3">
                      <p className="text-xs font-semibold text-rose-800">
                        {t('passkeys.confirmPasswordRemove', { name: pk.label || t('passkeys.unnamed') })}
                      </p>
                      <label htmlFor={`passkey-remove-password-${pk.id}`} className="sr-only">
                        {t('mfaCard.yourPassword')}
                      </label>
                      <input
                        id={`passkey-remove-password-${pk.id}`}
                        type="password"
                        autoComplete="current-password"
                        placeholder={t('mfaCard.yourPassword')}
                        value={removePassword}
                        onChange={(e) => setRemovePassword(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-rose-300 rounded-lg"
                      />
                      <div className="flex gap-2">
                        <button
                          type="submit"
                          disabled={deleteMut.isPending}
                          className="px-4 py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg inline-flex items-center gap-2"
                        >
                          {deleteMut.isPending
                            ? <><Loader2 className="w-4 h-4 animate-spin" /> {t('passkeys.removing')}</>
                            : t('passkeys.remove')}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setRemoveId(null); setRemovePassword(''); setError(null); }}
                          className="px-4 py-2 text-slate-500 hover:text-slate-700 text-xs font-semibold"
                        >
                          {t('mfaCard.cancel')}
                        </button>
                      </div>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        ) : supported === false ? null : (
          <p className="text-[11px] text-slate-400">{t('passkeys.emptyState')}</p>
        )}

        {/* Once a passkey exists the authenticator app is optional. Say so —
            only when the app is actually ON (2026-09-24: with 2FA off, "you
            can turn it off" described a control that was not there) — and do
            NOT act on it. Turning someone's second factor off on their behalf
            is exactly the kind of silent security change that must always be
            the operator's own deliberate click (MfaCard, below, still owns
            that control). */}
        {hasPasskeys && totpOn && (
          <p className="text-[11px] text-slate-400 leading-relaxed">
            {t('passkeys.mayDisableTotp')}
          </p>
        )}
      </div>
    </div>
  );
}
