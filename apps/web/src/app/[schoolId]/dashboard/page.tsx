import { MonitorCheck, AlertTriangle, CloudOff } from 'lucide-react';

export default function DashboardPage() {
  return (
    <>
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-white">
          Dashboard Overview
        </h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          Real-time snapshot of your screen fleet and active playlists.
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Online Devices</p>
              <h2 className="text-3xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">42 <span className="text-lg text-slate-400 font-medium">/ 45</span></h2>
            </div>
            <div className="w-10 h-10 rounded-full bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center">
              <MonitorCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Offline</p>
              <h2 className="text-3xl font-bold tracking-tight text-red-600 dark:text-red-400">3</h2>
            </div>
            <div className="w-10 h-10 rounded-full bg-red-50 dark:bg-red-500/10 flex items-center justify-center">
              <CloudOff className="w-5 h-5 text-red-600 dark:text-red-400" />
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Sync Issues</p>
              <h2 className="text-3xl font-bold tracking-tight text-amber-600 dark:text-amber-400">1</h2>
            </div>
            <div className="w-10 h-10 rounded-full bg-amber-50 dark:bg-amber-500/10 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Areas */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
            <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center">
              <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-white">Active Playlists</h2>
              <button className="text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 transition-colors">
                View All
              </button>
            </div>
            <div className="p-12 text-center">
              {/* Empty State Polish Example */}
              <div className="mx-auto w-16 h-16 bg-slate-100 dark:bg-slate-800 rounded-2xl flex items-center justify-center mb-4 border border-slate-200 dark:border-slate-700">
                <MonitorCheck className="w-8 h-8 text-slate-400" />
              </div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-1">No playlists currently running</h3>
              <p className="text-sm text-slate-500 max-w-sm mx-auto mb-6">
                Schedules are currently empty for your screen groups. Create a playlist to start broadcasting.
              </p>
              <button className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-md shadow-sm transition-all text-center">
                Create Playlist
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-6">
            <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-white mb-4">Device Health</h2>
            
            <div className="space-y-4">
              {/* Fake list of offline devices */}
              <div className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-800">
                <div className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900 dark:text-white truncate">Main Hallway - North</p>
                  <p className="text-xs text-slate-500">Last seen 4 hrs ago</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-800">
                <div className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900 dark:text-white truncate">Cafeteria Screen 2</p>
                  <p className="text-xs text-slate-500">Last seen 1 day ago</p>
                </div>
              </div>
            </div>
            
            <button className="w-full mt-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 rounded-md hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
              View Analytics
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
