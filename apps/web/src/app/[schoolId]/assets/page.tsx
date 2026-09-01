"use client";

/**
 * Media Library — "Calm Assets v1".
 *
 * Design contract: scratch/design/assets-menu/MEDIA-LIBRARY-V1-DESIGN-HANDOFF.md
 * + media-library-v1-calm.png. This is an EVOLUTIONARY POLISH of the page that
 * was already here — same route, same folder-first mental model, same uncropped
 * square thumbnails, same destination-folder-first upload — not a second
 * "v2" library living beside the old one.
 *
 * The design principle it is built around:
 *
 *   Make everyday browsing visually quiet. Reveal management complexity only
 *   when the operator selects an asset or begins an action.
 *
 * What that changed, concretely:
 *   - the permanent red trash on every tile is gone (§11/§25) — destructive
 *     actions live in the card's overflow menu and the detail modal;
 *   - bulk actions moved out of the page header into a contextual selection
 *     bar (§13), so the header never grows to six buttons;
 *   - the oversized dashed drop zone became a compact strip and the WHOLE
 *     page is the drop target (§6);
 *   - the detail modal answers "where is this playing?" before it offers to
 *     delete anything (§15), and an in-use asset cannot be silently deleted
 *     (§16 — no force-delete affordance exists anywhere on this page);
 *   - the list is windowed with an explicit progress footer (§17) instead of
 *     silently truncating at the server's cap.
 *
 * TRUTH RULES (§22) that must survive any future edit here: never show a
 * usage count that didn't come from the usage endpoint; never call an asset
 * unused because only the loaded page was searched; never promise
 * restoration (there is no Trash backend yet); never print dimensions read
 * off a generated thumbnail.
 */

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { appConfirm, appAlert } from '@/components/ui/app-dialog';
import { UploadCloud, Globe, X, CheckCircle2, File, Link2, Grid3X3, List, Search, Image as ImageIcon, Video, Music, FileText, Download, Clock, HardDrive, Maximize2, Info, FolderPlus, Folder, FolderOpen, ChevronRight, Pencil, MoreVertical, Check, Trash2, AlertCircle, RefreshCw, ChevronDown, Sparkles, Loader2, ListPlus, ChevronsRight, ExternalLink, Home } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useAssets, useAddWebUrl, useDeleteAsset, useAssetFolders, useCreateAssetFolder,
  useRenameAssetFolder, useDeleteAssetFolder, useMoveAsset, useGenerateAltText,
  useUpdateAltText, useAssetUsage, normalizeAssetList, assetUsageQueryKey, fetchAssetUsage,
  type AssetUsage,
} from '@/hooks/use-api';
import { useUIStore } from '@/store/ui-store';
import { clog } from '@/lib/client-logger';
import { FolderPicker } from '@/components/assets/FolderPicker';
import { PdfHoverThumb } from '@/components/assets/PdfHoverThumb';
import { AssetActionsMenu, buildAssetMenuActions } from '@/components/assets/AssetActionsMenu';
import { AssetBulkBar } from '@/components/assets/AssetBulkBar';
import { AssetUsageSection, AssetInUseBlock } from '@/components/assets/AssetUsageSection';
import { AiImageGenerateButton } from '@/components/ai/AiImageGenerateButton';
import { useOverlayLock } from '@/hooks/use-overlay-lock';
import { transformedImageUrl } from '@/lib/asset-image';

// Match the server limit (apps/api/src/assets/assets.controller.ts).
// 200MB was rejecting any reasonably-sized video before it even tried to
// upload — partner reported "added a video and i get a network error and
// it never loads" but the actual error was the client-side guard. Server
// is 500MB.
const MAX_FILE_SIZE = 500 * 1024 * 1024;
// 2026-05-13 — Dropped .mov and .avi from the accept list. Browsers /
// Android WebView refuse QuickTime (`ftyp=qt  `) containers and have
// never supported AVI cross-platform. Operator hit this with an
// IMG_*.mov from an iPhone — file uploaded fine, then the player
// silently failed to play it (HTML5 video element refused the source).
// Keeping these out of the picker AND the drag-drop validation below
// means the operator gets an instant, actionable error instead of a
// 4-hour debugging trip. Server enforces the same allowlist in
// assets.controller.ts (assertUploadIntent + Supabase bucket policy).
// SVG is intentionally NOT in the asset-library picker. The library uploads
// direct browser→Supabase (presign), so the server never sees the bytes and
// can't sanitize the SVG before it lands in storage — and asset SVGs are
// rendered raw elsewhere, so an unsanitized one is a stored-XSS vector. Logos
// DO support SVG via the Brand Kit flow (Settings → Branding), which scrapes
// or uploads through a server-side-sanitized path. getUnsupportedReason()
// below explains this if an operator drag-drops a .svg anyway.
const ACCEPT_STRING = '.jpg,.jpeg,.png,.webp,.gif,.bmp,.mp4,.m4v,.webm,.mp3,.ogg,.wav,.m4a,.pdf';

// §6 — the strip's supported-file line is generated from the SAME rule the
// uploader enforces, so it can never advertise a format the picker rejects.
const SUPPORTED_COPY = 'Images, video, audio and PDF · up to 500 MB';

// §17 — first window. Small enough that a big library paints fast, and the
// footer always says how much of the library that is. Opening a folder,
// searching or filtering widens the window to FULL_SCAN_TAKE first (see
// the effect below) so those views are never answered from a partial list.
const PAGE_SIZE = 50;
const FULL_SCAN_TAKE = 500;

// Friendly, per-format rejection messages. Mirrors REJECTED_EXTENSIONS /
// REJECTED_MIMES on the server — keeping the rule list in two places is
// the price of "fail before upload instead of fail after the bytes have
// landed on Supabase." When you add a format to one, add it to the other.
function getUnsupportedReason(file: File): string | null {
  const name = (file.name || '').toLowerCase();
  const type = (file.type || '').toLowerCase();
  if (name.endsWith('.mov') || type === 'video/quicktime') {
    return "MOV is unsupported — export as MP4 (H.264). Android signage players and Windows Edge refuse QuickTime: in QuickTime Player → File → Export As → 1080p, then upload the .mp4.";
  }
  if (name.endsWith('.avi') || type === 'video/x-msvideo') {
    return "AVI is unsupported — export as MP4 (H.264) and re-upload.";
  }
  if (name.endsWith('.svg') || type === 'image/svg+xml') {
    // Friendly, actionable, and honest about the roadmap — an SVG can carry
    // hidden scripts so we don't store raw SVGs as content yet. Points at the
    // place SVG DOES work today (logos) instead of a generic "unsupported
    // format." Mirrors the server message in assets.controller.ts
    // assertUploadIntent() and the AssetPicker pre-check.
    return "SVG is unsupported for asset uploads — export as PNG. For a logo specifically, Settings → Branding accepts SVG safely today.";
  }
  return null;
}

type UploadPhase = 'idle' | 'uploading' | 'processing' | 'success' | 'pending-review' | 'error';
type ViewMode = 'grid' | 'list';
type FilterType = 'all' | 'images' | 'videos' | 'audio' | 'urls' | 'documents';
type SortKey = 'newest' | 'oldest' | 'nameAsc' | 'nameDesc' | 'largest' | 'smallest';

const SORT_LABELS: Record<SortKey, string> = {
  newest: 'Newest',
  oldest: 'Oldest',
  nameAsc: 'Name A–Z',
  nameDesc: 'Name Z–A',
  largest: 'Largest file',
  smallest: 'Smallest file',
};

// §14 — the operator-facing name of each upload phase. "Ready" is only
// stamped after the server registered the asset, never after the storage
// PUT alone.
const UPLOAD_PHASE_LABEL: Record<UploadPhase, string> = {
  idle: 'Waiting',
  uploading: 'Uploading',
  processing: 'Processing',
  success: 'Ready',
  'pending-review': 'Pending review',
  error: 'Failed',
};

interface UploadItem {
  id: string;
  file: File;
  progress: number;
  phase: UploadPhase;
  error?: string;
}

interface PresignedUploadResponse {
  uploadUrl: string;
  signedUrl: string;
  storagePath: string;
  fileUrl: string;
  mimeType: string;
}

function getAssetType(mime: string): FilterType {
  if (mime?.startsWith('image/')) return 'images';
  if (mime?.startsWith('video/')) return 'videos';
  if (mime?.startsWith('audio/')) return 'audio';
  if (mime === 'text/html') return 'urls';
  if (mime === 'application/pdf') return 'documents';
  return 'all';
}

function typeIcon(mime: string, size = 'w-5 h-5') {
  if (mime?.startsWith('video/')) return <Video className={`${size} text-violet-500`} />;
  if (mime?.startsWith('audio/')) return <Music className={`${size} text-amber-500`} />;
  if (mime?.startsWith('image/')) return <ImageIcon className={`${size} text-sky-500`} />;
  if (mime === 'text/html') return <Globe className={`${size} text-emerald-500`} />;
  if (mime === 'application/pdf') return <FileText className={`${size} text-rose-500`} />;
  return <File className={`${size} text-slate-400`} />;
}

/** Short, human file-kind token for the card's metadata line ("JPG", "MP4"). */
function shortType(mime: string): string {
  if (mime === 'text/html') return 'LINK';
  const ext = mime?.split('/')[1]?.toUpperCase() || 'FILE';
  return ext === 'JPEG' ? 'JPG' : ext === 'QUICKTIME' ? 'MOV' : ext === 'MPEG' ? 'MP3' : ext.substring(0, 4);
}

function typeBadge(mime: string, opts?: { onImage?: boolean }) {
  const short = shortType(mime);
  const type = getAssetType(mime);
  // 2026-06-16 — `onImage` variant: a translucent tint (bg-*/10 + *-600 text)
  // is unreadable when the badge sits OVER a thumbnail (the grid tile). There
  // it uses a dark scrim + a light type-tinted ink — legible on ANY image and
  // visually consistent with the resolution badge's dark pill. The default
  // (translucent tint) is kept for the list view, which is on a white row.
  if (opts?.onImage) {
    const ink: Record<string, string> = { images: 'text-sky-200', videos: 'text-violet-200', audio: 'text-amber-200', urls: 'text-emerald-200', documents: 'text-rose-200' };
    return <span className={`text-[9px] font-black px-1.5 py-0.5 rounded bg-slate-900/70 ${ink[type] || 'text-slate-100'}`}>{short}</span>;
  }
  const c: Record<string, string> = { images: 'bg-sky-500/10 text-sky-700', videos: 'bg-violet-500/10 text-violet-700', audio: 'bg-amber-500/10 text-amber-700', urls: 'bg-emerald-500/10 text-emerald-700', documents: 'bg-rose-500/10 text-rose-700' };
  return <span className={`text-[9px] font-black px-1.5 py-0.5 rounded ${c[type] || 'bg-slate-100 text-slate-600'}`}>{short}</span>;
}

function fmtSize(bytes: number | null | undefined) {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** "Updated 2 days ago" for the folder cards (§9). Unknown → null, never a fake date. */
function fmtRelative(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 90) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks} week${weeks === 1 ? '' : 's'} ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  return `${Math.round(days / 365)} year${days >= 730 ? 's' : ''} ago`;
}

// Detect image dimensions client-side for the detail panel
function useImageDimensions(url: string | null) {
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    if (!url) { setDims(null); return; }
    const img = new window.Image();
    img.onload = () => setDims({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => setDims(null);
    img.src = url;
  }, [url]);
  return dims;
}

// True stored dimensions, measured server-side by sharp at upload time
// (processing_meta.processedDimensions = the file we actually store and
// serve to screens). THE BUG THIS FIXES (2026-07-09): the grid badge and
// the detail panel both stamped `naturalWidth×naturalHeight` of the
// ~320px TRANSFORMED thumbnail (`/render/image/…?width=320`), so the UI
// showed the thumbnail's size, not the asset's — operator: "i upload
// images in our system and its not the same as every other CMS." Always
// prefer these server-measured dims; only fall back to client measuring
// when meta is missing (legacy pre-transcoder uploads), and then ONLY
// against the ORIGINAL file URL, never a transformed thumbnail.
function metaDims(a: any): { w: number; h: number } | null {
  const pm = a?.processingMeta;
  const d = pm?.processedDimensions ?? pm?.originalDimensions;
  return d && typeof d.w === 'number' && typeof d.h === 'number'
    ? { w: d.w, h: d.h }
    : null;
}

/** Card status pill — only rendered when the state CHANGES what the operator can do (§11). */
function statusBadge(a: any): { label: string; className: string } | null {
  // Server-declared only. This page never infers protection.
  if (a?.protectedEmergency === true) return { label: 'Protected', className: 'bg-rose-100 text-rose-900 border border-rose-300' };
  const s = a?.status;
  if (s === 'PENDING_APPROVAL') return { label: 'Pending review', className: 'bg-amber-100 text-amber-900 border border-amber-300' };
  if (s === 'ARCHIVED') return { label: 'Archived', className: 'bg-slate-200 text-slate-700 border border-slate-300' };
  return null;
}

export default function AssetsPage() {
  const t = useTranslations();
  const userRole = useUIStore((s) => s.user?.role);
  const isViewer = userRole === 'RESTRICTED_VIEWER';
  const readOnlyReason = 'Read-only access';
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [filter, setFilter] = useState<FilterType>('all');
  const [sort, setSort] = useState<SortKey>('newest');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [showUrlForm, setShowUrlForm] = useState(false);
  const [webUrl, setWebUrl] = useState('');
  const [selectedAsset, setSelectedAsset] = useState<any>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [windowSize, setWindowSize] = useState(PAGE_SIZE);
  // §16 — the "this asset is currently in use" block. Set from a pre-flight
  // usage check OR from the server's 409, and it offers Review usage /
  // Cancel only. There is deliberately no force-delete path.
  const [inUseBlock, setInUseBlock] = useState<{ asset: any; usage: AssetUsage } | null>(null);
  // NOTE (2026-07-09): a hover-triggered "Quick Look" full-image overlay
  // shipped briefly and was reverted same-day — operator: "if i move my
  // mouse it freezes the entire screen… hover need to just go back to a
  // click for preview." Preview = CLICK → detail panel (large uncropped
  // render). Do not re-add hover-triggered overlays here.
  const router = useRouter();

  // "Create playlist" from a selection (or a single card's menu): stash the
  // ids in sessionStorage, then jump to Playlists with ?newPlaylist=1 — the
  // playlists page opens the wizard pre-seeded with these files (Step 2),
  // saving the operator the re-pick step.
  const startPlaylistFrom = (ids: string[]) => {
    if (ids.length === 0) return;
    try { sessionStorage.setItem('edu_new_playlist_assets', JSON.stringify(ids)); } catch { /* ignore */ }
    const base = window.location.pathname.replace(/\/assets(?:\/.*)?$/, '');
    router.push(`${base}/playlists?newPlaylist=1`);
    setSelectedIds([]);
  };
  const [dragOver, setDragOver] = useState(false);
  // The asset detail modal is a full-viewport overlay with its own action
  // footer; hide the mobile tab bar while it's open. (FolderPicker registers
  // its own overlay lock, so it's not gated here.)
  useOverlayLock(!!selectedAsset || !!inUseBlock);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const newFolderInputRef = useRef<HTMLInputElement>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const detailOpenerRef = useRef<HTMLElement | null>(null);
  const dragDepth = useRef(0);
  const queryClient = useQueryClient();

  // Folder state
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [folderMenuOpen, setFolderMenuOpen] = useState<string | null>(null);
  // 2026-05-26 — operator: "the folders are bleeding into the content
  // ... when I have 100 folders how will I be able to see them all?"
  // §9 keeps that answer but calms it down: one row of compact cards by
  // default, "View all folders" reveals the rest inside a capped scroll
  // region, and the Files section below has its own heading.
  const [showAllFolders, setShowAllFolders] = useState(false);
  const FOLDERS_PREVIEW_LIMIT = 5;
  // Searchable folder picker state:
  //   - showFolderPicker: 'upload' | 'bulk-move' | 'single-move' | null
  //   - pendingFiles: files dragged onto the page that need a destination.
  //     The picker opens, user chooses a folder, then we upload these
  //     without ever asking for files again. Empty for the plain "Upload
  //     files" flow (which falls through to the native file chooser after
  //     the picker resolves).
  const [showFolderPicker, setShowFolderPicker] = useState<'upload' | 'bulk-move' | 'single-move' | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [moveTargetId, setMoveTargetId] = useState<string | null>(null);
  const { data: folders } = useAssetFolders();
  const createFolder = useCreateAssetFolder();
  const renameFolder = useRenameAssetFolder();
  const deleteFolderMut = useDeleteAssetFolder();
  const moveAsset = useMoveAsset();
  const addWebUrl = useAddWebUrl();
  const deleteAsset = useDeleteAsset();
  // Audit P1-2 (2026-05-28) — AI alt-text generator + manual override.
  const generateAltText = useGenerateAltText();
  const updateAltText = useUpdateAltText();
  // Local edit buffer for the alt-text field — keeps typing snappy
  // without re-running the parent's mutation on every keystroke.
  const [altTextDraft, setAltTextDraft] = useState<string>('');
  const [altTextDirty, setAltTextDirty] = useState(false);

  // §7 — debounce the SERVER query. Typing stays instant against what is
  // already loaded; the network only moves once the operator pauses.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);

  // Does this API search server-side? We find out by asking once. Until we
  // know, `q` rides along; the moment a response comes back that carried a
  // query the server didn't echo, we stop sending it — otherwise every
  // distinct search term would re-request the whole window from an endpoint
  // that ignores it, and the answer was already in the client's hands.
  const [serverQuerySupported, setServerQuerySupported] = useState<boolean | null>(null);
  const sentQuery = serverQuerySupported === false ? undefined : (debouncedSearch || undefined);

  const { data: assetsRaw, isLoading, isError, refetch, isFetching } = useAssets({
    take: windowSize,
    q: sentQuery,
  });
  const page = useMemo(() => normalizeAssetList(assetsRaw), [assetsRaw]);
  const assets = page.assets;
  /** true once the server answered a query it actually applied itself. */
  const serverSearched = !!debouncedSearch && page.appliedQuery === debouncedSearch;

  useEffect(() => {
    // `isFetching` matters: with placeholderData the previous page's rows are
    // still on screen while the next request is in flight, and judging the
    // server's capability off stale data would answer the wrong question.
    if (!sentQuery || isFetching || assetsRaw === undefined) return;
    if (page.appliedQuery === sentQuery) setServerQuerySupported(true);
    else if (serverQuerySupported === null) setServerQuerySupported(false);
  }, [assetsRaw, sentQuery, isFetching, page.appliedQuery, serverQuerySupported]);
  /**
   * Do we hold the WHOLE library? With a `total` that's arithmetic; without
   * one (legacy API) the proof is "the server returned fewer rows than the
   * window we asked for", which can only mean it ran out.
   */
  const allLoaded = page.total !== null ? assets.length >= page.total : assets.length < windowSize;
  const libraryTotal = page.total ?? assets.length;

  // Any view that answers a QUESTION about the library — inside a folder, a
  // type filter, or a search the server didn't run — must not be answered
  // from a 50-row window, or an operator opens a folder full of files and is
  // told it is empty. Widen once, to the size this page always used to load.
  const needsFullScan =
    currentFolderId !== null || filter !== 'all' || (!!debouncedSearch && !serverSearched);
  useEffect(() => {
    if (needsFullScan) setWindowSize((w) => (w < FULL_SCAN_TAKE ? FULL_SCAN_TAKE : w));
  }, [needsFullScan]);

  // Reset the draft each time the operator opens a different asset.
  useEffect(() => {
    setAltTextDraft(selectedAsset?.altText ?? '');
    setAltTextDirty(false);
  }, [selectedAsset?.id, selectedAsset?.altText]);

  // Usage for the OPEN asset (§15). Its own query so the modal can show
  // loading / known / unknown without the page caring.
  const usageQuery = useAssetUsage(selectedAsset?.id ?? null);

  const apiBase = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1').replace('/api/v1', '');

  // Folder helpers
  const allFolders: any[] = useMemo(() => folders || [], [folders]);
  const currentFolderChildren = allFolders.filter((f: any) => f.parentId === currentFolderId);
  const currentFolder = currentFolderId ? allFolders.find((f: any) => f.id === currentFolderId) : null;

  // Build breadcrumb trail
  const breadcrumbs: { id: string | null; name: string }[] = [{ id: null, name: t('assetsLib.allFiles') }];
  if (currentFolder) {
    const trail: any[] = [];
    let f = currentFolder;
    while (f) {
      trail.unshift(f);
      f = f.parentId ? allFolders.find((x: any) => x.id === f.parentId) : null;
    }
    trail.forEach((seg: any) => breadcrumbs.push({ id: seg.id, name: seg.name }));
  }
  // §8 — long paths truncate from the MIDDLE, preserving root and the
  // folder the operator is standing in.
  const crumbsToRender: Array<{ id: string | null; name: string } | 'ellipsis'> =
    breadcrumbs.length > 4
      ? [breadcrumbs[0], 'ellipsis', breadcrumbs[breadcrumbs.length - 2], breadcrumbs[breadcrumbs.length - 1]]
      : breadcrumbs;

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    await createFolder.mutateAsync({ name: newFolderName.trim(), parentId: currentFolderId || undefined });
    setNewFolderName('');
    setShowNewFolder(false);
  };

  const handleRenameFolder = async (id: string) => {
    if (!renameValue.trim()) return;
    await renameFolder.mutateAsync({ id, name: renameValue.trim() });
    setRenamingFolder(null);
    setRenameValue('');
  };

  const handleDeleteFolder = async (id: string) => {
    const ok = await appConfirm({
      title: t('assetsLib.deleteFolderTitle'),
      message: t('assetsLib.deleteFolderMsg'),
      tone: 'warn',
      confirmLabel: t('assetsLib.deleteFolder'),
    });
    if (ok) {
      await deleteFolderMut.mutateAsync(id);
      if (currentFolderId === id) setCurrentFolderId(null);
    }
  };

  const handleMoveAssetToFolder = async (assetId: string, folderId: string | null) => {
    await moveAsset.mutateAsync({ id: assetId, folderId });
  };

  // ─── Deletion (§16) ────────────────────────────────────────────────
  //
  // The old flow was a generic "will be permanently deleted" confirm that
  // told the operator nothing about blast radius. Now: ask the usage
  // endpoint FIRST, then take one of four paths — protected, in-use,
  // known-unused, or usage-unknown — and say which one it is. There is no
  // force-delete branch.

  const loadUsage = async (id: string): Promise<AssetUsage | null> => {
    try {
      return await queryClient.fetchQuery({
        queryKey: assetUsageQueryKey(id),
        queryFn: () => fetchAssetUsage(id),
        staleTime: 15_000,
        retry: false,
      });
    } catch {
      return null; // UNKNOWN — never treated as "unused"
    }
  };

  const usageInUse = (u: AssetUsage | null) =>
    !!u && (u.totals?.playlists ?? u.playlists?.length ?? 0) > 0;

  const requestDeleteAsset = async (a: any) => {
    const name = assetName(a);
    const usage = await loadUsage(a.id);

    if (usage?.protectedEmergency) {
      await appAlert({
        title: 'Protected emergency content',
        message:
          'This asset is protected emergency content and cannot be removed here. Open Emergency settings to review it.',
        tone: 'warn',
        confirmLabel: 'OK',
      });
      return;
    }
    if (usageInUse(usage)) {
      setInUseBlock({ asset: a, usage: usage as AssetUsage });
      return;
    }

    const ok = await appConfirm({
      title: `Delete "${name}"?`,
      message: usage
        ? 'This asset is not used by any playlist. It will be permanently deleted and cannot be restored.'
        : "We couldn't check where this asset is used, so it may still be playing on a screen. It will be permanently deleted and cannot be restored.",
      tone: 'danger',
      confirmLabel: 'Delete',
    });
    if (!ok) return;

    try {
      await deleteAsset.mutateAsync(a.id);
      setSelectedIds((p) => p.filter((id) => id !== a.id));
      if (selectedAsset?.id === a.id) closeDetail();
    } catch (e: any) {
      // The server is the last word: a 409 hands back the same usage shape,
      // so the operator sees exactly what is holding the file.
      const serverUsage: AssetUsage | undefined = e?.body?.usage;
      if (e?.status === 409 && serverUsage) {
        setInUseBlock({ asset: a, usage: serverUsage });
        return;
      }
      clog.error('upload', 'Delete failed', { id: a.id, msg: e?.message });
      await appAlert({
        title: "Couldn't delete this asset",
        message: e?.message || 'Please try again in a moment.',
        tone: 'danger',
        confirmLabel: 'OK',
      });
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    const ok = await appConfirm({
      title: `Delete ${selectedIds.length} ${selectedIds.length === 1 ? 'asset' : 'assets'}?`,
      message:
        `We check each file for playlist usage as it goes. Anything still in use is kept and reported back. ` +
        `Deleted files cannot be restored.`,
      tone: 'danger',
      confirmLabel: 'Delete',
    });
    if (!ok) return;

    // Track which deletes fail so we can surface a user-visible error
    // instead of just console.error (the old behavior swallowed every
    // 409 silently and the operator thought the delete succeeded).
    const failures: Array<{ id: string; msg: string }> = [];
    const inUse: string[] = [];
    const ids = [...selectedIds];
    await Promise.all(
      ids.map((id) =>
        deleteAsset.mutateAsync(id).catch((e: any) => {
          if (e?.status === 409) inUse.push(id);
          const msg = e?.message || 'Unknown error';
          failures.push({ id, msg });
          clog.error('upload', 'Delete failed', { id, msg });
        }),
      ),
    );
    setSelectedIds([]);
    queryClient.invalidateQueries({ queryKey: ['assets'] });
    if (failures.length > 0) {
      // §13 — every bulk operation reports per-asset success/failure, and
      // protected / in-use assets are explained rather than lumped in.
      await appAlert({
        title: 'Some assets were kept',
        message:
          `${ids.length - failures.length} of ${ids.length} deleted. ` +
          (inUse.length > 0
            ? `${inUse.length} ${inUse.length === 1 ? 'is' : 'are'} still used by a playlist and ${inUse.length === 1 ? 'was' : 'were'} kept — open one to see where. `
            : '') +
          (failures.length > inUse.length ? `First error: "${failures[0].msg}"` : ''),
        tone: 'warn',
        confirmLabel: 'OK',
      });
    }
  };

  // Bulk-move handler — fed by the searchable FolderPicker. Replaces
  // the old flat dropdown that stopped being usable past ~20 folders.
  const handleBulkMove = async (targetFolderId: string | null) => {
    if (selectedIds.length === 0) return;
    await Promise.all(
      selectedIds.map((id) => moveAsset.mutateAsync({ id, folderId: targetFolderId }).catch((e) => clog.error('upload', 'Move failed', { id, msg: e?.message }))),
    );
    setSelectedIds([]);
    queryClient.invalidateQueries({ queryKey: ['assets'] });
  };

  // Called by FolderPicker on confirm. Three flows:
  //   - 'upload' with pendingFiles: user dropped files, we retain them
  //     across the picker so they don't have to select again.
  //   - 'upload' WITHOUT pendingFiles: user clicked Upload files. Open the
  //     native file chooser with the chosen folder as the destination.
  //   - 'bulk-move' / 'single-move': apply the folder to the selection.
  const handleFolderPicked = (folderId: string | null) => {
    const mode = showFolderPicker;
    const single = moveTargetId;
    setShowFolderPicker(null);
    setMoveTargetId(null);
    if (mode === 'upload') {
      if (pendingFiles.length > 0) {
        handleFiles(pendingFiles, folderId);
        setPendingFiles([]);
      } else {
        // Button flow: no files yet. Stash the destination on the hidden
        // input via a data attribute the onChange handler reads, then pop
        // the file chooser.
        const input = fileInputRef.current;
        if (input) {
          input.dataset.overrideFolderId = folderId === null ? '__root__' : folderId;
          input.click();
        }
      }
    } else if (mode === 'bulk-move') {
      void handleBulkMove(folderId);
    } else if (mode === 'single-move' && single) {
      void handleMoveAssetToFolder(single, folderId);
      if (selectedAsset?.id === single) {
        setSelectedAsset({ ...selectedAsset, folderId, folder: allFolders.find((f: any) => f.id === folderId) ?? null });
      }
    }
  };

  const handleFiles = useCallback((files: FileList | File[] | null, targetFolderIdOverride?: string | null) => {
    if (!files) return;
    const list = Array.isArray(files) ? files : Array.from(files);
    if (list.length === 0) return;
    const genId = () => { try { return crypto.randomUUID(); } catch { return Math.random().toString(36).substring(2, 10); } };
    const items = list.map((file) => {
      const item: UploadItem = { id: genId(), file, progress: 0, phase: 'idle' };
      // Reject BEFORE any network call. The order matters: format check
      // first (we'd rather tell the operator "export as MP4" than "too
      // large" if both happen to be true on the same file). Both states
      // surface in the upload queue so the operator sees which file is
      // blocked and why.
      const unsupportedReason = getUnsupportedReason(file);
      if (unsupportedReason) { item.phase = 'error'; item.error = unsupportedReason; }
      else if (file.size > MAX_FILE_SIZE) { item.phase = 'error'; item.error = `File exceeds 500 MB (this one is ${fmtSize(file.size)})`; }
      return item;
    });
    setUploads(prev => [...items, ...prev]);
    // Concurrency-limited uploader. Operator (2026-04-29): tried to
    // upload 42MB across 8+ images at once, every request died with a
    // network error; single-file uploads worked. Root cause: previous
    // `.forEach((u) => doUpload(u))` fired all uploads in parallel,
    // which overwhelms one of: Vercel→Railway proxy connection cap,
    // Multer's in-memory parser (each large file holds its own buffer
    // + a SHA-256 working buffer), Supabase storage's per-bucket rate
    // limit, or the Prisma connection pool. 3-in-flight is the sweet
    // spot — empirically what Yodeck / Rise / OptiSigns serialize at,
    // fast for small batches, doesn't hammer any single downstream.
    // Everything past the first three sits in the queue reading
    // "Waiting" (§14), which is the truth.
    const MAX_CONCURRENT_UPLOADS = 3;
    const queue = items.filter((u) => u.phase === 'idle').slice();
    const runWorker = async (): Promise<void> => {
      while (true) {
        const next = queue.shift();
        if (!next) return;
        try { await doUpload(next, targetFolderIdOverride); } catch { /* error already surfaced via UI state */ }
      }
    };
    const workerCount = Math.min(MAX_CONCURRENT_UPLOADS, queue.length);
    const workers = Array.from({ length: workerCount }, () => runWorker());
    void Promise.all(workers);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doUpload = async (item: UploadItem, targetFolderIdOverride?: string | null): Promise<void> => {
    // Destination precedence:
    //   1. Explicit override from the FolderPicker
    //   2. Current browsed folder (uploads into whatever is open)
    //   3. Root
    // `targetFolderIdOverride === undefined` means no override; use
    // currentFolderId. `null` means "explicit root".
    const targetFolderId =
      targetFolderIdOverride !== undefined ? targetFolderIdOverride : currentFolderId;

    const started = performance.now();
    clog.info('upload', 'Start', {
      id: item.id,
      name: item.file.name,
      size: item.file.size,
      mime: item.file.type,
      folderId: targetFolderId || '(root)',
    });

    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';
    const token = useUIStore.getState().token;
    const postJson = async <T,>(path: string, body: Record<string, unknown>): Promise<T> => {
      const res = await fetch(`${apiUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        let msg = `${path} failed (${res.status})`;
        try {
          const payload = await res.json();
          msg = payload?.message || payload?.error || msg;
        } catch {}
        throw new Error(msg);
      }

      return res.json() as Promise<T>;
    };

    const setPhase = (phase: UploadPhase, progress?: number) => {
      setUploads(p => p.map(u => u.id === item.id ? { ...u, phase, ...(progress !== undefined ? { progress } : {}) } : u));
    };
    const setProgress = (progress: number) => {
      setUploads(p => p.map(u => u.id === item.id ? { ...u, progress } : u));
    };

    const uploadToSignedUrl = (signed: PresignedUploadResponse): Promise<void> => new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const storageProgress = Math.round((e.loaded * 90) / e.total);
          setProgress(Math.min(95, 5 + storageProgress));
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          setProgress(96);
          resolve();
        } else {
          let msg = `Storage unavailable — try again later (${xhr.status})`;
          try {
            const payload = JSON.parse(xhr.responseText);
            msg = payload?.message || payload?.error || msg;
          } catch {}
          reject(new Error(msg));
        }
      };
      xhr.onerror = () => {
        reject(new Error('Network interrupted while sending the file. The file reached the direct storage step, so check Supabase Storage CORS/network and MIME settings, then try again.'));
      };
      xhr.onabort = () => reject(new Error(t('assetsLib.cancelled')));
      // Supabase signed upload URLs require PUT, not POST. POST returns
      // a generic "headers must have required" error from Supabase's
      // storage edge handler. Operator hit this on every MP4 upload
      // after Codex's d29e6c5 switched to direct-storage uploads.
      xhr.open('PUT', signed.uploadUrl || signed.signedUrl);
      xhr.setRequestHeader('Content-Type', signed.mimeType || item.file.type || 'application/octet-stream');
      // SUPABASE EGRESS FIX (2026-05-23): Supabase signed-URL uploads
      // default the stored object's cache-control to `no-cache`, which
      // re-causes the 11.7GB-from-273MB-stored egress incident we hit
      // with the legacy multipart path. Assets here are content-addressed
      // (UUID filenames) and never mutated in place, so caching for one
      // year + immutable is correct. Supabase storage server reads this
      // header verbatim and stores it on the object's metadata, so every
      // future GET serves with the same Cache-Control and edge PoPs only
      // pull origin once per asset per year.
      xhr.setRequestHeader('Cache-Control', 'public, max-age=31536000, immutable');
      xhr.send(item.file);
    });

    try {
      setPhase('uploading', 2);
      const signed = await postJson<PresignedUploadResponse>('/assets/presign', {
        filename: item.file.name,
        contentType: item.file.type || 'application/octet-stream',
        size: item.file.size,
        folderId: targetFolderId || null,
      });
      setProgress(5);
      await uploadToSignedUrl(signed);
      // The bytes are in storage but the asset does NOT exist yet — §14:
      // "Do not mark an asset Ready until upload completion AND server
      // registration succeed."
      setPhase('processing', 98);
      const created = await postJson<any>('/assets/complete-upload', {
        storagePath: signed.storagePath,
        filename: item.file.name,
        contentType: signed.mimeType || item.file.type || 'application/octet-stream',
        size: item.file.size,
        folderId: targetFolderId || null,
      });
      const elapsedMs = Math.round(performance.now() - started);
      clog.info('upload', 'Success', { id: item.id, name: item.file.name, elapsedMs });
      // A contributor's upload lands in the review queue — say so instead
      // of "Ready", which would be a lie about what is on screen.
      const needsReview = created?.status === 'PENDING_APPROVAL';
      setUploads(p => p.map(u => u.id === item.id ? { ...u, progress: 100, phase: needsReview ? 'pending-review' : 'success' } : u));
      queryClient.invalidateQueries({ queryKey: ['assets'] });
    } catch (err: any) {
      const elapsedMs = Math.round(performance.now() - started);
      const msg = err?.message || t('assetsLib.uploadFailed');
      clog.error('upload', 'Failed', { id: item.id, name: item.file.name, msg, elapsedMs });
      setUploads(p => p.map(u => u.id === item.id ? { ...u, phase: 'error', error: msg } : u));
    }
  };

  const handleAddUrl = async () => {
    if (!webUrl.trim()) return;
    // HONESTY GATE (2026-07-10 — operator pushed a peacocktv.com playback
    // URL to an LED wall and got "browser isn't supported"): DRM-protected
    // streaming services can NEVER play inside a signage iframe/proxy —
    // Widevine/FairPlay refuse unrecognized embedded browsers by design,
    // on every signage CMS. Blocking with a clear explanation beats
    // letting the operator publish a guaranteed-black screen.
    const DRM_STREAMING = /(^|\.)(peacocktv|netflix|hulu|disneyplus|max|primevideo|paramountplus|fubo|sling)\.com$|(^|\.)tv\.apple\.com$/i;
    try {
      const host = new URL(webUrl.trim().startsWith('http') ? webUrl.trim() : `https://${webUrl.trim()}`).hostname;
      if (DRM_STREAMING.test(host)) {
        await appAlert({
          title: "Streaming services can't play on signage",
          message:
            `${host} uses DRM copy-protection that blocks playback inside any signage player (this is true on every signage platform, not just VenueOS). ` +
            `For live video on screens, use a YouTube/Twitch/Vimeo embed, an HLS stream URL, or an HDMI source into the display.`,
          tone: 'danger',
          confirmLabel: t('assetsLib.gotIt'),
        });
        return;
      }
    } catch { /* unparseable URL — let the backend validate */ }
    // Route to the current folder so the newly-added URL appears
    // where the operator is standing, not at root (the old behavior
    // made the asset "vanish" for anyone inside a folder).
    await addWebUrl.mutateAsync({ url: webUrl.trim(), folderId: currentFolderId });
    setWebUrl('');
    setShowUrlForm(false);
  };

  // ─── Derived list ─────────────────────────────────────────────────
  const searchLower = search.trim().toLowerCase();
  const folderNameById = useMemo(() => {
    const m = new Map<string, string>();
    allFolders.forEach((f: any) => m.set(f.id, f.name));
    return m;
  }, [allFolders]);

  const matchesSearch = (a: any) => {
    if (!searchLower) return true;
    // §7 — name, folder path, media type, uploader, alt text.
    const haystack = [
      a.originalName,
      a.fileUrl,
      a.mimeType,
      a.altText,
      a.uploadedBy?.email,
      a.folderId ? folderNameById.get(a.folderId) : '',
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(searchLower);
  };

  const folderAssets = assets.filter((a: any) => a.folderId === (currentFolderId ?? null));
  const filtered = useMemo(() => {
    const rows = folderAssets.filter((a: any) => {
      if (filter !== 'all' && getAssetType(a.mimeType) !== filter) return false;
      return matchesSearch(a);
    });
    const byName = (a: any) => (a.originalName || a.fileUrl || '').toLowerCase();
    const byDate = (a: any) => new Date(a.createdAt || 0).getTime();
    const bySize = (a: any) => a.fileSize || 0;
    const sorted = [...rows];
    if (sort === 'newest') sorted.sort((a, b) => byDate(b) - byDate(a));
    else if (sort === 'oldest') sorted.sort((a, b) => byDate(a) - byDate(b));
    else if (sort === 'nameAsc') sorted.sort((a, b) => byName(a).localeCompare(byName(b)));
    else if (sort === 'nameDesc') sorted.sort((a, b) => byName(b).localeCompare(byName(a)));
    else if (sort === 'largest') sorted.sort((a, b) => bySize(b) - bySize(a));
    else if (sort === 'smallest') sorted.sort((a, b) => bySize(a) - bySize(b));
    return sorted;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assets, currentFolderId, filter, sort, searchLower, folderNameById]);

  // §7 — chip counts must describe the COMPLETE library, so they only
  // render once we know we hold it. The All chip can always show the true
  // total because the server hands that number back.
  const typeCounts = useMemo(() => ({
    all: libraryTotal,
    images: folderAssets.filter((a: any) => a.mimeType?.startsWith('image/')).length,
    videos: folderAssets.filter((a: any) => a.mimeType?.startsWith('video/')).length,
    audio: folderAssets.filter((a: any) => a.mimeType?.startsWith('audio/')).length,
    urls: folderAssets.filter((a: any) => a.mimeType === 'text/html').length,
    documents: folderAssets.filter((a: any) => a.mimeType === 'application/pdf').length,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [assets, currentFolderId, libraryTotal]);

  const thumbUrl = (a: any) => {
    // URL assets: render a homepage screenshot so the library tile
    // shows something meaningful instead of a generic globe icon.
    // WordPress's free mshots service has been running since ~2010,
    // requires no API key, is same-origin-safe, and serves through
    // their CDN. First request against a new URL can return a
    // placeholder while it warms — the second hit has the real
    // screenshot. We don't cache it ourselves; the browser + CDN
    // handle that for us.
    if (a.mimeType === 'text/html' && a.fileUrl) {
      return `https://s.wordpress.com/mshots/v1/${encodeURIComponent(a.fileUrl)}?w=640&h=360`;
    }
    if (!a.mimeType?.startsWith('image/') && !a.mimeType?.startsWith('video/')) return null;
    const raw = a.fileUrl?.startsWith('http') ? a.fileUrl : `${apiBase}${a.fileUrl}`;
    // 2026-05-30 — EGRESS FIX: use Supabase render/image transform for
    // image thumbnails (~320 px tiles) to avoid downloading full-res
    // assets for every grid cell. Video thumbnails skip transforms.
    if (a.mimeType?.startsWith('image/')) {
      return transformedImageUrl(raw, { width: 320, quality: 60 });
    }
    return raw;
  };
  const isVideo = (a: any) => a.mimeType?.startsWith('video/');
  const isUrl = (a: any) => a.mimeType === 'text/html';
  // 2026-05-26 — operator: "the PDF still doesnt have a preview under
  // the asset section but it does now under the playlist section".
  const isPdf = (a: any) => {
    if (!a) return false;
    const m = a.mimeType || '';
    if (m === 'application/pdf' || m === 'application/x-pdf') return true;
    const url = String(a.fileUrl || '').split('?')[0].split('#')[0].toLowerCase();
    return url.endsWith('.pdf');
  };
  const assetName = (a: any) => a.originalName || (a.mimeType === 'text/html' ? a.fileUrl : a.fileUrl?.split('/').pop()) || 'Untitled';
  const absoluteUrl = (a: any) =>
    a?.fileUrl?.startsWith('http') ? a.fileUrl : `${apiBase}${a?.fileUrl || ''}`;

  /** §11 metadata line — type, then real dimensions when we have them. */
  const metaLine = (a: any) => {
    const dims = metaDims(a);
    if (isUrl(a)) {
      let host = '';
      try { host = new URL(a.fileUrl).hostname.replace(/^www\./, ''); } catch { host = ''; }
      return host ? `LINK · ${host}` : 'LINK';
    }
    return dims ? `${shortType(a.mimeType)} · ${dims.w} × ${dims.h}` : shortType(a.mimeType);
  };

  const openDetail = (a: any, opener?: HTMLElement | null) => {
    detailOpenerRef.current = opener ?? (document.activeElement as HTMLElement | null);
    setSelectedAsset(a);
  };
  const closeDetail = () => {
    setSelectedAsset(null);
    const opener = detailOpenerRef.current;
    detailOpenerRef.current = null;
    if (opener?.isConnected) requestAnimationFrame(() => opener.focus());
  };

  const downloadAsset = (a: any) => {
    const link = document.createElement('a');
    link.href = absoluteUrl(a);
    link.download = assetName(a);
    link.target = '_blank';
    link.rel = 'noreferrer';
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const copyAssetLink = async (a: any) => {
    const url = absoluteUrl(a);
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Asset link copied');
    } catch {
      toast.error("Couldn't copy the link — select the URL in the asset details instead.");
    }
  };

  const menuActionsFor = (a: any) =>
    buildAssetMenuActions({
      onViewDetails: () => openDetail(a),
      onCreatePlaylist: () => startPlaylistFrom([a.id]),
      onMoveToFolder: () => { setMoveTargetId(a.id); setShowFolderPicker('single-move'); },
      onDownload: () => downloadAsset(a),
      onCopyLink: () => void copyAssetLink(a),
      onDelete: () => void requestDeleteAsset(a),
      disabled: isViewer,
      disabledReason: readOnlyReason,
    });

  // Server-measured dims first (see metaDims). Legacy assets without
  // processing meta fall back to client measuring — against the ORIGINAL
  // file URL, never the 320px transformed thumbnail (measuring the thumb
  // was the "wrong resolution vs every other CMS" bug, 2026-07-09).
  const selectedMetaDims = selectedAsset ? metaDims(selectedAsset) : null;
  const selectedRawUrl =
    selectedAsset?.fileUrl && selectedAsset.mimeType?.startsWith('image/')
      ? absoluteUrl(selectedAsset)
      : null;
  const measuredDims = useImageDimensions(selectedMetaDims ? null : selectedRawUrl);
  const selectedDims = selectedMetaDims ?? measuredDims;

  // Close folder context menu on outside click
  useEffect(() => {
    if (!folderMenuOpen) return;
    const handler = () => setFolderMenuOpen(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [folderMenuOpen]);

  // Close the "Add asset" menu on outside click / Escape
  useEffect(() => {
    if (!addMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!addMenuRef.current?.contains(e.target as Node)) setAddMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setAddMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [addMenuOpen]);

  // Focus URL input when the URL form opens
  useEffect(() => {
    if (showUrlForm) urlInputRef.current?.focus();
  }, [showUrlForm]);

  // Focus new-folder input when the folder form opens
  useEffect(() => {
    if (showNewFolder) newFolderInputRef.current?.focus();
  }, [showNewFolder]);

  // §21 — detail modal: Escape closes, Tab is trapped, background is inert
  // (the scrim button covers it), focus returns to the originating card via
  // closeDetail().
  useEffect(() => {
    if (!selectedAsset) return;
    const node = detailRef.current;
    requestAnimationFrame(() => {
      node?.querySelector<HTMLElement>('[data-detail-initial-focus]')?.focus();
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); closeDetail(); return; }
      if (e.key !== 'Tab' || !node) return;
      const focusables = Array.from(
        node.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAsset?.id]);

  // ─── Page-level drag target (§6) ───────────────────────────────────
  const onPageDragEnter = (e: React.DragEvent) => {
    if (isViewer) return;
    if (!Array.from(e.dataTransfer?.types || []).includes('Files')) return;
    dragDepth.current += 1;
    setDragOver(true);
  };
  const onPageDragLeave = () => {
    if (isViewer) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragOver(false);
  };
  const onPageDrop = (e: React.DragEvent) => {
    if (isViewer) return;
    const files = Array.from(e.dataTransfer?.files || []);
    dragDepth.current = 0;
    setDragOver(false);
    if (files.length === 0) return;
    e.preventDefault();
    // Retain the dropped files across the destination picker (§14).
    setPendingFiles(files);
    setShowFolderPicker('upload');
  };

  const openUploadPicker = () => { setPendingFiles([]); setShowFolderPicker('upload'); };

  const filesHeading =
    filter !== 'all'
      ? t(`assetsLib.filter${filter.charAt(0).toUpperCase() + filter.slice(1)}` as any)
      : search
      ? 'Search results'
      : sort === 'newest'
      ? 'Recent files'
      : 'Files';

  const folderCount = allFolders.length;
  const showFolderSection = currentFolderChildren.length > 0;
  const visibleFolders = showAllFolders ? currentFolderChildren : currentFolderChildren.slice(0, FOLDERS_PREVIEW_LIMIT);

  return (
    // The page-wide drop target (§6). Drag-and-drop has no keyboard
    // equivalent by nature; the keyboard/AT path to the same flow is the
    // focusable upload strip below and the header's Upload files button,
    // so this wrapper deliberately carries drag handlers only.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      className="space-y-5 relative"
      onDragEnter={onPageDragEnter}
      onDragOver={(e) => { if (!isViewer && Array.from(e.dataTransfer?.types || []).includes('Files')) e.preventDefault(); }}
      onDragLeave={onPageDragLeave}
      onDrop={onPageDrop}
    >
      {/* ── Header (§5) — exactly two controls. Bulk actions never live here. */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">{t('assetsLib.title')}</h1>
          <p className="text-sm text-slate-600 mt-0.5" data-testid="library-subtitle">
            {t('assetsLib.subtitleScope', { assets: libraryTotal, folders: folderCount })}
          </p>
        </div>
        <div className="flex gap-2 items-center">
          {/* Add asset — the secondary menu that keeps URL + AI out of the
              header as permanent buttons (§5 / §25). */}
          <div className="relative" ref={addMenuRef}>
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={addMenuOpen}
              onClick={() => setAddMenuOpen((v) => !v)}
              disabled={isViewer}
              title={isViewer ? readOnlyReason : undefined}
              className="min-h-11 sm:min-h-0 px-3 py-2 bg-white border border-slate-300 hover:border-slate-400 text-slate-700 text-xs font-semibold rounded-lg transition-colors flex items-center gap-2 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Add asset <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            </button>
            {addMenuOpen && (
              <div
                role="menu"
                tabIndex={-1}
                aria-label="Add asset"
                className="absolute right-0 top-full mt-1 z-40 min-w-[228px] bg-white border border-slate-200 rounded-xl shadow-xl py-1"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { setAddMenuOpen(false); openUploadPicker(); }}
                  className="w-full px-3 py-2 min-h-11 sm:min-h-0 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                >
                  <UploadCloud className="w-3.5 h-3.5 text-indigo-500" /> Upload files
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { setAddMenuOpen(false); setShowUrlForm(true); }}
                  className="w-full px-3 py-2 min-h-11 sm:min-h-0 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                >
                  <Link2 className="w-3.5 h-3.5 text-emerald-500" /> Add web URL
                </button>
                {/* Renders NOTHING when no AI provider is configured, so the
                    menu never offers an option that can't work (§5). */}
                <AiImageGenerateButton
                  renderAs="menuitem"
                  disabled={isViewer}
                  onOpen={() => setAddMenuOpen(false)}
                />
              </div>
            )}
          </div>

          <button
            onClick={openUploadPicker}
            disabled={isViewer}
            /* 2026-05-29 (mobile P1) — min-h-11 on touch (was 34px). */
            className="min-h-11 sm:min-h-0 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-lg shadow-sm transition-colors flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
            title={isViewer ? readOnlyReason : 'Pick a destination folder (root is an option), then select files'}
          >
            <UploadCloud className="w-4 h-4" />
            Upload files
          </button>
          <input
            type="file"
            multiple
            className="hidden"
            ref={fileInputRef}
            accept={ACCEPT_STRING}
            onChange={e => {
              // The FolderPicker stashes the chosen destination on a
              // data attribute before popping the file chooser:
              //   - undefined = no picker fired, use currentFolderId
              //   - '__root__' = explicit root
              //   - <folderId> = specific folder
              const raw = e.currentTarget.dataset.overrideFolderId;
              e.currentTarget.dataset.overrideFolderId = '';
              const override: string | null | undefined =
                raw === undefined || raw === ''
                  ? undefined
                  : raw === '__root__'
                  ? null
                  : raw;
              handleFiles(e.target.files, override);
              // Reset so re-selecting the same file fires onChange.
              e.currentTarget.value = '';
            }}
          />
        </div>
      </div>

      {/* Add web URL — a compact inline panel, opened from the menu, never a
          permanent form (§5). */}
      {showUrlForm && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex gap-3">
          <input
            ref={urlInputRef}
            value={webUrl}
            onChange={e => setWebUrl(e.target.value)}
            aria-label="Web page address"
            placeholder="https://docs.google.com/presentation/d/..."
            className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-indigo-500"
            onKeyDown={e => { if (e.key === 'Enter') handleAddUrl(); if (e.key === 'Escape') setShowUrlForm(false); }}
          />
          <button
            onClick={handleAddUrl}
            disabled={addWebUrl.isPending || isViewer}
            title={isViewer ? readOnlyReason : undefined}
            className="px-4 py-2 min-h-11 sm:min-h-0 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold rounded-lg"
          >{addWebUrl.isPending ? t('assetsLib.adding') : t('assetsLib.addUrl')}</button>
          <button onClick={() => setShowUrlForm(false)} aria-label="Close" className="px-2 text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* ── Compact upload strip (§6). Desktop-only: you can't drag a file on
          a phone and the header already has Upload files. The whole page is
          the drop target; this strip is the affordance that says so. */}
      <button
        type="button"
        disabled={isViewer}
        aria-label={isViewer ? t('assetsLib.uploadDisabledViewer') : t('assetsLib.uploadAria')}
        title={isViewer ? readOnlyReason : undefined}
        onClick={openUploadPicker}
        data-testid="upload-strip"
        className={`hidden md:flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
          isViewer
            ? 'opacity-50 cursor-not-allowed border-slate-200 bg-slate-50'
            : dragOver
            ? 'border-indigo-400 bg-indigo-50 cursor-pointer'
            : 'border-slate-200 bg-slate-50/70 hover:border-indigo-300 hover:bg-indigo-50/40 cursor-pointer'
        }`}
      >
        <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${dragOver ? 'bg-indigo-100' : 'bg-white border border-slate-200'}`}>
          <UploadCloud className="w-4 h-4 text-indigo-500" />
        </span>
        <span className="min-w-0">
          <span className="block text-xs font-bold text-slate-800">
            {dragOver ? 'Drop the files — we’ll ask where to put them' : 'Drop files anywhere to upload'}
          </span>
          <span className="block text-[11px] text-slate-500 mt-0.5">{SUPPORTED_COPY}</span>
        </span>
      </button>

      {/* ── Upload queue (§14) ───────────────────────────────────────── */}
      {uploads.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden" data-testid="upload-queue">
          <div className="px-4 py-2.5 border-b border-slate-100 flex justify-between items-center bg-slate-50/70">
            <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">{t('assetsLib.uploads')}</span>
            <button onClick={() => setUploads(p => p.filter(u => u.phase === 'uploading' || u.phase === 'processing' || u.phase === 'idle'))} className="text-[11px] text-indigo-700 hover:text-indigo-900 font-bold">{t('assetsLib.clearDone')}</button>
          </div>
          <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto" aria-live="polite">
            {uploads.map(u => (
              <div key={u.id} className="px-4 py-2">
                <div className="flex items-center gap-3">
                  {typeIcon(u.file.type, 'w-3.5 h-3.5')}
                  <span className="flex-1 text-[11px] font-medium text-slate-700 truncate" title={u.file.name}>{u.file.name}</span>
                  <span className="text-[10px] text-slate-500 shrink-0">{fmtSize(u.file.size)}</span>
                  <span
                    className={`text-[10px] font-bold shrink-0 ${
                      u.phase === 'error' ? 'text-rose-700'
                      : u.phase === 'success' ? 'text-emerald-700'
                      : u.phase === 'pending-review' ? 'text-amber-700'
                      : 'text-slate-500'
                    }`}
                  >
                    {UPLOAD_PHASE_LABEL[u.phase]}
                  </span>
                  {(u.phase === 'uploading' || u.phase === 'processing') && (
                    <div className="w-20 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-indigo-500 transition-all rounded-full" style={{ width: `${u.progress}%` }} />
                    </div>
                  )}
                  {u.phase === 'success' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />}
                  {u.phase === 'error' && <X className="w-3.5 h-3.5 text-rose-600 shrink-0" />}
                </div>
                {/* Error reason on its own row so long messages (export-as-MP4
                    guidance, file-too-large, server validation errors) can
                    wrap and stay legible. Title attribute preserves the full
                    text on hover so even if it's clipped by vertical
                    scrolling the operator can still read it. */}
                {u.phase === 'error' && u.error && (
                  <p className="text-[10px] text-rose-700 font-medium leading-snug mt-1 ml-6 pr-2" title={u.error}>{u.error}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Search / filters / sort / view (§7) ──────────────────────── */}
      <div className="flex flex-col lg:flex-row gap-3 lg:items-center lg:justify-between">
        <div className="relative w-full lg:w-[340px] lg:shrink-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" aria-hidden />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') { setSearch(''); } }}
            aria-label="Search the media library"
            placeholder={t('assetsLib.searchPlaceholder')}
            className="w-full min-h-11 sm:min-h-0 pl-9 pr-9 py-2 bg-white border border-slate-300 rounded-lg text-xs text-slate-800 placeholder-slate-400 outline-none focus:ring-2 focus:ring-indigo-500"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Media filters — horizontally scrollable on narrow viewports (§7). */}
        <div
          role="group"
          aria-label="Filter by media type"
          className="flex gap-1.5 overflow-x-auto lg:overflow-visible -mx-1 px-1 lg:mx-0 lg:px-0 lg:flex-1 lg:justify-center"
        >
          {(['all','images','videos','audio','urls','documents'] as FilterType[]).map(f => {
            const active = filter === f;
            // Truth rule: a per-type count describes the whole library, so it
            // only appears when we hold the whole library. The All chip can
            // always show the server's total.
            const showCount = f === 'all' || allLoaded;
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                aria-pressed={active}
                className={`shrink-0 min-h-11 sm:min-h-0 px-3 py-2 text-[11px] font-bold rounded-lg border transition-colors flex items-center gap-1.5 ${
                  active
                    ? 'bg-indigo-50 border-indigo-300 text-indigo-800'
                    : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                }`}
              >
                {t(`assetsLib.filter${f.charAt(0).toUpperCase()+f.slice(1)}` as any)}
                {showCount && (
                  <span className={active ? 'text-indigo-500' : 'text-slate-400'}>{typeCounts[f]}</span>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex gap-2 items-center lg:shrink-0">
          <label className="sr-only" htmlFor="assets-sort">Sort files</label>
          <select
            id="assets-sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="min-h-11 sm:min-h-0 px-3 py-2 bg-white border border-slate-300 rounded-lg text-[11px] font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
              <option key={k} value={k}>{SORT_LABELS[k]}</option>
            ))}
          </select>
          <div className="flex border border-slate-300 rounded-lg overflow-hidden bg-white">
            <button onClick={()=>setViewMode('grid')} aria-label={t('assetsLib.gridView')} aria-pressed={viewMode==='grid'} className={`min-w-11 min-h-11 sm:min-w-0 sm:min-h-0 flex items-center justify-center p-2 ${viewMode==='grid'?'bg-indigo-50 text-indigo-700':'text-slate-500 hover:text-slate-700'}`}><Grid3X3 className="w-3.5 h-3.5" /></button>
            <button onClick={()=>setViewMode('list')} aria-label={t('assetsLib.listView')} aria-pressed={viewMode==='list'} className={`min-w-11 min-h-11 sm:min-w-0 sm:min-h-0 flex items-center justify-center p-2 border-l border-slate-200 ${viewMode==='list'?'bg-indigo-50 text-indigo-700':'text-slate-500 hover:text-slate-700'}`}><List className="w-3.5 h-3.5" /></button>
          </div>
        </div>
      </div>

      {/* ── Breadcrumb + New folder (§8) ─────────────────────────────── */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <nav aria-label="Folder path" className="flex items-center gap-1 text-xs flex-wrap">
          {crumbsToRender.map((bc, i) =>
            bc === 'ellipsis' ? (
              <span key="ellipsis" className="flex items-center gap-1 text-slate-400">
                <ChevronRight className="w-3 h-3" aria-hidden />
                <ChevronsRight className="w-3 h-3" aria-label="Skipped folders" />
              </span>
            ) : (
              <span key={bc.id ?? 'root'} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="w-3 h-3 text-slate-300" aria-hidden />}
                {i === crumbsToRender.length - 1 ? (
                  <span aria-current="page" className="px-2 py-1 rounded-md font-bold text-slate-900 bg-slate-100 flex items-center gap-1">
                    {bc.id === null && <Home className="w-3 h-3" aria-hidden />}
                    {bc.name}
                  </span>
                ) : (
                  <button
                    onClick={() => setCurrentFolderId(bc.id)}
                    className="px-2 py-1 rounded-md text-slate-600 hover:text-indigo-700 hover:bg-indigo-50 transition-colors flex items-center gap-1"
                  >
                    {bc.id === null && <Home className="w-3 h-3" aria-hidden />}
                    {bc.name}
                  </button>
                )}
              </span>
            ),
          )}
        </nav>
        <button
          onClick={() => setShowNewFolder(true)}
          disabled={isViewer}
          title={isViewer ? readOnlyReason : undefined}
          className="min-h-11 sm:min-h-0 px-3 py-2 bg-white border border-slate-300 hover:border-indigo-300 text-slate-700 text-[11px] font-bold rounded-lg transition-colors flex items-center gap-1.5 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <FolderPlus className="w-3.5 h-3.5 text-indigo-500" /> {t('assetsLib.newFolder')}
        </button>
      </div>

      {/* New folder input */}
      {showNewFolder && (
        <div className="flex gap-2 items-center bg-white rounded-xl border border-indigo-200 shadow-sm p-3">
          <Folder className="w-5 h-5 text-indigo-400 shrink-0" aria-hidden />
          <input
            ref={newFolderInputRef}
            value={newFolderName}
            onChange={e => setNewFolderName(e.target.value)}
            aria-label="New folder name"
            placeholder={t('assetsLib.folderNamePlaceholder')}
            className="flex-1 px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-indigo-400"
            onKeyDown={e => { if (e.key === 'Enter') handleCreateFolder(); if (e.key === 'Escape') { setShowNewFolder(false); setNewFolderName(''); } }}
          />
          <button
            onClick={handleCreateFolder}
            disabled={createFolder.isPending || isViewer}
            title={isViewer ? readOnlyReason : undefined}
            className="px-3 py-1.5 min-h-11 sm:min-h-0 bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {createFolder.isPending ? 'Creating...' : 'Create'}
          </button>
          <button onClick={() => { setShowNewFolder(false); setNewFolderName(''); }} aria-label="Cancel new folder" className="p-1 text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* ── Selection bar (§13) — contextual, never in the header ────── */}
      <AssetBulkBar
        count={selectedIds.length}
        disabled={isViewer}
        disabledReason={readOnlyReason}
        onCreatePlaylist={() => startPlaylistFrom(selectedIds)}
        onMoveToFolder={() => setShowFolderPicker('bulk-move')}
        onDownload={() => {
          // No archive endpoint exists, so this is N staggered downloads —
          // the browser may still ask the operator to allow multiple files.
          const rows = filtered.filter((a: any) => selectedIds.includes(a.id));
          rows.forEach((a: any, i: number) => setTimeout(() => downloadAsset(a), i * 350));
        }}
        onDelete={handleBulkDelete}
        onClear={() => setSelectedIds([])}
      />

      {/* ── Folders (§9) ────────────────────────────────────────────── */}
      {showFolderSection && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              Folders <span className="text-slate-400 font-semibold">{currentFolderChildren.length}</span>
            </h2>
            {currentFolderChildren.length > FOLDERS_PREVIEW_LIMIT && (
              <button
                onClick={() => setShowAllFolders(v => !v)}
                aria-expanded={showAllFolders}
                className="min-h-11 sm:min-h-0 px-2 -mr-2 text-xs font-bold text-indigo-700 hover:text-indigo-900 flex items-center gap-1"
              >
                {showAllFolders ? 'Show fewer folders' : 'View all folders'}
                <ChevronRight className="w-3 h-3" aria-hidden />
              </button>
            )}
          </div>
          <ul
            /* One column on a phone: a folder card carries a name, a count
               and a timestamp, and squeezing two of those into 165px turned
               every name into "Cam…". Breakpoints stay in the arbitrary
               bucket so they sort by width — mixing them with md:/lg: puts
               the named variant LAST in the sheet and it wins at every
               size (caught in the 1440px verification run). */
            className={`grid grid-cols-1 min-[560px]:grid-cols-2 min-[768px]:grid-cols-3 min-[1200px]:grid-cols-4 min-[1440px]:grid-cols-5 gap-3 list-none p-0 m-0 ${
              showAllFolders && currentFolderChildren.length > FOLDERS_PREVIEW_LIMIT
                ? 'max-h-[420px] overflow-y-auto pr-1'
                : ''
            }`}
          >
            {visibleFolders.map((f: any) => {
              const updated = fmtRelative(f.updatedAt);
              return (
                // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
                <li
                  key={f.id}
                  className="group bg-white rounded-xl border border-slate-200 hover:border-indigo-300 hover:shadow-sm transition-all relative"
                  onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('ring-2', 'ring-indigo-400'); }}
                  onDragLeave={e => { e.currentTarget.classList.remove('ring-2', 'ring-indigo-400'); }}
                  onDrop={e => {
                    e.preventDefault();
                    e.stopPropagation();
                    e.currentTarget.classList.remove('ring-2', 'ring-indigo-400');
                    const assetId = e.dataTransfer.getData('assetId');
                    if (assetId) handleMoveAssetToFolder(assetId, f.id);
                  }}
                >
                  <div className="flex items-center gap-2.5 px-3 py-2.5">
                    <button
                      className="flex items-center gap-2.5 flex-1 min-w-0 text-left"
                      onClick={() => setCurrentFolderId(f.id)}
                      aria-label={`Open folder ${f.name}`}
                    >
                      <FolderOpen className="w-7 h-7 text-amber-400 shrink-0" aria-hidden />
                      <span className="flex-1 min-w-0 block">
                        {renamingFolder === f.id ? (
                          <input
                            value={renameValue}
                            onChange={e => setRenameValue(e.target.value)}
                            onBlur={() => handleRenameFolder(f.id)}
                            aria-label={`Rename folder ${f.name}`}
                            onKeyDown={e => { if (e.key === 'Enter') handleRenameFolder(f.id); if (e.key === 'Escape') setRenamingFolder(null); }}
                            className="w-full px-1 py-0.5 text-xs font-semibold bg-indigo-50 border border-indigo-300 rounded outline-none"
                            onClick={e => e.stopPropagation()}
                          />
                        ) : (
                          <span className="block text-[13px] font-semibold text-slate-800 truncate">{f.name}</span>
                        )}
                        <span className="block text-[11px] text-slate-500 mt-0.5">
                          {f._count?.assets ?? 0} files{f._count?.children ? ` · ${f._count.children} folders` : ''}
                        </span>
                        {updated && <span className="block text-[11px] text-slate-400">Updated {updated}</span>}
                      </span>
                    </button>
                    {/* Folder context menu */}
                    <div className="relative">
                      <button
                        onClick={e => { e.stopPropagation(); setFolderMenuOpen(folderMenuOpen === f.id ? null : f.id); }}
                        aria-haspopup="menu"
                        aria-expanded={folderMenuOpen === f.id}
                        aria-label={`Folder actions for ${f.name}`}
                        /* 44px tap target on touch (§19), compact once a
                           pointer is available. */
                        className="w-11 h-11 sm:w-7 sm:h-7 flex items-center justify-center rounded-md opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100 hover:bg-slate-100 text-slate-500 hover:text-slate-800 transition-all"
                      >
                        <MoreVertical className="w-3.5 h-3.5" />
                      </button>
                      {folderMenuOpen === f.id && (
                        <div role="menu" tabIndex={-1} aria-label={`Folder actions for ${f.name}`} className="absolute right-0 top-7 z-20 bg-white border border-slate-200 rounded-lg shadow-lg py-1 min-w-[140px]" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
                          <button
                            role="menuitem"
                            onClick={() => { setRenamingFolder(f.id); setRenameValue(f.name); setFolderMenuOpen(null); }}
                            disabled={isViewer}
                            title={isViewer ? readOnlyReason : undefined}
                            className="w-full px-3 py-1.5 min-h-11 sm:min-h-0 text-left text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <Pencil className="w-3 h-3" /> Rename
                          </button>
                          <button
                            role="menuitem"
                            onClick={() => { handleDeleteFolder(f.id); setFolderMenuOpen(null); }}
                            disabled={isViewer}
                            title={isViewer ? readOnlyReason : undefined}
                            className="w-full px-3 py-1.5 min-h-11 sm:min-h-0 text-left text-xs text-rose-700 hover:bg-rose-50 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <Trash2 className="w-3 h-3" /> Delete folder
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* ── Files (§10) ─────────────────────────────────────────────── */}
      {!isLoading && !isError && (
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
            {filesHeading} <span className="text-slate-400 font-semibold">{filtered.length}</span>
          </h2>
        </div>
      )}

      {isLoading ? (
        // §20 — thumbnail-card skeletons matching the final grid, not a
        // page-swallowing spinner.
        <ul className="grid grid-cols-2 min-[768px]:grid-cols-3 min-[1200px]:grid-cols-4 min-[1440px]:grid-cols-5 gap-4 list-none p-0 m-0" aria-busy="true" aria-label="Loading assets">
          {Array.from({ length: 10 }).map((_, i) => (
            <li key={i} className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="aspect-square bg-slate-100 animate-pulse motion-reduce:animate-none" />
              <div className="p-3 space-y-2">
                <div className="h-2.5 w-3/4 rounded bg-slate-100 animate-pulse motion-reduce:animate-none" />
                <div className="h-2 w-1/2 rounded bg-slate-100 animate-pulse motion-reduce:animate-none" />
              </div>
            </li>
          ))}
        </ul>
      ) : isError ? (
        /* Load error — show the failure instead of falling through to
           the "Empty library" state, which would make an outage look
           like a tenant with no assets. */
        <div className="text-center py-16 bg-white rounded-2xl border border-slate-200">
          <AlertCircle className="w-10 h-10 text-rose-500 mx-auto mb-3" aria-hidden />
          <p className="text-sm font-bold text-slate-800">Couldn&apos;t load the Media Library</p>
          <p className="text-xs text-slate-600 mt-1">Check your connection and try again.</p>
          <button
            onClick={() => refetch()}
            className="mt-4 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold inline-flex items-center gap-1.5"
          >
            <RefreshCw className="w-4 h-4" /> Retry
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          searching={!!search}
          filtered={filter !== 'all'}
          inFolder={!!currentFolderId}
          allLoaded={allLoaded}
          loadedCount={assets.length}
          onUpload={openUploadPicker}
          onAddUrl={() => setShowUrlForm(true)}
          onClearFilters={() => { setSearch(''); setFilter('all'); }}
          onLoadMore={() => setWindowSize((w) => w + FULL_SCAN_TAKE)}
          disabled={isViewer}
        />
      ) : viewMode === 'grid' ? (
        // 2026-07-09 — UNIFORM grid with SQUARE, object-contain tiles.
        // v1 (16:9 + object-cover) zoom-cropped portrait signage into
        // unrecognizable bands; v2 (masonry, native-aspect tiles) fixed the
        // crop but read as chaos — operator: "the images are all over the
        // place based on different resolutions". v3: tidy uniform rows,
        // square media boxes, whole image contained (no crop, no zoom) on
        // a soft neutral backdrop. Orderly AND recognizable.
        <ul data-testid="files-grid" className="grid grid-cols-2 min-[768px]:grid-cols-3 min-[1200px]:grid-cols-4 min-[1440px]:grid-cols-5 gap-4 list-none p-0 m-0">
          {filtered.map((a: any) => {
            const thumb = thumbUrl(a);
            const name = assetName(a);
            const isSelected = selectedIds.includes(a.id);
            const status = statusBadge(a);
            return (
              // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
              <li
                key={a.id}
                draggable={!isViewer}
                onDragStart={e => { if (isViewer) { e.preventDefault(); return; } e.dataTransfer.setData('assetId', a.id); e.dataTransfer.effectAllowed = 'move'; }}
                className={`bg-white rounded-2xl overflow-hidden group transition-all relative border ${
                  isSelected ? 'border-indigo-500 ring-2 ring-indigo-200 bg-indigo-50/40' : 'border-slate-200 hover:border-slate-300 hover:shadow-md'
                }`}
              >
                {/* Selection checkbox.
                    2026-05-29 (mobile P1) — was opacity-0 + group-hover
                    reveal, which never fires on touch (no :hover on a
                    phone), so bulk-select was desktop-only. Now: when
                    unselected we keep it VISIBLE by default and only
                    hide-until-hover on hover-capable pointers via the
                    `[@media(hover:hover)]` arbitrary variant. */}
                <button
                  onClick={(e) => { e.stopPropagation(); setSelectedIds(p => p.includes(a.id) ? p.filter(id => id !== a.id) : [...p, a.id]); }}
                  aria-label={isSelected ? `Deselect ${name}` : `Select ${name}`}
                  aria-pressed={isSelected}
                  className={`absolute top-2 left-2 z-20 w-11 h-11 sm:w-6 sm:h-6 flex items-center justify-center transition-all ${
                    isSelected
                      ? 'opacity-100'
                      : 'opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100'
                  }`}
                >
                  <span className={`w-5 h-5 rounded flex items-center justify-center ${isSelected ? 'bg-indigo-600 border border-indigo-600' : 'bg-white border border-slate-300 shadow-sm'}`}>
                    {isSelected && <Check className="w-3.5 h-3.5 text-white" />}
                  </span>
                </button>

                {/* §11/§25 — no permanent destructive control on the card.
                    Everything management-shaped lives behind this menu. */}
                <div className="absolute top-2 right-2 z-20">
                  <AssetActionsMenu
                    assetName={name}
                    actions={menuActionsFor(a)}
                    className="bg-white/90 rounded-md shadow-sm [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100 [&:has([aria-expanded=true])]:opacity-100"
                  />
                </div>

                <button
                  onClick={(e) => openDetail(a, e.currentTarget)}
                  aria-label={`View details for ${name}`}
                  className="w-full text-left cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
                >
                  {/* Square media box + object-contain: every image shows in
                      full (portrait, landscape, banner) inside a tidy uniform
                      tile — no zoom-crop, no ragged masonry. */}
                  <span className="aspect-square bg-slate-100 flex items-center justify-center relative overflow-hidden">
                    {thumb && isVideo(a) ? (
                      // 2026-06-16 — show a real first-frame POSTER on load
                      // (operator: "videos dont have previews"). preload
                      // "metadata" + a #t=0.1 media fragment paints the first
                      // frame with a SMALL fetch, not the whole file.
                      <video
                        src={`${thumb}#t=0.1`}
                        muted
                        playsInline
                        preload="metadata"
                        className="w-full h-full object-contain"
                        onMouseEnter={(e) => { try { e.currentTarget.play(); } catch { /* ignore */ } }}
                        onMouseLeave={(e) => { try { e.currentTarget.pause(); e.currentTarget.currentTime = 0.1; } catch {} }}
                      />
                    ) : thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={thumb}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="w-full h-full object-contain"
                        // mshots sometimes returns an image that fails to
                        // decode on a brand-new URL (the service hasn't
                        // generated the shot yet). Fall back to the type icon
                        // so the tile never renders broken (§11).
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                      />
                    ) : isPdf(a) ? (
                      // PDF tile: a real first-page preview, mounted once the
                      // tile nears the viewport, with Chrome's PDFium toolbar
                      // masked out (the operator wanted the preview AND no
                      // viewer chrome — see PdfHoverThumb's own history).
                      <PdfHoverThumb fileUrl={a.fileUrl} title={name} />
                    ) : (
                      typeIcon(a.mimeType, 'w-8 h-8')
                    )}
                    {/* No type chip on the stage: the metadata line directly
                        below already says "JPG · 1920 × 1080", and §11 reserves
                        tile overlays for states that change what the operator
                        can do. (List view keeps a Type column.) */}
                    {isVideo(a) && (
                      <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-slate-900/55 flex items-center justify-center" aria-hidden>
                        <Video className="w-4 h-4 text-white" />
                      </span>
                    )}
                    {status && (
                      <span className={`absolute bottom-1.5 right-1.5 text-[9px] font-black px-1.5 py-0.5 rounded ${status.className}`}>
                        {status.label}
                      </span>
                    )}
                  </span>
                  <span className="block p-3">
                    <span className="block text-[13px] font-semibold text-slate-800 truncate" title={name}>{name}</span>
                    <span className="block text-[11px] text-slate-500 mt-0.5">{metaLine(a)}</span>
                    <span className="block text-[11px] text-slate-500">{fmtSize(a.fileSize)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        // ── List view (§12) ────────────────────────────────────────
        <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left border-collapse">
            <caption className="sr-only">Media library files</caption>
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70">
                <th scope="col" className="w-10 px-3 py-2"><span className="sr-only">Select</span></th>
                <th scope="col" className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">File</th>
                <th scope="col" className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">Type</th>
                <th scope="col" className="hidden lg:table-cell px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">Folder</th>
                <th scope="col" className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">Size</th>
                <th scope="col" className="hidden md:table-cell px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">Uploaded</th>
                <th scope="col" className="hidden xl:table-cell px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">Uploader</th>
                <th scope="col" className="w-12 px-3 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((a: any) => {
                const thumb = thumbUrl(a);
                const name = assetName(a);
                const isSelected = selectedIds.includes(a.id);
                const status = statusBadge(a);
                return (
                  <tr
                    key={a.id}
                    draggable={!isViewer}
                    onDragStart={e => { if (isViewer) { e.preventDefault(); return; } e.dataTransfer.setData('assetId', a.id); e.dataTransfer.effectAllowed = 'move'; }}
                    className={`group ${isSelected ? 'bg-indigo-50/60' : 'hover:bg-slate-50'}`}
                  >
                    <td className="px-3 py-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); setSelectedIds(p => p.includes(a.id) ? p.filter(id => id !== a.id) : [...p, a.id]); }}
                        aria-label={isSelected ? `Deselect ${name}` : `Select ${name}`}
                        aria-pressed={isSelected}
                        className="w-11 h-11 sm:w-5 sm:h-5 -my-3 sm:my-0 flex items-center justify-center"
                      >
                        <span className={`w-4 h-4 rounded flex items-center justify-center ${isSelected ? 'bg-indigo-600 border border-indigo-600' : 'bg-white border border-slate-300 shadow-sm'}`}>
                          {isSelected && <Check className="w-3 h-3 text-white" />}
                        </span>
                      </button>
                    </td>
                    <td className="px-3 py-2 max-w-[340px]">
                      <button
                        onClick={(e) => openDetail(a, e.currentTarget)}
                        aria-label={`View details for ${name}`}
                        className="flex items-center gap-3 w-full min-w-0 text-left"
                      >
                        <span className="w-11 h-11 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-center overflow-hidden shrink-0">
                          {thumb && isVideo(a) ? (
                            <video src={`${thumb}#t=0.1`} muted playsInline preload="metadata" className="w-full h-full object-cover" />
                          ) : thumb ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={thumb} alt="" className="w-full h-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                          ) : typeIcon(a.mimeType)}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-xs font-semibold text-slate-800 truncate" title={name}>{name}</span>
                          {status && <span className={`inline-block mt-0.5 text-[9px] font-black px-1.5 py-0.5 rounded ${status.className}`}>{status.label}</span>}
                        </span>
                      </button>
                    </td>
                    <td className="px-3 py-2">{typeBadge(a.mimeType)}</td>
                    <td className="hidden lg:table-cell px-3 py-2 text-[11px] text-slate-600 truncate max-w-[160px]">
                      {a.folder?.name || (a.folderId ? folderNameById.get(a.folderId) : null) || 'All files'}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-slate-600 whitespace-nowrap">{fmtSize(a.fileSize)}</td>
                    <td className="hidden md:table-cell px-3 py-2 text-[11px] text-slate-600 whitespace-nowrap">{fmtRelative(a.createdAt) || '—'}</td>
                    <td className="hidden xl:table-cell px-3 py-2 text-[11px] text-slate-600 truncate max-w-[180px]">{a.uploadedBy?.email || '—'}</td>
                    <td className="px-3 py-2">
                      <AssetActionsMenu assetName={name} actions={menuActionsFor(a)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Progressive-loading footer (§17) ─────────────────────────── */}
      {!isLoading && !isError && filtered.length > 0 && (
        <LibraryFooter
          loaded={assets.length}
          total={page.total}
          visible={filtered.length}
          narrowed={filter !== 'all' || !!search}
          allLoaded={allLoaded}
          busy={isFetching}
          onLoadMore={() => setWindowSize((w) => w + FULL_SCAN_TAKE)}
        />
      )}

      {/* ── Asset detail (§15) ──────────────────────────────────────── */}
      {selectedAsset && (
        <div className="fixed top-0 right-0 bottom-0 left-0 z-50 flex">
          {/* Solid scrim — §15 explicitly prefers this over backdrop-blur:
              cheaper to paint and just as legible. */}
          <button aria-label={t('assetsLib.closeDetail')} className="absolute top-0 right-0 bottom-0 left-0 bg-slate-900/60 cursor-default" onClick={closeDetail} />
          {/* 2026-07-09 — centered two-column detail modal (operator:
              "center the preview, enlarge it a little and use some of the
              extra wasted space"). Preview owns the full-height left stage;
              metadata is a fixed column on the right. On phones it stacks. */}
          <div
            ref={detailRef}
            role="dialog"
            aria-modal="true"
            aria-label={`Asset details: ${assetName(selectedAsset)}`}
            className="m-auto w-full h-full md:h-[86vh] md:max-w-[1060px] bg-white shadow-2xl relative z-10 flex flex-col md:flex-row overflow-hidden md:rounded-2xl"
          >
            {/* Preview stage */}
            <div className="h-[45vh] shrink-0 md:h-auto md:flex-1 bg-slate-900 flex items-center justify-center relative overflow-hidden">
              {selectedAsset.mimeType?.startsWith('image/') ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={absoluteUrl(selectedAsset)} alt={selectedAsset.altText || ''} className="max-w-full max-h-full object-contain" />
              ) : selectedAsset.mimeType?.startsWith('video/') ? (
                <video src={absoluteUrl(selectedAsset)} controls autoPlay className="max-w-full max-h-full" />
              ) : selectedAsset.mimeType?.startsWith('audio/') ? (
                <div className="text-center px-8 w-full">
                  {typeIcon(selectedAsset.mimeType, 'w-12 h-12 mx-auto mb-4')}
                  <audio src={absoluteUrl(selectedAsset)} controls autoPlay className="w-full" />
                </div>
              ) : selectedAsset.mimeType === 'text/html' ? (
                // Lane-1 P1: sandbox uploaded HTML assets. Any CONTRIBUTOR
                // can upload text/html; without sandbox the page runs same-
                // origin and can read the operator's session storage /
                // cookies. `allow-scripts` keeps interactive previews; no
                // `allow-same-origin` blocks document.cookie / localStorage.
                <iframe
                  src={selectedAsset.fileUrl}
                  title={`Preview of ${assetName(selectedAsset)}`}
                  sandbox="allow-scripts"
                  className="w-full h-full border-0 bg-white"
                />
              ) : isPdf(selectedAsset) ? (
                // The detail stage is the one place a PDF gets room to be
                // read, so mount the document itself (the GRID tile stays
                // hover-only — see PdfHoverThumb).
                <iframe
                  src={`${absoluteUrl(selectedAsset)}#view=Fit&navpanes=0`}
                  title={`Preview of ${assetName(selectedAsset)}`}
                  className="w-full h-full border-0 bg-white"
                />
              ) : (
                <div className="text-center text-white">{typeIcon(selectedAsset.mimeType, 'w-16 h-16 mx-auto')}<p className="mt-3 text-xs opacity-70">{t('assetsLib.previewNotAvailable')}</p></div>
              )}
            </div>

            <button
              onClick={closeDetail}
              aria-label="Close"
              data-detail-initial-focus
              className="absolute top-3 right-3 z-20 w-11 h-11 sm:w-9 sm:h-9 bg-slate-900/60 hover:bg-slate-900/80 rounded-full flex items-center justify-center text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>

            {/* Metadata column — order per §15 */}
            <div className="flex-1 md:flex-none md:w-[400px] md:border-l md:border-slate-200 overflow-y-auto p-6 space-y-5">
              <div>
                <h2 className="text-base font-bold text-slate-900 break-all">{assetName(selectedAsset)}</h2>
                <p className="text-xs text-slate-500 mt-1">{t('assetsLib.uploadedAt', { date: fmtDate(selectedAsset.createdAt) })}</p>
              </div>

              {/* 3. Usage and impact — before any destructive control. */}
              <AssetUsageSection
                usage={usageQuery.data as AssetUsage | undefined}
                isLoading={usageQuery.isLoading}
                isError={usageQuery.isError}
                onRetry={() => void usageQuery.refetch()}
              />

              {/* 4. Type / size / dimensions */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-50 rounded-lg p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Info className="w-3 h-3 text-slate-400" aria-hidden />
                    <span className="text-[10px] font-bold text-slate-500 uppercase">{t('assetsLib.labelType')}</span>
                  </div>
                  <p className="text-xs font-semibold text-slate-800">{selectedAsset.mimeType}</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <HardDrive className="w-3 h-3 text-slate-400" aria-hidden />
                    <span className="text-[10px] font-bold text-slate-500 uppercase">{t('assetsLib.labelSize')}</span>
                  </div>
                  <p className="text-xs font-semibold text-slate-800">{fmtSize(selectedAsset.fileSize)}</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Maximize2 className="w-3 h-3 text-slate-400" aria-hidden />
                    <span className="text-[10px] font-bold text-slate-500 uppercase">{t('assetsLib.labelResolution')}</span>
                  </div>
                  {/* §20 — unknown metadata is an em dash, never a fabricated size. */}
                  <p className="text-xs font-semibold text-slate-800">
                    {selectedDims ? `${selectedDims.w} × ${selectedDims.h} px` : '—'}
                  </p>
                </div>
                <div className="bg-slate-50 rounded-lg p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Clock className="w-3 h-3 text-slate-400" aria-hidden />
                    <span className="text-[10px] font-bold text-slate-500 uppercase">{t('assetsLib.labelUploaded')}</span>
                  </div>
                  <p className="text-xs font-semibold text-slate-800">{fmtDate(selectedAsset.createdAt)}</p>
                </div>
              </div>

              {/* 5. Folder + uploader */}
              <div className="flex items-center justify-between bg-slate-50 rounded-lg p-3">
                <span className="text-[10px] font-bold text-slate-500 uppercase">{t('assetsLib.labelFolder')}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-700 flex items-center gap-1">
                    <Folder className="w-3 h-3 text-amber-400" aria-hidden />
                    {selectedAsset.folder?.name || (selectedAsset.folderId ? folderNameById.get(selectedAsset.folderId) : null) || 'All files'}
                  </span>
                  <button
                    onClick={() => { setMoveTargetId(selectedAsset.id); setShowFolderPicker('single-move'); }}
                    disabled={isViewer}
                    title={isViewer ? readOnlyReason : undefined}
                    className="min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 px-3 sm:px-0 text-[10px] text-indigo-700 hover:text-indigo-900 font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Move
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-3 bg-slate-50 rounded-lg p-3">
                <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white text-[10px] font-bold" aria-hidden>
                  {selectedAsset.uploadedBy?.email?.substring(0, 2).toUpperCase() || '??'}
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-800">{selectedAsset.uploadedBy?.email || 'System'}</p>
                  <p className="text-[10px] text-slate-500">{t('assetsLib.labelUploader')}</p>
                </div>
              </div>

              {/* 6. Status */}
              <div className="flex items-center justify-between bg-slate-50 rounded-lg p-3">
                <span className="text-[10px] font-bold text-slate-500 uppercase">{t('assetsLib.labelStatus')}</span>
                <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                  selectedAsset.status === 'PENDING_APPROVAL'
                    ? 'bg-amber-100 text-amber-900'
                    : selectedAsset.status === 'ARCHIVED'
                    ? 'bg-slate-200 text-slate-700'
                    : 'bg-emerald-100 text-emerald-800'
                }`}>
                  {selectedAsset.status === 'PENDING_APPROVAL' ? 'Pending review' : selectedAsset.status === 'ARCHIVED' ? 'Archived' : 'Published'}
                </span>
              </div>

              {/* 7. Alt text — Audit P1-2 (2026-05-28). Only for image assets.
                  Auto-populated by AI at upload time; operator can edit or
                  regenerate from here. Screen readers read this when the image
                  is rendered; also indexed by the library search. */}
              {(selectedAsset.mimeType || '').startsWith('image/') && (
                <div className="bg-slate-50 rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <label htmlFor="asset-alt-text" className="text-[10px] font-bold text-slate-500 uppercase">{t('assetsLib.altText')}</label>
                    <span className={`text-[10px] font-bold ${altTextDraft.length > 125 ? 'text-amber-700' : 'text-slate-500'}`}>
                      {altTextDraft.length}/160
                    </span>
                  </div>
                  <textarea
                    id="asset-alt-text"
                    value={altTextDraft}
                    onChange={(e) => {
                      const v = e.target.value.slice(0, 160);
                      setAltTextDraft(v);
                      setAltTextDirty(v !== (selectedAsset.altText ?? ''));
                    }}
                    placeholder={selectedAsset.altText === null || selectedAsset.altText === undefined ? t('assetsLib.altPlaceholder') : ''}
                    disabled={isViewer}
                    rows={2}
                    maxLength={160}
                    className="w-full text-xs px-2 py-1.5 bg-white border border-slate-300 rounded text-slate-800 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed resize-none"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const result = await generateAltText.mutateAsync(selectedAsset.id);
                          setAltTextDraft(result.altText);
                          setAltTextDirty(false);
                          setSelectedAsset({ ...selectedAsset, altText: result.altText });
                        } catch (e: any) {
                          // Surface structured errors clearly so the operator
                          // knows whether to add credit or configure an AI key.
                          const code = e?.code;
                          if (code === 'AI_QUOTA_EXHAUSTED') {
                            await appAlert({
                              title: t('assetsLib.aiQuotaExhausted'),
                              message: e?.body?.message || e?.message || 'Add credit to your AI provider account and try again.',
                              tone: 'warn',
                              confirmLabel: 'OK',
                            });
                          } else if (code === 'AI_ALT_TEXT_UNAVAILABLE') {
                            await appAlert({
                              title: t('assetsLib.aiNotConfigured'),
                              message: t('assetsLib.aiConfigureHint'),
                              tone: 'warn',
                              confirmLabel: 'OK',
                            });
                          } else {
                            clog.error('upload', 'alt-text generate failed', { msg: e?.message });
                          }
                        }
                      }}
                      disabled={isViewer || generateAltText.isPending}
                      title={isViewer ? t('assetsLib.readOnlyViewer') : t('assetsLib.generateAltTitle')}
                      className="flex-1 px-2 py-1.5 min-h-11 sm:min-h-0 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 text-[11px] font-bold rounded flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {generateAltText.isPending ? (
                        <>
                          <Loader2 className="w-3 h-3 animate-spin motion-reduce:animate-none" />
                          {t('assetsLib.generating')}
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-3 h-3" />
                          {selectedAsset.altText ? t('assetsLib.regenerate') : t('assetsLib.generateAlt')}
                        </>
                      )}
                    </button>
                    {altTextDirty && (
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            const next = altTextDraft.trim() === '' ? null : altTextDraft.trim();
                            await updateAltText.mutateAsync({ id: selectedAsset.id, altText: next });
                            setSelectedAsset({ ...selectedAsset, altText: next });
                            setAltTextDirty(false);
                          } catch (e: any) {
                            clog.error('upload', 'alt-text save failed', { msg: e?.message });
                          }
                        }}
                        disabled={isViewer || updateAltText.isPending}
                        className="px-3 py-1.5 min-h-11 sm:min-h-0 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-[11px] font-bold rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Save
                      </button>
                    )}
                  </div>
                  <p className="text-[10px] text-slate-500 leading-relaxed">
                    Screen-reader description. Keep it under 125 characters and skip &quot;image of&quot; — just describe the content.
                  </p>
                </div>
              )}

              {/* 8. Actions — safe row first, destructive separated (§15). */}
              <div className="space-y-2 pt-1">
                <div className="flex gap-2">
                  <button
                    onClick={() => downloadAsset(selectedAsset)}
                    className="flex-1 px-4 py-2.5 min-h-11 sm:min-h-0 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold rounded-lg text-center flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" /> Download
                  </button>
                  {isUrl(selectedAsset) ? (
                    <a
                      href={selectedAsset.fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 px-4 py-2.5 min-h-11 sm:min-h-0 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold rounded-lg text-center flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5" /> Open URL
                    </a>
                  ) : (
                    <button
                      onClick={() => void copyAssetLink(selectedAsset)}
                      className="flex-1 px-4 py-2.5 min-h-11 sm:min-h-0 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold rounded-lg text-center flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <Link2 className="w-3.5 h-3.5" /> Copy link
                    </button>
                  )}
                </div>
                <button
                  onClick={() => startPlaylistFrom([selectedAsset.id])}
                  disabled={isViewer}
                  title={isViewer ? readOnlyReason : undefined}
                  className="w-full px-4 py-2.5 min-h-11 sm:min-h-0 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 text-xs font-bold rounded-lg flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ListPlus className="w-3.5 h-3.5" /> Create playlist
                </button>
                <div className="pt-2 border-t border-slate-200">
                  <button
                    onClick={() => void requestDeleteAsset(selectedAsset)}
                    disabled={isViewer}
                    title={isViewer ? readOnlyReason : undefined}
                    className="w-full px-4 py-2.5 min-h-11 sm:min-h-0 bg-white border border-rose-200 hover:bg-rose-50 text-rose-700 text-xs font-bold rounded-lg flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Delete asset
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── In-use deletion block (§16) ──────────────────────────────── */}
      {inUseBlock && (
        <div className="fixed top-0 right-0 bottom-0 left-0 z-[60] flex items-center justify-center p-4">
          <button aria-label="Cancel" className="absolute top-0 right-0 bottom-0 left-0 bg-slate-900/50 cursor-default" onClick={() => setInUseBlock(null)} />
          <div className="relative z-10 w-full max-w-md">
            <AssetInUseBlock
              assetName={assetName(inUseBlock.asset)}
              usage={inUseBlock.usage}
              onCancel={() => setInUseBlock(null)}
              onReviewUsage={() => {
                const a = inUseBlock.asset;
                setInUseBlock(null);
                openDetail(a);
              }}
            />
          </div>
        </div>
      )}

      {/* Searchable folder picker — one component, three flows:
          - 'upload'      : destination before the file chooser (or before
                            uploading retained pendingFiles)
          - 'bulk-move'   : destination for selectedIds
          - 'single-move' : destination for one asset (card menu / details) */}
      {showFolderPicker && (
        <FolderPicker
          folders={allFolders.map((f: any) => ({
            id: f.id,
            name: f.name,
            parentId: f.parentId ?? null,
          }))}
          initialSelectedId={showFolderPicker === 'upload' ? currentFolderId : null}
          disabledIds={[]}
          title={
            showFolderPicker === 'upload'
              ? (pendingFiles.length > 0
                  ? t('assetsLib.uploadToFolder', { count: pendingFiles.length })
                  : t('assetsLib.uploadWhichFolder'))
              : t('assetsLib.moveToWhichFolder', { count: showFolderPicker === 'single-move' ? 1 : selectedIds.length })
          }
          subtitle={
            showFolderPicker === 'upload' && pendingFiles.length > 0
              ? pendingFiles.slice(0, 3).map(f => f.name).join(', ')
                + (pendingFiles.length > 3 ? ` + ${pendingFiles.length - 3} more` : '')
              : undefined
          }
          onConfirm={handleFolderPicked}
          onClose={() => { setShowFolderPicker(null); setPendingFiles([]); setMoveTargetId(null); }}
          onCreateFolder={async (name, parentId) => {
            try {
              const created = await createFolder.mutateAsync({ name, parentId: parentId || undefined });
              // Force the asset-folders query to refresh so the tree
              // shows the new node on the very next render of the
              // picker's memoized structures.
              await queryClient.invalidateQueries({ queryKey: ['asset-folders'] });
              return { id: (created as any)?.id };
            } catch (e: any) {
              clog.error('upload', 'Inline folder create failed', { name, msg: e?.message });
              return null;
            }
          }}
        />
      )}
    </div>
  );
}

/**
 * §17 footer. Two honest modes:
 *   - the server told us the TOTAL → "Showing X of TOTAL assets" / "All
 *     TOTAL assets loaded";
 *   - it didn't (older API) → we only ever claim what we actually hold.
 */
function LibraryFooter({
  loaded,
  total,
  visible,
  narrowed,
  allLoaded,
  busy,
  onLoadMore,
}: {
  loaded: number;
  total: number | null;
  visible: number;
  narrowed: boolean;
  allLoaded: boolean;
  busy: boolean;
  onLoadMore: () => void;
}) {
  const main =
    total !== null
      ? allLoaded
        ? `All ${total} ${total === 1 ? 'asset' : 'assets'} loaded`
        : `Showing ${loaded} of ${total} assets`
      : allLoaded
      ? `All ${loaded} ${loaded === 1 ? 'asset' : 'assets'} loaded`
      : `${loaded} assets loaded so far`;
  return (
    <div className="flex flex-col items-center gap-2 pt-2 pb-1" data-testid="library-footer">
      <p className="text-[11px] text-slate-500">
        {main}
        {narrowed && <span> · {visible} match the current filter</span>}
      </p>
      {!allLoaded && (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={busy}
          className="min-h-11 sm:min-h-0 px-5 py-2 rounded-lg bg-white border border-slate-300 hover:border-indigo-300 text-slate-700 text-xs font-bold shadow-sm disabled:opacity-60"
        >
          {busy ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  );
}

/** §20 — every empty state says which empty it is, and never claims the
 *  library is empty when we only looked at part of it. */
function EmptyState({
  searching,
  filtered,
  inFolder,
  allLoaded,
  loadedCount,
  onUpload,
  onAddUrl,
  onClearFilters,
  onLoadMore,
  disabled,
}: {
  searching: boolean;
  filtered: boolean;
  inFolder: boolean;
  allLoaded: boolean;
  loadedCount: number;
  onUpload: () => void;
  onAddUrl: () => void;
  onClearFilters: () => void;
  onLoadMore: () => void;
  disabled?: boolean;
}) {
  // Not everything is loaded — we do NOT know this is empty. Say that.
  if (!allLoaded) {
    return (
      <div className="text-center py-14 bg-white rounded-2xl border border-slate-200" data-testid="empty-partial">
        <Loader2 className="w-8 h-8 text-slate-300 mx-auto mb-3" aria-hidden />
        <p className="text-sm font-bold text-slate-800">Nothing here in the {loadedCount} assets loaded so far</p>
        <p className="text-xs text-slate-600 mt-1">Load the rest of the library to be sure.</p>
        <button onClick={onLoadMore} className="mt-4 px-4 py-2 min-h-11 sm:min-h-0 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold">
          Load more
        </button>
      </div>
    );
  }
  if (searching || filtered) {
    return (
      <div className="text-center py-14 bg-white rounded-2xl border border-slate-200" data-testid="empty-search">
        <Search className="w-8 h-8 text-slate-300 mx-auto mb-3" aria-hidden />
        <p className="text-sm font-bold text-slate-800">No assets match</p>
        <p className="text-xs text-slate-600 mt-1">Try another search or clear the active filter.</p>
        <button onClick={onClearFilters} className="mt-4 px-4 py-2 min-h-11 sm:min-h-0 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold">
          Clear filters
        </button>
      </div>
    );
  }
  if (inFolder) {
    return (
      <div className="text-center py-14 bg-white rounded-2xl border border-slate-200" data-testid="empty-folder">
        <FolderOpen className="w-8 h-8 text-slate-300 mx-auto mb-3" aria-hidden />
        <p className="text-sm font-bold text-slate-800">This folder is empty</p>
        <p className="text-xs text-slate-600 mt-1">Drop files here or move existing assets into this folder.</p>
        <button onClick={onUpload} disabled={disabled} className="mt-4 px-4 py-2 min-h-11 sm:min-h-0 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold disabled:opacity-50">
          Upload files
        </button>
      </div>
    );
  }
  return (
    <div className="text-center py-14 bg-white rounded-2xl border border-slate-200" data-testid="empty-library">
      <UploadCloud className="w-8 h-8 text-slate-300 mx-auto mb-3" aria-hidden />
      <p className="text-sm font-bold text-slate-800">Add your first asset</p>
      <p className="text-xs text-slate-600 mt-1">Upload an image, video, audio file or PDF to start building content.</p>
      <div className="mt-4 flex items-center justify-center gap-2">
        <button onClick={onUpload} disabled={disabled} className="px-4 py-2 min-h-11 sm:min-h-0 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold disabled:opacity-50">
          Upload files
        </button>
        <button onClick={onAddUrl} disabled={disabled} className="px-4 py-2 min-h-11 sm:min-h-0 rounded-lg bg-white border border-slate-300 text-slate-700 text-xs font-bold disabled:opacity-50">
          Add web URL
        </button>
      </div>
    </div>
  );
}
