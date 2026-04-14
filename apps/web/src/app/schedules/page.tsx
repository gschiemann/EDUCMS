"use client"

import * as React from "react"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"
import { Clock, Calendar, Plus, PlayCircle } from "lucide-react"

export default function SchedulesPage() {
  return (
    <div className="flex-1 overflow-hidden bg-neutral-950 flex flex-col h-full">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-neutral-800 bg-neutral-950/80 px-4 backdrop-blur-md">
        <div className="flex items-center gap-2">
           <SidebarTrigger className="text-white hover:text-white/80" />
           <Separator orientation="vertical" className="mr-2 h-4 bg-neutral-700" />
           <h1 className="text-sm font-medium text-neutral-200">Timeline Scheduler</h1>
        </div>
        <button className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-md shadow-lg shadow-emerald-900/20 transition-all flex items-center gap-2">
           <PlayCircle className="w-4 h-4" /> Publish Manifest
        </button>
      </header>

      <div className="flex-1 flex overflow-hidden">
         {/* SIDEBAR: SAVED ASSETS */}
         <div className="w-80 border-r border-neutral-800 bg-neutral-900/30 flex flex-col">
            <div className="p-4 border-b border-neutral-800 bg-neutral-900/50">
               <h3 className="font-semibold text-white">Media Bin</h3>
               <p className="text-xs text-neutral-500 mt-1">Drag items onto the timeline below</p>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
               {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="group p-3 rounded-lg border border-neutral-800 bg-neutral-950 flex items-center gap-3 cursor-grab active:cursor-grabbing hover:border-indigo-500/50 hover:bg-neutral-900 transition-all shadow-sm">
                     <div className="w-12 h-12 rounded bg-neutral-800 flex-shrink-0" />
                     <div className="overflow-hidden">
                        <p className="text-sm font-medium text-neutral-200 truncate group-hover:text-white">Content Item 0{i}</p>
                        <p className="text-[10px] text-neutral-500">Video • 00:15s</p>
                     </div>
                  </div>
               ))}
            </div>
         </div>

         {/* MAIN: TIMELINE WORKSPACE */}
         <div className="flex-1 flex flex-col p-6 bg-gradient-to-br from-neutral-950 to-neutral-900/50">
            <div className="mb-6">
               <h2 className="text-2xl font-bold tracking-tight text-white mb-2">Morning Announcements</h2>
               <div className="flex items-center gap-4 text-sm text-neutral-400">
                  <span className="flex items-center gap-1.5"><Calendar className="w-4 h-4 text-indigo-400"/> Mon-Fri</span>
                  <span className="flex items-center gap-1.5"><Clock className="w-4 h-4 text-indigo-400"/> 08:00 AM - 09:30 AM</span>
                  <Badge variant="outline" className="border-indigo-900 text-indigo-400 bg-indigo-950/50 ml-2">Target: Lobby Group</Badge>
               </div>
            </div>

            {/* TIMELINE DROPAREA */}
            <div className="flex-1 rounded-xl border border-neutral-800 bg-neutral-900/40 shadow-inner flex flex-col p-4 relative overflow-hidden">
               <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/5 rounded-full blur-3xl pointer-events-none" />
               
               {/* Timeline Tracks */}
               <div className="space-y-4 flex-1">
                  <div className="h-32 rounded-lg border-2 border-dashed border-neutral-700 bg-neutral-900/50 flex flex-col items-center justify-center text-neutral-500 hover:border-neutral-500 hover:bg-neutral-800/50 transition-colors cursor-pointer group">
                     <Plus className="w-6 h-6 mb-2 group-hover:text-white transition-colors" />
                     <span className="text-sm font-medium group-hover:text-white transition-colors">Drop Media Here to start sequence</span>
                  </div>
               </div>
            </div>
         </div>
      </div>
    </div>
  )
}

function Badge({ className, variant, children }: any) {
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${className}`}>{children}</span>
}
