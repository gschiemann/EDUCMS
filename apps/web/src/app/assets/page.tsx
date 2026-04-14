"use client"

import * as React from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"
import { UploadCloud, Image as ImageIcon, Video, Search, CheckCircle2, Clock, Filter, FileWarning } from "lucide-react"

const MOCK_ASSETS = [
  { id: 1, name: "Morning_Announcements.mp4", type: "video", status: "APPROVED", size: "45.2 MB", date: "2 hrs ago", thumb: "bg-blue-900/40" },
  { id: 2, name: "Lunch_Menu_Tuesday.png", type: "image", status: "APPROVED", size: "1.2 MB", date: "5 hrs ago", thumb: "bg-emerald-900/40" },
  { id: 3, name: "Pep_Rally_Promo.mp4", type: "video", status: "PENDING", size: "112.5 MB", date: "1 day ago", thumb: "bg-amber-900/40" },
  { id: 4, name: "Library_Rules.png", type: "image", status: "FAILED", size: "0.8 MB", date: "2 days ago", thumb: "bg-red-900/40" },
  { id: 5, name: "Bus_Routes_Update.png", type: "image", status: "APPROVED", size: "2.1 MB", date: "3 days ago", thumb: "bg-indigo-900/40" },
];

export default function AssetLibraryPage() {
  const [isDragging, setIsDragging] = React.useState(false);

  return (
    <div className="flex-1 overflow-y-auto space-y-6 flex flex-col h-full bg-neutral-950">
      <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center gap-2 border-b border-neutral-800 bg-neutral-950/80 px-4 backdrop-blur-md">
        <SidebarTrigger className="text-white hover:text-white/80" />
        <Separator orientation="vertical" className="mr-2 h-4 bg-neutral-700" />
        <h1 className="text-sm font-medium text-neutral-200">Asset Library</h1>
      </header>

      <div className="p-6 pt-2 space-y-6 max-w-7xl mx-auto w-full">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h2 className="text-3xl font-bold tracking-tight text-white mb-1">Media Management</h2>
            <p className="text-neutral-400 text-sm">Upload, manage, and approve district media content.</p>
          </div>
          <div className="flex items-center gap-3 w-full md:w-auto">
            <div className="relative group">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500 group-focus-within:text-indigo-400 transition-colors" />
              <input 
                className="pl-9 pr-4 py-2 bg-neutral-900 border border-neutral-800 rounded-lg text-sm text-white placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all w-full md:w-64" 
                placeholder="Search assets..." 
              />
            </div>
            <button className="p-2 bg-neutral-900 border border-neutral-800 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors">
              <Filter className="w-4 h-4" />
            </button>
          </div>
        </div>
        
        {/* DRAG DROP ZONE */}
        <div 
          className={`relative overflow-hidden border-2 border-dashed rounded-xl p-12 flex flex-col items-center justify-center transition-all duration-300 cursor-pointer
            ${isDragging ? 'border-indigo-500 bg-indigo-500/10 scale-[1.01]' : 'border-neutral-800 hover:border-neutral-700 bg-neutral-900/40 hover:bg-neutral-900/80'}`}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => { e.preventDefault(); setIsDragging(false); }}
        >
          <div className="h-16 w-16 mb-4 rounded-full bg-neutral-950 border border-neutral-800 shadow-2xl flex items-center justify-center">
            <UploadCloud className={`w-8 h-8 ${isDragging ? 'text-indigo-400 animate-bounce' : 'text-neutral-400'}`} />
          </div>
          <h3 className="text-xl font-semibold text-white mb-2">Upload new media</h3>
          <p className="text-sm text-neutral-400 text-center max-w-md">
            Drag and drop your MP4, WebM, or PNG files here, or <span className="text-indigo-400 hover:underline">browse files</span>. Up to 500MB per video.
          </p>
        </div>

        {/* GRID */}
        <div className="pt-4">
          <h3 className="text-lg font-medium text-white mb-4">Library Collection</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {MOCK_ASSETS.map((asset) => (
              <Card key={asset.id} className="group overflow-hidden bg-neutral-900 border-neutral-800 hover:border-neutral-600 transition-all hover:shadow-xl hover:shadow-black/40 hover:-translate-y-1 cursor-pointer">
                {/* Thumbnail Area - Glassmorphic overlay */}
                <div className={`relative h-32 w-full ${asset.thumb} flex items-center justify-center`}>
                   <div className="absolute inset-0 bg-gradient-to-t from-neutral-900 via-transparent to-transparent opacity-80" />
                   {asset.type === 'video' ? <Video className="w-8 h-8 text-white/50" /> : <ImageIcon className="w-8 h-8 text-white/50" />}
                   
                   {/* Status Badge */}
                   <div className="absolute top-2 right-2">
                     {asset.status === 'APPROVED' && <Badge variant="outline" className="bg-emerald-950/80 text-emerald-400 border-emerald-900 backdrop-blur-md px-2 py-0 h-5 text-[10px]"><CheckCircle2 className="w-3 h-3 mr-1"/> Ready</Badge>}
                     {asset.status === 'PENDING' && <Badge variant="outline" className="bg-amber-950/80 text-amber-400 border-amber-900 backdrop-blur-md px-2 py-0 h-5 text-[10px]"><Clock className="w-3 h-3 mr-1"/> Pending</Badge>}
                     {asset.status === 'FAILED' && <Badge variant="outline" className="bg-red-950/80 text-red-400 border-red-900 backdrop-blur-md px-2 py-0 h-5 text-[10px]"><FileWarning className="w-3 h-3 mr-1"/> Error</Badge>}
                   </div>
                </div>
                <CardContent className="p-3">
                  <p className="text-sm font-medium text-neutral-200 truncate group-hover:text-white transition-colors">{asset.name}</p>
                  <div className="flex items-center justify-between mt-2">
                    <p className="text-xs text-neutral-500">{asset.size}</p>
                    <p className="text-[10px] text-neutral-600">{asset.date}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
