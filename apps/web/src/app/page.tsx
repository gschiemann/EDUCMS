"use client"

import * as React from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { MonitorCheck, AlertCircle, WifiOff, Clock } from "lucide-react"
import { useDashboardStats, useRecentActivity } from "@/hooks/use-dashboard-data"

export default function DashboardPage() {
  const { data: stats, isLoading: statsLoading } = useDashboardStats();
  const { data: logs, isLoading: logsLoading } = useRecentActivity();

  return (
    <div className="flex-1 overflow-y-auto space-y-6">
      <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center gap-2 border-b border-neutral-800 bg-neutral-950/80 px-4 backdrop-blur-md">
        <SidebarTrigger className="text-white hover:text-white/80" />
        <Separator orientation="vertical" className="mr-2 h-4 bg-neutral-700" />
        <h1 className="text-sm font-medium text-neutral-200">District Dashboard</h1>
        <div className="ml-auto flex items-center space-x-4">
          <Badge variant="outline" className="text-emerald-400 border-emerald-900 bg-emerald-950/30">System Normal</Badge>
        </div>
      </header>

      <div className="p-6 pt-0 space-y-6 max-w-7xl mx-auto">
        <div className="flex justify-between items-end">
          <div>
            <h2 className="text-3xl font-bold tracking-tight text-white mb-2">Overview</h2>
            <p className="text-neutral-400">Manage your connected screens and active playlists.</p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card className="bg-neutral-900 border-neutral-800 text-neutral-100 shadow-xl shadow-black/20">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-neutral-400">Total Screens</CardTitle>
              <MonitorCheck className="w-4 h-4 text-emerald-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{statsLoading ? '-' : stats?.totalScreens}</div>
              <p className="text-xs text-emerald-400 mt-1 flex items-center">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-2 animate-pulse"></span>
                {statsLoading ? '-' : stats?.onlineScreens} Online
              </p>
            </CardContent>
          </Card>

          <Card className="bg-neutral-900 border-neutral-800 text-neutral-100 shadow-xl shadow-black/20">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-neutral-400">Offline Screens</CardTitle>
              <WifiOff className="w-4 h-4 text-orange-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-400">{statsLoading ? '-' : stats?.offlineScreens}</div>
              <p className="text-xs text-neutral-500 mt-1">Requires attention</p>
            </CardContent>
          </Card>

          <Card className="bg-neutral-900 border-neutral-800 text-neutral-100 shadow-xl shadow-black/20">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-neutral-400">Active Playlists</CardTitle>
              <MonitorCheck className="w-4 h-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{statsLoading ? '-' : stats?.activePlaylists}</div>
              <p className="text-xs text-neutral-500 mt-1">Active</p>
            </CardContent>
          </Card>

          <Card className="bg-neutral-900 border-neutral-900/50 bg-gradient-to-br from-neutral-900 to-red-950/20 text-neutral-100 shadow-xl shadow-black/20 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-red-500/10 rounded-full blur-3xl" />
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-red-200">Emergency Status</CardTitle>
              <AlertCircle className="w-4 h-4 text-red-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-emerald-400">{statsLoading ? '...' : stats?.emergencyStatus}</div>
              <p className="text-xs text-neutral-400 mt-1">{stats?.emergencyStatus === 'CLEAR' ? 'No active overrides' : 'System lockdown active'}</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
          <Card className="col-span-4 bg-neutral-900 border-neutral-800 text-white shadow-xl shadow-black/20">
            <CardHeader>
              <CardTitle>Recent Activity</CardTitle>
              <CardDescription className="text-neutral-400">Real-time audit log of system events.</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[300px] w-full pr-4">
                <div className="space-y-4">
                  {logsLoading ? (
                    <div className="text-sm text-neutral-500">Loading activity...</div>
                  ) : (logs || []).map((log: any, i: number) => (
                    <div key={i} className="flex items-start gap-4 p-3 rounded-lg hover:bg-neutral-800/50 transition-colors border border-transparent hover:border-neutral-800">
                      <div className="w-8 h-8 rounded-full bg-neutral-800 flex flex-shrink-0 items-center justify-center border border-neutral-700">
                        <MonitorCheck className="w-4 h-4 text-neutral-400" />
                      </div>
                      <div className="flex-1 space-y-1">
                        <p className="text-sm font-medium leading-none">{log.action}</p>
                        <p className="text-sm text-neutral-400">
                          {log.user} modified <span className="text-indigo-400">{log.target}</span>
                        </p>
                      </div>
                      <div className="text-xs text-neutral-500 flex items-center">
                        <Clock className="w-3 h-3 mr-1" />
                        {log.time}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          <Card className="col-span-3 bg-neutral-900 border-neutral-800 text-white shadow-xl shadow-black/20">
            <CardHeader>
              <CardTitle>Device Health</CardTitle>
              <CardDescription className="text-neutral-400">Screens requiring immediate attention.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {[
                  { name: "Gymnasium East", status: "Offline", ping: "2 hours ago" },
                  { name: "Hallway B", status: "Sync Failed", ping: "15 mins ago" },
                  { name: "Library Kiosk", status: "Low Storage", ping: "Just now" },
                ].map((device, i) => (
                   <div key={i} className="flex items-center justify-between p-3 rounded-lg border border-neutral-800 bg-neutral-950/50">
                     <div className="space-y-1">
                       <p className="text-sm font-medium">{device.name}</p>
                       <p className="text-xs text-neutral-500">Last Seen: {device.ping}</p>
                     </div>
                     <Badge variant="outline" className="border-orange-900 text-orange-400 bg-orange-950/30">
                       {device.status}
                     </Badge>
                   </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
