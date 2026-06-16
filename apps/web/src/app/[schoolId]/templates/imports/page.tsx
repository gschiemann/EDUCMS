'use client';

/**
 * /[schoolId]/templates/imports — Design imports page.
 *
 * 2026-05-25 — Operator pushback on the prior page:
 *   "we are suppose to take a pptx, a pdf, a canva design and bring it
 *    right in as a template but for some reason we drop it into the
 *    playlist menu, also that entire setting screen doesn't follow our
 *    branding for anything and its menu is crazy busy with a ton of
 *    text and even after uploading you really don't know what has
 *    happened, you should upload, preview and say yes add to our
 *    templates, also this entire settings page should not be under
 *    settings, it should be under the template section itself, its not
 *    a setting its a feature"
 *
 * Five things this rewrite addresses:
 *
 *   1. Route relocated. Originally at /[schoolId]/settings/imports —
 *      now under the Templates section because importing IS template
 *      authoring, not a setting. Old URL still resolves: a stub page
 *      under /settings/imports redirects clients here on mount.
 *   2. Output target. We now ask the operator whether the uploaded
 *      design should land as a Template (default — what they
 *      actually wanted) or as a Playlist (legacy behavior). Both
 *      Asset + Playlist + Template rows exist when target=Template;
 *      operators can still drag the playlist on a screen the moment
 *      after the import.
 *   3. Brand-aware shell. Hero + CTAs read `var(--brand-primary)`
 *      so the whole page picks up the tenant's brand kit instead of
 *      the old hard-coded emerald gradient.
 *   4. Three-step UX. Drop → Preview → Add. No marketing wall, no
 *      ambiguous "what just happened" state. Each step is one short
 *      sentence; the operator knows exactly where they are.
 *   5. The /api/v1/imports/design contract is unchanged for legacy
 *      callers: targetType is a new OPTIONAL body field, default
 *      'playlist'. This page sends 'template' or 'playlist'
 *      explicitly based on the operator's choice.
 *
 * Canva Connect (stage 2) gets a small mention at the bottom but no
 * giant marketing card — that lives in docs now, not in the operator's
 * way.
 */

import { useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  FileUp,
  Loader2,
  CheckCircle2,
  AlertCircle,
  LayoutTemplate,
  ListVideo,
  FileText,
  X,
  Image as ImageIcon,
} from 'lucide-react';
import { apiFetch } from '@/lib/api-client';

interface UploadResult {
  ok: boolean;
  message: string;
  targetType?: 'template' | 'playlist';
  asset?: { id: string; fileUrl: string; mimeType: string };
  playlist?: { id: string; name: string };
  template?: { id: string; name: string } | null;
  // Import 2.0 — the full set of editable templates produced (one per
  // page/slide). `template` is the first of these (back-compat).
  templates?: Array<{ id: string; name: string }>;
  // How many editable templates were produced.
  pages?: number;
}

type Step = 'drop' | 'preview' | 'submitting' | 'done';

// Import 2.0 — PowerPoint (.pptx/.ppt) is now structurally parsed into
// real editable templates, so it's back in the accepted set alongside
// PDF + images.
const ACCEPTED_MIME = '.pdf,.png,.jpg,.jpeg,.webp,.pptx,.ppt';
const MAX_BYTES = 50 * 1024 * 1024;

export default function DesignImportsPage() {
  const params = useParams();
  const router = useRouter();
  const schoolId = params?.schoolId as string;

  const [step, setStep] = useState<Step>('drop');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Reset to the drop step. Revokes the object URL so we don't leak
  // blob URIs across multiple re-imports in the same session.
  const reset = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(null);
    setPreviewUrl(null);
    setError(null);
    setResult(null);
    setStep('drop');
  };

  const onFileChosen = (incoming: File) => {
    setError(null);
    setResult(null);
    if (incoming.size > MAX_BYTES) {
      setError(`File too large (${(incoming.size / 1024 / 1024).toFixed(1)} MB). Max 50 MB.`);
      return;
    }
    if (!isAcceptedMime(incoming)) {
      setError(`Unsupported file type. Accepted: PDF, PowerPoint (.pptx), PNG, JPG, WEBP.`);
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(incoming);
    setPreviewUrl(URL.createObjectURL(incoming));
    setStep('preview');
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) onFileChosen(dropped);
  };

  const submit = async (targetType: 'template' | 'playlist') => {
    if (!file) return;
    setStep('submitting');
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('source', deriveSource(file));
      fd.append('targetType', targetType);
      const res = await apiFetch<UploadResult>('/imports/design', {
        method: 'POST',
        body: fd,
        headers: {},
      });
      setResult(res);
      setStep('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep('preview');
    }
  };

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Crumb — single tap target back to the Templates gallery */}
      <button
        type="button"
        onClick={() => router.push(`/${schoolId}/templates`)}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-[var(--brand-primary,#4f46e5)] transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Templates
      </button>

      {/* Brand-aware hero — uses var(--brand-primary) so it picks up
          the tenant's TenantBranding row. Falls back to a neutral
          indigo if no brand. color-mix darkens the right edge for
          depth without forcing a second hardcoded color. */}
      <div
        className="rounded-2xl p-6 text-white relative overflow-hidden"
        style={{
          background:
            'linear-gradient(135deg, var(--brand-primary, #4f46e5) 0%, color-mix(in srgb, var(--brand-primary, #4f46e5) 65%, #1e1b4b) 100%)',
        }}
      >
        <div
          className="absolute top-0 right-0 bottom-0 left-0 opacity-10"
          style={{
            backgroundImage: 'radial-gradient(white 1px, transparent 1px)',
            backgroundSize: '24px 24px',
          }}
        />
        <div className="relative">
          <h1 className="text-2xl font-extrabold tracking-tight flex items-center gap-2">
            <LayoutTemplate className="w-6 h-6" /> Import a design
          </h1>
          <p className="text-white/80 mt-1.5 text-sm max-w-xl">
            Drop a PowerPoint, PDF, Canva, or Slides export. We turn the content into a fully
            editable template — text and images come through as editable layers, not a flat picture.
          </p>
        </div>
      </div>

      {/* Step indicator — short, no marketing copy */}
      <StepRail step={step} />

      {/* Step 1 — Drop */}
      {step === 'drop' && (
        <div
          role="button"
          tabIndex={0}
          aria-label="Click or drag a file to import a design (PDF, PNG, JPG, WEBP)"
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              fileInputRef.current?.click();
            }
          }}
          /* 2026-06-16 mobile-UX: p-5 on phones (was p-12 everywhere) — you
             can't drag-drop on iPhone, so the tall dropzone was wasted height. */
          className={`border-2 border-dashed rounded-2xl p-5 md:p-12 text-center cursor-pointer transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${
            dragOver
              ? 'bg-[color-mix(in_srgb,var(--brand-primary,#4f46e5)_8%,transparent)]'
              : 'bg-white hover:bg-slate-50'
          }`}
          style={{
            borderColor: dragOver
              ? 'var(--brand-primary, #4f46e5)'
              : '#cbd5e1',
            ['--tw-ring-color' as any]: 'var(--brand-primary, #4f46e5)',
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_MIME}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFileChosen(f);
            }}
          />
          <div className="flex flex-col items-center gap-2 md:gap-3">
            <div
              className="w-12 h-12 md:w-16 md:h-16 rounded-2xl flex items-center justify-center"
              style={{
                background: 'color-mix(in srgb, var(--brand-primary, #4f46e5) 12%, transparent)',
              }}
            >
              <FileUp
                className="w-6 h-6 md:w-7 md:h-7"
                style={{ color: 'var(--brand-primary, #4f46e5)' }}
              />
            </div>
            {/* Mobile can't drag — neutral "Upload" label; desktop keeps the drop hint */}
            <p className="text-base font-bold text-slate-800"><span className="md:hidden">Upload a file</span><span className="hidden md:inline">Drop your file</span></p>
            <p className="text-xs text-slate-500">PowerPoint, PDF, PNG, JPG, WEBP up to 50 MB</p>
          </div>
        </div>
      )}

      {error && step === 'drop' && (
        <ErrorBanner message={error} />
      )}

      {/* Step 2 — Preview */}
      {step === 'preview' && file && previewUrl && (
        <div className="space-y-4">
          <div className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50">
              <div className="flex items-center gap-2 min-w-0">
                {file.type === 'application/pdf' || file.type === PPTX_MIME || file.type === PPT_MIME || /\.pptx?$/i.test(file.name) ? (
                  <FileText className="w-4 h-4 text-slate-500 flex-shrink-0" />
                ) : (
                  <ImageIcon className="w-4 h-4 text-slate-500 flex-shrink-0" />
                )}
                <span className="text-sm font-bold text-slate-700 truncate" title={file.name}>
                  {file.name}
                </span>
                <span className="text-[11px] font-mono text-slate-400 flex-shrink-0">
                  {(file.size / 1024 / 1024).toFixed(1)} MB
                </span>
              </div>
              <button
                onClick={reset}
                className="text-slate-400 hover:text-slate-600 transition-colors"
                aria-label="Cancel — pick a different file"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="bg-slate-100 p-4 flex items-center justify-center min-h-[320px]">
              <FilePreview file={file} previewUrl={previewUrl} />
            </div>
          </div>

          {error && <ErrorBanner message={error} />}

          {/* Two-button CTA — brand primary on the recommended action */}
          <div className="flex flex-col sm:flex-row gap-2">
            <button
              onClick={() => submit('template')}
              disabled={!file}
              className="flex-1 px-5 py-3 rounded-xl text-white font-bold text-sm shadow-sm transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              style={{
                background: 'var(--brand-primary, #4f46e5)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.filter = 'brightness(0.92)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.filter = '';
              }}
            >
              <LayoutTemplate className="w-4 h-4" /> Add to Templates
            </button>
            <button
              onClick={() => submit('playlist')}
              disabled={!file}
              className="flex-1 px-5 py-3 rounded-xl bg-white border-2 border-slate-200 text-slate-700 font-bold text-sm hover:bg-slate-50 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <ListVideo className="w-4 h-4" /> Add to Playlists
            </button>
            <button
              onClick={reset}
              className="px-5 py-3 rounded-xl text-slate-500 font-bold text-sm hover:bg-slate-100 transition-colors"
            >
              Cancel
            </button>
          </div>

          {/* Honest, small print — not a marketing wall */}
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Multi-page PowerPoint and PDF files become one editable template per page. Text and images
            come through as editable layers; anything we can&apos;t parse falls back to the page as a single image.
          </p>
        </div>
      )}

      {/* Submitting — honest progress (we don't know the page count
          until the parse finishes server-side, so no fake "X of Y"). */}
      {step === 'submitting' && file && (
        <div className="rounded-2xl bg-white border border-slate-200 shadow-sm p-8 text-center space-y-3">
          <Loader2
            className="w-10 h-10 mx-auto animate-spin"
            style={{ color: 'var(--brand-primary, #4f46e5)' }}
          />
          <p className="text-sm font-bold text-slate-700">Reading your content…</p>
          <p className="text-xs text-slate-500">
            Uploading &ldquo;{file.name}&rdquo; and turning each page into an editable template.
          </p>
        </div>
      )}

      {/* Step 3 — Done */}
      {step === 'done' && result && (
        <DoneCard
          result={result}
          schoolId={schoolId}
          onReset={reset}
          router={router}
        />
      )}
    </div>
  );
}

// ─── Step rail ────────────────────────────────────────────────────────

function StepRail({ step }: { step: Step }) {
  const labels: Array<{ key: Step | 'done'; label: string }> = [
    { key: 'drop', label: 'Drop your file' },
    { key: 'preview', label: 'Preview' },
    { key: 'done', label: 'Add' },
  ];
  const activeIndex = step === 'drop' ? 0 : step === 'preview' || step === 'submitting' ? 1 : 2;
  return (
    <ol className="flex items-center gap-2 text-xs font-semibold">
      {labels.map((l, i) => {
        const active = i === activeIndex;
        const done = i < activeIndex;
        return (
          <li key={l.key} className="flex items-center gap-2">
            <span
              className="inline-flex items-center justify-center w-6 h-6 rounded-full transition-colors"
              style={{
                background: active
                  ? 'var(--brand-primary, #4f46e5)'
                  : done
                  ? 'color-mix(in srgb, var(--brand-primary, #4f46e5) 20%, transparent)'
                  : '#e2e8f0',
                color: active ? '#fff' : done ? 'var(--brand-primary, #4f46e5)' : '#94a3b8',
              }}
            >
              {i + 1}
            </span>
            <span
              className="transition-colors"
              style={{
                color: active
                  ? 'var(--brand-primary, #4f46e5)'
                  : done
                  ? '#475569'
                  : '#94a3b8',
              }}
            >
              {l.label}
            </span>
            {i < labels.length - 1 && (
              <span className="w-6 h-px bg-slate-200 mx-1" aria-hidden />
            )}
          </li>
        );
      })}
    </ol>
  );
}

// ─── File preview renderer ────────────────────────────────────────────

function FilePreview({ file, previewUrl }: { file: File; previewUrl: string }) {
  // PowerPoint has no inline browser preview — show a friendly card that
  // sets the right expectation (we parse it into editable templates).
  if (file.type === PPTX_MIME || file.type === PPT_MIME || /\.pptx?$/i.test(file.name)) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center"
          style={{ background: 'color-mix(in srgb, var(--brand-primary, #4f46e5) 12%, transparent)' }}
        >
          <FileText className="w-7 h-7" style={{ color: 'var(--brand-primary, #4f46e5)' }} />
        </div>
        <p className="text-sm font-bold text-slate-700">PowerPoint ready to import</p>
        <p className="text-xs text-slate-500 max-w-sm">
          We&apos;ll turn each slide into a fully editable template — every text box and image
          comes through as an editable layer, not a flat picture.
        </p>
      </div>
    );
  }
  if (file.type === 'application/pdf') {
    // <embed>/<iframe> with a blob URL renders the PDF inline using the
    // browser's native viewer. This is local-only — the file hasn't
    // been uploaded yet — so no API round-trip latency.
    return (
      <iframe
        src={previewUrl}
        title={`Preview of ${file.name}`}
        className="w-full max-w-3xl rounded-lg bg-white shadow-sm"
        style={{ height: 480, border: '1px solid #e2e8f0' }}
      />
    );
  }
  if (file.type.startsWith('image/')) {
    /* eslint-disable-next-line @next/next/no-img-element */
    return (
      <img
        src={previewUrl}
        alt={`Preview of ${file.name}`}
        className="max-w-full max-h-[480px] rounded-lg bg-white shadow-sm object-contain"
      />
    );
  }
  return (
    <p className="text-sm text-slate-500">Preview not available for this file type.</p>
  );
}

// ─── Error banner ─────────────────────────────────────────────────────

function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-lg px-4 py-3 text-sm flex items-start gap-2 bg-rose-50 border border-rose-200 text-rose-800"
    >
      <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
      <p className="flex-1 min-w-0">{message}</p>
    </div>
  );
}

// ─── Done card ────────────────────────────────────────────────────────

function DoneCard({
  result,
  schoolId,
  onReset,
  router,
}: {
  result: UploadResult;
  schoolId: string;
  onReset: () => void;
  router: ReturnType<typeof useRouter>;
}) {
  const wentToTemplate = !!result.template;
  // Multi-page deck → list every created template so the operator can
  // jump straight to any page/slide, not just the first.
  const multiTemplates = (result.templates ?? []).length > 1 ? result.templates! : null;
  return (
    <div className="rounded-2xl bg-white border border-slate-200 shadow-sm p-6 space-y-4">
      <div className="flex items-start gap-3">
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
          style={{
            background:
              'color-mix(in srgb, var(--brand-primary, #4f46e5) 15%, transparent)',
          }}
        >
          <CheckCircle2
            className="w-6 h-6"
            style={{ color: 'var(--brand-primary, #4f46e5)' }}
          />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-base font-bold text-slate-800">Import complete</p>
          <p className="text-sm text-slate-600 mt-1">{result.message}</p>
        </div>
      </div>

      {multiTemplates && (
        <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
          {multiTemplates.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                // Hard-nav — soft-nav into the builder doesn't render reliably.
                window.location.href = `/${schoolId}/templates/builder/${t.id}`;
              }}
              className="w-full flex items-center justify-between gap-2 px-4 py-2.5 text-left hover:bg-slate-50 transition-colors"
            >
              <span className="flex items-center gap-2 min-w-0">
                <LayoutTemplate className="w-4 h-4 text-slate-400 flex-shrink-0" />
                <span className="text-sm font-semibold text-slate-700 truncate">{t.name}</span>
              </span>
              <span
                className="text-xs font-bold flex-shrink-0"
                style={{ color: 'var(--brand-primary, #4f46e5)' }}
              >
                Edit →
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-2 pt-2">
        {wentToTemplate && result.template && (
          <button
            onClick={() => {
              // Hard-nav (full load) — soft-nav into the builder doesn't render reliably.
              window.location.href = `/${schoolId}/templates/builder/${result.template!.id}`;
            }}
            className="flex-1 px-4 py-2.5 rounded-xl text-white font-bold text-sm shadow-sm flex items-center justify-center gap-2"
            style={{ background: 'var(--brand-primary, #4f46e5)' }}
          >
            <LayoutTemplate className="w-4 h-4" /> {multiTemplates ? 'Open first template' : 'Open in builder'}
          </button>
        )}
        {!wentToTemplate && result.playlist && (
          <button
            onClick={() => router.push(`/${schoolId}/playlists`)}
            className="flex-1 px-4 py-2.5 rounded-xl text-white font-bold text-sm shadow-sm flex items-center justify-center gap-2"
            style={{ background: 'var(--brand-primary, #4f46e5)' }}
          >
            <ListVideo className="w-4 h-4" /> Open playlist
          </button>
        )}
        <button
          onClick={() => router.push(`/${schoolId}/templates`)}
          className="flex-1 px-4 py-2.5 rounded-xl bg-white border-2 border-slate-200 text-slate-700 font-bold text-sm hover:bg-slate-50 transition-colors flex items-center justify-center gap-2"
        >
          Back to Templates
        </button>
        <button
          onClick={onReset}
          className="px-4 py-2.5 rounded-xl text-slate-600 font-bold text-sm hover:bg-slate-100 transition-colors"
        >
          Import another
        </button>
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────

function deriveSource(file: File): string {
  if (/\.pptx?$/i.test(file.name)) return 'pptx';
  if (/\.pdf$/i.test(file.name)) return 'pdf';
  if (/\.(png|jpg|jpeg|webp)$/i.test(file.name)) return 'image';
  return 'unknown';
}

const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const PPT_MIME = 'application/vnd.ms-powerpoint';

function isAcceptedMime(file: File): boolean {
  return (
    file.type === 'application/pdf' ||
    file.type === 'image/png' ||
    file.type === 'image/jpeg' ||
    file.type === 'image/webp' ||
    file.type === PPTX_MIME ||
    file.type === PPT_MIME ||
    // Some browsers leave file.type empty (or send octet-stream) for
    // valid extensions. Fall back to filename pattern matching so a
    // "MyDeck.pptx" with empty file.type still gets through.
    /\.(pdf|png|jpe?g|webp|pptx?)$/i.test(file.name)
  );
}
