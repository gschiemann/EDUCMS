import { MonitorPlay, Settings2, MoreHorizontal, CloudOff, MonitorCheck, RefreshCw } from 'lucide-react';

export default function ScreensPage() {
  const groups = [
    {
      id: 'g1',
      name: 'Main Hallway (North & South)',
      screenCount: 12,
      online: 11,
      offline: 1,
      activePlaylist: 'Daily Rotation',
    },
    {
      id: 'g2',
      name: 'Cafeteria Modules',
      screenCount: 4,
      online: 4,
      offline: 0,
      activePlaylist: 'Lunch Menu & Events',
    },
    {
      id: 'g3',
      name: 'Library & Study Zones',
      screenCount: 6,
      online: 6,
      offline: 0,
      activePlaylist: 'Quiet Study Notices',
    },
    {
      id: 'g4',
      name: 'Gymnasium Exterior',
      screenCount: 2,
      online: 0,
      offline: 2,
      activePlaylist: 'Athletics Schedule',
    }
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
            <MonitorPlay className="w-8 h-8 text-indigo-500" />
            Screen Groups
          </h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            Manage your hardware fleet. Group screens by location to bulk-apply playlists.
          </p>
        </div>

        <button className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-md shadow-sm transition-all flex items-center gap-2">
          <Settings2 className="w-4 h-4" /> Create Group
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {groups.map((group) => {
          const isWarning = group.offline > 0;
          return (
            <div 
              key={group.id} 
              className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden hover:shadow-md transition-shadow group flex flex-col"
            >
              <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800 flex justify-between items-start">
                <div className="flex-1 min-w-0 pr-4">
                  <h3 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-white truncate">
                    {group.name}
                  </h3>
                  <div className="flex items-center gap-2 mt-1.5">
                    <div className="flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                      <MonitorPlay className="w-3 h-3" /> {group.screenCount} Screens
                    </div>
                  </div>
                </div>
                <button className="text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors">
                  <MoreHorizontal className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 flex-1 flex flex-col justify-between gap-6">
                
                {/* Health Indicators */}
                <div className="grid grid-cols-2 gap-4">
                  <div className={`flex items-center gap-3 p-3 rounded-xl border ${
                    isWarning 
                      ? 'border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-500/10' 
                      : 'border-slate-100 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/50'
                  }`}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                      group.online === group.screenCount 
                        ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400' 
                        : 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400'
                    }`}>
                      <MonitorCheck className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-xl font-bold tracking-tight text-slate-900 dark:text-white leading-none">{group.online}</p>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mt-1">Online</p>
                    </div>
                  </div>

                  <div className={`flex items-center gap-3 p-3 rounded-xl border ${
                    group.offline > 0 
                      ? 'border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-500/10' 
                      : 'border-slate-100 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/50'
                  }`}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                      group.offline > 0 
                        ? 'bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-400' 
                        : 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400'
                    }`}>
                      <CloudOff className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-xl font-bold tracking-tight text-slate-900 dark:text-white leading-none">{group.offline}</p>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mt-1">Offline</p>
                    </div>
                  </div>
                </div>

                {/* Playlist Info */}
                <div>
                   <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Active Playlist</p>
                   <div className="flex items-center justify-between p-3 border border-slate-200 dark:border-slate-700 rounded-lg">
                      <span className="text-sm font-medium text-slate-900 dark:text-white truncate pr-4">
                        {group.activePlaylist}
                      </span>
                      <button className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 text-xs font-semibold uppercase tracking-wider shrink-0 transition-colors">
                        Change
                      </button>
                   </div>
                </div>
              </div>

              <div className="px-6 py-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex justify-between items-center">
                <span className="text-xs text-slate-500 flex items-center gap-1">
                  <RefreshCw className="w-3 h-3" /> Synced 2m ago
                </span>
                <button className="text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors">
                  View Devices &rarr;
                </button>
              </div>

            </div>
          );
        })}
      </div>
    </div>
  );
}
