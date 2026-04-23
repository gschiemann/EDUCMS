"use client";

import { useState, useRef, useCallback, useEffect } from 'react';
import { appConfirm } from '@/components/ui/app-dialog';
import { UploadCloud, Globe, X, CheckCircle2, File, Link2, Trash2, Grid3X3, List, Search, Eye, Image as ImageIcon, Video, Music, FileText, Download, Clock, HardDrive, Maximize2, Info, FolderPlus, Folder, FolderOpen, FolderInput, ChevronRight, Pencil, Home, MoreVertical, Check, Trash } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAssets, useAddWebUrl, useDeleteAsset, useAssetFolders, useCreateAssetFolder, useRenameAssetFolder, useDeleteAssetFolder, useMoveAsset } from '@/hooks/use-api';
import { useUIStore } from '@/store/ui-store';
import { clog } from '@/lib/client-logger';
import { FolderPicker } from '@/components/assets/FolderPicker';

const MAX_FILE_SIZE = 200 * 1024 * 1024;
const ACCEPT_STRING = '.jpg,.jpeg,.png,.webp,.gif,.svg,.bmp,.mp4,.webm,.mov,.avi,.mp3,.ogg,.wav,.pdf';

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

function typeBadge(mime: string) {
  const ext = mime?.split('/')[1]?.toUpperCase() || 'FILE';
  const short = ext === 'JPEG' ? 'JPG' : ext === 'QUICKTIME' ? 'MOV' : ext === 'MPEG' ? 'MP3' : ext.substring(0, 4);
  const c: Record<string, string> = { images: 'bg-sky-500/10 text-sky-600', videos: 'bg-violet-500/10 text-violet-600', audio: 'bg-amber-500/10 text-amber-600', urls: 'bg-emerald-500/10 text-emerald-600', documents: 'bg-rose-500/10 text-rose-600' };
  return <span className={`text-[9px] font-black px-1.5 py-0.5 rounded ${c[getAssetType(mime)] || 'bg-slate-100 text-slate-500'}`}>{short}</span>;
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

export default function AssetsPage() {
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [filter, setFilter] = useState<FilterType>('all');
  const [search, setSearch] = useState('');
  const [showUrlForm, setShowUrlForm] = useState(false);
  const [webUrl, setWebUrl] = useState('');
  const [selectedAsset, setSelectedAsset] = useState<any>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const newFolderInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { data: assets, isLoading } = useAssets();
  const addWebUrl = useAddWebUrl();
  const deleteAsset = useDeleteAsset();

  // Folder state
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [folderMenuOpen, setFolderMenuOpen] = useState<string | null>(null);
  // Searchable folder picker state:
  //   - showFolderPicker: 'upload' | 'bulk-move' | null — which flow requested it
  //   - uploadOverrideFolderRef: when the picker resolves, stashes the
  //     chosen folderId (or null = root) so the follow-up file-chooser
  //     change event knows where to deposit the files. `undefined` =
  //     no override (plain "Upload here" click uses currentFolderId).
  const [showFolderPicker, setShowFolderPicker] = useState<'upload' | 'bulk-move' | null>(null);
  const uploadOverrideFolderRef = useRef<string | null | undefined>(undefined);
  const { data: folders } = useAssetFolders();
  const createFolder = useCreateAssetFolder();
  const renameFolder = useRenameAssetFolder();
  const deleteFolderMut = useDeleteAssetFolder();
  const moveAsset = useMoveAsset();

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
      await Promise.all(selectedIds.map(id => deleteAsset.mutateAsync(id).catch(e => console.error(e))));
      setSelectedIds([]);
      queryClient.invalidateQueries({ queryKey: ['assets'] });
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

  // Called by FolderPicker on confirm. Routes the chosen destination
  // into the right follow-up based on which flow triggered the picker.
  const handleFolderPicked = (folderId: string | null) => {
    const mode = showFolderPicker;
    setShowFolderPicker(null);
    if (mode === 'upload') {
      uploadOverrideFolderRef.current = folderId;
      // Kick the hidden file input — onChange reads the override.
      fileInputRef.current?.click();
    } else if (mode === 'bulk-move') {
      void handleBulkMove(folderId);
    }
  };

  const handleFiles = useCallback((files: FileList | null, targetFolderIdOverride?: string | null) => {
    if (!files) return;
    const genId = () => { try { return crypto.randomUUID(); } catch { return Math.random().toString(36).substring(2, 10); } };
    const items = Array.from(files).map((file) => {
      const item: UploadItem = { id: genId(), file, progress: 0, phase: 'idle' };
      if (file.size > MAX_FILE_SIZE) { item.phase = 'error'; item.error = `Too large (${fmtSize(file.size)})`; }
      else item.phase = 'uploading';
      return item;
    });
    setUploads(prev => [...items, ...prev]);
    items.filter(u => u.phase === 'uploading').forEach((u) => doUpload(u, targetFolderIdOverride));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doUpload = (item: UploadItem, targetFolderIdOverride?: string | null) => {
    const fd = new FormData();
    fd.append('file', item.file);
    // Destination precedence:
    //   1. Explicit override from the FolderPicker ("upload to X")
    //   2. Current browsed folder (uploads into whatever is open)
    //   3. Root
    // `targetFolderIdOverride === undefined` means no override; use
    // currentFolderId. `null` means "explicit root".
    const targetFolderId =
      targetFolderIdOverride !== undefined ? targetFolderIdOverride : currentFolderId;
    if (targetFolderId) fd.append('folderId', targetFolderId);

    const started = performance.now();
    clog.info('upload', 'Start', {
      id: item.id,
      name: item.file.name,
      size: item.file.size,
      mime: item.file.type,
      folderId: targetFolderId || '(root)',
    });

    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) setUploads(p => p.map(u => u.id === item.id ? { ...u, progress: Math.round(e.loaded * 100 / e.total) } : u)); };
    xhr.onload = () => {
      const elapsedMs = Math.round(performance.now() - started);
      if (xhr.status >= 200 && xhr.status < 300) {
        clog.info('upload', 'Success', { id: item.id, name: item.file.name, status: xhr.status, elapsedMs });
        setUploads(p => p.map(u => u.id === item.id ? { ...u, progress: 100, phase: 'success' } : u));
        queryClient.invalidateQueries({ queryKey: ['assets'] });
      } else {
        let msg = `Upload failed (${xhr.status})`;
        try { const r = JSON.parse(xhr.responseText); msg = r.message || msg; } catch {}
        clog.error('upload', 'Failed', { id: item.id, name: item.file.name, status: xhr.status, msg, elapsedMs });
        setUploads(p => p.map(u => u.id === item.id ? { ...u, phase: 'error', error: msg } : u));
      }
    };
    xhr.onerror = () => {
      clog.error('upload', 'Network error', { id: item.id, name: item.file.name });
      setUploads(p => p.map(u => u.id === item.id ? { ...u, phase: 'error', error: 'Network error' } : u));
    };
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';
    xhr.open('POST', `${apiUrl}/assets/upload`);
    const token = useUIStore.getState().token;
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.send(fd);
  };

  const handleAddUrl = async () => { if (!webUrl.trim()) return; await addWebUrl.mutateAsync({ url: webUrl.trim() }); setWebUrl(''); setShowUrlForm(false); };

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
    if (!a.mimeType?.startsWith('image/') && !a.mimeType?.startsWith('video/')) return null;
    return a.fileUrl?.startsWith('http') ? a.fileUrl : `${apiBase}${a.fileUrl}`;
  };
  const isVideo = (a: any) => a.mimeType?.startsWith('video/');
  const assetName = (a: any) => a.originalName || (a.mimeType === 'text/html' ? a.fileUrl : a.fileUrl?.split('/').pop()) || 'Untitled';

  const selectedThumb = selectedAsset ? thumbUrl(selectedAsset) : null;
  const selectedDims = useImageDimensions(selectedThumb);

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
              <button
                type="button"
                onClick={() => setShowFolderPicker('bulk-move')}
                className="px-4 py-2 bg-white border border-indigo-300 hover:bg-indigo-50 text-indigo-700 text-xs font-bold rounded-lg shadow-sm transition-all flex items-center gap-1.5"
              >
                <FolderInput className="w-4 h-4" /> Move to folder ({selectedIds.length})
              </button>
              <button onClick={handleBulkDelete} className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white text-xs font-bold rounded-lg shadow-sm transition-all flex items-center gap-1.5">
                <Trash2 className="w-4 h-4" /> Delete ({selectedIds.length})
              </button>
            </>
          )}
          <button onClick={() => setShowUrlForm(!showUrlForm)} className="px-3 py-2 bg-white border border-slate-200 hover:border-indigo-300 text-slate-700 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 shadow-sm">
            <Link2 className="w-3.5 h-3.5 text-indigo-500" /> Add URL
          </button>
          {/* Default Upload button uses the CURRENT folder as destination —
              fast path when the operator has already navigated into a
              folder. The secondary 'Upload to…' button opens the
              searchable folder picker for ops with 100s of folders
              who don't want to navigate first. */}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-lg shadow-sm transition-all flex items-center gap-1.5"
            title={currentFolderId ? 'Upload into the folder you have open' : 'Upload to All Files (root)'}
          >
            <UploadCloud className="w-4 h-4" />
            Upload{currentFolderId ? ' here' : ''}
          </button>
          <button
            onClick={() => setShowFolderPicker('upload')}
            className="px-3 py-2 bg-white border border-slate-200 hover:border-indigo-300 text-slate-700 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 shadow-sm"
            title="Pick a destination folder — searchable if you have hundreds"
          >
            <FolderInput className="w-3.5 h-3.5 text-indigo-500" />
            Upload to…
          </button>
          <input
            type="file"
            multiple
            className="hidden"
            ref={fileInputRef}
            accept={ACCEPT_STRING}
            onChange={e => {
              // uploadOverrideFolderRef is set by the FolderPicker
              // ('Upload to…' flow). undefined = no picker fired,
              // use current folder. null = explicit root.
              // <folderId> = specific folder selected.
              const override = uploadOverrideFolderRef.current;
              handleFiles(e.target.files, override);
              uploadOverrideFolderRef.current = undefined;
              // Reset the input so re-selecting the same file fires
              // onChange again.
              e.currentTarget.value = '';
            }}
          />
        </div>
      </div>

      {/* URL form */}
      {showUrlForm && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex gap-3">
          <input ref={urlInputRef} value={webUrl} onChange={e => setWebUrl(e.target.value)} placeholder="https://docs.google.com/presentation/d/..." className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-indigo-500" onKeyDown={e => e.key === 'Enter' && handleAddUrl()} />
          <button onClick={handleAddUrl} disabled={addWebUrl.isPending} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold rounded-lg">{addWebUrl.isPending ? 'Adding...' : 'Add'}</button>
          <button onClick={() => setShowUrlForm(false)} className="px-2 text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Drop zone */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload files — drag and drop or press Enter to browse"
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click(); } }}
        className={`border-2 border-dashed rounded-3xl p-8 flex items-center justify-center cursor-pointer transition-all group ${dragOver ? 'border-indigo-400 bg-indigo-50/50 scale-[1.01]' : 'border-slate-200 hover:border-indigo-300 bg-slate-50/30'}`}
      >
        <div className="flex items-center gap-4">
          <div className={`w-11 h-11 rounded-xl flex items-center justify-center transition-all ${dragOver ? 'bg-indigo-100 scale-110' : 'bg-indigo-50 group-hover:scale-105'}`}>
            <UploadCloud className="w-5 h-5 text-indigo-500" />
          </div>
          <div className="text-left">
            <p className="text-xs font-bold text-slate-700">{dragOver ? 'Drop files to upload' : 'Drag & drop files or click to browse'}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">Images, video, audio, PDF — up to 200 MB each</p>
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
          <div className="divide-y divide-slate-50 max-h-40 overflow-y-auto">
            {uploads.map(u => (
              <div key={u.id} className="px-4 py-2 flex items-center gap-3">
                {typeIcon(u.file.type, 'w-3.5 h-3.5')}
                <span className="flex-1 text-[11px] font-medium text-slate-700 truncate">{u.file.name}</span>
                <span className="text-[10px] text-slate-400 shrink-0">{fmtSize(u.file.size)}</span>
                {u.phase === 'uploading' && <div className="w-20 h-1.5 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-indigo-500 transition-all rounded-full" style={{ width: `${u.progress}%` }} /></div>}
                {u.phase === 'success' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />}
                {u.phase === 'error' && <span className="text-[10px] text-red-500 font-semibold truncate max-w-32">{u.error}</span>}
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
          <div className="flex border border-slate-200 rounded-lg overflow-hidden">
            <button onClick={()=>setViewMode('grid')} className={`p-1.5 ${viewMode==='grid'?'bg-slate-100 text-slate-700':'text-slate-400'}`}><Grid3X3 className="w-3.5 h-3.5" /></button>
            <button onClick={()=>setViewMode('list')} className={`p-1.5 ${viewMode==='list'?'bg-slate-100 text-slate-700':'text-slate-400'}`}><List className="w-3.5 h-3.5" /></button>
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
          className="px-3 py-1.5 bg-white border border-slate-200 hover:border-indigo-300 text-slate-600 text-[11px] font-bold rounded-lg transition-all flex items-center gap-1.5 shadow-sm"
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
          <button onClick={handleCreateFolder} disabled={createFolder.isPending} className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold rounded-lg disabled:opacity-50">
            {createFolder.isPending ? 'Creating...' : 'Create'}
          </button>
          <button onClick={() => { setShowNewFolder(false); setNewFolderName(''); }} className="p-1 text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Folder tiles */}
      {currentFolderChildren.length > 0 && (
        <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2 list-none p-0 m-0">
          {currentFolderChildren.map((f: any) => (
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
                      <button onClick={() => { setRenamingFolder(f.id); setRenameValue(f.name); setFolderMenuOpen(null); }} className="w-full px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-2">
                        <Pencil className="w-3 h-3" /> Rename
                      </button>
                      <button onClick={() => { handleDeleteFolder(f.id); setFolderMenuOpen(null); }} className="w-full px-3 py-1.5 text-left text-xs text-red-600 hover:bg-red-50 flex items-center gap-2">
                        <Trash2 className="w-3 h-3" /> Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Asset grid */}
      {isLoading ? (
        <div className="flex justify-center py-16"><div className="w-8 h-8 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-3xl border border-transparent shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
          <UploadCloud className="w-10 h-10 text-slate-200 mx-auto mb-3" />
          <p className="text-xs font-semibold text-slate-400">{search || filter !== 'all' ? 'No assets match your search' : 'Empty library — upload files to get started'}</p>
        </div>
      ) : viewMode === 'grid' ? (
        <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 list-none p-0 m-0">
          {filtered.map((a: any) => {
            const thumb = thumbUrl(a);
            const name = assetName(a);
            const isSelected = selectedIds.includes(a.id);
            return (
              // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
              <li key={a.id} draggable onDragStart={e => { e.dataTransfer.setData('assetId', a.id); e.dataTransfer.effectAllowed = 'move'; }} className={`bg-white rounded-3xl overflow-hidden group transition-all duration-300 relative border-2 ${isSelected ? 'border-indigo-500 shadow-[0_8px_30px_rgb(99,102,241,0.2)]' : 'border-transparent hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)]'}`}>
                {/* Selection Checkbox Trigger */}
                <button
                  onClick={(e) => { e.stopPropagation(); setSelectedIds(p => p.includes(a.id) ? p.filter(id => id !== a.id) : [...p, a.id]); }}
                  aria-label={isSelected ? `Deselect ${name}` : `Select ${name}`}
                  aria-pressed={isSelected}
                  className={`absolute top-2.5 left-2.5 z-20 w-5 h-5 rounded flex items-center justify-center transition-all ${isSelected ? 'bg-indigo-500 border border-indigo-500 opacity-100 scale-100' : 'bg-white border border-slate-300 opacity-0 scale-90 group-hover:opacity-100 group-hover:scale-100 shadow-sm'}`}
                >
                  {isSelected && <Check className="w-3.5 h-3.5 text-white" />}
                </button>

                {/* Quick Delete Trash Trigger */}
                <button onClick={(e) => { e.stopPropagation(); appConfirm({ title: 'Delete asset?', message: `"${name}" will be permanently deleted.`, tone: 'danger', confirmLabel: 'Delete' }).then(ok => { if (ok) deleteAsset.mutate(a.id); }); }} className="absolute top-2.5 right-2.5 z-20 w-6 h-6 rounded bg-red-500 hover:bg-red-600 flex items-center justify-center transition-all opacity-0 scale-90 group-hover:opacity-100 group-hover:scale-100 shadow-sm">
                  <Trash className="w-3 h-3 text-white" />
                </button>

                <button
                  onClick={() => setSelectedAsset(a)}
                  aria-label={`View details for ${name}`}
                  className="w-full text-left cursor-pointer hover:-translate-y-0 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-500"
                >
                <div className="aspect-video bg-slate-50 flex items-center justify-center relative overflow-hidden">
                  {thumb && isVideo(a) ? (
                    <video
                      src={thumb}
                      muted
                      preload="metadata"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      onMouseEnter={(e) => { try { e.currentTarget.play(); } catch {} }}
                      onMouseLeave={(e) => { try { e.currentTarget.pause(); e.currentTarget.currentTime = 0; } catch {} }}
                    />
                  ) : thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/no-noninteractive-element-interactions
                    <img
                      src={thumb}
                      alt={name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      onLoad={(e) => {
                        const img = e.currentTarget;
                        const badge = img.parentElement?.querySelector('[data-res]') as HTMLElement;
                        if (badge && img.naturalWidth) badge.textContent = `${img.naturalWidth}×${img.naturalHeight}`;
                      }}
                    />
                  ) : (
                    typeIcon(a.mimeType, 'w-8 h-8')
                  )}
                  <div className="absolute top-1.5 right-1.5 group-hover:opacity-0 transition-opacity">{typeBadge(a.mimeType)}</div>
                  {thumb && (
                    <span data-res="" className="absolute bottom-1.5 right-1.5 text-[9px] font-bold text-white bg-black/50 backdrop-blur-sm px-1.5 py-0.5 rounded" />
                  )}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                    <div className="w-8 h-8 bg-white/90 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all scale-75 group-hover:scale-100 shadow-lg mt-4">
                      <Eye className="w-4 h-4 text-slate-700" />
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
              <li key={a.id} draggable onDragStart={e => { e.dataTransfer.setData('assetId', a.id); e.dataTransfer.effectAllowed = 'move'; }} className={`flex items-center gap-4 px-4 py-3 transition-colors group ${isSelected ? 'bg-indigo-50/50' : 'hover:bg-slate-50'}`}>
                <button
                  onClick={(e) => { e.stopPropagation(); setSelectedIds(p => p.includes(a.id) ? p.filter(id => id !== a.id) : [...p, a.id]); }}
                  aria-label={isSelected ? `Deselect ${name}` : `Select ${name}`}
                  aria-pressed={isSelected}
                  className={`w-4 h-4 rounded flex items-center justify-center transition-all ${isSelected ? 'bg-indigo-500 border border-indigo-500 opacity-100' : 'bg-white border border-slate-300 opacity-50 hover:opacity-100 shadow-sm'}`}
                >
                  {isSelected && <Check className="w-3 h-3 text-white" />}
                </button>
                <button
                  onClick={() => setSelectedAsset(a)}
                  aria-label={`View details for ${name}`}
                  className="flex items-center gap-4 flex-1 min-w-0 text-left"
                >
                  <div className="w-12 h-12 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center overflow-hidden shrink-0">
                    {thumb && isVideo(a) ? (
                      <video src={thumb} muted preload="metadata" className="w-full h-full object-cover" />
                    ) : thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumb} alt="" className="w-full h-full object-cover" />
                    ) : typeIcon(a.mimeType)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-slate-700 truncate">{name}</p>
                    <p className="text-[10px] text-slate-400">{a.mimeType} • {fmtSize(a.fileSize)} • {a.uploadedBy?.email}</p>
                  </div>
                </button>
                <div className="flex items-center gap-3">
                  <button onClick={(e) => { e.stopPropagation(); appConfirm({ title: 'Delete asset?', message: `"${name}" will be permanently deleted.`, tone: 'danger', confirmLabel: 'Delete' }).then(ok => { if (ok) deleteAsset.mutate(a.id); }); }} className="w-6 h-6 rounded bg-slate-200 hover:bg-red-500 text-slate-500 hover:text-white flex items-center justify-center transition-all opacity-0 group-hover:opacity-100">
                    <Trash className="w-3 h-3" />
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
          <div className="ml-auto w-full max-w-xl bg-white shadow-2xl relative z-10 flex flex-col animate-in slide-in-from-right">
            {/* Preview */}
            <div className="aspect-video bg-slate-900 flex items-center justify-center relative overflow-hidden shrink-0">
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
                <iframe src={selectedAsset.fileUrl} className="w-full h-full border-0 bg-white" />
              ) : (
                <div className="text-center text-white">{typeIcon(selectedAsset.mimeType, 'w-16 h-16 mx-auto')}<p className="mt-3 text-xs opacity-50">Preview not available</p></div>
              )}
              <button onClick={() => setSelectedAsset(null)} className="absolute top-3 right-3 w-8 h-8 bg-black/40 hover:bg-black/60 rounded-full flex items-center justify-center text-white transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Metadata */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
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
                    <button onClick={() => { handleMoveAssetToFolder(selectedAsset.id, null); setSelectedAsset({ ...selectedAsset, folderId: null, folder: null }); }}
                      className="text-[10px] text-indigo-600 hover:text-indigo-800 font-bold">
                      Move to root
                    </button>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-2">
                <a href={selectedAsset.fileUrl?.startsWith('http') ? selectedAsset.fileUrl : `${apiBase}${selectedAsset.fileUrl}`} download={assetName(selectedAsset)} target="_blank" rel="noreferrer" className="flex-1 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg text-center flex items-center justify-center gap-1.5 transition-colors">
                  <Download className="w-3.5 h-3.5" /> Download
                </a>
                <button
                  onClick={async () => { if (await appConfirm({ title: 'Delete asset?', message: `"${assetName(selectedAsset)}" will be permanently deleted.`, tone: 'danger', confirmLabel: 'Delete' })) { deleteAsset.mutate(selectedAsset.id); setSelectedAsset(null); }}}
                  className="px-4 py-2.5 bg-red-50 hover:bg-red-100 text-red-600 text-xs font-bold rounded-lg flex items-center gap-1.5 transition-colors"
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
              ? 'Upload files to which folder?'
              : `Move ${selectedIds.length} item${selectedIds.length === 1 ? '' : 's'} to which folder?`
          }
          onConfirm={handleFolderPicked}
          onClose={() => setShowFolderPicker(null)}
        />
      )}
    </div>
  );
}
