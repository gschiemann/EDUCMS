"use client";

import { FileImage, LayoutGrid, Type, CloudSun, Clock, MousePointerClick } from 'lucide-react';

export default function TemplatesPage() {
  return (
    <div className="space-y-6 h-[calc(100vh-8rem)] flex flex-col">
      
      <div className="flex justify-between items-center shrink-0">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
            <FileImage className="w-8 h-8 text-indigo-500" />
            Template Editor
          </h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            Design multi-zone layouts by dragging widgets onto the canvas.
          </p>
        </div>
        
        <div className="flex gap-2">
          <button className="px-4 py-2 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-sm font-semibold rounded-md transition-colors">
            Discard
          </button>
          <button className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-md shadow-sm transition-colors">
            Save Template
          </button>
        </div>
      </div>

      {/* Editor Workspace */}
      <div className="flex-1 flex gap-6 min-h-0">
        
        {/* Sidebar Tools */}
        <div className="w-64 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-4 flex flex-col shrink-0 overflow-y-auto">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-4 px-2">Widgets</h3>
          
          <div className="space-y-2">
            <div className="p-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg flex items-center gap-3 cursor-grab hover:border-indigo-500 transition-colors">
              <LayoutGrid className="w-5 h-5 text-slate-400" />
              <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">Media Zone</span>
            </div>
            
            <div className="p-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg flex items-center gap-3 cursor-grab hover:border-indigo-500 transition-colors">
              <Type className="w-5 h-5 text-slate-400" />
              <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">Text Ticker</span>
            </div>

            <div className="p-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg flex items-center gap-3 cursor-grab hover:border-indigo-500 transition-colors">
              <Clock className="w-5 h-5 text-slate-400" />
              <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">Clock</span>
            </div>

            <div className="p-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg flex items-center gap-3 cursor-grab hover:border-indigo-500 transition-colors">
              <CloudSun className="w-5 h-5 text-slate-400" />
              <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">Weather API</span>
            </div>
          </div>
        </div>

        {/* Canvas Area */}
        <div className="flex-1 bg-slate-100 dark:bg-slate-950 rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-800 flex items-center justify-center relative overflow-hidden">
           
           {/* Grid Pattern overlay for design feel */}
           <div className="absolute inset-0" style={{ backgroundImage: 'radial-gradient(#cbd5e1 1px, transparent 1px)', backgroundSize: '24px 24px', opacity: 0.2 }} />

           <div className="text-center z-10 p-8">
              <MousePointerClick className="w-12 h-12 text-slate-400 mx-auto mb-4 opacity-50" />
              <h2 className="text-xl font-bold tracking-tight text-slate-700 dark:text-slate-300 mb-2">Drag widgets here to build a layout</h2>
              <p className="text-sm text-slate-500 max-w-md mx-auto">
                The canvas represents a standard 1080p (16:9) screen. Widgets scale proportionally to fit specific hardware at runtime.
              </p>
           </div>
        </div>

      </div>
    </div>
  );
}
