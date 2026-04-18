"use client";

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Loader2, AlertCircle } from 'lucide-react';
import { useTemplate } from '@/hooks/use-api';
import { isFeatureEnabled, FLAGS } from '@/lib/feature-flags';
import { BuilderShell } from '@/components/template-builder/BuilderShell';
import type { Template } from '@/components/template-builder/types';

export default function TemplateBuilderV2Page() {
  const params = useParams<{ schoolId: string; id: string }>();
  const router = useRouter();
  const templateId = params?.id ?? '';
  const schoolId = params?.schoolId ?? '';

  const flagOn = isFeatureEnabled(FLAGS.TEMPLATE_BUILDER_V2);
  const { data, isLoading, error } = useTemplate(templateId);

  useEffect(() => {
    if (!flagOn) {
      router.replace(`/${schoolId}/templates`);
    }
  }, [flagOn, router, schoolId]);

  if (!flagOn) {
    return (
      <div className="fixed inset-0 bg-white flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-slate-400" aria-hidden />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-white flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-slate-400" aria-hidden />
      </div>
    );
  }

  if (error || !data || (data as any).error) {
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
