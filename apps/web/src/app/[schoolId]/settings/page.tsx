"use client";

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Settings as SettingsIcon, Save, Key, UserCircle, Users } from 'lucide-react';
import { RoleGate } from '@/components/RoleGate';

const SettingsSchema = z.object({
  schoolName: z.string().min(3),
  timezone: z.string(),
  defaultPlaylistId: z.string(),
  requireApproval: z.boolean(),
});

export default function SettingsPage() {
  const { register, handleSubmit, formState: { isDirty, isValid } } = useForm<z.infer<typeof SettingsSchema>>({
    resolver: zodResolver(SettingsSchema),
    defaultValues: {
      schoolName: 'Lincoln High School',
      timezone: 'America/New_York',
      defaultPlaylistId: 'p-1',
      requireApproval: true,
    }
  });

  const onSubmit = (data: any) => {
    console.log('Saved settings:', data);
  };

  return (
    <div className="max-w-4xl space-y-8">
      
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
          <SettingsIcon className="w-8 h-8 text-indigo-500" />
          Settings
        </h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          Manage your school profile, global defaults, and contributor preferences.
        </p>
      </div>

      <RoleGate 
        allowedRoles={['admin']}
        fallback={
          <div className="bg-slate-50 dark:bg-slate-900 p-8 rounded-2xl border border-slate-200 dark:border-slate-800 text-center">
            <Key className="w-12 h-12 text-slate-400 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Admin Access Required</h3>
            <p className="text-sm text-slate-500 max-w-md mx-auto mt-2">
              You do not have permission to view or modify global settings. Contact your principal or IT administrator.
            </p>
          </div>
        }
      >
        {/* Admin Settings Render */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
          <div className="flex border-b border-slate-200 dark:border-slate-800">
            <button className="px-6 py-4 text-sm font-semibold border-b-2 border-indigo-600 text-indigo-600 dark:text-indigo-400">
              General
            </button>
            <button className="px-6 py-4 text-sm font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">
              Users & Permissions
            </button>
            <button className="px-6 py-4 text-sm font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">
              Billing
            </button>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="p-8 space-y-8">
            
            <section>
              <h3 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-white mb-4">School Profile</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                 <div>
                    <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">School Name</label>
                    <input 
                      {...register("schoolName")}
                      className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                 </div>
                 <div>
                    <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">Timezone</label>
                    <select 
                      {...register("timezone")}
                      className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="America/New_York">Eastern Time (ET)</option>
                      <option value="America/Chicago">Central Time (CT)</option>
                      <option value="America/Los_Angeles">Pacific Time (PT)</option>
                    </select>
                 </div>
              </div>
            </section>

            <hr className="border-slate-200 dark:border-slate-800" />

            <section>
              <h3 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-white mb-4">Content Policies</h3>
              
              <label className="flex items-start gap-3 cursor-pointer group">
                <div className="flex items-center h-5">
                  <input 
                    type="checkbox" 
                    {...register("requireApproval")}
                    className="w-4 h-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-600 dark:focus:ring-indigo-500 dark:ring-offset-slate-900"
                  />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900 dark:text-white group-hover:text-indigo-600 transition-colors">Require Approval for Teacher Announcements</p>
                  <p className="text-sm text-slate-500 mt-1">
                    When enabled, announcements created by contributors will enter a pending queue for admin review before displaying on screens.
                  </p>
                </div>
              </label>
            </section>

            <div className="flex justify-end pt-6">
              <button 
                type="submit"
                disabled={!isDirty || !isValid}
                className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold rounded-md shadow-sm transition-all flex items-center gap-2"
              >
                <Save className="w-4 h-4" /> Save Changes
              </button>
            </div>

          </form>
        </div>
      </RoleGate>

    </div>
  );
}
