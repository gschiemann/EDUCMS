"use client";

import { useState, useRef, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { appConfirm } from '@/components/ui/app-dialog';
import { UploadCloud, Globe, X, CheckCircle2, File, Link2, Trash2, Grid3X3, List, Search, Eye, Image as ImageIcon, Video, Music, FileText, Download, Clock, HardDrive, Maximize2, Info, FolderPlus, Folder, FolderOpen, FolderInput, ChevronRight, Pencil, Home, MoreVertical, Check, Trash, AlertCircle, RefreshCw, ChevronDown, ChevronUp, Sparkles, Loader2, ListPlus } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAssets, useAddWebUrl, useDeleteAsset, useAssetFolders, useCreateAssetFolder, useRenameAssetFolder, useDeleteAssetFolder, useMoveAsset, useGenerateAltText, useUpdateAltText } from '@/hooks/use-api';
import { useUIStore } from '@/store/ui-store';
import { clog } from '@/lib/client-logger';
import { FolderPicker } from '@/components/assets/FolderPicker';
import { PdfHoverThumb } from '@/components/assets/PdfHoverThumb';
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

// Friendly, per-format rejection messages. Mirrors REJECTED_EXTENSIONS /
// REJECTED_MIMES on the server — keeping the rule list in two places is
// the price of "fail before upload instead of fail after the bytes have
// landed on Supabase." When you add a format to one, add it to the other.
function getUnsupportedReason(file: File): string | null {
  const name = (file.name || '').toLowerCase();
  const type = (file.type || '').toLowerCase();
  if (name.endsWith('.mov') || type === 'video/quicktime') {
    return "QuickTime .mov isn't supported (Android signage players and Windows Edge refuse it). Export as MP4: in QuickTime Player → File → Export As → 1080p, then upload the .mp4.";
  }
  if (name.endsWith('.avi') || type === 'video/x-msvideo') {
    return "AVI files aren't supported by browsers. Convert to MP4 (H.264) and re-upload.";
  }
  if (name.endsWith('.svg') || type === 'image/svg+xml') {
    // Friendly, actionable, and honest about the roadmap — an SVG can carry
    // hidden scripts so we don't store raw SVGs as content yet. Points at the
    // place SVG DOES work today (logos) instead of a generic "unsupported
    // format." Mirrors the server message in assets.controller.ts
    // assertUploadIntent() and the AssetPicker pre-check.
    return "SVG logos aren't supported yet — export as PNG for now (SVG support is coming soon). For a logo specifically, Settings → Branding accepts SVG safely today.";
  }
  return null;
}

type UploadPhase = 'idle' | 'uploading' | 'success' | 'error';
type ViewMode = 'grid' | 'list';
type FilterType = 'all' | 'images' | 'videos' | 'audio' | 'urls' | 'documents';

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

function typeBadge(mime: string, opts?: { onImage?: boolean }) {
  const ext = mime?.split('/')[1]?.toUpperCase() || 'FILE';
  const short = ext === 'JPEG' ? 'JPG' : ext === 'QUICKTIME' ? 'MOV' : ext === 'MPEG' ? 'MP3' : ext.substring(0, 4);
  const type = getAssetType(mime);
  // 2026-06-16 — `onImage` variant: a translucent tint (bg-*/10 + *-600 text)
  // is unreadable when the badge sits OVER a thumbnail (the grid tile). There
  // it uses a dark scrim + a light type-tinted ink — legible on ANY image and
  // visually consistent with the resolution badge's dark pill. The default
  // (translucent tint) is kept for the list view, which is on a white row.
  if (opts?.onImage) {
    const ink: Record<string, string> = { images: 'text-sky-300', videos: 'text-violet-300', audio: 'text-amber-300', urls: 'text-emerald-300', documents: 'text-rose-300' };
    return <span className={`text-[9px] font-black px-1.5 py-0.5 rounded bg-black/55 backdrop-blur-sm ${ink[type] || 'text-slate-200'}`}>{short}</span>;
  }
  const c: Record<string, string> = { images: 'bg-sky-500/10 text-sky-600', videos: 'bg-violet-500/10 text-violet-600', audio: 'bg-amber-500/10 text-amber-600', urls: 'bg-emerald-500/10 text-emerald-600', documents: 'bg-rose-500/10 text-rose-600' };
  return <span className={`text-[9px] font-black px-1.5 py-0.5 rounded ${c[type] || 'bg-slate-100 text-slate-500'}`}>{short}</span>;
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

export default function AssetsPage() {
  const userRole = useUIStore((s) => s.user?.role);
  const isViewer = userRole === 'RESTRICTED_VIEWER';
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [filter, setFilter] = useState<FilterType>('all');
  const [search, setSearch] = useState('');
  const [showUrlForm, setShowUrlForm] = useState(false);
  const [webUrl, setWebUrl] = useState('');
  const [selectedAsset, setSelectedAsset] = useState<any>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // NOTE (2026-07-09): a hover-triggered "Quick Look" full-image overlay
  // shipped briefly and was reverted same-day — operator: "if i move my
  // mouse it freezes the entire screen… hover need to just go back to a
  // click for preview." Preview = CLICK → detail panel (large uncropped
  // render). Do not re-add hover-triggered overlays here.
  const router = useRouter();

  // "Create playlist" from the current selection: stash the ids in
  // sessionStorage, then jump to Playlists with ?newPlaylist=1 — the
  // playlists page opens the wizard pre-seeded with these files (Step 2),
  // saving the operator the re-pick step.
  const handleCreatePlaylistFromSelection = () => {
    if (selectedIds.length === 0) return;
    try { sessionStorage.setItem('edu_new_playlist_assets', JSON.stringify(selectedIds)); } catch { /* ignore */ }
    const base = window.location.pathname.replace(/\/assets(?:\/.*)?$/, '');
    router.push(`${base}/playlists?newPlaylist=1`);
    setSelectedIds([]);
  };
  const [dragOver, setDragOver] = useState(false);
  // The asset detail slide-over is a full-viewport overlay with its own
  // action footer; hide the mobile tab bar while it's open. (FolderPicker
  // registers its own overlay lock, so it's not gated here.)
  useOverlayLock(!!selectedAsset);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const newFolderInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { data: assets, isLoading, isError, refetch } = useAssets();
  const addWebUrl = useAddWebUrl();
  const deleteAsset = useDeleteAsset();

  // Folder state
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [folderMenuOpen, setFolderMenuOpen] = useState<string | null>(null);
  // 2026-05-26 — operator: "the folders are bleeding into the content
  // ... when I have 100 folders how will I be able to see them all?"
  // Folder section is now a contained card with a header, a "Show all"
  // collapse, and inner scroll. First 12 visible by default; the
  // expand button reveals every folder with a 480px capped scroll
  // region. Files section sits clearly below with its own heading.
  const [showAllFolders, setShowAllFolders] = useState(false);
  const FOLDERS_PREVIEW_LIMIT = 12;
  // Searchable folder picker state:
  //   - showFolderPicker: 'upload' | 'bulk-move' | null — which flow requested it
  //   - pendingFiles: files dragged onto the drop zone that need a
  //     destination. The picker opens, user chooses a folder, then we
  //     upload these without ever asking for files again. Empty for
  //     the plain "Upload" button flow (which falls through to the
  //     native file chooser after the picker resolves).
  const [showFolderPicker, setShowFolderPicker] = useState<'upload' | 'bulk-move' | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const { data: folders } = useAssetFolders();
  const createFolder = useCreateAssetFolder();
  const renameFolder = useRenameAssetFolder();
  const deleteFolderMut = useDeleteAssetFolder();
  const moveAsset = useMoveAsset();
  // Audit P1-2 (2026-05-28) — AI alt-text generator + manual override.
  const generateAltText = useGenerateAltText();
  const updateAltText = useUpdateAltText();
  // Local edit buffer for the alt-text field — keeps typing snappy
  // without re-running the parent's mutation on every keystroke.
  const [altTextDraft, setAltTextDraft] = useState<string>('');
  const [altTextDirty, setAltTextDirty] = useState(false);
  // Reset the draft each time the operator opens a different asset.
  useEffect(() => {
    setAltTextDraft(selectedAsset?.altText ?? '');
    setAltTextDirty(false);
  }, [selectedAsset?.id, selectedAsset?.altText]);

  const apiBase = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1').replace('/api/v1', '');

  // Folder helpers
  const currentFolderChildren = (folders || []).filter((f: any) => f.parentId === currentFolderId);
  const currentFolder = currentFolderId ? (folders || []).find((f: any) => f.id === currentFolderId) : null;

  // Build breadcrumb trail
  const breadcrumbs: { id: string | null; name: string }[] = [{ id: null, name: 'All Files' }];
  if (currentFolder) {
    const trail: any[] = [];
    let f = currentFolder;
    while (f) {
      trail.unshift(f);
      f = f.parentId ? (folders || []).find((x: any) => x.id === f.parentId) : null;
    }
    trail.forEach((t: any) => breadcrumbs.push({ id: t.id, name: t.name }));
  }

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
      title: 'Delete folder?',
      message: 'Files inside will be moved to the parent folder.',
      tone: 'warn',
      confirmLabel: 'Delete folder',
    });
    if (ok) {
      await deleteFolderMut.mutateAsync(id);
      if (currentFolderId === id) setCurrentFolderId(null);
    }
  };

  const handleMoveAssetToFolder = async (assetId: string, folderId: string | null) => {
    await moveAsset.mutateAsync({ id: assetId, folderId });
  };

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    const ok = await appConfirm({
      title: 'Delete selected assets?',
      message: `${selectedIds.length} asset${selectedIds.length === 1 ? '' : 's'} will be permanently deleted.`,
      tone: 'danger',
      confirmLabel: 'Delete',
    });
    if (ok) {
      // Track which deletes fail so we can surface a user-visible error
      // instead of just console.error (the old behavior swallowed every
      // 409 silently and the operator thought the delete succeeded).
      // Emergency content is already filtered out of this list server-
      // side, but keep the failure-tracking path as defense-in-depth in
      // case a stale cache somehow includes a protected asset.
      const failures: Array<{ id: string; msg: string }> = [];
      await Promise.all(
        selectedIds.map((id) =>
          deleteAsset.mutateAsync(id).catch((e: any) => {
            const msg = e?.message || 'Unknown error';
            failures.push({ id, msg });
            clog.error('upload', 'Delete failed', { id, msg });
          }),
        ),
      );
      setSelectedIds([]);
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      if (failures.length > 0) {
        await appConfirm({
          title: 'Some assets could not be deleted',
          message:
            `${failures.length} of ${selectedIds.length} delete${failures.length === 1 ? '' : 's'} failed. ` +
            `First error: "${failures[0].msg}"`,
          tone: 'danger',
          confirmLabel: 'OK',
          cancelLabel: '',
        });
      }
    }
  };

  // Bulk-move handler — fed by the searchable FolderPicker. Replaces
  // the old flat dropdown that stopped being usable past ~20 folders.
  const handleBulkMove = async (targetFolderId: string | null) => {
    if (selectedIds.length === 0) return;
    await Promise.all(
      selectedIds.map((id) => moveAsset.mutateAsync({ id, folderId: targetFolderId }).catch((e) => console.error(e))),
    );
    setSelectedIds([]);
    queryClient.invalidateQueries({ queryKey: ['assets'] });
  };

  // Called by FolderPicker on confirm. Two flows:
  //   - 'upload' with pendingFiles: user dragged files, we retain
  //     them across the picker so they don't have to select again.
  //     Upload immediately to the chosen folder.
  //   - 'upload' WITHOUT pendingFiles: user clicked the Upload
  //     button. Open the native file chooser with the chosen folder
  //     as the destination override.
  //   - 'bulk-move': apply folder to selectedIds.
  const handleFolderPicked = (folderId: string | null) => {
    const mode = showFolderPicker;
    setShowFolderPicker(null);
    if (mode === 'upload') {
      if (pendingFiles.length > 0) {
        // Drag-drop flow: we already have the files in memory — just
        // fire them at the chosen destination. Retaining them across
        // the picker is the whole point of this UX.
        handleFiles(pendingFiles, folderId);
        setPendingFiles([]);
      } else {
        // Button flow: no files yet. Stash the destination on the
        // hidden input via a data attribute the onChange handler
        // reads, then pop the file chooser.
        const input = fileInputRef.current;
        if (input) {
          input.dataset.overrideFolderId =
            folderId === null ? '__root__' : folderId;
          input.click();
        }
      }
    } else if (mode === 'bulk-move') {
      void handleBulkMove(folderId);
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
      // surface in the upload-progress strip so the operator sees which
      // file is blocked and why.
      const unsupportedReason = getUnsupportedReason(file);
      if (unsupportedReason) { item.phase = 'error'; item.error = unsupportedReason; }
      else if (file.size > MAX_FILE_SIZE) { item.phase = 'error'; item.error = `Too large (${fmtSize(file.size)})`; }
      else item.phase = 'uploading';
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
    const MAX_CONCURRENT_UPLOADS = 3;
    const queue = items.filter((u) => u.phase === 'uploading').slice();
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
          let msg = `Storage upload failed (${xhr.status})`;
          try {
            const payload = JSON.parse(xhr.responseText);
            msg = payload?.message || payload?.error || msg;
          } catch {}
          reject(new Error(msg));
        }
      };
      xhr.onerror = () => {
        reject(new Error('Storage upload network error. The file reached the direct storage step, so check Supabase Storage CORS/network and MIME settings.'));
      };
      xhr.onabort = () => reject(new Error('Cancelled'));
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
      setProgress(2);
      const signed = await postJson<PresignedUploadResponse>('/assets/presign', {
        filename: item.file.name,
        contentType: item.file.type || 'application/octet-stream',
        size: item.file.size,
        folderId: targetFolderId || null,
      });
      setProgress(5);
      await uploadToSignedUrl(signed);
      setProgress(98);
      await postJson('/assets/complete-upload', {
        storagePath: signed.storagePath,
        filename: item.file.name,
        contentType: signed.mimeType || item.file.type || 'application/octet-stream',
        size: item.file.size,
        folderId: targetFolderId || null,
      });
      const elapsedMs = Math.round(performance.now() - started);
      clog.info('upload', 'Success', { id: item.id, name: item.file.name, elapsedMs });
      setUploads(p => p.map(u => u.id === item.id ? { ...u, progress: 100, phase: 'success' } : u));
      queryClient.invalidateQueries({ queryKey: ['assets'] });
    } catch (err: any) {
      const elapsedMs = Math.round(performance.now() - started);
      const msg = err?.message || 'Upload failed';
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
        await appConfirm({
          title: "Streaming services can't play on signage",
          message:
            `${host} uses DRM copy-protection that blocks playback inside any signage player (this is true on every signage platform, not just VenueOS). ` +
            `For live video on screens, use a YouTube/Twitch/Vimeo embed, an HLS stream URL, or an HDMI source into the display.`,
          tone: 'danger',
          confirmLabel: 'Got it',
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

  const filtered = (assets || []).filter((a: any) => {
    // Folder filter — show only assets belonging to the current folder
    // At root (null): show only unfiled assets; inside a folder: show that folder's assets
    if (a.folderId !== currentFolderId) return false;
    if (filter !== 'all' && getAssetType(a.mimeType) !== filter) return false;
    if (search) { const q = search.toLowerCase(); const n = (a.originalName || a.fileUrl?.split('/').pop() || '').toLowerCase(); if (!n.includes(q) && !a.mimeType?.toLowerCase().includes(q)) return false; }
    return true;
  });

  const folderAssets = (assets||[]).filter((a:any) => a.folderId === currentFolderId);
  const counts = { all: folderAssets.length, images: folderAssets.filter((a:any)=>a.mimeType?.startsWith('image/')).length, videos: folderAssets.filter((a:any)=>a.mimeType?.startsWith('video/')).length, audio: folderAssets.filter((a:any)=>a.mimeType?.startsWith('audio/')).length, urls: folderAssets.filter((a:any)=>a.mimeType==='text/html').length, documents: folderAssets.filter((a:any)=>a.mimeType==='application/pdf').length };

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
  // Same lazy-PDF-iframe pattern used in PlaylistPreviewThumb's
  // LazyPdfThumb. Inlined here for now; refactor to shared component
  // if a third surface needs it.
  const isPdf = (a: any) => {
    if (!a) return false;
    const m = a.mimeType || '';
    if (m === 'application/pdf' || m === 'application/x-pdf') return true;
    const url = String(a.fileUrl || '').split('?')[0].split('#')[0].toLowerCase();
    return url.endsWith('.pdf');
  };
  const pdfPreviewUrl = (a: any) => {
    const url = a.fileUrl?.startsWith('http') ? a.fileUrl : `${apiBase}${a.fileUrl}`;
    // Strip viewer chrome so the tile reads as a thumbnail. Matches
    // the playlist-tile pattern from commit 3a04653.
    return url + (url.includes('#') ? '&' : '#') + 'view=Fit&toolbar=0&navpanes=0&scrollbar=0';
  };
  const assetName = (a: any) => a.originalName || (a.mimeType === 'text/html' ? a.fileUrl : a.fileUrl?.split('/').pop()) || 'Untitled';

  const selectedThumb = selectedAsset ? thumbUrl(selectedAsset) : null;
  // Server-measured dims first (see metaDims). Legacy assets without
  // processing meta fall back to client measuring — against the ORIGINAL
  // file URL, never the 320px transformed thumbnail (measuring the thumb
  // was the "wrong resolution vs every other CMS" bug, 2026-07-09).
  const selectedMetaDims = selectedAsset ? metaDims(selectedAsset) : null;
  const selectedRawUrl =
    selectedAsset?.fileUrl && selectedAsset.mimeType?.startsWith('image/')
      ? (selectedAsset.fileUrl.startsWith('http') ? selectedAsset.fileUrl : `${apiBase}${selectedAsset.fileUrl}`)
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

  // Focus URL input when the URL form opens
  useEffect(() => {
    if (showUrlForm) urlInputRef.current?.focus();
  }, [showUrlForm]);

  // Focus new-folder input when the folder form opens
  useEffect(() => {
    if (showNewFolder) newFolderInputRef.current?.focus();
  }, [showNewFolder]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-800">Media Library</h1>
          <p className="text-sm text-slate-500 mt-0.5">{counts.all} assets — drag files or click to upload</p>
        </div>
        <div className="flex gap-2">
          {selectedIds.length > 0 && (
            <>
              {/* 2026-05-29 (mobile P1) — bulk actions surface on touch
                  (tiles get a tap-to-select affordance below), so bump
                  these to the 44px touch minimum too; compact on ≥sm. */}
              {/* Primary action: build a playlist straight from the
                  selected files (jumps to the pre-seeded wizard). */}
              <button
                type="button"
                onClick={handleCreatePlaylistFromSelection}
                disabled={isViewer}
                title={isViewer ? 'Read-only — viewer role' : 'Create a playlist from the selected files'}
                className="min-h-11 sm:min-h-0 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg shadow-sm transition-all flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ListPlus className="w-4 h-4" /> Create playlist ({selectedIds.length})
              </button>
              <button
                type="button"
                onClick={() => setShowFolderPicker('bulk-move')}
                disabled={isViewer}
                title={isViewer ? 'Read-only — viewer role' : undefined}
                className="min-h-11 sm:min-h-0 px-4 py-2 bg-white border border-indigo-300 hover:bg-indigo-50 text-indigo-700 text-xs font-bold rounded-lg shadow-sm transition-all flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <FolderInput className="w-4 h-4" /> Move to folder ({selectedIds.length})
              </button>
              <button
                onClick={handleBulkDelete}
                disabled={isViewer}
                title={isViewer ? 'Read-only — viewer role' : undefined}
                className="min-h-11 sm:min-h-0 px-4 py-2 bg-red-500 hover:bg-red-600 text-white text-xs font-bold rounded-lg shadow-sm transition-all flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Trash2 className="w-4 h-4" /> Delete ({selectedIds.length})
              </button>
            </>
          )}
          {/* 2026-06-26 — AI image generation. Hidden entirely when no AI
              provider is configured (the button self-gates via the same
              getAiStatusSource() the sparkle button uses). On success the
              hook invalidates ['assets'] so the new image appears in the
              library. */}
          <AiImageGenerateButton disabled={isViewer} />
          <button
            onClick={() => setShowUrlForm(!showUrlForm)}
            disabled={isViewer}
            title={isViewer ? 'Read-only — viewer role' : undefined}
            /* 2026-05-29 (mobile P1) — was px-3 py-2 = 34px tall, under the
               44px touch minimum. Bump to min-h-11 on touch, compact on ≥sm. */
            className="min-h-11 sm:min-h-0 px-3 py-2 bg-white border border-slate-200 hover:border-indigo-300 text-slate-700 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Link2 className="w-3.5 h-3.5 text-indigo-500" /> Add URL
          </button>
          {/* Single Upload button — opens the searchable FolderPicker
              first so the operator picks a destination (with root as
              an option + inline folder creation), then the native
              file chooser fires. Drag-and-drop also routes through
              the picker but retains the dragged files. */}
          <button
            onClick={() => { setPendingFiles([]); setShowFolderPicker('upload'); }}
            disabled={isViewer}
            /* 2026-05-29 (mobile P1) — min-h-11 on touch (was 34px). */
            className="min-h-11 sm:min-h-0 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-lg shadow-sm transition-all flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
            title={isViewer ? 'Read-only — viewer role' : 'Pick a destination folder (root is an option), then select files'}
          >
            <UploadCloud className="w-4 h-4" />
            Upload
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

      {/* URL form */}
      {showUrlForm && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex gap-3">
          <input ref={urlInputRef} value={webUrl} onChange={e => setWebUrl(e.target.value)} placeholder="https://docs.google.com/presentation/d/..." className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-indigo-500" onKeyDown={e => e.key === 'Enter' && handleAddUrl()} />
          <button
            onClick={handleAddUrl}
            disabled={addWebUrl.isPending || isViewer}
            title={isViewer ? 'Read-only — viewer role' : undefined}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold rounded-lg"
          >{addWebUrl.isPending ? 'Adding...' : 'Add'}</button>
          <button onClick={() => setShowUrlForm(false)} className="px-2 text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Drop zone — both click AND drop route through the FolderPicker
          so the operator always gets to choose root vs. a specific
          folder (and create a new one inline). Dragged files are
          retained across the picker so they don't have to be selected
          twice. */}
      <div
        role="button"
        tabIndex={isViewer ? -1 : 0}
        aria-disabled={isViewer || undefined}
        aria-label={isViewer ? 'Upload disabled — viewer role' : 'Upload files — drag and drop or press Enter to browse'}
        title={isViewer ? 'Read-only — viewer role' : undefined}
        onDragOver={e => { if (isViewer) return; e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => { if (isViewer) return; setDragOver(false); }}
        onDrop={e => {
          if (isViewer) return;
          e.preventDefault();
          setDragOver(false);
          const files = Array.from(e.dataTransfer.files || []);
          if (files.length === 0) return;
          setPendingFiles(files);
          setShowFolderPicker('upload');
        }}
        onClick={() => { if (isViewer) return; setPendingFiles([]); setShowFolderPicker('upload'); }}
        onKeyDown={e => { if (isViewer) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPendingFiles([]); setShowFolderPicker('upload'); } }}
        // 2026-06-16 mobile-UX: DESKTOP-ONLY (hidden md:flex). You can't
        // drag-and-drop on a phone, and the header already has an "Upload"
        // button — a second full-width upload control on mobile was redundant
        // ("two upload buttons"). Mobile uses the header button; this dashed
        // drag-and-drop zone is a desktop affordance only.
        className={`hidden md:flex border-2 border-dashed rounded-3xl p-8 items-center justify-center transition-all group ${isViewer ? 'opacity-50 cursor-not-allowed border-slate-200 bg-slate-50/30' : `cursor-pointer ${dragOver ? 'border-indigo-400 bg-indigo-50/50 scale-[1.01]' : 'border-slate-200 hover:border-indigo-300 bg-slate-50/30'}`}`}
      >
        <div className="flex items-center gap-4">
          <div className={`w-11 h-11 rounded-xl flex items-center justify-center transition-all ${dragOver ? 'bg-indigo-100 scale-110' : 'bg-indigo-50 group-hover:scale-105'}`}>
            <UploadCloud className="w-5 h-5 text-indigo-500" />
          </div>
          <div className="text-left">
            <p className="text-xs font-bold text-slate-700">{dragOver ? 'Drop files to pick a folder' : 'Drag & drop files or click to browse'}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">Choose a folder (or root) next — images, video, audio, PDF, up to 500 MB</p>
          </div>
        </div>
      </div>

      {/* Upload queue */}
      {uploads.length > 0 && (
        <div className="bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-50 flex justify-between items-center bg-slate-50/50">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Uploads</span>
            <button onClick={() => setUploads(p => p.filter(u => u.phase === 'uploading'))} className="text-[10px] text-indigo-600 hover:text-indigo-800 font-bold">Clear done</button>
          </div>
          <div className="divide-y divide-slate-50 max-h-64 overflow-y-auto">
            {uploads.map(u => (
              <div key={u.id} className="px-4 py-2">
                <div className="flex items-center gap-3">
                  {typeIcon(u.file.type, 'w-3.5 h-3.5')}
                  <span className="flex-1 text-[11px] font-medium text-slate-700 truncate" title={u.file.name}>{u.file.name}</span>
                  <span className="text-[10px] text-slate-400 shrink-0">{fmtSize(u.file.size)}</span>
                  {u.phase === 'uploading' && <div className="w-20 h-1.5 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-indigo-500 transition-all rounded-full" style={{ width: `${u.progress}%` }} /></div>}
                  {u.phase === 'success' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />}
                  {u.phase === 'error' && <X className="w-3.5 h-3.5 text-red-500 shrink-0" />}
                </div>
                {/* Error reason on its own row so long messages (export-as-MP4
                    guidance, file-too-large, server validation errors) can
                    wrap and stay legible. Title attribute preserves the full
                    text on hover so even if it's clipped by vertical
                    scrolling the operator can still read it. */}
                {u.phase === 'error' && u.error && (
                  <p className="text-[10px] text-red-600 font-medium leading-snug mt-1 ml-6 pr-2" title={u.error}>{u.error}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filter + search */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex gap-0.5 bg-slate-100 rounded-lg p-0.5">
          {(['all','images','videos','audio','urls','documents'] as FilterType[]).map(f => (
            <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 text-[11px] font-bold rounded-md transition-all ${filter===f ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              {f === 'all' ? 'All' : f.charAt(0).toUpperCase()+f.slice(1)}{counts[f]>0 ? ` (${counts[f]})` : ''}
            </button>
          ))}
        </div>
        <div className="flex gap-2 items-center">
          <div className="relative"><Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" /><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search..." className="pl-8 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px] outline-none focus:ring-2 focus:ring-indigo-500 w-44" /></div>
          {/* 2026-05-29 (mobile P1) — the grid/list toggles were p-1.5 ≈
              26px, well under the 44px touch minimum and jammed together
              (mis-tap magnet). Give each a 44×44 hit area on touch via
              min-w/min-h-11 + centered icon; compact p-1.5 on ≥sm. */}
          <div className="flex border border-slate-200 rounded-lg overflow-hidden">
            <button onClick={()=>setViewMode('grid')} aria-label="Grid view" aria-pressed={viewMode==='grid'} className={`min-w-11 min-h-11 sm:min-w-0 sm:min-h-0 flex items-center justify-center p-1.5 ${viewMode==='grid'?'bg-slate-100 text-slate-700':'text-slate-400'}`}><Grid3X3 className="w-3.5 h-3.5" /></button>
            <button onClick={()=>setViewMode('list')} aria-label="List view" aria-pressed={viewMode==='list'} className={`min-w-11 min-h-11 sm:min-w-0 sm:min-h-0 flex items-center justify-center p-1.5 ${viewMode==='list'?'bg-slate-100 text-slate-700':'text-slate-400'}`}><List className="w-3.5 h-3.5" /></button>
          </div>
        </div>
      </div>

      {/* Breadcrumb + Folder bar */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex items-center gap-1 text-xs">
          {breadcrumbs.map((bc, i) => (
            <span key={bc.id ?? 'root'} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="w-3 h-3 text-slate-300" />}
              <button
                onClick={() => setCurrentFolderId(bc.id)}
                className={`px-2 py-1 rounded-md transition-colors ${
                  i === breadcrumbs.length - 1
                    ? 'font-bold text-slate-800 bg-slate-100'
                    : 'text-slate-500 hover:text-indigo-600 hover:bg-indigo-50'
                }`}
              >
                {i === 0 && <Home className="w-3 h-3 inline mr-1 -mt-0.5" />}
                {bc.name}
              </button>
            </span>
          ))}
        </div>
        <button
          onClick={() => setShowNewFolder(true)}
          disabled={isViewer}
          title={isViewer ? 'Read-only — viewer role' : undefined}
          className="px-3 py-1.5 bg-white border border-slate-200 hover:border-indigo-300 text-slate-600 text-[11px] font-bold rounded-lg transition-all flex items-center gap-1.5 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <FolderPlus className="w-3.5 h-3.5 text-indigo-500" /> New Folder
        </button>
      </div>

      {/* New folder input */}
      {showNewFolder && (
        <div className="flex gap-2 items-center bg-white rounded-xl border border-indigo-200 shadow-sm p-3">
          <Folder className="w-5 h-5 text-indigo-400 shrink-0" />
          <input
            ref={newFolderInputRef}
            value={newFolderName}
            onChange={e => setNewFolderName(e.target.value)}
            placeholder="Folder name..."
            className="flex-1 px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-indigo-400"
            onKeyDown={e => { if (e.key === 'Enter') handleCreateFolder(); if (e.key === 'Escape') { setShowNewFolder(false); setNewFolderName(''); } }}
          />
          <button
            onClick={handleCreateFolder}
            disabled={createFolder.isPending || isViewer}
            title={isViewer ? 'Read-only — viewer role' : undefined}
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {createFolder.isPending ? 'Creating...' : 'Create'}
          </button>
          <button onClick={() => { setShowNewFolder(false); setNewFolderName(''); }} className="p-1 text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* 2026-05-26 — Folders section: contained card with header,
          counter, expand toggle, and inner scroll cap. Operator: "the
          folders are bleeding into the content...keep those sections
          separated...when I have 100 folders how will I be able to see
          them all? thinking about the UX and resolve". First 12 visible
          by default; "Show all (N)" reveals the rest inside a 480px
          max-height scroll region. A Files heading sits below to
          establish the boundary visually. */}
      {currentFolderChildren.length > 0 && (
        // 2026-05-26 — operator: "line the files and folders text and
        // icons up with each other, just move folders out to the left
        // a little so it lines up". The previous section wrapper had
        // bg-slate-50/60 + border + p-4 which pushed the Folders
        // header in by 16px relative to the Files header below.
        // Dropped the card chrome; visual separation still comes from
        // mb-2 + the inline scroll cap when expanded.
        <section className="mb-2">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <Folder className="w-3.5 h-3.5 text-amber-500" />
              Folders <span className="text-slate-400">({currentFolderChildren.length})</span>
            </h2>
            {currentFolderChildren.length > FOLDERS_PREVIEW_LIMIT && (
              <button
                onClick={() => setShowAllFolders(v => !v)}
                className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
              >
                {showAllFolders ? (
                  <>Collapse <ChevronUp className="w-3 h-3" /></>
                ) : (
                  <>Show all ({currentFolderChildren.length}) <ChevronDown className="w-3 h-3" /></>
                )}
              </button>
            )}
          </div>
          <ul
            className={`grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2 list-none p-0 m-0 ${
              showAllFolders && currentFolderChildren.length > FOLDERS_PREVIEW_LIMIT
                ? 'max-h-[480px] overflow-y-auto pr-1'
                : ''
            }`}
          >
          {(showAllFolders ? currentFolderChildren : currentFolderChildren.slice(0, FOLDERS_PREVIEW_LIMIT)).map((f: any) => (
            // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
            <li
              key={f.id}
              className="group bg-white rounded-xl border border-slate-100 hover:border-indigo-200 hover:shadow-md transition-all relative"
              onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('ring-2', 'ring-indigo-400'); }}
              onDragLeave={e => { e.currentTarget.classList.remove('ring-2', 'ring-indigo-400'); }}
              onDrop={e => {
                e.preventDefault();
                e.currentTarget.classList.remove('ring-2', 'ring-indigo-400');
                const assetId = e.dataTransfer.getData('assetId');
                if (assetId) handleMoveAssetToFolder(assetId, f.id);
              }}
            >
              <div className="flex items-center gap-2.5 px-3 py-3">
                <button
                  className="flex items-center gap-2.5 flex-1 min-w-0 text-left"
                  onClick={() => setCurrentFolderId(f.id)}
                  aria-label={`Open folder ${f.name}`}
                >
                  <FolderOpen className="w-8 h-8 text-amber-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                  {renamingFolder === f.id ? (
                    <input
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onBlur={() => handleRenameFolder(f.id)}
                      onKeyDown={e => { if (e.key === 'Enter') handleRenameFolder(f.id); if (e.key === 'Escape') setRenamingFolder(null); }}
                      className="w-full px-1 py-0.5 text-xs font-semibold bg-indigo-50 border border-indigo-300 rounded outline-none"
                      onClick={e => e.stopPropagation()}
                    />
                  ) : (
                    <p className="text-xs font-semibold text-slate-700 truncate">{f.name}</p>
                  )}
                  <p className="text-[10px] text-slate-400">
                    {f._count?.assets || 0} files{f._count?.children ? `, ${f._count.children} folders` : ''}
                  </p>
                </div>
                </button>
                {/* Folder context menu */}
                <div className="relative">
                  <button
                    onClick={e => { e.stopPropagation(); setFolderMenuOpen(folderMenuOpen === f.id ? null : f.id); }}
                    className="p-1 rounded-md opacity-0 group-hover:opacity-100 hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-all"
                  >
                    <MoreVertical className="w-3.5 h-3.5" />
                  </button>
                  {folderMenuOpen === f.id && (
                    <div role="none" className="absolute right-0 top-7 z-20 bg-white border border-slate-200 rounded-lg shadow-lg py-1 min-w-[120px]" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
                      <button
                        onClick={() => { setRenamingFolder(f.id); setRenameValue(f.name); setFolderMenuOpen(null); }}
                        disabled={isViewer}
                        title={isViewer ? 'Read-only — viewer role' : undefined}
                        className="w-full px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Pencil className="w-3 h-3" /> Rename
                      </button>
                      <button
                        onClick={() => { handleDeleteFolder(f.id); setFolderMenuOpen(null); }}
                        disabled={isViewer}
                        title={isViewer ? 'Read-only — viewer role' : undefined}
                        className="w-full px-3 py-1.5 text-left text-xs text-red-600 hover:bg-red-50 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Trash2 className="w-3 h-3" /> Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </li>
          ))}
          </ul>
        </section>
      )}

      {/* Files section header — only when folders are present, to make
          the boundary explicit. When there are no folders the file grid
          is the whole page and a separate heading would just be noise. */}
      {currentFolderChildren.length > 0 && filtered.length > 0 && !isLoading && !isError && (
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5 mt-1">
          <File className="w-3.5 h-3.5 text-slate-400" />
          Files <span className="text-slate-400">({filtered.length})</span>
        </h2>
      )}

      {/* Asset grid */}
      {isLoading ? (
        <div className="flex justify-center py-16"><div className="w-8 h-8 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" /></div>
      ) : isError ? (
        /* Load error — show the failure instead of falling through to
           the "Empty library" state, which would make an outage look
           like a tenant with no assets. */
        <div className="text-center py-16 bg-white rounded-3xl border border-transparent shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
          <AlertCircle className="w-10 h-10 text-rose-500 mx-auto mb-3" />
          <p className="text-sm text-slate-500">Couldn&apos;t load your asset library. Check your connection and try again.</p>
          <button
            onClick={() => refetch()}
            className="mt-4 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold inline-flex items-center gap-1.5"
          >
            <RefreshCw className="w-4 h-4" /> Retry
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-3xl border border-transparent shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
          <UploadCloud className="w-10 h-10 text-slate-200 mx-auto mb-3" />
          <p className="text-xs font-semibold text-slate-400">{search || filter !== 'all' ? 'No assets match your search' : 'Empty library — upload files to get started'}</p>
        </div>
      ) : viewMode === 'grid' ? (
        // 2026-07-09 — UNIFORM grid with SQUARE, object-contain tiles.
        // v1 (16:9 + object-cover) zoom-cropped portrait signage into
        // unrecognizable bands; v2 (masonry, native-aspect tiles) fixed the
        // crop but read as chaos — operator: "the images are all over the
        // place based on different resolutions". v3: tidy uniform rows,
        // square media boxes, whole image contained (no crop, no zoom) on
        // a soft neutral backdrop. Orderly AND recognizable.
        <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 list-none p-0 m-0">
          {filtered.map((a: any) => {
            const thumb = thumbUrl(a);
            const name = assetName(a);
            const dims = metaDims(a); // server-measured truth for the res badge
            const isSelected = selectedIds.includes(a.id);
            return (
              // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
              <li key={a.id} draggable={!isViewer} onDragStart={e => { if (isViewer) { e.preventDefault(); return; } e.dataTransfer.setData('assetId', a.id); e.dataTransfer.effectAllowed = 'move'; }} className={`bg-white rounded-3xl overflow-hidden group transition-all duration-300 relative border-2 ${isSelected ? 'border-indigo-500 shadow-[0_8px_30px_rgb(99,102,241,0.2)]' : 'border-transparent hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)]'}`}>
                {/* Selection Checkbox Trigger.
                    2026-05-29 (mobile P1) — was opacity-0 + group-hover
                    reveal, which never fires on touch (no :hover on a
                    phone), so bulk-select was desktop-only. Now: when
                    unselected we keep it VISIBLE by default and only
                    hide-until-hover on hover-capable pointers via the
                    `[@media(hover:hover)]` arbitrary variant. Touch users
                    always see the affordance; desktop keeps its clean
                    reveal-on-hover. Bumped to a 44px tap target on touch
                    (w/h-11) with a centered 20px box, compact 20px on ≥sm. */}
                <button
                  onClick={(e) => { e.stopPropagation(); setSelectedIds(p => p.includes(a.id) ? p.filter(id => id !== a.id) : [...p, a.id]); }}
                  aria-label={isSelected ? `Deselect ${name}` : `Select ${name}`}
                  aria-pressed={isSelected}
                  className={`absolute top-2.5 left-2.5 z-20 w-11 h-11 sm:w-5 sm:h-5 flex items-center justify-center transition-all ${isSelected ? 'opacity-100 scale-100' : 'opacity-100 scale-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:scale-90 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-hover:scale-100'}`}
                >
                  <span className={`w-5 h-5 rounded flex items-center justify-center ${isSelected ? 'bg-indigo-500 border border-indigo-500' : 'bg-white border border-slate-300 shadow-sm'}`}>
                    {isSelected && <Check className="w-3.5 h-3.5 text-white" />}
                  </span>
                </button>

                {/* Quick Delete Trash Trigger — same touch-visibility fix
                    as the select checkbox above. 44px tap target on touch. */}
                <button
                  onClick={(e) => { e.stopPropagation(); appConfirm({ title: 'Delete asset?', message: `"${name}" will be permanently deleted.`, tone: 'danger', confirmLabel: 'Delete' }).then(ok => { if (ok) deleteAsset.mutate(a.id); }); }}
                  disabled={isViewer}
                  title={isViewer ? 'Read-only — viewer role' : undefined}
                  aria-label={`Delete ${name}`}
                  className="absolute top-2.5 right-2.5 z-20 w-11 h-11 sm:w-6 sm:h-6 flex items-center justify-center transition-all opacity-100 scale-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:scale-90 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-hover:scale-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className="w-6 h-6 rounded bg-red-500 hover:bg-red-600 flex items-center justify-center shadow-sm">
                    <Trash className="w-3 h-3 text-white" />
                  </span>
                </button>

                <button
                  onClick={() => {
                    // URL assets: click-through to the live page so the
                    // operator can verify "yep, that's the one I added."
                    // Other asset types keep opening the detail panel.
                    if (isUrl(a)) {
                      window.open(a.fileUrl, '_blank', 'noopener,noreferrer');
                    } else {
                      setSelectedAsset(a);
                    }
                  }}
                  aria-label={isUrl(a) ? `Open ${name} in a new tab` : `View details for ${name}`}
                  className="w-full text-left cursor-pointer hover:-translate-y-0 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-500"
                >
                {/* Square media box + object-contain: every image shows in
                    full (portrait, landscape, banner) inside a tidy uniform
                    tile — no zoom-crop, no ragged masonry. */}
                <div className="aspect-square bg-slate-100 flex items-center justify-center relative overflow-hidden">
                  {thumb && isVideo(a) ? (
                    // 2026-06-16 — show a real first-frame POSTER on load
                    // (operator: "videos dont have previews"). The old
                    // preload="none" left tiles blank until hover. preload
                    // "metadata" + a #t=0.1 media fragment paints the first
                    // frame with a SMALL fetch (moov atom + first GOP), not
                    // the whole file — renders a poster in Safari + Chrome.
                    // Hover still plays a live scrub preview.
                    <video
                      src={`${thumb}#t=0.1`}
                      muted
                      playsInline
                      preload="metadata"
                      className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-300"
                      onMouseEnter={(e) => { try { e.currentTarget.play(); } catch { /* ignore */ } }}
                      onMouseLeave={(e) => { try { e.currentTarget.pause(); e.currentTarget.currentTime = 0.1; } catch {} }}
                    />
                  ) : thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/no-noninteractive-element-interactions
                    <img
                      src={thumb}
                      alt={name}
                      loading="lazy"
                      decoding="async"
                      className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-300"
                      onLoad={(e) => {
                        // Fallback for legacy assets with no server-measured
                        // dims — and ONLY when the loaded file is not the
                        // downscaled /render/image/ thumbnail. Stamping the
                        // thumbnail's naturalWidth here was the "resolution
                        // doesn't match any other CMS" bug (2026-07-09):
                        // the badge showed ~320×360 instead of the asset's
                        // true size. Server-measured dims render directly
                        // in the badge span below.
                        const img = e.currentTarget;
                        const badge = img.parentElement?.querySelector('[data-res]') as HTMLElement;
                        if (badge && !dims && img.naturalWidth && !img.src.includes('/render/image/')) {
                          badge.textContent = `${img.naturalWidth}×${img.naturalHeight}`;
                        }
                      }}
                      // mshots sometimes returns an image that fails to
                      // decode on a brand-new URL (the service hasn't
                      // generated the shot yet). Fall back to the globe
                      // icon on error so the tile never renders broken.
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  ) : isPdf(a) ? (
                    // PDF tile: hover-only iframe mount so Chrome's
                    // PDFium toolbar never auto-fades-in on initial
                    // page load. Operator (2026-05-26): "when you
                    // first hit the assets page the stupid settings
                    // pops up on the PDF files....they shouldnt auto
                    // trigger ever unless i highlight over them."
                    // PdfHoverThumb renders a static rose-gradient +
                    // FileText placeholder until the operator hovers,
                    // then mounts the iframe (same -56px crop trick
                    // applies for the brief moment the toolbar appears
                    // on hover). No more N concurrent PDF fetches on
                    // page load either — bandwidth win.
                    <PdfHoverThumb fileUrl={a.fileUrl} title={name} />
                  ) : (
                    typeIcon(a.mimeType, 'w-8 h-8')
                  )}
                  {/* 2026-06-16 — type tag moved to the BOTTOM-LEFT corner.
                      It used to sit top-right (top-1.5 right-1.5) where it
                      collided with the always-on-touch delete trash (top-2.5
                      right-2.5): on a phone both rendered in the same corner
                      and, because each file type's badge is a different width,
                      the red delete square appeared shoved to a different spot
                      on every tile ("delete icons all over"). Four clean
                      corners now: ☐ select TL · 🗑 delete TR · tag BL · res BR.
                      No hover-hide needed — it no longer contends with the
                      trash, so the tag stays consistently visible. */}
                  <div className="absolute bottom-1.5 left-1.5">{typeBadge(a.mimeType, { onImage: true })}</div>
                  {thumb && (dims ? (
                    // Server-measured dims (React-owned text).
                    <span className="absolute bottom-1.5 right-1.5 text-[9px] font-bold text-white bg-black/50 backdrop-blur-sm px-1.5 py-0.5 rounded">{`${dims.w}×${dims.h}`}</span>
                  ) : (
                    // Legacy fallback target: stays CHILDLESS so the img
                    // onLoad's imperative textContent stamp never fights
                    // React over a text node it owns.
                    <span data-res="" className="absolute bottom-1.5 right-1.5 text-[9px] font-bold text-white bg-black/50 backdrop-blur-sm px-1.5 py-0.5 rounded" />
                  ))}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                    <div className="w-8 h-8 bg-white/90 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all scale-75 group-hover:scale-100 shadow-lg mt-4">
                      {isUrl(a) ? <Globe className="w-4 h-4 text-emerald-600" /> : <Eye className="w-4 h-4 text-slate-700" />}
                    </div>
                  </div>
                </div>
                <div className="p-2.5">
                  <p className="text-[11px] font-semibold text-slate-700 truncate">{name}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">{fmtSize(a.fileSize)}</p>
                </div>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <ul className="bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] divide-y divide-slate-50/50 overflow-hidden list-none p-0 m-0">
          {filtered.map((a: any) => {
            const thumb = thumbUrl(a);
            const name = assetName(a);
            const isSelected = selectedIds.includes(a.id);
            return (
              // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
              <li key={a.id} draggable={!isViewer} onDragStart={e => { if (isViewer) { e.preventDefault(); return; } e.dataTransfer.setData('assetId', a.id); e.dataTransfer.effectAllowed = 'move'; }} className={`flex items-center gap-4 px-4 py-3 transition-colors group ${isSelected ? 'bg-indigo-50/50' : 'hover:bg-slate-50'}`}>
                {/* 2026-05-29 (mobile P1) — 44px tap target on touch
                    (compact 16px box on ≥sm); already touch-visible. */}
                <button
                  onClick={(e) => { e.stopPropagation(); setSelectedIds(p => p.includes(a.id) ? p.filter(id => id !== a.id) : [...p, a.id]); }}
                  aria-label={isSelected ? `Deselect ${name}` : `Select ${name}`}
                  aria-pressed={isSelected}
                  className="w-11 h-11 sm:w-4 sm:h-4 -my-3 sm:my-0 flex items-center justify-center transition-all shrink-0"
                >
                  <span className={`w-4 h-4 rounded flex items-center justify-center ${isSelected ? 'bg-indigo-500 border border-indigo-500' : 'bg-white border border-slate-300 shadow-sm'}`}>
                    {isSelected && <Check className="w-3 h-3 text-white" />}
                  </span>
                </button>
                <button
                  onClick={() => {
                    if (isUrl(a)) {
                      window.open(a.fileUrl, '_blank', 'noopener,noreferrer');
                    } else {
                      setSelectedAsset(a);
                    }
                  }}
                  aria-label={isUrl(a) ? `Open ${name} in a new tab` : `View details for ${name}`}
                  className="flex items-center gap-4 flex-1 min-w-0 text-left"
                >
                  <div className="w-12 h-12 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center overflow-hidden shrink-0">
                    {thumb && isVideo(a) ? (
                      // 2026-06-16 — first-frame poster via preload="metadata"
                      // + #t=0.1 media fragment (small fetch, not the whole
                      // file) so list-view video rows show a real thumbnail
                      // instead of a blank box.
                      <video
                        src={`${thumb}#t=0.1`}
                        muted
                        playsInline
                        preload="metadata"
                        className="w-full h-full object-cover"
                      />
                    ) : thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={thumb}
                        alt=""
                        className="w-full h-full object-cover"
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                      />
                    ) : typeIcon(a.mimeType)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-slate-700 truncate">{name}</p>
                    <p className="text-[10px] text-slate-400">{a.mimeType} • {fmtSize(a.fileSize)} • {a.uploadedBy?.email}</p>
                  </div>
                </button>
                <div className="flex items-center gap-3">
                  {/* 2026-05-29 (mobile P1) — was opacity-0 group-hover,
                      invisible on touch. Visible by default; hide-until-
                      hover only on hover-capable pointers. 44px tap target
                      on touch, compact 24px on ≥sm. */}
                  <button
                    onClick={(e) => { e.stopPropagation(); appConfirm({ title: 'Delete asset?', message: `"${name}" will be permanently deleted.`, tone: 'danger', confirmLabel: 'Delete' }).then(ok => { if (ok) deleteAsset.mutate(a.id); }); }}
                    disabled={isViewer}
                    title={isViewer ? 'Read-only — viewer role' : undefined}
                    aria-label={`Delete ${name}`}
                    className="w-11 h-11 sm:w-6 sm:h-6 -my-3 sm:my-0 flex items-center justify-center transition-all opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <span className="w-6 h-6 rounded bg-slate-200 hover:bg-red-500 text-slate-500 hover:text-white flex items-center justify-center">
                      <Trash className="w-3 h-3" />
                    </span>
                  </button>
                  {typeBadge(a.mimeType)}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Detail Panel (slide-over) */}
      {selectedAsset && (
        <div className="fixed inset-0 z-50 flex">
          <button aria-label="Close detail panel" className="absolute inset-0 bg-black/50 backdrop-blur-sm cursor-default" onClick={() => setSelectedAsset(null)} />
          {/* 2026-07-09 — centered two-column detail modal (operator:
              "center the preview, enlarge it a little and use some of the
              extra wasted space"). Was a narrow right-side drawer with a
              fixed 16:9 preview strip — portrait signage letterboxed into
              a small band while ~60% of the screen sat as dimmed backdrop.
              Now: centered modal; preview owns the full-height left stage
              (flex-1), metadata is a fixed 400px column right. On phones it
              stacks (preview strip on top, details scroll below). */}
          <div className="m-auto w-full h-full md:h-[85vh] md:max-w-5xl bg-white shadow-2xl relative z-10 flex flex-col md:flex-row overflow-hidden md:rounded-3xl animate-in zoom-in-95 fade-in duration-200">
            {/* Preview */}
            {/* Preview stage: full-height left column on desktop (no more
                fixed 16:9 letterbox band); 45vh strip on phones. */}
            <div className="h-[45vh] shrink-0 md:h-auto md:flex-1 bg-slate-900 flex items-center justify-center relative overflow-hidden">
              {selectedAsset.mimeType?.startsWith('image/') ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={selectedAsset.fileUrl?.startsWith('http') ? selectedAsset.fileUrl : `${apiBase}${selectedAsset.fileUrl}`} alt="" className="max-w-full max-h-full object-contain" />
              ) : selectedAsset.mimeType?.startsWith('video/') ? (
                <video src={selectedAsset.fileUrl?.startsWith('http') ? selectedAsset.fileUrl : `${apiBase}${selectedAsset.fileUrl}`} controls autoPlay className="max-w-full max-h-full" />
              ) : selectedAsset.mimeType?.startsWith('audio/') ? (
                <div className="text-center px-8 w-full">
                  {typeIcon(selectedAsset.mimeType, 'w-12 h-12 mx-auto mb-4')}
                  <audio src={selectedAsset.fileUrl?.startsWith('http') ? selectedAsset.fileUrl : `${apiBase}${selectedAsset.fileUrl}`} controls autoPlay className="w-full" />
                </div>
              ) : selectedAsset.mimeType === 'text/html' ? (
                // Lane-1 P1: sandbox uploaded HTML assets. Any CONTRIBUTOR
                // can upload text/html; without sandbox the page runs same-
                // origin and can read the operator's session storage / cookies.
                // `allow-scripts` keeps interactive previews; no
                // `allow-same-origin` blocks document.cookie / localStorage.
                <iframe
                  src={selectedAsset.fileUrl}
                  sandbox="allow-scripts"
                  className="w-full h-full border-0 bg-white"
                />
              ) : (
                <div className="text-center text-white">{typeIcon(selectedAsset.mimeType, 'w-16 h-16 mx-auto')}<p className="mt-3 text-xs opacity-50">Preview not available</p></div>
              )}
            </div>

            {/* Close — pinned to the MODAL's top-right corner (not the
                preview pane's) so it stays in the expected spot in the
                two-column desktop layout. */}
            <button onClick={() => setSelectedAsset(null)} aria-label="Close" className="absolute top-3 right-3 z-20 w-8 h-8 bg-slate-900/50 hover:bg-slate-900/70 rounded-full flex items-center justify-center text-white transition-colors">
              <X className="w-4 h-4" />
            </button>

            {/* Metadata */}
            <div className="flex-1 md:flex-none md:w-[400px] md:border-l md:border-slate-100 overflow-y-auto p-6 space-y-6">
              <div>
                <h2 className="text-base font-bold text-slate-800 break-all">{assetName(selectedAsset)}</h2>
                <p className="text-xs text-slate-400 mt-1">Uploaded {fmtDate(selectedAsset.createdAt)}</p>
              </div>

              {/* Info grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-50 rounded-lg p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Info className="w-3 h-3 text-slate-400" />
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Type</span>
                  </div>
                  <p className="text-xs font-semibold text-slate-700">{selectedAsset.mimeType}</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <HardDrive className="w-3 h-3 text-slate-400" />
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Size</span>
                  </div>
                  <p className="text-xs font-semibold text-slate-700">{fmtSize(selectedAsset.fileSize)}</p>
                </div>
                {selectedDims && (
                  <div className="bg-slate-50 rounded-lg p-3">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Maximize2 className="w-3 h-3 text-slate-400" />
                      <span className="text-[10px] font-bold text-slate-400 uppercase">Resolution</span>
                    </div>
                    <p className="text-xs font-semibold text-slate-700">{selectedDims.w} × {selectedDims.h} px</p>
                  </div>
                )}
                <div className="bg-slate-50 rounded-lg p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Clock className="w-3 h-3 text-slate-400" />
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Uploaded</span>
                  </div>
                  <p className="text-xs font-semibold text-slate-700">{fmtDate(selectedAsset.createdAt)}</p>
                </div>
              </div>

              {/* Uploader */}
              <div className="flex items-center gap-3 bg-slate-50 rounded-lg p-3">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-500 to-violet-500 flex items-center justify-center text-white text-[10px] font-bold">
                  {selectedAsset.uploadedBy?.email?.substring(0, 2).toUpperCase() || '??'}
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-700">{selectedAsset.uploadedBy?.email || 'System'}</p>
                  <p className="text-[10px] text-slate-400">Uploader</p>
                </div>
              </div>

              {/* Status */}
              <div className="flex items-center justify-between bg-slate-50 rounded-lg p-3">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Status</span>
                <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${selectedAsset.status === 'PUBLISHED' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
                  {selectedAsset.status === 'PUBLISHED' ? '● Published' : '○ Pending'}
                </span>
              </div>

              {/* Folder */}
              <div className="flex items-center justify-between bg-slate-50 rounded-lg p-3">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Folder</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-600 flex items-center gap-1">
                    <Folder className="w-3 h-3 text-amber-400" />
                    {selectedAsset.folder?.name || 'Root'}
                  </span>
                  {selectedAsset.folderId && (
                    <button
                      onClick={() => { handleMoveAssetToFolder(selectedAsset.id, null); setSelectedAsset({ ...selectedAsset, folderId: null, folder: null }); }}
                      disabled={isViewer}
                      title={isViewer ? 'Read-only — viewer role' : undefined}
                      className="text-[10px] text-indigo-600 hover:text-indigo-800 font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Move to root
                    </button>
                  )}
                </div>
              </div>

              {/* Alt text — Audit P1-2 (2026-05-28).
                  Only for image assets. Auto-populated by AI at upload
                  time; operator can edit or regenerate from here.
                  Screen readers read this when the image is rendered;
                  also indexed for search-within-library. */}
              {(selectedAsset.mimeType || '').startsWith('image/') && (
                <div className="bg-slate-50 rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Alt text</span>
                    <span className={`text-[10px] font-bold ${altTextDraft.length > 125 ? 'text-amber-600' : 'text-slate-400'}`}>
                      {altTextDraft.length}/160
                    </span>
                  </div>
                  <textarea
                    value={altTextDraft}
                    onChange={(e) => {
                      const v = e.target.value.slice(0, 160);
                      setAltTextDraft(v);
                      setAltTextDirty(v !== (selectedAsset.altText ?? ''));
                    }}
                    placeholder={selectedAsset.altText === null || selectedAsset.altText === undefined ? 'No alt text yet. Click ✨ Generate to use AI, or type a description.' : ''}
                    disabled={isViewer}
                    rows={2}
                    maxLength={160}
                    className="w-full text-xs px-2 py-1.5 bg-white border border-slate-200 rounded text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed resize-none"
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
                          // Surface structured errors clearly so the
                          // operator knows whether to add credit or
                          // configure an AI key. apiFetch wraps the
                          // HttpException body as `err.code` + `err.body`
                          // (see api-client.ts audit-W8).
                          const code = e?.code;
                          if (code === 'AI_QUOTA_EXHAUSTED') {
                            await appConfirm({
                              title: 'AI quota exhausted',
                              message: e?.body?.message || e?.message || 'Add credit to your AI provider account and try again.',
                              tone: 'warn',
                              confirmLabel: 'OK',
                            });
                          } else if (code === 'AI_ALT_TEXT_UNAVAILABLE') {
                            await appConfirm({
                              title: 'AI not configured',
                              message: 'Configure an AI provider key in Settings → AI provider to enable alt-text generation.',
                              tone: 'warn',
                              confirmLabel: 'OK',
                            });
                          } else {
                            clog.error('upload', 'alt-text generate failed', { msg: e?.message });
                          }
                        }
                      }}
                      disabled={isViewer || generateAltText.isPending}
                      title={isViewer ? 'Read-only — viewer role' : 'Generate alt text from this image using AI'}
                      className="flex-1 px-2 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-[11px] font-bold rounded flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {generateAltText.isPending ? (
                        <>
                          <Loader2 className="w-3 h-3 animate-spin" />
                          Generating…
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-3 h-3" />
                          {selectedAsset.altText ? 'Regenerate' : 'Generate alt text'}
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
                        className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[11px] font-bold rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Save
                      </button>
                    )}
                  </div>
                  <p className="text-[10px] text-slate-400 leading-relaxed">
                    Screen-reader description. Keep it under 125 characters and skip "image of" — just describe the content.
                  </p>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2 pt-2">
                <a href={selectedAsset.fileUrl?.startsWith('http') ? selectedAsset.fileUrl : `${apiBase}${selectedAsset.fileUrl}`} download={assetName(selectedAsset)} target="_blank" rel="noreferrer" className="flex-1 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg text-center flex items-center justify-center gap-1.5 transition-colors">
                  <Download className="w-3.5 h-3.5" /> Download
                </a>
                <button
                  onClick={async () => { if (await appConfirm({ title: 'Delete asset?', message: `"${assetName(selectedAsset)}" will be permanently deleted.`, tone: 'danger', confirmLabel: 'Delete' })) { deleteAsset.mutate(selectedAsset.id); setSelectedAsset(null); }}}
                  disabled={isViewer}
                  title={isViewer ? 'Read-only — viewer role' : undefined}
                  className="px-4 py-2.5 bg-red-50 hover:bg-red-100 text-red-600 text-xs font-bold rounded-lg flex items-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Searchable folder picker — one component, two flows:
          - 'upload'    : chose destination before opening file chooser
                          (or before uploading retained pendingFiles)
          - 'bulk-move' : chose destination for selectedIds                     */}
      {showFolderPicker && (
        <FolderPicker
          folders={(folders || []).map((f: any) => ({
            id: f.id,
            name: f.name,
            parentId: f.parentId ?? null,
          }))}
          initialSelectedId={showFolderPicker === 'upload' ? currentFolderId : null}
          // Disable moving a folder into itself in bulk-move (we only
          // move assets, not folders, so this is actually a no-op —
          // but useful if we ever extend to folder moves).
          disabledIds={showFolderPicker === 'bulk-move' ? [] : []}
          title={
            showFolderPicker === 'upload'
              ? (pendingFiles.length > 0
                  ? `Upload ${pendingFiles.length} file${pendingFiles.length === 1 ? '' : 's'} to…`
                  : 'Upload files to which folder?')
              : `Move ${selectedIds.length} item${selectedIds.length === 1 ? '' : 's'} to which folder?`
          }
          subtitle={
            showFolderPicker === 'upload' && pendingFiles.length > 0
              ? pendingFiles.slice(0, 3).map(f => f.name).join(', ')
                + (pendingFiles.length > 3 ? ` + ${pendingFiles.length - 3} more` : '')
              : undefined
          }
          onConfirm={handleFolderPicked}
          onClose={() => { setShowFolderPicker(null); setPendingFiles([]); }}
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
