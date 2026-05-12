"use client";

/**
 * ProfileEditModal — opened from the TopToolbar avatar dropdown.
 *
 * Operator (2026-05-11): "user should be able to edit their info by
 * clicking on the top right icon that pulls up the user profile but
 * not in the top section of the settings menu."
 *
 * Previous version had a ProfileCard at the top of /settings, which
 * the operator correctly flagged as crowding an already-busy page.
 * /settings is for TENANT admin config (license, vertical, OTA
 * window, USB ingest, team roles, etc.); per-user cosmetic fields
 * belong with the user.
 *
 * UX:
 *   - Tap avatar (top-right) → dropdown shows name + email + "Edit
 *     profile" link + Sign Out
 *   - Click "Edit profile" → this modal opens
 *   - Two text inputs (first name, last name) + live preview
 *     ("Dashboard will say: Hi, Greg")
 *   - Save mutates /users/me + patches useUIStore in place so the
 *     greeting + sidebar + avatar update instantly
 */

import { useEffect, useState } from 'react';
import { X as XIcon, Check, Loader2 } from 'lucide-react';
import { useMe, useUpdateMe } from '@/hooks/use-api';
import { firstName as displayFirst, initials as displayInitials } from '@/lib/user-display';

export function ProfileEditModal({ onClose }: { onClose: () => void }) {
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

  // Esc to close — matches the pattern in EmergencyTriggerModal +
  // the pair-screen modal so the dashboard's modal UX is consistent.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const dirty =
    (firstName.trim() !== (me?.firstName ?? '')) ||
    (lastName.trim() !== (me?.lastName ?? ''));

  const previewUser = {
    ...me,
    firstName: firstName.trim() || null,
    lastName: lastName.trim() || null,
    email: me?.email ?? null,
  };

  const onSave = async () => {
    if (!dirty || update.isPending) return;
    await update.mutateAsync({
      firstName: firstName.trim() || null,
      lastName: lastName.trim() || null,
    });
    setSavedFlash(true);
    setTimeout(() => {
      setSavedFlash(false);
      onClose();
    }, 900);
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[100] flex items-start justify-center p-4 pt-24"
      role="dialog"
      aria-modal="true"
      aria-label="Edit profile"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-sm font-bold"
              style={{
                background: 'linear-gradient(135deg, var(--brand-primary, #4f46e5), color-mix(in srgb, var(--brand-primary, #4f46e5) 60%, #8b5cf6))',
              }}
            >
              {displayInitials(previewUser)}
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-slate-800">Edit your profile</h2>
              <p className="text-[11px] text-slate-500 truncate">{me?.email}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
            aria-label="Close"
          >
            <XIcon className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">First name</label>
            <input
              autoFocus
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') onSave(); }}
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
              onKeyDown={(e) => { if (e.key === 'Enter') onSave(); }}
              placeholder="Schiemann"
              maxLength={80}
              className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>

          <div className="text-[11px] text-slate-500 bg-slate-50 rounded-lg px-3 py-2 border border-slate-100">
            Dashboard will say: <span className="font-bold text-slate-800">Hi, {displayFirst(previewUser)}</span>
          </div>
        </div>

        <div className="px-6 py-4 bg-slate-50/60 border-t border-slate-100 flex items-center justify-end gap-2">
          {savedFlash && (
            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600 mr-auto">
              <Check className="w-3.5 h-3.5" /> Saved
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={update.isPending}
            className="px-3 py-2 text-xs font-bold rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={!dirty || update.isPending || isLoading}
            className="px-4 py-2 text-xs font-bold rounded-lg text-white shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            style={{ background: 'var(--brand-primary, #4f46e5)' }}
          >
            {update.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
