"use client";

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import DOMPurify from 'dompurify';
import { Megaphone, AlertCircle, CalendarClock, ShieldCheck, Construction } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { appAlert } from '@/components/ui/app-dialog';
import { useUIStore } from '@/store/ui-store';

const AnnouncementSchema = z.object({
  title: z.string().min(5, "Title must be at least 5 characters").max(100),
  bodyText: z.string()
    .min(1, "Content is required")
    .max(5000, "Content exceeds character limit")
    // Note: Zod transformations happen during parsing, ensuring clean validation output
    .transform((htmlString) => DOMPurify.sanitize(htmlString)), 
  priority: z.enum(["low", "normal", "high"]),
  expiresAt: z.string().refine((date) => new Date(date) > new Date(), {
    message: "Expiration must be in the future",
  }),
});

type AnnouncementFormValues = z.infer<typeof AnnouncementSchema>;

export default function AnnouncementsPage() {
  const t = useTranslations();
  const [isPreview, setIsPreview] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const userRole = useUIStore((s) => s.user?.role);
  const isViewer = userRole === 'RESTRICTED_VIEWER';

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isValid },
  } = useForm<AnnouncementFormValues>({
    resolver: zodResolver(AnnouncementSchema),
    mode: 'onChange',
    defaultValues: {
      priority: 'normal',
    }
  });

  const onSubmit = async (_data: AnnouncementFormValues) => {
    // 2026-05-08 — UX honesty pass. Previously this faked a 1.5s spinner
    // on submit and resolved with no API call, no toast, no error —
    // operators thought their announcement had been published. Until
    // the backend POST /announcements lands, surface that explicitly so
    // nobody publishes-into-the-void during a demo. Use appAlert (not
    // native alert()) for design-system consistency. The form data is
    // discarded intentionally — better than silently saving locally
    // and giving false confidence.
    setIsSubmitting(true);
    try {
      await appAlert({
        title: t('opsPages.comingSoonTitle'),
        message: t('opsPages.comingSoonMessage'),
        tone: 'info',
        confirmLabel: t('opsPages.gotIt'),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const activeBodyText = watch("bodyText");
  // Immediate preview sanitization to prevent XSS during local preview rendering
  const safePreviewHtml = DOMPurify.sanitize(activeBodyText || '');

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
          <Megaphone className="w-8 h-8 text-indigo-500" />
          {t('opsPages.schoolAnnouncements')}
        </h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          {t('opsPages.announcementsSubtitle')}
        </p>
      </div>

      {/*
        Honest "in development" banner. The form below validates and
        sanitizes content correctly, but the submit handler currently
        only surfaces an info dialog — no API exists yet for persisting
        ad-hoc announcements outside of a template playlist. Removing
        the banner and the dialog requires shipping POST /announcements
        on the API side first.
      */}
      <div className="rounded-2xl border border-amber-300/60 dark:border-amber-700/60 bg-amber-50/80 dark:bg-amber-900/20 p-4 flex items-start gap-3">
        <Construction className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
        <div className="text-sm">
          <div className="font-semibold text-amber-900 dark:text-amber-100">
            {t('opsPages.featureInDevelopment')}
          </div>
          <div className="mt-1 text-amber-800 dark:text-amber-200">
            {t('opsPages.bannerBodyBefore')}{' '}
            <span className="font-medium">{t('opsPages.announcementWidget')}</span>{t('opsPages.bannerBodyAfter')}
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="border-b border-slate-200 dark:border-slate-800 px-6 py-3 flex gap-4">
          <button 
            onClick={() => setIsPreview(false)}
            className={`text-sm font-semibold py-2 border-b-2 transition-all ${
              !isPreview ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t('opsPages.editorTab')}
          </button>
          <button 
            onClick={() => setIsPreview(true)}
            className={`text-sm font-semibold py-2 border-b-2 transition-all ${
              isPreview ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t('opsPages.devicePreviewTab')}
          </button>
        </div>

        <div className="p-6">
          {!isPreview ? (
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label htmlFor="ann-title" className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">{t('opsPages.announcementTitleLabel')}</label>
                  <input
                    id="ann-title"
                    {...register("title")}
                    disabled={isViewer}
                    title={isViewer ? t('opsPages.readOnlyViewerRole') : undefined}
                    className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500 transition-shadow disabled:opacity-50 disabled:cursor-not-allowed"
                    placeholder={t('opsPages.titlePlaceholder')}
                  />
                  {errors.title && <p className="text-red-500 text-xs mt-1">{errors.title.message}</p>}
                </div>

                <div>
                  <label htmlFor="ann-priority" className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">{t('opsPages.priorityLevelLabel')}</label>
                  <select
                    id="ann-priority"
                    {...register("priority")}
                    disabled={isViewer}
                    title={isViewer ? t('opsPages.readOnlyViewerRole') : undefined}
                    className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500 transition-shadow disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <option value="low">{t('opsPages.priorityLow')}</option>
                    <option value="normal">{t('opsPages.priorityNormal')}</option>
                    <option value="high">{t('opsPages.priorityHigh')}</option>
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="ann-body" className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">{t('opsPages.messageBodyLabel')}</label>
                <textarea
                  id="ann-body"
                  {...register("bodyText")}
                  rows={8}
                  disabled={isViewer}
                  title={isViewer ? t('opsPages.readOnlyViewerRole') : undefined}
                  className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500 transition-shadow font-mono resize-y disabled:opacity-50 disabled:cursor-not-allowed"
                  placeholder={t('opsPages.bodyPlaceholder')}
                />
                {errors.bodyText && <p className="text-red-500 text-xs mt-1">{errors.bodyText.message}</p>}
              </div>

              <div>
                <label htmlFor="ann-expires" className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">{t('opsPages.expirationDateLabel')}</label>
                <div className="relative max-w-xs">
                  <CalendarClock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    id="ann-expires"
                    type="datetime-local"
                    {...register("expiresAt")}
                    disabled={isViewer}
                    title={isViewer ? t('opsPages.readOnlyViewerRole') : undefined}
                    className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500 transition-shadow disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>
                {errors.expiresAt && <p className="text-red-500 text-xs mt-1">{errors.expiresAt.message}</p>}
              </div>

              <div className="flex justify-end pt-4 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="submit"
                  disabled={!isValid || isSubmitting || isViewer}
                  title={isViewer ? t('opsPages.readOnlyViewerRole') : undefined}
                  className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-md shadow-sm transition-all flex justify-center items-center gap-2 min-w-[160px]"
                >
                  {isSubmitting ? t('opsPages.publishing') : <><ShieldCheck className="w-4 h-4" /> {t('opsPages.publishAnnouncement')}</>}
                </button>
              </div>
            </form>
          ) : (
            <div className="bg-slate-100 dark:bg-slate-800 rounded-xl p-8 min-h-[400px] flex items-center justify-center border-4 border-slate-900 dark:border-black aspect-video max-w-2xl mx-auto shadow-2xl relative overflow-hidden">
               {/* Simulating a TV screen */}
               <div className="absolute top-4 right-4 flex items-center gap-2">
                 <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                 <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{t('opsPages.live')}</span>
               </div>
               
               <div className="text-center space-y-6 w-full max-w-lg">
                  {watch("title") ? (
                    <h2 className="text-4xl font-black tracking-tight text-slate-900 dark:text-white">
                      {watch("title")}
                    </h2>
                  ) : (
                    <div className="h-10 bg-slate-200 dark:bg-slate-700 rounded w-3/4 mx-auto animate-pulse" />
                  )}
                  
                  {safePreviewHtml ? (
                    <div 
                      className="text-xl text-slate-600 dark:text-slate-300 leading-relaxed border-t border-slate-200 dark:border-slate-700 pt-6 prose prose-slate dark:prose-invert max-w-none text-left"
                      dangerouslySetInnerHTML={{ __html: safePreviewHtml }}
                    />
                  ) : (
                    <div className="space-y-3">
                      <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-full animate-pulse" />
                      <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-5/6 animate-pulse" />
                      <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-4/6 mx-auto animate-pulse" />
                    </div>
                  )}
               </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
