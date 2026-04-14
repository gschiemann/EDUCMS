"use client";

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Image as ImageIcon, Video, LayoutTemplate, MoreVertical } from 'lucide-react';

interface Slide {
  id: string;
  name: string;
  type: 'image' | 'video' | 'template';
  duration: number;
}

interface Props {
  id: string;
  slide: Slide;
  index: number;
}

export function SortableSlideItem({ id, slide, index }: Props) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const getIcon = () => {
    switch (slide.type) {
      case 'image': return <ImageIcon className="w-5 h-5 text-sky-500" />;
      case 'video': return <Video className="w-5 h-5 text-purple-500" />;
      case 'template': return <LayoutTemplate className="w-5 h-5 text-amber-500" />;
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 p-4 bg-white dark:bg-slate-900 border rounded-xl shadow-sm transition-colors group ${
        isDragging 
          ? 'opacity-80 border-indigo-500 shadow-lg scale-[1.01] z-50' 
          : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
      }`}
    >
      <div 
        {...attributes} 
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 p-1"
      >
        <GripVertical className="w-5 h-5" />
      </div>
      
      <div className="w-8 flex items-center justify-center text-xs font-bold text-slate-400">
        {index.toString().padStart(2, '0')}
      </div>

      <div className="w-10 h-10 bg-slate-50 dark:bg-slate-800 rounded-lg flex items-center justify-center border border-slate-100 dark:border-slate-700 shrink-0">
        {getIcon()}
      </div>

      <div className="flex-1 min-w-0">
        <h4 className="text-sm font-semibold text-slate-900 dark:text-white truncate">{slide.name}</h4>
        <p className="text-xs text-slate-500 uppercase tracking-wide mt-0.5">{slide.type}</p>
      </div>

      <div className="px-3 py-1 bg-slate-100 dark:bg-slate-800 rounded text-xs font-bold text-slate-600 dark:text-slate-300">
        {slide.duration}s
      </div>

      <button className="p-2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 opacity-0 group-hover:opacity-100 transition-opacity">
        <MoreVertical className="w-5 h-5" />
      </button>
    </div>
  );
}
