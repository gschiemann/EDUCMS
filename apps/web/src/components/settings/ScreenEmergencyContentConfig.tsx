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

import { useEffect, useMemo, useState } from 'react';
import {
  FileText, FileVideo, Image as ImageIcon, Loader2, Upload, Trash2,
  // 2026-05-25 — operator: "these little logos look like emojis,
  // keep our looks and feel even on the little things like this."
  // Replaced 🔒 / 🚪 / ✋ / 🛡️ / 🌪️ / 🚑 / 📺 / 📱 with the same
  // monochrome lucide icons used everywhere else in the chrome.
  Lock, DoorOpen, Hand, ShieldCheck, Tornado, Ambulance, Monitor, Smartphone,
  type LucideIcon,
} from 'lucide-react';
import {
  useUpdateScreenEmergencyContent,
  type FloorPlanScreen,
} from '@/hooks/use-api';
import { useTenantCopy } from '@/hooks/use-tenant-copy';
import { VERTICAL_EMERGENCY_TYPES } from '@cms/api-types';

export interface EmergencyTypeRow {
  short: 'lockdown' | 'evacuate' | 'hold' | 'secure' | 'weather' | 'medical';
  // Landscape variants
  playlistKey: keyof FloorPlanScreen;
  assetKey: keyof FloorPlanScreen;
  // Portrait variants
  portraitPlaylistKey: keyof FloorPlanScreen;
  portraitAssetKey: keyof FloorPlanScreen;
  label: string;
  Icon: LucideIcon;
  description: string;
}

export const EMERGENCY_TYPES: EmergencyTypeRow[] = [
  { short: 'lockdown', label: 'Lockdown', Icon: Lock, description: 'Threat — secure room, lights off',
    playlistKey: 'emergencyLockdownPlaylistId', assetKey: 'emergencyLockdownAssetUrl',
    portraitPlaylistKey: 'emergencyLockdownPortraitPlaylistId', portraitAssetKey: 'emergencyLockdownPortraitAssetUrl' },
  { short: 'evacuate', label: 'Evacuate', Icon: DoorOpen, description: 'Fire / hazard — leave the building',
    playlistKey: 'emergencyEvacuatePlaylistId', assetKey: 'emergencyEvacuateAssetUrl',
    portraitPlaylistKey: 'emergencyEvacuatePortraitPlaylistId', portraitAssetKey: 'emergencyEvacuatePortraitAssetUrl' },
  { short: 'hold',     label: 'Hold',     Icon: Hand, description: 'Clear hallways, stay in current room',
    playlistKey: 'emergencyHoldPlaylistId', assetKey: 'emergencyHoldAssetUrl',
    portraitPlaylistKey: 'emergencyHoldPortraitPlaylistId', portraitAssetKey: 'emergencyHoldPortraitAssetUrl' },
  { short: 'secure',   label: 'Secure',   Icon: ShieldCheck, description: 'Outside threat — close perimeter, business as usual inside',
    playlistKey: 'emergencySecurePlaylistId', assetKey: 'emergencySecureAssetUrl',
    portraitPlaylistKey: 'emergencySecurePortraitPlaylistId', portraitAssetKey: 'emergencySecurePortraitAssetUrl' },
  { short: 'weather',  label: 'Weather',  Icon: Tornado, description: 'Severe storm / tornado — interior safe spot',
    playlistKey: 'emergencyWeatherPlaylistId', assetKey: 'emergencyWeatherAssetUrl',
    portraitPlaylistKey: 'emergencyWeatherPortraitPlaylistId', portraitAssetKey: 'emergencyWeatherPortraitAssetUrl' },
  { short: 'medical',  label: 'Medical',  Icon: Ambulance, description: 'Medical event — clear the area',
    playlistKey: 'emergencyMedicalPlaylistId', assetKey: 'emergencyMedicalAssetUrl',
    portraitPlaylistKey: 'emergencyMedicalPortraitPlaylistId', portraitAssetKey: 'emergencyMedicalPortraitAssetUrl' },
];

type Orient = 'landscape' | 'portrait';

function getAssetPreviewKind(url: string): 'image' | 'video' | 'pdf' | 'file' {
  const clean = url.split('?')[0].split('#')[0].toLowerCase();
  if (/\.(png|jpe?g|webp|gif|bmp|svg)$/.test(clean)) return 'image';
  if (/\.(mp4|webm|mov|m4v)$/.test(clean)) return 'video';
  if (/\.pdf$/.test(clean)) return 'pdf';
  return 'file';
}

function getAssetFilename(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname.split('/').filter(Boolean).pop() || 'custom asset';
  } catch {
    return url.split('/').pop()?.split('?')[0] || 'custom asset';
  }
}

export function ScreenEmergencyContentConfig({
  screenId,
  screen,
}: {
  screenId: string;
  screen: FloorPlanScreen;
}) {
  const updateMutation = useUpdateScreenEmergencyContent();
  // 2026-05-03 — vertical-aware emergency type filtering. K12 keeps
  // the full panic set (lockdown / evacuate / hold / secure / weather
  // / medical). Non-K12 verticals only show the types that make sense
  // for them per VERTICAL_EMERGENCY_TYPES — a gym / retail store
  // doesn't have "hold in current room" or "secure perimeter"
  // operationally.
  const tenantCopy = useTenantCopy();
  const allowedTypes = VERTICAL_EMERGENCY_TYPES[tenantCopy.vertical];
  const filteredEmergencyTypes = EMERGENCY_TYPES.filter((t) =>
    (allowedTypes as readonly string[]).includes(t.short),
  );
  // uploadingType is a composite key `${short}-${orient}` so each
  // upload spot's spinner is independent.
  const [uploadingType, setUploadingType] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [localScreenPatch, setLocalScreenPatch] = useState<Partial<FloorPlanScreen>>({});

  useEffect(() => {
    setLocalScreenPatch({});
    setUploadError(null);
  }, [screenId]);

  const displayScreen = useMemo(
    () => ({ ...screen, ...localScreenPatch }) as FloorPlanScreen,
    [screen, localScreenPatch],
  );

  const apiKeys = (type: EmergencyTypeRow, orient: Orient) => {
    if (orient === 'landscape') {
      return { playlist: `${type.short}PlaylistId`, asset: `${type.short}AssetUrl` };
    }
    return { playlist: `${type.short}PortraitPlaylistId`, asset: `${type.short}PortraitAssetUrl` };
  };

  const screenKeys = (type: EmergencyTypeRow, orient: Orient) => {
    if (orient === 'landscape') {
      return { playlist: type.playlistKey, asset: type.assetKey };
    }
    return { playlist: type.portraitPlaylistKey, asset: type.portraitAssetKey };
  };

  const onUploadCustom = async (type: EmergencyTypeRow, orient: Orient, file: File) => {
    setUploadError(null);
    // Block .mov / .avi BEFORE the upload starts — emergency content
    // is the worst place to discover a format problem (operator was
    // staging a lockdown asset and won't notice the silent player-side
    // playback fail until a drill or a real incident). Same allowlist
    // as the asset library; same friendly error.
    const lowerName = (file.name || '').toLowerCase();
    const lowerType = (file.type || '').toLowerCase();
    if (lowerName.endsWith('.mov') || lowerType === 'video/quicktime') {
      setUploadError("QuickTime .mov isn't supported — export as MP4 (QuickTime Player → Export As → 1080p) and re-upload.");
      return;
    }
    if (lowerName.endsWith('.avi') || lowerType === 'video/x-msvideo') {
      setUploadError("AVI isn't supported — convert to MP4 and re-upload.");
      return;
    }
    setUploadingType(`${type.short}-${orient}`);
    const k = apiKeys(type, orient);
    const screenK = screenKeys(type, orient);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { useUIStore } = await import('@/store/ui-store');
      const { API_URL } = await import('@/lib/api-url');
      const token = useUIStore.getState().token;
      const res = await fetch(`${API_URL}/assets/emergency-upload`, {
        method: 'POST',
        body: fd,
        credentials: 'include',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) {
        // Pull the friendly error string out of the API response if it
        // came back as JSON ({ message: "..." }) — the assertUploadIntent
        // / multer fileFilter paths return actionable text we want to
        // surface verbatim instead of a generic "Upload failed (415)".
        let detail = `Upload failed (${res.status})`;
        try {
          const payload = await res.json();
          if (payload?.message) detail = payload.message;
          else if (payload?.error) detail = payload.error;
        } catch { /* fall back to generic status */ }
        throw new Error(detail);
      }
      const uploaded = await res.json();
      const url =
        uploaded?.url ||
        uploaded?.fileUrl ||
        uploaded?.asset?.fileUrl ||
        uploaded?.asset?.url;
      if (!url || typeof url !== 'string') {
        throw new Error('Upload completed, but the server did not return a playable file URL.');
      }
      // Setting a custom asset clears any playlist override for the
      // same (type, orientation) — single source of truth.
      setLocalScreenPatch((prev) => ({
        ...prev,
        [screenK.asset]: url,
        [screenK.playlist]: null,
      }));
      await updateMutation.mutateAsync({
        screenId,
        patch: { [k.asset]: url, [k.playlist]: null } as any,
      });
    } catch (err: any) {
      setLocalScreenPatch((prev) => ({
        ...prev,
        [screenK.asset]: (screen[screenK.asset] as any) ?? null,
        [screenK.playlist]: (screen[screenK.playlist] as any) ?? null,
      }));
      setUploadError(err?.message || 'Upload failed — try a smaller file');
    } finally {
      setUploadingType(null);
    }
  };

  const onClear = async (type: EmergencyTypeRow, orient: Orient) => {
    setUploadError(null);
    const k = apiKeys(type, orient);
    const screenK = screenKeys(type, orient);
    setLocalScreenPatch((prev) => ({
      ...prev,
      [screenK.playlist]: null,
      [screenK.asset]: null,
    }));
    try {
      await updateMutation.mutateAsync({
        screenId,
        patch: { [k.playlist]: null, [k.asset]: null } as any,
      });
    } catch (err: any) {
      setLocalScreenPatch((prev) => ({
        ...prev,
        [screenK.playlist]: (screen[screenK.playlist] as any) ?? null,
        [screenK.asset]: (screen[screenK.asset] as any) ?? null,
      }));
      setUploadError(err?.message || "Couldn't clear asset");
    }
  };

  return (
    <section>
      <p className="text-[11px] text-slate-500 leading-relaxed mb-3 flex flex-wrap items-center gap-1">
        <span>Upload the content that plays on <span className="font-semibold text-slate-700">this screen only</span> for each emergency type.</span>
        <span className="inline-flex items-center gap-1 font-semibold text-slate-700">
          <Monitor className="w-3.5 h-3.5" /> Landscape
        </span>
        <span>and</span>
        <span className="inline-flex items-center gap-1 font-semibold text-slate-700">
          <Smartphone className="w-3.5 h-3.5" /> Portrait
        </span>
        <span>are independent — the player picks the one matching the screen's orientation. Empty slots fall back to the tenant default.</span>
      </p>
      <div className="space-y-2.5">
        {filteredEmergencyTypes.map((t) => {
          const orientations: { orient: Orient; Icon: LucideIcon; label: string }[] = [
            { orient: 'landscape', Icon: Monitor,    label: 'Landscape' },
            { orient: 'portrait',  Icon: Smartphone, label: 'Portrait' },
          ];

          return (
            <div key={t.short} className="rounded-lg border border-slate-200 p-2.5 bg-slate-50/60">
              <div className="flex items-center gap-2 mb-2">
                <div className="shrink-0 w-9 h-9 rounded-lg bg-rose-50 border border-rose-200 flex items-center justify-center shadow-sm" title={t.description}>
                  <t.Icon className="w-4 h-4 text-rose-600" aria-hidden />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-bold text-slate-700">{t.label}</div>
                  <div className="text-[10px] text-slate-400 truncate" title={t.description}>{t.description}</div>
                </div>
              </div>

              <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2">
                {orientations.map(({ orient, Icon: OrientIcon, label }) => {
                  const k = screenKeys(t, orient);
                  const assetUrl = (displayScreen[k.asset] as string | null | undefined) ?? '';
                  const hasCustomAsset = !!assetUrl;
                  const filename = hasCustomAsset ? getAssetFilename(assetUrl) : '';
                  const previewKind = hasCustomAsset ? getAssetPreviewKind(assetUrl) : 'file';
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
                      onDragOver={(e) => {
                        e.preventDefault();
                        if (!uploadingType && !updateMutation.isPending) {
                          e.dataTransfer.dropEffect = 'copy';
                        }
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (uploadingType || updateMutation.isPending) return;
                        const f = e.dataTransfer.files?.[0];
                        if (f) onUploadCustom(t, orient, f);
                      }}
                    >
                      <div className="flex items-center justify-center gap-1.5 mb-1.5">
                        <OrientIcon className="w-3.5 h-3.5 text-slate-500" aria-hidden />
                        <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</span>
                      </div>
                      {isUploadingThis ? (
                        <div className="flex items-center justify-center gap-1.5 text-[11px] font-bold text-emerald-700">
                          <Loader2 className="w-3 h-3 animate-spin" /> Uploading…
                        </div>
                      ) : hasCustomAsset ? (
                        <>
                          <div className="mb-2 overflow-hidden rounded-md border border-emerald-200 bg-white aspect-video flex items-center justify-center">
                            {previewKind === 'image' ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={assetUrl}
                                alt=""
                                className="w-full h-full object-cover pointer-events-none"
                                loading="lazy"
                              />
                            ) : previewKind === 'video' ? (
                              <video
                                src={assetUrl}
                                className="w-full h-full object-cover pointer-events-none"
                                muted
                                playsInline
                                preload="metadata"
                              />
                            ) : previewKind === 'pdf' ? (
                              <FileText className="w-7 h-7 text-emerald-600" />
                            ) : (
                              <ImageIcon className="w-7 h-7 text-emerald-600" />
                            )}
                            {previewKind === 'video' && (
                              <FileVideo className="absolute left-4 top-10 w-4 h-4 text-white drop-shadow" />
                            )}
                          </div>
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
                        // Explicit format list — `video/*` would let the
                        // OS picker show .mov / .avi which the player
                        // can't play back. Keeping the allowlist
                        // narrow saves the operator a round-trip
                        // discovering it's unsupported. Mirrors the
                        // assets-library accept list.
                        accept=".jpg,.jpeg,.png,.webp,.gif,.svg,.bmp,.mp4,.m4v,.webm,.mp3,.ogg,.wav,.m4a,.pdf"
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
