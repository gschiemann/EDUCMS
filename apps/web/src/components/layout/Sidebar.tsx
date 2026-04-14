import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { ShieldAlert, LayoutDashboard, MonitorPlay, Folders, FileImage, Megaphone, Settings } from 'lucide-react';
import { RoleGate } from '../RoleGate';

export function Sidebar() {
  const pathname = usePathname() || '';
  const activeSchoolId = useAppStore((state) => state.activeSchoolId);

  const navItems = [
    { name: 'Dashboard', href: `/${activeSchoolId}/dashboard`, icon: LayoutDashboard },
    { name: 'Screens', href: `/${activeSchoolId}/screens`, icon: MonitorPlay },
    { name: 'Playlists', href: `/${activeSchoolId}/playlists`, icon: Folders },
    { name: 'Templates', href: `/${activeSchoolId}/templates`, icon: FileImage },
    { name: 'Announcements', href: `/${activeSchoolId}/announcements`, icon: Megaphone },
    { name: 'Settings', href: `/${activeSchoolId}/settings`, icon: Settings },
  ];

  return (
    <aside className="w-64 flex flex-col bg-slate-900 border-r border-slate-800 h-full">
      <div className="h-16 flex items-center px-6 border-b border-slate-800">
        <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
          <MonitorPlay className="w-6 h-6 text-indigo-500" />
          EduSignage
        </h1>
      </div>

      <nav className="flex-1 py-6 px-4 space-y-1 overflow-y-auto">
        <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-4 px-2">
          Menu
        </div>
        {navItems.map((item) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                isActive 
                  ? "bg-indigo-500/10 text-indigo-400" 
                  : "text-slate-400 hover:text-slate-100 hover:bg-slate-800"
              )}
            >
              <item.icon className="w-5 h-5" />
              {item.name}
            </Link>
          );
        })}
      </nav>

      <RoleGate allowedRoles={['admin']}>
        <div className="p-4 border-t border-slate-800">
          <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-2 mb-2">
              <ShieldAlert className="w-4 h-4 text-slate-400" />
              Admin Controls
            </h3>
            <p className="text-xs text-slate-500 leading-relaxed mb-3">
              You are logged in as an administrator. You have override privileges.
            </p>
          </div>
        </div>
      </RoleGate>
    </aside>
  );
}
