"use client";

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Loader2, AlertCircle } from 'lucide-react';
import { useTemplate } from '@/hooks/use-api';
import { isFeatureEnabled, FLAGS } from '@/lib/feature-flags';
import { BuilderShell } from '@/components/template-builder/BuilderShell';
import { useUIStore } from '@/store/ui-store';
import type { Template } from '@/components/template-builder/types';

export default function TemplateBuilderV2Page() {
  const params = useParams<{ schoolId: string; id: string }>();
  const router = useRouter();
  const templateId = params?.id ?? '';
  const schoolId = params?.schoolId ?? '';

  const flagOn = isFeatureEnabled(FLAGS.TEMPLATE_BUILDER_V2);
  // 2026-06-09 — a RESTRICTED_VIEWER is read-only. The gallery's Edit/
  // Duplicate buttons are already disabled for them, but the builder
  // route is directly URL-navigable, so a viewer could land here and get
  // the full editor (Save 403s server-side, but the surface is misleading
  // — operator: "a viewer can actually edit a template"). The server is
  // the real guard (every template mutation 403s for this role); this is
  // the matching client gate. Bounce viewers back to the read-only gallery.
  const isViewer = useUIStore((s) => s.user?.role) === 'RESTRICTED_VIEWER';
  const { data, isLoading, error } = useTemplate(templateId);

  // 2026-05-04 — operator: "when you hit discard on a template it
  // flashes to template not found screen for 1 second then back to
  // the main template dashboard, it shouldnt show that not found
  // screen". The flash happens because Discard navigates to the
  // dashboard but for a few frames the builder is still mounted —
  // useTemplate returns isLoading=false + data=null, fallthrough to
  // the not-found UI, then Next finishes the route change and
  // unmounts. Fix: gate the not-found UI behind a 600ms delay so
  // any in-flight navigation lands first; show the loading spinner
  // during the grace window. Only triggers ON ERROR — happy-path
  // never sees this delay.
  const [showNotFound, setShowNotFound] = useState(false);
  const isErrorState = !!error || (!isLoading && (!data || (data as any).error));
  useEffect(() => {
    if (!isErrorState) {
      setShowNotFound(false);
      return;
    }
    const t = setTimeout(() => setShowNotFound(true), 600);
    return () => clearTimeout(t);
  }, [isErrorState]);

  useEffect(() => {
    if (!flagOn || isViewer) {
      router.replace(`/${schoolId}/templates`);
    }
  }, [flagOn, isViewer, router, schoolId]);

  if (!flagOn || isViewer) {
    return (
      <div className="fixed inset-0 bg-white flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-slate-400" aria-hidden />
      </div>
    );
  }

  if (isLoading || (isErrorState && !showNotFound)) {
    return (
      <div className="fixed inset-0 bg-white flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-slate-400" aria-hidden />
      </div>
    );
  }

  if (isErrorState) {
    return (
      <div className="fixed inset-0 bg-white flex flex-col items-center justify-center gap-3 p-6 text-center">
        <AlertCircle className="w-8 h-8 text-rose-500" aria-hidden />
        <h1 className="text-lg font-bold text-slate-800">Template not found</h1>
        <p className="text-sm text-slate-500 max-w-md">
          {error instanceof Error ? error.message : 'This template may have been deleted or you may not have access.'}
        </p>
        <button
          type="button"
          onClick={() => router.push(`/${schoolId}/templates`)}
          className="mt-2 px-4 py-2 bg-indigo-600 text-white text-sm font-bold rounded-lg hover:bg-indigo-700"
        >
          Back to templates
        </button>
      </div>
    );
  }

  const template = data as Template;
  // System presets open in the builder as a "draft" — user can edit
  // zones in-memory and the only way to persist is Save-as-copy, which
  // creates a custom template in their tenant. BuilderShell handles
  // hiding the plain Save button when isSystem=true. Nothing is written
  // to the DB unless the user explicitly saves.

  return (
    <BuilderShell
      template={template}
      onBack={() => router.push(`/${schoolId}/templates`)}
      onSaved={() => { /* React Query invalidation happens in the hooks */ }}
    />
  );
}
