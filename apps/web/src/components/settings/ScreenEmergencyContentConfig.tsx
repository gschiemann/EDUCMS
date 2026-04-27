"use client";

/**
 * Per-screen emergency content config — Sprint 8b component.
 *
 * Lets an admin configure WHAT plays on a SPECIFIC screen during each
 * of the 6 emergency types (Lockdown / Evacuate / Hold / Secure /
 * Weather / Medical), with INDEPENDENT landscape and portrait variants
 * inside each type. Three states per (type, orientation):
 *   1. "Use tenant default"  (both playlistId AND assetUrl null)
 *   2. Pick an existing playlist
 *   3. Upload a single custom asset (image / video / PDF)
 *
 * Used to live inline on the floor-plan drawer; moved to a Settings-
 * only primitive on 2026-04-27 because the operator wanted ALL
 * emergency-asset configuration centralized in Settings (and gated
 * to admins only). The floor-plan drawer now links here.
 *
 * Saves immediately on every change (no Save button). Uploads use the
 * shared /assets/upload endpoint so the file lands in the operator's
 * media library too — they can re-pick it later via the playlist
 * dropdown.
 */

import { useState } from 'react';
import { Loader2, Upload, Trash2 } from 'lucide-react';
import {
  useUpdateScreenEmergencyContent,
  type FloorPlanScreen,
} from '@/hooks/use-api';

export interface EmergencyTypeRow {
  short: 'lockdown' | 'evacuate' | 'hold' | 'secure' | 'weather' | 'medical';
  // Landscape variants
  playlistKey: keyof FloorPlanScreen;
  assetKey: keyof FloorPlanScreen;
  // Portrait variants
  portraitPlaylistKey: keyof FloorPlanScreen;
  portraitAssetKey: keyof FloorPlanScreen;
  label: string;
  emoji: string;
  description: string;
}

export const EMERGENCY_TYPES: EmergencyTypeRow[] = [
  { short: 'lockdown', label: 'Lockdown', emoji: '🔒', description: 'Threat — secure room, lights off',
    playlistKey: 'emergencyLockdownPlaylistId', assetKey: 'emergencyLockdownAssetUrl',
    portraitPlaylistKey: 'emergencyLockdownPortraitPlaylistId', portraitAssetKey: 'emergencyLockdownPortraitAssetUrl' },
  { short: 'evacuate', label: 'Evacuate', emoji: '🚪', description: 'Fire / hazard — leave the building',
    playlistKey: 'emergencyEvacuatePlaylistId', assetKey: 'emergencyEvacuateAssetUrl',
    portraitPlaylistKey: 'emergencyEvacuatePortraitPlaylistId', portraitAssetKey: 'emergencyEvacuatePortraitAssetUrl' },
  { short: 'hold',     label: 'Hold',     emoji: '✋', description: 'Clear hallways, stay in current room',
    playlistKey: 'emergencyHoldPlaylistId', assetKey: 'emergencyHoldAssetUrl',
    portraitPlaylistKey: 'emergencyHoldPortraitPlaylistId', portraitAssetKey: 'emergencyHoldPortraitAssetUrl' },
  { short: 'secure',   label: 'Secure',   emoji: '🛡️', description: 'Outside threat — close perimeter, business as usual inside',
    playlistKey: 'emergencySecurePlaylistId', assetKey: 'emergencySecureAssetUrl',
    portraitPlaylistKey: 'emergencySecurePortraitPlaylistId', portraitAssetKey: 'emergencySecurePortraitAssetUrl' },
  { short: 'weather',  label: 'Weather',  emoji: '🌪️', description: 'Severe storm / tornado — interior safe spot',
    playlistKey: 'emergencyWeatherPlaylistId', assetKey: 'emergencyWeatherAssetUrl',
    portraitPlaylistKey: 'emergencyWeatherPortraitPlaylistId', portraitAssetKey: 'emergencyWeatherPortraitAssetUrl' },
  { short: 'medical',  label: 'Medical',  emoji: '🚑', description: 'Medical event — clear the area',
    playlistKey: 'emergencyMedicalPlaylistId', assetKey: 'emergencyMedicalAssetUrl',
    portraitPlaylistKey: 'emergencyMedicalPortraitPlaylistId', portraitAssetKey: 'emergencyMedicalPortraitAssetUrl' },
];

type Orient = 'landscape' | 'portrait';

export function ScreenEmergencyContentConfig({
  screenId,
  screen,
}: {
  screenId: string;
  screen: FloorPlanScreen;
}) {
  const updateMutation = useUpdateScreenEmergencyContent();
  // uploadingType is a composite key `${short}-${orient}` so each
  // upload spot's spinner is independent.
  const [uploadingType, setUploadingType] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const apiKeys = (type: EmergencyTypeRow, orient: Orient) => {
    if (orient === 'landscape') {
      return { playlist: `${type.short}PlaylistId`, asset: `${type.short}AssetUrl` };
    }
    return { playlist: `${type.short}PortraitPlaylistId`, asset: `${type.short}PortraitAssetUrl` };
  };

  const onUploadCustom = async (type: EmergencyTypeRow, orient: Orient, file: File) => {
    setUploadError(null);
    setUploadingType(`${type.short}-${orient}`);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { useUIStore } = await import('@/store/ui-store');
      const { API_URL } = await import('@/lib/api-url');
      const token = useUIStore.getState().token;
      const res = await fetch(`${API_URL}/assets/upload`, {
        method: 'POST',
        body: fd,
        credentials: 'include',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      const { url } = await res.json();
      const k = apiKeys(type, orient);
      // Setting a custom asset clears any playlist override for the
      // same (type, orientation) — single source of truth.
      updateMutation.mutate({
        screenId,
        patch: { [k.asset]: url, [k.playlist]: null } as any,
      });
    } catch (err: any) {
      setUploadError(err?.message || 'Upload failed — try a smaller file');
    } finally {
      setUploadingType(null);
    }
  };

  const onClear = (type: EmergencyTypeRow, orient: Orient) => {
    const k = apiKeys(type, orient);
    updateMutation.mutate({
      screenId,
      patch: { [k.playlist]: null, [k.asset]: null } as any,
    });
  };

  return (
    <section>
      <p className="text-[11px] text-slate-500 leading-relaxed mb-3">
        Upload the content that plays on <span className="font-semibold text-slate-700">this screen only</span> for each emergency type.
        <span className="font-semibold"> 📺 Landscape</span> and <span className="font-semibold">📱 Portrait</span> are independent —
        the player picks the one matching the screen's orientation. Empty slots fall back to the
        tenant default.
      </p>
      <div className="space-y-2.5">
        {EMERGENCY_TYPES.map((t) => {
          const orientations: { orient: Orient; icon: string; label: string }[] = [
            { orient: 'landscape', icon: '📺', label: 'Landscape' },
            { orient: 'portrait',  icon: '📱', label: 'Portrait' },
          ];

          return (
            <div key={t.short} className="rounded-lg border border-slate-200 p-2.5 bg-slate-50/60">
              <div className="flex items-center gap-2 mb-2">
                <div className="shrink-0 w-9 h-9 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-base shadow-sm" title={t.description}>
                  <span aria-hidden>{t.emoji}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-bold text-slate-700">{t.label}</div>
                  <div className="text-[10px] text-slate-400 truncate" title={t.description}>{t.description}</div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {orientations.map(({ orient, icon, label }) => {
                  const k = apiKeys(t, orient);
                  const assetUrl = (screen[k.asset as keyof FloorPlanScreen] as string | null | undefined) ?? '';
                  const hasCustomAsset = !!assetUrl;
                  const filename = hasCustomAsset ? assetUrl.split('/').pop()?.split('?')[0] : '';
                  const uploadKey = `${t.short}-${orient}`;
                  const isUploadingThis = uploadingType === uploadKey;

                  return (
                    <label
                      key={orient}
                      className={`relative rounded-md border-2 border-dashed p-3 text-center cursor-pointer transition-colors ${
                        hasCustomAsset
                          ? 'border-emerald-300 bg-emerald-50/60 hover:bg-emerald-50'
                          : isUploadingThis
                            ? 'border-emerald-400 bg-emerald-50'
                            : 'border-slate-300 bg-white hover:border-emerald-400 hover:bg-emerald-50/40'
                      }`}
                      title={hasCustomAsset
                        ? `${filename}\nClick to replace, or use × to clear`
                        : `Upload ${label.toLowerCase()} ${t.label.toLowerCase()} content (image, video, or PDF)`}
                    >
                      <div className="flex items-center justify-center gap-1.5 mb-1.5">
                        <span className="text-xs" aria-hidden>{icon}</span>
                        <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</span>
                      </div>
                      {isUploadingThis ? (
                        <div className="flex items-center justify-center gap-1.5 text-[11px] font-bold text-emerald-700">
                          <Loader2 className="w-3 h-3 animate-spin" /> Uploading…
                        </div>
                      ) : hasCustomAsset ? (
                        <>
                          <div className="text-[11px] font-bold text-emerald-700 truncate" title={filename || 'custom asset'}>
                            ✓ {filename || 'custom'}
                          </div>
                          <div className="text-[9px] text-emerald-600 mt-0.5">Click to replace</div>
                          <button
                            type="button"
                            onClick={(e) => { e.preventDefault(); onClear(t, orient); }}
                            aria-label={`Clear ${label} ${t.label} asset`}
                            title="Clear (revert to tenant default)"
                            className="absolute top-1 right-1 w-5 h-5 rounded-full bg-white border border-emerald-300 flex items-center justify-center text-emerald-700 hover:bg-rose-50 hover:border-rose-300 hover:text-rose-700"
                          >
                            <Trash2 className="w-2.5 h-2.5" />
                          </button>
                        </>
                      ) : (
                        <>
                          <div className="flex items-center justify-center gap-1 text-[11px] font-bold text-slate-500">
                            <Upload className="w-3 h-3" /> Drop / click
                          </div>
                          <div className="text-[9px] text-slate-400 mt-0.5">Image · video · PDF</div>
                        </>
                      )}
                      <input
                        type="file"
                        accept="image/*,video/*,application/pdf"
                        className="hidden"
                        disabled={!!uploadingType || updateMutation.isPending}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) onUploadCustom(t, orient, f);
                          e.target.value = '';
                        }}
                      />
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      {updateMutation.isPending && (
        <div className="mt-2 text-[10px] text-slate-400 italic flex items-center gap-1">
          <Loader2 className="w-3 h-3 animate-spin" /> Saving…
        </div>
      )}
      {(updateMutation.isError || uploadError) && (
        <div className="mt-2 text-[10px] text-rose-600">{uploadError || "Couldn't save — try again."}</div>
      )}
    </section>
  );
}
