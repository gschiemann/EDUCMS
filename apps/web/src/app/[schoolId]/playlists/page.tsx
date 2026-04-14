"use client";

import { useState } from 'react';
import { Play, Plus, Clock, Save, Info } from 'lucide-react';
import { 
  DndContext, 
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';

import { SortableSlideItem } from '@/components/playlists/SortableSlideItem';

interface Slide {
  id: string;
  name: string;
  type: 'image' | 'video' | 'template';
  duration: number; // seconds
}

const initialSlides: Slide[] = [
  { id: '1', name: 'Welcome Banner', type: 'image', duration: 15 },
  { id: '2', name: 'Morning Announcements', type: 'video', duration: 120 },
  { id: '3', name: 'Lunch Menu', type: 'template', duration: 30 },
  { id: '4', name: 'Upcoming Events', type: 'image', duration: 15 },
];

export default function PlaylistsPage() {
  const [slides, setSlides] = useState<Slide[]>(initialSlides);
  const [isSaving, setIsSaving] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    
    if (over && active.id !== over.id) {
      setSlides((items) => {
        const oldIndex = items.findIndex(i => i.id === active.id);
        const newIndex = items.findIndex(i => i.id === over.id);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  const calculateTotalDuration = () => {
    const totalSeconds = slides.reduce((acc, slide) => acc + slide.duration, 0);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}m ${seconds}s`;
  };

  const handleSave = () => {
    setIsSaving(true);
    // Simulate API mutaion
    setTimeout(() => setIsSaving(false), 1000);
  };

  return (
    <div className="space-y-6">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-white">
            Daily Rotation Playlist
          </h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            Drag to reorder slides. Updates apply to 12 active screens upon save.
          </p>
        </div>

        <div className="flex gap-3">
          <button className="px-4 py-2 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-sm font-semibold rounded-md transition-colors flex items-center gap-2">
            <Play className="w-4 h-4" /> Preview
          </button>
          <button 
            onClick={handleSave}
            disabled={isSaving}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold rounded-md shadow-sm transition-all flex items-center gap-2"
          >
            <Save className="w-4 h-4" /> {isSaving ? 'Saving...' : 'Save Playlist'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Editor Timeline */}
        <div className="lg:col-span-2 bg-slate-50 dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden flex flex-col">
          <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex justify-between items-center z-10">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Timeline Progression</h2>
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
              <Clock className="w-4 h-4" /> Total Loop: {calculateTotalDuration()}
            </div>
          </div>
          
          <div className="flex-1 p-6 overflow-y-auto">
            <DndContext 
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
              modifiers={[restrictToVerticalAxis]}
            >
              <SortableContext 
                items={slides.map(s => s.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-3">
                  {slides.map((slide, index) => (
                    <SortableSlideItem 
                      key={slide.id} 
                      id={slide.id} 
                      slide={slide} 
                      index={index + 1}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
            
            <button className="w-full mt-6 py-4 border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-indigo-500 dark:hover:border-indigo-500 rounded-xl text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 font-medium transition-colors flex items-center justify-center gap-2">
              <Plus className="w-5 h-5" /> Add Slide or Media
            </button>
          </div>
        </div>

        {/* Configuration Pane */}
        <div className="space-y-6">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-6">
             <div className="flex items-center gap-2 mb-4">
                <Info className="w-4 h-4 text-indigo-500" />
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Properties</h3>
             </div>
             <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-10 border border-slate-100 dark:border-slate-800 border-dashed rounded-lg">
               Select a slide in the timeline to edit its duration, transitions, and media properties.
             </p>
          </div>
        </div>

      </div>
    </div>
  );
}
