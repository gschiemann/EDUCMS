"use client"

import * as React from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"
import { Monitor, Wifi, WifiOff, RefreshCcw, MoreHorizontal, Settings2 } from "lucide-react"

const MOCK_SCREENS = [
  { id: 1, name: "Main Entrance Display", group: "Lobby", ip: "10.0.1.45", ping: "2s ago", version: "v2.1.4", status: "ONLINE", storage: "45%" },
  { id: 2, name: "Cafeteria Menu Right", group: "Cafeteria", ip: "10.0.1.88", ping: "5s ago", version: "v2.1.4", status: "ONLINE", storage: "62%" },
  { id: 3, name: "Library Announcement Board", group: "Library", ip: "10.0.2.14", ping: "3m ago", version: "v2.1.3", status: "SYNCING", storage: "88%" },
  { id: 4, name: "Gymnasium Scoreboard Promo", group: "Athletics", ip: "10.0.4.11", ping: "14h ago", version: "v2.0.1", status: "OFFLINE", storage: "N/A" },
];

export default function ScreensPage() {
  return (
    <div className="flex-1 overflow-y-auto bg-neutral-950 flex flex-col h-full">
      <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center gap-2 border-b border-neutral-800 bg-neutral-950/80 px-4 backdrop-blur-md">
        <SidebarTrigger className="text-white hover:text-white/80" />
        <Separator orientation="vertical" className="mr-2 h-4 bg-neutral-700" />
        <h1 className="text-sm font-medium text-neutral-200">Hardware Fleet</h1>
      </header>

      <div className="p-6 pt-4 space-y-6 max-w-7xl mx-auto w-full">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h2 className="text-3xl font-bold tracking-tight text-white mb-1">Display Network</h2>
            <p className="text-neutral-400 text-sm">Monitor Android kiosk health, group assignments, and trigger remote syncs.</p>
          </div>
          <button className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors shadow-lg shadow-indigo-900/20">
            <Settings2 className="w-4 h-4" />
            Manage Groups
          </button>
        </div>

        {/* METRICS ROW */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
           <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4 flex items-center justify-between">
              <div>
                 <p className="text-xs font-medium text-neutral-500 mb-1">Network Status</p>
                 <p className="text-2xl font-bold text-white flex items-baseline gap-2">98.4% <span className="text-xs text-emerald-500 font-normal">Uptime</span></p>
              </div>
              <div className="h-10 w-10 rounded-full bg-emerald-500/10 flex items-center justify-center"><Wifi className="w-5 h-5 text-emerald-500"/></div>
           </div>
           <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4 flex items-center justify-between">
              <div>
                 <p className="text-xs font-medium text-neutral-500 mb-1">Total Devices</p>
                 <p className="text-2xl font-bold text-white flex items-baseline gap-2">142 <span className="text-xs text-neutral-500 font-normal">Provisioned</span></p>
              </div>
              <div className="h-10 w-10 rounded-full bg-blue-500/10 flex items-center justify-center"><Monitor className="w-5 h-5 text-blue-500"/></div>
           </div>
        </div>

        {/* FLEET TABLE (Glassmorphism look) */}
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/30 overflow-hidden shadow-2xl backdrop-blur-sm">
          <table className="w-full text-sm text-left">
            <thead className="bg-neutral-900/80 text-neutral-400 font-medium border-b border-neutral-800">
              <tr>
                <th className="px-6 py-4 rounded-tl-xl truncate">Screen Identity</th>
                <th className="px-6 py-4">Group Scope</th>
                <th className="px-6 py-4">Status & Sync</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {MOCK_SCREENS.map((screen) => (
                <tr key={screen.id} className="hover:bg-neutral-800/30 transition-colors group">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full ${screen.status === 'ONLINE' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]' : screen.status === 'SYNCING' ? 'bg-blue-500 animate-pulse' : 'bg-red-500'}`} />
                      <div>
                        <p className="font-medium text-neutral-200 group-hover:text-white transition-colors">{screen.name}</p>
                        <p className="text-xs text-neutral-500 mt-0.5">{screen.ip}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <Badge variant="outline" className="bg-neutral-800 border-neutral-700 text-neutral-300">{screen.group}</Badge>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-col gap-1">
                       <span className="flex items-center text-xs text-neutral-400">
                          {screen.status === 'ONLINE' && <Wifi className="w-3 h-3 mr-1.5 text-emerald-400" />}
                          {screen.status === 'SYNCING' && <RefreshCcw className="w-3 h-3 mr-1.5 text-blue-400 animate-spin" />}
                          {screen.status === 'OFFLINE' && <WifiOff className="w-3 h-3 mr-1.5 text-red-400" />}
                          Last heartbeat: {screen.ping}
                       </span>
                       <span className="text-[10px] text-neutral-600">Firmware {screen.version} | Cache {screen.storage}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button className="p-2 hover:bg-neutral-700 rounded-md text-neutral-400 hover:text-white transition-colors">
                      <MoreHorizontal className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
