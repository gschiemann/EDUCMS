"use client";

/**
 * PlaylistCreateWizard — operator's primary creation flow.
 *
 * Replaces the legacy "mid-page card with two tiles" pattern. The whole
 * playlist setup happens in one centered modal dialog with 5 well-marked
 * steps:
 *
 *   1. Name + Type    ("Media Playlist" vs "From Template")
 *   2. Pick content   (assets to drop in, OR a single template)
 *   3. Pick screens   (multi-select; can skip)
 *   4. Publish        (Activate immediately OR pick a schedule window)
 *   5. Review + Create
 *
 * Operator quote that drove the spec:
 *   "i dont like how hitting new playlist just pops open a menu in the
 *    middle of the playlist dashboard, it should open a window inside
 *    the dashboard area where i do all of my playlist configuration,
 *    so i click new playlist popup comes up, i name it, i pick asset
 *    or template, then it takes me to select the media, then it take
 *    me to select the screen or screens, then it take me to the
 *    publishing section....just flows through so clean it makes sense
 *    to everyone"
 *
 * UX notes:
 *   - Step indicator at the top so the operator always knows where
 *     they are and what's next. Click an already-visited dot to jump
 *     back without losing data.
 *   - Back/Next in the footer; final step swaps Next for "Create
 *     Playlist" with a loading state.
 *   - Escape closes the wizard. If the operator has made progress
 *     (non-empty name or a content/screen selection) we confirm
 *     before nuking.
 *   - Fade + scale animation on mount (~150ms). Subtle, not flashy.
 *   - No `inset-0` Tailwind / no flex `gap-*` — Chromium 83 safe
 *     (NovaStar Taurus rule, CLAUDE.md #10). Uses explicit margins
 *     and longhand top/right/bottom/left.
 *
 * Wiring:
 *   - createPlaylist  : POST /playlists       { name, templateId? }
 *   - saveItems       : PUT  /playlists/:id/items (for Media type)
 *   - createSchedule  : POST /schedules       (one per screen, or
 *                       one tenant-wide row if no screens picked)
 *
 * Public API:
 *   <PlaylistCreateWizard
 *     open={boolean}
 *     onClose={() => void}
 *     onCreated={(playlist: {id, name, templateId?: string|null}) => void}
 *   />
 *
 * onCreated fires AFTER the playlist row exists and all items +
 * schedules have been written. The parent typically uses it to
 * navigate into the new playlist's detail view.
 */

import {
  useState,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
} from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Play,
  LayoutTemplate,
  Check,
  Search,
  Image as ImageIcon,
  Video,
  Music,
  Globe,
  File as FileIcon,
  FileText,
  Folder,
  FolderOpen,
  Home,
  Monitor,
  Wifi,
  WifiOff,
  Loader2,
  Calendar,
  Sparkles,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Layers,
} from 'lucide-react';
import {
  useAssets,
  useAssetFolders,
  useTemplates,
  useScreens,
  useScreenGroups,
  useCreatePlaylist,
  useReorderPlaylistItems,
  useCreateSchedule,
} from '@/hooks/use-api';
import { useQueryClient } from '@tanstack/react-query';
import { ScaledTemplateThumbnail } from '@/components/templates/ScaledTemplateThumbnail';
import { PdfHoverThumb } from '@/components/assets/PdfHoverThumb';
// 2026-05-26 — operator: "keep all the same editing components we
// have in the main area like dragging and dropping in order".
// Same dnd-kit primitives the main playlist editor uses, so a drag
// in the wizard feels identical to a drag in the editor.
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { CSS as DndCss } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { appConfirm, appAlert } from '@/components/ui/app-dialog';

// ─── Shared constants ──────────────────────────────────────────────────

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const apiBase = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1').replace('/api/v1', '');

type PlaylistKind = 'media' | 'template';

// 2026-05-26 — `items` is what the wizard JUST wrote to the server in
// `PUT /playlists/:id/items`. The parent's editor view reads from this
// to render the dropped-into-editor state IMMEDIATELY without waiting
// for a refetch round-trip. Operator: "when i hit create playlist, it
// showed blank, its saving it but not refreshing the window."
export interface PlaylistCreatedItem {
  id: string;
  assetId: string;
  durationMs: number;
  sequenceOrder: number;
  asset: {
    id: string;
    fileUrl: string;
    mimeType: string;
    originalName: string;
  };
}

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (playlist: {
    id: string;
    name: string;
    templateId?: string | null;
    items?: PlaylistCreatedItem[];
  }) => void;
}

// ─── Small helpers ─────────────────────────────────────────────────────

function assetThumbUrl(asset: any): string | null {
  if (!asset) return null;
  if (asset.mimeType === 'text/html' && asset.fileUrl) {
    return `https://s.wordpress.com/mshots/v1/${encodeURIComponent(asset.fileUrl)}?w=640&h=360`;
  }
  if (!asset.mimeType?.startsWith('image/') && !asset.mimeType?.startsWith('video/')) {
    return null;
  }
  return asset.fileUrl?.startsWith('http') ? asset.fileUrl : `${apiBase}${asset.fileUrl}`;
}

function mimeIcon(mimeType?: string) {
  if (!mimeType) return FileIcon;
  if (mimeType.startsWith('image/')) return ImageIcon;
  if (mimeType.startsWith('video/')) return Video;
  if (mimeType.startsWith('audio/')) return Music;
  if (mimeType === 'text/html') return Globe;
  return FileIcon;
}

function MiniAssetThumb({ asset }: { asset: any }) {
  // 2026-05-26 round 4 — operator screenshot showed Chrome's PDFium
  // floating toolbar leaking through the wizard's PDF tile despite
  // the masks in PdfHoverThumb. The wizard tiles are tiny
  // (~150×85px aspect-video) so Chrome's toolbar lands inside the
  // visible window AND blocks the checkbox click target. Different
  // problem than the asset library where tiles are big enough for
  // the masks to catch the toolbar.
  //
  // Decision: in the wizard's tight picker grid, render PDFs as a
  // static rose-gradient + FileText icon. No iframe = no toolbar
  // possible. Operators can preview the actual page content from
  // the asset library (where tiles are bigger + masks work) or
  // from the asset detail panel. Picking a PDF for a playlist
  // doesn't need a full first-page render — name + PDF badge is
  // enough context to identify it.
  if (asset?.mimeType === 'application/pdf' || (asset?.fileUrl || '').toLowerCase().endsWith('.pdf')) {
    return (
      <div className="w-full h-full relative overflow-hidden flex flex-col items-center justify-center bg-gradient-to-br from-rose-50 to-rose-100">
        <FileText className="w-7 h-7 text-rose-500" aria-hidden="true" />
        <span className="mt-1 text-[10px] font-bold text-rose-700/80 uppercase tracking-wider">
          PDF
        </span>
      </div>
    );
  }
  const url = assetThumbUrl(asset);
  if (!url) {
    const Icon = mimeIcon(asset?.mimeType);
    return (
      <div className="w-full h-full flex items-center justify-center bg-slate-100">
        <Icon className="w-8 h-8 text-slate-300" />
      </div>
    );
  }
  if (asset?.mimeType?.startsWith('video/')) {
    return (
      // eslint-disable-next-line jsx-a11y/media-has-caption
      <video
        src={url}
        muted
        playsInline
        preload="metadata"
        // 2026-05-26 — #t=0.5 hash makes the first-frame poster paint
        // in every browser (Safari + Firefox honor the Media Fragments
        // URI fragment, Chrome already showed it via the onLoadedMetadata
        // currentTime hack). Belt + suspenders.
        className="w-full h-full object-cover"
        onLoadedMetadata={(e) => {
          try {
            (e.currentTarget as HTMLVideoElement).currentTime = 0.1;
          } catch {
            /* noop */
          }
        }}
      />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" className="w-full h-full object-cover" />
  );
}

// ─── Step indicator ────────────────────────────────────────────────────

const STEP_LABELS = [
  'Name & type',
  'Pick content',
  'Pick screens',
  'Publishing',
  'Review',
] as const;

function StepIndicator({
  step,
  highestVisited,
  onJump,
}: {
  step: number;
  highestVisited: number;
  onJump: (n: number) => void;
}) {
  return (
    <div className="px-6 pt-5 pb-4 border-b border-slate-100">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">
          Step {step} of 5
        </p>
        <p className="text-sm font-semibold text-slate-700">{STEP_LABELS[step - 1]}</p>
      </div>
      <div className="flex items-center">
        {STEP_LABELS.map((label, i) => {
          const n = i + 1;
          const visited = n <= highestVisited;
          const current = n === step;
          const passed = n < step;
          // Dot
          const dot = (
            <button
              key={`dot-${n}`}
              type="button"
              onClick={() => visited && onJump(n)}
              disabled={!visited}
              aria-label={`Go to step ${n}: ${label}`}
              aria-current={current ? 'step' : undefined}
              className={`relative shrink-0 w-7 h-7 rounded-full flex items-center justify-center transition-all ${
                current
                  ? 'bg-indigo-600 ring-4 ring-indigo-100 text-white'
                  : passed
                    ? 'bg-indigo-600 text-white hover:bg-indigo-700 cursor-pointer'
                    : visited
                      ? 'bg-indigo-100 text-indigo-600 hover:bg-indigo-200 cursor-pointer'
                      : 'bg-slate-100 text-slate-300 cursor-not-allowed'
              }`}
              style={{ fontSize: 11, fontWeight: 700 }}
            >
              {passed ? <Check className="w-3.5 h-3.5" /> : n}
            </button>
          );
          if (i === STEP_LABELS.length - 1) {
            return dot;
          }
          // Dot + connector
          return (
            <div key={`seg-${n}`} className="flex items-center" style={{ flex: 1 }}>
              {dot}
              <div
                aria-hidden
                className="flex-1 h-0.5 mx-1.5 transition-colors"
                style={{
                  backgroundColor: n < step ? 'rgb(79 70 229)' : 'rgb(226 232 240)',
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────

export function PlaylistCreateWizard({ open, onClose, onCreated }: Props) {
  // Wizard state
  const [step, setStep] = useState<number>(1);
  const [highestVisited, setHighestVisited] = useState<number>(1);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<PlaylistKind | null>(null);

  // Step 2 — content
  // 2026-05-26 — operator: "i didnt see where i could update the order
  // of the content and set the timing of each asset in the carousel,
  // that need to be part of the wizard." selectedAssetIds was a Set
  // — no order, no per-item duration. Replaced with an ordered array
  // of { assetId, durationMs }. A derived Set drives the picker's
  // selection check; the array drives the new "Selected media" panel
  // below the picker grid (reorder + duration controls + remove).
  type WizardItem = { assetId: string; durationMs: number };
  const [selectedAssetItems, setSelectedAssetItems] = useState<WizardItem[]>([]);
  const selectedAssetIds = useMemo(
    () => new Set(selectedAssetItems.map((i) => i.assetId)),
    [selectedAssetItems],
  );
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [assetSearch, setAssetSearch] = useState('');
  const [assetFilter, setAssetFilter] = useState<'all' | 'images' | 'videos' | 'audio' | 'urls'>('all');
  // 2026-05-26 — operator: "when i get to step two you need to show
  // the folders as well so i can select a folder if i want to find my
  // content." Tracks the folder the operator is currently browsing.
  // null = root (top-level assets + top-level folders).
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [templateFilter, setTemplateFilter] = useState<'all' | 'custom' | 'system'>('all');
  const [templateSearch, setTemplateSearch] = useState('');

  // Step 3 — screens
  const [selectedScreenIds, setSelectedScreenIds] = useState<Set<string>>(new Set());
  const [screenSearch, setScreenSearch] = useState('');

  // Step 4 — publish
  const [activateImmediately, setActivateImmediately] = useState<boolean>(true);
  const [schedStartDate, setSchedStartDate] = useState<string>('');
  const [schedEndDate, setSchedEndDate] = useState<string>('');
  const [schedTimeStart, setSchedTimeStart] = useState<string>('08:00');
  const [schedTimeEnd, setSchedTimeEnd] = useState<string>('15:00');
  const [schedDays, setSchedDays] = useState<string[]>(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);

  // Submit lifecycle
  const [creating, setCreating] = useState(false);
  const [enterAnim, setEnterAnim] = useState(false);

  // Hooks
  const { data: assets } = useAssets();
  const { data: folders } = useAssetFolders();
  const { data: templates } = useTemplates();
  const { data: screens } = useScreens();
  const { data: screenGroups } = useScreenGroups();
  const createPlaylist = useCreatePlaylist();
  const saveItems = useReorderPlaylistItems();
  const createSchedule = useCreateSchedule();
  const qc = useQueryClient();

  const nameInputRef = useRef<HTMLInputElement>(null);

  // Reset state whenever the modal opens — operator expects a clean slate.
  useEffect(() => {
    if (!open) return;
    setStep(1);
    setHighestVisited(1);
    setName('');
    setKind(null);
    setSelectedAssetItems([]);
    setSelectedTemplateId(null);
    setAssetSearch('');
    setAssetFilter('all');
    setCurrentFolderId(null);
    setTemplateFilter('all');
    setTemplateSearch('');
    setSelectedScreenIds(new Set());
    setScreenSearch('');
    setActivateImmediately(true);
    setSchedStartDate('');
    setSchedEndDate('');
    setSchedTimeStart('08:00');
    setSchedTimeEnd('15:00');
    setSchedDays(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
    setCreating(false);
    // Trigger enter animation on next frame.
    setEnterAnim(false);
    requestAnimationFrame(() => setEnterAnim(true));
  }, [open]);

  // Focus the name field on Step 1
  useEffect(() => {
    if (!open) return;
    if (step === 1) {
      // Give the modal a tick to mount.
      const id = setTimeout(() => nameInputRef.current?.focus(), 50);
      return () => clearTimeout(id);
    }
  }, [open, step]);

  // Did the operator type something / make any selection? Used to gate
  // the "confirm before nuking" prompt on close.
  const hasProgress = useMemo(() => {
    if (name.trim()) return true;
    if (kind) return true;
    if (selectedAssetItems.length > 0) return true;
    if (selectedTemplateId) return true;
    if (selectedScreenIds.size > 0) return true;
    return false;
  }, [name, kind, selectedAssetItems, selectedTemplateId, selectedScreenIds]);

  const tryClose = async () => {
    if (creating) return; // can't bail mid-creation
    if (!hasProgress) {
      onClose();
      return;
    }
    const ok = await appConfirm({
      title: 'Discard new playlist?',
      message: 'Your selections so far won’t be saved.',
      confirmLabel: 'Discard',
      cancelLabel: 'Keep editing',
      tone: 'warn',
    });
    if (ok) onClose();
  };

  // Escape closes the wizard.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        void tryClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, hasProgress, creating]);

  if (!open) return null;

  // ─── Derived data ──────────────────────────────────────────────────

  const filteredAssets = (assets || []).filter((a: any) => {
    // 2026-05-26 — when the operator picks a folder we scope assets to
    // that folder. When they search we span ALL folders so they can
    // find content without first finding the right folder. Root level
    // (currentFolderId === null) shows assets with `folderId === null`
    // OR undefined (legacy rows).
    if (!assetSearch) {
      const aFolder = a.folderId ?? null;
      if (aFolder !== currentFolderId) return false;
    }
    if (assetFilter === 'images' && !a.mimeType?.startsWith('image/')) return false;
    if (assetFilter === 'videos' && !a.mimeType?.startsWith('video/')) return false;
    if (assetFilter === 'audio' && !a.mimeType?.startsWith('audio/')) return false;
    if (assetFilter === 'urls' && a.mimeType !== 'text/html') return false;
    if (assetSearch) {
      const needle = assetSearch.toLowerCase();
      const hay = `${a.originalName || ''} ${a.title || ''}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });

  // 2026-05-26 — folders visible at the current level. Used by Step2Media
  // to render folder tiles above the asset grid. Top-level when
  // currentFolderId is null; otherwise children of the open folder.
  const visibleFolders = (folders || []).filter((f: any) => {
    if (assetSearch) return false; // search mode flattens folders
    return (f.parentId ?? null) === currentFolderId;
  });

  // Breadcrumb chain from root → currentFolderId. Used in Step2Media
  // header so the operator always knows where they are + can hop back.
  const folderBreadcrumb: Array<{ id: string | null; name: string }> = (() => {
    const out: Array<{ id: string | null; name: string }> = [];
    let cursor: any = currentFolderId
      ? (folders || []).find((x: any) => x.id === currentFolderId)
      : null;
    while (cursor) {
      out.unshift({ id: cursor.id, name: cursor.name || 'Folder' });
      cursor = cursor.parentId
        ? (folders || []).find((x: any) => x.id === cursor.parentId)
        : null;
    }
    return out;
  })();

  const visibleTemplates = (templates || []).filter((t: any) => {
    if (templateFilter === 'custom' && t.isSystem) return false;
    if (templateFilter === 'system' && !t.isSystem) return false;
    if (templateSearch) {
      const needle = templateSearch.toLowerCase();
      const hay = `${t.name || ''} ${t.description || ''}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });

  const filteredScreens = (screens || []).filter((s: any) => {
    if (!screenSearch) return true;
    const needle = screenSearch.toLowerCase();
    const hay = `${s.name || ''} ${s.id}`.toLowerCase();
    return hay.includes(needle);
  });

  const selectedTemplate = (templates || []).find((t: any) => t.id === selectedTemplateId);

  // ─── Step navigation gates ─────────────────────────────────────────

  const canAdvanceFromStep1 = name.trim().length > 0 && kind !== null;
  const canAdvanceFromStep2 = kind === 'media'
    ? selectedAssetItems.length > 0
    : selectedTemplateId !== null;
  // Step 3 always advanceable — "Skip" is a valid choice.
  // Step 4 always advanceable.

  const goNext = () => {
    setStep((s) => {
      const next = Math.min(5, s + 1);
      setHighestVisited((h) => Math.max(h, next));
      return next;
    });
  };
  const goBack = () => setStep((s) => Math.max(1, s - 1));
  const jumpTo = (n: number) => {
    if (n <= highestVisited) setStep(n);
  };

  // ─── Step toggles ──────────────────────────────────────────────────

  // 2026-05-26 — toggleAsset now appends to / removes from the ordered
  // items array. Default per-item duration: 30s for video/audio, 10s
  // for everything else (same defaults the editor uses post-create).
  // 2026-05-26 round 2 — auto-detect ACTUAL video duration via a
  // hidden <video preload="metadata"> probe on add. Operator: "auto
  // timing for videos". When the metadata loads (typically <500ms
  // for cached + small clips), update the row's durationMs in place
  // so the playlist plays the full video, not an arbitrary 30s clip.
  // Fallback to 30s default if probe fails (CORS / offline / not a
  // real video file).
  // 2026-05-27 — NOT useCallback. These three helpers live BELOW the
  // `if (!open) return null;` guard at line 472. If they were hooks,
  // they'd flip the hook count between closed (return-null) and open
  // (full render) renders → minified React error #310 ("Rendered more
  // hooks than during the previous render") → caught by [schoolId]/
  // error.tsx → operator sees "This page couldn't load" the moment
  // they click "New Playlist". setSelectedAssetItems is already a
  // stable state setter, so useCallback bought us nothing structural
  // here — drop the wrappers to keep the hook count constant across
  // open=false/open=true renders.
  const probeVideoDuration = (assetId: string, src: string) => {
    if (typeof document === 'undefined') return;
    try {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.muted = true;
      v.crossOrigin = 'anonymous';
      const onMeta = () => {
        v.removeEventListener('loadedmetadata', onMeta);
        v.removeEventListener('error', onErr);
        const dur = v.duration;
        if (isFinite(dur) && dur > 0.1) {
          setSelectedAssetItems((prev) =>
            prev.map((i) =>
              i.assetId === assetId && i.durationMs === 30000
                ? // Only overwrite if still at the default 30s — if
                  // the operator already typed a custom value, respect it.
                  { ...i, durationMs: Math.round(dur * 1000) }
                : i,
            ),
          );
        }
      };
      const onErr = () => {
        v.removeEventListener('loadedmetadata', onMeta);
        v.removeEventListener('error', onErr);
        // Default 30s already set — nothing more to do.
      };
      v.addEventListener('loadedmetadata', onMeta);
      v.addEventListener('error', onErr);
      v.src = src;
    } catch {
      /* noop */
    }
  };

  const toggleAsset = (id: string) =>
    setSelectedAssetItems((prev) => {
      const existing = prev.findIndex((i) => i.assetId === id);
      if (existing >= 0) {
        return prev.filter((_, i) => i !== existing);
      }
      const a = (assets || []).find((x: any) => x.id === id);
      const isVideo = a?.mimeType?.startsWith('video/');
      const isAV = isVideo || a?.mimeType?.startsWith('audio/');
      // Fire the metadata probe for videos. State update lands later
      // when loadedmetadata fires.
      if (isVideo && a?.fileUrl) {
        const src = a.fileUrl.startsWith('http') ? a.fileUrl : `${apiBase}${a.fileUrl}`;
        // Tick out so the setState completes before probe writes.
        setTimeout(() => probeVideoDuration(id, src), 0);
      }
      return [...prev, { assetId: id, durationMs: isAV ? 30000 : 10000 }];
    });

  const moveAssetItem = (assetId: string, dir: -1 | 1) =>
    setSelectedAssetItems((prev) => {
      const idx = prev.findIndex((i) => i.assetId === assetId);
      if (idx < 0) return prev;
      const target = idx + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = prev.slice();
      const tmp = next[idx];
      next[idx] = next[target];
      next[target] = tmp;
      return next;
    });

  // 2026-05-26 — dnd-kit reorder handler. Same drag-end pattern the
  // main editor uses (arrayMove on the active vs. over ids).
  // 2026-05-27 — NOT useCallback. See probeVideoDuration above for
  // the hook-count rationale (lives below the early return).
  const reorderAssets = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setSelectedAssetItems((prev) => {
      const oldIdx = prev.findIndex((i) => i.assetId === String(active.id));
      const newIdx = prev.findIndex((i) => i.assetId === String(over.id));
      if (oldIdx < 0 || newIdx < 0) return prev;
      return arrayMove(prev, oldIdx, newIdx);
    });
  };

  const removeAssetItem = (assetId: string) =>
    setSelectedAssetItems((prev) => prev.filter((i) => i.assetId !== assetId));

  const setAssetDuration = (assetId: string, seconds: number) =>
    setSelectedAssetItems((prev) =>
      prev.map((i) =>
        i.assetId === assetId
          ? // clamp to 1s..600s — anything below 1s flickers, anything
            // above 600s is almost certainly a typo and the editor caps
            // there too. Default to 10s if NaN sneaks through.
            { ...i, durationMs: Math.max(1, Math.min(600, isFinite(seconds) ? seconds : 10)) * 1000 }
          : i,
      ),
    );

  // 2026-05-26 — bulk "set all to N seconds". Operator: "applying
  // the seconds to everything".
  // 2026-05-27 — NOT useCallback. See probeVideoDuration above for
  // the hook-count rationale (lives below the early return).
  const setAllDurations = (seconds: number) => {
    const clamped = Math.max(1, Math.min(600, isFinite(seconds) ? seconds : 10));
    setSelectedAssetItems((prev) =>
      prev.map((i) => ({ ...i, durationMs: clamped * 1000 })),
    );
  };

  const toggleScreen = (id: string) =>
    setSelectedScreenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleDay = (day: string) =>
    setSchedDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]));

  // ─── Create + wire ────────────────────────────────────────────────

  const handleCreate = async () => {
    if (creating) return;
    setCreating(true);
    try {
      // 1. Create the playlist row.
      const body: { name: string; templateId?: string } = { name: name.trim() };
      if (kind === 'template' && selectedTemplateId) {
        body.templateId = selectedTemplateId;
      }
      const created: any = await createPlaylist.mutateAsync(body);
      const playlistId = created?.id;
      if (!playlistId) {
        throw new Error('Playlist created without an id');
      }

      // 2. For Media playlists, push the picked assets into the playlist.
      //    saveItems is the bulk reorder endpoint (PUT /playlists/:id/items)
      //    which is what the legacy editor uses — same code path, fewer
      //    surprises in audit logs.
      //
      // 2026-05-26 — operator now picks the order + per-item duration
      // in Step 2's "Selected media" panel. selectedAssetItems carries
      // both. The items array preserves THAT order (not asset library
      // order) and uses the operator's durations.
      let editorItems: PlaylistCreatedItem[] = [];
      if (kind === 'media' && selectedAssetItems.length > 0) {
        const items = selectedAssetItems.map((sel, i) => {
          const a = (assets || []).find((x: any) => x.id === sel.assetId);
          return {
            assetId: sel.assetId,
            durationMs: sel.durationMs,
            sequenceOrder: i,
            daysOfWeek: null,
            timeStart: null,
            timeEnd: null,
            transitionType: null,
            muted: a?.mimeType?.startsWith('video/') ? true : true,
          };
        });
        await saveItems.mutateAsync({ playlistId, items });
        // Build the parent-shaped items so the editor renders the
        // dropped-into-state instantly. Without this, the wizard's
        // onCreated handed back an empty items[] and the editor went
        // blank until React Query refetched on its own schedule.
        // Operator: "it showed blank, its saving it but not refreshing
        // the window."
        editorItems = selectedAssetItems
          .map((sel, i) => {
            const a = (assets || []).find((x: any) => x.id === sel.assetId);
            if (!a) return null;
            return {
              id: `pending-${i}-${sel.assetId}`,
              assetId: sel.assetId,
              durationMs: sel.durationMs,
              sequenceOrder: i,
              asset: {
                id: a.id,
                fileUrl: a.fileUrl || '',
                mimeType: a.mimeType || '',
                originalName: a.originalName || a.title || 'Untitled',
              },
            };
          })
          .filter((x): x is PlaylistCreatedItem => x !== null);
      }

      // 3. Build schedules.
      //    - If screens are picked: one schedule per screen, isActive based
      //      on the operator's "Activate immediately" toggle.
      //    - If no screens picked: skip schedule creation (operator chose
      //      to assign later from the playlist detail view).
      if (selectedScreenIds.size > 0) {
        const computeStartTime = (): string => {
          if (!schedStartDate) return new Date().toISOString();
          const tod = activateImmediately ? '00:00' : schedTimeStart || '00:00';
          return new Date(`${schedStartDate}T${tod}:00`).toISOString();
        };
        const computeEndTime = (): string | undefined => {
          if (!schedEndDate) return undefined;
          const tod = activateImmediately ? '23:59' : schedTimeEnd || '23:59';
          return new Date(`${schedEndDate}T${tod}:59`).toISOString();
        };
        const schedules = Array.from(selectedScreenIds).map((screenId) => ({
          playlistId,
          screenId,
          startTime: computeStartTime(),
          endTime: computeEndTime(),
          daysOfWeek: !activateImmediately ? schedDays.join(',') : undefined,
          timeStart: !activateImmediately ? schedTimeStart : undefined,
          timeEnd: !activateImmediately ? schedTimeEnd : undefined,
          priority: 0,
          mode: 'replace' as const,
          isActive: activateImmediately,
        }));
        // Run in parallel — schedules are independent, no cross-row deps.
        await Promise.all(schedules.map((s) => createSchedule.mutateAsync(s)));
      }

      // 4. Refresh the playlists dashboard cache + the per-id cache so
      //    the parent page re-renders with the new row. The mutation
      //    hooks already invalidate on success, but we add explicit
      //    refetches here so the dashboard list is up to date the
      //    moment the wizard hands control back to the parent — no
      //    stale "loading…" or "blank list" flash.
      qc.invalidateQueries({ queryKey: ['playlists'] });
      qc.refetchQueries({ queryKey: ['playlists'] });
      qc.invalidateQueries({ queryKey: ['playlists', playlistId] });

      // 5. Hand the operator back to the dashboard with the new playlist
      //    selected — INCLUDING the items just saved. The parent's
      //    handleSelect uses `pl.items` to seed its localItems state;
      //    when items is empty the editor renders blank until React
      //    Query refetches. By passing the items here the editor opens
      //    populated immediately — no flash of empty state.
      onCreated({
        id: playlistId,
        name: created.name || name.trim(),
        templateId: created.templateId ?? null,
        items: editorItems,
      });
      // Don't call onClose() here — onCreated is expected to either
      // dismiss or take over (deep-link into the playlist editor).
    } catch (err: any) {
      setCreating(false);
      await appAlert({
        title: 'Couldn’t create playlist',
        message: err?.message || 'Something went wrong. Try again, or split the steps in the editor.',
        tone: 'danger',
      });
    }
  };

  // ─── Animation styles ──────────────────────────────────────────────

  const scrimStyle: CSSProperties = {
    position: 'fixed',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.4)',
    zIndex: 100,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    overflow: 'hidden',
    opacity: enterAnim ? 1 : 0,
    transition: 'opacity 150ms ease-out',
  };

  const panelStyle: CSSProperties = {
    position: 'relative',
    zIndex: 1,
    width: '100%',
    maxWidth: 800, // ~max-w-3xl
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: 'white',
    borderRadius: 20,
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
    transform: enterAnim ? 'scale(1)' : 'scale(0.96)',
    opacity: enterAnim ? 1 : 0,
    transition: 'opacity 150ms ease-out, transform 150ms ease-out',
  };

  // ─── Footer ────────────────────────────────────────────────────────

  const isLastStep = step === 5;
  // Step 1: Next disabled until name + type picked
  // Step 2: Next disabled until content picked
  // Steps 3/4: always enabled
  const nextDisabled =
    (step === 1 && !canAdvanceFromStep1) ||
    (step === 2 && !canAdvanceFromStep2);

  // ─── Render ────────────────────────────────────────────────────────

  // 2026-05-26 — operator: "new playlist popup doesnt center when the
  // screen isnt maximized". Cause: inline mount + an ancestor with
  // `transform`/`filter`/`backdrop-filter` makes `position: fixed`
  // containing-block-relative to that ancestor instead of the
  // viewport. Standard React modal fix is to portal to document.body
  // so the dialog escapes any DashboardLayout / sidebar transform.
  if (typeof window === 'undefined') return null; // SSR guard
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Create new playlist"
      style={scrimStyle}
      onClick={(e) => {
        if (e.target === e.currentTarget) void tryClose();
      }}
    >
      <div style={panelStyle}>
        {/* Header */}
        <div className="px-6 pt-5 pb-4 flex items-start justify-between border-b border-slate-100">
          <div>
            <h2 className="text-xl font-bold text-slate-900">New Playlist</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              Set up a playlist, the screens it should play on, and when it goes live.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void tryClose()}
            disabled={creating}
            aria-label="Close wizard"
            className="text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg p-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step indicator */}
        <StepIndicator step={step} highestVisited={highestVisited} onJump={jumpTo} />

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 min-h-0">
          {step === 1 && (
            <Step1NameAndType
              name={name}
              setName={setName}
              kind={kind}
              setKind={setKind}
              nameInputRef={nameInputRef}
              onEnter={() => {
                if (canAdvanceFromStep1) goNext();
              }}
            />
          )}
          {step === 2 && kind === 'media' && (
            <Step2Media
              assets={filteredAssets}
              folders={visibleFolders}
              breadcrumb={folderBreadcrumb}
              currentFolderId={currentFolderId}
              onFolderOpen={setCurrentFolderId}
              search={assetSearch}
              setSearch={setAssetSearch}
              filter={assetFilter}
              setFilter={setAssetFilter}
              selectedIds={selectedAssetIds}
              onToggle={toggleAsset}
            />
          )}
          {step === 2 && kind === 'template' && (
            <Step2Template
              templates={visibleTemplates}
              search={templateSearch}
              setSearch={setTemplateSearch}
              filter={templateFilter}
              setFilter={setTemplateFilter}
              selectedId={selectedTemplateId}
              onSelect={setSelectedTemplateId}
              onName={(tName: string) => {
                if (!name.trim()) setName(tName);
              }}
            />
          )}
          {step === 3 && (
            <Step3Screens
              screens={filteredScreens}
              total={(screens || []).length}
              groups={screenGroups || []}
              search={screenSearch}
              setSearch={setScreenSearch}
              selectedIds={selectedScreenIds}
              onToggle={toggleScreen}
              onPickGroup={(group: any) => {
                const ids: string[] = (group.screens || [])
                  .map((s: any) => s.id)
                  .filter(Boolean);
                if (!ids.length) return;
                // If every screen in the group is already selected → toggle off.
                // Otherwise → select all members. Operator gets one-click "all".
                setSelectedScreenIds((prev) => {
                  const allSelected = ids.every((id) => prev.has(id));
                  const next = new Set(prev);
                  if (allSelected) ids.forEach((id) => next.delete(id));
                  else ids.forEach((id) => next.add(id));
                  return next;
                });
              }}
              onSkip={() => {
                setSelectedScreenIds(new Set());
                goNext();
              }}
            />
          )}
          {step === 4 && (
            <Step4Publish
              activate={activateImmediately}
              setActivate={setActivateImmediately}
              startDate={schedStartDate}
              setStartDate={setSchedStartDate}
              endDate={schedEndDate}
              setEndDate={setSchedEndDate}
              timeStart={schedTimeStart}
              setTimeStart={setSchedTimeStart}
              timeEnd={schedTimeEnd}
              setTimeEnd={setSchedTimeEnd}
              days={schedDays}
              toggleDay={toggleDay}
              screensPicked={selectedScreenIds.size}
            />
          )}
          {step === 5 && (
            <Step5Review
              name={name.trim()}
              kind={kind!}
              itemCount={kind === 'media' ? selectedAssetItems.length : 0}
              template={selectedTemplate}
              screenNames={(screens || [])
                .filter((s: any) => selectedScreenIds.has(s.id))
                .map((s: any) => s.name || s.id)}
              activate={activateImmediately}
              schedDays={schedDays}
              schedTimeStart={schedTimeStart}
              schedTimeEnd={schedTimeEnd}
              schedStartDate={schedStartDate}
              schedEndDate={schedEndDate}
            />
          )}
        </div>

        {/* 2026-05-26 round 4 — Selected media drawer. Lives as a
            SIBLING of the body div so it pins to the bottom of the
            MODAL frame (not the body's scroll container). Operator:
            "your floating the bar and i can see below it, pin it to
            the bottom so the scrolling top section just scrolls into
            the editing area". Only renders during Step 2 / media kind
            / when items are picked. Footer below stays put. */}
        {step === 2 && kind === 'media' && selectedAssetItems.length > 0 && (
          <SelectedMediaDrawer
            items={selectedAssetItems}
            allAssets={assets || []}
            onReorder={reorderAssets}
            onRemove={removeAssetItem}
            onDuration={setAssetDuration}
            onSetAll={setAllDurations}
          />
        )}

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between">
          <div>
            {step > 1 && (
              <button
                type="button"
                onClick={goBack}
                disabled={creating}
                className="inline-flex items-center px-3 py-2 text-sm font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4 mr-1" />
                Back
              </button>
            )}
          </div>
          <div className="flex items-center">
            <button
              type="button"
              onClick={() => void tryClose()}
              disabled={creating}
              className="px-3 py-2 text-sm font-semibold text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors mr-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            {!isLastStep && (
              <button
                type="button"
                onClick={goNext}
                disabled={nextDisabled || creating}
                className="inline-flex items-center px-4 py-2 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed rounded-lg shadow-sm transition-colors"
              >
                Next
                <ChevronRight className="w-4 h-4 ml-1" />
              </button>
            )}
            {isLastStep && (
              <button
                type="button"
                onClick={handleCreate}
                disabled={creating}
                className="inline-flex items-center px-5 py-2 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 disabled:cursor-not-allowed rounded-lg shadow-sm transition-colors"
              >
                {creating ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Creating…
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 mr-2" />
                    Create Playlist
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── Step 1 — Name + Type ──────────────────────────────────────────────

function Step1NameAndType({
  name,
  setName,
  kind,
  setKind,
  nameInputRef,
  onEnter,
}: {
  name: string;
  setName: (s: string) => void;
  kind: PlaylistKind | null;
  setKind: (k: PlaylistKind) => void;
  nameInputRef: React.RefObject<HTMLInputElement | null>;
  onEnter: () => void;
}) {
  return (
    <div>
      <div className="mb-6">
        <label
          htmlFor="wizard-playlist-name"
          className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2"
        >
          Playlist name
        </label>
        <input
          ref={nameInputRef}
          id="wizard-playlist-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 64))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onEnter();
            }
          }}
          maxLength={64}
          placeholder="e.g. Cafeteria lunch menu, Friday assembly slides, Bus loop welcome…"
          className="w-full px-4 py-3 text-base bg-white border-2 border-slate-200 rounded-xl outline-none focus:ring-4 focus:ring-indigo-100 focus:border-indigo-400 transition-shadow"
        />
        <div className="flex items-center justify-between mt-1.5">
          <p className="text-xs text-slate-400">A friendly name your team will recognize.</p>
          <p className={`text-xs ${name.length >= 60 ? 'text-amber-600' : 'text-slate-400'}`}>
            {name.length}/64
          </p>
        </div>
      </div>

      <div>
        <p className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
          What kind of playlist?
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setKind('media')}
            aria-pressed={kind === 'media'}
            className={`text-left p-5 rounded-2xl border-2 transition-all mr-0 sm:mr-3 mb-3 sm:mb-0 ${
              kind === 'media'
                ? 'border-indigo-500 bg-indigo-50 shadow-md ring-4 ring-indigo-100'
                : 'border-slate-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/50'
            }`}
          >
            <div className="flex items-start">
              <div
                className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 mr-4 transition-colors ${
                  kind === 'media' ? 'bg-indigo-600 text-white' : 'bg-indigo-100 text-indigo-600'
                }`}
              >
                <Play className="w-6 h-6" />
              </div>
              <div className="min-w-0">
                <p className="text-base font-bold text-slate-800 mb-1 flex items-center">
                  Media Playlist
                  {kind === 'media' && (
                    <CheckCircle2 className="w-4 h-4 ml-2 text-indigo-600" />
                  )}
                </p>
                <p className="text-xs text-slate-500 leading-relaxed">
                  A rolling slideshow of your images, videos, and web pages.
                </p>
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setKind('template')}
            aria-pressed={kind === 'template'}
            className={`text-left p-5 rounded-2xl border-2 transition-all ${
              kind === 'template'
                ? 'border-violet-500 bg-violet-50 shadow-md ring-4 ring-violet-100'
                : 'border-slate-200 bg-white hover:border-violet-300 hover:bg-violet-50/50'
            }`}
          >
            <div className="flex items-start">
              <div
                className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 mr-4 transition-colors ${
                  kind === 'template' ? 'bg-violet-600 text-white' : 'bg-violet-100 text-violet-600'
                }`}
              >
                <LayoutTemplate className="w-6 h-6" />
              </div>
              <div className="min-w-0">
                <p className="text-base font-bold text-slate-800 mb-1 flex items-center">
                  From Template
                  {kind === 'template' && (
                    <CheckCircle2 className="w-4 h-4 ml-2 text-violet-600" />
                  )}
                </p>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Use a layout with live widgets (clock, weather, menus, schedules…).
                </p>
              </div>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Step 2 — Media ─────────────────────────────────────────────────────

function Step2Media({
  assets,
  folders,
  breadcrumb,
  currentFolderId,
  onFolderOpen,
  search,
  setSearch,
  filter,
  setFilter,
  selectedIds,
  onToggle,
}: {
  assets: any[];
  folders: any[];
  breadcrumb: Array<{ id: string | null; name: string }>;
  currentFolderId: string | null;
  onFolderOpen: (id: string | null) => void;
  search: string;
  setSearch: (s: string) => void;
  filter: 'all' | 'images' | 'videos' | 'audio' | 'urls';
  setFilter: (f: 'all' | 'images' | 'videos' | 'audio' | 'urls') => void;
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
}) {
  const filterChips: { id: typeof filter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'images', label: 'Images' },
    { id: 'videos', label: 'Videos' },
    { id: 'audio', label: 'Audio' },
    { id: 'urls', label: 'URLs' },
  ];
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-base font-bold text-slate-800">Pick the media to play</p>
          <p className="text-xs text-slate-500 mt-0.5">
            Tap any tile to add it. You can re-order, set per-slide timing, and add more later in the editor.
          </p>
        </div>
        <div className="inline-flex items-center px-3 py-1.5 rounded-full bg-indigo-50 border border-indigo-100">
          <Check className="w-3.5 h-3.5 text-indigo-600 mr-1.5" />
          <span className="text-xs font-bold text-indigo-700">
            {selectedIds.size} selected
          </span>
        </div>
      </div>

      {/* 2026-05-26 — Folder breadcrumb. Always shows "All folders"
          (root) at the start. Click any segment to hop back. Search
          mode hides the breadcrumb because search spans every folder.
          Operator: "you need to show the folders as well so i can
          select a folder if i want to find my content." */}
      {!search && (
        <div className="flex items-center flex-wrap text-xs text-slate-500 mb-3">
          <button
            type="button"
            onClick={() => onFolderOpen(null)}
            className={`inline-flex items-center px-2 py-1 rounded-md mr-1 transition-colors ${
              currentFolderId === null
                ? 'bg-indigo-100 text-indigo-700 font-bold'
                : 'hover:bg-slate-100 text-slate-500 font-semibold'
            }`}
          >
            <Home className="w-3.5 h-3.5 mr-1" />
            All folders
          </button>
          {breadcrumb.map((b) => (
            <span key={b.id} className="inline-flex items-center">
              <ChevronRight className="w-3 h-3 text-slate-300 mr-1" aria-hidden />
              <button
                type="button"
                onClick={() => onFolderOpen(b.id)}
                className={`px-2 py-1 rounded-md mr-1 transition-colors ${
                  b.id === currentFolderId
                    ? 'bg-indigo-100 text-indigo-700 font-bold'
                    : 'hover:bg-slate-100 text-slate-500 font-semibold'
                }`}
              >
                {b.name}
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center mb-3">
        <div className="relative flex-1 mr-3">
          <Search className="absolute top-1/2 left-3 -translate-y-1/2 w-4 h-4 text-slate-300" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={search ? 'Searching all folders…' : 'Search every folder…'}
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400"
          />
        </div>
      </div>

      <div className="flex flex-wrap mb-4">
        {filterChips.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setFilter(c.id)}
            className={`mr-2 mb-2 px-3 py-1 text-xs font-semibold rounded-full transition-colors ${
              filter === c.id
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Folder tiles — sit above the asset grid. Click opens the folder
          (recursive). Hidden in search mode (flat results). */}
      {!search && folders.length > 0 && (
        <div className="mb-4">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
            Folders
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4">
            {folders.map((f: any) => (
              <button
                key={f.id}
                type="button"
                onClick={() => onFolderOpen(f.id)}
                className="text-left rounded-xl border-2 border-slate-200 hover:border-amber-300 hover:bg-amber-50/30 transition-all p-3 mr-2 mb-2"
              >
                <div className="flex items-start">
                  <div className="w-10 h-10 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center shrink-0 mr-3">
                    <Folder className="w-5 h-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-slate-800 truncate">
                      {f.name || 'Untitled folder'}
                    </p>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      Open folder
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {assets.length === 0 ? (
        <div className="text-center py-12 border-2 border-dashed border-slate-200 rounded-xl">
          <ImageIcon className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-sm font-semibold text-slate-600">
            {folders.length > 0 && !search
              ? 'No files in this folder'
              : 'No matching assets'}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            {folders.length > 0 && !search
              ? 'Open a folder above or upload more from the Assets page.'
              : 'Try clearing the filter or uploading from the Assets page first.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4">
          {assets.map((a: any) => {
            const selected = selectedIds.has(a.id);
            const Icon = mimeIcon(a.mimeType);
            const name = a.originalName || a.title || 'Untitled';
            return (
              // 2026-05-26 — operator: "add the check boxes to the
              // assets so i know i cant select multipl units, just
              // match what we do on the main area already with the
              // little check boxes on the asset previews." Mirrors
              // the asset library's tile pattern (apps/web/src/app/
              // [schoolId]/assets/page.tsx line 939) — top-left
              // checkbox that's visible on hover OR when selected,
              // checked-state = filled indigo with Check icon. The
              // whole tile still clicks to toggle (familiar from the
              // previous wizard behavior), the checkbox is a visual
              // affordance.
              <div
                key={a.id}
                onClick={() => onToggle(a.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onToggle(a.id);
                  }
                }}
                aria-pressed={selected}
                aria-label={selected ? `Deselect ${name}` : `Select ${name}`}
                className={`group relative text-left rounded-xl overflow-hidden border-2 transition-all mr-2 mb-2 cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-400 ${
                  selected
                    ? 'border-indigo-500 shadow-md ring-2 ring-indigo-200'
                    : 'border-slate-200 hover:border-indigo-300'
                }`}
              >
                {/* Top-left checkbox — matches the asset library tile
                    style exactly. Hidden until hover OR selected (so
                    the grid doesn't look cluttered when nothing is
                    picked). */}
                <span
                  aria-hidden="true"
                  className={`absolute top-2 left-2 z-20 w-5 h-5 rounded flex items-center justify-center transition-all pointer-events-none ${
                    selected
                      ? 'bg-indigo-500 border border-indigo-500 opacity-100 scale-100'
                      : 'bg-white border border-slate-300 opacity-0 scale-90 group-hover:opacity-100 group-hover:scale-100 shadow-sm'
                  }`}
                >
                  {selected && <Check className="w-3.5 h-3.5 text-white" />}
                </span>

                <div className="aspect-video bg-slate-100">
                  <MiniAssetThumb asset={a} />
                </div>
                <div className="px-2 py-1.5 bg-white">
                  <div className="flex items-center">
                    <Icon className="w-3 h-3 text-slate-400 mr-1.5 shrink-0" />
                    <p className="text-[11px] font-semibold text-slate-700 truncate">
                      {name}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 2026-05-26 round 4 — the Selected drawer left this component
          and now lives ALONGSIDE the modal body so it pins to the
          true bottom of the modal frame (not the body's scroll
          container). See <SelectedMediaDrawer /> rendered as a
          sibling of the body div in the wizard's main render. */}
    </div>
  );
}

// ─── Step 2 — Selected media drawer (pinned to modal bottom) ──────────

/**
 * SelectedMediaDrawer — the always-visible "what have I picked" panel
 * that lives below the modal body and above the footer. Operator:
 * "your floating the bar and i can see below it, pin it to the
 * bottom so the scrolling top section just scrolls into the editing
 * area, also keep all the same editing components we have in the
 * main area like dragging and dropping in order, applying the
 * seconds to everything, auto timing for videos, etc...we are
 * essentially moving the editing area into the wizard now".
 *
 * Mirrors the main playlist editor's row UX:
 *  - dnd-kit drag-drop reorder (same DndContext / SortableContext /
 *    arrayMove pattern as apps/web/src/app/[schoolId]/playlists/page.tsx
 *    line 1082)
 *  - Per-item duration input (seconds, 1-600 clamp)
 *  - Bulk "Set all to N sec" control at the top
 *  - Auto-detect video duration on add (probeVideoDuration in parent)
 *  - Remove button per row
 *
 * Mounted as a SIBLING of the body div in the wizard so it pins to
 * the bottom of the MODAL frame, not the body's scroll container.
 * The body div above shrinks to fit, drawer is fixed-height (capped
 * via max-h on inner ol), footer below stays put.
 */
function SelectedMediaDrawer({
  items,
  allAssets,
  onReorder,
  onRemove,
  onDuration,
  onSetAll,
}: {
  items: Array<{ assetId: string; durationMs: number }>;
  allAssets: any[];
  onReorder: (event: DragEndEvent) => void;
  onRemove: (assetId: string) => void;
  onDuration: (assetId: string, seconds: number) => void;
  onSetAll: (seconds: number) => void;
}) {
  // Bulk-set input state. Default 10 (image default); operator can
  // type any value 1-600 then hit Apply.
  const [bulkSeconds, setBulkSeconds] = useState<number>(10);

  // Sensors mirror the main editor — pointer for mouse/touch +
  // keyboard for a11y. 8px activation distance so a click on the
  // grip doesn't fight a normal click on adjacent controls.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const itemIds = items.map((i) => i.assetId);

  return (
    <div className="border-t-2 border-indigo-100 bg-white shadow-[0_-6px_16px_-6px_rgba(15,23,42,0.12)] px-6 pt-3 pb-3 shrink-0">
      {/* Header row with count + bulk-set control */}
      <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
        <p className="text-sm font-bold text-slate-800 inline-flex items-center gap-2">
          Selected media
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-600 text-white">
            {items.length}
          </span>
          <span className="text-[11px] font-medium text-slate-500">— drag to reorder · plays top to bottom</span>
        </p>
        {/* Bulk "Set all" control */}
        <div className="inline-flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
            Set all
          </span>
          <input
            type="number"
            min={1}
            max={600}
            value={bulkSeconds}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              if (!isNaN(n)) setBulkSeconds(Math.max(1, Math.min(600, n)));
            }}
            aria-label="Set duration for every selected item"
            className="w-14 text-xs text-right px-1.5 py-0.5 border border-slate-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            sec
          </span>
          <button
            type="button"
            onClick={() => onSetAll(bulkSeconds)}
            className="ml-1 inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
            title="Apply this duration to every item below"
          >
            Apply
          </button>
        </div>
      </div>

      {/* dnd-kit sortable list — capped height with internal scroll
          so 20+ items don't push the picker grid off the modal. */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onReorder}>
        <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
          <ol className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
            {items.map((sel, idx) => {
              const a = allAssets.find((x: any) => x.id === sel.assetId);
              if (!a) return null;
              return (
                <SortableMediaRow
                  key={sel.assetId}
                  index={idx}
                  item={sel}
                  asset={a}
                  onDuration={onDuration}
                  onRemove={onRemove}
                />
              );
            })}
          </ol>
        </SortableContext>
      </DndContext>
    </div>
  );
}

/**
 * SortableMediaRow — a single draggable row inside the drawer.
 * Uses dnd-kit's useSortable hook for transform + listeners.
 */
function SortableMediaRow({
  index,
  item,
  asset,
  onDuration,
  onRemove,
}: {
  index: number;
  item: { assetId: string; durationMs: number };
  asset: any;
  onDuration: (assetId: string, seconds: number) => void;
  onRemove: (assetId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.assetId,
  });
  const style: CSSProperties = {
    transform: DndCss.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.55 : 1,
    zIndex: isDragging ? 10 : 'auto',
  };
  const Icon = mimeIcon(asset.mimeType);
  const seconds = Math.round((item.durationMs || 0) / 1000);
  const isVideo = asset.mimeType?.startsWith('video/');

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`flex items-center bg-slate-50 border border-slate-200 rounded-lg p-1.5 ${
        isDragging ? 'shadow-md ring-2 ring-indigo-200 bg-white' : ''
      }`}
    >
      {/* Drag handle — pointer cursor + grip icon. Listeners attached
          only here so the rest of the row's controls still work
          normally (input clicks, remove button, etc.). */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
        className="w-5 h-5 flex items-center justify-center text-slate-400 hover:text-slate-700 cursor-grab active:cursor-grabbing shrink-0 mr-1.5 touch-none"
      >
        <GripVertical className="w-3.5 h-3.5" />
      </button>
      <span className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-indigo-100 text-indigo-700 text-[10px] font-bold shrink-0 mr-2">
        {index + 1}
      </span>
      <div className="w-12 h-8 rounded-md overflow-hidden bg-slate-100 shrink-0 mr-2">
        <MiniAssetThumb asset={asset} />
      </div>
      <div className="min-w-0 flex-1 mr-2">
        <div className="flex items-center">
          <Icon className="w-3 h-3 text-slate-400 mr-1.5 shrink-0" />
          <p className="text-[11px] font-semibold text-slate-700 truncate">
            {asset.originalName || asset.title || 'Untitled'}
          </p>
          {isVideo && (
            <span
              className="ml-1.5 text-[9px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 rounded-sm px-1 leading-tight"
              title="Auto-detected from video metadata"
            >
              auto
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center mr-1">
        <input
          type="number"
          min={1}
          max={600}
          value={seconds || 1}
          onChange={(e) => {
            const n = parseInt(e.target.value, 10);
            if (!isNaN(n)) onDuration(item.assetId, n);
          }}
          aria-label={`Duration in seconds for ${asset.originalName || 'item'}`}
          className="w-12 text-xs text-right px-1.5 py-0.5 border border-slate-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
        />
        <span className="text-[10px] font-bold text-slate-400 ml-1 uppercase tracking-wider">
          sec
        </span>
      </div>
      <button
        type="button"
        onClick={() => onRemove(item.assetId)}
        aria-label="Remove item"
        className="w-6 h-6 rounded-md flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 ml-0.5"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </li>
  );
}

// ─── Step 2 — Template ──────────────────────────────────────────────────

function Step2Template({
  templates,
  search,
  setSearch,
  filter,
  setFilter,
  selectedId,
  onSelect,
  onName,
}: {
  templates: any[];
  search: string;
  setSearch: (s: string) => void;
  filter: 'all' | 'custom' | 'system';
  setFilter: (f: 'all' | 'custom' | 'system') => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onName: (name: string) => void;
}) {
  const filterChips: { id: typeof filter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'custom', label: 'My templates' },
    { id: 'system', label: 'Built-in' },
  ];
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-base font-bold text-slate-800">Pick a template</p>
          <p className="text-xs text-slate-500 mt-0.5">
            Layouts come with live widgets (clock, weather, ticker…). You can tweak them after creating the playlist.
          </p>
        </div>
        {selectedId && (
          <div className="inline-flex items-center px-3 py-1.5 rounded-full bg-violet-50 border border-violet-100">
            <Check className="w-3.5 h-3.5 text-violet-600 mr-1.5" />
            <span className="text-xs font-bold text-violet-700">Template selected</span>
          </div>
        )}
      </div>

      <div className="flex items-center mb-3">
        <div className="relative flex-1 mr-3">
          <Search className="absolute top-1/2 left-3 -translate-y-1/2 w-4 h-4 text-slate-300" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search templates…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-violet-400"
          />
        </div>
      </div>

      <div className="flex flex-wrap mb-4">
        {filterChips.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setFilter(c.id)}
            className={`mr-2 mb-2 px-3 py-1 text-xs font-semibold rounded-full transition-colors ${
              filter === c.id
                ? 'bg-violet-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {templates.length === 0 ? (
        <div className="text-center py-12 border-2 border-dashed border-slate-200 rounded-xl">
          <LayoutTemplate className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-sm font-semibold text-slate-600">No matching templates</p>
          <p className="text-xs text-slate-400 mt-1">
            Create one from the Templates page, or try a built-in.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3">
          {templates.map((t: any) => {
            const selected = selectedId === t.id;
            const zoneCount = t._count?.zones || t.zones?.length || 0;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  onSelect(t.id);
                  onName(t.name);
                }}
                aria-pressed={selected}
                className={`relative text-left rounded-xl overflow-hidden border-2 transition-all mr-2 mb-2 bg-white ${
                  selected
                    ? 'border-violet-500 shadow-md ring-2 ring-violet-200'
                    : 'border-slate-200 hover:border-violet-300'
                }`}
              >
                <div className="bg-slate-50 flex items-center justify-center" style={{ minHeight: 110 }}>
                  {t.zones && t.zones.length > 0 ? (
                    <ScaledTemplateThumbnail
                      zones={t.zones}
                      screenWidth={t.screenWidth || 1920}
                      screenHeight={t.screenHeight || 1080}
                      bgImage={t.bgImage}
                      bgGradient={t.bgGradient}
                      bgColor={t.bgColor}
                      maxHeight={110}
                    />
                  ) : (
                    <LayoutTemplate className="w-10 h-10 text-slate-300" />
                  )}
                </div>
                {selected && (
                  <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-violet-600 flex items-center justify-center shadow-md">
                    <Check className="w-4 h-4 text-white" />
                  </div>
                )}
                <div className="px-3 py-2 border-t border-slate-100">
                  <p className="text-xs font-bold text-slate-700 truncate">{t.name}</p>
                  <div className="flex items-center mt-0.5">
                    <Layers className="w-3 h-3 text-slate-300 mr-1" />
                    <p className="text-[10px] text-slate-400">
                      {t.screenWidth || 1920}×{t.screenHeight || 1080} · {zoneCount} zone{zoneCount === 1 ? '' : 's'}
                      {t.isSystem ? ' · Built-in' : ''}
                    </p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Step 3 — Screens ──────────────────────────────────────────────────

function Step3Screens({
  screens,
  total,
  groups,
  search,
  setSearch,
  selectedIds,
  onToggle,
  onPickGroup,
  onSkip,
}: {
  screens: any[];
  total: number;
  groups: any[];
  search: string;
  setSearch: (s: string) => void;
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onPickGroup: (group: any) => void;
  onSkip: () => void;
}) {
  // 2026-05-26 — operator: "make sure the screen groups are visible
  // form the wizard." Filter to groups that have at least one screen
  // member — empty groups create no schedules so showing them is just
  // noise. Status counts drive the per-group "online" pill below.
  const groupsWithScreens = (groups || []).filter(
    (g: any) => Array.isArray(g.screens) && g.screens.length > 0,
  );
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-base font-bold text-slate-800">Where should it play?</p>
          <p className="text-xs text-slate-500 mt-0.5">
            Pick a screen group (one click adds all its screens) or pick individual screens. Skip to assign later.
          </p>
        </div>
        <div className="inline-flex items-center px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-100">
          <Monitor className="w-3.5 h-3.5 text-emerald-600 mr-1.5" />
          <span className="text-xs font-bold text-emerald-700">
            {selectedIds.size} of {total} screens
          </span>
        </div>
      </div>

      {/* Screen groups — sit above the individual screens grid. Click
          a group → selects every screen it contains (toggle behavior:
          if every screen in the group is already selected, clicking
          deselects them all). Layers icon + status counts match the
          /screens page card UI so it feels familiar. Operator:
          "make sure the screen groups are visible form the wizard." */}
      {groupsWithScreens.length > 0 && (
        <div className="mb-4">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
            Screen groups
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2">
            {groupsWithScreens.map((g: any) => {
              const memberIds = (g.screens || []).map((s: any) => s.id).filter(Boolean);
              const onlineCount = (g.screens || []).filter((s: any) => s.status === 'ONLINE').length;
              const allMembersSelected = memberIds.length > 0 && memberIds.every((id: string) => selectedIds.has(id));
              const someMembersSelected = !allMembersSelected && memberIds.some((id: string) => selectedIds.has(id));
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => onPickGroup(g)}
                  aria-pressed={allMembersSelected}
                  className={`text-left rounded-xl border-2 transition-all p-3 mr-2 mb-2 ${
                    allMembersSelected
                      ? 'border-emerald-500 bg-emerald-50/40 ring-2 ring-emerald-100'
                      : someMembersSelected
                        ? 'border-emerald-300 bg-emerald-50/20'
                        : 'border-slate-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/30'
                  }`}
                >
                  <div className="flex items-start">
                    <div
                      className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 mr-3 ${
                        allMembersSelected ? 'bg-emerald-600 text-white' : 'bg-emerald-100 text-emerald-700'
                      }`}
                    >
                      <Layers className="w-5 h-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-slate-800 truncate">{g.name || 'Group'}</p>
                      <div className="flex items-center mt-1">
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                          {memberIds.length} screen{memberIds.length === 1 ? '' : 's'}
                        </span>
                        {onlineCount > 0 && (
                          <span className="text-[10px] text-emerald-600 ml-2 font-semibold">
                            • {onlineCount} online
                          </span>
                        )}
                      </div>
                    </div>
                    {allMembersSelected && (
                      <div className="w-6 h-6 rounded-full bg-emerald-600 flex items-center justify-center shadow-sm shrink-0 ml-2">
                        <Check className="w-4 h-4 text-white" />
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {total > 0 && (
        <div className="relative mb-3">
          <Search className="absolute top-1/2 left-3 -translate-y-1/2 w-4 h-4 text-slate-300" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search individual screens…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-emerald-400"
          />
        </div>
      )}

      {total > 0 && groupsWithScreens.length > 0 && (
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
          Individual screens
        </p>
      )}

      {total === 0 ? (
        <div className="text-center py-12 border-2 border-dashed border-slate-200 rounded-xl">
          <Monitor className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-sm font-semibold text-slate-600">No screens paired yet</p>
          <p className="text-xs text-slate-400 mt-1 mb-4">
            Pair a screen first from the Screens page — or skip this step and assign later.
          </p>
          <button
            type="button"
            onClick={onSkip}
            className="px-4 py-2 text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
          >
            Skip — assign later
          </button>
        </div>
      ) : screens.length === 0 ? (
        <div className="text-center py-10 border-2 border-dashed border-slate-200 rounded-xl">
          <Search className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-sm font-semibold text-slate-600">No screens match the search</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2">
            {screens.map((s: any) => {
              const selected = selectedIds.has(s.id);
              const online = s.status === 'ONLINE';
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onToggle(s.id)}
                  aria-pressed={selected}
                  className={`relative text-left rounded-xl border-2 transition-all p-3 mr-2 mb-2 ${
                    selected
                      ? 'border-emerald-500 bg-emerald-50/40 shadow-sm ring-2 ring-emerald-100'
                      : 'border-slate-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/30'
                  }`}
                >
                  <div className="flex items-start">
                    <div
                      className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 mr-3 ${
                        selected ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      <Monitor className="w-5 h-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-slate-800 truncate">
                        {s.name || 'Untitled screen'}
                      </p>
                      <div className="flex items-center mt-1">
                        {online ? (
                          <>
                            <Wifi className="w-3 h-3 text-emerald-500 mr-1" />
                            <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">
                              Online
                            </span>
                          </>
                        ) : (
                          <>
                            <WifiOff className="w-3 h-3 text-slate-300 mr-1" />
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                              Offline
                            </span>
                          </>
                        )}
                        {s.resolution && (
                          <span className="text-[10px] text-slate-400 ml-2">{s.resolution}</span>
                        )}
                      </div>
                    </div>
                    {selected && (
                      <div className="w-6 h-6 rounded-full bg-emerald-600 flex items-center justify-center shadow-sm shrink-0 ml-2">
                        <Check className="w-4 h-4 text-white" />
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
          <div className="text-center mt-2">
            <button
              type="button"
              onClick={onSkip}
              className="text-xs font-semibold text-slate-400 hover:text-slate-700"
            >
              Skip — assign screens later
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Step 4 — Publish ─────────────────────────────────────────────────

function Step4Publish({
  activate,
  setActivate,
  startDate,
  setStartDate,
  endDate,
  setEndDate,
  timeStart,
  setTimeStart,
  timeEnd,
  setTimeEnd,
  days,
  toggleDay,
  screensPicked,
}: {
  activate: boolean;
  setActivate: (b: boolean) => void;
  startDate: string;
  setStartDate: (s: string) => void;
  endDate: string;
  setEndDate: (s: string) => void;
  timeStart: string;
  setTimeStart: (s: string) => void;
  timeEnd: string;
  setTimeEnd: (s: string) => void;
  days: string[];
  toggleDay: (d: string) => void;
  screensPicked: number;
}) {
  return (
    <div>
      <p className="text-base font-bold text-slate-800 mb-1">Publishing</p>
      <p className="text-xs text-slate-500 mb-4">
        {screensPicked === 0
          ? 'No screens were picked — these settings will be saved with the playlist for when you assign screens later.'
          : `These rules apply to all ${screensPicked} screen${screensPicked === 1 ? '' : 's'} you picked.`}
      </p>

      <button
        type="button"
        onClick={() => setActivate(true)}
        aria-pressed={activate}
        className={`w-full text-left p-4 rounded-xl border-2 transition-all mb-3 ${
          activate
            ? 'border-emerald-500 bg-emerald-50/40 ring-2 ring-emerald-100'
            : 'border-slate-200 hover:border-emerald-300'
        }`}
      >
        <div className="flex items-start">
          <div
            className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 mr-3 ${
              activate ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-500'
            }`}
          >
            <Play className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold text-slate-800">Activate immediately</p>
            <p className="text-xs text-slate-500 mt-0.5">
              Starts the moment you click Create. Plays 24/7 until you stop it.
            </p>
            {activate && (
              <div className="flex flex-wrap mt-2">
                <span className="inline-flex items-center text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-1 rounded-full mr-2 mb-1">
                  <Play className="w-2.5 h-2.5 mr-1" />
                  Starts now
                </span>
                <span className="inline-flex items-center text-[10px] font-bold text-slate-600 bg-slate-100 px-2 py-1 rounded-full mr-2 mb-1">
                  Ends never
                </span>
              </div>
            )}
          </div>
          {activate && (
            <div className="w-6 h-6 rounded-full bg-emerald-600 flex items-center justify-center shadow-sm shrink-0">
              <Check className="w-4 h-4 text-white" />
            </div>
          )}
        </div>
      </button>

      <button
        type="button"
        onClick={() => setActivate(false)}
        aria-pressed={!activate}
        className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
          !activate
            ? 'border-sky-500 bg-sky-50/40 ring-2 ring-sky-100'
            : 'border-slate-200 hover:border-sky-300'
        }`}
      >
        <div className="flex items-start">
          <div
            className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 mr-3 ${
              !activate ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-500'
            }`}
          >
            <Calendar className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold text-slate-800">Schedule a window</p>
            <p className="text-xs text-slate-500 mt-0.5">
              Pick specific days and times. The playlist activates only inside the window.
            </p>
          </div>
          {!activate && (
            <div className="w-6 h-6 rounded-full bg-sky-600 flex items-center justify-center shadow-sm shrink-0">
              <Check className="w-4 h-4 text-white" />
            </div>
          )}
        </div>

        {!activate && (
          <div className="mt-4 pl-13" style={{ paddingLeft: 52 }}>
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
              Days of week
            </p>
            <div className="flex flex-wrap mb-3">
              {DAYS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleDay(d);
                  }}
                  className={`mr-1 mb-1 px-2.5 py-1 text-[11px] font-bold rounded ${
                    days.includes(d)
                      ? 'bg-sky-600 text-white'
                      : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>

            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
              Time of day
            </p>
            <div className="flex items-center mb-3 text-xs">
              <input
                type="time"
                value={timeStart}
                onChange={(e) => {
                  e.stopPropagation();
                  setTimeStart(e.target.value);
                }}
                onClick={(e) => e.stopPropagation()}
                className="px-2 py-1.5 border border-slate-200 rounded bg-white text-slate-700"
              />
              <span className="mx-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                to
              </span>
              <input
                type="time"
                value={timeEnd}
                onChange={(e) => {
                  e.stopPropagation();
                  setTimeEnd(e.target.value);
                }}
                onClick={(e) => e.stopPropagation()}
                className="px-2 py-1.5 border border-slate-200 rounded bg-white text-slate-700"
              />
            </div>

            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
              Date range (optional)
            </p>
            <div className="flex items-center text-xs">
              <input
                type="date"
                value={startDate}
                onChange={(e) => {
                  e.stopPropagation();
                  setStartDate(e.target.value);
                }}
                onClick={(e) => e.stopPropagation()}
                placeholder="Start"
                className="px-2 py-1.5 border border-slate-200 rounded bg-white text-slate-700"
              />
              <span className="mx-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                through
              </span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => {
                  e.stopPropagation();
                  setEndDate(e.target.value);
                }}
                onClick={(e) => e.stopPropagation()}
                placeholder="End"
                className="px-2 py-1.5 border border-slate-200 rounded bg-white text-slate-700"
              />
            </div>
            <p className="text-[10px] text-slate-400 mt-1">
              Leave the dates blank to start now and never stop.
            </p>
          </div>
        )}
      </button>
    </div>
  );
}

// ─── Step 5 — Review ──────────────────────────────────────────────────

function Step5Review({
  name,
  kind,
  itemCount,
  template,
  screenNames,
  activate,
  schedDays,
  schedTimeStart,
  schedTimeEnd,
  schedStartDate,
  schedEndDate,
}: {
  name: string;
  kind: PlaylistKind;
  itemCount: number;
  template: any;
  screenNames: string[];
  activate: boolean;
  schedDays: string[];
  schedTimeStart: string;
  schedTimeEnd: string;
  schedStartDate: string;
  schedEndDate: string;
}) {
  const scheduleLabel = (() => {
    if (activate) {
      if (screenNames.length === 0) return 'Activate immediately when screens are assigned';
      return 'Starts now · ends never';
    }
    const parts: string[] = [];
    if (schedDays.length === 7) parts.push('Every day');
    else if (schedDays.length > 0) parts.push(schedDays.join(', '));
    else parts.push('No days picked');
    parts.push(`${schedTimeStart}–${schedTimeEnd}`);
    if (schedStartDate || schedEndDate) {
      parts.push(`(${schedStartDate || 'now'} → ${schedEndDate || 'never'})`);
    }
    return parts.join(' · ');
  })();

  return (
    <div>
      <div className="flex items-center mb-4">
        <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center mr-3">
          <Sparkles className="w-5 h-5 text-indigo-600" />
        </div>
        <div>
          <p className="text-base font-bold text-slate-800">Ready to create</p>
          <p className="text-xs text-slate-500">Double-check the summary below, then hit Create Playlist.</p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 overflow-hidden">
        <ReviewRow label="Name" value={name || <em className="text-amber-600">No name set</em>} />
        <ReviewRow
          label="Type"
          value={
            kind === 'media' ? (
              <span className="inline-flex items-center">
                <Play className="w-3.5 h-3.5 text-indigo-500 mr-1.5" />
                Media Playlist
              </span>
            ) : (
              <span className="inline-flex items-center">
                <LayoutTemplate className="w-3.5 h-3.5 text-violet-500 mr-1.5" />
                From Template
              </span>
            )
          }
        />
        {kind === 'media' && (
          <ReviewRow
            label="Content"
            value={`${itemCount} asset${itemCount === 1 ? '' : 's'}`}
          />
        )}
        {kind === 'template' && (
          <ReviewRow
            label="Template"
            value={
              template ? (
                <span>
                  <span className="font-semibold">{template.name}</span>
                  <span className="text-slate-400">
                    {' '}· {template.screenWidth || 1920}×{template.screenHeight || 1080}
                  </span>
                </span>
              ) : (
                <em className="text-amber-600">Not picked</em>
              )
            }
          />
        )}
        <ReviewRow
          label="Screens"
          value={
            screenNames.length === 0 ? (
              <span className="text-slate-500">
                None yet — assign from the playlist page after creating.
              </span>
            ) : screenNames.length <= 3 ? (
              <span>{screenNames.join(', ')}</span>
            ) : (
              <span>
                <span className="font-semibold">{screenNames.length} screens</span>{' '}
                <span className="text-slate-400">
                  ({screenNames.slice(0, 2).join(', ')}, …)
                </span>
              </span>
            )
          }
        />
        <ReviewRow
          label="Schedule"
          value={
            <span
              className={activate ? 'inline-flex items-center text-emerald-700' : 'inline-flex items-center text-sky-700'}
            >
              {activate ? (
                <Play className="w-3.5 h-3.5 mr-1.5" />
              ) : (
                <Calendar className="w-3.5 h-3.5 mr-1.5" />
              )}
              {scheduleLabel}
            </span>
          }
          last
        />
      </div>

      <p className="text-xs text-slate-400 mt-3 text-center">
        You can edit any of this later from the playlist detail page.
      </p>
    </div>
  );
}

function ReviewRow({
  label,
  value,
  last,
}: {
  label: string;
  value: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div
      className={`flex items-start px-4 py-3 ${last ? '' : 'border-b border-slate-100'}`}
    >
      <div className="w-24 shrink-0">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-0.5">
          {label}
        </p>
      </div>
      <div className="flex-1 text-sm text-slate-700 min-w-0">{value}</div>
    </div>
  );
}

export default PlaylistCreateWizard;
