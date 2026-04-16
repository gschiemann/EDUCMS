"use client";

import { MonitorCheck, CloudOff, ListVideo, Upload, Plus, ArrowRight, Loader2, Image as ImageIcon, MonitorPlay } from 'lucide-react';
import { useDashboardStats, useRecentActivity } from '@/hooks/use-dashboard-data';
import { useScreens, useScreenGroups, usePlaylists, useAssets } from '@/hooks/use-api';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function DashboardPage() {
  const { data: stats, isLoading: statsLoading } = useDashboardStats();
  const { data: activity } = useRecentActivity();
  const { data: screens } = useScreens();
  const { data: screenGroups } = useScreenGroups();
  const { data: playlists } = usePlaylists();
  const { data: assets } = useAssets();
  const pathname = usePathname();
  const tenantBase = pathname?.split('/').slice(0, 2).join('/') || '';

  const allScreens = screens || [];
  const onlineCount = allScreens.filter((s: any) => s.status === 'ONLINE').length;
  const offlineCount = allScreens.filter((s: any) => s.status !== 'ONLINE').length;
  const totalCount = allScreens.length;
  const assetCount = assets?.length || 0;
  const playlistCount = playlists?.length || 0;

  const isEmpty = assetCount === 0 && totalCount === 0;

  return (
    <div className="space-y-8 pb-12">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 bg-clip-text text-transparent bg-gradient-to-r from-slate-900 via-slate-700 to-slate-800">
          Network Dashboard
        </h1>
        <p className="text-sm font-medium text-slate-500 mt-1">Real-time overview of your signage network.</p>
      </div>

      {/* Getting Started — only shows when empty */}
      {isEmpty && (
        <div className="bg-gradient-to-br from-indigo-50 via-white to-violet-50 rounded-2xl border border-indigo-100 p-8 shadow-sm">
          <h2 className="text-lg font-bold text-slate-800 mb-2">Welcome to EduSignage</h2>
          <p className="text-sm text-slate-600 mb-6">Get your digital signage up and running in 3 steps:</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Link href={`${tenantBase}/assets`} className="group p-5 bg-white/70 backdrop-blur-md rounded-xl border border-slate-200 hover:border-indigo-300 hover:shadow-lg hover:-translate-y-1 transition-all duration-300">
              <div className="w-10 h-10 bg-sky-50 rounded-xl flex items-center justify-center mb-3 group-hover:scale-110 group-hover:bg-sky-100 transition-all">
                <Upload className="w-5 h-5 text-sky-600" />
              </div>
              <h3 className="text-sm font-bold text-slate-800">1. Upload Content</h3>
              <p className="text-xs text-slate-500 mt-1">Add images, videos, PDFs, or web URLs to your media library.</p>
              <span className="text-xs font-semibold text-indigo-600 mt-3 flex items-center gap-1 group-hover:text-indigo-700">Go to Assets <ArrowRight className="w-3 h-3 group-hover:translate-x-1 transition-transform" /></span>
            </Link>

            <Link href={`${tenantBase}/playlists`} className="group p-5 bg-white/70 backdrop-blur-md rounded-xl border border-slate-200 hover:border-violet-300 hover:shadow-lg hover:-translate-y-1 transition-all duration-300">
              <div className="w-10 h-10 bg-violet-50 rounded-xl flex items-center justify-center mb-3 group-hover:scale-110 group-hover:bg-violet-100 transition-all">
                <ListVideo className="w-5 h-5 text-violet-600" />
              </div>
              <h3 className="text-sm font-bold text-slate-800">2. Build a Playlist</h3>
              <p className="text-xs text-slate-500 mt-1">Create a playlist and add your uploaded media with durations.</p>
              <span className="text-xs font-semibold text-violet-600 mt-3 flex items-center gap-1 group-hover:text-violet-700">Go to Playlists <ArrowRight className="w-3 h-3 group-hover:translate-x-1 transition-transform" /></span>
            </Link>

            <Link href={`${tenantBase}/screens`} className="group p-5 bg-white/70 backdrop-blur-md rounded-xl border border-slate-200 hover:border-emerald-300 hover:shadow-lg hover:-translate-y-1 transition-all duration-300">
              <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center mb-3 group-hover:scale-110 group-hover:bg-emerald-100 transition-all">
                <MonitorPlay className="w-5 h-5 text-emerald-600" />
              </div>
              <h3 className="text-sm font-bold text-slate-800">3. Connect a Screen</h3>
              <p className="text-xs text-slate-500 mt-1">Pair devices or open the web player anywhere.</p>
              <span className="text-xs font-semibold text-emerald-600 mt-3 flex items-center gap-1 group-hover:text-emerald-700">Go to Screens <ArrowRight className="w-3 h-3 group-hover:translate-x-1 transition-transform" /></span>
            </Link>
          </div>
        </div>
      )}

      {/* Premium Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-5 lg:gap-6">
        {/* Metric Card 1: Screens */}
        <Link href={`${tenantBase}/screens`} className="relative group p-[1px] rounded-[1.5rem] bg-gradient-to-b from-slate-200 to-slate-100 hover:from-emerald-400/50 hover:to-emerald-100/10 transition-all duration-500 block overflow-hidden shadow-sm hover:shadow-[0_15px_40px_-10px_rgba(16,185,129,0.3)] hover:-translate-y-1 z-10">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-50/20 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 z-0"/>
          <div className="h-full bg-white/95 backdrop-blur-3xl rounded-[1.4rem] p-6 relative z-10 flex flex-col justify-between overflow-hidden">
            <div className="absolute -right-8 -top-8 w-32 h-32 bg-emerald-400/20 rounded-full blur-[30px] group-hover:scale-150 group-hover:bg-emerald-400/30 transition-all duration-500" />
            
            <div className="flex justify-between items-start mb-4 relative z-20">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-[0_5px_15px_rgba(16,185,129,0.3)] group-hover:scale-[1.05] group-hover:-rotate-3 transition-transform duration-300">
                <MonitorCheck className="w-5 h-5 text-white stroke-[2.5px]" />
              </div>
              <div className="w-8 h-8 rounded-full border border-slate-100 flex items-center justify-center bg-white/50 text-slate-400 group-hover:bg-emerald-50 group-hover:text-emerald-500 group-hover:border-emerald-100 transition-colors">
                <ArrowRight className="w-4 h-4 -rotate-45 group-hover:rotate-0 transition-transform duration-300" />
              </div>
            </div>
            
            <div className="relative z-20">
              <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-1">Screens</p>
              <div className="flex items-baseline gap-2">
                <h2 className="text-4xl font-black tracking-tight text-emerald-600 group-hover:text-emerald-500 transition-colors">
                  {onlineCount}
                </h2>
                <span className="text-lg font-bold text-slate-300">/ {totalCount}</span>
              </div>
              <p className="text-xs font-medium text-slate-400 mt-1 flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${onlineCount === totalCount && totalCount > 0 ? 'bg-emerald-500' : 'bg-rose-500'} animate-pulse`} />
                {totalCount === 0 ? 'No hardware connected' : onlineCount === totalCount ? '100% online fleet' : `${offlineCount} device${offlineCount > 1 ? 's' : ''} disconnected`}
              </p>
            </div>
          </div>
        </Link>

        {/* Metric Card 2: Assets */}
        <Link href={`${tenantBase}/assets`} className="relative group p-[1px] rounded-[1.5rem] bg-gradient-to-b from-slate-200 to-slate-100 hover:from-sky-400/50 hover:to-sky-100/10 transition-all duration-500 block overflow-hidden shadow-sm hover:shadow-[0_15px_40px_-10px_rgba(14,165,233,0.3)] hover:-translate-y-1 z-10">
          <div className="absolute inset-0 bg-gradient-to-br from-sky-50/20 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 z-0"/>
          <div className="h-full bg-white/95 backdrop-blur-3xl rounded-[1.4rem] p-6 relative z-10 flex flex-col justify-between overflow-hidden">
            <div className="absolute -right-8 -top-8 w-32 h-32 bg-sky-400/20 rounded-full blur-[30px] group-hover:scale-150 group-hover:bg-sky-400/30 transition-all duration-500" />
            
            <div className="flex justify-between items-start mb-4 relative z-20">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-sky-400 to-sky-600 flex items-center justify-center shadow-[0_5px_15px_rgba(14,165,233,0.3)] group-hover:scale-[1.05] group-hover:-rotate-3 transition-transform duration-300">
                <ImageIcon className="w-5 h-5 text-white stroke-[2.5px]" />
              </div>
              <div className="w-8 h-8 rounded-full border border-slate-100 flex items-center justify-center bg-white/50 text-slate-400 group-hover:bg-sky-50 group-hover:text-sky-500 group-hover:border-sky-100 transition-colors">
                <ArrowRight className="w-4 h-4 -rotate-45 group-hover:rotate-0 transition-transform duration-300" />
              </div>
            </div>
            
            <div className="relative z-20">
              <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-1">Library</p>
              <h2 className="text-4xl font-black tracking-tight text-sky-600 group-hover:text-sky-500 transition-colors">
                {assetCount}
              </h2>
              <p className="text-xs font-medium text-slate-400 mt-1">
                {assetCount === 0 ? 'Library is empty' : 'Total media assets'}
              </p>
            </div>
          </div>
        </Link>

        {/* Metric Card 3: Playlists */}
        <Link href={`${tenantBase}/playlists`} className="relative group p-[1px] rounded-[1.5rem] bg-gradient-to-b from-slate-200 to-slate-100 hover:from-indigo-400/50 hover:to-indigo-100/10 transition-all duration-500 block overflow-hidden shadow-sm hover:shadow-[0_15px_40px_-10px_rgba(99,102,241,0.3)] hover:-translate-y-1 z-10">
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-50/20 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 z-0"/>
          <div className="h-full bg-white/95 backdrop-blur-3xl rounded-[1.4rem] p-6 relative z-10 flex flex-col justify-between overflow-hidden">
            <div className="absolute -right-8 -top-8 w-32 h-32 bg-indigo-400/20 rounded-full blur-[30px] group-hover:scale-150 group-hover:bg-indigo-400/30 transition-all duration-500" />
            
            <div className="flex justify-between items-start mb-4 relative z-20">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-400 to-indigo-600 flex items-center justify-center shadow-[0_5px_15px_rgba(99,102,241,0.3)] group-hover:scale-[1.05] group-hover:-rotate-3 transition-transform duration-300">
                <ListVideo className="w-5 h-5 text-white stroke-[2.5px]" />
              </div>
              <div className="w-8 h-8 rounded-full border border-slate-100 flex items-center justify-center bg-white/50 text-slate-400 group-hover:bg-indigo-50 group-hover:text-indigo-500 group-hover:border-indigo-100 transition-colors">
                <ArrowRight className="w-4 h-4 -rotate-45 group-hover:rotate-0 transition-transform duration-300" />
              </div>
            </div>
            
            <div className="relative z-20">
              <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-1">Playlists</p>
              <h2 className="text-4xl font-black tracking-tight text-indigo-600 group-hover:text-indigo-500 transition-colors">
                {playlistCount}
              </h2>
              <p className="text-xs font-medium text-slate-400 mt-1">
                {playlistCount === 0 ? 'No active schedules' : 'Curated content channels'}
              </p>
            </div>
          </div>
        </Link>

        {/* Metric Card 4: Groups */}
        <Link href={`${tenantBase}/screens`} className="relative group p-[1px] rounded-[1.5rem] bg-gradient-to-b from-slate-200 to-slate-100 hover:from-violet-400/50 hover:to-violet-100/10 transition-all duration-500 block overflow-hidden shadow-sm hover:shadow-[0_15px_40px_-10px_rgba(139,92,246,0.3)] hover:-translate-y-1 z-10">
          <div className="absolute inset-0 bg-gradient-to-br from-violet-50/20 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 z-0"/>
          <div className="h-full bg-white/95 backdrop-blur-3xl rounded-[1.4rem] p-6 relative z-10 flex flex-col justify-between overflow-hidden">
            <div className="absolute -right-8 -top-8 w-32 h-32 bg-violet-400/20 rounded-full blur-[30px] group-hover:scale-150 group-hover:bg-violet-400/30 transition-all duration-500" />
            
            <div className="flex justify-between items-start mb-4 relative z-20">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-400 to-violet-600 flex items-center justify-center shadow-[0_5px_15px_rgba(139,92,246,0.3)] group-hover:scale-[1.05] group-hover:-rotate-3 transition-transform duration-300">
                <MonitorPlay className="w-5 h-5 text-white stroke-[2.5px]" />
              </div>
              <div className="w-8 h-8 rounded-full border border-slate-100 flex items-center justify-center bg-white/50 text-slate-400 group-hover:bg-violet-50 group-hover:text-violet-500 group-hover:border-violet-100 transition-colors">
                <ArrowRight className="w-4 h-4 -rotate-45 group-hover:rotate-0 transition-transform duration-300" />
              </div>
            </div>
            
            <div className="relative z-20">
              <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-1">Locations</p>
              <h2 className="text-4xl font-black tracking-tight text-violet-600 group-hover:text-violet-500 transition-colors">
                {screenGroups?.length || 0}
              </h2>
              <p className="text-xs font-medium text-slate-400 mt-1">
                {!screenGroups?.length ? 'Unassigned screens' : 'Managed hardware clusters'}
              </p>
            </div>
          </div>
        </Link>
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Activity Log */}
        <div className="lg:col-span-2 bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="text-sm font-bold text-slate-700">Recent Activity</h2>
          </div>
          <div className="divide-y divide-slate-50/50 p-2">
            {activity && activity.length > 0 ? (
              activity.slice(0, 8).map((log: any) => (
                <div key={log.id} className="px-5 py-3.5 flex items-center gap-4 rounded-2xl hover:bg-slate-50 transition-colors cursor-default">
                  <div className="w-2.5 h-2.5 rounded-full bg-gradient-to-br from-indigo-400 to-violet-400 shadow-sm shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-slate-700">{log.action?.replace(/_/g, ' ')}</p>
                    <p className="text-[10px] text-slate-400">{log.targetType} • {new Date(log.createdAt).toLocaleString()}</p>
                  </div>
                </div>
              ))
            ) : (
              <div className="p-8 text-center">
                <p className="text-xs text-slate-400">Activity will appear here as you use the CMS.</p>
              </div>
            )}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="space-y-6">
          <div className="bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-6">
            <h2 className="text-sm font-bold text-slate-700 mb-4">Quick Actions</h2>
            <div className="space-y-2.5">
              <Link href={`${tenantBase}/assets`} className="flex items-center gap-3.5 px-4 py-3 rounded-2xl hover:bg-sky-50 transition-colors group">
                <div className="p-2 bg-sky-100/50 rounded-xl group-hover:bg-sky-200/50 transition-colors">
                  <Upload className="w-4 h-4 text-sky-600" />
                </div>
                <span className="text-sm font-bold text-slate-600 group-hover:text-sky-700 transition-colors">Upload Content</span>
              </Link>
              <Link href={`${tenantBase}/playlists`} className="flex items-center gap-3.5 px-4 py-3 rounded-2xl hover:bg-indigo-50 transition-colors group">
                <div className="p-2 bg-indigo-100/50 rounded-xl group-hover:bg-indigo-200/50 transition-colors">
                  <Plus className="w-4 h-4 text-indigo-600" />
                </div>
                <span className="text-sm font-bold text-slate-600 group-hover:text-indigo-700 transition-colors">New Playlist</span>
              </Link>
              <Link href={`${tenantBase}/screens`} className="flex items-center gap-3.5 px-4 py-3 rounded-2xl hover:bg-emerald-50 transition-colors group">
                <div className="p-2 bg-emerald-100/50 rounded-xl group-hover:bg-emerald-200/50 transition-colors">
                  <MonitorPlay className="w-4 h-4 text-emerald-600" />
                </div>
                <span className="text-sm font-bold text-slate-600 group-hover:text-emerald-700 transition-colors">Manage Screens</span>
              </Link>
            </div>
          </div>

          {/* Offline Devices */}
          {offlineCount > 0 && (
            <div className="bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-6 border border-red-50">
              <h2 className="text-sm font-bold text-slate-700 mb-4 flex items-center gap-2">
                <CloudOff className="w-4 h-4 text-red-500" /> Offline Devices
              </h2>
              <div className="space-y-3">
                {allScreens.filter((s: any) => s.status !== 'ONLINE').map((screen: any) => (
                  <div key={screen.id} className="flex items-center gap-3 text-xs bg-red-50/50 px-4 py-3 rounded-2xl">
                    <div className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)] animate-pulse" />
                    <span className="font-bold text-slate-700">{screen.name}</span>
                    <span className="text-slate-500 ml-auto">{screen.location || 'Unknown'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
