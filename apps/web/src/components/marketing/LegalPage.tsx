import { AlertTriangle } from 'lucide-react';
import { ReactNode } from 'react';
import { PublicShell } from './PublicShell';

export function LegalPage({
  title,
  subtitle,
  updated,
  children,
}: {
  title: string;
  subtitle?: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <PublicShell>
      <article className="max-w-3xl mx-auto px-6 pt-12 pb-20">
        <h1 className="font-[family-name:var(--font-fredoka)] text-4xl md:text-5xl font-semibold tracking-tight text-slate-900">
          {title}
        </h1>
        {subtitle && <p className="mt-4 text-lg text-slate-600">{subtitle}</p>}

        <div className="mt-6 rounded-2xl bg-amber-50 border border-amber-200 p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-sm text-amber-900">
            <p className="font-semibold">Last updated: {updated}</p>
            <p className="mt-1">
              This document is boilerplate drafted for EduSignage and is <strong>not legal advice</strong>.
              Review it with your own district or company&apos;s legal counsel before relying on it.
            </p>
          </div>
        </div>

        <div className="mt-10 space-y-8 text-slate-700 leading-relaxed [&_h2]:font-[family-name:var(--font-fredoka)] [&_h2]:font-semibold [&_h2]:text-slate-900 [&_h2]:text-2xl [&_h2]:tracking-tight [&_h2]:mt-10 [&_h3]:font-semibold [&_h3]:text-slate-900 [&_h3]:text-lg [&_h3]:mt-6 [&_p]:mb-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-2 [&_a]:text-indigo-600 [&_a]:underline [&_a]:underline-offset-2">
          {children}
        </div>
      </article>
    </PublicShell>
  );
}
