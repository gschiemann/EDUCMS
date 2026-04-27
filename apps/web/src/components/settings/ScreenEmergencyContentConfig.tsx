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
  usePlaylists,
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
  const { data: playlists, isLoading: playlistsLoading } = usePlaylists();
  const updateMutation = useUpdateScreenEmergencyContent();
  // uploadingType is a composite key `${short}-${orient}` so each
  // sub-row's spinner is independent (uploading the landscape custom
  // asset for "lockdown" doesn't visually freeze the portrait sub-row).
  const [uploadingType, setUploadingType] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const apiKeys = (type: EmergencyTypeRow, orient: Orient) => {
    if (orient === 'landscape') {
      return { playlist: `${type.short}PlaylistId`, asset: `${type.short}AssetUrl` };
    }
    return { playlist: `${type.short}PortraitPlaylistId`, asset: `${type.short}PortraitAssetUrl` };
  };

  const onPickPlaylist = (type: EmergencyTypeRow, orient: Orient, value: string) => {
    const playlistId = value === '' ? null : value;
    const k = apiKeys(type, orient);
    // Picking a playlist clears any custom asset for the same
    // type+orientation so there's only ever one source of truth.
    updateMutation.mutate({
      screenId,
      patch: { [k.playlist]: playlistId, [k.asset]: null } as any,
    });
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
        For each of the 6 emergency types, decide what plays on <span className="font-semibold text-slate-700">this screen only</span> when that type fires.
        Configure <span className="font-semibold">📺 Landscape</span> and <span className="font-semibold">📱 Portrait</span> independently —
        the player picks the one matching the screen's orientation. Within each, pick a <span className="font-semibold">playlist</span>,
        upload a <span className="font-semibold">custom asset</span>, or leave it on <span className="font-semibold">tenant default</span>.
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

              <div className="space-y-1.5">
                {orientations.map(({ orient, icon, label }) => {
                  const k = apiKeys(t, orient);
                  const playlistId = (screen[k.playlist as keyof FloorPlanScreen] as string | null | undefined) ?? '';
                  const assetUrl = (screen[k.asset as keyof FloorPlanScreen] as string | null | undefined) ?? '';
                  const hasCustomAsset = !!assetUrl;
                  const hasPlaylist = !!playlistId;
                  const usingTenantDefault = !hasCustomAsset && !hasPlaylist;
                  const filename = hasCustomAsset ? assetUrl.split('/').pop()?.split('?')[0] : '';
                  const uploadKey = `${t.short}-${orient}`;
                  const isUploadingThis = uploadingType === uploadKey;

                  return (
                    <div key={orient} className="rounded-md bg-white border border-slate-200 p-2">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-xs" aria-hidden>{icon}</span>
                        <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</span>
                        <div className={`ml-auto text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${
                          hasPlaylist     ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' :
                          hasCustomAsset  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                                            'bg-slate-100 text-slate-500 border border-slate-200'
                        }`}>
                          {hasPlaylist ? 'Playlist' : hasCustomAsset ? 'Custom' : 'Default'}
                        </div>
                      </div>

                      {hasCustomAsset && (
                        <div className="flex items-center gap-2 mb-1.5 px-2 py-1 bg-emerald-50 border border-emerald-200 rounded-md">
                          <Upload className="w-3 h-3 text-emerald-600 shrink-0" />
                          <span className="text-[10px] font-mono text-emerald-700 truncate flex-1" title={assetUrl}>{filename || 'custom asset'}</span>
                          <button
                            type="button"
                            onClick={() => onClear(t, orient)}
                            aria-label={`Clear custom ${label} ${t.label} asset`}
                            title="Clear custom asset (revert to tenant default)"
                            className="shrink-0 w-6 h-6 rounded flex items-center justify-center text-emerald-600 hover:bg-emerald-100"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      )}

                      <div className="flex items-center gap-2">
                        <select
                          value={playlistId}
                          disabled={playlistsLoading || updateMutation.isPending}
                          onChange={(e) => onPickPlaylist(t, orient, e.target.value)}
                          className="flex-1 text-[11px] font-medium px-2 py-1.5 rounded-md border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-rose-300 disabled:bg-slate-50 disabled:text-slate-400"
                          aria-label={`${t.label} ${label.toLowerCase()} playlist for this screen`}
                        >
                          <option value="">{usingTenantDefault ? '↳ Use tenant default' : (hasCustomAsset ? '↳ Switch to playlist…' : '↳ Use tenant default')}</option>
                          {(playlists || []).map((p: any) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                        <label
                          className={`shrink-0 inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-md cursor-pointer transition-colors ${
                            isUploadingThis
                              ? 'bg-emerald-100 text-emerald-700 border border-emerald-300'
                              : 'bg-white text-slate-600 border border-slate-200 hover:border-emerald-400 hover:text-emerald-700'
                          }`}
                          title={`Upload a single ${label.toLowerCase()} image, video, or PDF for this screen + ${t.label}`}
                        >
                          {isUploadingThis ? (
                            <><Loader2 className="w-3 h-3 animate-spin" /> Uploading…</>
                          ) : (
                            <><Upload className="w-3 h-3" /> Upload</>
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
                      </div>
                    </div>
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
