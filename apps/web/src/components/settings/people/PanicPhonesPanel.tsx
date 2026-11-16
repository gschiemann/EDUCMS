"use client";

/**
 * Panic phones (2026-11-14) — Settings → People → a person → "Emergency phones".
 *
 * Lists the phones this person has kept ready for emergencies and turns any
 * of them off. Read once when opened (never polled). The API decides who may
 * see this (the same gate as every People action) and every turn-off writes an
 * immutable PANIC_DEVICE_REVOKED row naming the admin.
 */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Smartphone } from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import { appConfirm } from '@/components/ui/app-dialog';

interface PanicPhone {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
  state: 'active' | 'revoked';
}

function day(iso: string | null): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleDateString() : '—';
}

export function PanicPhonesPanel({ userId, email }: { userId: string; email: string }) {
  const t = useTranslations();
  const [phones, setPhones] = useState<PanicPhone[] | null>(null);
  const [personCanSend, setPersonCanSend] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      const res = await apiFetch<{ devices: PanicPhone[]; personCanSend: boolean }>(`/users/${encodeURIComponent(userId)}/panic-devices`);
      setPhones(res.devices ?? []);
      setPersonCanSend(res.personCanSend !== false);
    } catch (e: any) {
      setError(e?.message || t('settings.cc.people.panicPhonesLoadFailed'));
      setPhones([]);
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const turnOff = async (phone: PanicPhone) => {
    const ok = await appConfirm({
      title: t('settings.cc.people.panicPhoneOffTitle', { email }),
      message: t('settings.cc.people.panicPhoneOffMessage'),
      confirmLabel: t('settings.cc.people.panicPhoneOffConfirm'),
    });
    if (!ok) return;
    setBusy(phone.id);
    try {
      await apiFetch(`/users/${encodeURIComponent(userId)}/panic-devices/${encodeURIComponent(phone.id)}/revoke`, { method: 'POST', body: '{}' });
      await load();
    } catch (e: any) {
      setError(e?.message || t('settings.cc.people.panicPhoneOffFailed'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-2 sm:ml-[42px] rounded-[10px] border border-slate-200 bg-slate-50 p-3 text-[13px]" data-testid={`people-panic-phones-${userId}`}>
      <p className="font-semibold text-slate-800">{t('settings.cc.people.panicPhonesTitle')}</p>
      <p className="mt-0.5 text-[12px] text-slate-600">{t('settings.cc.people.panicPhonesHint')}</p>
      {!personCanSend && (
        <p className="mt-1 text-[12px] font-medium text-amber-700">{t('settings.cc.people.panicPhonesCannotSend')}</p>
      )}
      {error && <p role="alert" className="mt-1 text-[12px] text-red-700">{error}</p>}
      {phones === null ? (
        <Loader2 className="mt-2 w-4 h-4 animate-spin text-slate-500" aria-hidden />
      ) : phones.length === 0 ? (
        <p className="mt-2 text-[12px] text-slate-500">{t('settings.cc.people.panicPhonesNone')}</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {phones.map((p) => (
            <li key={p.id} className="flex items-center gap-2 min-w-0">
              <Smartphone className="w-4 h-4 shrink-0 text-slate-500" aria-hidden />
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium text-slate-800">{p.label}</span>{' '}
                <span className="text-slate-500">
                  {p.state === 'active'
                    ? t('settings.cc.people.panicPhoneActive', { since: day(p.createdAt), lastUsed: day(p.lastUsedAt) })
                    : t('settings.cc.people.panicPhoneRevoked', { on: day(p.revokedAt) })}
                </span>
              </span>
              {p.state === 'active' && (
                <button
                  type="button"
                  onClick={() => void turnOff(p)}
                  disabled={busy === p.id}
                  data-testid={`people-panic-phone-off-${p.id}`}
                  className="shrink-0 min-h-[34px] px-2 rounded-[8px] border border-red-200 bg-white text-[12px] font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  {t('settings.cc.people.panicPhoneOff')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
