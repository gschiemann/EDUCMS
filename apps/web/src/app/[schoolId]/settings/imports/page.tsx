'use client';

/**
 * /[schoolId]/settings/imports — Design imports page.
 *
 * 2026-05-03 — operator: "we talked about adding a full canva
 * integration, will that happen? import templates direct from canva
 * and be able to update using our toolbar and editing".
 *
 * Two-stage approach (full rationale in docs/CANVA_INTEGRATION.md):
 *
 *   STAGE 1 (this page, ships now): drag a PDF / PPTX / PNG / JPG
 *   exported from Canva, Slides, Figma, Adobe Express into the upload
 *   zone. We turn it into Asset rows + an auto-named Playlist. Drop
 *   the playlist on any screen → done.
 *
 *   STAGE 2 (pending Canva partner approval): live Canva Connect
 *   OAuth with auto-resync when the source design changes. Page has
 *   a placeholder card explaining the partnership status — once
 *   `CANVA_CLIENT_ID` is set in env the card flips to a real
 *   "Connect Canva" button.
 */

import { useState, useRef } from 'react';
import { apiFetch } from '@/lib/api-client';
import {
  FileUp, Loader2, CheckCircle2, AlertCircle, ExternalLink,
  Sparkles, Image as ImageIcon, FileText, Presentation, Palette, Lock, Clock,
} from 'lucide-react';

interface UploadResult {
  ok: boolean;
  message: string;
  asset?: { id: string; fileUrl: string };
  playlist?: { id: string; name: string };
}

const ACCEPTED_MIME = '.pdf,.pptx,.ppt,.png,.jpg,.jpeg,.webp';
const MAX_BYTES = 50 * 1024 * 1024; // 50MB cap matches the existing asset upload limit

export default function DesignImportsPage() {
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Canva Connect partner status. Driven by env on the API; until the
  // partnership lands the placeholder card just sits there with the
  // "We're applying" copy. Hook would call /integrations/canva/status
  // to flip — leaving as static `false` so the operator knows what's
  // real today.
  const canvaConnectAvailable = false;

  const onFile = async (file: File) => {
    setResult(null);
    if (file.size > MAX_BYTES) {
      setResult({ ok: false, message: `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 50 MB. For larger decks, split into smaller exports first.` });
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('source', /\.pdf$/i.test(file.name) ? 'pdf'
        : /\.(pptx|ppt)$/i.test(file.name) ? 'pptx'
        : 'image');
      const res = await apiFetch<UploadResult>('/imports/design', {
        method: 'POST',
        body: fd,
        headers: {}, // let browser set the multipart boundary
      });
      setResult(res);
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setUploading(false);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onFile(file);
  };

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Hero */}
      <div className="rounded-2xl bg-gradient-to-br from-emerald-600 via-teal-600 to-cyan-600 p-6 text-white relative overflow-hidden">
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(white 1px, transparent 1px)', backgroundSize: '24px 24px' }} />
        <div className="relative flex items-start justify-between gap-6">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight flex items-center gap-2">
              <Sparkles className="w-6 h-6" /> Design imports
            </h1>
            <p className="text-cyan-50 mt-1.5 text-sm max-w-xl">
              Bring a design from Canva, Google Slides, PowerPoint, Figma, or Adobe Express into VenueOS in seconds.
              Drag the exported file in. We turn it into a screen-ready playlist.
            </p>
          </div>
        </div>
      </div>

      {/* Stage 1 — drag-drop import (works today) */}
      <section className="rounded-2xl bg-white border border-slate-200 shadow-sm p-6">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-100 text-emerald-700">Available now</span>
          <h2 className="text-base font-bold text-slate-800">Drop a PDF, PowerPoint, or image</h2>
        </div>
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
            dragOver
              ? 'border-emerald-500 bg-emerald-50'
              : uploading
              ? 'border-slate-300 bg-slate-50 cursor-wait'
              : 'border-slate-300 bg-slate-50/50 hover:border-emerald-400 hover:bg-emerald-50/40'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_MIME}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onFile(file);
            }}
          />
          {uploading ? (
            <div className="flex flex-col items-center gap-2 text-slate-600">
              <Loader2 className="w-8 h-8 animate-spin" />
              <p className="text-sm font-bold">Uploading + converting…</p>
              <p className="text-xs text-slate-500">Multi-page PDFs split into one Asset per page. May take 30s.</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <FileUp className="w-10 h-10 text-emerald-600" />
              <p className="text-sm font-bold text-slate-700">Drag a file here, or click to browse</p>
              <p className="text-xs text-slate-500">PDF, PPTX, PNG, JPG, WEBP · up to 50 MB</p>
            </div>
          )}
        </div>

        {result && (
          <div className={`mt-4 rounded-lg px-4 py-3 text-sm flex items-start gap-2 ${
            result.ok
              ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border border-rose-200 text-rose-800'
          }`}>
            {result.ok ? <CheckCircle2 className="w-5 h-5 flex-shrink-0 mt-0.5" /> : <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />}
            <div className="flex-1 min-w-0">
              <p>{result.message}</p>
              {result.playlist && (
                <p className="mt-1 text-xs">
                  Playlist created: <strong>{result.playlist.name}</strong> — drop it on any screen from the Playlists page.
                </p>
              )}
            </div>
          </div>
        )}

        {/* Source-tool tips — three columns */}
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <SourceTip icon={<Palette className="w-4 h-4" />} tone="emerald" tool="Canva" steps={['Open your design', 'Share → Download', 'File type: PDF Print', 'Drop the file above']} />
          <SourceTip icon={<Presentation className="w-4 h-4" />} tone="amber" tool="Google Slides" steps={['File → Download', 'Pick PDF Document (.pdf)', 'Drop the file above']} />
          <SourceTip icon={<FileText className="w-4 h-4" />} tone="indigo" tool="PowerPoint / Figma / Adobe Express" steps={['Export → PDF (or PPTX)', 'Drop the file above', 'Multi-slide decks → Playlist']} />
        </div>
      </section>

      {/* Stage 2 — Canva Connect (pending partner approval) */}
      <section className="rounded-2xl bg-white border border-slate-200 shadow-sm p-6">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-violet-100 text-violet-700">Live sync — Coming soon</span>
          <h2 className="text-base font-bold text-slate-800">Canva Connect (auto-sync)</h2>
        </div>
        {canvaConnectAvailable ? (
          <div>
            <p className="text-sm text-slate-600 mb-3">Sign in with your Canva account to auto-sync your designs to VenueOS.</p>
            <button className="px-4 py-2 text-sm font-bold rounded-lg bg-violet-600 text-white hover:bg-violet-700 inline-flex items-center gap-2">
              <Palette className="w-4 h-4" /> Connect Canva
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg bg-violet-50 border border-violet-200 p-4 flex items-start gap-3">
              <Lock className="w-5 h-5 text-violet-600 flex-shrink-0 mt-0.5" />
              <div className="text-xs text-violet-900 leading-relaxed">
                <strong>Canva Connect requires partner approval.</strong> We're applying via{' '}
                <a href="https://www.canva.dev/docs/connect/" target="_blank" rel="noreferrer" className="underline inline-flex items-center gap-0.5">
                  canva.dev/docs/connect <ExternalLink className="w-3 h-3" />
                </a>{' '}
                — typical lead time is 2-4 weeks once the application is in. Once we're approved, this page flips to a one-click "Sign in with Canva" flow with auto-resync.
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-700 space-y-2">
              <h3 className="font-bold text-slate-900 flex items-center gap-2"><Clock className="w-4 h-4" /> What stage 2 will add</h3>
              <ul className="list-disc pl-5 space-y-1">
                <li>OAuth — sign in with your Canva account, no credentials shared</li>
                <li>Design picker — paginated list of your Canva designs with thumbnails</li>
                <li>Auto-resync — daily check (or 4×/hr for high-change designs) re-fetches when Canva\'s `updated_at` is newer</li>
                <li>Template autofill — for Canva designs with declared template variables, edit the text in our editor and we push back via Canva\'s autofill API</li>
                <li>Same code path lights up Google Slides + PowerPoint Online + Figma + Adobe Express within the following weeks</li>
              </ul>
              <p className="pt-2">Full plan: <a href="/docs/CANVA_INTEGRATION.md" target="_blank" rel="noreferrer" className="text-indigo-600 underline inline-flex items-center gap-0.5">docs/CANVA_INTEGRATION.md <ExternalLink className="w-3 h-3" /></a></p>
            </div>
          </div>
        )}
      </section>

      {/* What works without a bridge today */}
      <section className="rounded-2xl bg-white border border-slate-200 shadow-sm p-6">
        <h2 className="text-base font-bold text-slate-800 mb-3 flex items-center gap-2">
          <ImageIcon className="w-5 h-5 text-indigo-600" /> What you can do once your design is uploaded
        </h2>
        <ul className="text-sm text-slate-700 space-y-2 leading-relaxed">
          <li>• Drop the asset on any screen as a single IMAGE widget — fastest path</li>
          <li>• Use the auto-created Playlist for multi-slide decks (8s per page by default; tune in Playlists)</li>
          <li>• Pair with our Live Stream / Menu Board widgets — your Canva poster runs alongside live POS data</li>
          <li>• Re-export + re-upload to update — every paired screen pulls the new pages on its next sync (typically 30s)</li>
          <li>• Schedule the Playlist via Schedules — same picker as any other content</li>
        </ul>
      </section>
    </div>
  );
}

// ─── Source-tool tip card ──────────────────────────────────────────────
function SourceTip({
  icon, tone, tool, steps,
}: {
  icon: React.ReactNode;
  tone: 'emerald' | 'amber' | 'indigo';
  tool: string;
  steps: string[];
}) {
  const styles = {
    emerald: { bg: 'bg-emerald-50',  border: 'border-emerald-200', icon: 'text-emerald-700' },
    amber:   { bg: 'bg-amber-50',    border: 'border-amber-200',   icon: 'text-amber-700' },
    indigo:  { bg: 'bg-indigo-50',   border: 'border-indigo-200',  icon: 'text-indigo-700' },
  }[tone];
  return (
    <div className={`rounded-lg border ${styles.border} ${styles.bg} p-3`}>
      <div className={`flex items-center gap-1.5 text-xs font-bold ${styles.icon} mb-2`}>
        {icon} {tool}
      </div>
      <ol className="list-decimal pl-4 text-[11px] text-slate-700 space-y-0.5">
        {steps.map((s, i) => <li key={i}>{s}</li>)}
      </ol>
    </div>
  );
}
