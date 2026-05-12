"use client";

/**
 * ProfileCard — "Your Profile" section on the Settings page.
 *
 * Operator (2026-05-11): "let's add first and last name to the user
 * profile so we can say Hi Greg and not gschiemann."
 *
 * Lets any signed-in user edit their own firstName + lastName. The
 * mutation patches `useUIStore.user` on success so the dashboard
 * greeting + sidebar + top-toolbar avatar all update instantly —
 * no re-login, no /users/me round trip.
 *
 * Visible to every role. Doesn't gate on admin — name editing is
 * cosmetic and doesn't change permissions.
 */

import { useEffect, useState } from 'react';
import { User as UserIcon, Loader2, Check } from 'lucide-react';
import { useMe, useUpdateMe } from '@/hooks/use-api';
import { firstName as displayFirst, fullName as displayFull, initials as displayInitials } from '@/lib/user-display';

export function ProfileCard() {
  const { data: me, isLoading } = useMe();
  const update = useUpdateMe();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    if (!me) return;
    setFirstName(me.firstName ?? '');
    setLastName(me.lastName ?? '');
  }, [me]);

  const dirty =
    (firstName.trim() !== (me?.firstName ?? '')) ||
    (lastName.trim() !== (me?.lastName ?? ''));

  const onSave = async () => {
    if (!dirty || update.isPending) return;
    await update.mutateAsync({
      firstName: firstName.trim() || null,
      lastName: lastName.trim() || null,
    });
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 2200);
  };

  // Live preview reflects whatever is in the inputs right now — even
  // unsaved. Operator sees "Hi Greg" the moment they finish typing,
  // without having to click Save first.
  const previewUser = { ...me, firstName: firstName.trim() || null, lastName: lastName.trim() || null, email: me?.email ?? null };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
      <div className="flex items-start gap-4">
        <div
          className="w-12 h-12 rounded-2xl flex items-center justify-center text-white text-sm font-bold shrink-0"
          style={{
            background: 'linear-gradient(135deg, var(--brand-primary, #4f46e5), color-mix(in srgb, var(--brand-primary, #4f46e5) 60%, #8b5cf6))',
          }}
        >
          {displayInitials(previewUser)}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold text-slate-700 flex items-center gap-2">
            <UserIcon className="w-4 h-4" style={{ color: 'var(--brand-primary, #6366f1)' }} /> Your profile
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Set how you want the dashboard to address you. The greeting + sidebar update everywhere instantly.
          </p>
          <div className="text-[11px] text-slate-400 mt-1 font-medium truncate">{me?.email}</div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">First name</label>
          <input
            type="text"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            placeholder="Greg"
            maxLength={80}
            className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Last name</label>
          <input
            type="text"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            placeholder="Schiemann"
            maxLength={80}
            className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between flex-wrap gap-3">
        <div className="text-[11px] text-slate-500">
          Dashboard will say: <span className="font-bold text-slate-800">Hi, {displayFirst(previewUser)}</span>
          {(firstName.trim() || lastName.trim()) && (
            <>
              {' '}· avatar shows <span className="font-mono font-bold text-slate-700">{displayInitials(previewUser)}</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {savedFlash && (
            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600">
              <Check className="w-3.5 h-3.5" /> Saved
            </span>
          )}
          <button
            type="button"
            onClick={onSave}
            disabled={!dirty || update.isPending || isLoading}
            className="px-4 py-2 text-xs font-bold rounded-lg text-white shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            style={{ background: 'var(--brand-primary, #4f46e5)' }}
          >
            {update.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            Save profile
          </button>
        </div>
      </div>
    </div>
  );
}
