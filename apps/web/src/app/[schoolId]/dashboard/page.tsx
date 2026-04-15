"use client";

import { MonitorCheck, CloudOff, ListVideo, Upload, Plus, ArrowRight, Loader2, Image as ImageIcon, MonitorPlay } from 'lucide-react';
import { useDashboardStats, useRecentActivity } from '@/hooks/use-dashboard-data';
import { useScreenGroups, usePlaylists, useAssets } from '@/hooks/use-api';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function DashboardPage() {
  const { data: stats, isLoading: statsLoading } = useDashboardStats();
  const { data: activity } = useRecentActivity();
  const { data: screenGroups } = useScreenGroups();
  const { data: playlists } = usePlaylists();
  const { data: assets } = useAssets();
  const pathname = usePathname();
  const tenantBase = pathname?.split('/').slice(0, 2).join('/') || '';

  const allScreens = screenGroups?.flatMap((g: any) => g.screens || []) || [];
  const onlineCount = allScreens.filter((s: any) => s.status === 'ONLINE').length;
  const offlineCount = allScreens.filter((s: any) => s.status !== 'ONLINE').length;
  const totalCount = allScreens.length;
  const assetCount = assets?.length || 0;
  const playlistCount = playlists?.length || 0;

  const isEmpty = assetCount === 0 && totalCount === 0;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-800">Dashboard</h1>
        <p className="text-sm text-slate-500 mt-0.5">Real-time overview of your signage network.</p>
      </div>

      {/* Getting Started — only shows when empty */}
      {isEmpty && (
        <div className="bg-gradient-to-br from-indigo-50 via-white to-violet-50 rounded-2xl border border-indigo-100 p-8 shadow-sm">
          <h2 className="text-lg font-bold text-slate-800 mb-2">Welcome to EduSignage</h2>
          <p className="text-sm text-slate-600 mb-6">Get your digital signage up and running in 3 steps:</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Link href={`${tenantBase}/assets`} className="group p-5 bg-white rounded-xl border border-slate-200 hover:border-indigo-300 hover:shadow-md transition-all">
              <div className="w-10 h-10 bg-sky-50 rounded-xl flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                <Upload className="w-5 h-5 text-sky-600" />
              </div>
              <h3 className="text-sm font-bold text-slate-800">1. Upload Content</h3>
              <p className="text-xs text-slate-500 mt-1">Add images, videos, PDFs, or web URLs to your media library.</p>
              <span className="text-xs font-semibold text-indigo-600 mt-3 inline-flex items-center gap-1">Go to Assets <ArrowRight className="w-3 h-3" /></span>
            </Link>

            <Link href={`${tenantBase}/playlists`} className="group p-5 bg-white rounded-xl border border-slate-200 hover:border-indigo-300 hover:shadow-md transition-all">
              <div className="w-10 h-10 bg-violet-50 rounded-xl flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                <ListVideo className="w-5 h-5 text-violet-600" />
              </div>
              <h3 className="text-sm font-bold text-slate-800">2. Build a Playlist</h3>
              <p className="text-xs text-slate-500 mt-1">Create a playlist and add your uploaded media with durations.</p>
              <span className="text-xs font-semibold text-indigo-600 mt-3 inline-flex items-center gap-1">Go to Playlists <ArrowRight className="w-3 h-3" /></span>
            </Link>

            <div className="group p-5 bg-white rounded-xl border border-slate-200">
              <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center mb-3">
                <MonitorPlay className="w-5 h-5 text-emerald-600" />
              </div>
              <h3 className="text-sm font-bold text-slate-800">3. Connect a Screen</h3>
              <p className="text-xs text-slate-500 mt-1">Open <code className="bg-slate-100 px-1 py-0.5 rounded text-[10px]">/player</code> on any device to start displaying content.</p>
              <span className="text-xs font-semibold text-slate-400 mt-3 inline-block">Player URL in Screens page</span>
            </div>
          </div>
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
        <div className="bg-white p-6 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] relative overflow-hidden group hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all duration-300">
          <div className="absolute -right-6 -top-6 w-24 h-24 bg-emerald-50 rounded-full blur-2xl group-hover:bg-emerald-100 transition-colors" />
          <div className="flex justify-between items-start">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Screens</p>
              <h2 className="text-2xl font-bold tracking-tight text-emerald-600">
                {onlineCount} <span className="text-sm text-slate-400 font-medium">/ {totalCount}</span>
              </h2>
              <p className="text-[10px] text-slate-400 mt-0.5">{totalCount === 0 ? 'No screens connected' : onlineCount === totalCount ? 'All online' : `${offlineCount} offline`}</p>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-500 flex items-center justify-center shadow-lg shadow-emerald-500/30 group-hover:scale-110 transition-transform duration-300 relative z-10">
              <MonitorCheck className="w-6 h-6 text-white" />
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] relative overflow-hidden group hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all duration-300">
          <div className="absolute -right-6 -top-6 w-24 h-24 bg-sky-50 rounded-full blur-2xl group-hover:bg-sky-100 transition-colors" />
          <div className="flex justify-between items-start">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Assets</p>
              <h2 className="text-2xl font-bold tracking-tight text-sky-600">{assetCount}</h2>
              <p className="text-[10px] text-slate-400 mt-0.5">{assetCount === 0 ? 'Upload media to start' : 'In media library'}</p>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-sky-400 to-sky-500 flex items-center justify-center shadow-lg shadow-sky-500/30 group-hover:scale-110 transition-transform duration-300 relative z-10">
              <ImageIcon className="w-6 h-6 text-white" />
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] relative overflow-hidden group hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all duration-300">
          <div className="absolute -right-6 -top-6 w-24 h-24 bg-indigo-50 rounded-full blur-2xl group-hover:bg-indigo-100 transition-colors" />
          <div className="flex justify-between items-start">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Playlists</p>
              <h2 className="text-2xl font-bold tracking-tight text-indigo-600">{playlistCount}</h2>
              <p className="text-[10px] text-slate-400 mt-0.5">{playlistCount === 0 ? 'Create your first playlist' : 'Active playlists'}</p>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-400 to-indigo-500 flex items-center justify-center shadow-lg shadow-indigo-500/30 group-hover:scale-110 transition-transform duration-300 relative z-10">
              <ListVideo className="w-6 h-6 text-white" />
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] relative overflow-hidden group hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all duration-300">
          <div className="absolute -right-6 -top-6 w-24 h-24 bg-violet-50 rounded-full blur-2xl group-hover:bg-violet-100 transition-colors" />
          <div className="flex justify-between items-start">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Groups</p>
              <h2 className="text-2xl font-bold tracking-tight text-violet-600">{screenGroups?.length || 0}</h2>
              <p className="text-[10px] text-slate-400 mt-0.5">{!screenGroups?.length ? 'Organize screens by location' : 'Screen groups'}</p>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-400 to-violet-500 flex items-center justify-center shadow-lg shadow-violet-500/30 group-hover:scale-110 transition-transform duration-300 relative z-10">
              <MonitorPlay className="w-6 h-6 text-white" />
            </div>
          </div>
        </div>
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
