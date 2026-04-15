"use client";

import { useState, useRef, useCallback, useEffect } from 'react';
import { UploadCloud, Globe, X, CheckCircle2, File, Link2, Trash2, Grid3X3, List, Search, Eye, Image as ImageIcon, Video, Music, FileText, Download, Clock, HardDrive, Maximize2, Info } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAssets, useAddWebUrl, useDeleteAsset } from '@/hooks/use-api';
import { useUIStore } from '@/store/ui-store';

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
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { data: assets, isLoading } = useAssets();
  const addWebUrl = useAddWebUrl();
  const deleteAsset = useDeleteAsset();

  const apiBase = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1').replace('/api/v1', '');

  const handleFiles = useCallback((files: FileList | null) => {
    if (!files) return;
    const genId = () => { try { return crypto.randomUUID(); } catch { return Math.random().toString(36).substring(2, 10); } };
    const items = Array.from(files).map((file) => {
      const item: UploadItem = { id: genId(), file, progress: 0, phase: 'idle' };
      if (file.size > MAX_FILE_SIZE) { item.phase = 'error'; item.error = `Too large (${fmtSize(file.size)})`; }
      else item.phase = 'uploading';
      return item;
    });
    setUploads(prev => [...items, ...prev]);
    items.filter(u => u.phase === 'uploading').forEach(doUpload);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doUpload = (item: UploadItem) => {
    const fd = new FormData();
    fd.append('file', item.file);
    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) setUploads(p => p.map(u => u.id === item.id ? { ...u, progress: Math.round(e.loaded * 100 / e.total) } : u)); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        setUploads(p => p.map(u => u.id === item.id ? { ...u, progress: 100, phase: 'success' } : u));
        queryClient.invalidateQueries({ queryKey: ['assets'] });
      } else {
        let msg = `Upload failed (${xhr.status})`;
        try { const r = JSON.parse(xhr.responseText); msg = r.message || msg; } catch {}
        setUploads(p => p.map(u => u.id === item.id ? { ...u, phase: 'error', error: msg } : u));
      }
    };
    xhr.onerror = () => setUploads(p => p.map(u => u.id === item.id ? { ...u, phase: 'error', error: 'Network error' } : u));
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';
    xhr.open('POST', `${apiUrl}/assets/upload`);
    const token = useUIStore.getState().token;
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.send(fd);
  };

  const handleAddUrl = async () => { if (!webUrl.trim()) return; await addWebUrl.mutateAsync({ url: webUrl.trim() }); setWebUrl(''); setShowUrlForm(false); };

  const filtered = (assets || []).filter((a: any) => {
    if (filter !== 'all' && getAssetType(a.mimeType) !== filter) return false;
    if (search) { const q = search.toLowerCase(); const n = (a.originalName || a.fileUrl?.split('/').pop() || '').toLowerCase(); if (!n.includes(q) && !a.mimeType?.toLowerCase().includes(q)) return false; }
    return true;
  });

  const counts = { all: (assets||[]).length, images: (assets||[]).filter((a:any)=>a.mimeType?.startsWith('image/')).length, videos: (assets||[]).filter((a:any)=>a.mimeType?.startsWith('video/')).length, audio: (assets||[]).filter((a:any)=>a.mimeType?.startsWith('audio/')).length, urls: (assets||[]).filter((a:any)=>a.mimeType==='text/html').length, documents: (assets||[]).filter((a:any)=>a.mimeType==='application/pdf').length };

  const thumbUrl = (a: any) => {
    if (!a.mimeType?.startsWith('image/')) return null;
    return a.fileUrl?.startsWith('http') ? a.fileUrl : `${apiBase}${a.fileUrl}`;
  };
  const assetName = (a: any) => a.originalName || (a.mimeType === 'text/html' ? a.fileUrl : a.fileUrl?.split('/').pop()) || 'Untitled';

  const selectedThumb = selectedAsset ? thumbUrl(selectedAsset) : null;
  const selectedDims = useImageDimensions(selectedThumb);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-800">Media Library</h1>
          <p className="text-sm text-slate-500 mt-0.5">{counts.all} assets — drag files or click to upload</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowUrlForm(!showUrlForm)} className="px-3 py-2 bg-white border border-slate-200 hover:border-indigo-300 text-slate-700 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 shadow-sm">
            <Link2 className="w-3.5 h-3.5 text-indigo-500" /> Add URL
          </button>
          <button onClick={() => fileInputRef.current?.click()} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-lg shadow-sm transition-all flex items-center gap-1.5">
            <UploadCloud className="w-4 h-4" /> Upload
          </button>
          <input type="file" multiple className="hidden" ref={fileInputRef} accept={ACCEPT_STRING} onChange={e => handleFiles(e.target.files)} />
        </div>
      </div>

      {/* URL form */}
      {showUrlForm && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex gap-3">
          <input value={webUrl} onChange={e => setWebUrl(e.target.value)} placeholder="https://docs.google.com/presentation/d/..." className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-indigo-500" onKeyDown={e => e.key === 'Enter' && handleAddUrl()} autoFocus />
          <button onClick={handleAddUrl} disabled={addWebUrl.isPending} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold rounded-lg">{addWebUrl.isPending ? 'Adding...' : 'Add'}</button>
          <button onClick={() => setShowUrlForm(false)} className="px-2 text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-6 flex items-center justify-center cursor-pointer transition-all group ${dragOver ? 'border-indigo-400 bg-indigo-50/50 scale-[1.01]' : 'border-slate-200 hover:border-indigo-300'}`}
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
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-50 flex justify-between items-center bg-slate-50/50">
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

      {/* Asset grid */}
      {isLoading ? (
        <div className="flex justify-center py-16"><div className="w-8 h-8 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-slate-200">
          <UploadCloud className="w-10 h-10 text-slate-200 mx-auto mb-3" />
          <p className="text-xs font-semibold text-slate-400">{search || filter !== 'all' ? 'No assets match your search' : 'Empty library — upload files to get started'}</p>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {filtered.map((a: any) => {
            const thumb = thumbUrl(a);
            const name = assetName(a);
            return (
              <div key={a.id} onClick={() => setSelectedAsset(a)} className="bg-white rounded-xl border border-slate-200 overflow-hidden group hover:shadow-lg hover:border-indigo-200 transition-all cursor-pointer hover:-translate-y-0.5">
                <div className="aspect-video bg-slate-50 flex items-center justify-center relative overflow-hidden">
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
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
                  <div className="absolute top-1.5 right-1.5">{typeBadge(a.mimeType)}</div>
                  {thumb && (
                    <span data-res="" className="absolute bottom-1.5 left-1.5 text-[9px] font-bold text-white bg-black/50 backdrop-blur-sm px-1.5 py-0.5 rounded" />
                  )}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                    <div className="w-8 h-8 bg-white/90 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all scale-75 group-hover:scale-100 shadow-lg">
                      <Eye className="w-4 h-4 text-slate-700" />
                    </div>
                  </div>
                </div>
                <div className="p-2.5">
                  <p className="text-[11px] font-semibold text-slate-700 truncate">{name}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">{fmtSize(a.fileSize)}</p>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-50 overflow-hidden">
          {filtered.map((a: any) => {
            const thumb = thumbUrl(a);
            const name = assetName(a);
            return (
              <div key={a.id} onClick={() => setSelectedAsset(a)} className="flex items-center gap-4 px-4 py-3 hover:bg-slate-50 transition-colors cursor-pointer">
                <div className="w-12 h-12 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center overflow-hidden shrink-0">
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumb} alt="" className="w-full h-full object-cover" />
                  ) : typeIcon(a.mimeType)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-slate-700 truncate">{name}</p>
                  <p className="text-[10px] text-slate-400">{a.mimeType} • {fmtSize(a.fileSize)} • {a.uploadedBy?.email}</p>
                </div>
                {typeBadge(a.mimeType)}
              </div>
            );
          })}
        </div>
      )}

      {/* Detail Panel (slide-over) */}
      {selectedAsset && (
        <div className="fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setSelectedAsset(null)} />
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

              {/* Actions */}
              <div className="flex gap-2 pt-2">
                <a href={selectedAsset.fileUrl?.startsWith('http') ? selectedAsset.fileUrl : `${apiBase}${selectedAsset.fileUrl}`} download={assetName(selectedAsset)} target="_blank" rel="noreferrer" className="flex-1 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg text-center flex items-center justify-center gap-1.5 transition-colors">
                  <Download className="w-3.5 h-3.5" /> Download
                </a>
                <button
                  onClick={() => { if (confirm(`Delete "${assetName(selectedAsset)}"?`)) { deleteAsset.mutate(selectedAsset.id); setSelectedAsset(null); }}}
                  className="px-4 py-2.5 bg-red-50 hover:bg-red-100 text-red-600 text-xs font-bold rounded-lg flex items-center gap-1.5 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
