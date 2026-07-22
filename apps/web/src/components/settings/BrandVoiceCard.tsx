"use client";

/**
 * BrandVoiceCard — set the per-tenant AI BRAND VOICE (Slice 1b, 2026-06-16).
 * One or two sentences describing how this venue's copy should sound; it's
 * prepended to the system prompt of every AI copy surface (Generate /
 * Rewrite / Edit-with-words) on top of the per-vertical audience tone.
 *
 * Reads /branding/me (brandVoice) and writes the narrow POST /branding/me/voice
 * (doesn't touch palette/logo, unlike the heavy /me/manual adopt).
 */

import { useEffect, useState } from 'react';
import { Loader2, Check, Wand2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { apiFetch } from '@/lib/api-client';

export function BrandVoiceCard() {
  const t = useTranslations();
  const [voice, setVoice] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    apiFetch<any>('/branding/me')
      .then((b) => { if (alive) { setVoice((b && b.brandVoice) || ''); setLoaded(true); } })
      .catch(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await apiFetch('/branding/me/voice', { method: 'POST', body: JSON.stringify({ brandVoice: voice.trim() }) });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e: any) {
      setError(e?.message || t('settings.aiVoice.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
      <div className="flex items-center gap-2">
        <Wand2 className="w-4 h-4 text-violet-500" />
        <h2 className="font-bold text-slate-800">{t('settings.aiVoice.title')}</h2>
      </div>
      <p className="text-sm text-slate-500">
        {t('settings.aiVoice.description')}
      </p>
      <textarea
        value={voice}
        onChange={(e) => setVoice(e.target.value)}
        maxLength={600}
        rows={3}
        disabled={!loaded || saving}
        aria-label={t('settings.aiVoice.title')}
        placeholder={t('settings.aiVoice.placeholder')}
        className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 disabled:opacity-60"
      />
      {error && <div role="alert" className="text-xs font-semibold text-rose-700">{error}</div>}
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-slate-400">{voice.length}/600</span>
        <button
          type="button"
          onClick={save}
          disabled={!loaded || saving}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : null}
          {saving ? t('settings.common.saving') : saved ? t('settings.common.saved') : t('settings.aiVoice.saveButton')}
        </button>
      </div>
    </div>
  );
}
