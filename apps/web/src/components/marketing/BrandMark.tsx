import { MonitorPlay } from 'lucide-react';
import Link from 'next/link';

export function BrandMark({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const iconBox = size === 'sm' ? 'w-8 h-8 rounded-xl' : 'w-10 h-10 rounded-2xl';
  const iconSize = size === 'sm' ? 'w-4 h-4' : 'w-5 h-5';
  const textSize = size === 'sm' ? 'text-base' : 'text-lg';
  return (
    <Link href="/" className="inline-flex items-center gap-2.5 group">
      <span className={`${iconBox} bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center shadow-lg shadow-indigo-500/20 group-hover:scale-105 transition-transform`}>
        <MonitorPlay className={`${iconSize} text-white`} strokeWidth={2.25} />
      </span>
      <span className={`${textSize} font-bold tracking-tight text-slate-900 font-[family-name:var(--font-fredoka)]`}>
        EduSignage
      </span>
    </Link>
  );
}
