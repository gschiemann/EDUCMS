import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { ShieldAlert, LayoutDashboard, MonitorPlay, Folders, Settings, Upload, LayoutTemplate } from 'lucide-react';
import { RoleGate } from '../RoleGate';

export function Sidebar() {
  const pathname = usePathname() || '';
  const activeTenant = useAppStore((state) => state.activeTenant);

  const navItems = [
    { name: 'Dashboard', href: `/${activeTenant}/dashboard`, icon: LayoutDashboard },
    { name: 'Screens', href: `/${activeTenant}/screens`, icon: MonitorPlay },
    { name: 'Templates', href: `/${activeTenant}/templates`, icon: LayoutTemplate },
    { name: 'Assets', href: `/${activeTenant}/assets`, icon: Upload },
    { name: 'Playlists', href: `/${activeTenant}/playlists`, icon: Folders },
    { name: 'Settings', href: `/${activeTenant}/settings`, icon: Settings },
  ];

  return (
    <aside className="w-72 flex flex-col bg-white border-r border-slate-200 h-full shadow-sm z-20">
      <div className="h-16 flex items-center px-6 border-b border-slate-100">
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-800 flex items-center gap-3">
          <div className="bg-indigo-50 p-2 rounded-xl text-indigo-600 shadow-sm">
            <MonitorPlay className="w-6 h-6" />
          </div>
          <span className="bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-violet-500">EduSignage</span>
        </h1>
      </div>

      <nav className="flex-1 py-8 px-5 space-y-1.5 overflow-y-auto">
        <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-5 px-3">
          Main Menu
        </div>
        {navItems.map((item) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3.5 px-4 py-3 rounded-xl text-sm font-bold transition-all duration-200",
                isActive 
                  ? "bg-indigo-50 text-indigo-700 shadow-sm border border-indigo-100/50" 
                  : "text-slate-500 hover:text-indigo-600 hover:bg-slate-50"
              )}
            >
              <item.icon className={cn("w-5 h-5 transition-transform", isActive && "scale-110")} />
              {item.name}
            </Link>
          );
        })}
      </nav>

      <RoleGate allowedRoles={['admin']}>
        <div className="px-5 pb-5">
          <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-100 rounded-lg">
            <ShieldAlert className="w-3.5 h-3.5 text-amber-500" />
            <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wider">Admin</span>
          </div>
        </div>
      </RoleGate>
    </aside>
  );
}
