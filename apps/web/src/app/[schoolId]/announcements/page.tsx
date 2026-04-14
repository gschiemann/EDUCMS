"use client";

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import DOMPurify from 'dompurify';
import { Megaphone, AlertCircle, CalendarClock, ShieldCheck } from 'lucide-react';
import { useState } from 'react';

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
  const [isPreview, setIsPreview] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  const onSubmit = (data: AnnouncementFormValues) => {
    setIsSubmitting(true);
    console.log("Sanitized submission data:", data);
    // Simulate API Mutation
    setTimeout(() => setIsSubmitting(false), 1500);
  };

  const activeBodyText = watch("bodyText");
  // Immediate preview sanitization to prevent XSS during local preview rendering
  const safePreviewHtml = DOMPurify.sanitize(activeBodyText || '');

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
          <Megaphone className="w-8 h-8 text-indigo-500" />
          School Announcements
        </h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          Create rich-text announcements. Content is automatically sanitized to protect screens from malicious scripts.
        </p>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="border-b border-slate-200 dark:border-slate-800 px-6 py-3 flex gap-4">
          <button 
            onClick={() => setIsPreview(false)}
            className={`text-sm font-semibold py-2 border-b-2 transition-all ${
              !isPreview ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            Editor
          </button>
          <button 
            onClick={() => setIsPreview(true)}
            className={`text-sm font-semibold py-2 border-b-2 transition-all ${
              isPreview ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            Device Preview
          </button>
        </div>

        <div className="p-6">
          {!isPreview ? (
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">Announcement Title</label>
                  <input 
                    {...register("title")}
                    className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500 transition-shadow"
                    placeholder="e.g. Winter Break Schedule"
                  />
                  {errors.title && <p className="text-red-500 text-xs mt-1">{errors.title.message}</p>}
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">Priority Level</label>
                  <select 
                    {...register("priority")}
                    className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500 transition-shadow"
                  >
                    <option value="low">Low (Sidebar Queue)</option>
                    <option value="normal">Normal (Standard Rotation)</option>
                    <option value="high">High (Interrupts current slide)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">Message Body (Rich HTML Allowed)</label>
                <textarea 
                  {...register("bodyText")}
                  rows={8}
                  className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500 transition-shadow font-mono resize-y"
                  placeholder="Paste HTML or text here. <script> tags will be stripped."
                />
                {errors.bodyText && <p className="text-red-500 text-xs mt-1">{errors.bodyText.message}</p>}
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">Expiration Date</label>
                <div className="relative max-w-xs">
                  <CalendarClock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input 
                    type="datetime-local"
                    {...register("expiresAt")}
                    className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500 transition-shadow"
                  />
                </div>
                {errors.expiresAt && <p className="text-red-500 text-xs mt-1">{errors.expiresAt.message}</p>}
              </div>

              <div className="flex justify-end pt-4 border-t border-slate-100 dark:border-slate-800">
                <button 
                  type="submit"
                  disabled={!isValid || isSubmitting}
                  className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold rounded-md shadow-sm transition-all flex justify-center items-center gap-2 min-w-[160px]"
                >
                  {isSubmitting ? 'Publishing...' : <><ShieldCheck className="w-4 h-4" /> Publish Announcement</>}
                </button>
              </div>
            </form>
          ) : (
            <div className="bg-slate-100 dark:bg-slate-800 rounded-xl p-8 min-h-[400px] flex items-center justify-center border-4 border-slate-900 dark:border-black aspect-video max-w-2xl mx-auto shadow-2xl relative overflow-hidden">
               {/* Simulating a TV screen */}
               <div className="absolute top-4 right-4 flex items-center gap-2">
                 <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                 <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Live</span>
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
