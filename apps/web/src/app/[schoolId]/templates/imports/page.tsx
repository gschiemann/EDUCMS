'use client';

/**
 * Import a design — choose, review, add.
 *
 * WHAT CHANGED, AND WHY (2026-09-15). The screen this replaces showed the
 * SOURCE file as its "preview" and converted only after the operator pressed
 * Add, so nobody ever saw what the conversion produced. It then reported "2
 * editable templates (one per page)" for a three-page document, because the
 * artwork-only page had been dropped with nothing recording that it happened.
 *
 * So the middle step here is the whole point: the pages on screen ARE the
 * converted output, page by page, with what each one lost and what it will
 * become. The count on the button is computed from the selection and nothing
 * else, because a button that says "Add 6" and creates 5 is the defect this
 * page was rebuilt to remove.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Upload, FileText, X, ArrowLeft, Check, AlertTriangle, Loader2,
  LayoutTemplate, Image as ImageIcon, Info,
} from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import {
  MODE_COPY, defaultSelection, dispositionBadge, effectiveMode, isRetryablePrepareFailure,
  outputPreview, reviewSummary, skippedConvertible, unconvertiblePages,
  type CommitResponse, type ImportManifest, type ManifestPage,
  type PageMode, type PrepareResponse,
} from './import-types';

type Step = 'choose' | 'preparing' | 'review' | 'adding' | 'done';

/** Mirrors the server's cap. The server re-checks; this saves a 50MB round trip. */
const MAX_BYTES = 50 * 1024 * 1024;
const ACCEPT = '.pdf,.pptx,.png,.jpg,.jpeg,.webp,.json';

export default function DesignImportsPage() {
  const params = useParams();
  const router = useRouter();
  const schoolId = params?.schoolId as string;

  const [step, setStep] = useState<Step>('choose');
  const [file, setFile] = useState<File | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [manifest, setManifest] = useState<ImportManifest | null>(null);
  const [selection, setSelection] = useState<Map<number, PageMode>>(new Map());
  const [focusedPage, setFocusedPage] = useState<number | null>(null);
  const [result, setResult] = useState<CommitResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The file to send again when the converter was busy — kept so "Try again"
  // never makes the operator find and choose it a second time.
  const [retryFile, setRetryFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const reset = () => {
    setStep('choose'); setFile(null); setJobId(null); setManifest(null);
    setSelection(new Map()); setFocusedPage(null); setResult(null); setError(null);
    setRetryFile(null);
  };

  const choose = useCallback(async (incoming: File) => {
    setError(null);
    setRetryFile(null);
    if (incoming.size > MAX_BYTES) {
      setError(`That file is ${(incoming.size / 1024 / 1024).toFixed(1)} MB. The limit is 50 MB.`);
      return;
    }
    setFile(incoming);
    setStep('preparing');
    try {
      // A VenueOS template file is restored, not converted. There is nothing to
      // review — the file IS the template — so it goes straight to the existing
      // /templates/import route rather than through prepare.
      if (/\.json$/i.test(incoming.name)) {
        const restored = await restoreTemplateFile(incoming);
        setResult({ ok: true, templates: [restored], skippedPages: [] });
        setStep('done');
        return;
      }
      const fd = new FormData();
      fd.append('file', incoming);
      const res = await apiFetch<PrepareResponse>('/imports/prepare', {
        method: 'POST', body: fd, headers: {},
      });
      setJobId(res.jobId);
      setManifest(res.manifest);
      setSelection(defaultSelection(res.manifest));
      setFocusedPage(res.manifest.pages[0]?.sourcePage ?? null);
      setStep('review');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      // A busy or briefly unavailable converter is not the file's fault, so
      // the file is kept for one-click retry (re-audit R3). Any other refusal
      // needs a different or a fixed file, and offers no retry.
      setRetryFile(isRetryablePrepareFailure(e) ? incoming : null);
      setStep('choose');
      setFile(null);
    }
  }, []);

  const add = async () => {
    if (!jobId || selection.size === 0) return;
    setStep('adding');
    setError(null);
    try {
      const res = await apiFetch<CommitResponse>(`/imports/jobs/${jobId}/commit`, {
        method: 'POST',
        body: JSON.stringify({
          selections: [...selection.entries()]
            .map(([sourcePage, mode]) => ({ sourcePage, mode }))
            .sort((a, b) => a.sourcePage - b.sourcePage),
        }),
      });
      setResult(res);
      setStep('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep('review');
    }
  };

  const focused = useMemo(
    () => manifest?.pages.find((p) => p.sourcePage === focusedPage) ?? null,
    [manifest, focusedPage],
  );
  const skipped = manifest ? skippedConvertible(manifest, selection) : [];
  const unconvertible = manifest ? unconvertiblePages(manifest) : [];

  return (
    <div className="space-y-5 max-w-6xl">
      <button
        type="button"
        onClick={() => router.push(`/${schoolId}/templates`)}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-[var(--brand-primary,#4f46e5)]"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Templates
      </button>

      <header>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Import a design</h1>
        <p className="mt-1 text-sm text-slate-600 max-w-2xl">
          Bring in a PowerPoint, PDF or image. You&rsquo;ll see what each page turns into, and
          choose what to keep, before anything is added.
        </p>
      </header>

      <Stepper step={step} />

      {error && (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 flex flex-wrap items-center gap-3">
          <span className="flex-1 min-w-[200px]">{error}</span>
          {retryFile && step === 'choose' && (
            <button
              type="button"
              onClick={() => { void choose(retryFile); }}
              className="min-h-11 sm:min-h-9 px-3.5 rounded-lg border border-rose-300 bg-white text-[13px] font-semibold text-rose-800 hover:bg-rose-100"
            >
              Try again
            </button>
          )}
        </div>
      )}

      {step === 'choose' && (
        <ChooseStep
          dragOver={dragOver}
          setDragOver={setDragOver}
          inputRef={inputRef}
          onChoose={choose}
        />
      )}

      {step === 'preparing' && <PreparingStep name={file?.name ?? ''} />}

      {(step === 'review' || step === 'adding') && manifest && (
        <ReviewStep
          manifest={manifest}
          selection={selection}
          setSelection={setSelection}
          focused={focused}
          setFocusedPage={setFocusedPage}
          skipped={skipped}
          unconvertible={unconvertible}
          busy={step === 'adding'}
          onAdd={add}
          onBack={reset}
        />
      )}

      {step === 'done' && result && (
        <DoneStep
          result={result}
          schoolId={schoolId}
          onAgain={reset}
          router={router}
        />
      )}
    </div>
  );
}

/**
 * Read a file as text.
 *
 * `Blob.text()` where it exists, `FileReader` where it does not. This is not
 * belt-and-braces: Safari only shipped `Blob.text()` in 14, and this codebase
 * treats WebKit as a first-class target after shipping a two-month-old
 * Chrome-only bug in 2026-05. The fallback also keeps jsdom honest, which is
 * how the gap surfaced.
 */
function readFileText(file: File): Promise<string> {
  if (typeof file.text === 'function') {
    return file.text().catch(() => readWithFileReader(file));
  }
  return readWithFileReader(file);
}

function readWithFileReader(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('unreadable'));
    reader.readAsText(file);
  });
}

/**
 * Restore a VenueOS template export.
 *
 * The route, the hook and even a file picker for this already existed; what was
 * missing was any way to reach them — the gallery's handler had exactly one
 * reference in the whole repo, its own definition. It belongs here rather than
 * as a second button, because "I have a file, put it in my templates" is one
 * job however the file was made.
 */
async function restoreTemplateFile(file: File) {
  let envelope: unknown;
  try {
    envelope = JSON.parse(await readFileText(file));
  } catch {
    throw new Error('That file is not readable as a VenueOS template export.');
  }
  const created = await apiFetch<{ id: string; name: string }>('/templates/import', {
    method: 'POST',
    body: JSON.stringify(envelope),
  });
  return { id: created.id, name: created.name, sourcePage: 1, mode: 'editable' as PageMode };
}

// ── Step 1 ────────────────────────────────────────────────────────────

function ChooseStep({
  dragOver, setDragOver, inputRef, onChoose,
}: {
  dragOver: boolean;
  setDragOver: (v: boolean) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onChoose: (f: File) => void;
}) {
  return (
    // Drag-and-drop has no keyboard equivalent by nature, so this wrapper
    // carries drag handlers only. The keyboard and screen-reader path to the
    // same flow is the real Browse files button inside it — the same shape the
    // Media Library's drop target uses.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const files = Array.from(e.dataTransfer.files || []);
        // One file, and we say so rather than silently taking the first.
        if (files.length > 1) return onChoose(files[0]);
        if (files[0]) onChoose(files[0]);
      }}
      className={`rounded-2xl border-2 border-dashed p-10 text-center transition-colors ${
        dragOver ? 'border-[var(--brand-primary,#4f46e5)] bg-indigo-50/50' : 'border-slate-200 bg-white'
      }`}
    >
      <Upload className="w-8 h-8 mx-auto text-slate-300" aria-hidden />
      <p className="mt-3 text-sm font-bold text-slate-800">Drop a file here</p>
      <p className="mt-1 text-xs text-slate-500">
        PowerPoint (.pptx), PDF, PNG, JPG or WEBP · up to 50 MB · one file at a time
      </p>
      <p className="mt-1 text-[11.5px] text-slate-400">
        Or a VenueOS template file (.json) exported from another account.
      </p>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="mt-4 min-h-11 sm:min-h-9 px-4 rounded-lg text-white text-[13px] font-bold"
        style={{ backgroundColor: 'var(--brand-primary, #4f46e5)' }}
      >
        Browse files
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onChoose(f); e.currentTarget.value = ''; }}
      />
      <p className="mt-5 text-[11.5px] text-slate-400 max-w-md mx-auto leading-relaxed">
        Designing in Canva or Google Slides? Export to PDF and import that — your design stays
        intact, and you can add live content on top of it.
      </p>
    </div>
  );
}

// ── Step 2 ────────────────────────────────────────────────────────────

function PreparingStep({ name }: { name: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center" aria-live="polite">
      <Loader2 className="w-7 h-7 mx-auto animate-spin text-[var(--brand-primary,#4f46e5)]" aria-hidden />
      <p className="mt-3 text-sm font-bold text-slate-800">Converting &ldquo;{name}&rdquo;</p>
      <p className="mt-1 text-xs text-slate-500">
        Getting every page ready for you to review. Nothing is added yet.
      </p>
    </div>
  );
}

// ── Step 3 ────────────────────────────────────────────────────────────

function ReviewStep({
  manifest, selection, setSelection, focused, setFocusedPage,
  skipped, unconvertible, busy, onAdd, onBack,
}: {
  manifest: ImportManifest;
  selection: Map<number, PageMode>;
  setSelection: (m: Map<number, PageMode>) => void;
  focused: ManifestPage | null;
  setFocusedPage: (n: number) => void;
  skipped: number[];
  unconvertible: ManifestPage[];
  busy: boolean;
  onAdd: () => void;
  onBack: () => void;
}) {
  const toggle = (page: ManifestPage) => {
    const next = new Map(selection);
    if (next.has(page.sourcePage)) next.delete(page.sourcePage);
    else if (page.defaultMode) next.set(page.sourcePage, page.defaultMode);
    setSelection(next);
  };
  const setMode = (page: ManifestPage, mode: PageMode) => {
    const next = new Map(selection);
    next.set(page.sourcePage, mode);
    setSelection(next);
  };
  const count = selection.size;
  const focusedMode = focused ? effectiveMode(focused, selection) : null;
  const focusedPreview = focused ? outputPreview(focused, selection).previewUrl : undefined;

  return (
    <div className="space-y-4">
      {manifest.warnings.length > 0 && (
        <section aria-label="What changed in this import" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-[13px] font-bold text-amber-900 flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4" aria-hidden /> Worth knowing before you add these
          </p>
          <ul className="mt-1.5 space-y-1">
            {manifest.warnings.map((w, i) => (
              <li key={`${w.code}-${i}`} className="text-[12.5px] text-amber-900/90">{w.detail}</li>
            ))}
          </ul>
        </section>
      )}

      {manifest.preserveUnavailableReason && (
        <section className="rounded-xl border border-slate-200 bg-white px-4 py-3 flex gap-2.5">
          <Info className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" aria-hidden />
          <p className="text-[12.5px] text-slate-600 leading-relaxed">{manifest.preserveUnavailableReason}</p>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-[260px_1fr_280px]">
        {/* Pages */}
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-[12px] font-bold uppercase tracking-wider text-slate-400">Pages</h2>
            <span className="text-[11.5px] font-semibold text-slate-400 tabular-nums">
              {manifest.sourcePageCount}
            </span>
          </div>
          <ul className="max-h-[420px] overflow-y-auto divide-y divide-slate-100">
            {manifest.pages.map((p) => {
              const on = selection.has(p.sourcePage);
              const badge = dispositionBadge(p);
              const thumbUrl = outputPreview(p, selection).thumbUrl;
              return (
                <li key={p.sourcePage}>
                  <div className="flex items-start gap-2.5 px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={p.defaultMode === null}
                      onChange={() => toggle(p)}
                      aria-label={`Include ${p.label}`}
                      className="mt-1 w-4 h-4 accent-[var(--brand-primary,#4f46e5)] disabled:opacity-40"
                    />
                    <button
                      type="button"
                      onClick={() => setFocusedPage(p.sourcePage)}
                      className={`flex-1 min-w-0 text-left rounded-lg px-1.5 py-1 ${
                        focused?.sourcePage === p.sourcePage ? 'bg-indigo-50' : 'hover:bg-slate-50'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        {thumbUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={thumbUrl} alt="" loading="lazy" className="w-12 h-8 object-cover border border-slate-200 shrink-0" />
                        ) : (
                          <span className="w-12 h-8 bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0">
                            <FileText className="w-3.5 h-3.5 text-slate-400" aria-hidden />
                          </span>
                        )}
                        <span className="min-w-0">
                          <span className="block text-[12.5px] font-bold text-slate-800 truncate">{p.label}</span>
                          {badge && <span className="block text-[11px] font-semibold text-amber-700">{badge}</span>}
                        </span>
                      </span>
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        {/* What the page will become — a picture only when the picture IS that output */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 flex items-center justify-center min-h-[280px]">
          {focused && focusedPreview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={focusedPreview}
              alt={`${focused.label}, converted`}
              className="max-w-full max-h-[420px] object-contain border border-slate-200"
            />
          ) : (
            <div className="text-center px-6">
              <ImageIcon className="w-7 h-7 text-slate-300 mx-auto" aria-hidden />
              <p className="mt-2 text-[13px] font-bold text-slate-700">No picture of this page</p>
              <p className="mt-1 text-[12px] text-slate-500 max-w-xs">
                {focusedMode === 'editable'
                  ? 'It will come in as editable text and pictures, which you can see once it is added.'
                  : focused?.disposition === 'excluded-by-limit'
                    ? 'It is past the page limit for one import, so it was not converted. Import it as a second file.'
                    : 'There was nothing on this page we could bring in.'}
              </p>
            </div>
          )}
        </div>

        {/* This page */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
          <h2 className="text-[12px] font-bold uppercase tracking-wider text-slate-400">
            {focused ? focused.label : 'Page'}
          </h2>
          {focused && (
            <>
              {focused.availableModes.length > 0 ? (
                <fieldset>
                  <legend className="sr-only">How to import {focused.label}</legend>
                  <div className="space-y-2">
                    {focused.availableModes.map((mode) => {
                      const on = selection.get(focused.sourcePage) === mode;
                      return (
                        <label
                          key={mode}
                          className={`block rounded-xl border px-3 py-2.5 cursor-pointer ${
                            on ? 'border-[var(--brand-primary,#4f46e5)] bg-indigo-50/50' : 'border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          <span className="flex items-center gap-2">
                            <input
                              type="radio"
                              name={`mode-${focused.sourcePage}`}
                              checked={on}
                              onChange={() => setMode(focused, mode)}
                              className="w-3.5 h-3.5 accent-[var(--brand-primary,#4f46e5)]"
                            />
                            <span className="text-[13px] font-bold text-slate-800">{MODE_COPY[mode].label}</span>
                          </span>
                          <span className="block mt-1 text-[11.5px] text-slate-500 leading-relaxed pl-5.5">
                            {MODE_COPY[mode].blurb}
                            {mode === 'editable' && (
                              <> {focused.editableTextCount} text {focused.editableTextCount === 1 ? 'box' : 'boxes'}
                                {focused.editableImageCount > 0 && `, ${focused.editableImageCount} picture${focused.editableImageCount === 1 ? '' : 's'}`}.</>
                            )}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              ) : (
                <p className="text-[12.5px] text-slate-500">
                  {focused.disposition === 'excluded-by-limit'
                    ? 'This page is past the page limit for one import, so it was not converted.'
                    : 'Nothing on this page could be imported.'}{' '}
                  It is listed so you know it was not missed.
                </p>
              )}

              {focused.warnings.length > 0 && (
                <ul className="space-y-1.5 pt-1">
                  {focused.warnings.map((w, i) => (
                    <li key={`${w.code}-${i}`} className="text-[11.5px] text-amber-800 flex gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden />
                      <span>{w.detail}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>

      {/* Footer — the count here is the count that gets created. */}
      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 flex flex-wrap items-center gap-3 sticky bottom-3">
        <p className="text-[13px] font-semibold text-slate-700 flex-1 min-w-[200px]">
          {reviewSummary(manifest, selection)}
          {skipped.length > 0 && (
            <span className="block text-[12px] font-medium text-slate-500">
              {skipped.length} you unselected {skipped.length === 1 ? 'is' : 'are'} not being added.
            </span>
          )}
          {unconvertible.length > 0 && (
            <span className="block text-[12px] font-medium text-slate-500">
              {unconvertible.length} could not be converted at all.
            </span>
          )}
        </p>
        <button
          type="button"
          onClick={onBack}
          disabled={busy}
          className="min-h-11 sm:min-h-9 px-3.5 rounded-lg border border-slate-200 text-[13px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          Start over
        </button>
        <button
          type="button"
          onClick={onAdd}
          disabled={busy || count === 0}
          className="min-h-11 sm:min-h-9 px-4 rounded-lg text-white text-[13px] font-bold inline-flex items-center gap-1.5 disabled:opacity-50"
          style={{ backgroundColor: 'var(--brand-primary, #4f46e5)' }}
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Check className="w-4 h-4" aria-hidden />}
          {count === 0 ? 'Choose a page' : `Add ${count} template${count === 1 ? '' : 's'}`}
        </button>
      </div>
    </div>
  );
}

// ── Step 4 ────────────────────────────────────────────────────────────

function DoneStep({
  result, schoolId, onAgain, router,
}: {
  result: CommitResponse;
  schoolId: string;
  onAgain: () => void;
  router: ReturnType<typeof useRouter>;
}) {
  const first = result.templates[0];
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4" aria-live="polite">
      <div className="flex items-start gap-3">
        <span className="w-9 h-9 rounded-full bg-emerald-50 flex items-center justify-center shrink-0">
          <Check className="w-4.5 h-4.5 text-emerald-600" aria-hidden />
        </span>
        <div>
          <h2 className="text-base font-bold text-slate-900">
            Added {result.templates.length} template{result.templates.length === 1 ? '' : 's'}
          </h2>
          {result.skippedPages.length > 0 && (
            <p className="mt-0.5 text-[12.5px] text-slate-500">
              {result.skippedPages.length} page{result.skippedPages.length === 1 ? '' : 's'} you
              unselected {result.skippedPages.length === 1 ? 'was' : 'were'} not added.
            </p>
          )}
        </div>
      </div>

      <ul className="divide-y divide-slate-100 border-y border-slate-100">
        {result.templates.map((t) => (
          <li key={t.id} className="py-2 flex items-center gap-2.5">
            <LayoutTemplate className="w-4 h-4 text-slate-400 shrink-0" aria-hidden />
            <span className="text-[13px] font-semibold text-slate-800 flex-1 min-w-0 truncate">{t.name}</span>
            <span className="text-[11.5px] font-semibold text-slate-400 shrink-0">
              {MODE_COPY[t.mode].label}
            </span>
            <button
              type="button"
              onClick={() => router.push(`/${schoolId}/templates/builder/${t.id}`)}
              className="text-[12.5px] font-bold text-[var(--brand-primary,#4f46e5)] hover:underline shrink-0"
            >
              Open
            </button>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap gap-2">
        {first && (
          <button
            type="button"
            onClick={() => router.push(`/${schoolId}/templates/builder/${first.id}`)}
            className="min-h-11 sm:min-h-9 px-4 rounded-lg text-white text-[13px] font-bold"
            style={{ backgroundColor: 'var(--brand-primary, #4f46e5)' }}
          >
            Open the first one
          </button>
        )}
        <button
          type="button"
          onClick={() => router.push(`/${schoolId}/templates`)}
          className="min-h-11 sm:min-h-9 px-3.5 rounded-lg border border-slate-200 text-[13px] font-semibold text-slate-600 hover:bg-slate-50"
        >
          Back to Templates
        </button>
        <button
          type="button"
          onClick={onAgain}
          className="min-h-11 sm:min-h-9 px-3.5 rounded-lg text-[13px] font-semibold text-slate-500 hover:text-slate-700"
        >
          Import another
        </button>
      </div>
    </div>
  );
}

// ── Chrome ────────────────────────────────────────────────────────────

function Stepper({ step }: { step: Step }) {
  const items: Array<{ key: Step[]; label: string }> = [
    { key: ['choose'], label: 'Choose a file' },
    { key: ['preparing', 'review', 'adding'], label: 'Review' },
    { key: ['done'], label: 'Add' },
  ];
  const activeIndex = items.findIndex((i) => i.key.includes(step));
  return (
    <ol className="flex items-center gap-2 text-[12px]">
      {items.map((item, i) => {
        const active = i === activeIndex;
        const done = i < activeIndex;
        return (
          <li key={item.label} className="flex items-center gap-2">
            <span
              aria-current={active ? 'step' : undefined}
              className={`inline-flex items-center gap-1.5 font-semibold ${
                active ? 'text-[var(--brand-primary,#4f46e5)]' : done ? 'text-slate-500' : 'text-slate-400'
              }`}
            >
              <span
                className={`w-5 h-5 rounded-full grid place-items-center text-[10.5px] font-bold ${
                  active ? 'bg-[var(--brand-primary,#4f46e5)] text-white' : done ? 'bg-slate-200 text-slate-600' : 'bg-slate-100 text-slate-400'
                }`}
              >
                {done ? <Check className="w-3 h-3" aria-hidden /> : i + 1}
              </span>
              {item.label}
            </span>
            {i < items.length - 1 && <span className="w-6 h-px bg-slate-200" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}
